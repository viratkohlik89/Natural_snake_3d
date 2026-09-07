
/* ===========================================================================
   14 — SIMULATION
   One grid beat, and everything that hangs off it: collisions, eating,
   power-ups, combo, levels, the per-mode clocks and the end of a run.
   ========================================================================= */

/* Two achievements measure something that can only get worse as a run goes
   on ("no shield saves", "no power-ups"), so they are only ever tested at
   the end — checking them mid-run would hand them out on the first core. */
const END_ONLY_ACH = { perfect: 1, nopower: 1 };

Game.simulate = function (dt) {
  const run = this.run;
  if (!run) return;
  run.time += dt;

  /* power-up pickups and running effects share one clock */
  this.powers.update(dt, this.elapsed);
  this.syncEffects();

  /* combo window */
  if (run.combo > 0) {
    run.comboT -= dt;
    if (run.comboT <= 0) {
      if (run.combo >= 2) UI.toast('Combo ×' + run.combo + ' lost', 'warn');
      run.combo = 0;
      run.comboT = 0;
    }
  }

  /* the next power-up */
  this.powers.timer -= dt;
  if (this.powers.timer <= 0) {
    const diff = DIFF_BY_ID[run.diff];
    const made = this.powers.spawn(this.freeFn, null);
    /* a failed spawn retries soon; a successful one resets the long timer */
    this.powers.timer = made ? rnd(12, 18) / Math.max(0.4, diff.power) : 3;
    if (made) Audio.play('spawn');
  }

  /* mode clocks can end the run, so bail out if they did */
  this.modeTick(dt);
  if (this.state !== STATE.PLAY) return;

  /* --- fixed-step grid simulation ------------------------------------- */
  this.stepInterval = this.currentInterval();
  this.stepAcc += dt;
  let budget = 3;                      /* never try to catch up a whole tab-switch */
  while (this.stepAcc >= this.stepInterval && budget-- > 0) {
    this.stepAcc -= this.stepInterval;
    this.step();
    if (this.state !== STATE.PLAY) { this.stepAcc = 0; break; }
    this.stepInterval = this.currentInterval();
  }
  if (this.stepAcc > this.stepInterval) this.stepAcc = this.stepInterval;
  this.stepT = clamp(this.stepAcc / this.stepInterval, 0, 1);
};

/* Steps per second, after the level ramp, the mode and any speed effect.
   Slow motion deliberately changes the step rate rather than a global time
   scale, so power-up countdowns still run in real seconds. */
Game.currentInterval = function () {
  const run = this.run;
  const diff = DIFF_BY_ID[run.diff];
  let sps = Math.min(diff.maxSps, diff.sps + (run.level - 1) * diff.ramp);
  if (run.mode === 'time') sps *= 1.12;         /* Time Attack runs hot */
  if (this.powers.has('speed')) sps *= 1.55;
  if (this.powers.has('slow')) sps /= 1.9;
  run.sps = sps;
  if (sps > run.topSps) run.topSps = sps;
  return 1 / sps;
};

/* mirror the active effects onto the things that render them */
Game.syncEffects = function () {
  const g = this.powers.has('ghost');
  if (g !== this._ghost) {
    this._ghost = g;
    this.snake.setGhost(g);
    if (!g) UI.toast('Ghost mode ended', 'warn');
  }
  const s = this.powers.has('shield');
  if (s !== this._shield) { this._shield = s; this.snake.setShield(s); }
  const f = this.powers.has('freeze');
  if (f !== this._freeze) { this._freeze = f; this.obstacles.setFrozen(f); }
  UI.edge(g || s);
};

/* ===========================================================================
   one beat
   ========================================================================= */
