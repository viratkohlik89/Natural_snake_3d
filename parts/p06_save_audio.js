
/* ===========================================================================
   3 — SAVE MANAGER
   Everything persistent lives under one key. Bad data never breaks the game:
   the loader validates every field against the defaults and drops the rest.
   ========================================================================= */

const SaveManager = {
  KEY: 'neuralsnake.save.v1',
  data: null,
  corrupted: false,
  _pending: false,

  load: function () {
    let raw = null;
    try { raw = window.localStorage ? window.localStorage.getItem(this.KEY) : null; }
    catch (e) { raw = null; }

    let parsed = null;
    if (raw) {
      try { parsed = JSON.parse(raw); }
      catch (e) { parsed = null; this.corrupted = true; }
    }
    this.data = this._merge(DEFAULT_SAVE, (parsed && typeof parsed === 'object') ? parsed : {});
    this._sanitize();
    this.ensureChallenges();
    return this.data;
  },

  /* copy defaults, then accept only same-typed values from the stored blob */
  _merge: function (def, src) {
    const out = Array.isArray(def) ? [] : {};
    for (const k in def) {
      if (!Object.prototype.hasOwnProperty.call(def, k)) continue;
      const d = def[k], s = src ? src[k] : undefined;
      if (d && typeof d === 'object' && !Array.isArray(d)) {
        out[k] = this._merge(d, (s && typeof s === 'object') ? s : {});
      } else if (Array.isArray(d)) {
        out[k] = Array.isArray(s) ? s.slice(0, 32) : d.slice();
      } else if (typeof s === typeof d && s !== null) {
        out[k] = s;
      } else {
        out[k] = d;
      }
    }
    /* free-form maps that the defaults cannot enumerate */
    if (src && typeof src.achievements === 'object' && src.achievements) {
      out.achievements = {};
      for (const a in src.achievements) {
        if (src.achievements[a] === true) out.achievements[a] = true;
      }
    }
    if (src && typeof src.bestByMode === 'object' && src.bestByMode) {
      out.bestByMode = {};
      for (const m in src.bestByMode) {
        const v = src.bestByMode[m];
        if (typeof v === 'number' && isFinite(v) && v >= 0) out.bestByMode[m] = Math.floor(v);
      }
    }
    return out;
  },

  _sanitize: function () {
    const d = this.data, s = d.settings;
    const num = function (v, lo, hi, def) {
      return (typeof v === 'number' && isFinite(v)) ? clamp(Math.round(v), lo, hi) : def;
    };
    const oneOf = function (v, list, def) { return list.indexOf(v) >= 0 ? v : def; };

    s.volSfx = num(s.volSfx, 0, 100, 70);
    s.volMusic = num(s.volMusic, 0, 100, 45);
    s.shake = num(s.shake, 0, 100, 60);
    s.sensitivity = num(s.sensitivity, 10, 100, 50);
    s.quality = oneOf(s.quality, ['low', 'medium', 'high'], 'high');
    s.particles = oneOf(s.particles, ['off', 'low', 'normal', 'high'], 'normal');
    s.camera = oneOf(s.camera, ['close', 'normal', 'far'], 'normal');
    s.touchMode = oneOf(s.touchMode, ['swipe', 'pad', 'both'], 'swipe');
    s.sfx = !!s.sfx; s.music = !!s.music; s.fps = !!s.fps; s.reduceMotion = !!s.reduceMotion;

    d.best = Math.max(0, num(d.best, 0, 1e9, 0));
    d.skin.color = oneOf(d.skin.color, COLORS.map(function (c) { return c.id; }), 'aqua');
    d.skin.style = oneOf(d.skin.style, SKINS.map(function (c) { return c.id; }), 'classic');
    d.skin.arena = oneOf(d.skin.arena, ARENAS.map(function (c) { return c.id; }), 'grid');
    d.lastMode = oneOf(d.lastMode, MODES.map(function (m) { return m.id; }), 'classic');
    d.lastDiff = oneOf(d.lastDiff, DIFFS.map(function (m) { return m.id; }), 'normal');

    const st = d.stats;
    for (const k in st) {
      if (typeof st[k] !== 'number' || !isFinite(st[k]) || st[k] < 0) st[k] = DEFAULT_SAVE.stats[k];
      else st[k] = Math.floor(st[k]);
    }
    st.best = Math.max(st.best, d.best);
    d.best = st.best;
    if (st.longest < 4) st.longest = 4;

    /* a skin the player has not earned must never stay selected */
    if (!this.unlocked(COLORS, d.skin.color)) d.skin.color = 'aqua';
    if (!this.unlocked(SKINS, d.skin.style)) d.skin.style = 'classic';
    if (!this.unlocked(ARENAS, d.skin.arena)) d.skin.arena = 'grid';
  },

  unlocked: function (list, id) {
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) return this.data.best >= list[i].unlock;
    }
    return false;
  },

  save: function () {
    /* coalesce writes: several systems can request a save in one frame */
    if (this._pending) return;
    this._pending = true;
    const self = this;
    const flush = function () {
      self._pending = false;
      try {
        if (window.localStorage) window.localStorage.setItem(self.KEY, JSON.stringify(self.data));
      } catch (e) { /* private mode or quota: the run still works, it just will not persist */ }
    };
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(flush);
    else setTimeout(flush, 0);
  },

  saveNow: function () {
    this._pending = false;
    try { if (window.localStorage) window.localStorage.setItem(this.KEY, JSON.stringify(this.data)); }
    catch (e) { /* ignore */ }
  },

  wipe: function () {
    try { if (window.localStorage) window.localStorage.removeItem(this.KEY); } catch (e) { }
    this.data = this._merge(DEFAULT_SAVE, {});
    this._sanitize();
    this.ensureChallenges();
    this.saveNow();
  },

  /* --- daily challenges -------------------------------------------------- */
  ensureChallenges: function () {
    const today = dayStamp();
    const c = this.data.challenges;
    const valid = c && c.day === today && Array.isArray(c.list) && c.list.length === 3 &&
      c.list.every(function (x) { return x && typeof x.id === 'string' && typeof x.target === 'number'; });
    if (valid) {
      if (!c.counters || typeof c.counters !== 'object') c.counters = { food: 0, powerups: 0, games: 0 };
      return;
    }
    const rng = mulberry32(hashString('neuralsnake' + today));
    const pool = CHALLENGES.slice();
    const list = [];
    for (let i = 0; i < 3 && pool.length; i++) {
      const idx = Math.floor(rng() * pool.length);
      const tpl = pool.splice(idx, 1)[0];
      const target = tpl.targets[Math.floor(rng() * tpl.targets.length)];
      list.push({ id: tpl.id, target: target, progress: 0, done: false });
    }
    this.data.challenges = { day: today, list: list, counters: { food: 0, powerups: 0, games: 0 } };
    this.save();
  },

  challengeTemplate: function (id) {
    for (let i = 0; i < CHALLENGES.length; i++) if (CHALLENGES[i].id === id) return CHALLENGES[i];
    return null;
  },

  /* record progress; returns the list of challenges completed by this call */
  bumpChallenges: function (kind, value) {
    const done = [];
    const c = this.data.challenges;
    if (!c || !Array.isArray(c.list)) return done;
    const cumulative = { food: 1, powerups: 1, games: 1 };
    if (cumulative[kind]) {
      c.counters[kind] = (c.counters[kind] || 0) + value;
    }
    for (let i = 0; i < c.list.length; i++) {
      const item = c.list[i];
      const tpl = this.challengeTemplate(item.id);
      if (!tpl || item.done || tpl.stat !== kind) continue;
      const at = cumulative[kind] ? c.counters[kind] : Math.max(item.progress, value);
      item.progress = Math.min(item.target, at);
      if (item.progress >= item.target) { item.done = true; done.push(item); }
    }
    if (done.length) this.save();
    return done;
  }
};

