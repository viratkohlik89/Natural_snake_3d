
/* ===========================================================================
   10 — OBSTACLES
   Six hazard types share one mesh pool, so changing level or restarting never
   allocates. Danger is resolved on the grid at step time, which is what keeps
   collisions honest — and every mesh is drawn on the cells it actually
   occupies, so nothing ever kills you from a place it does not look like.

     block    never moves, always solid
     patrol   slides one cell per beat along a lane, bounces at the ends
     laser    rest -> charge -> fire, only bites while firing
     spinner  an arm snaps 45 degrees per beat around a pivot
     pad      2x2 plate that pulses on and off
     spike    single cell that rises and falls on a beat
   ========================================================================= */

/* the eight arm headings a spinner can point along */
const SPIN_DIRS = [
  { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: -1, y: 1 },
  { x: -1, y: 0 }, { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 }
];

function ObstacleManager(scene, particles) {
  this.scene = scene;
  this.ps = particles;
  this.group = new THREE.Group();
  scene.add(this.group);
  this.list = [];
  this.lethalSet = new Set();
  this.blockedSet = new Set();
  this.step = 0;
  this.frozen = false;
  this.reserved = null;     /* cells the level generator must leave clear   */
  this.guard = null;        /* extra veto used while the game is running    */

  this.mats = {
    block: new THREE.MeshStandardMaterial({ color: 0x2b3550, emissive: 0x1b3a5c, emissiveIntensity: 0.35, roughness: 0.55, metalness: 0.6 }),
    patrol: new THREE.MeshStandardMaterial({ color: 0x4a3520, emissive: 0xff9b3d, emissiveIntensity: 0.95, roughness: 0.4, metalness: 0.6 }),
    emitter: new THREE.MeshStandardMaterial({ color: 0x3a1c28, emissive: 0xff2e64, emissiveIntensity: 0.85, roughness: 0.4, metalness: 0.7 }),
    beam: new THREE.MeshBasicMaterial({ color: 0xff2e64, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    arm: new THREE.MeshStandardMaterial({ color: 0x2b2447, emissive: 0x8b5cff, emissiveIntensity: 1.0, roughness: 0.35, metalness: 0.7 }),
    pad: new THREE.MeshBasicMaterial({ color: 0x38d0ff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }),
    spike: new THREE.MeshStandardMaterial({ color: 0x39405a, emissive: 0xcfd8ff, emissiveIntensity: 0.4, roughness: 0.3, metalness: 0.8 })
  };
  this.baseEmissive = {};
  for (const k in this.mats) {
    if (this.mats[k].emissive) this.baseEmissive[k] = this.mats[k].emissive.getHex();
  }
  this.pool = {};
  this.glowPool = [];
}

/* ---- mesh pool ----------------------------------------------------------
   Meshes are keyed by shape + material. Anything that needs to animate its
   own opacity asks for a private material clone, otherwise two lasers on
   different cycles would overwrite each other every frame.               */
ObstacleManager.prototype._geo = function (kind) {
  switch (kind) {
    case 'plate': return Assets.geo.plate;
    case 'spike': return Assets.geo.spike;
    case 'pivot': return Assets.geo.cyl;
    default: return Assets.geo.box;
  }
};

ObstacleManager.prototype._take = function (kind, matName, unique) {
  const key = kind + '|' + matName + (unique ? '|u' : '');
  if (!this.pool[key]) this.pool[key] = [];
  let m = this.pool[key].pop();
  if (!m) {
    const mat = unique ? this.mats[matName].clone() : this.mats[matName];
    m = new THREE.Mesh(this._geo(kind), mat);
    m.castShadow = (Assets.quality !== 'low') && (matName === 'block' || matName === 'patrol' || matName === 'arm' || matName === 'spike');
    m.receiveShadow = false;
    m._poolKey = key;
    this.group.add(m);
  }
  m.visible = true;
  m.scale.set(1, 1, 1);
  m.rotation.set(0, 0, 0);
  return m;
};

ObstacleManager.prototype._release = function (m) {
  m.visible = false;
  if (m.parent !== this.group) this.group.add(m);
  if (!this.pool[m._poolKey]) this.pool[m._poolKey] = [];
  this.pool[m._poolKey].push(m);
};

ObstacleManager.prototype._takeGlow = function (color) {
  let s = this.glowPool.pop();
  if (!s) { s = Assets.glowSprite(0xffffff, 2.2, 0.55); this.group.add(s); }
  s.visible = true;
  s.material.color.setHex(color);
  return s;
};

/* ---- placement rules ---------------------------------------------------- */
ObstacleManager.prototype.setReserved = function (fn) { this.reserved = fn; };

ObstacleManager.prototype._cellFree = function (x, y) {
  if (!inBounds(x, y)) return false;
  if (this.reserved && this.reserved(x, y)) return false;
  if (this.blockedSet.has(cellKey(x, y))) return false;
  if (this.guard && !this.guard(x, y)) return false;
  return true;
};

ObstacleManager.prototype._cellsFree = function (cells) {
  for (let i = 0; i < cells.length; i++) {
    if (!this._cellFree(cells[i].x, cells[i].y)) return false;
  }
  return true;
};

ObstacleManager.prototype._claim = function (cells) {
  for (let i = 0; i < cells.length; i++) this.blockedSet.add(cellKey(cells[i].x, cells[i].y));
};

/* ---- constructors ------------------------------------------------------- */
ObstacleManager.prototype.addBlock = function (x, y) {
  if (!this._cellFree(x, y)) return null;
  const m = this._take('box', 'block');
  m.position.set(worldX(x), 0.5, worldZ(y));
  m.scale.set(0.94, 1, 0.94);
  const o = { type: 'block', cells: [{ x: x, y: y }], meshes: [m] };
  this.list.push(o);
  this._claim(o.cells);
  return o;
};

ObstacleManager.prototype.addPatrol = function (x, y, dx, dy, span, period) {
  if (!this._cellFree(x, y)) return null;
  const m = this._take('box', 'patrol');
  m.position.set(worldX(x), 0.5, worldZ(y));
  m.scale.set(0.84, 0.84, 0.84);
  const o = {
    type: 'patrol', cells: [{ x: x, y: y }], meshes: [m], glow: this._takeGlow(0xff9b3d),
    x: x, y: y, px: x, py: y, dx: dx, dy: dy, span: Math.max(1, span || 5),
    ox: x, oy: y, period: Math.max(1, period || 2), back: false, moveStep: -99
  };
  this.list.push(o);
  this._claim(o.cells);
  return o;
};

ObstacleManager.prototype.addLaser = function (x, y, horizontal, len, period, offset) {
  const lane = [];
  for (let i = 0; i < len; i++) {
    const cx = horizontal ? x + i : x;
    const cy = horizontal ? y : y + i;
    if (!inBounds(cx, cy)) break;
    lane.push({ x: cx, y: cy });
  }
  if (lane.length < 3) return null;
  if (!this._cellsFree(lane)) return null;

  const first = lane[0], last = lane[lane.length - 1];
  const a = this._take('box', 'emitter');
  const b = this._take('box', 'emitter');
  const beam = this._take('box', 'beam', true);
  a.position.set(worldX(first.x), 0.42, worldZ(first.y));
  a.scale.set(0.72, 0.84, 0.72);
  b.position.set(worldX(last.x), 0.42, worldZ(last.y));
  b.scale.set(0.72, 0.84, 0.72);
  const span = lane.length - 1;
  beam.position.set(worldX((first.x + last.x) / 2), 0.5, worldZ((first.y + last.y) / 2));

  const o = {
    type: 'laser', cells: lane.slice(1, lane.length - 1), meshes: [a, b, beam],
    beam: beam, emitters: [first, last], horizontal: !!horizontal, span: span,
    period: Math.max(5, period || 9), offset: offset || 0, phase: 'rest'
  };
  this.list.push(o);
  this._claim(lane);
  return o;
};

ObstacleManager.prototype.addSpinner = function (x, y, arm, period, dir) {
  arm = clamp(arm || 2, 1, 4);
  const claim = [{ x: x, y: y }];
  /* reserve the whole disc the arm can sweep through, so nothing else lands
     inside a spinner and becomes unreachable */
  for (let p = 0; p < 8; p++) {
    for (let i = 1; i <= arm; i++) {
      claim.push({ x: x + SPIN_DIRS[p].x * i, y: y + SPIN_DIRS[p].y * i });
    }
  }
  for (let i = 0; i < claim.length; i++) {
    const c = claim[i];
    if (!inBounds(c.x, c.y)) continue;                 /* clipped arms are fine */
    if (!this._cellFree(c.x, c.y)) return null;
  }

  const pivot = this._take('pivot', 'block');
  pivot.position.set(worldX(x), 0.3, worldZ(y));
  pivot.scale.set(0.55, 0.6, 0.55);
  const meshes = [pivot];
  const armMeshes = [];
  for (let i = 1; i <= arm; i++) {
    const m = this._take('box', 'arm');
    m.scale.set(0.78, 0.78, 0.78);
    meshes.push(m);
    armMeshes.push(m);
  }
  const o = {
    type: 'spinner', cells: [], meshes: meshes, armMeshes: armMeshes,
    cx: x, cy: y, arm: arm, phase: rndInt(0, 7), prevPhase: 0,
    period: Math.max(1, period || 2), dir: (dir || 1) < 0 ? -1 : 1, moveStep: -99,
    /* the whole disc stays reserved so pickups never land inside the sweep */
    claim: claim.filter(function (p) { return inBounds(p.x, p.y); })
  };
  o.prevPhase = o.phase;
  this.list.push(o);
  this._spinnerCells(o);
  this._claim(o.claim);
  return o;
};

ObstacleManager.prototype.addPad = function (x, y, period, offset) {
  const cells = [];
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) cells.push({ x: x + i, y: y + j });
  }
  for (let i = 0; i < cells.length; i++) {
    if (!inBounds(cells[i].x, cells[i].y)) return null;
  }
  if (!this._cellsFree(cells)) return null;
  const m = this._take('plate', 'pad', true);
  m.position.set(worldX(x) + CELL / 2, 0.06, worldZ(y) + CELL / 2);
  m.scale.set(1.94, 1, 1.94);
  const o = {
    type: 'pad', cells: cells, meshes: [m], plate: m,
    period: Math.max(4, period || 8), offset: offset || 0, on: false
  };
  this.list.push(o);
  this._claim(cells);
  return o;
};

