
/* ===========================================================================
   11 — INPUT
   One buffered turn queue feeds the simulation. Turns are validated against
   the last queued direction rather than the drawn one, so a fast double-tap
   like "up then right" survives instead of the second press being eaten.
   ========================================================================= */

const KEY_DIR = {
  arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down',
  arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right'
};

const Input = {
  queue: [],
  ref: 'right',            /* direction the simulation last committed to */
  touchId: null,
  tx: 0, ty: 0,
  swiped: false,
  bound: false,

  init: function () {
    if (this.bound) return;
    this.bound = true;
    const self = this;

    on(window, 'keydown', function (e) { self.onKey(e); }, false);
    /* keyup only exists to stop a held arrow from repeating into the queue */
    on(window, 'blur', function () { self.clear(); }, false);

    const stage = $('stage');
    on(stage, 'touchstart', function (e) { self.onTouchStart(e); }, { passive: false });
    on(stage, 'touchmove', function (e) { self.onTouchMove(e); }, { passive: false });
    on(stage, 'touchend', function (e) { self.onTouchEnd(e); }, { passive: false });
    on(stage, 'touchcancel', function (e) { self.onTouchEnd(e); }, { passive: false });

    /* thumb pad */
    const pad = $('dpad');
    const buttons = pad ? pad.querySelectorAll('button') : [];
    for (let i = 0; i < buttons.length; i++) {
      (function (b) {
        const dir = b.getAttribute('data-dir');
        const fire = function (e) {
          e.preventDefault();
          Audio.unlock();
          if (Game.state !== STATE.PLAY) return;
          self.push(dir);
          b.classList.add('hit');
          setTimeout(function () { b.classList.remove('hit'); }, 110);
        };
        on(b, 'touchstart', fire, { passive: false });
        on(b, 'mousedown', fire, false);
        on(b, 'contextmenu', function (e) { e.preventDefault(); }, false);
      })(buttons[i]);
    }
  },

  clear: function () { this.queue.length = 0; this.touchId = null; },

  reset: function (dir) {
    this.queue.length = 0;
    this.ref = dir;
    this.touchId = null;
  },

  /* returns true when the turn was accepted */
  push: function (dir) {
    if (!DIRS[dir]) return false;
    if (this.queue.length >= 2) return false;
    const ref = this.queue.length ? this.queue[this.queue.length - 1] : this.ref;
    if (dir === ref || dir === OPPOSITE[ref]) return false;    /* no 180s */
    this.queue.push(dir);
    return true;
  },

  /* the simulation calls this once per step */
  take: function () {
    if (!this.queue.length) return null;
    const d = this.queue.shift();
    this.ref = d;
    return d;
  },

  threshold: function () {
    const s = SaveManager.data.settings.sensitivity;
    return 14 + (100 - s) * 0.5;
  },

  swipeAllowed: function () {
    return SaveManager.data.settings.touchMode !== 'pad';
  },

  onTouchStart: function (e) {
    Audio.unlock();
    if (Game.state !== STATE.PLAY || !this.swipeAllowed()) return;
    const t = e.changedTouches[0];
    if (!t) return;
    this.touchId = t.identifier;
    this.tx = t.clientX;
    this.ty = t.clientY;
    this.swiped = false;
    e.preventDefault();
  },

  onTouchMove: function (e) {
    if (this.touchId === null || Game.state !== STATE.PLAY) return;
    e.preventDefault();
    let t = null;
    for (let i = 0; i < e.touches.length; i++) {
      if (e.touches[i].identifier === this.touchId) { t = e.touches[i]; break; }
    }
    if (!t) return;
    const dx = t.clientX - this.tx, dy = t.clientY - this.ty;
    const thr = this.threshold();
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax < thr && ay < thr) return;
    if (ax > ay) this.push(dx > 0 ? 'right' : 'left');
    else this.push(dy > 0 ? 'down' : 'up');
    /* re-anchor so one long drag can chain several turns */
    this.tx = t.clientX;
    this.ty = t.clientY;
    if (!this.swiped) { this.swiped = true; UI.swipeHint(false); }
  },

  onTouchEnd: function (e) {
    if (this.touchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === this.touchId) { this.touchId = null; break; }
    }
    if (e.cancelable) e.preventDefault();
  },

  /* --- keyboard ---------------------------------------------------------- */
  onKey: function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = (e.key || '').toLowerCase();
    const st = Game.state;
    const ctl = (e.target && e.target.closest)
      ? e.target.closest('.btn,.card,.sw,.seg button,.tabs button,input,[role="switch"]')
      : null;

    /* a focused control owns Enter and Space — let the browser click it,
       otherwise Enter would both activate the button and run the shortcut */
    if (ctl && (key === 'enter' || key === ' ' || key === 'spacebar')) { Audio.unlock(); return; }
    /* and a focused slider owns the arrow keys */
    if (ctl && ctl.tagName === 'INPUT' && key.indexOf('arrow') === 0) { Audio.unlock(); return; }

    /* never let the page scroll or a button re-fire on space */
    if (key === ' ' || key === 'spacebar' || key.indexOf('arrow') === 0) {
      e.preventDefault();
    }
    Audio.unlock();

    if (st === STATE.LOAD) {
      if (key === 'enter' || key === ' ' || key === 'spacebar') Boot.enter();
      return;
    }

    if (st === STATE.PLAY) {
      const d = KEY_DIR[key];
      if (d) { this.push(d); return; }
      if (key === ' ' || key === 'spacebar' || key === 'escape' || key === 'p') Game.pause();
      else if (key === 'r') Game.restart();
      else if (key === 'm') UI.toggleMute();
      return;
    }

    if (st === STATE.PAUSE) {
      if (key === ' ' || key === 'spacebar' || key === 'escape' || key === 'p' || key === 'enter') Game.resume();
      else if (key === 'r') Game.restart();
      else if (key === 'm') UI.toggleMute();
      return;
    }

    if (st === STATE.OVER) {
      if (key === 'enter' || key === ' ' || key === 'spacebar' || key === 'r') Game.restart();
      else if (key === 'escape') Game.goto(STATE.MENU);
      return;
    }

    if (st === STATE.MENU) {
      if (key === 'enter' || key === ' ' || key === 'spacebar') Game.startLast();
      else if (key === 'g') Game.goto(STATE.MODES);
      else if (key === 'm') { Game.goto(STATE.CUSTOM); UI.setTab('arena'); }
      else if (key === 'c') Game.goto(STATE.CUSTOM);
      else if (key === 'a') Game.goto(STATE.ACH);
      else if (key === 't') Game.goto(STATE.STATS);
      else if (key === 's') Game.goto(STATE.SETTINGS);
      else if (key === 'h') Game.goto(STATE.HELP);
      return;
    }

    if (st === STATE.MODES) {
      if (key === 'enter') Game.startSelected();
      else if (key === 'escape') Game.back();
      else if (key === 'arrowright' || key === 'arrowdown') UI.cycleMode(1);
      else if (key === 'arrowleft' || key === 'arrowup') UI.cycleMode(-1);
      else if (key === '1' || key === '2' || key === '3' || key === '4') {
        UI.setDiff(DIFFS[parseInt(key, 10) - 1].id);
      }
      return;
    }

    /* every other screen: Escape goes back where we came from */
    if (key === 'escape' || key === 'backspace') Game.back();
  }
};

