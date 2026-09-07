
/* ===========================================================================
   SHARED GPU ASSETS
   Geometry and textures are built once and reused by every entity, so growing
   the snake or spawning pickups never allocates new GPU resources.
   ========================================================================= */

const Assets = {
  geo: {},
  tex: {},
  quality: 'high',

  init: function (quality) {
    this.quality = quality;
    const lo = quality === 'low';
    const md = quality === 'medium';
    const seg = lo ? 8 : (md ? 12 : 16);
    const ring = lo ? 6 : (md ? 8 : 12);

    this.geo.sphere = new THREE.SphereGeometry(0.44, seg, Math.max(6, seg - 4));
    this.geo.headSphere = new THREE.SphereGeometry(0.50, seg + 4, seg);
    this.geo.ico = new THREE.IcosahedronGeometry(0.50, lo ? 0 : 1);
    this.geo.octa = new THREE.OctahedronGeometry(0.54, 0);
    this.geo.eye = new THREE.SphereGeometry(0.13, 10, 8);
    this.geo.pupil = new THREE.SphereGeometry(0.075, 8, 6);
    this.geo.box = new THREE.BoxGeometry(1, 1, 1);
    this.geo.plate = new THREE.BoxGeometry(1, 0.12, 1);
    this.geo.core = new THREE.IcosahedronGeometry(0.30, lo ? 0 : 1);
    this.geo.shard = new THREE.OctahedronGeometry(0.34, 0);
    this.geo.cone = new THREE.ConeGeometry(0.28, 0.6, ring + 2);
    this.geo.torus = new THREE.TorusGeometry(0.28, 0.10, lo ? 6 : 8, ring + 4);
    this.geo.ringFlat = new THREE.TorusGeometry(0.42, 0.035, 4, ring + 8);
    this.geo.cyl = new THREE.CylinderGeometry(0.35, 0.35, 1, ring + 2);
    this.geo.spike = new THREE.ConeGeometry(0.34, 0.9, ring);
    this.geo.mouth = new THREE.SphereGeometry(0.20, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);

    this.tex.glow = this.makeGlow(0.28, 1.0);
    this.tex.soft = this.makeGlow(0.02, 0.55);
    this.tex.spark = this.makeSpark();
    return this;
  },

  /* radial falloff sprite — the workhorse behind every neon halo */
  makeGlow: function (coreStop, coreAlpha) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    if (g && g.createRadialGradient) {
      const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, 'rgba(255,255,255,' + coreAlpha + ')');
      grd.addColorStop(coreStop, 'rgba(255,255,255,' + (coreAlpha * 0.55) + ')');
      grd.addColorStop(0.55, 'rgba(255,255,255,0.16)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 128, 128);
    }
    const t = new THREE.CanvasTexture(c);
    if ('encoding' in t && THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
    return t;
  },

  makeSpark: function () {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    if (g && g.createRadialGradient) {
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
    }
    return new THREE.CanvasTexture(c);
  },

  glowSprite: function (color, size, opacity) {
    const m = new THREE.SpriteMaterial({
      map: this.tex.glow, color: color, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
      opacity: opacity === undefined ? 1 : opacity
    });
    const s = new THREE.Sprite(m);
    s.scale.set(size, size, 1);
    return s;
  },

  bodyGeo: function (kind) {
    if (kind === 'ico') return this.geo.ico;
    if (kind === 'octa') return this.geo.octa;
    if (kind === 'box') return this.geo.box;
    if (kind === 'torus') return this.geo.torus;
    if (kind === 'cone') return this.geo.cone;
    if (kind === 'cyl') return this.geo.cyl;
    return this.geo.sphere;
  }
};

/* ===========================================================================
   5 — PARTICLE SYSTEM
   A single THREE.Points object with a hand-written shader. Slots are pooled
   and dead particles are swap-removed, so there is no allocation per burst
   and no garbage for the collector to chase mid-run.
   ========================================================================= */

const PARTICLE_BUDGET = { off: 0, low: 320, normal: 760, high: 1500 };