ObstacleManager.prototype.addSpike = function (x, y, period, offset) {
  if (!this._cellFree(x, y)) return null;
  const m = this._take('spike', 'spike');
  m.position.set(worldX(x), -0.55, worldZ(y));
  const o = {
    type: 'spike', cells: [{ x: x, y: y }], meshes: [m], spike: m,
    period: Math.max(4, period || 6), offset: offset || 0, on: false
  };
  this.list.push(o);
  this._claim(o.cells);
  return o;
};

/* ---- teardown ----------------------------------------------------------- */
ObstacleManager.prototype.clear = function () {
  for (let i = 0; i < this.list.length; i++) {
    const o = this.list[i];
    for (let j = 0; j < o.meshes.length; j++) this._release(o.meshes[j]);
    if (o.glow) { o.glow.visible = false; this.glowPool.push(o.glow); }
  }
  this.list.length = 0;
  this.lethalSet.clear();
  this.blockedSet.clear();
  this.step = 0;
  this.guard = null;
  this.setFrozen(false);
};

/* ---- the moving parts --------------------------------------------------- */
ObstacleManager.prototype._spinnerCells = function (o) {
  o.cells.length = 0;
  const d = SPIN_DIRS[o.phase];
  for (let i = 1; i <= o.arm; i++) {
    const gx = o.cx + d.x * i, gy = o.cy + d.y * i;
    if (inBounds(gx, gy)) o.cells.push({ x: gx, y: gy });
  }
};

