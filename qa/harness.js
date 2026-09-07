/* ===========================================================================
   Headless test harness for Neural Snake.
   Provides just enough THREE / DOM / Web Audio / localStorage to run the real
   game logic in Node, plus a virtual clock so frames and timers are
   deterministic. Anything the game touches that is not modelled gets an
   auto-stub which is recorded, so nothing fails silently.
   ========================================================================= */
'use strict';

const autoStubbed = new Set();
const problems = [];
const warnings = [];

function fail(msg) { problems.push(msg); }
function warn(msg) { warnings.push(msg); }

/* ---------- virtual clock ------------------------------------------------- */
let vtime = 0;
let timerId = 0;
const timers = [];
let rafId = 0;
const rafs = [];

function vSetTimeout(fn, ms) {
  timerId++;
  timers.push({ id: timerId, at: vtime + (ms || 0), fn: fn });
  return timerId;
}
function vClearTimeout(id) {
  for (let i = 0; i < timers.length; i++) if (timers[i].id === id) { timers.splice(i, 1); return; }
}
function vRaf(fn) { rafId++; rafs.push({ id: rafId, fn: fn }); return rafId; }
function vCancelRaf(id) {
  for (let i = 0; i < rafs.length; i++) if (rafs[i].id === id) { rafs.splice(i, 1); return; }
}

/* run one display frame: advance the clock, fire due timers, then rAF */
function tick(ms) {
  vtime += ms;
  for (let guard = 0; guard < 200; guard++) {
    let next = -1;
    for (let i = 0; i < timers.length; i++) {
      if (timers[i].at <= vtime && (next < 0 || timers[i].at < timers[next].at)) next = i;
    }
    if (next < 0) break;
    const t = timers.splice(next, 1)[0];
    try { t.fn(); } catch (e) { fail('timer threw: ' + (e && e.stack || e)); }
  }
  const due = rafs.splice(0, rafs.length);
  for (let i = 0; i < due.length; i++) {
    try { due[i].fn(vtime); } catch (e) { fail('rAF threw: ' + (e && e.stack || e)); }
  }
}
function frames(n, ms) {
  for (let i = 0; i < n; i++) tick(ms == null ? 16.6667 : ms);
}

/* ---------- tiny DOM ----------------------------------------------------- */
class ClassList {
  constructor(owner) { this.owner = owner; this.set = new Set(); }
  add() { for (const a of arguments) String(a).split(/\s+/).forEach(c => c && this.set.add(c)); }
  remove() { for (const a of arguments) this.set.delete(a); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : !!force;
    if (on) this.set.add(c); else this.set.delete(c);
    return on;
  }
  get length() { return this.set.size; }
  toString() { return [...this.set].join(' '); }
}

class Style {
  constructor() { this._p = {}; }
  setProperty(k, v) { this._p[k] = v; }
  getPropertyValue(k) { return this._p[k] || ''; }
  removeProperty(k) { delete this._p[k]; }
}

let elementCount = 0;