Game.step = function () {
  const run = this.run;
  const snake = this.snake;

  /* hazards move first, so the danger map we test is the one the player is
     about to see drawn */
  this.obstacles.stepUpdate();
  run.steps++;

  const turn = Input.take();
  if (turn && turn !== OPPOSITE[snake.dir]) snake.dir = turn;

  const h = snake.cells[0];
  let d = DIRS[snake.dir];
  let nx = h.x + d.x, ny = h.y + d.y;

  /* If the head is already inside something solid — a ghost effect ended
     while overlapping, or a block materialised on top of us — the next move
     is forgiven so there is always a way out. */
  const stuck = this.obstacles.blockedAt(h.x, h.y) || this.headOverlapping();
  const ghost = this.powers.has('ghost');

  let cause = this.hazardAt(nx, ny, ghost, stuck);

  /* standing in the burn ring is fatal, but the growth step itself is free */
  if (!cause && this.inBurn(h.x, h.y) && !this.burnGrace) cause = 'burn';
  this.burnGrace = false;

  /* --- shield: burn the charge and steer clear instead of dying --------- */
  if (cause) {
    const alt = this.powers.has('shield') ? this.safeNeighbour(h, snake.dir, ghost) : null;
    if (alt) {
      this.powers.consume('shield');
      this._shield = false;
      snake.setShield(false);
      run.saves++;
      snake.flinch();
      Audio.play('shield');
      UI.flash(0.45);
      this.addShake(0.5);
      UI.toast('Shield absorbed the hit', 'good');
      this.particles.burst(worldX(h.x), BODY_Y, worldZ(h.y), {
        color: 0x54e08a, count: 34, speed: 7, size: 0.5, life: 0.6, gravity: -1, spread: 1.4
      });
      snake.dir = alt;
      Input.reset(alt);
      d = DIRS[alt];
      nx = h.x + d.x; ny = h.y + d.y;
      cause = null;
    } else {
      this.die(cause);
      return;
    }
  }

  /* --- commit the move -------------------------------------------------- */
  snake.stepTo({ x: nx, y: ny });
  this.refreshOcc();
  run.length = snake.cells.length;

  const fi = this.food.at(nx, ny);
  if (fi >= 0) this.eat(fi, nx, ny);
  if (this.state !== STATE.PLAY) return;

  const pi = this.powers.at(nx, ny);
  if (pi >= 0) this.pickup(pi, nx, ny);

  /* magnet drags loose cores one cell closer per beat */
  if (this.powers.has('magnet')) this.food.magnet(nx, ny, 5, this.freeFn);

  this.topUpFood();
  Audio.setIntensity(clamp((run.sps - 5) / 12 + (run.combo > 1 ? 0.22 : 0), 0, 1));
};

/* what, if anything, kills us at this cell */
Game.hazardAt = function (x, y, ghost, stuck) {
  if (!inBounds(x, y)) return 'wall';
  if (this.inBurn(x, y)) return 'burn';
  if (this.obstacles.lethalAt(x, y)) return 'hazard';
  if (this.obstacles.blockedAt(x, y)) return (ghost || stuck) ? null : 'block';
  if (this.selfHit(x, y)) return (ghost || stuck) ? null : 'self';
  return null;
};

/* a perpendicular turn that survives this beat, or null */
Game.safeNeighbour = function (h, dir, ghost) {
  const opts = (dir === 'up' || dir === 'down') ? ['left', 'right'] : ['up', 'down'];
  /* try sideways first, then straight on — never a 180 */
  opts.push(dir);
  for (let i = 0; i < opts.length; i++) {
    const d = DIRS[opts[i]];
    if (!this.hazardAt(h.x + d.x, h.y + d.y, ghost, false)) return opts[i];
  }
  return null;
};

/* ===========================================================================
   eating
   ========================================================================= */