/* one simulation beat, then rebuild the danger map */
ObstacleManager.prototype.stepUpdate = function () {
  if (!this.frozen) {
    this.step++;
    const step = this.step;
    for (let i = 0; i < this.list.length; i++) {
      const o = this.list[i];
      switch (o.type) {
        case 'patrol':
          if (step % o.period === 0) {
            o.px = o.x; o.py = o.y;
            const nx = o.x + (o.back ? -o.dx : o.dx);
            const ny = o.y + (o.back ? -o.dy : o.dy);
            const beyond = Math.abs(nx - o.ox) > o.span || Math.abs(ny - o.oy) > o.span;
            if (!inBounds(nx, ny) || beyond || this._immovableAt(nx, ny)) {
              o.back = !o.back;                        /* turn round in place */
            } else {
              o.x = nx; o.y = ny;
            }
            o.cells[0].x = o.x; o.cells[0].y = o.y;
            o.moveStep = step;
          }
          break;
        case 'laser': {
          const p = (step + o.offset) % o.period;
          o.phase = (p === o.period - 1) ? 'charge' : (p < 2 ? 'fire' : 'rest');
          break;
        }
        case 'spinner':
          if (step % o.period === 0) {
            o.prevPhase = o.phase;
            o.phase = (o.phase + o.dir + 8) % 8;
            this._spinnerCells(o);
            o.moveStep = step;
          }
          break;
        case 'pad': {
          const p = (step + o.offset) % o.period;
          o.on = p < Math.max(2, Math.floor(o.period * 0.375));
          break;
        }
        case 'spike': {
          const p = (step + o.offset) % o.period;
          o.on = p < Math.max(2, Math.floor(o.period * 0.45));
          break;
        }
      }
    }
  }
  this._rebuild();
};

