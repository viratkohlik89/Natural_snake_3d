
/* ===========================================================================
   7 — SNAKE
   The simulation is a list of grid cells; the render is a Catmull-Rom curve
   through those cells, sampled once per segment. That is what makes corners
   round off and the body flow instead of snapping cell to cell.
   ========================================================================= */

const BANDS = 12;                 /* gradient bands repeated along the body */

function Snake(scene) {
  this.scene = scene;
  this.group = new THREE.Group();
  scene.add(this.group);

  this.cells = [];                /* cells[0] is the head's current cell */
  this.tailPrev = { x: 0, y: 0 }; /* cell the tail left on the last step  */
  this.dir = 'right';
  this.pendingGrow = 0;
  this.segments = [];
  this.visibleCount = 0;
  this.color = COLORS[2];
  this.style = SKINS[0];
  this.ghost = false;
  this.eatAnim = 0;
  this.hurtAnim = 0;
  this.blink = 0;
  this.blinkNext = rnd(1.5, 5);
  this.yaw = Math.PI / 2;
  this.headPos = new THREE.Vector3();
  this.headDirV = new THREE.Vector3(1, 0, 0);
  this.lookAt = null;
  this._a = { x: 0, y: 0 }; this._b = { x: 0, y: 0 };
  this._c = { x: 0, y: 0 }; this._d = { x: 0, y: 0 };
  this._out = { x: 0, y: 0 };

  this._buildMaterials();
  this._buildHead();
}

Snake.prototype._buildMaterials = function () {
  this.bandMats = [];
  for (let i = 0; i < BANDS; i++) {
    this.bandMats.push(new THREE.MeshStandardMaterial({
      color: 0x2bff88, emissive: 0x2bff88, emissiveIntensity: 0.7,
      roughness: 0.3, metalness: 0.35
    }));
  }
  this.headMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0x2bff88, emissiveIntensity: 0.9,
    roughness: 0.22, metalness: 0.4
  });
  this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xf4ffff });
  this.pupilMat = new THREE.MeshBasicMaterial({ color: 0x061018 });
  this.mouthMat = new THREE.MeshBasicMaterial({ color: 0x14202c });
  this.wireMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.22 });
  this.shieldMat = new THREE.MeshBasicMaterial({
    color: 0x54e08a, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide
  });
};

Snake.prototype._buildHead = function () {
  const g = new THREE.Group();
  this.head = g;
  this.group.add(g);

  this.headMesh = new THREE.Mesh(Assets.geo.headSphere, this.headMat);
  this.headMesh.castShadow = true;
  g.add(this.headMesh);

  this.headWire = new THREE.Mesh(Assets.geo.headSphere, this.wireMat);
  this.headWire.scale.setScalar(1.06);
  this.headWire.visible = false;
  g.add(this.headWire);

  /* eyes sit on the local +Z face; the head group yaws to face travel */
  this.eyes = [];
  this.pupils = [];
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1;
    const eye = new THREE.Mesh(Assets.geo.eye, this.eyeMat);
    eye.position.set(0.20 * s, 0.17, 0.30);
    g.add(eye);
    this.eyes.push(eye);
    const pup = new THREE.Mesh(Assets.geo.pupil, this.pupilMat);
    pup.position.set(0.20 * s, 0.17, 0.40);
    g.add(pup);
    this.pupils.push(pup);
  }

  this.mouth = new THREE.Mesh(Assets.geo.mouth, this.mouthMat);
  this.mouth.position.set(0, -0.13, 0.36);
  this.mouth.rotation.x = Math.PI * 0.62;
  this.mouth.scale.set(1, 0.4, 1);
  g.add(this.mouth);

  this.headGlow = Assets.glowSprite(0x2bff88, 2.6, 0.85);
  g.add(this.headGlow);

  this.light = new THREE.PointLight(0x2bff88, 1.15, 9, 2);
  this.light.position.set(0, 0.6, 0);
  g.add(this.light);

  this.shield = new THREE.Mesh(new THREE.SphereGeometry(0.92, 16, 12), this.shieldMat);
  this.shield.visible = false;
  g.add(this.shield);
};