/* ===========================================================================
   4 — AUDIO MANAGER
   No audio files: every sound is synthesised on demand, so the single-file
   rule holds and nothing has to download. The context is only created after
   a real user gesture, which is what browsers require.
   ========================================================================= */

const Audio = {
  ctx: null,
  master: null,
  sfxBus: null,
  musicBus: null,
  musicFilter: null,
  noise: null,
  ready: false,
  failed: false,
  playingMusic: false,
  _timer: null,
  _next: 0,
  _step: 0,
  _intensity: 0,
  _duck: 1,

  init: function () {
    if (this.ready || this.failed) return this.ready;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) { this.failed = true; return false; }
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);

      this.musicFilter = this.ctx.createBiquadFilter();
      this.musicFilter.type = 'lowpass';
      this.musicFilter.frequency.value = 1600;
      this.musicBus = this.ctx.createGain();
      this.musicBus.connect(this.musicFilter);
      this.musicFilter.connect(this.master);

      /* one reusable noise buffer for hats, bites and explosions */
      const len = Math.floor(this.ctx.sampleRate * 1.2);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const ch = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;

      this.ready = true;
      this.applySettings();
      return true;
    } catch (e) { this.failed = true; return false; }
  },

  unlock: function () {
    if (!this.init()) return;
    try { if (this.ctx.state === 'suspended') this.ctx.resume(); } catch (e) { }
  },

  applySettings: function () {
    if (!this.ready) return;
    const s = SaveManager.data.settings;
    try {
      this.sfxBus.gain.value = s.sfx ? (s.volSfx / 100) * 0.55 : 0;
      this.musicBus.gain.value = s.music ? (s.volMusic / 100) * 0.30 * this._duck : 0;
    } catch (e) { }
    if (s.music && !this.playingMusic) this.startMusic();
    if (!s.music && this.playingMusic) this.stopMusic();
  },

  duck: function (amount) {
    this._duck = amount;
    this.applySettings();
  },

  /* --- primitive voices -------------------------------------------------- */
  tone: function (o) {
    if (!this.ready || !SaveManager.data.settings.sfx) return;
    const ctx = this.ctx, t0 = ctx.currentTime + (o.delay || 0);
    try {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.f0, t0);
      if (o.f1 && o.f1 !== o.f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + o.dur);
      const peak = Math.max(0.0001, o.gain === undefined ? 0.3 : o.gain);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + Math.min(0.02, o.dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
      let node = osc;
      if (o.cutoff) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = o.cutoff;
        osc.connect(f); node = f;
      }
      node.connect(g);
      g.connect(o.bus || this.sfxBus);
      osc.start(t0);
      osc.stop(t0 + o.dur + 0.02);
    } catch (e) { }
  },

  hit: function (o) {
    if (!this.ready || !SaveManager.data.settings.sfx) return;
    const ctx = this.ctx, t0 = ctx.currentTime + (o.delay || 0);
    try {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.playbackRate.value = o.rate || 1;
      const f = ctx.createBiquadFilter();
      f.type = o.filter || 'bandpass';
      f.frequency.setValueAtTime(o.f0 || 900, t0);
      if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(60, o.f1), t0 + o.dur);
      f.Q.value = o.q === undefined ? 1.2 : o.q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(Math.max(0.0001, o.gain === undefined ? 0.25 : o.gain), t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
      src.connect(f); f.connect(g); g.connect(o.bus || this.sfxBus);
      src.start(t0);
      src.stop(t0 + o.dur + 0.02);
    } catch (e) { }
  },

  /* --- named game sounds ------------------------------------------------- */
  play: function (name, arg) {
    if (!this.ready) return;
    switch (name) {
      case 'hover':
        this.tone({ type: 'sine', f0: 1180, f1: 1320, dur: 0.05, gain: 0.05 });
        break;
      case 'click':
        this.tone({ type: 'square', f0: 520, f1: 880, dur: 0.07, gain: 0.13, cutoff: 2600 });
        this.tone({ type: 'sine', f0: 1560, dur: 0.05, gain: 0.06, delay: 0.02 });
        break;
      case 'back':
        this.tone({ type: 'square', f0: 640, f1: 320, dur: 0.09, gain: 0.11, cutoff: 2000 });
        break;
      case 'deny':
        this.tone({ type: 'sawtooth', f0: 220, f1: 150, dur: 0.16, gain: 0.13, cutoff: 900 });
        break;
      case 'eat': {
        /* pitch climbs with the combo, capped so it never gets shrill */
        const step = clamp(arg || 0, 0, 12);
        const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28];
        const f = 392 * Math.pow(2, scale[step] / 12);
        this.tone({ type: 'triangle', f0: f, f1: f * 1.5, dur: 0.13, gain: 0.24 });
        this.tone({ type: 'sine', f0: f * 2, dur: 0.09, gain: 0.10, delay: 0.015 });
        this.hit({ f0: 2600, f1: 900, dur: 0.07, gain: 0.10, rate: 1.6 });
        break;
      }
      case 'bigfood':
        this.tone({ type: 'triangle', f0: 660, f1: 1320, dur: 0.20, gain: 0.24 });
        this.tone({ type: 'sine', f0: 990, f1: 1980, dur: 0.24, gain: 0.14, delay: 0.05 });
        break;
      case 'power':
        [0, 4, 7, 12].forEach(function (n, i) {
          Audio.tone({ type: 'square', f0: 440 * Math.pow(2, n / 12), dur: 0.13, gain: 0.11, delay: i * 0.045, cutoff: 3200 });
        });
        break;
      case 'spawn':
        this.tone({ type: 'sine', f0: 880, f1: 1400, dur: 0.10, gain: 0.06 });
        break;
      case 'combo':
        this.tone({ type: 'square', f0: 880 + clamp(arg || 0, 0, 10) * 90, dur: 0.10, gain: 0.09, cutoff: 4000 });
        break;
      case 'level':
        [0, 5, 9, 12, 17].forEach(function (n, i) {
          Audio.tone({ type: 'triangle', f0: 330 * Math.pow(2, n / 12), dur: 0.30, gain: 0.15, delay: i * 0.075 });
        });
        break;
      case 'achieve':
        [0, 7, 12, 16, 19].forEach(function (n, i) {
          Audio.tone({ type: 'sine', f0: 523 * Math.pow(2, n / 12), dur: 0.5, gain: 0.13, delay: i * 0.09 });
        });
        break;
      case 'shield':
        this.tone({ type: 'square', f0: 1200, f1: 500, dur: 0.28, gain: 0.16, cutoff: 3000 });
        this.tone({ type: 'square', f0: 1207, f1: 505, dur: 0.28, gain: 0.10, cutoff: 3000 });
        this.hit({ f0: 4200, f1: 1200, dur: 0.22, gain: 0.14, rate: 0.9 });
        break;
      case 'hurt':
        this.hit({ f0: 700, f1: 90, dur: 0.30, gain: 0.30, filter: 'lowpass', rate: 0.7 });
        this.tone({ type: 'sawtooth', f0: 180, f1: 55, dur: 0.36, gain: 0.20, cutoff: 700 });
        break;
      case 'death':
        this.hit({ f0: 1400, f1: 60, dur: 0.9, gain: 0.34, filter: 'lowpass', rate: 0.55 });
        this.tone({ type: 'sawtooth', f0: 220, f1: 40, dur: 1.0, gain: 0.22, cutoff: 800 });
        this.tone({ type: 'sine', f0: 110, f1: 33, dur: 1.2, gain: 0.16 });
        break;
      case 'start':
        [0, 7, 12].forEach(function (n, i) {
          Audio.tone({ type: 'triangle', f0: 262 * Math.pow(2, n / 12), dur: 0.35, gain: 0.16, delay: i * 0.06 });
        });
        break;
      case 'win':
        [0, 4, 7, 12, 16, 19, 24].forEach(function (n, i) {
          Audio.tone({ type: 'triangle', f0: 392 * Math.pow(2, n / 12), dur: 0.45, gain: 0.15, delay: i * 0.11 });
        });
        break;
      case 'tick':
        this.tone({ type: 'square', f0: 1600, dur: 0.04, gain: 0.07 });
        break;
    }
  },

  /* --- generative music --------------------------------------------------
     Four bars of a minor pentatonic pattern over a walking bass, scheduled a
     little ahead of the clock so timing does not depend on frame rate.      */
  startMusic: function () {
    if (!this.ready || this.playingMusic || !SaveManager.data.settings.music) return;
    this.playingMusic = true;
    this._next = this.ctx.currentTime + 0.1;
    this._step = 0;
    const self = this;
    this._timer = setInterval(function () { self._schedule(); }, 40);
  },

  stopMusic: function () {
    this.playingMusic = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  setIntensity: function (v) {
    this._intensity = clamp(v, 0, 1);
    if (this.ready && this.musicFilter) {
      try {
        const target = 900 + this._intensity * 3400;
        this.musicFilter.frequency.setTargetAtTime(target, this.ctx.currentTime, 0.4);
      } catch (e) { }
    }
  },

  _schedule: function () {
    if (!this.ready || !this.playingMusic) return;
    const ctx = this.ctx;
    const bpm = 96 + this._intensity * 30;
    const spb = 60 / bpm / 4;                        /* sixteenth note */
    let guard = 0;
    while (this._next < ctx.currentTime + 0.2 && guard++ < 32) {
      this._voice(this._next, this._step, spb);
      this._next += spb;
      this._step = (this._step + 1) % 64;
    }
  },

  _voice: function (t, step, spb) {
    const bus = this.musicBus;
    const root = 55;                                  /* A1 */
    const bassPat = [0, 0, 7, 0, 5, 0, 3, 0];
    const leadPat = [12, 15, 19, 22, 19, 15, 12, 10, 12, 15, 19, 24, 22, 19, 15, 12];
    const bar = Math.floor(step / 16);

    if (step % 8 === 0) {
      const n = bassPat[(bar * 2 + (step % 16 === 0 ? 0 : 1)) % bassPat.length];
      this._note(root * Math.pow(2, n / 12), t, spb * 6, 'sawtooth', 0.20, 260, bus);
    }
    if (step % 2 === 0) {
      const n = leadPat[(step / 2 + bar * 3) % leadPat.length];
      const g = 0.055 + this._intensity * 0.05;
      this._note(root * 2 * Math.pow(2, n / 12), t, spb * 1.6, 'triangle', g, 5200, bus);
    }
    if (this._intensity > 0.25 && step % 4 === 2) {
      try {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noise;
        src.playbackRate.value = 2.4;
        const f = this.ctx.createBiquadFilter();
        f.type = 'highpass'; f.frequency.value = 7000;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.035 * this._intensity, t);
        g.gain.exponentialRampToValueAtTime(0.0005, t + 0.06);
        src.connect(f); f.connect(g); g.connect(bus);
        src.start(t); src.stop(t + 0.08);
      } catch (e) { }
    }
    if (step === 0 || step === 32) {
      const chord = (step === 0) ? [0, 3, 7] : [5, 8, 12];
      for (let i = 0; i < chord.length; i++) {
        this._note(root * 4 * Math.pow(2, chord[i] / 12), t, spb * 14, 'sine', 0.030, 2400, bus);
      }
    }
  },

  _note: function (freq, t, dur, type, gain, cutoff, bus) {
    try {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      osc.type = type;
      osc.frequency.value = freq;
      f.type = 'lowpass'; f.frequency.value = cutoff;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(f); f.connect(g); g.connect(bus);
      osc.start(t); osc.stop(t + dur + 0.02);
    } catch (e) { }
  }
};