/* things a patrol cannot push through */
ObstacleManager.prototype._immovableAt = function (x, y) {
  for (let i = 0; i < this.list.length; i++) {
    const o = this.list[i];
    if (o.type === 'block' && o.cells[0].x === x && o.cells[0].y === y) return true;
    if (o.type === 'laser') {
      for (let j = 0; j < o.emitters.length; j++) {
        if (o.emitters[j].x === x && o.emitters[j].y === y) return true;
      }
    }
    if (o.type === 'spinner' && o.cx === x && o.cy === y) return true;
  }
  return false;
};

ObstacleManager.prototype._rebuild = function () {
  this.lethalSet.clear();
  this.blockedSet.clear();
  for (let i = 0; i < this.list.length; i++) {
    const o = this.list[i];
    const live =
      o.type === 'block' || o.type === 'patrol' || o.type === 'spinner' ||
      (o.type === 'laser' && o.phase === 'fire') ||
      (o.type === 'pad' && o.on) ||
      (o.type === 'spike' && o.on);
    for (let j = 0; j < o.cells.length; j++) {
      const k = cellKey(o.cells[j].x, o.cells[j].y);
      this.blockedSet.add(k);
      if (live) this.lethalSet.add(k);
    }
    if (o.type === 'laser') {
      for (let j = 0; j < o.emitters.length; j++) {
        const k = cellKey(o.emitters[j].x, o.emitters[j].y);
        this.blockedSet.add(k);
        this.lethalSet.add(k);
      }
    }
    if (o.type === 'spinner') this._claim(o.claim);
  }
};

