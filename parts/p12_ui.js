
/* ===========================================================================
   12 — UI MANAGER
   Every list on every screen is generated from the tables in section 1, which
   is the structural guarantee that no button is decorative: if a mode, skin,
   power-up or setting exists in data, its control exists and is wired.

   The HUD reads one plain object each frame (Game.run):
     score best level length food sps combo comboT comboWindow
     time timeLeft nextShrink quotaGot quotaNeed mode diff
   ========================================================================= */

function camel(id) {
  return id.replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); });
}

const UI_IDS = [
  'stage', 'fx', 'hud', 'hud-tl', 'hud-tc', 'hud-tr', 'hud-bl',
  'hud-score', 'hud-best', 'hud-level', 'hud-info-wrap', 'hud-info-l', 'hud-info',
  'combo', 'combo-txt', 'combo-bar', 'tel-hud', 'hud-stats-box', 'hud-stats',
  'hud-speed', 'hud-food', 'hud-fps', 'btn-pause', 'powerbar',
  'popups', 'banner', 'banner-big', 'banner-small',
  'touch', 'dpad', 'swipe-hint',
  'screen-load', 'load-pct', 'load-bar', 'load-msg', 'btn-enter',
  'screen-menu', 'tel-menu', 'btn-play', 'btn-modes', 'btn-maps', 'btn-custom', 'btn-ach',
  'btn-stats', 'btn-settings', 'btn-help', 'challenges', 'menu-mode', 'menu-best',
  'screen-modes', 'mode-grid', 'mode-desc', 'diff-seg', 'diff-desc',
  'btn-mode-start', 'btn-mode-back', 'btn-mode-maps', 'mode-map-name', 'mode-map-desc', 'mode-map-swatch',
  'screen-custom', 'cust-unlock', 'tab-color', 'tab-style', 'tab-arena',
  'pane-color', 'pane-style', 'pane-arena', 'cust-hint', 'btn-cust-back',
  'screen-ach', 'ach-count', 'ach-list', 'btn-ach-back',
  'screen-stats', 'stats-grid', 'stats-modes', 'btn-stats-back', 'btn-wipe',
  'screen-settings', 'settings-body', 'btn-set-back', 'btn-set-default',
  'screen-help', 'help-powerups', 'help-modes', 'btn-help-back',
  'screen-pause', 'pause-sub', 'btn-resume', 'btn-restart', 'btn-pause-settings',
  'btn-quit', 'pause-stats',
  'screen-over', 'over-cause', 'over-title', 'over-new', 'over-score', 'over-best',
  'over-badges', 'over-stats', 'btn-retry', 'btn-over-modes', 'btn-over-menu',
  'toasts', 'ach-pop', 'ach-pop-icon', 'ach-pop-name', 'ach-pop-desc',
  'nogl', 'nogl-detail'
];