Game.eat = function (index, x, y) {
  const run = this.run;
  const item = this.food.items[index];
  if (!item) return;
  const rare = !!item.rare;
  const value = item.value || 1;
  const mode = MODE_BY_ID[run.mode];
  const diff = DIFF_BY_ID[run.diff];
  const wx = worldX(x), wz = worldZ(y);
  this.food.remove(index, false);

  /* combo climbs first, so this core scores at the new multiplier */
  run.combo += 1;
  run.comboWindow = clamp(9 / Math.max(1, run.sps) + 1.2, 1.5, 3.6);
  run.comboT = run.comboWindow;
  if (run.combo > run.bestCombo) run.bestCombo = run.combo;

  let gained = value * 10 * Math.max(1, run.combo) * diff.scoreMul * mode.scoreMul;
  if (this.powers.has('double')) gained *= 2;
  if (this.powers.has('speed')) gained *= 1.25;
  gained = Math.max(1, Math.round(gained));
  run.score += gained;
  run.food += 1;

  this.snake.grow(rare ? 2 : 1);
  this.snake.bite();

  /* Time Attack: every core buys two more seconds */
  if (run.mode === 'time') run.timeLeft = Math.min(999, run.timeLeft + 2);

  /* --- feedback --------------------------------------------------------- */
  const v = this._v3.set(wx, 0.95, wz);
  UI.popup(v, '+' + gained, rare ? 0xb39dff : this.accentInt);
  this.particles.burst(wx, 0.62, wz, {
    color: rare ? 0xb39dff : this.accentInt,
    count: rare ? 46 : 26, speed: rare ? 8 : 5.6,
    size: rare ? 0.58 : 0.46, life: 0.66, gravity: -2.2, spread: 1.3
  });
  Audio.play(rare ? 'bigfood' : 'eat', run.combo);
  UI.pulse();
  if (rare) {
    UI.flash(0.22);
    this.addShake(0.22);
  } else if (run.combo >= 2) {
    this.addShake(0.10);
  }
  if (run.combo >= 2) {
    UI.comboPop();
    if (run.combo % 3 === 0) Audio.play('combo');
    if (run.combo === 8) UI.toast('Combo ×8 — that is the good stuff', 'good');
  }

  /* --- persistent counters --------------------------------------------- */
  const st = SaveManager.data.stats;
  st.food += 1;
  if (run.length > st.longest) st.longest = run.length;
  this.challengeDone(SaveManager.bumpChallenges('food', 1));
  this.challengeDone(SaveManager.bumpChallenges('runScore', run.score));
  this.challengeDone(SaveManager.bumpChallenges('runCombo', run.bestCombo));

  /* --- progression ------------------------------------------------------ */
  if (run.mode === 'challenge') {
    run.quotaGot += 1;
    if (run.quotaGot >= run.quotaNeed) { this.nextLayout(); return; }
  } else {
    const want = 1 + Math.floor(run.food / 5);
    if (want > run.level) { this.levelUp(want); return; }
  }
  this.checkAchievements(false);
};

Game.levelUp = function (n) {
  const run = this.run;
  run.level = n;
  const st = SaveManager.data.stats;
  if (n > st.level) st.level = n;

  this.growObstacles(n);
  Audio.play('level');
  UI.banner('LEVEL ' + n, 'Step rate up', hexCss(this.accentInt));
  UI.flash(0.3);
  this.addShake(0.28);
  UI.pulse();
  this.particles.burst(this.snake.headPos.x, BODY_Y, this.snake.headPos.z, {
    color: this.accentInt, count: 40, speed: 9, size: 0.5, life: 0.8, gravity: -1.2, spread: 1.6
  });
  this.challengeDone(SaveManager.bumpChallenges('runLevel', n));
  this.checkAchievements(false);
};

/* Hazards arrive one at a time, always through addRandomHazard so the
   fairness guard applies: nothing appears within five cells of the head or
   in the corridor straight ahead of it. */
Game.growObstacles = function (level) {
  const run = this.run;
  if (run.mode === 'time' || run.mode === 'challenge') return;
  const diff = DIFF_BY_ID[run.diff];
  if (diff.obst <= 0) return;
  if (this.obstacles.count() >= MAX_OBSTACLES) return;
  if (level < 3) return;                       /* the first two levels are clean */

  const live = [];
  if (level >= 3) live.push('patrol');
  if (level >= 5) live.push('spike');
  if (level >= 6) live.push('laser');
  if (level >= 8) live.push('pad');
  if (level >= 9) live.push('spinner');

  let n = 1;
  if (diff.obst >= 1.4 && level >= 5) n = 2;
  if (diff.obst >= 1.8 && level >= 7) n = 3;

  for (let i = 0; i < n; i++) {
    if (this.obstacles.count() >= MAX_OBSTACLES) break;
    /* mostly static cover, with a live hazard mixed in as levels climb */
    const wantLive = live.length && Math.random() < clamp(0.25 + level * 0.06, 0, 0.75);
    this.obstacles.addRandomHazard(wantLive ? live : ['block'], this.hazardFn);
  }
};

/* ===========================================================================
   power-ups
   ========================================================================= */