ObstacleManager.prototype.lethalAt = function (x, y) { return this.lethalSet.has(cellKey(x, y)); };
ObstacleManager.prototype.blockedAt = function (x, y) { return this.blockedSet.has(cellKey(x, y)); };
ObstacleManager.prototype.count = function () { return this.list.length; };

/* Time Freeze holds every cycle where it stands. Frozen hazards stay lethal,
   they just stop changing, and everything turns ice-blue so it reads. */
ObstacleManager.prototype.setFrozen = function (on) {
  on = !!on;
  if (this.frozen === on) return;
  this.frozen = on;
  for (const k in this.mats) {
    const m = this.mats[k];
    if (!m.emissive) continue;
    if (on) m.emissive.setHex(0x9fe8ff);
    else m.emissive.setHex(this.baseEmissive[k]);
  }
};

/* ---- per-frame visuals -------------------------------------------------
   stepT is progress through the current beat, 0..1. Movers slide over one
   beat and then hold, which matches how the snake itself is drawn.      */
ObstacleManager.prototype.update = function (dt, elapsed, stepT) {
  const frozen = this.frozen;
  for (let i = 0; i < this.list.length; i++) {
    const o = this.list[i];
    switch (o.type) {
      case 'patrol': {
        const beats = (this.step - o.moveStep) + stepT;
        const t = frozen ? 1 : clamp(beats, 0, 1);
        const e = smoothstep(t);
        const m = o.meshes[0];
        m.position.set(
          worldX(lerp(o.px, o.x, e)),
          0.5 + Math.sin(elapsed * 3 + i) * 0.05,
          worldZ(lerp(o.py, o.y, e))
        );
        m.rotation.y = elapsed * 0.9;
        m.rotation.x = Math.sin(elapsed * 2 + i) * 0.12;
        if (o.glow) o.glow.position.copy(m.position);
        break;
      }
      case 'laser': {
        let op, w;
        if (o.phase === 'fire') { op = 0.78 + Math.sin(elapsed * 42) * 0.18; w = 0.36; }
        else if (o.phase === 'charge') { op = 0.30 + Math.sin(elapsed * 60) * 0.24; w = 0.15; }
        else { op = 0.06; w = 0.05; }
        o.beam.material.opacity = op;
        if (o.horizontal) o.beam.scale.set(o.span + 0.12, w, w);
        else o.beam.scale.set(w, w, o.span + 0.12);
        break;
      }
      case 'spinner': {
        const beats = (this.step - o.moveStep) + stepT;
        const t = frozen ? 1 : clamp(beats, 0, 1);
        const e = smoothstep(t);
        const a = SPIN_DIRS[o.prevPhase], b = SPIN_DIRS[o.phase];
        for (let j = 0; j < o.armMeshes.length; j++) {
          const r = j + 1;
          const gx = lerp(o.cx + a.x * r, o.cx + b.x * r, e);
          const gy = lerp(o.cy + a.y * r, o.cy + b.y * r, e);
          const m = o.armMeshes[j];
          const vis = inBounds(Math.round(gx), Math.round(gy));
          m.visible = vis;
          if (!vis) continue;
          m.position.set(worldX(gx), 0.5, worldZ(gy));
          m.rotation.y = elapsed * 1.6 + r;
          m.rotation.x = elapsed * 1.1;
        }
        o.meshes[0].rotation.y = elapsed * 2.2;
        break;
      }
      case 'pad': {
        const m = o.plate;
        m.material.opacity = o.on ? (0.5 + Math.abs(Math.sin(elapsed * 12)) * 0.42) : 0.12;
        m.scale.set(1.94, o.on ? 1.8 : 1, 1.94);
        m.position.y = o.on ? 0.12 : 0.05;
        break;
      }
      case 'spike': {
        const m = o.spike;
        m.position.y += ((o.on ? 0.35 : -0.55) - m.position.y) * Math.min(1, dt * 15);
        m.rotation.y = elapsed * 1.5;
        break;
      }
    }
  }
};