function ParticleSystem(scene, max) {
  this.max = Math.max(1, max);
  this.count = 0;
  this.scene = scene;

  this.pos = new Float32Array(this.max * 3);
  this.col = new Float32Array(this.max * 3);
  this.siz = new Float32Array(this.max);
  this.vel = new Float32Array(this.max * 3);
  this.base = new Float32Array(this.max * 3);   /* undimmed colour */
  this.life = new Float32Array(this.max);
  this.max_life = new Float32Array(this.max);
  this.size0 = new Float32Array(this.max);
  this.drag = new Float32Array(this.max);
  this.grav = new Float32Array(this.max);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
  geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3));
  geo.setAttribute('psize', new THREE.BufferAttribute(this.siz, 1));
  geo.setDrawRange(0, 0);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 400);

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: Assets.tex.spark }, uScale: { value: 1 } },
    vertexShader: [
      'attribute vec3 pcolor;',
      'attribute float psize;',
      'varying vec3 vC;',
      'uniform float uScale;',
      'void main(){',
      '  vC = pcolor;',
      '  vec4 mv = modelViewMatrix * vec4(position,1.0);',
      '  gl_PointSize = psize * uScale * (260.0 / max(0.001, -mv.z));',
      '  gl_Position = projectionMatrix * mv;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D uTex;',
      'varying vec3 vC;',
      'void main(){',
      '  vec4 t = texture2D(uTex, gl_PointCoord);',
      '  if (t.a < 0.02) discard;',
      '  gl_FragColor = vec4(vC * t.a, t.a);',
      '}'
    ].join('\n'),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  this.points = new THREE.Points(geo, mat);
  this.points.frustumCulled = false;
  this.geo = geo;
  this.mat = mat;
  scene.add(this.points);
  this._tmpColor = new THREE.Color();
}

ParticleSystem.prototype.setScale = function (s) { this.mat.uniforms.uScale.value = s; };

ParticleSystem.prototype.clear = function () {
  this.count = 0;
  this.geo.setDrawRange(0, 0);
};

/* opts: color, count, speed, spread, size, life, gravity, drag, dirY, jitter */
ParticleSystem.prototype.burst = function (x, y, z, opts) {
  if (this.max <= 1) return;
  const o = opts || {};
  const n = Math.min(o.count || 12, this.max - this.count);
  if (n <= 0) return;
  const c = this._tmpColor.set(o.color === undefined ? 0xffffff : o.color);
  const speed = o.speed === undefined ? 4 : o.speed;
  const spread = o.spread === undefined ? 1 : o.spread;
  const size = o.size === undefined ? 0.5 : o.size;
  const life = o.life === undefined ? 0.7 : o.life;
  const jitter = o.jitter === undefined ? 0.12 : o.jitter;

  for (let i = 0; i < n; i++) {
    const s = this.count++;
    const i3 = s * 3;
    /* even-ish sphere directions with a bias toward the horizon plane */
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(clamp(1 - 2 * Math.random(), -1, 1));
    let dx = Math.sin(ph) * Math.cos(th);
    let dy = Math.cos(ph) * spread + (o.dirY || 0);
    let dz = Math.sin(ph) * Math.sin(th);
    const sp = speed * (0.55 + Math.random() * 0.75);

    this.pos[i3] = x + dx * jitter;
    this.pos[i3 + 1] = y + dy * jitter;
    this.pos[i3 + 2] = z + dz * jitter;
    this.vel[i3] = dx * sp;
    this.vel[i3 + 1] = dy * sp;
    this.vel[i3 + 2] = dz * sp;

    const tint = 0.75 + Math.random() * 0.5;
    this.base[i3] = c.r * tint;
    this.base[i3 + 1] = c.g * tint;
    this.base[i3 + 2] = c.b * tint;
    this.col[i3] = this.base[i3];
    this.col[i3 + 1] = this.base[i3 + 1];
    this.col[i3 + 2] = this.base[i3 + 2];

    const l = life * (0.7 + Math.random() * 0.6);
    this.life[s] = l;
    this.max_life[s] = l;
    this.size0[s] = size * (0.6 + Math.random() * 0.8);
    this.siz[s] = this.size0[s];
    this.drag[s] = o.drag === undefined ? 2.2 : o.drag;
    this.grav[s] = o.gravity === undefined ? -2.2 : o.gravity;
  }
};

ParticleSystem.prototype._swap = function (a, b) {
  if (a === b) return;
  const a3 = a * 3, b3 = b * 3;
  for (let k = 0; k < 3; k++) {
    this.pos[a3 + k] = this.pos[b3 + k];
    this.col[a3 + k] = this.col[b3 + k];
    this.vel[a3 + k] = this.vel[b3 + k];
    this.base[a3 + k] = this.base[b3 + k];
  }
  this.siz[a] = this.siz[b];
  this.life[a] = this.life[b];
  this.max_life[a] = this.max_life[b];
  this.size0[a] = this.size0[b];
  this.drag[a] = this.drag[b];
  this.grav[a] = this.grav[b];
};