/* ---- appearance --------------------------------------------------------- */
Snake.prototype.setLook = function (colorDef, styleDef) {
  this.color = colorDef;
  this.style = styleDef;
  const base = new THREE.Color(colorDef.base);
  const glow = new THREE.Color(colorDef.glow);
  const geo = Assets.bodyGeo(styleDef.geo);
  const tmp = new THREE.Color();

  for (let i = 0; i < BANDS; i++) {
    const m = this.bandMats[i];
    const t = i / (BANDS - 1);
    if (styleDef.hue) {
      /* galaxy: sweep the spectrum but keep the chosen colour's luminance */
      tmp.setHSL((t * 0.85 + 0.55) % 1, 0.72, 0.58);
    } else if (styleDef.id === 'lava') {
      tmp.copy(base).lerp(new THREE.Color(0x1a0603), Math.pow(t, 0.8) * 0.85);
    } else {
      tmp.copy(glow).lerp(base, 0.15 + t * 0.85);
    }
    m.color.copy(tmp);
    m.emissive.copy(tmp);
    m.emissiveIntensity = styleDef.emi * (styleDef.id === 'lava' ? (1.25 - t * 0.6) : 1);
    m.roughness = styleDef.rough;
    m.metalness = styleDef.metal;
    m.transparent = styleDef.opacity < 1;
    m.opacity = styleDef.opacity;
    m.flatShading = (styleDef.geo !== 'sphere');
    m.needsUpdate = true;
  }

  this.headMat.color.copy(glow);
  this.headMat.emissive.copy(base);
  this.headMat.emissiveIntensity = Math.max(0.8, styleDef.emi);
  this.headMat.roughness = styleDef.rough;
  this.headMat.metalness = styleDef.metal;
  this.headMat.needsUpdate = true;

  this.headGlow.material.color.copy(glow);
  this.light.color.copy(base);
  this.wireMat.color.copy(glow);
  this.headWire.visible = !!styleDef.wire;

  for (let i = 0; i < this.segments.length; i++) this.segments[i].geometry = geo;
};

Snake.prototype.setGhost = function (on) {
  if (this.ghost === on) return;
  this.ghost = on;
  const o = this.style.opacity;
  for (let i = 0; i < BANDS; i++) {
    const m = this.bandMats[i];
    m.transparent = on ? true : (o < 1);
    m.opacity = on ? 0.30 : o;
    m.needsUpdate = true;
  }
  this.headMat.transparent = on;
  this.headMat.opacity = on ? 0.45 : 1;
  this.headMat.needsUpdate = true;
};

Snake.prototype.setShield = function (on) { this.shield.visible = on; };

/* ---- pool --------------------------------------------------------------- */
Snake.prototype._ensure = function (n) {
  const geo = Assets.bodyGeo(this.style.geo);
  const shadowEvery = Assets.quality === 'high' ? 3 : (Assets.quality === 'medium' ? 6 : 0);
  while (this.segments.length < n) {
    const i = this.segments.length;
    const m = new THREE.Mesh(geo, this.bandMats[i % BANDS]);
    m.castShadow = shadowEvery > 0 && (i % shadowEvery === 0);
    m.visible = false;                /* the render pass decides what shows */
    this.group.add(m);
    this.segments.push(m);
  }
};

/* ---- simulation --------------------------------------------------------- */
Snake.prototype.reset = function (cells, dir) {
  this.cells = cells.slice();
  this.dir = dir;
  this.pendingGrow = 0;
  this.tailPrev.x = this.cells[this.cells.length - 1].x;
  this.tailPrev.y = this.cells[this.cells.length - 1].y;
  this.eatAnim = 0;
  this.hurtAnim = 0;
  this.ghost = false;
  this.setGhost(false);
  this.setShield(false);
  const d = DIRS[dir];
  this.yaw = Math.atan2(d.x, d.y);
  this._ensure(this.cells.length);
  this.render(1, 0, 0);
};