Game.pickup = function (index, x, y) {
  const run = this.run;
  const item = this.powers.items[index];
  if (!item) return;
  const def = item.def;
  const wx = worldX(x), wz = worldZ(y);
  this.powers.remove(index, false);
  this.powers.activate(def);

  run.powerups += 1;
  const bonus = Math.round(20 * DIFF_BY_ID[run.diff].scoreMul);
  run.score += bonus;

  const st = SaveManager.data.stats;
  st.powerups += 1;
  this.challengeDone(SaveManager.bumpChallenges('powerups', 1));

  /* freeze also holds the mode clocks, which is the only way it can matter
     in Time Attack — that mode has no hazards to freeze */
  let sub = def.dur > 0 ? def.dur + ' seconds' : 'Held until it saves you';
  if (def.id === 'freeze') sub = def.dur + ' seconds · hazards and clocks held';

  Audio.play('power');
  UI.banner(def.name.toUpperCase(), sub, hexCss(def.color));
  UI.popup(this._v3.set(wx, 1.0, wz), def.glyph + ' +' + bonus, def.color);
  UI.flash(0.36);
  this.addShake(0.34);
  UI.pulse();
  this.particles.burst(wx, 0.65, wz, {
    color: def.color, count: 54, speed: 9.5, size: 0.55, life: 0.8, gravity: -1, spread: 1.7
  });
  this.syncEffects();
  this.checkAchievements(false);
};

/* ===========================================================================
   per-mode clocks
   ========================================================================= */
Game.modeTick = function (dt) {
  const run = this.run;
  const held = this.powers.has('freeze');

  /* once-a-second bookkeeping */
  this.timeScoreAcc += dt;
  while (this.timeScoreAcc >= 1) {
    this.timeScoreAcc -= 1;
    this.challengeDone(SaveManager.bumpChallenges('runTime', Math.floor(run.time)));
    if (run.mode === 'survival') {
      run.score += Math.max(1, Math.round(3 * DIFF_BY_ID[run.diff].scoreMul));
    }
    this.checkAchievements(false);
  }

  if (run.mode === 'time') {
    if (!held) run.timeLeft -= dt;
    const whole = Math.ceil(run.timeLeft);
    if (whole !== this._tickAt) {
      this._tickAt = whole;
      if (whole <= 10 && whole > 0) Audio.play('tick');
    }
    if (run.timeLeft <= 0) {
      run.timeLeft = 0;
      this.finish('time');
    }
  } else if (run.mode === 'endless') {
    if (!held) run.nextShrink -= dt;
    if (run.nextShrink <= 0) {
      run.nextShrink = SHRINK_EVERY;
      this.shrink();
    }
  } else if (run.mode === 'survival') {
    if (!held) this.hazardT -= dt;
    if (this.hazardT <= 0) {
      this.hazardT = HAZARD_EVERY;
      this.addSurvivalHazard();
    }
  }
};

/* Endless: the outer ring turns lethal and the interior is re-laid out —
   the old layout is half inside the fire by now anyway. */
Game.shrink = function () {
  const run = this.run;
  if (this.burnRing >= MAX_BURN) {
    /* the arena is as small as it will get; keep the pressure on with a
       hazard instead so the mode never runs out of things to do */
    this.addSurvivalHazard();
    return;
  }
  this.burnRing += 1;
  this.arena.setBurn(this.burnRing);
  this.burnGrace = true;                 /* one free beat to get out */

  for (let i = this.food.items.length - 1; i >= 0; i--) {
    const c = this.food.items[i].cell;
    if (this.inBurn(c.x, c.y)) this.food.remove(i, true);
  }
  for (let i = this.powers.items.length - 1; i >= 0; i--) {
    const c = this.powers.items[i].cell;
    if (this.inBurn(c.x, c.y)) this.powers.remove(i, true);
  }

  this.obstacles.clear();
  this.obstacles.guard = this.hazardFn;
  this.obstacles.generate('endless', DIFF_BY_ID[run.diff], run.level);
  this.obstacles.guard = null;

  const side = GRID - this.burnRing * 2;
  UI.banner('ARENA BURN ' + this.burnRing, side + ' × ' + side + ' left', hexCss(0xff2e88));
  UI.flash(0.42);
  this.addShake(0.6);
  Audio.play('hurt');
  this.topUpFood();
};

