
/* ===========================================================================
   8 — FOOD
   Cores are pooled: the meshes are built once and parked off-screen, so a
   two-hour run never allocates another buffer.
   ========================================================================= */

const FOOD_MAX = 6;

function FoodManager(scene, particles) {
  this.scene = scene;
  this.ps = particles;
  this.group = new THREE.Group();
  scene.add(this.group);
  this.items = [];
  this.pool = [];
  this.coreMat = new THREE.MeshStandardMaterial({
    color: 0xfff3c4, emissive: 0xffd257, emissiveIntensity: 1.5, roughness: 0.15, metalness: 0.2
  });
  this.rareMat = new THREE.MeshStandardMaterial({
    color: 0xf0e0ff, emissive: 0xa855ff, emissiveIntensity: 1.9, roughness: 0.1, metalness: 0.35
  });
  this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffd257, transparent: true, opacity: 0.7 });
  this.ringMatRare = new THREE.MeshBasicMaterial({ color: 0xc084ff, transparent: true, opacity: 0.75 });
}

FoodManager.prototype._make = function () {
  const g = new THREE.Group();
  const core = new THREE.Mesh(Assets.geo.core, this.coreMat);
  core.castShadow = Assets.quality === 'high';
  const ring = new THREE.Mesh(Assets.geo.ringFlat, this.ringMat);
  ring.rotation.x = Math.PI / 2;
  const glow = Assets.glowSprite(0xffd257, 2.0, 0.9);
  g.add(core, ring, glow);
  g.visible = false;
  this.group.add(g);
  return { group: g, core: core, ring: ring, glow: glow };
};

FoodManager.prototype._take = function () {
  const v = this.pool.length ? this.pool.pop() : this._make();
  v.group.visible = true;
  return v;
};

FoodManager.prototype._give = function (v) {
  v.group.visible = false;
  this.pool.push(v);
};

FoodManager.prototype.count = function () { return this.items.length; };

/* isFree(x,y) must return true when a cell can hold a core */
FoodManager.prototype.spawn = function (isFree, allowRare) {
  if (this.items.length >= FOOD_MAX) return null;
  const cell = this.findCell(isFree);
  if (!cell) return null;

  const rare = !!allowRare && Math.random() < 0.14;
  const v = this._take();
  v.core.material = rare ? this.rareMat : this.coreMat;
  v.core.geometry = rare ? Assets.geo.shard : Assets.geo.core;
  v.ring.material = rare ? this.ringMatRare : this.ringMat;
  v.glow.material.color.setHex(rare ? 0xc084ff : 0xffd257);

  const item = {
    cell: { x: cell.x, y: cell.y },
    vx: cell.x, vy: cell.y,
    rare: rare,
    value: rare ? 3 : 1,
    life: rare ? 11 : 0,
    anim: 0,
    spin: rnd(0.6, 1.4),
    v: v
  };
  this.items.push(item);
  this._place(item, 0);
  if (this.ps) {
    this.ps.burst(worldX(cell.x), 0.6, worldZ(cell.y), {
      color: rare ? 0xc084ff : 0xffd257, count: rare ? 22 : 12,
      speed: 3.4, size: 0.42, life: 0.55, gravity: -1.2, spread: 1.1
    });
  }
  return item;
};

FoodManager.prototype.findCell = function (isFree) {
  for (let i = 0; i < 80; i++) {
    const x = rndInt(0, GRID - 1), y = rndInt(0, GRID - 1);
    if (isFree(x, y)) return { x: x, y: y };
  }
  /* deterministic fallback so a crowded arena still spawns something */
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) if (isFree(x, y)) return { x: x, y: y };
  }
  return null;
};

FoodManager.prototype._place = function (item, elapsed) {
  const g = item.v.group;
  g.position.set(worldX(item.vx), 0.58, worldZ(item.vy));
};