ParticleSystem.prototype.update = function (dt) {
  if (dt <= 0) return;
  let i = 0;
  while (i < this.count) {
    this.life[i] -= dt;
    if (this.life[i] <= 0) {
      this.count--;
      this._swap(i, this.count);
      continue;
    }
    const i3 = i * 3;
    const d = Math.max(0, 1 - this.drag[i] * dt);
    this.vel[i3] *= d;
    this.vel[i3 + 1] = this.vel[i3 + 1] * d + this.grav[i] * dt;
    this.vel[i3 + 2] *= d;
    this.pos[i3] += this.vel[i3] * dt;
    this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
    this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
    if (this.pos[i3 + 1] < 0.04) {            /* skid along the floor instead of sinking */
      this.pos[i3 + 1] = 0.04;
      this.vel[i3 + 1] *= -0.28;
    }
    const t = this.life[i] / this.max_life[i];
    const fade = t * t;
    this.col[i3] = this.base[i3] * fade;
    this.col[i3 + 1] = this.base[i3 + 1] * fade;
    this.col[i3 + 2] = this.base[i3 + 2] * fade;
    this.siz[i] = this.size0[i] * (0.35 + 0.65 * t);
    i++;
  }
  this.geo.setDrawRange(0, this.count);
  if (this.count > 0) {
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.pcolor.needsUpdate = true;
    this.geo.attributes.psize.needsUpdate = true;
  }
};

/* ===========================================================================
   6 — ARENA
   Floor, conduit grid, boundary walls, ambient motes and one signature
   background feature per theme. All of it is built once and re-tinted when
   the player switches arena.
   ========================================================================= */

function Arena(scene, quality) {
  this.scene = scene;
  this.quality = quality;
  this.group = new THREE.Group();
  scene.add(this.group);
  this.theme = ARENAS[0];
  this.time = 0;
  this.burnRing = 0;
  this._build();
}