class El {
  constructor(tag, id) {
    elementCount++;
    this.tagName = String(tag || 'div').toUpperCase();
    this.id = id || '';
    this.classList = new ClassList(this);
    this.style = new Style();
    this.dataset = {};
    this.attrs = {};
    this.children = [];
    this.parentNode = null;
    this._text = '';
    this._html = '';
    this.listeners = {};
    this.value = '';
    this.checked = false;
    this.width = 300;
    this.height = 150;
    this.disabled = false;
    this._lookups = {};
    this.scrollTop = 0;
  }
  get className() { return this.classList.toString(); }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); this.children.length = 0; }
  get innerHTML() { return this._html; }
  set innerHTML(v) {
    this._html = String(v);
    this.children.length = 0;
    /* remember any ids the markup declared so querySelector can find them */
    const m = String(v).match(/id="([^"]+)"/g) || [];
    this._declared = m.map(s => s.slice(4, -1));
    if (/<(script|iframe)/i.test(v)) fail('innerHTML injected a script/iframe tag');
  }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get childNodes() { return this.children; }
  get offsetWidth() { return 480; }
  get offsetHeight() { return 90; }
  get clientWidth() { return 480; }
  get clientHeight() { return 90; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c, ref) {
    const i = this.children.indexOf(ref);
    c.parentNode = this;
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
    return c;
  }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k.indexOf('data-') === 0) this.dataset[k.slice(5).replace(/-(\w)/g, (m, c) => c.toUpperCase())] = String(v);
  }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  focus() { doc.activeElement = this; }
  blur() { if (doc.activeElement === this) doc.activeElement = doc.body; }
  click() { this.dispatch('click', {}); }
  closest(sel) {
    /* good enough for the guard in Input.onKey: match tag or single class */
    let n = this;
    const parts = String(sel).split(',').map(s => s.trim());
    while (n) {
      for (const p of parts) {
        if (p[0] === '.' && n.classList.contains(p.slice(1))) return n;
        if (p[0] === '[') { const k = p.slice(1, -1).split('=')[0]; if (n.hasAttribute(k)) return n; }
        if (/^[a-zA-Z]/.test(p) && n.tagName === p.split(/[.\[]/)[0].toUpperCase()) return n;
      }
      n = n.parentNode;
    }
    return null;
  }
  matches(sel) { return this.closest(sel) === this; }
  querySelector(sel) {
    if (this._lookups[sel]) return this._lookups[sel];
    const found = this._search(sel);
    if (found) { this._lookups[sel] = found; return found; }
    /* the real markup has this child; model it lazily */
    const tag = /^[a-zA-Z]+/.test(sel) ? sel.match(/^[a-zA-Z]+/)[0] : 'div';
    const e = new El(tag);
    if (sel[0] === '.') e.classList.add(sel.slice(1));
    e.parentNode = this;
    this._lookups[sel] = e;
    return e;
  }
  _search(sel) {
    for (const c of this.children) {
      if (sel[0] === '.' && c.classList.contains(sel.slice(1))) return c;
      if (sel[0] === '#' && c.id === sel.slice(1)) return c;
      if (/^[a-zA-Z]+$/.test(sel) && c.tagName === sel.toUpperCase()) return c;
      const deep = c._search(sel);
      if (deep) return deep;
    }
    return null;
  }
  querySelectorAll(sel) {
    /* the thumb pad's four buttons are the one case the game iterates */
    if (this.id === 'dpad' && sel === 'button') {
      if (!this._pad) {
        this._pad = ['up', 'down', 'left', 'right'].map(d => {
          const b = new El('button');
          b.setAttribute('data-dir', d);
          b.parentNode = this;
          return b;
        });
      }
      return this._pad;
    }
    const out = [];
    (function walk(n) {
      for (const c of n.children) {
        if (sel[0] === '.' && c.classList.contains(sel.slice(1))) out.push(c);
        else if (/^[a-zA-Z]+$/.test(sel) && c.tagName === sel.toUpperCase()) out.push(c);
        else if (sel[0] === '[' && c.hasAttribute(sel.slice(1, -1).split('=')[0])) out.push(c);
        walk(c);
      }
    })(this);
    return out;
  }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    const l = this.listeners[type];
    if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
  }
  dispatch(type, ev) {
    const e = Object.assign({
      type: type, target: this, currentTarget: this, preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { }, defaultPrevented: false
    }, ev || {});
    let n = this;
    while (n) {
      const l = n.listeners[type];
      if (l) for (const fn of l.slice()) {
        e.currentTarget = n;
        try { fn.call(n, e); } catch (err) { fail('listener "' + type + '" threw: ' + (err && err.stack || err)); }
      }
      n = n.parentNode;
    }
    return e;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 480, bottom: 90, width: 480, height: 90, x: 0, y: 0 };
  }
  getContext(kind) {
    if (kind === '2d') return ctx2d();
    if (kind === 'webgl' || kind === 'experimental-webgl') {
      return { getExtension: () => ({ loseContext() { } }) };
    }
    return null;
  }
  toDataURL() { return 'data:image/png;base64,'; }
}