FoodManager.prototype.update = function (dt, elapsed) {
  for (let i = this.items.length - 1; i >= 0; i--) {
    const it = this.items[i];
    it.anim = Math.min(1, it.anim + dt * 3.5);
    if (it.life > 0) {
      it.life -= dt;
      if (it.life <= 0) { this.remove(i, true); continue; }
    }
    /* glide toward the grid cell so magnet pulls read as motion, not teleports */
    it.vx += (it.cell.x - it.vx) * Math.min(1, dt * 12);
    it.vy += (it.cell.y - it.vy) * Math.min(1, dt * 12);

    const v = it.v;
    const pop = easeOutCubic(it.anim);
    const float = Math.sin(elapsed * 2.4 + it.spin * 3) * 0.09;
    const expiring = it.life > 0 && it.life < 3;
    const blink = expiring ? (0.55 + 0.45 * Math.sin(elapsed * 14)) : 1;

    v.group.position.set(worldX(it.vx), 0.58 + float, worldZ(it.vy));
    v.core.rotation.y += dt * 1.6 * it.spin;
    v.core.rotation.x += dt * 0.9 * it.spin;
    const s = pop * (it.rare ? 1.15 : 1) * (0.94 + Math.sin(elapsed * 5) * 0.06);
    v.core.scale.setScalar(s);
    v.ring.rotation.z += dt * 1.1;
    v.ring.scale.setScalar(pop * (1.05 + Math.sin(elapsed * 3.2) * 0.12));
    v.ring.material.opacity = 0.7 * blink;
    v.glow.scale.setScalar((it.rare ? 2.6 : 2.0) * pop * (1 + Math.sin(elapsed * 4) * 0.08));
    v.glow.material.opacity = 0.9 * blink;
  }
};

FoodManager.prototype.at = function (x, y) {
  for (let i = 0; i < this.items.length; i++) {
    if (this.items[i].cell.x === x && this.items[i].cell.y === y) return i;
  }
  return -1;
};

FoodManager.prototype.remove = function (index, expired) {
  const it = this.items[index];
  if (!it) return null;
  if (expired && this.ps) {
    this.ps.burst(worldX(it.vx), 0.6, worldZ(it.vy), {
      color: 0x6d7f9a, count: 10, speed: 1.6, size: 0.3, life: 0.5, gravity: -1
    });
  }
  this._give(it.v);
  this.items.splice(index, 1);
  return it;
};

/* one cell of magnet drift per simulation step */
FoodManager.prototype.magnet = function (hx, hy, radius, isFree) {
  for (let i = 0; i < this.items.length; i++) {
    const it = this.items[i];
    const dx = hx - it.cell.x, dy = hy - it.cell.y;
    const dist = Math.abs(dx) + Math.abs(dy);
    if (dist === 0 || dist > radius) continue;
    let nx = it.cell.x, ny = it.cell.y;
    if (Math.abs(dx) >= Math.abs(dy)) nx += Math.sign(dx);
    else ny += Math.sign(dy);
    if ((nx === hx && ny === hy) || isFree(nx, ny)) { it.cell.x = nx; it.cell.y = ny; }
  }
};

FoodManager.prototype.clear = function () {
  while (this.items.length) this.remove(this.items.length - 1, false);
};

/* ===========================================================================
   9 — POWER-UPS
   Pickups on the grid plus the timers for whatever is currently running.
   ========================================================================= */

function PowerUpManager(scene, particles) {
  this.scene = scene;
  this.ps = particles;
  this.group = new THREE.Group();
  scene.add(this.group);
  this.items = [];
  this.active = {};         /* id -> seconds remaining (Infinity for shield) */
  this.timer = 8;
  this.mats = {};
  this.pool = [];
  for (let i = 0; i < POWERS.length; i++) {
    const p = POWERS[i];
    this.mats[p.id] = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: p.color, emissiveIntensity: 1.6,
      roughness: 0.2, metalness: 0.4
    });
    this.mats[p.id].color.setHex(p.color).lerp(new THREE.Color(0xffffff), 0.55);
  }
}

PowerUpManager.prototype._geoFor = function (id) {
  switch (id) {
    case 'speed': return Assets.geo.cone;
    case 'slow': return Assets.geo.torus;
    case 'shield': return Assets.geo.octa;
    case 'magnet': return Assets.geo.torus;
    case 'double': return Assets.geo.box;
    case 'ghost': return Assets.geo.sphere;
    default: return Assets.geo.core;
  }
};

PowerUpManager.prototype._make = function () {
  const g = new THREE.Group();
  const body = new THREE.Mesh(Assets.geo.octa, this.mats.shield);
  const cage = new THREE.Mesh(Assets.geo.ringFlat, new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.7
  }));
  cage.rotation.x = Math.PI / 2;
  const glow = Assets.glowSprite(0xffffff, 2.4, 0.85);
  g.add(body, cage, glow);
  g.visible = false;
  this.group.add(g);
  return { group: g, body: body, cage: cage, glow: glow };
};