/* ---------------------------------------------------------------------------
   The telemetry strip. Two of these exist (menu and HUD) and both read the
   same rolling history, so the signature line is genuinely the game's data:
   step rate, combo and power-up activity.
   ------------------------------------------------------------------------- */
function Telemetry(wrap) {
  this.wrap = wrap;
  this.canvas = wrap ? wrap.querySelector('canvas') : null;
  this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
  this.w = 0; this.h = 0;
}

Telemetry.prototype.resize = function () {
  if (!this.canvas) return;
  const r = this.wrap.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (w === this.w && h === this.h) return;
  this.w = w; this.h = h;
  this.canvas.width = w;
  this.canvas.height = h;
};

Telemetry.prototype.draw = function (hist, accent, spark) {
  const ctx = this.ctx;
  if (!ctx || !this.w) return;
  const w = this.w, h = this.h, n = hist.length;
  ctx.clearRect(0, 0, w, h);

  /* baseline */
  ctx.strokeStyle = 'rgba(126,196,255,.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.5); ctx.lineTo(w, h * 0.5);
  ctx.stroke();

  /* filled trace */
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w;
    const y = h - 2 - hist[i] * (h - 5);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = 'rgba(56,240,208,.10)';
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w;
    const y = h - 2 - hist[i] * (h - 5);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(1, h * 0.055);
  ctx.stroke();

  /* leading dot */
  const lastY = h - 2 - hist[n - 1] * (h - 5);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(w - 1, lastY, Math.max(1.5, h * 0.08), 0, Math.PI * 2);
  ctx.fill();

  if (spark > 0) {
    ctx.fillStyle = 'rgba(255,46,136,' + (spark * 0.5).toFixed(3) + ')';
    ctx.fillRect(0, 0, w, h);
  }
};