function ctx2d() {
  const grad = { addColorStop() { } };
  const c = {
    canvas: null, globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic',
    shadowBlur: 0, shadowColor: '#000', filter: 'none', imageSmoothingEnabled: true,
    createRadialGradient: () => grad, createLinearGradient: () => grad, createPattern: () => null,
    measureText: () => ({ width: 10 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h })
  };
  ['clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo',
    'ellipse', 'rect', 'fill', 'stroke', 'save', 'restore', 'translate', 'rotate', 'scale', 'clip',
    'drawImage', 'fillText', 'strokeText', 'setTransform', 'resetTransform', 'transform',
    'quadraticCurveTo', 'bezierCurveTo', 'setLineDash', 'putImageData', 'createImageData']
    .forEach(k => { c[k] = function () { }; });
  return c;
}

/* ---------- document / window -------------------------------------------- */
const knownIds = new Set();
const idNodes = new Map();

const doc = {
  readyState: 'loading',
  hidden: false,
  activeElement: null,
  body: new El('body', 'body'),
  documentElement: new El('html'),
  listeners: {},
  head: new El('head'),
  createElement(tag) { return new El(tag); },
  createElementNS(ns, tag) { return new El(tag); },
  getElementById(id) {
    if (idNodes.has(id)) return idNodes.get(id);
    if (!knownIds.has(id)) { fail('getElementById("' + id + '") — no such id in the markup'); return null; }
    const e = new El(id === 'stage' ? 'canvas' : 'div', id);
    e.parentNode = doc.body;
    doc.body.children.push(e);
    idNodes.set(id, e);
    return e;
  },
  querySelector(sel) { return sel[0] === '#' ? doc.getElementById(sel.slice(1)) : doc.body.querySelector(sel); },
  querySelectorAll(sel) { return doc.body.querySelectorAll(sel); },
  addEventListener(t, fn) { (doc.listeners[t] = doc.listeners[t] || []).push(fn); },
  removeEventListener(t, fn) {
    const l = doc.listeners[t]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
  },
  dispatch(t, ev) {
    const l = doc.listeners[t] || [];
    const e = Object.assign({ type: t, target: doc, preventDefault() { } }, ev || {});
    for (const fn of l.slice()) { try { fn(e); } catch (err) { fail('document "' + t + '" threw: ' + (err && err.stack || err)); } }
  }
};
doc.activeElement = doc.body;

const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: k => { store.delete(k); },
  clear: () => store.clear(),
  get length() { return store.size; },
  key: i => [...store.keys()][i]
};