PowerUpManager.prototype.spawn = function (isFree, def) {
  if (this.items.length >= 2) return null;
  let cell = null;
  for (let i = 0; i < 90; i++) {
    const x = rndInt(1, GRID - 2), y = rndInt(1, GRID - 2);
    if (isFree(x, y)) { cell = { x: x, y: y }; break; }
  }
  if (!cell) return null;

  if (!def) {
    /* weighted pick, skipping anything already running */
    let total = 0;
    const pool = [];
    for (let i = 0; i < POWERS.length; i++) {
      const p = POWERS[i];
      if (this.active[p.id] !== undefined) continue;
      pool.push(p); total += p.weight;
    }
    if (!pool.length) return null;
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) { r -= pool[i].weight; if (r <= 0) { def = pool[i]; break; } }
    if (!def) def = pool[pool.length - 1];
  }

  const v = this.pool.length ? this.pool.pop() : this._make();
  v.group.visible = true;
  v.body.geometry = this._geoFor(def.id);
  v.body.material = this.mats[def.id];
  v.cage.material.color.setHex(def.color);
  v.glow.material.color.setHex(def.color);
  v.group.position.set(worldX(cell.x), 0.6, worldZ(cell.y));

  const item = { def: def, cell: cell, life: 13, anim: 0, v: v, spin: rnd(0.8, 1.5) };
  this.items.push(item);
  if (this.ps) {
    this.ps.burst(worldX(cell.x), 0.6, worldZ(cell.y), {
      color: def.color, count: 20, speed: 4.2, size: 0.45, life: 0.6, gravity: -1.5, spread: 1.2
    });
  }
  return item;
};

PowerUpManager.prototype.update = function (dt, elapsed) {
  for (let i = this.items.length - 1; i >= 0; i--) {
    const it = this.items[i];
    it.anim = Math.min(1, it.anim + dt * 3);
    it.life -= dt;
    if (it.life <= 0) { this.remove(i, true); continue; }
    const v = it.v;
    const pop = easeOutCubic(it.anim);
    const blink = it.life < 3.5 ? (0.5 + 0.5 * Math.sin(elapsed * 15)) : 1;
    v.group.position.y = 0.62 + Math.sin(elapsed * 2.6 + it.spin) * 0.12;
    v.body.rotation.y += dt * 1.9 * it.spin;
    v.body.rotation.z += dt * 0.8;
    v.body.scale.setScalar(pop * (0.95 + Math.sin(elapsed * 6) * 0.07));
    v.cage.rotation.z -= dt * 1.6;
    v.cage.scale.setScalar(pop * 1.25);
    v.cage.material.opacity = 0.65 * blink;
    v.glow.scale.setScalar(2.6 * pop * (1 + Math.sin(elapsed * 5) * 0.1));
    v.glow.material.opacity = 0.85 * blink;
  }

  /* running effects */
  for (const id in this.active) {
    if (this.active[id] === Infinity) continue;
    this.active[id] -= dt;
    if (this.active[id] <= 0) delete this.active[id];
  }
};

PowerUpManager.prototype.at = function (x, y) {
  for (let i = 0; i < this.items.length; i++) {
    if (this.items[i].cell.x === x && this.items[i].cell.y === y) return i;
  }
  return -1;
};

PowerUpManager.prototype.remove = function (index, expired) {
  const it = this.items[index];
  if (!it) return null;
  if (expired && this.ps) {
    this.ps.burst(it.v.group.position.x, 0.6, it.v.group.position.z, {
      color: it.def.color, count: 8, speed: 1.4, size: 0.3, life: 0.45, gravity: -1
    });
  }
  it.v.group.visible = false;
  this.pool.push(it.v);
  this.items.splice(index, 1);
  return it;
};

PowerUpManager.prototype.activate = function (def) {
  this.active[def.id] = def.dur > 0 ? def.dur : Infinity;
};

PowerUpManager.prototype.has = function (id) { return this.active[id] !== undefined; };
PowerUpManager.prototype.consume = function (id) { delete this.active[id]; };
PowerUpManager.prototype.left = function (id) {
  const v = this.active[id];
  return v === undefined ? 0 : v;
};

PowerUpManager.prototype.clear = function () {
  while (this.items.length) this.remove(this.items.length - 1, false);
  this.active = {};
  this.timer = 8;
};