Arena.prototype._build = function () {
  const span = GRID * CELL;
  const lo = this.quality === 'low';

  /* --- floor ------------------------------------------------------------- */
  this.floorMat = new THREE.MeshStandardMaterial({
    color: 0x0a1428, roughness: 0.78, metalness: 0.22
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(span, span), this.floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = !lo;
  this.group.add(floor);
  this.floor = floor;

  /* a slightly larger dark apron so the arena reads as a floating plate */
  this.apronMat = new THREE.MeshStandardMaterial({ color: 0x05080f, roughness: 1, metalness: 0 });
  const apron = new THREE.Mesh(new THREE.BoxGeometry(span + 2.6, 0.7, span + 2.6), this.apronMat);
  apron.position.y = -0.36;
  this.group.add(apron);

  /* --- conduit grid: two line sets in one draw call each ----------------- */
  const minor = [], major = [];
  const h = span / 2;
  for (let i = 0; i <= GRID; i++) {
    const p = -h + i * CELL;
    const target = (i % 5 === 0) ? major : minor;
    target.push(-h, 0.012, p, h, 0.012, p);
    target.push(p, 0.012, -h, p, 0.012, h);
  }
  this.gridMinorMat = new THREE.LineBasicMaterial({ color: 0x2e6f9e, transparent: true, opacity: 0.34 });
  this.gridMajorMat = new THREE.LineBasicMaterial({ color: 0x38f0d0, transparent: true, opacity: 0.62 });
  this.gridMinor = new THREE.LineSegments(this._lines(minor), this.gridMinorMat);
  this.gridMajor = new THREE.LineSegments(this._lines(major), this.gridMajorMat);
  this.group.add(this.gridMinor, this.gridMajor);

  /* --- boundary walls ---------------------------------------------------- */
  this.wallMat = new THREE.MeshStandardMaterial({
    color: 0x123253, roughness: 0.42, metalness: 0.55,
    emissive: 0x0a1c30, emissiveIntensity: 1, transparent: true, opacity: 0.92
  });
  this.railMat = new THREE.MeshBasicMaterial({ color: 0x38f0d0, transparent: true, opacity: 0.85 });
  this.walls = [];
  const wallGeo = new THREE.BoxGeometry(span + 1.2, WALL_H, 0.6);
  const railGeo = new THREE.BoxGeometry(span + 1.2, 0.06, 0.72);
  for (let i = 0; i < 4; i++) {
    const w = new THREE.Mesh(wallGeo, this.wallMat);
    const r = new THREE.Mesh(railGeo, this.railMat);
    const rot = i * Math.PI / 2;
    const d = h + 0.3;
    w.position.set(Math.sin(rot) * d, WALL_H / 2 - 0.05, Math.cos(rot) * d);
    w.rotation.y = rot;
    r.position.set(Math.sin(rot) * d, WALL_H - 0.02, Math.cos(rot) * d);
    r.rotation.y = rot;
    if (!lo) w.receiveShadow = true;
    this.group.add(w, r);
    this.walls.push(w, r);
  }

  /* --- corner posts ------------------------------------------------------ */
  this.postMat = new THREE.MeshBasicMaterial({ color: 0x38f0d0 });
  this.posts = [];
  for (let i = 0; i < 4; i++) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, WALL_H + 0.8, 0.5), this.postMat);
    post.position.set((i % 2 ? 1 : -1) * (h + 0.3), (WALL_H + 0.8) / 2 - 0.05, (i < 2 ? 1 : -1) * (h + 0.3));
    this.group.add(post);
    this.posts.push(post);
    const halo = Assets.glowSprite(0x38f0d0, 3.2, 0.5);
    halo.position.copy(post.position);
    halo.position.y = WALL_H;
    this.group.add(halo);
    this.posts.push(halo);
  }

  /* --- burn frame used by Endless when the arena closes in --------------- */
  this.burnMat = new THREE.MeshBasicMaterial({
    color: 0xff3355, transparent: true, opacity: 0.34, depthWrite: false
  });
  this.burnFrame = new THREE.Group();
  this.burnPlates = [];
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 1), this.burnMat);
    p.position.y = 0.03;
    this.burnFrame.add(p);
    this.burnPlates.push(p);
  }
  this.burnFrame.visible = false;
  this.group.add(this.burnFrame);

  /* --- ambient motes ----------------------------------------------------- */
  const moteCount = lo ? 70 : (this.quality === 'medium' ? 140 : 240);
  const mp = new Float32Array(moteCount * 3);
  const ms = new Float32Array(moteCount);
  this.moteSeed = new Float32Array(moteCount);
  for (let i = 0; i < moteCount; i++) {
    mp[i * 3] = rnd(-h - 3, h + 3);
    mp[i * 3 + 1] = rnd(0.2, 12);
    mp[i * 3 + 2] = rnd(-h - 3, h + 3);
    ms[i] = rnd(0.10, 0.34);
    this.moteSeed[i] = Math.random() * 100;
  }
  const mgeo = new THREE.BufferGeometry();
  mgeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  mgeo.setAttribute('psize', new THREE.BufferAttribute(ms, 1));
  const mcol = new Float32Array(moteCount * 3);
  for (let i = 0; i < moteCount * 3; i++) mcol[i] = 1;
  mgeo.setAttribute('pcolor', new THREE.BufferAttribute(mcol, 3));
  this.moteGeo = mgeo;
  this.moteMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: Assets.tex.spark }, uScale: { value: 1 }, uTint: { value: new THREE.Color(0x7fd8ff) } },
    vertexShader: [
      'attribute float psize;',
      'uniform float uScale;',
      'varying float vF;',
      'void main(){',
      '  vec4 mv = modelViewMatrix * vec4(position,1.0);',
      '  vF = clamp(1.0 - (-mv.z) / 90.0, 0.0, 1.0);',
      '  gl_PointSize = psize * uScale * (260.0 / max(0.001,-mv.z));',
      '  gl_Position = projectionMatrix * mv;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D uTex;',
      'uniform vec3 uTint;',
      'varying float vF;',
      'void main(){',
      '  vec4 t = texture2D(uTex, gl_PointCoord);',
      '  if (t.a < 0.02) discard;',
      '  gl_FragColor = vec4(uTint * t.a * vF, t.a * vF * 0.85);',
      '}'
    ].join('\n'),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  this.motes = new THREE.Points(mgeo, this.moteMat);
  this.motes.frustumCulled = false;
  this.group.add(this.motes);
  this.motePos = mp;
  this.moteCount = moteCount;

  /* --- background feature slots ----------------------------------------- */
  this.feature = new THREE.Group();
  this.group.add(this.feature);
  this.featureKind = null;

  /* --- lights ----------------------------------------------------------- */
  this.hemi = new THREE.HemisphereLight(0x3d7fbf, 0x08101d, 0.85);
  this.scene.add(this.hemi);
  this.sun = new THREE.DirectionalLight(0xdaf2ff, 0.85);
  this.sun.position.set(9, 20, 7);
  if (!lo) {
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.width = s.mapSize.height = (this.quality === 'high' ? 1024 : 512);
    s.camera.left = -16; s.camera.right = 16; s.camera.top = 16; s.camera.bottom = -16;
    s.camera.near = 1; s.camera.far = 46;
    s.bias = -0.0018;
    s.radius = 2;
  }
  this.scene.add(this.sun);
  this.scene.add(this.sun.target);
};

Arena.prototype._lines = function (arr) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  return g;
};

