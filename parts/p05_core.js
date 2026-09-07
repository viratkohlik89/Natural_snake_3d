/* =============================================================================
   NEURAL SNAKE — a 3D snake game in one file.

   Layout of this script:
     1  Constants + content tables (colours, skins, arenas, modes, power-ups…)
     2  Utilities
     3  SaveManager      persistent profile, settings, achievements
     4  AudioManager     Web Audio synthesis: SFX + generative music
     5  ParticleSystem   one pooled draw call for every spark in the game
     6  Arena            floor, grid, walls, ambient motes, theming
     7  Snake            interpolated body, animated head
     8  FoodManager      cores
     9  PowerUpManager   pickups + active effect timers
    10  ObstacleManager  blocks, patrols, lasers, spinners, pads, spikes
    11  InputManager     keyboard, swipe, thumb pad
    12  UIManager        screens, HUD, popups, generated option lists
    13  Game             state machine, fixed-step simulation, camera, scoring
    14  Boot             loader, WebGL probe, resize + visibility handling
   ========================================================================== */

/* ===========================================================================
   1 — CONSTANTS AND CONTENT
   ========================================================================= */

const GRID = 21;                 // arena is GRID x GRID cells
const CELL = 1;                  // world units per cell
const HALF = (GRID - 1) / 2;
const BODY_Y = 0.5;              // height the snake floats at
const WALL_H = 1.5;

const STATE = {
  LOAD: 'load', MENU: 'menu', MODES: 'modes', CUSTOM: 'custom', ACH: 'ach',
  STATS: 'stats', SETTINGS: 'settings', HELP: 'help',
  PLAY: 'play', PAUSE: 'pause', OVER: 'over'
};

