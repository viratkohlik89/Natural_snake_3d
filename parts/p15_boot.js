
/* ===========================================================================
   15 — BOOT
   Real staged startup: each stage does actual work and the bar reports it,
   so the loading screen is honest rather than decorative.
   ========================================================================= */

const Boot = {
  started: false,
  entered: false,
  failed: false,
  t0: 0,

  stages: [
    {
      pct: 20, msg: 'Checking the graphics pipeline…', run: function () {
        Game.initRenderer();
        Game.initScene();
      }
    },
    {
      pct: 38, msg: 'Compiling materials…', run: function () {
        Assets.init(SaveManager.data.settings.quality);
      }
    },
    {
      pct: 58, msg: 'Growing the arena…', run: function () {
        Game.arena = new Arena(Game.scene, SaveManager.data.settings.quality);
      }
    },
    {
      pct: 76, msg: 'Assembling the organism…', run: function () {
        Game.initEntities();
      }
    },
    {
      pct: 90, msg: 'Calibrating the camera…', run: function () {
        Game.applyLook();
        Game.resize();
        Game.resetDemo();
      }
    },
    {
      pct: 98, msg: 'Restoring your progress…', run: function () {
        SaveManager.ensureChallenges();
        UI.refreshMenu();
        /* one warm frame so the first real one is not a stutter */
        Game.renderer.render(Game.scene, Game.camera);
      }
    }
  ],

  start: function () {
    if (this.started) return;
    this.started = true;
    this.t0 = now();

    /* none of this needs Three.js, so the interface is alive even if the
       library never arrives — which is how the fallback panel can be shown */
    try {
      SaveManager.load();
      UI.init();
      Input.init();
    } catch (err) {
      this.fail('The interface failed to start — ' + ((err && err.message) || String(err)));
      if (window.console && console.error) console.error(err);
      return;
    }
    UI.loadProgress(8, 'Initializing neural snake…');
    this.lifecycle();
    this.waitForThree();
  },

  /* Three.js is injected by a small loader above with two CDNs behind it */
  waitForThree: function () {
    const self = this;
    const tick = function () {
      if (self.failed) return;
      if (window.THREE && THREE.WebGLRenderer) { self.probe(); return; }
      if (window.__threeFailed || now() - self.t0 > 15000) {
        self.fail('The 3D library (Three.js) could not be downloaded. It is fetched ' +
          'from a CDN the first time you open this file — connect to the internet ' +
          'once and reload the page.');
        return;
      }
      window.setTimeout(tick, 60);
    };
    tick();
  },

  probe: function () {
    let detail = null;
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!gl) {
        detail = 'The browser reported that no WebGL context is available.';
      } else {
        /* release the probe context immediately: some browsers only allow a
           small number of live contexts and the real one still needs to fit */
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose && lose.loseContext) lose.loseContext();
      }
    } catch (err) {
      detail = 'WebGL could not be started — ' + ((err && err.message) || String(err));
    }
    if (detail) { this.fail(detail); return; }
    this.runStage(0);
  },

  runStage: function (i) {
    if (this.failed) return;
    const self = this;

    if (i >= this.stages.length) {
      UI.loadProgress(100, 'Ready');
      UI.loadReady();
      Game.ready = true;
      Game.startLoop();
      return;
    }

    const st = this.stages[i];
    UI.loadProgress(st.pct, st.msg);
    /* a beat between stages so the bar actually paints its progress */
    window.setTimeout(function () {
      if (self.failed) return;
      try {
        st.run();
      } catch (err) {
        self.fail('Startup failed while ' + st.msg.replace('…', '') + ' — ' +
          ((err && err.message) || String(err)));
        if (window.console && console.error) console.error(err);
        return;
      }
      self.runStage(i + 1);
    }, 60);
  },

  /* The one place audio is allowed to start: a real click or key press. */
  enter: function () {
    if (this.entered || !Game.ready) return;
    this.entered = true;
    Audio.unlock();
    Audio.play('click');
    Game.goto(STATE.MENU);

    if (SaveManager.data.stats.games === 0) {
      UI.toast(IS_TOUCH
        ? 'Tip · swipe anywhere on the arena to steer'
        : 'Tip · arrow keys or WASD to steer, Space to pause');
    }
  },

  /* --- window lifecycle -------------------------------------------------- */
  lifecycle: function () {
    const self = this;
    let rt = 0;
    const settle = function (delay) {
      if (rt) window.clearTimeout(rt);
      rt = window.setTimeout(function () {
        rt = 0;
        if (Game.renderer) Game.resize();
      }, delay);
    };

    on(window, 'resize', function () { settle(90); }, false);
    on(window, 'orientationchange', function () {
      /* iOS still reports the old viewport for a moment after a rotation */
      settle(260);
    }, false);

    on(document, 'visibilitychange', function () {
      if (document.hidden) {
        if (Game.state === STATE.PLAY) Game.pause();
        Audio.stopMusic();
        SaveManager.saveNow();
      } else {
        /* never integrate the time the tab spent in the background */
        Game._last = now();
        if (Game.state !== STATE.LOAD) Audio.applySettings();
      }
    }, false);

    const canvas = $('stage');
    on(canvas, 'webglcontextlost', function (e) {
      e.preventDefault();
      self.fail('The graphics context was lost, usually because the GPU was reset ' +
        'or the tab was starved of memory. Reload the page to start again.');
    }, false);

    on(window, 'pagehide', function () { SaveManager.saveNow(); }, false);
    on(window, 'beforeunload', function () { SaveManager.saveNow(); }, false);
  },

  fail: function (detail) {
    if (this.failed) return;
    this.failed = true;
    Game.ready = false;
    if (Game._raf) {
      window.cancelAnimationFrame(Game._raf);
      Game._raf = 0;
      Game._looping = false;
    }
    if (UI.E && UI.E.nogl) UI.noWebGL(detail);
    else {
      /* UI never got as far as caching its nodes, so touch the DOM directly */
      const n = $('nogl');
      if (n) n.classList.add('on');
      const d = $('nogl-detail');
      if (d) d.textContent = detail || '';
    }
    const load = $('screen-load');
    if (load) load.classList.remove('active');
    if (window.console && console.warn) console.warn('Neural Snake: ' + detail);
  }
};

/* One deliberate global, for the browser console. Everything else in this
   file lives inside the module closure. */
window.NeuralSnake = {
  version: '1.0',
  game: Game,
  ui: UI,
  input: Input,
  audio: Audio,
  save: SaveManager,
  boot: Boot,
  snapshot: function () {
    const r = Game.run;
    return {
      state: Game.state,
      fps: Math.round(Game.fps),
      quality: SaveManager.data.settings.quality,
      particles: Game.particles ? Game.particles.count + '/' + Game.particles.max : 'n/a',
      obstacles: Game.obstacles ? Game.obstacles.count() : 0,
      snake: Game.snake ? Game.snake.cells.length : 0,
      run: r ? { mode: r.mode, diff: r.diff, score: r.score, level: r.level, sps: +r.sps.toFixed(2) } : null,
      best: SaveManager.data.best
    };
  }
};

if (document.readyState === 'loading') {
  on(document, 'DOMContentLoaded', function () { Boot.start(); }, false);
} else {
  Boot.start();
}