/* ---- generation --------------------------------------------------------- */
/* one extra hazard somewhere legal; used as Endless and Survival escalate */
ObstacleManager.prototype.addRandomHazard = function (kinds, isFree) {
  /* a nested call keeps whatever guard is already in force, so a batch
     placement can wrap the whole batch in one fairness rule */
  const prevGuard = this.guard;
  this.guard = isFree || prevGuard || null;
  const kind = pick(kinds);
  let made = null;
  for (let attempt = 0; attempt < 50 && !made; attempt++) {
    const cx = rndInt(2, GRID - 3), cy = rndInt(2, GRID - 3);
    if (kind === 'block') {
      made = this.addBlock(cx, cy);
    } else if (kind === 'patrol') {
      const horiz = Math.random() < 0.5;
      made = this.addPatrol(cx, cy, horiz ? 1 : 0, horiz ? 0 : 1, rndInt(3, 6), rndInt(2, 3));
    } else if (kind === 'laser') {
      const horiz = Math.random() < 0.5;
      const len = rndInt(7, 12);
      const x = horiz ? clamp(cx - (len >> 1), 0, GRID - len) : cx;
      const y = horiz ? cy : clamp(cy - (len >> 1), 0, GRID - len);
      made = this.addLaser(x, y, horiz, len, rndInt(9, 13), rndInt(0, 8));
    } else if (kind === 'spinner') {
      made = this.addSpinner(cx, cy, rndInt(2, 3), rndInt(2, 3), Math.random() < 0.5 ? 1 : -1);
    } else if (kind === 'pad') {
      made = this.addPad(cx, cy, rndInt(7, 10), rndInt(0, 6));
    } else if (kind === 'spike') {
      made = this.addSpike(cx, cy, rndInt(5, 8), rndInt(0, 5));
    }
  }
  this.guard = prevGuard;
  if (made) {
    this._rebuild();
    const c = made.cells[0] || { x: made.cx, y: made.cy };
    if (this.ps && c) {
      this.ps.burst(worldX(c.x), 0.7, worldZ(c.y), {
        color: 0xff6a8a, count: 18, speed: 4, size: 0.42, life: 0.6, gravity: -1.4
      });
    }
  }
  return made;
};

/* Classic and Time Attack: a handful of static cover, then live hazards as
   the level climbs. Density is scaled by the difficulty's obst factor.   */
ObstacleManager.prototype.generate = function (modeId, diff, level) {
  const factor = diff.obst;
  if (factor <= 0 || modeId === 'time') return;

  const blocks = Math.min(16, Math.round((level - 1) * 1.6 * factor));
  for (let i = 0; i < blocks; i++) {
    for (let a = 0; a < 30; a++) {
      const x = rndInt(1, GRID - 2), y = rndInt(1, GRID - 2);
      if (this.addBlock(x, y)) break;
    }
  }
  const live = [];
  if (level >= 3) live.push('patrol');
  if (level >= 5) live.push('spike');
  if (level >= 6) live.push('laser');
  if (level >= 8) live.push('pad');
  if (level >= 9) live.push('spinner');
  const liveCount = Math.min(live.length, Math.round((level - 2) * 0.7 * factor));
  for (let i = 0; i < liveCount; i++) {
    this.addRandomHazard([live[i % live.length]], null);
  }
  this._rebuild();
};