const DIRS = {
  up:    { x: 0, y: -1 },
  down:  { x: 0, y: 1 },
  left:  { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};
const DIR_NAMES = ['up', 'down', 'left', 'right'];
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

/* --- snake colours -------------------------------------------------------- */
const COLORS = [
  { id: 'neon',   name: 'Neon Green',    base: 0x00cc44, glow: 0x44ff88, unlock: 0 },
  { id: 'blue',   name: 'Electric Blue', base: 0x0055ff, glow: 0x66bbff, unlock: 0 },
  { id: 'aqua',   name: 'Signal Aqua',   base: 0x00ccaa, glow: 0x66ffee, unlock: 0 },
  { id: 'violet', name: 'Violet Surge',  base: 0x6600ff, glow: 0xbb66ff, unlock: 250 },
  { id: 'red',    name: 'Ember Red',     base: 0xcc0011, glow: 0xff4455, unlock: 600 },
  { id: 'gold',   name: 'Solar Gold',    base: 0xcc8800, glow: 0xffcc33, unlock: 1200 },
  { id: 'pink',   name: 'Cyber Pink',    base: 0xcc0066, glow: 0xff33aa, unlock: 2000 },
  { id: 'ice',    name: 'Glacial Ice',   base: 0x33aaff, glow: 0xddeeff, unlock: 3000 },
  { id: 'toxic',  name: 'Toxic',         base: 0x88cc00, glow: 0xccff33, unlock: 4200 },
  { id: 'ghost',  name: 'Ghost White',   base: 0xaabbcc, glow: 0xffffff, unlock: 5000 },
  { id: 'hyper',  name: 'Hyper Magenta', base: 0xff00ff, glow: 0xff88ff, unlock: 6000 },
  { id: 'magma',  name: 'Magma Flare',   base: 0xff4400, glow: 0xffaa00, unlock: 7000 },
  { id: 'abyss',  name: 'Abyssal Blue',  base: 0x001188, glow: 0x2244ff, unlock: 8500 }
];

/* --- snake skins: each is a small material + animation recipe ------------- */
const SKINS = [
  { id: 'classic', name: 'Classic', desc: 'Smooth capsule segments with a soft inner light.',
    unlock: 0, geo: 'sphere', metal: 0.35, rough: 0.30, emi: 0.75, opacity: 1, wire: false, hue: 0, pulse: 0.10, spin: 0 },
  { id: 'plasma',  name: 'Plasma', desc: 'Overcharged shells that breathe along the body.',
    unlock: 0, geo: 'sphere', metal: 0.00, rough: 0.55, emi: 1.60, opacity: 0.88, wire: false, hue: 0, pulse: 0.42, spin: 0 },
  { id: 'cyber',   name: 'Cyber', desc: 'Faceted plating with exposed edge wiring.',
    unlock: 400, geo: 'ico', metal: 0.85, rough: 0.22, emi: 0.55, opacity: 1, wire: true, hue: 0, pulse: 0.06, spin: 0.4 },
  { id: 'crystal', name: 'Crystal', desc: 'Cut shards that refract the arena light.',
    unlock: 900, geo: 'octa', metal: 0.10, rough: 0.05, emi: 0.70, opacity: 0.72, wire: false, hue: 0, pulse: 0.14, spin: 1.5 },
  { id: 'lava',    name: 'Lava', desc: 'Dark crust with heat pulsing down the spine.',
    unlock: 1600, geo: 'sphere', metal: 0.20, rough: 0.85, emi: 1.30, opacity: 1, wire: false, hue: 0, pulse: 0.85, spin: 0 },
  { id: 'galaxy',  name: 'Galaxy', desc: 'Spectrum drift with a dusting of stars.',
    unlock: 2600, geo: 'sphere', metal: 0.45, rough: 0.25, emi: 1.00, opacity: 1, wire: false, hue: 1, pulse: 0.20, spin: 0 },
  { id: 'blocky',  name: 'Mecha Block', desc: 'Heavy industrial cubes forged in neon fires.',
    unlock: 3500, geo: 'box', metal: 0.75, rough: 0.15, emi: 0.80, opacity: 1, wire: false, hue: 0, pulse: 0.10, spin: 0.5 },
  { id: 'ring',    name: 'Hollow Core', desc: 'Floating magnetic rings containing raw energy.',
    unlock: 4800, geo: 'torus', metal: 0.90, rough: 0.10, emi: 1.10, opacity: 0.9, wire: false, hue: 0, pulse: 0.30, spin: -1.2 },
  { id: 'spiked',  name: 'Spike Hazard', desc: 'Aggressive conical armor. Do not touch.',
    unlock: 6500, geo: 'cone', metal: 0.60, rough: 0.40, emi: 1.20, opacity: 1, wire: false, hue: 0, pulse: 0.20, spin: 2.0 }
];

/* --- arenas: colour scheme + one distinct background feature -------------- */
const ARENAS = [
  { id: 'grid',      name: 'Neural Grid',      desc: 'Deep core substrate with hyper-bright aqua conduits.', unlock: 0,
    bg: 0x020408, fog: 0x03060c, fogD: 0.035, floor: 0x040810, line: 0x44aaff, glow: 0x00ffee,
    wall: 0x08162b, hemiSky: 0x4488ff, hemiGnd: 0x010204, sun: 0xeeffff, sunI: 1.0, mote: 0xaaddff, feature: 'none' },
  { id: 'city',      name: 'Cyber City',      desc: 'A glowing skyline towering over the neon abyss.', unlock: 0,
    bg: 0x05020a, fog: 0x0a0414, fogD: 0.040, floor: 0x080410, line: 0xbb44ff, glow: 0xff22bb,
    wall: 0x1a082b, hemiSky: 0xaa44ff, hemiGnd: 0x030106, sun: 0xffccff, sunI: 0.9, mote: 0xffaadd, feature: 'skyline' },
  { id: 'space',     name: 'Deep Space',      desc: 'Adrift amongst massive celestial bodies and nebula dust.', unlock: 0,
    bg: 0x000000, fog: 0x010206, fogD: 0.020, floor: 0x020408, line: 0x3366ff, glow: 0xaaccff,
    wall: 0x060c18, hemiSky: 0x4466ff, hemiGnd: 0x000000, sun: 0xffffff, sunI: 1.1, mote: 0xffffff, feature: 'stars' },
  { id: 'void',      name: 'Digital Void',    desc: 'Gigantic magnetic rings turning in absolute darkness.', unlock: 0,
    bg: 0x020104, fog: 0x040208, fogD: 0.048, floor: 0x030105, line: 0xff2288, glow: 0xff0055,
    wall: 0x110416, hemiSky: 0xff2288, hemiGnd: 0x010002, sun: 0xffaadd, sunI: 0.8, mote: 0xff44aa, feature: 'rings' },
  { id: 'lab',       name: 'Toxic Lab',       desc: 'Fluorescent biological spill hazard. Highly radioactive.', unlock: 0,
    bg: 0x010603, fog: 0x020a05, fogD: 0.042, floor: 0x030b06, line: 0x66ff44, glow: 0x88ff00,
    wall: 0x061c0a, hemiSky: 0x44ff66, hemiGnd: 0x010301, sun: 0xccffaa, sunI: 1.0, mote: 0xaaff88, feature: 'pipes' },
  { id: 'ember',     name: 'Ember Core',      desc: 'A volatile blast furnace with torrential fiery embers.', unlock: 0,
    bg: 0x0a0100, fog: 0x160301, fogD: 0.045, floor: 0x110200, line: 0xff6611, glow: 0xff8800,
    wall: 0x220501, hemiSky: 0xff6622, hemiGnd: 0x050000, sun: 0xffddaa, sunI: 1.1, mote: 0xff8844, feature: 'embers' },
  { id: 'synthwave', name: 'Synthwave Sunset', desc: 'Maximum overdrive into the retro wireframe horizon.', unlock: 0,
    bg: 0x0a011a, fog: 0x14022b, fogD: 0.030, floor: 0x0c0116, line: 0xff00aa, glow: 0x00e6ff,
    wall: 0x22043b, hemiSky: 0xff00ff, hemiGnd: 0x050011, sun: 0xff8800, sunI: 1.2, mote: 0xff00aa, feature: 'synth_sun' },
  { id: 'ice',       name: 'Glacial Frost',   desc: 'Razor-sharp frozen spires cutting through the arctic night.', unlock: 0,
    bg: 0x01050a, fog: 0x020a14, fogD: 0.032, floor: 0x030f1c, line: 0x55ccff, glow: 0x00ffff,
    wall: 0x0a1c33, hemiSky: 0x77ddff, hemiGnd: 0x010305, sun: 0xddeeff, sunI: 1.0, mote: 0xaaddff, feature: 'ice_crystals' },
  { id: 'matrix',    name: 'Matrix Core',     desc: 'Unfiltered data streaming straight into the mainframe.', unlock: 0,
    bg: 0x000501, fog: 0x000a02, fogD: 0.038, floor: 0x000b02, line: 0x11ff33, glow: 0x00ff00,
    wall: 0x021c06, hemiSky: 0x00ff44, hemiGnd: 0x000200, sun: 0xaaffbb, sunI: 1.0, mote: 0x22ff55, feature: 'matrix_rain' },
  { id: 'desert',    name: 'Solar Dunes',     desc: 'Blinding sands hiding colossal forgotten monoliths.', unlock: 0,
    bg: 0x0a0400, fog: 0x1a0a01, fogD: 0.034, floor: 0x110701, line: 0xffaa00, glow: 0xffcc00,
    wall: 0x2a1403, hemiSky: 0xffaa33, hemiGnd: 0x080300, sun: 0xffeecc, sunI: 1.1, mote: 0xffcc66, feature: 'monoliths' },
  { id: 'ocean',     name: 'Abyssal Trench',  desc: 'Pitch-black depths illuminated only by bioluminescent fauna.', unlock: 0,
    bg: 0x00030a, fog: 0x01081a, fogD: 0.040, floor: 0x010b22, line: 0x2288ff, glow: 0x00ccff,
    wall: 0x041833, hemiSky: 0x2288ff, hemiGnd: 0x000104, sun: 0xaaddff, sunI: 0.9, mote: 0x00ffff, feature: 'abyss_bubbles' },
  { id: 'alien',     name: 'Xenon Biosphere', desc: 'A hostile, mutating hive mind structure pulsing with energy.', unlock: 0,
    bg: 0x06010a, fog: 0x0c0216, fogD: 0.035, floor: 0x090111, line: 0xbb00ff, glow: 0xccff00,
    wall: 0x1a042b, hemiSky: 0xaa22ff, hemiGnd: 0x030005, sun: 0xddff66, sunI: 1.0, mote: 0xaaff00, feature: 'alien_spires' },
  { id: 'temple',    name: 'Neon Shrine',     desc: 'Ancient architecture infused with bloody cybernetic augmentations.', unlock: 0,
    bg: 0x080102, fog: 0x160205, fogD: 0.036, floor: 0x110103, line: 0xff1133, glow: 0xff0022,
    wall: 0x220308, hemiSky: 0xff2244, hemiGnd: 0x040001, sun: 0xffbbcc, sunI: 1.0, mote: 0xff4455, feature: 'shrine_gate' },
  { id: 'quantum',   name: 'Quantum Warp',    desc: 'Breaking the speed of light through a high-voltage conduit.', unlock: 0,
    bg: 0x03000a, fog: 0x08001a, fogD: 0.038, floor: 0x050011, line: 0x7700ff, glow: 0xaa00ff,
    wall: 0x11002b, hemiSky: 0x8822ff, hemiGnd: 0x010003, sun: 0xccaaff, sunI: 1.1, mote: 0xbb66ff, feature: 'warp_tunnel' },
  { id: 'bloodmoon', name: 'Blood Moon',      desc: 'The sky bleeds crimson under the gaze of a colossal satellite.', unlock: 0,
    bg: 0x0a0002, fog: 0x1c0005, fogD: 0.032, floor: 0x140003, line: 0xff0011, glow: 0xff0000,
    wall: 0x2b0008, hemiSky: 0xff0022, hemiGnd: 0x050001, sun: 0xff5566, sunI: 1.0, mote: 0xff2233, feature: 'blood_moon' },
  { id: 'aurora',    name: 'Neon Aurora',     desc: 'Magnetospheric storms painting the polar night sky in vivid light.', unlock: 0,
    bg: 0x000408, fog: 0x010a14, fogD: 0.028, floor: 0x020d1c, line: 0x00ffaa, glow: 0x00ffbb,
    wall: 0x041a2b, hemiSky: 0x00ffcc, hemiGnd: 0x000204, sun: 0xaaffee, sunI: 1.0, mote: 0x44ffcc, feature: 'aurora_waves' }
];

/* --- power-ups ------------------------------------------------------------ */
const POWERS = [
  { id: 'speed',  name: 'Overdrive',   glyph: '»',   color: 0xffb340, dur: 7,  weight: 12,
    desc: 'Steps 55% faster and every core is worth more.' },
  { id: 'slow',   name: 'Slow Field',  glyph: '«',   color: 0x6bd0ff, dur: 8,  weight: 10,
    desc: 'Drops the whole arena into half speed so you can thread gaps.' },
  { id: 'shield', name: 'Shield',      glyph: '⬡',   color: 0x54e08a, dur: 0,  weight: 11,
    desc: 'Absorbs one lethal hit, then steers you clear.' },
  { id: 'magnet', name: 'Magnet',      glyph: '∪',   color: 0xff8a3d, dur: 10, weight: 10,
    desc: 'Drags nearby cores toward your head, one cell per step.' },
  { id: 'double', name: 'Double Score', glyph: '×2',  color: 0xff2e88, dur: 12, weight: 9,
    desc: 'Doubles all score while it burns.' },
  { id: 'ghost',  name: 'Ghost',       glyph: '◌',   color: 0xb39dff, dur: 8,  weight: 8,
    desc: 'Pass straight through your own body and through blocks.' },
  { id: 'freeze', name: 'Time Freeze', glyph: '✳',   color: 0x8ff0ff, dur: 8,  weight: 8,
    desc: 'Freezes every hazard where it stands.' }
];
const POWER_BY_ID = {};
POWERS.forEach(function (p) { POWER_BY_ID[p.id] = p; });

/* --- game modes ----------------------------------------------------------- */
const MODES = [
  { id: 'classic', name: 'Classic', tag: 'No timer, no mercy',
    desc: 'Pure snake in three dimensions. Walls and your own body are fatal. Hazards start appearing once you are comfortable.',
    icon: 'M4 4h16v16H4z', timer: 0, scoreMul: 1.00 },
  { id: 'time', name: 'Time Attack', tag: '90 seconds',
    desc: 'Ninety seconds on the clock. Every core buys you two more. Faster from the first step and worth 25% extra score.',
    icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zm1 5h-2v6l5 3 1-1.7-4-2.3z', timer: 90, scoreMul: 1.25 },
  { id: 'endless', name: 'Endless', tag: 'The floor closes in',
    desc: 'The arena burns away from the edges every 40 seconds while you speed up. Survive the squeeze.',
    icon: 'M12 2l10 10-10 10L2 12z', timer: 0, scoreMul: 1.20 },
  { id: 'survival', name: 'Survival', tag: 'Waves of hazards',
    desc: 'A new hazard joins every 25 seconds and you score for every second you last. Cores are a bonus, not the point.',
    icon: 'M12 2l9 5v6c0 5-3.8 8.3-9 9-5.2-.7-9-4-9-9V7z', timer: 0, scoreMul: 1.30 },
  { id: 'challenge', name: 'Challenge', tag: '12 levels',
    desc: 'Twelve hand-built layouts. Hit the core quota to unlock the next one. Clear all twelve to finish the game.',
    icon: 'M4 20h4V10H4zm6 0h4V4h-4zm6 0h4v-8h-4z', timer: 0, scoreMul: 1.15 }
];
const MODE_BY_ID = {};
MODES.forEach(function (m) { MODE_BY_ID[m.id] = m; });

/* --- difficulties --------------------------------------------------------- */
const DIFFS = [
  { id: 'easy',   name: 'Easy',   sps: 5.4, ramp: 0.20, maxSps: 12, obst: 0.55, power: 1.35, scoreMul: 0.85,
    desc: 'Gentle pace, generous power-ups, few hazards. Learn the arena here.' },
  { id: 'normal', name: 'Normal', sps: 6.6, ramp: 0.30, maxSps: 15, obst: 1.00, power: 1.00, scoreMul: 1.00,
    desc: 'The intended balance: steady ramp, honest hazard count.' },
  { id: 'hard',   name: 'Hard',   sps: 8.0, ramp: 0.38, maxSps: 17, obst: 1.45, power: 0.85, scoreMul: 1.30,
    desc: 'Quick from the start, hazards early, power-ups rarer. 30% more score.' },
  { id: 'insane', name: 'Insane', sps: 9.6, ramp: 0.48, maxSps: 20, obst: 1.85, power: 0.70, scoreMul: 1.70,
    desc: 'Very fast, very crowded, very short runs. 70% more score.' }
];
const DIFF_BY_ID = {};
DIFFS.forEach(function (d) { DIFF_BY_ID[d.id] = d; });

/* --- achievements: each test() reads the finished/ongoing run + profile --- */
const ACHIEVEMENTS = [
  { id: 'first',    name: 'First Bite',      glyph: '◆', desc: 'Eat your first core.',
    test: function (r, s) { return s.stats.food >= 1; } },
  { id: 'hundred',  name: 'Century',         glyph: '●', desc: 'Score 100 in a single run.',
    test: function (r) { return r.score >= 100; } },
  { id: 'five',     name: 'Five Hundred',    glyph: '▲', desc: 'Score 500 in a single run.',
    test: function (r) { return r.score >= 500; } },
  { id: 'kilo',     name: 'Kilobyte',        glyph: '✦', desc: 'Score 1000 in a single run.',
    test: function (r) { return r.score >= 1000; } },
  { id: 'combo',    name: 'Combo King',      glyph: '⧈', desc: 'Reach an ×8 combo.',
    test: function (r) { return r.bestCombo >= 8; } },
  { id: 'speed',    name: 'Speed Demon',     glyph: '➤', desc: 'Reach 14 steps per second.',
    test: function (r) { return r.topSps >= 14; } },
  { id: 'survive',  name: 'Survivor',        glyph: '⬢', desc: 'Last three minutes in one run.',
    test: function (r) { return r.time >= 180; } },
  { id: 'collector',name: 'Power Collector', glyph: '⬣', desc: 'Collect 15 power-ups in total.',
    test: function (r, s) { return s.stats.powerups >= 15; } },
  { id: 'long',     name: 'Long Snake',      glyph: '∿', desc: 'Grow to 40 segments.',
    test: function (r) { return r.length >= 40; } },
  { id: 'perfect',  name: 'Perfect Run',     glyph: '◇', desc: 'Score 200 without a shield saving you.',
    test: function (r) { return r.score >= 200 && r.saves === 0; } },
  { id: 'master',   name: 'Snake Master',    glyph: '⭐', desc: 'Clear all twelve Challenge levels.',
    test: function (r) { return r.mode === 'challenge' && r.won; } },
  { id: 'untouch',  name: 'Untouchable',     glyph: '⚡', desc: 'Last 90 seconds in Survival.',
    test: function (r) { return r.mode === 'survival' && r.time >= 90; } },
  { id: 'feast',    name: 'Feast',           glyph: '◐', desc: 'Eat 300 cores across all runs.',
    test: function (r, s) { return s.stats.food >= 300; } },
  { id: 'marathon', name: 'Marathon',        glyph: '◴', desc: 'Play 25 runs.',
    test: function (r, s) { return s.stats.games >= 25; } },
  { id: 'insane',   name: 'Nerves of Steel', glyph: '⬟', desc: 'Score 300 on Insane.',
    test: function (r) { return r.diff === 'insane' && r.score >= 300; } },
  { id: 'nopower',  name: 'Purist',          glyph: '○', desc: 'Score 250 without touching a power-up.',
    test: function (r) { return r.score >= 250 && r.powerups === 0; } }
];

/* --- daily challenge templates ------------------------------------------- */
const CHALLENGES = [
  { id: 'score',  label: function (n) { return 'Score ' + n + ' in one run'; },  targets: [250, 400, 650], stat: 'runScore' },
  { id: 'food',   label: function (n) { return 'Eat ' + n + ' cores today'; },    targets: [15, 25, 40],    stat: 'food' },
  { id: 'time',   label: function (n) { return 'Last ' + n + 's in one run'; },   targets: [60, 120, 180],  stat: 'runTime' },
  { id: 'combo',  label: function (n) { return 'Reach an ×' + n + ' combo'; }, targets: [5, 7, 9],     stat: 'runCombo' },
  { id: 'power',  label: function (n) { return 'Collect ' + n + ' power-ups'; },  targets: [4, 7, 10],      stat: 'powerups' },
  { id: 'level',  label: function (n) { return 'Reach level ' + n; },             targets: [4, 6, 8],       stat: 'runLevel' },
  { id: 'games',  label: function (n) { return 'Play ' + n + ' runs'; },          targets: [3, 5, 8],       stat: 'games' }
];

/* --- settings schema: the Settings screen is generated from this --------- */
const SETTINGS_SCHEMA = [
  { group: 'Audio' },
  { key: 'sfx',        type: 'switch', label: 'Sound effects', hint: 'Bites, power-ups, collisions.' },
  { key: 'music',      type: 'switch', label: 'Music',         hint: 'Generated arpeggio bed, no files.' },
  { key: 'volSfx',     type: 'range',  label: 'Effects volume', min: 0, max: 100, step: 5 },
  { key: 'volMusic',   type: 'range',  label: 'Music volume',   min: 0, max: 100, step: 5 },
  { group: 'Graphics' },
  { key: 'quality',    type: 'seg',    label: 'Quality', hint: 'Shadows, mote count and pixel ratio.',
    options: [{ v: 'low', t: 'Low' }, { v: 'medium', t: 'Medium' }, { v: 'high', t: 'High' }] },
  { key: 'particles',  type: 'seg',    label: 'Particles', hint: 'Sparks on bites, deaths and level-ups.',
    options: [{ v: 'off', t: 'Off' }, { v: 'low', t: 'Low' }, { v: 'normal', t: 'Normal' }, { v: 'high', t: 'High' }] },
  { key: 'shake',      type: 'range',  label: 'Screen shake', min: 0, max: 100, step: 10, hint: 'Set to 0 for a locked camera.' },
  { key: 'camera',     type: 'seg',    label: 'Camera distance',
    options: [{ v: 'close', t: 'Close' }, { v: 'normal', t: 'Normal' }, { v: 'far', t: 'Far' }] },
  { key: 'fps',        type: 'switch', label: 'Show frame rate', hint: 'Small counter in the top right.' },
  { key: 'reduceMotion', type: 'switch', label: 'Reduce interface motion', hint: 'Calms menu and popup animation.' },
  { group: 'Controls' },
  { key: 'touchMode',  type: 'seg',    label: 'Touch controls', hint: 'Swipe anywhere, a thumb pad, or both.',
    options: [{ v: 'swipe', t: 'Swipe' }, { v: 'pad', t: 'Pad' }, { v: 'both', t: 'Both' }] },
  { key: 'sensitivity', type: 'range', label: 'Swipe sensitivity', min: 10, max: 100, step: 5, hint: 'Lower means longer swipes are needed.' }
];

const DEFAULT_SETTINGS = {
  sfx: true, music: true, volSfx: 70, volMusic: 45,
  quality: 'high', particles: 'normal', shake: 60, camera: 'normal',
  fps: false, reduceMotion: false, touchMode: 'swipe', sensitivity: 50
};

const DEFAULT_SAVE = {
  v: 1,
  settings: DEFAULT_SETTINGS,
  best: 0,
  bestByMode: {},
  skin: { color: 'aqua', style: 'classic', arena: 'grid' },
  lastMode: 'classic',
  lastDiff: 'normal',
  achievements: {},
  challenges: { day: '', list: [] },
  stats: {
    games: 0, food: 0, score: 0, best: 0, bestCombo: 0, longest: 4,
    survival: 0, powerups: 0, level: 1, playtime: 0, challengeLevel: 0
  }
};

/* ===========================================================================
   2 — UTILITIES
   ========================================================================= */

const clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
const lerp = function (a, b, t) { return a + (b - a) * t; };
const smoothstep = function (t) { return t * t * (3 - 2 * t); };
const easeOutCubic = function (t) { return 1 - Math.pow(1 - t, 3); };
const rnd = function (a, b) { return a + Math.random() * (b - a); };
const rndInt = function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); };
const pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };
const cellKey = function (x, y) { return x * 64 + y; };
const inBounds = function (x, y) { return x >= 0 && y >= 0 && x < GRID && y < GRID; };
const worldX = function (gx) { return (gx - HALF) * CELL; };
const worldZ = function (gy) { return (gy - HALF) * CELL; };
const now = function () { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); };

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

/* deterministic PRNG so a given day always yields the same challenge set */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function dayStamp(d) {
  d = d || new Date();
  const m = d.getMonth() + 1, day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function hexCss(int) { return '#' + ('000000' + (int >>> 0).toString(16)).slice(-6); }

/* tiny DOM helpers -------------------------------------------------------- */
const $ = function (id) { return document.getElementById(id); };
function el(tag, cls, txt) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt !== undefined && txt !== null) n.textContent = txt;
  return n;
}
function on(node, ev, fn, opts) { if (node) node.addEventListener(ev, fn, opts || false); }
function setText(node, txt) { if (node && node.textContent !== txt) node.textContent = txt; }
function toggleClass(node, cls, want) { if (node) node.classList[want ? 'add' : 'remove'](cls); }

/* is this a touch-first device? used only for defaults, never to gate input */
const IS_TOUCH = (function () {
  try {
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) ||
      (window.matchMedia && window.matchMedia('(hover:none) and (pointer:coarse)').matches);
  } catch (e) { return false; }
})();
const IS_SMALL = (function () {
  try { return Math.min(window.innerWidth, window.innerHeight) < 620; } catch (e) { return false; }
})();