const UI = {
  E: {},
  screens: {},
  telMenu: null,
  telHud: null,
  hist: [],
  spark: 0,
  accent: '#38f0d0',
  selMode: 'classic',
  selDiff: 'normal',
  tab: 'color',
  achQ: [],
  achBusy: false,
  popPool: [],
  toastCount: 0,
  wipeArmed: false,
  muted: false,
  _prevAudio: null,
  _v: null,
  _dispScore: 0,
  _puSig: '',
  _puNodes: null,
  _hoverAt: 0,
  _telAt: 0,
  _flashT: null,

  /* --- setup ------------------------------------------------------------- */
  init: function () {
    const E = this.E;
    for (let i = 0; i < UI_IDS.length; i++) E[camel(UI_IDS[i])] = $(UI_IDS[i]);

    this.vig = E.fx.querySelector('.vig');
    this.scan = E.fx.querySelector('.scan');
    this.flashEl = E.fx.querySelector('.flash');
    this.edgeEl = E.fx.querySelector('.edge');

    this.screens[STATE.LOAD] = E.screenLoad;
    this.screens[STATE.MENU] = E.screenMenu;
    this.screens[STATE.MODES] = E.screenModes;
    this.screens[STATE.CUSTOM] = E.screenCustom;
    this.screens[STATE.ACH] = E.screenAch;
    this.screens[STATE.STATS] = E.screenStats;
    this.screens[STATE.SETTINGS] = E.screenSettings;
    this.screens[STATE.HELP] = E.screenHelp;
    this.screens[STATE.PAUSE] = E.screenPause;
    this.screens[STATE.OVER] = E.screenOver;

    this.telMenu = new Telemetry(E.telMenu);
    this.telHud = new Telemetry(E.telHud);
    for (let i = 0; i < 64; i++) this.hist.push(0.5);

    this.selMode = SaveManager.data.lastMode;
    this.selDiff = SaveManager.data.lastDiff;
    this._puNodes = {};

    this.wire();
    this.buildModes();
    this.buildHelp();
    this.buildSettings();
    this.applyPrefs();
    this.refreshMenu();
    this.resize();
  },

  /* one delegated hover sound keeps every control lively without 40 listeners */
  wire: function () {
    const E = this.E, self = this;

    on(document, 'mouseover', function (e) {
      const t = e.target;
      if (!t || !t.closest) return;
      const hit = t.closest('.btn,.card,.tabs button,.seg button,.sw');
      if (!hit || hit.disabled) return;
      const n = now();
      if (n - self._hoverAt < 70) return;
      self._hoverAt = n;
      Audio.play('hover');
    }, false);

    /* stop a long-press on the UI turning into a text selection or magnifier */
    on(document, 'contextmenu', function (e) {
      if (e.target && e.target.closest && e.target.closest('#dpad,#stage')) e.preventDefault();
    }, false);

    const tap = function (node, fn, snd) {
      on(node, 'click', function (e) {
        e.preventDefault();
        Audio.unlock();
        if (snd !== null) Audio.play(snd || 'click');
        fn();
      }, false);
    };
    this.tap = tap;

    tap(E.btnEnter, function () { Boot.enter(); }, 'start');

    /* main menu */
    tap(E.btnPlay, function () { Game.startLast(); }, 'start');
    tap(E.btnModes, function () { Game.goto(STATE.MODES); });
    if (E.btnMaps) {
      tap(E.btnMaps, function () { Game.goto(STATE.CUSTOM); self.setTab('arena'); });
    }
    tap(E.btnCustom, function () { Game.goto(STATE.CUSTOM); });
    tap(E.btnAch, function () { Game.goto(STATE.ACH); });
    tap(E.btnStats, function () { Game.goto(STATE.STATS); });
    tap(E.btnSettings, function () { Game.goto(STATE.SETTINGS); });
    tap(E.btnHelp, function () { Game.goto(STATE.HELP); });

    /* mode select */
    tap(E.btnModeStart, function () { Game.startSelected(); }, 'start');
    tap(E.btnModeBack, function () { Game.back(); }, 'back');
    if (E.btnModeMaps) {
      tap(E.btnModeMaps, function () { Game.goto(STATE.CUSTOM); self.setTab('arena'); });
    }

    /* customize tabs */
    const tabs = [E.tabColor, E.tabStyle, E.tabArena];
    for (let i = 0; i < tabs.length; i++) {
      (function (b) {
        tap(b, function () { self.setTab(b.getAttribute('data-tab')); });
      })(tabs[i]);
    }
    tap(E.btnCustBack, function () { Game.back(); }, 'back');

    /* the rest of the sub-screens */
    tap(E.btnAchBack, function () { Game.back(); }, 'back');
    tap(E.btnStatsBack, function () { Game.back(); }, 'back');
    tap(E.btnSetBack, function () { Game.back(); }, 'back');
    tap(E.btnHelpBack, function () { Game.back(); }, 'back');
    tap(E.btnSetDefault, function () { self.restoreDefaults(); });
    tap(E.btnWipe, function () { self.wipe(); }, 'deny');

    /* HUD + pause */
    tap(E.btnPause, function () { Game.pause(); });
    tap(E.btnResume, function () { Game.resume(); });
    tap(E.btnRestart, function () { Game.restart(); }, 'start');
    tap(E.btnPauseSettings, function () { Game.goto(STATE.SETTINGS); });
    tap(E.btnQuit, function () { Game.quitToMenu(); }, 'back');

    /* game over */
    tap(E.btnRetry, function () { Game.restart(); }, 'start');
    tap(E.btnOverModes, function () { Game.goto(STATE.MODES); });
    tap(E.btnOverMenu, function () { Game.quitToMenu(); }, 'back');
  },

  /* --- screens ----------------------------------------------------------- */
  show: function (state) {
    for (const k in this.screens) {
      const node = this.screens[k];
      if (!node) continue;
      toggleClass(node, 'active', k === state);
      node.setAttribute('aria-hidden', k === state ? 'false' : 'true');
    }
    /* move focus somewhere sensible for keyboard and screen-reader users */
    const first = this.screens[state] ? this.screens[state].querySelector('.btn.primary,.btn') : null;
    if (first && !IS_TOUCH) { try { first.focus({ preventScroll: true }); } catch (e) { } }
    this.resize();
  },

  hudOn: function (on) {
    const E = this.E, s = SaveManager.data.settings;
    toggleClass(E.hud, 'on', on);
    E.hud.setAttribute('aria-hidden', on ? 'false' : 'true');
    const wantTouch = on && IS_TOUCH;
    toggleClass(E.touch, 'on', wantTouch);
    toggleClass(E.dpad, 'on', wantTouch && s.touchMode !== 'swipe');
    if (!on) this.swipeHint(false);
  },

  /* --- generated: mode select ------------------------------------------- */
  buildModes: function () {
    const E = this.E, self = this;
    E.modeGrid.innerHTML = '';
    for (let i = 0; i < MODES.length; i++) {
      (function (m) {
        const b = el('button', 'card');
        b.setAttribute('data-mode', m.id);
        b.setAttribute('type', 'button');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'mode-ico');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', m.icon);
        svg.appendChild(p);
        b.appendChild(svg);
        b.appendChild(el('span', 't', m.name));
        b.appendChild(el('span', 'meta', m.tag));
        const best = el('span', 'meta');
        best.setAttribute('data-best', m.id);
        b.appendChild(best);
        self.tap(b, function () { self.setMode(m.id); }, null);
        E.modeGrid.appendChild(b);
      })(MODES[i]);
    }

    E.diffSeg.innerHTML = '';
    for (let i = 0; i < DIFFS.length; i++) {
      (function (d, n) {
        const b = el('button', null, d.name);
        b.setAttribute('type', 'button');
        b.setAttribute('role', 'radio');
        b.setAttribute('data-diff', d.id);
        b.setAttribute('aria-checked', 'false');
        b.title = 'Difficulty ' + n + ' — ' + d.desc;
        self.tap(b, function () { self.setDiff(d.id); }, null);
        E.diffSeg.appendChild(b);
      })(DIFFS[i], i + 1);
    }

    this.setMode(this.selMode, true);
    this.setDiff(this.selDiff, true);
  },

  setMode: function (id, quiet) {
    if (!MODE_BY_ID[id]) id = 'classic';
    this.selMode = id;
    const kids = this.E.modeGrid.children;
    for (let i = 0; i < kids.length; i++) {
      toggleClass(kids[i], 'sel', kids[i].getAttribute('data-mode') === id);
    }
    setText(this.E.modeDesc, MODE_BY_ID[id].desc);
    SaveManager.data.lastMode = id;
    SaveManager.save();
    this.refreshModeBests();
    this.refreshMenuFoot();
    if (!quiet) Audio.play('click');
  },

  setDiff: function (id, quiet) {
    if (!DIFF_BY_ID[id]) id = 'normal';
    this.selDiff = id;
    const kids = this.E.diffSeg.children;
    for (let i = 0; i < kids.length; i++) {
      kids[i].setAttribute('aria-checked', kids[i].getAttribute('data-diff') === id ? 'true' : 'false');
    }
    const d = DIFF_BY_ID[id];
    setText(this.E.diffDesc, d.desc + '  ·  ' + d.sps.toFixed(1) + ' steps/s to start, up to ' + d.maxSps);
    SaveManager.data.lastDiff = id;
    SaveManager.save();
    this.refreshMenuFoot();
    if (!quiet) Audio.play('click');
  },

  cycleMode: function (delta) {
    let i = 0;
    for (let k = 0; k < MODES.length; k++) if (MODES[k].id === this.selMode) i = k;
    i = (i + delta + MODES.length) % MODES.length;
    this.setMode(MODES[i].id);
  },

  refreshModeBests: function () {
    const bm = SaveManager.data.bestByMode;
    const nodes = this.E.modeGrid.querySelectorAll('[data-best]');
    for (let i = 0; i < nodes.length; i++) {
      const id = nodes[i].getAttribute('data-best');
      const v = bm[id] || 0;
      setText(nodes[i], v > 0 ? 'BEST ' + v : 'NOT PLAYED');
    }
  },

  /* --- generated: customize --------------------------------------------- */
  setTab: function (tab) {
    this.tab = tab;
    const E = this.E;
    const map = { color: E.tabColor, style: E.tabStyle, arena: E.tabArena };
    const panes = { color: E.paneColor, style: E.paneStyle, arena: E.paneArena };
    for (const k in map) {
      map[k].setAttribute('aria-selected', k === tab ? 'true' : 'false');
      toggleClass(panes[k], 'hidden', k !== tab);
    }
    this.custHint();
  },

  buildCustom: function () {
    const E = this.E;
    this._pane(E.paneColor, COLORS, 'color');
    this._pane(E.paneStyle, SKINS, 'style');
    this._pane(E.paneArena, ARENAS, 'arena');
    setText(E.custUnlock, 'BEST SCORE ' + SaveManager.data.best);
    this.setTab(this.tab);
  },

  _pane: function (host, list, kind) {
    const self = this;
    const best = SaveManager.data.best;
    const chosen = SaveManager.data.skin[kind];
    host.innerHTML = '';
    for (let i = 0; i < list.length; i++) {
      (function (item) {
        const b = el('button', 'card');
        b.setAttribute('type', 'button');
        b.setAttribute('data-id', item.id);
        const unlocked = best >= item.unlock;

        if (kind === 'color') {
          const sw = el('span', 'swatch');
          sw.style.background = 'linear-gradient(100deg,' + hexCss(item.glow) + ',' + hexCss(item.base) + ')';
          sw.style.boxShadow = '0 0 22px -6px ' + hexCss(item.base);
          b.appendChild(sw);
        } else if (kind === 'arena') {
          const sw = el('span', 'swatch');
          sw.style.background = 'linear-gradient(100deg,' + hexCss(item.floor) + ' 0%,' +
            hexCss(item.line) + ' 58%,' + hexCss(item.glow) + ' 100%)';
          b.appendChild(sw);
        }
        b.appendChild(el('span', 't', item.name));
        if (item.desc) b.appendChild(el('span', 'd', item.desc));
        if (!unlocked) {
          b.classList.add('locked');
          b.appendChild(el('span', 'lock', String(item.unlock)));
          b.appendChild(el('span', 'meta', 'Locked'));
        } else if (item.id === chosen) {
          b.classList.add('sel');
          b.appendChild(el('span', 'meta', 'Equipped'));
        } else {
          b.appendChild(el('span', 'meta', 'Ready'));
        }

        self.tap(b, function () {
          if (!unlocked) {
            Audio.play('deny');
            self.toast('Locked — beat ' + item.unlock + ' to unlock ' + item.name, 'warn');
            return;
          }
          Audio.play('click');
          SaveManager.data.skin[kind] = item.id;
          SaveManager.save();
          Game.applyLook();
          self.buildCustom();
        }, null);
        host.appendChild(b);
      })(list[i]);
    }
  },

  custHint: function () {
    const d = SaveManager.data.skin;
    const find = function (list, id) {
      for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return list[0];
    };
    const c = find(COLORS, d.color), s = find(SKINS, d.style), a = find(ARENAS, d.arena);
    let next = null;
    const all = [].concat(COLORS, SKINS, ARENAS);
    for (let i = 0; i < all.length; i++) {
      if (all[i].unlock > SaveManager.data.best && (!next || all[i].unlock < next.unlock)) next = all[i];
    }
    let txt = 'Equipped: ' + c.name + ' · ' + s.name + ' · ' + a.name + '.';
    txt += next ? '  Next unlock at ' + next.unlock + ' — ' + next.name + '.'
                : '  Everything is unlocked. Nice work.';
    setText(this.E.custHint, txt);
  },

  /* --- generated: achievements ------------------------------------------ */
  buildAch: function () {
    const E = this.E;
    const got = SaveManager.data.achievements;
    let n = 0;
    E.achList.innerHTML = '';
    for (let i = 0; i < ACHIEVEMENTS.length; i++) {
      const a = ACHIEVEMENTS[i];
      const has = got[a.id] === true;
      if (has) n++;
      const row = el('div', 'ach' + (has ? ' got' : ''));
      row.appendChild(el('div', 'badge', has ? a.glyph : '?'));
      const txt = el('div', 'txt');
      txt.appendChild(el('b', null, a.name));
      txt.appendChild(el('span', null, a.desc));
      row.appendChild(txt);
      row.appendChild(el('span', 'tick', has ? 'UNLOCKED' : 'LOCKED'));
      E.achList.appendChild(row);
    }
    setText(E.achCount, n + ' / ' + ACHIEVEMENTS.length + ' unlocked');
  },

  /* --- generated: statistics -------------------------------------------- */
  buildStats: function () {
    const E = this.E, st = SaveManager.data.stats;
    const rows = [
      ['High score', SaveManager.data.best],
      ['Total games', st.games],
      ['Cores eaten', st.food],
      ['Longest snake', st.longest],
      ['Best combo', '×' + st.bestCombo],
      ['Longest survival', fmtTime(st.survival)],
      ['Power-ups taken', st.powerups],
      ['Highest level', st.level],
      ['Lifetime score', st.score],
      ['Time played', fmtTime(st.playtime)],
      ['Challenge levels cleared', st.challengeLevel + ' / 12'],
      ['Achievements', this.achCount() + ' / ' + ACHIEVEMENTS.length]
    ];
    E.statsGrid.innerHTML = '';
    for (let i = 0; i < rows.length; i++) {
      const d = el('div', 'stat');
      d.appendChild(el('span', null, rows[i][0]));
      d.appendChild(el('b', null, String(rows[i][1])));
      E.statsGrid.appendChild(d);
    }
    E.statsModes.innerHTML = '';
    for (let i = 0; i < MODES.length; i++) {
      const m = MODES[i];
      const d = el('div', 'stat');
      d.appendChild(el('span', null, m.name));
      d.appendChild(el('b', null, String(SaveManager.data.bestByMode[m.id] || 0)));
      E.statsModes.appendChild(d);
    }
    this.wipeArmed = false;
    setText(E.btnWipe, 'Erase all data');
  },

  achCount: function () {
    let n = 0;
    const got = SaveManager.data.achievements;
    for (let i = 0; i < ACHIEVEMENTS.length; i++) if (got[ACHIEVEMENTS[i].id] === true) n++;
    return n;
  },

  wipe: function () {
    if (!this.wipeArmed) {
      this.wipeArmed = true;
      setText(this.E.btnWipe, 'Tap again to erase everything');
      this.toast('This clears scores, skins and achievements', 'warn');
      const self = this;
      setTimeout(function () {
        if (!self.wipeArmed) return;
        self.wipeArmed = false;
        setText(self.E.btnWipe, 'Erase all data');
      }, 4000);
      return;
    }
    this.wipeArmed = false;
    SaveManager.wipe();
    this.selMode = SaveManager.data.lastMode;
    this.selDiff = SaveManager.data.lastDiff;
    this.setMode(this.selMode, true);
    this.setDiff(this.selDiff, true);
    Game.applyLook();
    Game.applySettings();
    this.buildSettings();
    this.buildStats();
    this.refreshMenu();
    this.toast('All data erased', 'good');
  },

  /* --- generated: settings ---------------------------------------------- */
  buildSettings: function () {
    const host = this.E.settingsBody, self = this;
    const s = SaveManager.data.settings;
    host.innerHTML = '';

    for (let i = 0; i < SETTINGS_SCHEMA.length; i++) {
      const item = SETTINGS_SCHEMA[i];
      if (item.group) {
        const h = el('h3', null, item.group);
        if (i > 0) h.style.marginTop = '18px';
        host.appendChild(h);
        continue;
      }
      const row = el('div', 'opt');
      const lbl = el('span', 'lbl');
      lbl.appendChild(el('b', null, item.label));
      if (item.hint) lbl.appendChild(el('span', null, item.hint));
      row.appendChild(lbl);

      if (item.type === 'switch') {
        (function (key) {
          const sw = el('div', 'sw');
          sw.setAttribute('role', 'switch');
          sw.setAttribute('tabindex', '0');
          sw.setAttribute('aria-checked', s[key] ? 'true' : 'false');
          sw.setAttribute('aria-label', item.label);
          const flip = function () {
            const v = !(SaveManager.data.settings[key]);
            sw.setAttribute('aria-checked', v ? 'true' : 'false');
            self.change(key, v);
          };
          on(sw, 'click', function (e) { e.preventDefault(); Audio.unlock(); Audio.play('click'); flip(); }, false);
          on(sw, 'keydown', function (e) {
            if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); Audio.play('click'); flip(); }
          }, false);
          row.appendChild(sw);
        })(item.key);

      } else if (item.type === 'range') {
        (function (key) {
          const inp = document.createElement('input');
          inp.type = 'range';
          inp.min = item.min; inp.max = item.max; inp.step = item.step;
          inp.value = s[key];
          inp.setAttribute('aria-label', item.label);
          const val = el('span', 'val', String(s[key]));
          on(inp, 'input', function () {
            const v = parseInt(inp.value, 10);
            setText(val, String(v));
            self.change(key, v, true);
          }, false);
          on(inp, 'change', function () {
            Audio.play('click');
            SaveManager.save();
          }, false);
          row.appendChild(inp);
          row.appendChild(val);
        })(item.key);

      } else if (item.type === 'seg') {
        (function (key, options) {
          const seg = el('div', 'seg');
          seg.setAttribute('role', 'radiogroup');
          seg.setAttribute('aria-label', item.label);
          for (let k = 0; k < options.length; k++) {
            (function (o) {
              const b = el('button', null, o.t);
              b.setAttribute('type', 'button');
              b.setAttribute('role', 'radio');
              b.setAttribute('aria-checked', s[key] === o.v ? 'true' : 'false');
              on(b, 'click', function (e) {
                e.preventDefault();
                Audio.unlock();
                Audio.play('click');
                const kids = seg.children;
                for (let j = 0; j < kids.length; j++) kids[j].setAttribute('aria-checked', 'false');
                b.setAttribute('aria-checked', 'true');
                self.change(key, o.v);
              }, false);
              seg.appendChild(b);
            })(options[k]);
          }
          row.appendChild(seg);
        })(item.key, item.options);
      }
      host.appendChild(row);
    }
  },

  /* a single funnel for every settings write, so nothing gets applied twice */
  change: function (key, value, live) {
    const s = SaveManager.data.settings;
    if (s[key] === value) return;
    s[key] = value;
    if (!live) SaveManager.save();
    if (key === 'sfx' || key === 'music' || key === 'volSfx' || key === 'volMusic') {
      this.muted = false;
      Audio.applySettings();
    } else if (key === 'quality') {
      Game.applyQuality();
    } else if (key === 'particles') {
      Game.applyParticles();
    } else if (key === 'reduceMotion' || key === 'fps') {
      this.applyPrefs();
    } else if (key === 'touchMode') {
      this.hudOn(Game.state === STATE.PLAY);
    }
  },

  restoreDefaults: function () {
    const s = SaveManager.data.settings;
    for (const k in DEFAULT_SETTINGS) s[k] = DEFAULT_SETTINGS[k];
    SaveManager.save();
    this.muted = false;
    Audio.applySettings();
    Game.applyQuality();
    Game.applyParticles();
    this.applyPrefs();
    this.buildSettings();
    this.hudOn(Game.state === STATE.PLAY);
    this.toast('Settings restored', 'good');
  },

  applyPrefs: function () {
    const s = SaveManager.data.settings;
    toggleClass(document.documentElement, 'reduce-motion', !!s.reduceMotion);
    toggleClass(this.E.hudFps, 'hide', !s.fps);
  },

  toggleMute: function () {
    const s = SaveManager.data.settings;
    if (this.muted) {
      s.sfx = this._prevAudio ? this._prevAudio.sfx : true;
      s.music = this._prevAudio ? this._prevAudio.music : true;
      this.muted = false;
    } else {
      this._prevAudio = { sfx: s.sfx, music: s.music };
      s.sfx = false; s.music = false;
      this.muted = true;
    }
    Audio.applySettings();
    SaveManager.save();
    this.buildSettings();
    this.toast(this.muted ? 'Audio muted' : 'Audio on', this.muted ? 'warn' : 'good');
  },

  /* --- generated: how to play ------------------------------------------- */
  buildHelp: function () {
    const E = this.E;
    E.helpPowerups.innerHTML = '';
    for (let i = 0; i < POWERS.length; i++) {
      const p = POWERS[i];
      const d = el('div', 'def');
      const b = el('b', null, p.glyph + '  ' + p.name);
      b.style.color = hexCss(p.color);
      d.appendChild(b);
      d.appendChild(el('span', null, p.desc + (p.dur > 0 ? ' Lasts ' + p.dur + 's.' : '')));
      E.helpPowerups.appendChild(d);
    }
    E.helpModes.innerHTML = '';
    for (let i = 0; i < MODES.length; i++) {
      const m = MODES[i];
      const d = el('div', 'def');
      d.appendChild(el('b', null, m.name));
      d.appendChild(el('span', null, m.desc));
      E.helpModes.appendChild(d);
    }
  },

  /* --- menu surface ------------------------------------------------------ */
  refreshMenu: function () {
    this.refreshMenuFoot();
    this.refreshModeBests();
    this.buildChallenges();
  },

  refreshMenuFoot: function () {
    const m = MODE_BY_ID[this.selMode] || MODES[0];
    const d = DIFF_BY_ID[this.selDiff] || DIFFS[1];
    let curArena = ARENAS[0];
    const savedArena = SaveManager.data ? SaveManager.data.skin.arena : 'grid';
    for (let i = 0; i < ARENAS.length; i++) {
      if (ARENAS[i].id === savedArena) curArena = ARENAS[i];
    }
    setText(this.E.menuMode, m.name.toUpperCase() + ' · ' + d.name.toUpperCase() + ' · ' + curArena.name.toUpperCase());
    setText(this.E.menuBest, 'BEST ' + (SaveManager.data ? SaveManager.data.best : 0));
    if (this.E.modeMapName) {
      setText(this.E.modeMapName, curArena.name);
      if (this.E.modeMapDesc) setText(this.E.modeMapDesc, curArena.desc);
      if (this.E.modeMapSwatch) {
        this.E.modeMapSwatch.style.background = 'linear-gradient(100deg,' + hexCss(curArena.floor) + ' 0%,' +
          hexCss(curArena.line) + ' 58%,' + hexCss(curArena.glow) + ' 100%)';
      }
    }
  },

  buildChallenges: function () {
    const host = this.E.challenges;
    host.innerHTML = '';
    const c = SaveManager.data.challenges;
    if (!c || !c.list || !c.list.length) return;
    for (let i = 0; i < c.list.length; i++) {
      const item = c.list[i];
      const tpl = SaveManager.challengeTemplate(item.id);
      if (!tpl) continue;
      const box = el('div', 'chal' + (item.done ? ' done' : ''));
      const top = el('div', 'top');
      top.appendChild(el('b', null, tpl.label(item.target)));
      top.appendChild(el('i', null, item.done ? 'COMPLETE' : item.progress + ' / ' + item.target));
      box.appendChild(top);
      const bar = el('div', 'pbar');
      const fill = el('i');
      fill.style.width = clamp((item.progress / item.target) * 100, 0, 100).toFixed(1) + '%';
      bar.appendChild(fill);
      box.appendChild(bar);
      host.appendChild(box);
    }
  },

  /* --- accent ------------------------------------------------------------ */
  setAccentInt: function (int) {
    const css = hexCss(int);
    this.accent = css;
    const r = (int >> 16) & 255, g = (int >> 8) & 255, b = int & 255;
    const root = document.documentElement.style;
    root.setProperty('--accent', css);
    root.setProperty('--accent-soft', 'rgba(' + r + ',' + g + ',' + b + ',.13)');
  },

  /* --- HUD --------------------------------------------------------------- */
  frame: function (run, dt, fps) {
    if (!run) return;
    const E = this.E;

    /* the score rolls toward its target so a big combo reads as a surge */
    const target = run.score;
    if (Math.abs(target - this._dispScore) < 1.2) this._dispScore = target;
    else this._dispScore += (target - this._dispScore) * Math.min(1, dt * 14);
    setText(E.hudScore, String(Math.round(this._dispScore)));
    setText(E.hudBest, 'BEST ' + Math.max(run.best, run.score));
    setText(E.hudLevel, String(run.level));

    let label = 'Length', value = String(run.length);
    if (run.mode === 'time') { label = 'Time'; value = fmtTime(run.timeLeft); }
    else if (run.mode === 'survival') { label = 'Alive'; value = fmtTime(run.time); }
    else if (run.mode === 'endless') { label = 'Shrink'; value = fmtTime(run.nextShrink); }
    else if (run.mode === 'challenge') { label = 'Quota'; value = run.quotaGot + '/' + run.quotaNeed; }
    setText(E.hudInfoL, label);
    setText(E.hudInfo, value);

    const hot = run.mode === 'time' && run.timeLeft <= 10;
    E.hudInfo.style.color = hot ? 'var(--danger)' : '';

    /* combo */
    const on = run.combo >= 2;
    toggleClass(E.combo, 'on', on);
    if (on) {
      setText(E.comboTxt, 'COMBO ×' + run.combo);
      const frac = run.comboWindow > 0 ? clamp(run.comboT / run.comboWindow, 0, 1) : 0;
      E.comboBar.style.width = (frac * 100).toFixed(1) + '%';
    }

    setText(E.hudSpeed, run.sps.toFixed(1));
    setText(E.hudFood, String(run.food));
    if (SaveManager.data.settings.fps) setText(E.hudFps, Math.round(fps) + ' FPS');

    this.powerbar(run);
    this.telemetry(run, dt);
  },

  comboPop: function () {
    const n = this.E.combo;
    n.classList.remove('pop');
    void n.offsetWidth;
    n.classList.add('pop');
  },

  /* power-up chips: the DOM is only rebuilt when the set of effects changes */
  powerbar: function (run) {
    const pm = Game.powers;
    if (!pm) return;
    let sig = '';
    for (let i = 0; i < POWERS.length; i++) {
      if (pm.active[POWERS[i].id] !== undefined) sig += POWERS[i].id + ',';
    }
    if (sig !== this._puSig) {
      this._puSig = sig;
      this._puNodes = {};
      const host = this.E.powerbar;
      host.innerHTML = '';
      for (let i = 0; i < POWERS.length; i++) {
        const p = POWERS[i];
        if (pm.active[p.id] === undefined) continue;
        const chip = el('div', 'pu');
        chip.style.setProperty('--pc', hexCss(p.color));
        chip.appendChild(el('span', 'g', p.glyph));
        chip.appendChild(el('span', 'n', p.name));
        const t = el('span', 't', '');
        chip.appendChild(t);
        const ring = el('i', 'ring');
        chip.appendChild(ring);
        host.appendChild(chip);
        this._puNodes[p.id] = { chip: chip, t: t, ring: ring, dur: p.dur };
      }
    }
    for (const id in this._puNodes) {
      const n = this._puNodes[id];
      const left = pm.active[id];
      if (left === undefined) continue;
      if (left === Infinity) {
        setText(n.t, 'HELD');
        n.ring.style.width = '100%';
        toggleClass(n.chip, 'expiring', false);
      } else {
        setText(n.t, left.toFixed(1) + 's');
        n.ring.style.width = (clamp(left / Math.max(0.001, n.dur), 0, 1) * 100).toFixed(1) + '%';
        toggleClass(n.chip, 'expiring', left < 2.2);
      }
    }
  },

  /* --- telemetry strip --------------------------------------------------- */
  telemetry: function (run, dt) {
    const t = now();
    if (t - this._telAt < 55) return;
    this._telAt = t;
    /* normalised step rate, lifted by the current combo */
    const base = run ? clamp((run.sps - 4) / 16, 0, 1) : 0.25 + Math.sin(t / 900) * 0.12;
    const lift = run && run.combo > 1 ? clamp((run.combo - 1) / 10, 0, 0.4) : 0;
    this.hist.push(clamp(base * 0.75 + lift + Math.random() * 0.05, 0.02, 0.99));
    while (this.hist.length > 64) this.hist.shift();
    this.spark = Math.max(0, this.spark - 0.08);

    const st = Game.state;
    if (st === STATE.PLAY || st === STATE.PAUSE) this.telHud.draw(this.hist, this.accent, this.spark);
    else if (st === STATE.MENU) this.telMenu.draw(this.hist, this.accent, this.spark);
  },

  pulse: function () { this.spark = 1; },

  /* --- floating popups --------------------------------------------------- */
  popup: function (world, text, colorInt) {
    if (!Game.camera) return;
    if (!this._v) this._v = new THREE.Vector3();
    const v = this._v.copy(world).project(Game.camera);
    if (v.z > 1) return;
    const w = window.innerWidth, h = window.innerHeight;
    const x = (v.x * 0.5 + 0.5) * w;
    const y = (-v.y * 0.5 + 0.5) * h;
    if (x < -80 || y < -80 || x > w + 80 || y > h + 80) return;

    let node = null;
    for (let i = 0; i < this.popPool.length; i++) {
      if (!this.popPool[i]._busy) { node = this.popPool[i]; break; }
    }
    if (!node) {
      if (this.popPool.length >= 14) return;
      node = el('div', 'pop');
      this.E.popups.appendChild(node);
      this.popPool.push(node);
    }
    node._busy = true;
    node.textContent = text;
    node.style.color = hexCss(colorInt);
    node.style.left = x.toFixed(1) + 'px';
    node.style.top = y.toFixed(1) + 'px';
    node.classList.remove('go');
    void node.offsetWidth;
    node.classList.add('go');
    setTimeout(function () { node._busy = false; node.classList.remove('go'); }, 1100);
  },

  banner: function (big, small, colorCss) {
    const E = this.E;
    setText(E.bannerBig, big);
    setText(E.bannerSmall, small || '');
    E.bannerBig.style.color = colorCss || 'var(--accent)';
    E.banner.classList.remove('show');
    void E.banner.offsetWidth;
    E.banner.classList.add('show');
  },

  toast: function (text, kind) {
    const host = this.E.toasts;
    while (host.children.length > 2) host.removeChild(host.firstChild);
    const t = el('div', 'toast' + (kind ? ' ' + kind : ''), text);
    host.appendChild(t);
    setTimeout(function () {
      t.classList.add('out');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 340);
    }, 2400);
  },

  /* --- achievement popup queue ------------------------------------------ */
  achievement: function (def) {
    this.achQ.push(def);
    this._nextAch();
  },

  _nextAch: function () {
    if (this.achBusy || !this.achQ.length) return;
    const def = this.achQ.shift();
    const E = this.E, self = this;
    this.achBusy = true;
    setText(E.achPopIcon, def.glyph);
    setText(E.achPopName, def.name);
    setText(E.achPopDesc, def.desc);
    E.achPop.classList.add('show');
    Audio.play('achieve');
    setTimeout(function () {
      E.achPop.classList.remove('show');
      setTimeout(function () { self.achBusy = false; self._nextAch(); }, 420);
    }, 3000);
  },

  /* --- screen effects ---------------------------------------------------- */
  flash: function (strength) {
    if (SaveManager.data.settings.reduceMotion) strength *= 0.4;
    const n = this.flashEl;
    n.style.opacity = String(clamp(strength, 0, 0.55));
    if (this._flashT) clearTimeout(this._flashT);
    this._flashT = setTimeout(function () { n.style.opacity = '0'; }, 90);
  },

  edge: function (on) { toggleClass(this.edgeEl, 'on', on); },

  swipeHint: function (on) { toggleClass(this.E.swipeHint, 'on', on); },

  /* drop focus before play starts, so Space pauses instead of re-clicking
     whichever button was last used */
  blur: function () {
    const a = document.activeElement;
    if (a && a !== document.body && typeof a.blur === 'function') {
      try { a.blur(); } catch (e) { }
    }
  },

  /* --- loading + fallback ----------------------------------------------- */
  loadProgress: function (pct, msg) {
    setText(this.E.loadPct, Math.round(pct) + '%');
    this.E.loadBar.style.width = clamp(pct, 0, 100) + '%';
    if (msg) setText(this.E.loadMsg, msg);
  },

  loadReady: function () {
    this.E.btnEnter.classList.add('ready');
    setText(this.E.loadMsg, 'Systems nominal.');
    try { this.E.btnEnter.focus({ preventScroll: true }); } catch (e) { }
  },

  noWebGL: function (detail) {
    this.E.nogl.classList.add('on');
    setText(this.E.noglDetail, detail || '');
  },

  /* --- pause + game over ------------------------------------------------- */
  showPause: function (run) {
    const m = MODE_BY_ID[run.mode], d = DIFF_BY_ID[run.diff];
    setText(this.E.pauseSub, m.name + ' · ' + d.name);
    setText(this.E.pauseStats, 'SCORE ' + run.score + ' · LENGTH ' + run.length +
      ' · LEVEL ' + run.level + ' · ' + fmtTime(run.time));
  },

  showOver: function (run, info) {
    const E = this.E;
    setText(E.overCause, info.cause);
    setText(E.overTitle, info.title);
    toggleClass(E.overTitle, 'win', !!info.win);
    toggleClass(E.overNew, 'on', !!info.newBest);
    setText(E.overScore, String(run.score));
    setText(E.overBest, String(SaveManager.data.best));

    E.overBadges.innerHTML = '';
    const badges = [MODE_BY_ID[run.mode].name, DIFF_BY_ID[run.diff].name];
    if (run.bestCombo >= 2) badges.push('×' + run.bestCombo + ' combo');
    if (run.powerups > 0) badges.push(run.powerups + ' power-ups');
    if (run.saves > 0) badges.push(run.saves + ' shield save' + (run.saves > 1 ? 's' : ''));
    for (let i = 0; i < badges.length; i++) {
      const p = el('span', 'tagpill' + (i === 0 ? ' hot' : ''), badges[i]);
      E.overBadges.appendChild(p);
    }

    const rows = [
      ['Cores', run.food],
      ['Length', run.length],
      ['Level', run.level],
      ['Survived', fmtTime(run.time)],
      ['Top speed', run.topSps.toFixed(1) + ' /s'],
      ['Best combo', '×' + run.bestCombo]
    ];
    E.overStats.innerHTML = '';
    for (let i = 0; i < rows.length; i++) {
      const d = el('div', 'stat');
      d.appendChild(el('span', null, rows[i][0]));
      d.appendChild(el('b', null, String(rows[i][1])));
      E.overStats.appendChild(d);
    }
  },

  /* --- resize ------------------------------------------------------------ */
  resize: function () {
    this.telMenu.resize();
    this.telHud.resize();
  }
};