Game.addSurvivalHazard = function () {
  if (this.obstacles.count() >= MAX_OBSTACLES) return;
  const kinds = ['patrol', 'laser', 'spike', 'pad', 'block'];
  if (this.run.level >= 4) kinds.push('spinner');
  const made = this.obstacles.addRandomHazard(kinds, this.hazardFn);
  if (made) {
    UI.banner('HAZARD ONLINE', this.obstacles.count() + ' on the field', hexCss(0xff2e88));
    Audio.play('spawn');
    this.addShake(0.3);
  }
};

/* Challenge: quota met, so the arena reconfigures and you start the next
   layout from a clean opening. */
Game.nextLayout = function () {
  const run = this.run;
  if (run.level >= 12) {
    run.won = true;
    this.finish('won');
    return;
  }
  run.level += 1;
  run.quotaGot = 0;
  run.quotaNeed = 4 + run.level;

  const st = SaveManager.data.stats;
  if (run.level > st.challengeLevel) st.challengeLevel = run.level;
  if (run.level > st.level) st.level = run.level;

  /* the phase shift: reset the snake first so the new layout is built around
     it, never on top of it */
  this.particles.burst(this.snake.headPos.x, BODY_Y, this.snake.headPos.z, {
    color: this.accentInt, count: 60, speed: 11, size: 0.55, life: 0.9, gravity: -1, spread: 1.8
  });
  const cells = [];
  for (let i = 0; i < START_LEN; i++) cells.push({ x: START_X - i, y: HALF });
  this.snake.reset(cells, 'right');
  Input.reset('right');
  this.refreshOcc();
  run.length = START_LEN;

  this.food.clear();
  this.powers.clear();
  this._ghost = this._shield = this._freeze = false;
  this.snake.setGhost(false);
  this.snake.setShield(false);
  this.buildLayout(run.level);
  this.topUpFood();
  this.powers.timer = 10;
  this.stepAcc = 0;

  Audio.play('level');
  UI.banner('LAYOUT ' + run.level, 'Quota ' + run.quotaNeed + ' cores', hexCss(this.accentInt));
  UI.flash(0.4);
  this.addShake(0.4);
  UI.pulse();
  this.challengeDone(SaveManager.bumpChallenges('runLevel', run.level));
  this.checkAchievements(false);
};

/* ===========================================================================
   ending a run
   ========================================================================= */
Game.die = function (cause) {
  this.snake.flinch();
  Audio.play('death');
  this.particles.burst(this.snake.headPos.x, BODY_Y, this.snake.headPos.z, {
    color: 0xff2e88, count: 90, speed: 13, size: 0.62, life: 1.1, gravity: -3, spread: 2
  });
  this.endRun({
    cause: CAUSES[cause] || 'Collision',
    title: 'Run ended',
    win: false
  });
};

Game.finish = function (kind) {
  const run = this.run;
  const won = kind === 'won';
  run.won = won;
  Audio.play('win');
  this.endRun({
    cause: won ? 'All twelve layouts cleared' : 'The clock ran out',
    title: won ? 'Grid mastered' : 'Time up',
    win: true
  });
};

Game.endRun = function (info) {
  const run = this.run;
  run.length = this.snake.cells.length;

  const prevBest = SaveManager.data.best;
  info.newBest = run.score > prevBest;
  this.over = info;
  this.death = { t: 0, i: 0, shown: false, win: !!info.win, len: run.length };

  const unlocked = this.commitRun(run);

  /* the world stops with the player */
  Input.clear();
  this.powers.clear();
  this.obstacles.setFrozen(true);
  this.snake.setGhost(false);
  this.snake.setShield(false);
  this._ghost = this._shield = this._freeze = false;
  UI.edge(false);
  Audio.setIntensity(0.08);
  Audio.duck(0.7);
  this.addShake(info.win ? 0.45 : 1.2);
  UI.flash(info.win ? 0.45 : 0.9);

  /* bypass goto: the sheet arrives after the death animation, not before */
  this.state = STATE.OVER;
  UI.hudOn(false);
  UI.swipeHint(false);

  if (info.newBest) UI.toast('New best score · ' + run.score, 'good');
  for (let i = 0; i < unlocked.length; i++) {
    UI.toast('Unlocked · ' + unlocked[i], 'good');
  }
};

