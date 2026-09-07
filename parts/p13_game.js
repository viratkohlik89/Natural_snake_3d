
/* ===========================================================================
   13 — GAME
   The state machine, the world, the camera rig and the frame loop.

   Two clocks run here. Real time drives animation, particles and the camera.
   A fixed accumulator drives the grid simulation. Everything that can kill
   you is resolved on the grid at step time, and everything drawn between two
   steps is an interpolation of two known grid states — so what the player
   sees is always what the collision code saw.
   ========================================================================= */

const START_LEN = 4;
const START_X = 8;              /* twelve cells of runway before the far wall */
const SHRINK_EVERY = 40;        /* Endless: seconds between burn-ring growths */
const HAZARD_EVERY = 25;        /* Survival: seconds between new hazards      */
const MAX_BURN = 7;
const MAX_OBSTACLES = 30;

/* Camera framing. Pitch is the angle above the horizon: the rig is a
   fixed-heading chase camera rather than one that spins with the snake,
   which keeps a grid readable and never disorients the player. */
const CAM = {
  close: { pitch: 0.84, fov: 60, mul: 0.88 },
  normal: { pitch: 0.94, fov: 54, mul: 1.00 },
  far: { pitch: 1.06, fov: 48, mul: 1.14 }
};

const CAUSES = {
  wall: 'Hit the boundary',
  self: 'Bit your own body',
  block: 'Hit a barrier',
  hazard: 'Caught by a hazard',
  burn: 'Caught by the burn ring',
  trapped: 'Nowhere left to go'
};

/* sub-screens remember which screen opened them, so Back always makes sense */
const SUB_SCREENS = {};
SUB_SCREENS[STATE.MODES] = 1;
SUB_SCREENS[STATE.CUSTOM] = 1;
SUB_SCREENS[STATE.ACH] = 1;
SUB_SCREENS[STATE.STATS] = 1;
SUB_SCREENS[STATE.SETTINGS] = 1;
SUB_SCREENS[STATE.HELP] = 1;

function byId(list, id) {
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return list[0];
}