Arena.prototype.applyTheme = function (id) {
  let t = ARENAS[0];
  for (let i = 0; i < ARENAS.length; i++) if (ARENAS[i].id === id) t = ARENAS[i];
  this.theme = t;

  this.floorMat.color.setHex(t.floor);
  this.gridMinorMat.color.setHex(t.line);
  this.gridMajorMat.color.setHex(t.glow);
  this.wallMat.color.setHex(t.wall);
  this.wallMat.emissive.setHex(t.wall);
  this.wallMat.emissiveIntensity = 0.55;
  this.railMat.color.setHex(t.glow);
  this.postMat.color.setHex(t.glow);
  for (let i = 0; i < this.posts.length; i++) {
    if (this.posts[i].isSprite) this.posts[i].material.color.setHex(t.glow);
  }
  this.hemi.color.setHex(t.hemiSky);
  this.hemi.groundColor.setHex(t.hemiGnd);
  this.sun.color.setHex(t.sun);
  this.sun.intensity = t.sunI;
  this.moteMat.uniforms.uTint.value.setHex(t.mote);

  this.scene.fog = new THREE.FogExp2(t.fog, t.fogD);
  this.scene.background = new THREE.Color(t.bg);

  this._buildFeature(t.feature);
};

Arena.prototype._buildFeature = function (kind) {
  if (this.featureKind === kind) return;
  this.featureKind = kind;
  /* dispose the previous feature so switching themes cannot leak buffers */
  for (let i = this.feature.children.length - 1; i >= 0; i--) {
    const c = this.feature.children[i];
    this.feature.remove(c);
    if (c.geometry && c.geometry.dispose) c.geometry.dispose();
    if (c.material && c.material.dispose) c.material.dispose();
  }
  this.featureNodes = [];
  const t = this.theme;
  const h = GRID * CELL / 2;

  if (kind === 'skyline') {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x05020a, roughness: 0.8, metalness: 0.9,
      emissive: t.glow, emissiveIntensity: 0.35
    });
    const wireMat = new THREE.MeshBasicMaterial({ color: t.glow, wireframe: true, transparent: true, opacity: 0.25 });
    const n = this.quality === 'low' ? 20 : 45; 
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(-0.15, 0.15);
      const d = rnd(h + 8, h + 45); 
      const hh = rnd(12, 45); 
      const w = rnd(2.5, 7.5);
      const g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, hh, w), mat);
      b.position.set(0, hh / 2 - 4, 0);
      g.add(b);
      if (i % 3 === 0) {
        const wire = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, hh + 0.2, w + 0.2), wireMat);
        wire.position.set(0, hh / 2 - 4, 0);
        g.add(wire);
      }
      g.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
      this.feature.add(g);
    }
  } else if (kind === 'stars') {
    const n = this.quality === 'low' ? 400 : 1200; 
    const p = new Float32Array(n * 3);
    const s = new Float32Array(n);
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(clamp(1 - 2 * Math.random(), -1, 1));
      const r = rnd(50, 120);
      p[i * 3] = Math.sin(ph) * Math.cos(th) * r;
      p[i * 3 + 1] = Math.abs(Math.cos(ph)) * r * 0.8 + 2;
      p[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * r;
      s[i] = rnd(0.8, 3.5);
      const w = rnd(0.5, 1);
      c[i * 3] = w; c[i * 3 + 1] = w * rnd(0.8, 1); c[i * 3 + 2] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('psize', new THREE.BufferAttribute(s, 1));
    g.setAttribute('pcolor', new THREE.BufferAttribute(c, 3));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: Assets.tex.spark } },
      vertexShader: [
        'attribute float psize; attribute vec3 pcolor; varying vec3 vC;',
        'void main(){ vC = pcolor; vec4 mv = modelViewMatrix * vec4(position,1.0);',
        ' gl_PointSize = psize * (300.0 / max(0.001,-mv.z)); gl_Position = projectionMatrix * mv; }'
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D uTex; varying vec3 vC;',
        'void main(){ vec4 t = texture2D(uTex, gl_PointCoord); if(t.a<0.02) discard;',
        ' gl_FragColor = vec4(vC * t.a, t.a); }'
      ].join('\n'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const stars = new THREE.Points(g, m);
    stars.frustumCulled = false;
    this.feature.add(stars);
    
    const planetMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: t.glow, emissiveIntensity: 0.8, roughness: 0.1 });
    for(let i=0; i<3; i++) {
        const planet = new THREE.Mesh(new THREE.SphereGeometry(rnd(8, 25), 16, 16), planetMat);
        const a = (i/3) * Math.PI*2 + rnd(0, 1);
        const pd = rnd(80, 110);
        planet.position.set(Math.cos(a)*pd, rnd(10, 40), Math.sin(a)*pd);
        this.feature.add(planet);
        this.featureNodes.push({ node: planet, spin: rnd(0.01, 0.05), bob: 0, phase: 0 });
    }
  } else if (kind === 'rings') {
    const mat = new THREE.MeshBasicMaterial({ color: t.glow, transparent: true, opacity: 0.35, wireframe: true });
    const solidMat = new THREE.MeshStandardMaterial({ color: 0x110416, emissive: t.glow, emissiveIntensity: 0.5, metalness: 1 });
    for (let i = 0; i < 7; i++) {
      const isWire = i % 2 === 0;
      const r = new THREE.Mesh(new THREE.TorusGeometry(h + 12 + i * 14, isWire ? 0.3 : 1.5, 6, 80), isWire ? mat : solidMat);
      r.rotation.x = Math.PI / 2 + rnd(-0.5, 0.5);
      r.rotation.y = rnd(-0.2, 0.2);
      r.position.y = -5 + i * 4;
      this.feature.add(r);
      this.featureNodes.push({ node: r, spin: (i%2===0?1:-1) * rnd(0.1, 0.3) });
    }
  } else if (kind === 'pipes') {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x061c0a, roughness: 0.4, metalness: 0.8, emissive: t.glow, emissiveIntensity: 0.4
    });
    const fluidMat = new THREE.MeshBasicMaterial({ color: t.glow, transparent: true, opacity: 0.6 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const d = h + rnd(6, 15);
      const g = new THREE.Group();
      const p = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, GRID + 20, 12), mat);
      const fluid = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, GRID + 20, 8, 1, true), fluidMat);
      g.add(p, fluid);
      g.rotation.z = Math.PI / 2;
      g.rotation.y = a;
      g.position.set(Math.sin(a) * d, rnd(2, 12), Math.cos(a) * d);
      this.feature.add(g);
      this.featureNodes.push({ node: g, spin: 0, bob: rnd(0.5, 1.5), phase: rnd(0, 6) });
    }
  } else if (kind === 'embers') {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x110200, roughness: 1.0, metalness: 0.1, emissive: 0xff8800, emissiveIntensity: 1.2
    });
    for (let i = 0; i < 25; i++) {
      const a = (i / 25) * Math.PI * 2;
      const d = rnd(h + 8, h + 30);
      const b = new THREE.Mesh(new THREE.BoxGeometry(rnd(4, 12), rnd(0.8, 3.0), rnd(4, 12)), mat);
      b.position.set(Math.cos(a) * d, rnd(-5, 8), Math.sin(a) * d);
      b.rotation.set(rnd(0, 3), rnd(0, 3), rnd(0, 3));
      this.feature.add(b);
      this.featureNodes.push({ node: b, spin: rnd(-0.05, 0.05), bob: rnd(0.5, 2.0), phase: rnd(0, 6.2) });
    }
  } else if (kind === 'synth_sun') {
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xff00ff });
    const sun = new THREE.Mesh(new THREE.SphereGeometry(35, 32, 24), sunMat);
    sun.position.set(0, 12, -h - 60);
    sun.scale.set(1, 1, 0.2); 
    this.feature.add(sun);
    this.featureNodes.push({ node: sun, spin: 0.0, bob: 0.5, phase: 0 }); 

    const mtnMat = new THREE.MeshBasicMaterial({ color: 0x00e6ff, wireframe: true });
    for (let i = -8; i <= 8; i++) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(rnd(15, 30), rnd(20, 45), 4), mtnMat);
      m.position.set(i * 18 + rnd(-5, 5), rnd(2, 10), -h - 40 + rnd(-10, 10));
      m.rotation.y = Math.PI / 4;
      this.feature.add(m);
    }
  } else if (kind === 'ice_crystals') {
    const iceMat = new THREE.MeshStandardMaterial({
      color: 0x00ffff, emissive: 0x00aaff, emissiveIntensity: 0.8,
      roughness: 0.0, metalness: 0.5, transparent: true, opacity: 0.9
    });
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2 + rnd(-0.1, 0.1);
      const d = rnd(h + 10, h + 35);
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(rnd(2.5, 6.0), 0), iceMat);
      c.scale.set(1, rnd(3.0, 7.0), 1);
      c.position.set(Math.cos(a) * d, rnd(0, 15), Math.sin(a) * d);
      c.rotation.set(rnd(-0.4, 0.4), rnd(0, 3), rnd(-0.4, 0.4));
      this.feature.add(c);
      this.featureNodes.push({ node: c, spin: rnd(-0.08, 0.08), bob: rnd(0.2, 0.6), phase: rnd(0, 6.2) });
    }
  } else if (kind === 'matrix_rain') {
    const matMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true, transparent: true, opacity: 0.7 });
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 + rnd(-0.2, 0.2);
      const d = rnd(h + 12, h + 40);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, rnd(30, 60), 4, 12, true), matMat);
      col.position.set(Math.cos(a) * d, rnd(0, 20), Math.sin(a) * d);
      this.feature.add(col);
      this.featureNodes.push({ node: col, spin: rnd(-0.1, 0.1), bob: 4.0, phase: rnd(0, 6.2) });
    }
  } else if (kind === 'monoliths') {
    const monoMat = new THREE.MeshStandardMaterial({
      color: 0x110701, roughness: 0.2, metalness: 0.9, emissive: 0xffaa00, emissiveIntensity: 0.6
    });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const d = rnd(h + 12, h + 35);
      const m = new THREE.Mesh(new THREE.BoxGeometry(rnd(4, 8), rnd(25, 60), rnd(4, 8)), monoMat);
      m.position.set(Math.cos(a) * d, rnd(5, 20), Math.sin(a) * d);
      m.rotation.y = a + Math.PI / 4;
      this.feature.add(m);
      this.featureNodes.push({ node: m, spin: 0, bob: rnd(0.2, 0.8), phase: a });
    }
  } else if (kind === 'abyss_bubbles') {
    const bubMat = new THREE.MeshStandardMaterial({
      color: 0x00ffff, emissive: 0x0088ff, emissiveIntensity: 1.0,
      transparent: true, opacity: 0.8, roughness: 0.0, metalness: 0.2
    });
    for (let i = 0; i < 45; i++) {
      const a = (i / 45) * Math.PI * 2 + rnd(-0.2, 0.2);
      const d = rnd(h + 8, h + 35);
      const b = new THREE.Mesh(new THREE.SphereGeometry(rnd(1.5, 4.5), 16, 16), bubMat);
      b.position.set(Math.cos(a) * d, rnd(-10, 30), Math.sin(a) * d);
      this.feature.add(b);
      this.featureNodes.push({ node: b, spin: rnd(-0.1, 0.1), bob: rnd(1.5, 3.5), phase: rnd(0, 6.2) });
    }
  } else if (kind === 'alien_spires') {
    const spireMat = new THREE.MeshStandardMaterial({
      color: 0x1a042b, roughness: 0.8, metalness: 0.2, emissive: 0xaa22ff, emissiveIntensity: 0.5
    });
    const podMat = new THREE.MeshStandardMaterial({
      color: 0xccff00, emissive: 0xccff00, emissiveIntensity: 1.5, roughness: 0.1
    });
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2 + rnd(-0.1, 0.1);
      const d = rnd(h + 10, h + 35);
      const hH = rnd(15, 35);
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.5, rnd(2.0, 4.0), hH, 12), spireMat);
      s.position.set(Math.cos(a) * d, hH / 2 - 4, Math.sin(a) * d);
      s.rotation.z = rnd(-0.25, 0.25);
      s.rotation.x = rnd(-0.25, 0.25);
      const pod = new THREE.Mesh(new THREE.SphereGeometry(rnd(2.0, 3.5), 12, 12), podMat);
      pod.position.y = hH / 2;
      s.add(pod);
      this.feature.add(s);
      this.featureNodes.push({ node: s, spin: 0, bob: rnd(0.3, 0.8), phase: a });
    }
  } else if (kind === 'shrine_gate') {
    const gateMat = new THREE.MeshStandardMaterial({
      color: 0x220308, roughness: 0.2, metalness: 0.7, emissive: 0xff0022, emissiveIntensity: 0.7
    });
    const g = new THREE.Group();
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(3, 40, 3), gateMat);
    p1.position.set(-16, 18, 0);
    const p2 = new THREE.Mesh(new THREE.BoxGeometry(3, 40, 3), gateMat);
    p2.position.set(16, 18, 0);
    const beam1 = new THREE.Mesh(new THREE.BoxGeometry(42, 3, 3.5), gateMat);
    beam1.position.set(0, 34, 0);
    const beam2 = new THREE.Mesh(new THREE.BoxGeometry(36, 2, 2.5), gateMat);
    beam2.position.set(0, 27, 0);
    g.add(p1, p2, beam1, beam2);
    g.position.set(0, 0, -h - 35);
    this.feature.add(g);
    this.featureNodes.push({ node: g, spin: 0, bob: 0.2, phase: 0 });

    const lanMat = new THREE.MeshBasicMaterial({ color: 0xff0022 });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const d = rnd(h + 12, h + 28);
      const lan = new THREE.Mesh(new THREE.OctahedronGeometry(2.0, 0), lanMat);
      lan.position.set(Math.cos(a) * d, rnd(6, 18), Math.sin(a) * d);
      this.feature.add(lan);
      this.featureNodes.push({ node: lan, spin: rnd(-0.3, 0.3), bob: rnd(0.6, 1.4), phase: a });
    }
  } else if (kind === 'warp_tunnel') {
    const warpMat = new THREE.MeshBasicMaterial({ color: 0xaa00ff, transparent: true, opacity: 0.6, wireframe: true });
    for (let i = 0; i < 12; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(h + 8 + i * 12, 1.2, 8, 64), warpMat);
      ring.position.y = i * 4;
      ring.rotation.x = Math.PI / 2 + rnd(-0.15, 0.15);
      this.feature.add(ring);
      this.featureNodes.push({ node: ring, spin: (i % 2 === 0 ? 1 : -1) * rnd(0.8, 1.6) });
    }
  } else if (kind === 'blood_moon') {
    const moonMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const moon = new THREE.Mesh(new THREE.SphereGeometry(45, 32, 24), moonMat);
    moon.position.set(0, 25, -h - 70);
    moon.scale.set(1, 1, 0.3);
    this.feature.add(moon);
    this.featureNodes.push({ node: moon, spin: 0.02 });

    const shardMat = new THREE.MeshStandardMaterial({
      color: 0x140003, roughness: 0.9, metalness: 0.1, emissive: 0xff0011, emissiveIntensity: 0.5
    });
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const d = rnd(h + 12, h + 40);
      const sh = new THREE.Mesh(new THREE.DodecahedronGeometry(rnd(3, 8), 0), shardMat);
      sh.position.set(Math.cos(a) * d, rnd(8, 25), Math.sin(a) * d);
      this.feature.add(sh);
      this.featureNodes.push({ node: sh, spin: rnd(-0.3, 0.3), bob: rnd(0.5, 1.5), phase: a });
    }
  } else if (kind === 'aurora_waves') {
    const aurMat = new THREE.MeshBasicMaterial({
      color: 0x00ffcc, wireframe: true, transparent: true, opacity: 0.5
    });
    for (let i = 0; i < 8; i++) {
      const ribbon = new THREE.Mesh(new THREE.CylinderGeometry(h + 15 + i * 10, h + 22 + i * 10, 16, 32, 3, true), aurMat);
      ribbon.position.y = 15 + i * 5;
      this.feature.add(ribbon);
      this.featureNodes.push({ node: ribbon, spin: (i % 2 === 0 ? 0.15 : -0.15), bob: 0.8, phase: i });
    }
  }
};