Snake.prototype.length = function () { return this.cells.length; };

Snake.prototype.stepTo = function (cell) {
  this.cells.unshift({ x: cell.x, y: cell.y });
  if (this.pendingGrow > 0) {
    this.pendingGrow--;
    this.tailPrev.x = this.cells[this.cells.length - 1].x;
    this.tailPrev.y = this.cells[this.cells.length - 1].y;
  } else {
    const t = this.cells.pop();
    this.tailPrev.x = t.x;
    this.tailPrev.y = t.y;
  }
  this._ensure(this.cells.length);
};

Snake.prototype.grow = function (n) { this.pendingGrow += n; };

Snake.prototype.trim = function (n) {
  /* used by hazards that bite a chunk off instead of killing outright */
  const keep = Math.max(3, this.cells.length - n);
  while (this.cells.length > keep) {
    const t = this.cells.pop();
    this.tailPrev.x = t.x; this.tailPrev.y = t.y;
  }
};

/* ---- curve sampling ----------------------------------------------------- */
Snake.prototype._q = function (j, out) {
  const L = this.cells.length;
  if (j >= 0 && j < L) { out.x = this.cells[j].x; out.y = this.cells[j].y; return out; }
  if (j < 0) {
    const a = this.cells[0], b = this.cells[1] || this.cells[0];
    out.x = a.x + (a.x - b.x) * (-j);
    out.y = a.y + (a.y - b.y) * (-j);
    return out;
  }
  if (j === L) { out.x = this.tailPrev.x; out.y = this.tailPrev.y; return out; }
  const a = this.tailPrev, b = this.cells[L - 1] || this.tailPrev;
  out.x = a.x + (a.x - b.x) * (j - L);
  out.y = a.y + (a.y - b.y) * (j - L);
  return out;
};

/* uniform Catmull-Rom; u counts backwards from the head in cell units */
Snake.prototype._sample = function (u, out) {
  const i = Math.floor(u);
  const f = u - i;
  const p0 = this._q(i - 1, this._a);
  const p1 = this._q(i, this._b);
  const p2 = this._q(i + 1, this._c);
  const p3 = this._q(i + 2, this._d);
  const f2 = f * f, f3 = f2 * f;
  out.x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * f + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * f2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * f3);
  out.y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * f + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * f2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * f3);
  return out;
};