/* the body comes apart from the tail forward, then the sheet slides in */
Game.deathTick = function (dt) {
  const d = this.death;
  if (!d) return;
  d.t += dt;

  /* real time slows down; the loop multiplies its own dt by this */
  const floor = d.win ? 0.85 : 0.3;
  if (this.timeScale > floor) {
    this.timeScale = Math.max(floor, this.timeScale - dt * (d.win ? 0.6 : 2.2));
  }

  if (!d.win) {
    const total = Math.max(1, d.len);
    const per = 0.85 / total;
    const want = Math.min(total, Math.floor(d.t / per));
    while (d.i < want) {
      const idx = total - 1 - d.i;
      d.i++;
      if (idx < 0) break;
      this.snake.segWorld(idx, this._v3);
      if (idx > 0 && this.snake.segments[idx]) this.snake.segments[idx].visible = false;
      else if (idx === 0) this.snake.head.visible = false;
      this.particles.burst(this._v3.x, this._v3.y, this._v3.z, {
        color: idx === 0 ? 0xffffff : this.accentInt,
        count: idx === 0 ? 40 : 10, speed: idx === 0 ? 11 : 5.5,
        size: 0.44, life: 0.7, gravity: -3.4, spread: 1.4
      });
    }
    if (d.i >= total) this.snake.hideAll();
  }

  if (!d.shown && d.t > (d.win ? 0.4 : 1.0)) {
    d.shown = true;
    UI.showOver(this.run, this.over);
    UI.show(STATE.OVER);
  }
};

/* ===========================================================================
   persistence
   ========================================================================= */
Game.commitRun = function (run) {
  const data = SaveManager.data;
  const st = data.stats;
  const prevBest = data.best;

  st.games += 1;
  st.score += run.score;
  st.playtime += run.time;
  if (run.score > st.best) st.best = run.score;
  if (run.score > data.best) data.best = run.score;
  st.best = Math.max(st.best, data.best);
  data.best = st.best;
  run.best = data.best;

  const prevMode = data.bestByMode[run.mode] || 0;
  if (run.score > prevMode) data.bestByMode[run.mode] = run.score;
  if (run.bestCombo > st.bestCombo) st.bestCombo = run.bestCombo;
  if (run.length > st.longest) st.longest = run.length;
  if (run.time > st.survival) st.survival = run.time;
  if (run.level > st.level) st.level = run.level;
  /* stats.food and stats.powerups were counted live during the run */

  this.checkAchievements(true);
  this.challengeDone(SaveManager.bumpChallenges('games', 1));
  this.challengeDone(SaveManager.bumpChallenges('runScore', run.score));
  this.challengeDone(SaveManager.bumpChallenges('runTime', Math.floor(run.time)));
  this.challengeDone(SaveManager.bumpChallenges('runCombo', run.bestCombo));
  this.challengeDone(SaveManager.bumpChallenges('runLevel', run.level));

  const unlocked = this.newUnlocks(prevBest, data.best);
  SaveManager.saveNow();
  return unlocked;
};

Game.newUnlocks = function (prevBest, best) {
  const names = [];
  const scan = function (list) {
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (it.unlock > prevBest && it.unlock <= best) names.push(it.name);
    }
  };
  scan(COLORS); scan(SKINS); scan(ARENAS);
  return names;
};

Game.checkAchievements = function (final) {
  const run = this.run;
  if (!run) return;
  const data = SaveManager.data;
  let any = false;
  for (let i = 0; i < ACHIEVEMENTS.length; i++) {
    const a = ACHIEVEMENTS[i];
    if (data.achievements[a.id] === true) continue;
    if (!final && END_ONLY_ACH[a.id]) continue;
    let ok = false;
    try { ok = !!a.test(run, data); } catch (e) { ok = false; }
    if (!ok) continue;
    data.achievements[a.id] = true;
    UI.achievement(a);
    any = true;
  }
  if (any) SaveManager.save();
};

/* stored challenges only keep {id, target, progress, done}, so the readable
   label has to come back from the template */
Game.challengeDone = function (list) {
  if (!list || !list.length) return;
  for (let i = 0; i < list.length; i++) {
    const tpl = SaveManager.challengeTemplate(list[i].id);
    const text = tpl ? tpl.label(list[i].target) : 'Daily challenge';
    UI.toast('Challenge complete · ' + text, 'good');
  }
  Audio.play('achieve');
};