/* ---------- Web Audio ---------------------------------------------------- */
function param(v) {
  return {
    value: v, setValueAtTime() { return this; }, linearRampToValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; }, setTargetAtTime() { return this; },
    cancelScheduledValues() { return this; }, setValueCurveAtTime() { return this; }
  };
}
let liveVoices = 0;
class AudioContextMock {
  constructor() {
    this.state = 'running';
    this.sampleRate = 44100;
    this.destination = { connect() { }, disconnect() { } };
  }
  get currentTime() { return vtime / 1000; }
  createGain() { return { gain: param(1), connect() { return arguments[0]; }, disconnect() { } }; }
  createOscillator() {
    liveVoices++;
    return {
      type: 'sine', frequency: param(440), detune: param(0),
      connect() { return arguments[0]; }, disconnect() { },
      start() { }, stop() { liveVoices--; }, set onended(f) { }
    };
  }
  createBufferSource() {
    liveVoices++;
    return {
      buffer: null, loop: false, playbackRate: param(1),
      connect() { return arguments[0]; }, disconnect() { }, start() { }, stop() { liveVoices--; }
    };
  }
  createBiquadFilter() {
    return { type: 'lowpass', frequency: param(1000), Q: param(1), gain: param(0), connect() { return arguments[0]; }, disconnect() { } };
  }
  createBuffer(ch, len) {
    return { length: len, numberOfChannels: ch, sampleRate: 44100, getChannelData: () => new Float32Array(len) };
  }
  createDynamicsCompressor() {
    return {
      threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0.003),
      release: param(0.25), connect() { return arguments[0]; }, disconnect() { }
    };
  }
  createStereoPanner() { return { pan: param(0), connect() { return arguments[0]; }, disconnect() { } }; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

/* ---------- THREE -------------------------------------------------------- */
class V3 {
  constructor(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setScalar(s) { this.x = this.y = this.z = s; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  lerp(v, a) { this.x += (v.x - this.x) * a; this.y += (v.y - this.y) * a; this.z += (v.z - this.z) * a; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  applyAxisAngle() { return this; }
  /* crude but bounded NDC so UI.popup exercises its on-screen path */
  project() {
    const x = Math.max(-1, Math.min(1, this.x / 12));
    const y = Math.max(-1, Math.min(1, -this.z / 12));
    return this.set(x, y, 0.5);
  }
  toArray() { return [this.x, this.y, this.z]; }
}

class Col {
  constructor(hex) { this.r = 1; this.g = 1; this.b = 1; this._hex = 0xffffff; if (hex !== undefined) this.setHex(hex); }
  setHex(h) {
    if (typeof h !== 'number' || !isFinite(h) || h < 0 || h > 0xffffff) fail('Color.setHex got a bad value: ' + h);
    this._hex = h >>> 0;
    this.r = ((h >> 16) & 255) / 255; this.g = ((h >> 8) & 255) / 255; this.b = (h & 255) / 255;
    return this;
  }
  getHex() { return this._hex; }
  set(h) { return typeof h === 'number' ? this.setHex(h) : this.copy(h); }
  copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; this._hex = c._hex; return this; }
  clone() { return new Col(this._hex); }
  setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
  offsetHSL() { return this; }
  getStyle() { return '#' + this._hex.toString(16).padStart(6, '0'); }
  multiplyScalar() { return this; }
  lerp() { return this; }
}

let objectCount = 0;
const disposed = { geometry: 0, material: 0, texture: 0 };

class Obj3D {
  constructor(kind) {
    objectCount++;
    this.type = kind || 'Object3D';
    this.position = new V3();
    this.rotation = new V3();
    this.scale = new V3(1, 1, 1);
    this.up = new V3(0, 1, 0);
    this.children = [];
    this.parent = null;
    this.visible = true;
    this.name = '';
    this.userData = {};
    this.castShadow = false;
    this.receiveShadow = false;
    this.frustumCulled = true;
    this.renderOrder = 0;
    this.matrixAutoUpdate = true;
  }
  add() {
    for (const c of arguments) {
      if (!c) { fail('scene/group.add() called with ' + c); continue; }
      if (c.parent && c.parent !== this) c.parent.remove(c);
      c.parent = this; this.children.push(c);
    }
    return this;
  }
  remove() {
    for (const c of arguments) {
      const i = this.children.indexOf(c);
      if (i >= 0) { this.children.splice(i, 1); c.parent = null; }
    }
    return this;
  }
  clear() { this.children.forEach(c => (c.parent = null)); this.children.length = 0; return this; }
  lookAt() { return this; }
  updateMatrixWorld() { return this; }
  traverse(fn) { fn(this); this.children.forEach(c => c.traverse(fn)); }
  getWorldPosition(v) { return v.copy(this.position); }
}

class Geo {
  constructor(kind) {
    this.type = kind || 'BufferGeometry';
    this.attributes = {};
    this.index = null;
    this.drawRange = { start: 0, count: Infinity };
    this.boundingSphere = null;
    this._disposed = false;
  }
  setAttribute(name, attr) { this.attributes[name] = attr; return this; }
  getAttribute(name) { return this.attributes[name]; }
  deleteAttribute(name) { delete this.attributes[name]; return this; }
  setIndex(i) { this.index = i; return this; }
  setDrawRange(start, count) {
    if (!(start >= 0) || !(count >= 0)) fail('setDrawRange(' + start + ', ' + count + ') is out of range');
    this.drawRange = { start: start, count: count };
    return this;
  }
  computeBoundingSphere() { this.boundingSphere = { center: new V3(), radius: 1 }; return this; }
  computeVertexNormals() { return this; }
  translate() { return this; }
  rotateX() { return this; }
  scale() { return this; }
  dispose() { this._disposed = true; disposed.geometry++; }
}

class Attr {
  constructor(array, itemSize) {
    this.array = array; this.itemSize = itemSize;
    this.count = array ? array.length / itemSize : 0;
    this.needsUpdate = false;
    this.usage = 0;
  }
  setUsage() { return this; }
  setXYZ(i, x, y, z) { const a = this.array, o = i * this.itemSize; a[o] = x; a[o + 1] = y; a[o + 2] = z; return this; }
}

class Mat {
  constructor(kind, opts) {
    this.type = kind;
    this.color = new Col(0xffffff);
    this.emissive = new Col(0x000000);
    this.emissiveIntensity = 1;
    this.opacity = 1;
    this.transparent = false;
    this.visible = true;
    this.wireframe = false;
    this.metalness = 0;
    this.roughness = 1;
    this.side = 0;
    this.blending = 1;
    this.depthWrite = true;
    this.depthTest = true;
    this.uniforms = {};
    this.needsUpdate = false;
    this._disposed = false;
    if (opts) for (const k in opts) {
      if (k === 'color' || k === 'emissive') this[k] = new Col(opts[k]);
      else this[k] = opts[k];
    }
  }
  clone() { const m = new Mat(this.type); Object.assign(m, this); m.color = this.color.clone(); m.emissive = this.emissive.clone(); return m; }
  dispose() { this._disposed = true; disposed.material++; }
}

class Tex {
  constructor() { this.needsUpdate = false; this.encoding = 0; this.wrapS = 0; this.wrapT = 0; this.minFilter = 0; this.magFilter = 0; this.repeat = { set() { } }; this.offset = { set() { } }; }
  dispose() { disposed.texture++; }
}

let renderCalls = 0;

const THREE = {
  Vector2: class { constructor(x, y) { this.x = x || 0; this.y = y || 0; } set(x, y) { this.x = x; this.y = y; return this; } },
  Vector3: V3,
  Color: Col,
  Object3D: Obj3D,
  Group: class extends Obj3D { constructor() { super('Group'); } },
  Scene: class extends Obj3D {
    constructor() { super('Scene'); this.fog = null; this.background = null; }
  },
  Mesh: class extends Obj3D {
    constructor(geo, mat) {
      super('Mesh');
      if (!geo) fail('new THREE.Mesh() with no geometry');
      if (!mat) fail('new THREE.Mesh() with no material');
      this.geometry = geo; this.material = mat;
    }
  },
  Points: class extends Obj3D {
    constructor(geo, mat) { super('Points'); this.geometry = geo; this.material = mat; }
  },
  LineSegments: class extends Obj3D {
    constructor(geo, mat) { super('LineSegments'); this.geometry = geo; this.material = mat; }
  },
  Line: class extends Obj3D {
    constructor(geo, mat) { super('Line'); this.geometry = geo; this.material = mat; }
  },
  Sprite: class extends Obj3D {
    constructor(mat) { super('Sprite'); this.material = mat; this.center = new THREE.Vector2(0.5, 0.5); }
  },
  BufferGeometry: Geo,
  BufferAttribute: Attr,
  Float32BufferAttribute: class extends Attr {
    constructor(a, s) { super(a instanceof Float32Array ? a : new Float32Array(a), s); }
  },
  MeshStandardMaterial: class extends Mat { constructor(o) { super('MeshStandardMaterial', o); } },
  MeshBasicMaterial: class extends Mat { constructor(o) { super('MeshBasicMaterial', o); } },
  MeshPhongMaterial: class extends Mat { constructor(o) { super('MeshPhongMaterial', o); } },
  LineBasicMaterial: class extends Mat { constructor(o) { super('LineBasicMaterial', o); } },
  SpriteMaterial: class extends Mat { constructor(o) { super('SpriteMaterial', o); } },
  ShaderMaterial: class extends Mat {
    constructor(o) {
      super('ShaderMaterial', o);
      if (o && o.vertexShader && !/gl_Position/.test(o.vertexShader)) fail('ShaderMaterial vertexShader never writes gl_Position');
      if (o && o.fragmentShader && !/gl_FragColor/.test(o.fragmentShader)) fail('ShaderMaterial fragmentShader never writes gl_FragColor');
    }
  },
  CanvasTexture: class extends Tex { constructor(c) { super(); if (!c) fail('CanvasTexture with no canvas'); this.image = c; } },
  Texture: Tex,
  Sphere: class { constructor(c, r) { this.center = c || new V3(); this.radius = r || 1; } },
  PerspectiveCamera: class extends Obj3D {
    constructor(fov, aspect, near, far) {
      super('PerspectiveCamera');
      this.fov = fov; this.aspect = aspect; this.near = near; this.far = far;
      this.updated = 0;
    }
    updateProjectionMatrix() {
      this.updated++;
      if (!(this.aspect > 0) || !isFinite(this.aspect)) fail('camera.aspect became ' + this.aspect);
      if (!(this.fov > 0) || !isFinite(this.fov)) fail('camera.fov became ' + this.fov);
    }
  },
  OrthographicCamera: class extends Obj3D { constructor() { super('OrthographicCamera'); } updateProjectionMatrix() { } },
  HemisphereLight: class extends Obj3D {
    constructor(a, b, i) { super('HemisphereLight'); this.color = new Col(a); this.groundColor = new Col(b); this.intensity = i; }
  },
  DirectionalLight: class extends Obj3D {
    constructor(c, i) {
      super('DirectionalLight');
      this.color = new Col(c); this.intensity = i;
      this.target = new Obj3D('Object3D');
      this.shadow = {
        mapSize: { width: 512, height: 512, set(w, h) { this.width = w; this.height = h; } },
        camera: { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 50, updateProjectionMatrix() { } },
        bias: 0, normalBias: 0, radius: 1, map: null, needsUpdate: false
      };
    }
  },
  PointLight: class extends Obj3D {
    constructor(c, i, d) { super('PointLight'); this.color = new Col(c); this.intensity = i; this.distance = d; }
  },
  AmbientLight: class extends Obj3D { constructor(c, i) { super('AmbientLight'); this.color = new Col(c); this.intensity = i; } },
  FogExp2: class { constructor(c, d) { this.color = new Col(c); this.density = d; } },
  Fog: class { constructor(c, n, f) { this.color = new Col(c); this.near = n; this.far = f; } },
  WebGLRenderer: class {
    constructor(o) {
      this.opts = o || {};
      if (!this.opts.canvas) fail('WebGLRenderer created without the page canvas');
      this.domElement = this.opts.canvas || new El('canvas');
      this.shadowMap = { enabled: false, type: 0, autoUpdate: true, needsUpdate: false };
      this.outputEncoding = 0;
      this.info = { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } };
      this._w = 0; this._h = 0; this._dpr = 1;
    }
    setSize(w, h, update) {
      if (!(w > 0) || !(h > 0)) fail('renderer.setSize(' + w + ', ' + h + ')');
      if (update !== false) warn('renderer.setSize did not pass updateStyle=false');
      this._w = w; this._h = h;
    }
    setPixelRatio(r) {
      if (!(r > 0) || r > 3) fail('setPixelRatio(' + r + ') is outside a sane range');
      this._dpr = r;
    }
    setClearColor() { }
    getContext() { return { getExtension: () => null }; }
    render(scene, cam) {
      renderCalls++;
      if (!scene) fail('renderer.render() with no scene');
      if (!cam) fail('renderer.render() with no camera');
      const p = cam && cam.position;
      if (p && (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z))) {
        fail('camera position went non-finite: ' + JSON.stringify(p));
      }
    }
    dispose() { }
    forceContextLoss() { }
  },
  /* geometries */
  BoxGeometry: class extends Geo { constructor() { super('BoxGeometry'); } },
  SphereGeometry: class extends Geo { constructor() { super('SphereGeometry'); } },
  PlaneGeometry: class extends Geo { constructor() { super('PlaneGeometry'); } },
  CylinderGeometry: class extends Geo { constructor() { super('CylinderGeometry'); } },
  ConeGeometry: class extends Geo { constructor() { super('ConeGeometry'); } },
  TorusGeometry: class extends Geo { constructor() { super('TorusGeometry'); } },
  OctahedronGeometry: class extends Geo { constructor() { super('OctahedronGeometry'); } },
  IcosahedronGeometry: class extends Geo { constructor() { super('IcosahedronGeometry'); } },
  TetrahedronGeometry: class extends Geo { constructor() { super('TetrahedronGeometry'); } },
  RingGeometry: class extends Geo { constructor() { super('RingGeometry'); } },
  CircleGeometry: class extends Geo { constructor() { super('CircleGeometry'); } },
  EdgesGeometry: class extends Geo { constructor() { super('EdgesGeometry'); } },
  /* constants */
  AdditiveBlending: 2, NormalBlending: 1, MultiplyBlending: 4, SubtractiveBlending: 3,
  DoubleSide: 2, FrontSide: 0, BackSide: 1,
  sRGBEncoding: 3001, LinearEncoding: 3000,
  PCFSoftShadowMap: 2, PCFShadowMap: 1, BasicShadowMap: 0, VSMShadowMap: 3,
  RepeatWrapping: 1000, ClampToEdgeWrapping: 1001,
  LinearFilter: 1006, NearestFilter: 1003,
  DynamicDrawUsage: 35048, StaticDrawUsage: 35044,
  MathUtils: { lerp: (a, b, t) => a + (b - a) * t, clamp: (v, a, b) => Math.max(a, Math.min(b, v)), degToRad: d => d * Math.PI / 180 }
};

/* anything the game reaches for that is missing gets recorded, not swallowed */
const THREEProxy = new Proxy(THREE, {
  get(t, k) {
    if (k in t) return t[k];
    autoStubbed.add('THREE.' + String(k));
    const S = class extends Obj3D { constructor() { super(String(k)); } };
    t[k] = S;
    return S;
  }
});

/* ---------- install globals ---------------------------------------------- */
const win = {
  THREE: THREEProxy,
  document: doc,
  localStorage: localStorage,
  innerWidth: 1440,
  innerHeight: 900,
  devicePixelRatio: 2,
  AudioContext: AudioContextMock,
  webkitAudioContext: AudioContextMock,
  requestAnimationFrame: vRaf,
  cancelAnimationFrame: vCancelRaf,
  setTimeout: vSetTimeout,
  clearTimeout: vClearTimeout,
  setInterval: () => 0,
  clearInterval: () => { },
  matchMedia: q => ({ matches: false, media: q, addEventListener() { }, removeEventListener() { }, addListener() { }, removeListener() { } }),
  navigator: { maxTouchPoints: 0, userAgent: 'node-harness', platform: 'test', vibrate() { } },
  performance: { now: () => vtime },
  console: console,
  listeners: {},
  addEventListener(t, fn) { (win.listeners[t] = win.listeners[t] || []).push(fn); },
  removeEventListener(t, fn) { const l = win.listeners[t]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } },
  dispatch(t, ev) {
    const l = win.listeners[t] || [];
    const e = Object.assign({ type: t, target: win, preventDefault() { }, key: '', code: '' }, ev || {});
    for (const fn of l.slice()) { try { fn(e); } catch (err) { fail('window "' + t + '" threw: ' + (err && err.stack || err)); } }
    return e;
  },
  getComputedStyle: () => ({ getPropertyValue: () => '' })
};
win.window = win;
win.self = win;
win.top = win;

module.exports = {
  win, doc, THREE: THREEProxy, localStorage, store, knownIds, idNodes,
  tick, frames, vSetTimeout, vRaf,
  clock: () => vtime,
  problems, warnings, autoStubbed,
  stats: () => ({ objects: objectCount, elements: elementCount, renderCalls, liveVoices, disposed }),
  El, fail, warn
};