/* the twelve Challenge layouts, built from shapes rather than tables */
ObstacleManager.prototype.buildChallenge = function (level) {
  const c = HALF;
  const L = clamp(level, 1, 12);
  const self = this;
  const line = function (x, y, dx, dy, n, skip) {
    for (let i = 0; i < n; i++) {
      if (skip && skip.indexOf(i) >= 0) continue;
      self.addBlock(x + dx * i, y + dy * i);
    }
  };
  switch (L) {
    case 1:                                            /* corner pillars */
      [[4, 4], [4, 16], [16, 4], [16, 16]].forEach(function (p) {
        self.addBlock(p[0], p[1]);
        self.addBlock(p[0] + (p[0] < c ? 1 : -1), p[1]);
        self.addBlock(p[0], p[1] + (p[1] < c ? 1 : -1));
      });
      break;
    case 2:                                            /* pinwheel */
      line(c, 3, 0, 1, 5); line(c, 13, 0, 1, 5);
      line(3, c - 5, 1, 0, 5); line(13, c + 5, 1, 0, 5);
      break;
    case 3:                                            /* two walls, offset gates */
      line(2, 6, 1, 0, 17, [7, 8, 9]);
      line(2, 14, 1, 0, 17, [2, 3, 13]);
      break;
    case 4:                                            /* patrol lanes */
      this.addPatrol(3, 4, 1, 0, 7, 2);
      this.addPatrol(16, 7, -1, 0, 7, 2);
      this.addPatrol(3, 13, 1, 0, 7, 3);
      this.addPatrol(16, 16, -1, 0, 7, 2);
      break;
    case 5:                                            /* ring with four gates */
      for (let i = 4; i <= 16; i++) {
        if (Math.abs(i - c) > 1) { this.addBlock(i, 4); this.addBlock(i, 16); }
      }
      for (let j = 5; j <= 15; j++) {
        if (Math.abs(j - c) > 1) { this.addBlock(4, j); this.addBlock(16, j); }
      }
      break;
    case 6:                                            /* alternating beams */
      this.addLaser(2, 5, true, 17, 10, 0);
      this.addLaser(2, 15, true, 17, 10, 5);
      this.addBlock(c, 2); this.addBlock(c, 18);
      break;
    case 7:                                            /* twin spinners */
      this.addSpinner(6, 6, 3, 2, 1);
      this.addSpinner(14, 14, 3, 2, -1);
      this.addBlock(6, 14); this.addBlock(14, 6);
      break;
    case 8:                                            /* electric floor */
      this.addPad(3, 3, 8, 0); this.addPad(16, 3, 8, 3);
      this.addPad(3, 16, 8, 5); this.addPad(16, 16, 8, 2);
      line(9, 7, 1, 0, 3); line(9, 13, 1, 0, 3);
      break;
    case 9:                                            /* spike field */
      for (let i = 0; i < 14; i++) {
        this.addSpike(rndInt(2, GRID - 3), rndInt(2, GRID - 3), rndInt(5, 8), rndInt(0, 6));
      }
      this.addPatrol(3, 3, 1, 1, 6, 3);
      break;
    case 10:                                           /* corridors */
      line(5, 2, 0, 1, 7); line(5, 13, 0, 1, 6);
      line(10, 4, 0, 1, 6); line(10, 14, 0, 1, 5);
      line(15, 2, 0, 1, 6); line(15, 12, 0, 1, 7);
      break;
    case 11:                                           /* mixed */
      this.addLaser(3, 7, true, 15, 11, 0);
      this.addSpinner(c, 3, 2, 2, 1);
      this.addPatrol(3, 16, 1, 0, 7, 2);
      this.addPatrol(16, 13, -1, 0, 7, 3);
      this.addBlock(6, 5); this.addBlock(14, 5); this.addBlock(6, 15); this.addBlock(14, 15);
      break;
    case 12:                                           /* the gauntlet */
      this.addLaser(2, 4, true, 17, 12, 0);
      this.addLaser(2, 16, true, 17, 12, 6);
      this.addSpinner(5, c, 2, 2, 1);
      this.addSpinner(15, c, 2, 2, -1);
      this.addPatrol(10, 2, 0, 1, 3, 2);
      this.addPatrol(10, 18, 0, -1, 3, 2);
      this.addPad(2, 2, 7, 0); this.addPad(17, 17, 7, 3);
      break;
  }
  this._rebuild();
};