const Game = {
  /* --- world ------------------------------------------------------------- */
  renderer: null, scene: null, camera: null,
  arena: null, particles: null, snake: null,
  food: null, powers: null, obstacles: null,
  ready: false,
  particleCap: 0,
  accentInt: 0x38f0d0,

  /* --- state ------------------------------------------------------------- */
  state: STATE.LOAD,
  returnTo: STATE.MENU,
  run: null,
  over: null,
  death: null,

  /* --- clocks ------------------------------------------------------------ */
  elapsed: 0,
  timeScale: 1,
  stepAcc: 0,
  stepInterval: 1 / 6.6,
  stepT: 0,
  fps: 60,
  _last: 0,
  _raf: 0,
  _looping: false,

  /* --- camera ------------------------------------------------------------ */
  camPos: null, camLook: null, camFocus: null,
  shakeAmt: 0, zoom: 1, orbit: 0.6,

  /* --- scratch ----------------------------------------------------------- */
  occ: null,
  burnRing: 0,
  hazardT: HAZARD_EVERY,
  timeScoreAcc: 0,
  demoAcc: 0, demoT: 0,
  _had: null,
  _ghost: false, _shield: false, _freeze: false,
  _v: null, _v2: null, _v3: null,

  /* =======================================================================
     setup
     ===================================================================== */
  initRenderer: function () {
    const canvas = $('stage');
    const s = SaveManager.data.settings;
    this.renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: s.quality !== 'low' && !IS_SMALL,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false
    });
    this.renderer.setClearColor(0x060a13, 1);
    if ('outputEncoding' in this.renderer && THREE.sRGBEncoding) {
      this.renderer.outputEncoding = THREE.sRGBEncoding;
    }
    this.renderer.shadowMap.enabled = s.quality !== 'low';
    if (THREE.PCFSoftShadowMap !== undefined) {
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    return this.renderer;
  },

  initScene: function () {
    const s = SaveManager.data.settings;
    const p = CAM[s.camera] || CAM.normal;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      p.fov, window.innerWidth / Math.max(1, window.innerHeight), 0.4, 220
    );
    this.camFocus = new THREE.Vector3(0, 0, 0);
    this.camLook = new THREE.Vector3(0, 0, 0);
    this.camPos = new THREE.Vector3(0, 20, 16);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this.occ = new Set();
    this._had = {};
  },

  initEntities: function () {
    const self = this;
    this.particleCap = PARTICLE_BUDGET.high;
    this.particles = new ParticleSystem(this.scene, this.particleCap);
    this.snake = new Snake(this.scene);
    this.food = new FoodManager(this.scene, this.particles);
    this.powers = new PowerUpManager(this.scene, this.particles);
    this.obstacles = new ObstacleManager(this.scene, this.particles);

    /* closures made once: the managers take predicates, and rebuilding them
       every spawn would allocate inside the simulation */
    this.freeFn = function (x, y) { return self.isFree(x, y); };
    this.hazardFn = function (x, y) { return self.hazardOk(x, y); };
    this.demoFreeFn = function (x, y) { return self.demoFree(x, y); };
    this.obstacles.setReserved(function (x, y) { return self.cellReserved(x, y); });

    this.applyParticles();
    this.applyQuality();
    this.applyLook();
  },

  /* =======================================================================
     settings application
     ===================================================================== */
  applyQuality: function () {
    const q = SaveManager.data.settings.quality;
    if (!this.renderer) return;
    const cap = q === 'low' ? 1 : (q === 'medium' ? 1.5 : 2);
    this.renderer.setPixelRatio(Math.min(cap, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = q !== 'low';

    if (this.arena && this.arena.sun) {
      const sun = this.arena.sun;
      sun.castShadow = q !== 'low';
      const sh = sun.shadow;
      const want = q === 'high' ? 1024 : 512;
      /* the map has to be dropped before a new size takes effect */
      if (sh.map && sh.mapSize.width !== want) {
        try { sh.map.dispose(); } catch (e) { }
        sh.map = null;
      }
      sh.mapSize.width = sh.mapSize.height = want;
      sh.camera.left = -16; sh.camera.right = 16;
      sh.camera.top = 16; sh.camera.bottom = -16;
      sh.camera.near = 1; sh.camera.far = 46;
      sh.bias = -0.0018;
      sh.radius = 2;
      sh.camera.updateProjectionMatrix();
    }
    if (this.arena && this.arena.motes) this.arena.motes.visible = q !== 'low';
    this.resize();
  },

  applyParticles: function () {
    if (!this.particles) return;
    const key = SaveManager.data.settings.particles;
    const budget = PARTICLE_BUDGET[key] === undefined ? PARTICLE_BUDGET.normal : PARTICLE_BUDGET[key];
    this.particles.max = Math.min(this.particleCap, budget);
    if (this.particles.count > this.particles.max) this.particles.clear();
    this.particles.setScale(key === 'high' ? 1.12 : 1);
  },

  applyLook: function () {
    const d = SaveManager.data.skin;
    const color = byId(COLORS, d.color);
    const style = byId(SKINS, d.style);
    const arena = byId(ARENAS, d.arena);
    if (this.snake) this.snake.setLook(color, style);
    if (this.arena) this.arena.applyTheme(arena.id);
    this.accentInt = color.glow;
    UI.setAccentInt(color.glow);
  },

  resize: function () {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (this.renderer) this.renderer.setSize(w, h, false);
    UI.resize();
  },

  /* =======================================================================
     state machine
     ===================================================================== */
  goto: function (state) {
    const from = this.state;
    if (state === from) return;

    /* a run that is still live must be parked before we wander off */
    if (from === STATE.PLAY && state !== STATE.PAUSE && state !== STATE.OVER) {
      this.abandon();
    }

    if (SUB_SCREENS[state] && !SUB_SCREENS[from]) {
      this.returnTo = (from === STATE.OVER || from === STATE.LOAD) ? STATE.MENU : from;
    }

    this.state = state;

    /* build the screen we are about to show, so it is never stale */
    if (state === STATE.MENU) { UI.refreshMenu(); this.resetDemo(); }
    else if (state === STATE.MODES) { UI.refreshModeBests(); }
    else if (state === STATE.CUSTOM) { UI.buildCustom(); }
    else if (state === STATE.ACH) { UI.buildAch(); }
    else if (state === STATE.STATS) { UI.buildStats(); }
    else if (state === STATE.SETTINGS) { UI.buildSettings(); }

    UI.hudOn(state === STATE.PLAY);
    UI.show(state);

    if (state === STATE.PLAY) {
      UI.blur();
      UI.resize();            /* the HUD telemetry canvas has size only now */
      UI.swipeHint(IS_TOUCH && SaveManager.data.settings.touchMode !== 'pad');
      this._last = now();
    } else {
      UI.swipeHint(false);
    }
    if (state !== STATE.PLAY && state !== STATE.PAUSE) UI.edge(false);
    Audio.duck(state === STATE.PLAY ? 1 : 0.7);
  },

  back: function () {
    let t = this.returnTo || STATE.MENU;
    if (t === STATE.PLAY) t = STATE.PAUSE;
    Audio.play('back');
    this.goto(t);
  },

  quitToMenu: function () {
    if (this.state === STATE.PAUSE || this.state === STATE.PLAY) this.abandon();
    this.run = null;
    this.goto(STATE.MENU);
  },

  /* leaving a live run still counts: the score, cores and time all happened */
  abandon: function () {
    if (!this.run || this.run.closed) return;
    this.commitRun(this.run);
    this.run.closed = true;
    this.powers.clear();
    this.food.clear();
    this.obstacles.clear();
    this.snake.setGhost(false);
    this.snake.setShield(false);
    this.obstacles.setFrozen(false);
    this.arena.setBurn(0);
    this.burnRing = 0;
    UI.refreshMenu();
  },

  pause: function () {
    if (this.state !== STATE.PLAY || !this.run) return;
    Audio.play('click');
    UI.showPause(this.run);
    this.goto(STATE.PAUSE);
  },

  resume: function () {
    if (this.state !== STATE.PAUSE) return;
    Audio.play('click');
    this.goto(STATE.PLAY);
  },

  startLast: function () {
    this.start(SaveManager.data.lastMode, SaveManager.data.lastDiff);
  },

  startSelected: function () {
    this.start(UI.selMode, UI.selDiff);
  },

  restart: function () {
    const m = this.run ? this.run.mode : SaveManager.data.lastMode;
    const d = this.run ? this.run.diff : SaveManager.data.lastDiff;
    this.start(m, d);
  },

  /* =======================================================================
     starting a run
     ===================================================================== */
  start: function (modeId, diffId) {
    if (!this.ready) return;
    const mode = MODE_BY_ID[modeId] || MODES[0];
    const diff = DIFF_BY_ID[diffId] || DIFFS[1];

    /* close anything still open before we wipe the board */
    if (this.state === STATE.PLAY || this.state === STATE.PAUSE) this.abandon();

    SaveManager.data.lastMode = mode.id;
    SaveManager.data.lastDiff = diff.id;
    SaveManager.save();
    UI.selMode = mode.id;
    UI.selDiff = diff.id;

    this.run = {
      mode: mode.id, diff: diff.id,
      score: 0, best: SaveManager.data.best,
      level: 1, food: 0, length: START_LEN,
      combo: 0, comboT: 0, comboWindow: 2.6,
      time: 0, timeLeft: mode.timer, nextShrink: SHRINK_EVERY,
      quotaGot: 0, quotaNeed: mode.id === 'challenge' ? 5 : 0,
      sps: diff.sps, topSps: diff.sps,
      bestCombo: 0, powerups: 0, saves: 0,
      steps: 0, won: false, closed: false
    };

    /* --- clocks --- */
    this.timeScale = 1;
    this.stepAcc = 0;
    this.stepT = 0;
    this.stepInterval = 1 / diff.sps;
    this.timeScoreAcc = 0;
    this.hazardT = HAZARD_EVERY;
    this.burnGrace = false;
    this._tickAt = -1;
    this.death = null;
    this.over = null;
    this._had = {};
    this._ghost = this._shield = this._freeze = false;

    /* --- board --- */
    this.particles.clear();
    this.food.clear();
    this.powers.clear();
    this.obstacles.clear();
    this.obstacles.setFrozen(false);
    this.burnRing = 0;
    this.arena.setBurn(0);

    const cells = [];
    for (let i = 0; i < START_LEN; i++) cells.push({ x: START_X - i, y: HALF });
    this.snake.showAll();
    this.snake.reset(cells, 'right');
    this.snake.setGhost(false);
    this.snake.setShield(false);
    this.snake.lookAt = null;
    Input.reset('right');
    this.refreshOcc();

    /* --- layout --- */
    if (mode.id === 'challenge') this.buildLayout(1);
    else this.obstacles.generate(mode.id, diff, 1);

    /* --- opening cores: never an empty board on the first step --- */
    this.topUpFood();
    this.powers.timer = 16 / diff.power;

    UI.pulse();
    Audio.play('start');
    Audio.setIntensity(0.15);
    this.goto(STATE.PLAY);
    UI.frame(this.run, 0.016, this.fps);
    UI.banner(mode.name.toUpperCase(),
      diff.name + (mode.timer ? ' · ' + fmtTime(mode.timer) : '') +
      (mode.id === 'challenge' ? ' · layout 1' : ''),
      hexCss(this.accentInt));
  },

  buildLayout: function (level) {
    this.obstacles.clear();
    this.obstacles.buildChallenge(level);
    this.obstacles._rebuild();
  },

  /* =======================================================================
     grid queries
     ===================================================================== */
  refreshOcc: function () {
    const c = this.snake.cells;
    this.occ.clear();
    for (let i = 0; i < c.length; i++) this.occ.add(cellKey(c[i].x, c[i].y));
  },

  inBurn: function (x, y) {
    const r = this.burnRing;
    if (r <= 0) return false;
    return x < r || y < r || x >= GRID - r || y >= GRID - r;
  },

  /* can a pickup live here? */
  isFree: function (x, y) {
    if (!inBounds(x, y)) return false;
    if (this.occ.has(cellKey(x, y))) return false;
    if (this.inBurn(x, y)) return false;
    if (this.obstacles.blockedAt(x, y)) return false;
    if (this.obstacles.lethalAt(x, y)) return false;
    if (this.food.at(x, y) >= 0) return false;
    if (this.powers.at(x, y) >= 0) return false;
    return true;
  },

  /* true when an obstacle must NOT be placed here */
  cellReserved: function (x, y) {
    if (this.occ.has(cellKey(x, y))) return true;
    if (this.food.at(x, y) >= 0) return true;
    if (this.powers.at(x, y) >= 0) return true;
    return false;
  },

  /* extra fairness rule while a run is live: nothing materialises in the
     player's lap, and never right in front of the head */
  hazardOk: function (x, y) {
    const c = this.snake.cells;
    if (!c.length) return true;
    const h = c[0];
    if (Math.abs(x - h.x) + Math.abs(y - h.y) < 5) return false;
    const d = DIRS[this.snake.dir];
    for (let i = 1; i <= 5; i++) {
      if (h.x + d.x * i === x && h.y + d.y * i === y) return false;
    }
    return true;
  },

  /* the tail cell is legal to enter unless we are about to grow into it */
  selfHit: function (x, y) {
    const k = cellKey(x, y);
    if (!this.occ.has(k)) return false;
    const c = this.snake.cells;
    if (this.snake.pendingGrow === 0 && c.length > 1) {
      const t = c[c.length - 1];
      if (cellKey(t.x, t.y) === k) return false;
    }
    return true;
  },

  /* only asked when a self-collision is already fatal, so the scan is rare */
  headOverlapping: function () {
    const c = this.snake.cells;
    if (c.length < 2) return false;
    const h = c[0];
    for (let i = 1; i < c.length; i++) {
      if (c[i].x === h.x && c[i].y === h.y) return true;
    }
    return false;
  },

  foodWanted: function () {
    const run = this.run;
    let n = 1;
    if (run.level <= 2) n = 3;              /* generous opening */
    else if (run.level <= 5) n = 2;
    if (run.mode === 'endless') n += 1;
    if (run.diff === 'insane') n = Math.max(1, n - 1);
    return n;
  },

  topUpFood: function () {
    const want = this.foodWanted();
    let guard = 6;
    while (this.food.count() < want && guard-- > 0) {
      if (!this.food.spawn(this.freeFn, this.run.level >= 2)) break;
    }
  },

  /* =======================================================================
     camera rig
     ===================================================================== */
  addShake: function (amount) {
    this.shakeAmt = Math.min(1.3, this.shakeAmt + amount);
  },

  updateCamera: function (dt) {
    const s = SaveManager.data.settings;
    const p = CAM[s.camera] || CAM.normal;
    const playing = this.state === STATE.PLAY || this.state === STATE.PAUSE ||
      this.state === STATE.OVER;

    /* smooth the fov so switching the camera setting reads as a dolly */
    if (Math.abs(this.camera.fov - p.fov) > 0.02) {
      this.camera.fov += (p.fov - this.camera.fov) * Math.min(1, dt * 6);
      this.camera.updateProjectionMatrix();
    }

    /* focus: mostly the arena centre, pulled toward the head with a little
       lead in the direction of travel */
    const f = this._v;
    if (playing) {
      const h = this.snake.headPos;
      const d = this.snake.headDirV;
      f.set(h.x * 0.55 + d.x * 1.1, 0, h.z * 0.55 + d.z * 1.1);
    } else {
      f.set(0, 0, 0);
    }
    const fk = 1 - Math.pow(0.004, dt);
    this.camFocus.lerp(f, fk);

    /* zoom: a long snake needs more room, death punches in */
    let zoom = 1 + clamp((this.snake.cells.length - START_LEN) / 70, 0, 0.20);
    if (this.state === STATE.OVER) zoom = 0.74;
    else if (this.powers.has('speed')) zoom *= 1.05;
    else if (this.powers.has('slow')) zoom *= 0.96;
    this.zoom += (zoom - this.zoom) * (1 - Math.pow(0.05, dt));

    /* fit the arena in both axes, then apply the preset and the zoom */
    const half = Math.tan(this.camera.fov * Math.PI / 360);
    const distV = 11.9 / half;
    const distH = 11.2 / (half * Math.max(0.34, this.camera.aspect));
    const dist = Math.max(distV, distH) * p.mul * this.zoom;

    const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    const base = this._v2;
    if (playing) {
      base.set(this.camFocus.x * 0.55, sp * dist, this.camFocus.z * 0.55 + cp * dist);
    } else {
      /* a slow orbit behind the menus */
      this.orbit += dt * 0.055;
      base.set(Math.sin(this.orbit) * cp * dist, sp * dist, Math.cos(this.orbit) * cp * dist);
    }

    const k = 1 - Math.pow(0.0022, dt);
    this.camPos.lerp(base, k);
    this.camera.position.copy(this.camPos);

    /* shake is added after the smoothing, otherwise the lerp eats it */
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * (1.9 + this.shakeAmt * 2.2));
    let amp = this.shakeAmt * (s.shake / 100) * 0.9;
    if (s.reduceMotion) amp *= 0.35;
    if (amp > 0.0006) {
      const t = this.elapsed * 44;
      this.camera.position.x += Math.sin(t * 1.7 + 0.6) * amp;
      this.camera.position.y += Math.sin(t * 2.9 + 2.1) * amp * 0.65;
      this.camera.position.z += Math.sin(t * 1.3 + 4.2) * amp;
    }

    this.camLook.lerp(this.camFocus, 1 - Math.pow(0.0009, dt));
    this.camera.lookAt(this.camLook);

    /* the sun follows the arena centre so shadows stay inside the map */
    if (this.arena && this.arena.sun) {
      this.arena.sun.target.position.set(0, 0, 0);
      this.arena.sun.target.updateMatrixWorld();
    }
  },

  /* =======================================================================
     menu demo — a small autopilot so the menus sit on a living arena
     ===================================================================== */
  resetDemo: function () {
    if (!this.snake || this.state === STATE.PLAY) return;
    this.run = null;
    this.food.clear();
    this.powers.clear();
    this.obstacles.clear();
    this.obstacles.setFrozen(false);
    this.burnRing = 0;
    this.arena.setBurn(0);
    this.snake.showAll();
    this.snake.setGhost(false);
    this.snake.setShield(false);
    const cells = [];
    for (let i = 0; i < 7; i++) cells.push({ x: HALF + 3 - i, y: HALF });
    this.snake.reset(cells, 'right');
    this.refreshOcc();
    this.demoAcc = 0;
    this.demoT = 0;
    this.food.spawn(this.demoFreeFn, false);
  },

  demoFree: function (x, y) {
    if (!inBounds(x, y)) return false;
    if (this.occ.has(cellKey(x, y))) return false;
    if (this.food.at(x, y) >= 0) return false;
    /* keep it away from the very edge so the autopilot never gets pinned */
    return x > 1 && y > 1 && x < GRID - 2 && y < GRID - 2;
  },

  demo: function (dt) {
    if (!this.snake.cells.length) this.resetDemo();
    const interval = 1 / 4.4;
    this.demoAcc += dt;
    let guard = 3;
    while (this.demoAcc >= interval && guard-- > 0) {
      this.demoAcc -= interval;
      this.demoStep();
    }
    this.demoT = clamp(this.demoAcc / interval, 0, 1);
  },

  demoStep: function () {
    const s = this.snake;
    if (!this.food.count()) this.food.spawn(this.demoFreeFn, false);
    const target = this.food.items.length ? this.food.items[0].cell : { x: HALF, y: HALF };
    const h = s.cells[0];

    /* preference order: close the bigger gap first, then the smaller, then
       anything that is not suicide */
    const dx = target.x - h.x, dy = target.y - h.y;
    const wants = [];
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx) wants.push(dx > 0 ? 'right' : 'left');
      if (dy) wants.push(dy > 0 ? 'down' : 'up');
    } else {
      if (dy) wants.push(dy > 0 ? 'down' : 'up');
      if (dx) wants.push(dx > 0 ? 'right' : 'left');
    }
    for (const k in DIRS) wants.push(k);

    let chosen = null, cell = null;
    for (let i = 0; i < wants.length; i++) {
      const dir = wants[i];
      if (dir === OPPOSITE[s.dir]) continue;
      const d = DIRS[dir];
      const nx = h.x + d.x, ny = h.y + d.y;
      if (nx < 1 || ny < 1 || nx > GRID - 2 || ny > GRID - 2) continue;
      if (this.selfHit(nx, ny)) continue;
      chosen = dir; cell = { x: nx, y: ny };
      break;
    }
    if (!chosen) { this.resetDemo(); return; }

    s.dir = chosen;
    s.stepTo(cell);
    const fi = this.food.at(cell.x, cell.y);
    if (fi >= 0) {
      this.food.remove(fi, false);
      if (s.cells.length < 13) s.grow(1);
      s.bite();
      this.particles.burst(worldX(cell.x), 0.6, worldZ(cell.y), {
        color: this.accentInt, count: 14, speed: 4, size: 0.4, life: 0.5, gravity: -2
      });
      this.food.spawn(this.demoFreeFn, false);
    }
    this.refreshOcc();
    this.snake.lookAt = this.food.items.length ? this.food.items[0].v.group.position : null;
  },

  /* =======================================================================
     the frame loop
     ===================================================================== */
  startLoop: function () {
    if (this._looping) return;
    this._looping = true;
    const self = this;
    this._last = now();
    const tick = function () {
      self._raf = window.requestAnimationFrame(tick);
      try { self.frame(); }
      catch (err) {
        /* one bad frame must never take the whole page down */
        if (!self._errored) {
          self._errored = true;
          UI.toast('Recovered from a rendering error', 'warn');
          if (window.console && console.error) console.error(err);
        }
      }
    };
    this._raf = window.requestAnimationFrame(tick);
  },

  frame: function () {
    const t = now();
    let raw = (t - this._last) / 1000;
    this._last = t;
    if (!isFinite(raw) || raw < 0) raw = 0.016;
    raw = Math.min(raw, 0.1);                 /* a returning tab must not jump */
    this.fps += (1 / Math.max(0.0005, raw) - this.fps) * 0.08;

    const st = this.state;
    const dt = raw * this.timeScale;

    if (st === STATE.PLAY) {
      this.elapsed += dt;
      this.simulate(dt);
      if (this.state === STATE.PLAY) {
        this.animate(dt, this.stepT);
        UI.frame(this.run, raw, this.fps);
      }
    } else if (st === STATE.PAUSE) {
      /* a real pause: no clocks, no animation, no particles. Just redraw. */
    } else if (st === STATE.OVER) {
      this.elapsed += dt;
      this.deathTick(dt);
      this.animate(dt, 1, true);
      UI.telemetry(null, raw);
    } else {
      this.elapsed += dt;
      this.demo(dt);
      this.animate(dt, this.demoT);
      UI.telemetry(null, raw);
    }

    this.updateCamera(raw);
    this.renderer.render(this.scene, this.camera);
  },

  /* everything that is purely visual */
  animate: function (dt, stepT, frozenSnake) {
    this.arena.update(dt, this.elapsed);
    this.obstacles.update(dt, this.elapsed, stepT);
    this.food.update(dt, this.elapsed);
    this.particles.update(dt);
    if (!frozenSnake) this.snake.render(stepT, dt, this.elapsed);
  }
};