/* ---- render ------------------------------------------------------------- */
/* t: progress through the current grid step, 0..1 */
Snake.prototype.render = function (t, dt, elapsed) {
  const L = this.cells.length;
  const style = this.style;
  const wave = style.pulse;
  const out = this._out;
  const bodyStart = 1;

  this._ensure(L);

  /* head */
  this._sample(1 - t, out);
  const hx = worldX(out.x), hz = worldZ(out.y);
  const bob = Math.sin(elapsed * 9) * 0.035 + this.eatAnim * 0.10;
  this.headPos.set(hx, BODY_Y + bob, hz);
  this.head.position.copy(this.headPos);

  /* face the way we travel, taking the shortest way round */
  const d = DIRS[this.dir];
  const targetYaw = Math.atan2(d.x, d.y);
  let diff = targetYaw - this.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const turnRate = dt > 0 ? clamp(dt * 14, 0, 1) : 1;
  this.yaw += diff * turnRate;
  this.head.rotation.y = this.yaw;
  this.head.rotation.z = clamp(-diff * 0.30, -0.35, 0.35);   /* lean into the turn */
  this.headDirV.set(d.x, 0, d.y);

  const hs = 1 + this.eatAnim * 0.30 - this.hurtAnim * 0.18;
  this.headMesh.scale.set(hs + this.eatAnim * 0.08, hs, hs - this.eatAnim * 0.06);
  if (this.headWire.visible) this.headWire.scale.setScalar(hs * 1.07);
  this.headGlow.scale.setScalar(2.4 + this.eatAnim * 1.6 + Math.sin(elapsed * 5) * 0.1);
  this.light.intensity = 1.05 + this.eatAnim * 1.4 + Math.sin(elapsed * 3.1) * 0.08;

  /* blink + pupils tracking the nearest core */
  this.blinkNext -= dt;
  if (this.blinkNext <= 0) { this.blink = 0.20; this.blinkNext = rnd(2.2, 6); }
  if (this.blink > 0) this.blink = Math.max(0, this.blink - dt);
  const lidT = this.blink > 0 ? Math.sin((0.20 - this.blink) / 0.20 * Math.PI) : 0;
  const eyeY = 1 - lidT * 0.92;
  for (let i = 0; i < 2; i++) {
    this.eyes[i].scale.set(1, eyeY, 1);
    this.pupils[i].visible = lidT < 0.5;
  }
  let lookX = 0, lookY = 0;
  if (this.lookAt) {
    /* convert the target into head-local space by undoing the yaw */
    const dx = this.lookAt.x - hx, dz = this.lookAt.z - hz;
    const cy = Math.cos(-this.yaw), sy = Math.sin(-this.yaw);
    const lx = dx * cy - dz * sy;
    const lz = dx * sy + dz * cy;
    const len = Math.max(0.001, Math.sqrt(lx * lx + lz * lz));
    lookX = clamp(lx / len, -1, 1) * 0.05;
    lookY = clamp((this.lookAt.y - this.headPos.y) / 2, -1, 1) * 0.04;
  }
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1;
    this.pupils[i].position.set(0.20 * s + lookX, 0.17 + lookY, 0.40);
  }

  /* mouth opens on the bite and while hurt */
  const open = Math.max(this.eatAnim, this.hurtAnim);
  this.mouth.scale.set(1 + open * 0.5, 0.36 + open * 1.5, 1 + open * 0.3);
  this.mouth.position.z = 0.36 - open * 0.03;

  /* body */
  const spin = style.spin;
  for (let i = bodyStart; i < L; i++) {
    const m = this.segments[i];
    this._sample(i + 1 - t, out);
    const taper = 1 - Math.min(0.42, (i / Math.max(8, L)) * 0.42);
    const puls = 1 + Math.sin(elapsed * 7.5 - i * 0.55) * 0.06 * (0.4 + wave);
    const s = taper * puls * (i === L - 1 ? 0.72 : 1);
    m.position.set(worldX(out.x), BODY_Y + Math.sin(elapsed * 6 - i * 0.5) * 0.022 * (0.5 + wave), worldZ(out.y));
    m.scale.set(s, s, s);
    if (spin) {
      m.rotation.y = elapsed * spin + i * 0.6;
      m.rotation.x = elapsed * spin * 0.5;
    }
    m.visible = true;
  }
  for (let i = Math.max(bodyStart, L); i < this.segments.length; i++) this.segments[i].visible = false;
  this.visibleCount = L;

  /* decay one-shot animations */
  if (dt > 0) {
    this.eatAnim = Math.max(0, this.eatAnim - dt * 3.2);
    this.hurtAnim = Math.max(0, this.hurtAnim - dt * 2.0);
    if (this.shield.visible) {
      const p = 1 + Math.sin(elapsed * 4) * 0.06;
      this.shield.scale.setScalar(p);
      this.shieldMat.opacity = 0.16 + Math.abs(Math.sin(elapsed * 2.2)) * 0.16;
    }
  }
};

Snake.prototype.bite = function () { this.eatAnim = 1; };
Snake.prototype.flinch = function () { this.hurtAnim = 1; };

Snake.prototype.hideAll = function () {
  for (let i = 0; i < this.segments.length; i++) this.segments[i].visible = false;
  this.head.visible = false;
};
Snake.prototype.showAll = function () { this.head.visible = true; };

/* world position of a body cell, used for death particles and trails */
Snake.prototype.segWorld = function (i, vec) {
  const c = this.cells[Math.min(i, this.cells.length - 1)];
  vec.set(worldX(c.x), BODY_Y, worldZ(c.y));
  return vec;
};