/* r rings of the arena edge are lethal (Endless) */
Arena.prototype.setBurn = function (r) {
  this.burnRing = r;
  this.burnFrame.visible = r > 0;
  if (r <= 0) return;
  const span = GRID * CELL;
  const thick = Math.min(r * CELL, span / 2);
  const inner = Math.max(0.001, span - thick * 2);   /* untouched middle */
  const off = span / 2 - thick / 2;                  /* band centre offset */
  const plates = this.burnPlates;
  plates[0].scale.set(span, 1, thick); plates[0].position.set(0, 0.03, -off);
  plates[1].scale.set(span, 1, thick); plates[1].position.set(0, 0.03, off);
  plates[2].scale.set(thick, 1, inner); plates[2].position.set(-off, 0.03, 0);
  plates[3].scale.set(thick, 1, inner); plates[3].position.set(off, 0.03, 0);
};

Arena.prototype.update = function (dt, elapsed) {
  this.time += dt;
  const pulse = 0.5 + 0.5 * Math.sin(this.time * 1.6);
  this.gridMajorMat.opacity = 0.42 + pulse * 0.34;
  this.railMat.opacity = 0.6 + pulse * 0.3;
  this.burnMat.opacity = 0.22 + pulse * 0.22;

  /* motes drift upward and wrap, cheap enough to do on the CPU */
  const h = GRID * CELL / 2 + 3;
  const p = this.motePos;
  for (let i = 0; i < this.moteCount; i++) {
    const i3 = i * 3;
    const seed = this.moteSeed[i];
    p[i3 + 1] += dt * (0.35 + (seed % 7) * 0.09);
    p[i3] += Math.sin(this.time * 0.5 + seed) * dt * 0.22;
    p[i3 + 2] += Math.cos(this.time * 0.42 + seed * 1.3) * dt * 0.22;
    if (p[i3 + 1] > 13) {
      p[i3 + 1] = 0.2;
      p[i3] = rnd(-h, h);
      p[i3 + 2] = rnd(-h, h);
    }
  }
  this.moteGeo.attributes.position.needsUpdate = true;

  if (this.featureNodes) {
    for (let i = 0; i < this.featureNodes.length; i++) {
      const f = this.featureNodes[i];
      if (f.spin) f.node.rotation.z += f.spin * dt;
      if (f.bob) f.node.position.y += Math.sin(elapsed * 0.7 + f.phase) * dt * f.bob;
    }
  }
};
