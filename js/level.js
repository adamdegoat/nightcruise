// Deck 1 of the ship: cabin corridor, 12 cabins, dining hall + bar, kitchen, crew room with a flooded stairwell.
// Units are metres. x runs aft (crew room, x<0) to fore (bar/kitchen, x=44). z is port(-)/starboard(+). y is up.
// Everything static is merged per material (few draw calls on phones). Colliders are 2D boxes in x/z.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const T = 0.12;          // wall thickness
const H_CORR = 2.6;      // corridor + cabin ceiling
const H_HALL = 3.4;      // dining hall / bar / kitchen ceiling
const H_CREW = 2.5;

// ---------- materials ----------
const loader = new THREE.TextureLoader();
function tex(name, colorSpace = true) {
  const t = loader.load(`tex/${name}.webp`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (colorSpace) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function mat(name, opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    map: tex(name + '_diff'), normalMap: tex(name + '_nor', false),
    roughness: opts.roughness ?? 0.85, metalness: opts.metalness ?? 0,
    color: opts.color ?? 0xffffff,
  });
  m.normalScale.set(opts.normal ?? 0.8, opts.normal ?? 0.8);
  return m;
}
// texel scale: metres per texture repeat
const MATS = {
  carpet:    { m: () => mat('ship_carpet', { roughness: 0.95, normal: 0.6 }), s: 1.8 },
  wallpaper: { m: () => mat('ship_wallpaper', { roughness: 0.8, normal: 0.5, color: 0xa8a8a8 }), s: 1.6 },
  panel:     { m: () => mat('dark_paneled_wood', { roughness: 0.6 }), s: 1.1 },
  parquet:   { m: () => mat('herringbone_parquet', { roughness: 0.45, color: 0x9a8a78 }), s: 1.6 },
  tiles:     { m: () => mat('dirty_tiles', { roughness: 0.35 }), s: 1.2 },
  walltile:  { m: () => mat('interior_tiles', { roughness: 0.3, color: 0xbfc4bf }), s: 1.0 },
  rust:      { m: () => mat('rusty_painted_metal', { roughness: 0.7, metalness: 0.3 }), s: 2.0 },
  deckplate: { m: () => mat('metal_plate', { roughness: 0.5, metalness: 0.6, color: 0x8a8a8a }), s: 1.5 },
  plaster:   { m: () => mat('painted_plaster_wall', { color: 0x9a968c }), s: 2.0 },
  wood:      { m: () => mat('wood_table_worn', { roughness: 0.6 }), s: 1.0 },
  // untextured
  linen:     { m: () => new THREE.MeshStandardMaterial({ color: 0x8c877c, roughness: 0.95 }), s: 1 },
  steel:     { m: () => new THREE.MeshStandardMaterial({ color: 0x6c7074, roughness: 0.35, metalness: 0.85 }), s: 1 },
  darkwood:  { m: () => new THREE.MeshStandardMaterial({ color: 0x2a1c14, roughness: 0.55 }), s: 1 },
  brass:     { m: () => new THREE.MeshStandardMaterial({ color: 0x7a6230, roughness: 0.35, metalness: 0.9 }), s: 1 },
  glass:     { m: () => new THREE.MeshStandardMaterial({ color: 0x1d2a22, roughness: 0.1, metalness: 0.2, emissive: 0x050a07 }), s: 1 },
  water:     { m: () => new THREE.MeshStandardMaterial({ color: 0x050808, roughness: 0.04, metalness: 0.3 }), s: 1 },
  black:     { m: () => new THREE.MeshBasicMaterial({ color: 0x000000 }), s: 1 },
  leather:   { m: () => new THREE.MeshStandardMaterial({ color: 0x3a2418, roughness: 0.6 }), s: 1 },
  redpaint:  { m: () => new THREE.MeshStandardMaterial({ color: 0x7a1410, roughness: 0.45, metalness: 0.2 }), s: 1 },
  paper:     { m: () => new THREE.MeshStandardMaterial({ color: 0x6e6a5e, roughness: 1 }), s: 1 },
  white:     { m: () => new THREE.MeshStandardMaterial({ color: 0xb9b6ad, roughness: 0.4 }), s: 1 },
  porthole:  { m: () => new THREE.MeshBasicMaterial({ color: 0x1b2836 }), s: 1 },
};

// ---------- geometry helpers ----------
// Box with world-space UVs so textures stay the same scale and continuous across pieces.
function box(bucket, key, cx, cy, cz, sx, sy, sz, rotY = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (rotY) g.rotateY(rotY);
  g.translate(cx, cy, cz);
  worldUV(g, MATS[key].s);
  (bucket[key] ||= []).push(g);
  return g;
}
function worldUV(g, s) {
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else if (ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv.setXY(i, u / s, v / s);
  }
}
function addGeo(bucket, key, g) { worldUV(g, MATS[key].s); (bucket[key] ||= []).push(g); }

export function buildLevel(scene) {
  const bucket = {};
  const colliders = [];   // {minX,maxX,minZ,maxZ}
  const doors = [];
  const lamps = [];       // {pos, kind, room}
  const hides = [];       // hiding spots for later stages {pos, kind}
  const collide = (minX, maxX, minZ, maxZ) => colliders.push({ minX, maxX, minZ, maxZ });

  // Axis-aligned wall from (x1,z1) to (x2,z2), height h, split around openings [{c, w, h}] (c = centre along the wall).
  // Lower 1.0m wood panelling + wallpaper above, unless a single material is given.
  function wall(x1, z1, x2, z2, h, openings = [], look = 'cabin') {
    const alongX = z1 === z2;
    const a0 = alongX ? Math.min(x1, x2) : Math.min(z1, z2);
    const a1 = alongX ? Math.max(x1, x2) : Math.max(z1, z2);
    const fixed = alongX ? z1 : x1;
    const cuts = openings.map((o) => ({ s: o.c - o.w / 2, e: o.c + o.w / 2, h: o.h ?? 2.05 })).sort((p, q) => p.s - q.s);
    const pieces = []; let cur = a0;
    for (const c of cuts) { if (c.s > cur) pieces.push([cur, c.s, 0, h]); pieces.push([c.s, c.e, c.h, h]); cur = c.e; }
    // door frames (architraves) on both faces of every opening
    const fk = look === 'rust' || look === 'walltile' ? 'steel' : 'darkwood';
    for (const c of cuts) {
      if (c.h >= h - 0.01) continue;                       // full-height gap, no frame
      for (const at of [c.s - 0.04, c.e + 0.04]) {
        if (alongX) box(bucket, fk, at, c.h / 2, fixed, 0.08, c.h, T + 0.05);
        else box(bucket, fk, fixed, c.h / 2, at, T + 0.05, c.h, 0.08);
      }
      if (alongX) box(bucket, fk, (c.s + c.e) / 2, c.h + 0.04, fixed, c.e - c.s + 0.16, 0.08, T + 0.05);
      else box(bucket, fk, fixed, c.h + 0.04, (c.s + c.e) / 2, T + 0.05, 0.08, c.e - c.s + 0.16);
    }
    if (cur < a1) pieces.push([cur, a1, 0, h]);
    for (const [s, e, y0, y1] of pieces) {
      if (e - s < 0.005 || y1 - y0 < 0.005) continue;
      const mid = (s + e) / 2, len = e - s;
      const put = (key, ya, yb) => {
        if (yb - ya < 0.005) return;
        if (alongX) box(bucket, key, mid, (ya + yb) / 2, fixed, len, yb - ya, T);
        else box(bucket, key, fixed, (ya + yb) / 2, mid, T, yb - ya, len);
      };
      if (look === 'cabin') { put('panel', y0, Math.max(y0, Math.min(1.0, y1))); put('wallpaper', Math.max(1.0, y0), y1); }
      else put(look, y0, y1);
      // trims: skirting, dado rail (cabin walls), cornice under the ceiling
      const trim = (key, yc, th, depth) => {
        if (alongX) box(bucket, key, mid, yc, fixed, len, th, T + depth);
        else box(bucket, key, fixed, yc, mid, T + depth, th, len);
      };
      const tk = look === 'rust' ? 'steel' : 'darkwood';
      if (y0 === 0) { trim(tk, 0.06, 0.12, 0.03); if (look === 'cabin') trim('darkwood', 1.0, 0.05, 0.05); }
      trim(tk, y1 - 0.05, 0.1, 0.06);
      if (y0 === 0) {
        if (alongX) collide(s, e, fixed - T / 2, fixed + T / 2);
        else collide(fixed - T / 2, fixed + T / 2, s, e);
      }
    }
  }
  function floor(key, x0, x1, z0, z1, y = 0) { box(bucket, key, (x0 + x1) / 2, y - 0.05, (z0 + z1) / 2, x1 - x0, 0.1, z1 - z0); }
  function ceiling(key, x0, x1, z0, z1, y) { box(bucket, key, (x0 + x1) / 2, y + 0.05, (z0 + z1) / 2, x1 - x0, 0.1, z1 - z0); }
  function solid(key, cx, cy, cz, sx, sy, sz, rotY = 0, blocks = true) {
    box(bucket, key, cx, cy, cz, sx, sy, sz, rotY);
    if (blocks) {
      const c = Math.abs(Math.cos(rotY)), s = Math.abs(Math.sin(rotY));
      const hx = (sx * c + sz * s) / 2, hz = (sx * s + sz * c) / 2;
      collide(cx - hx, cx + hx, cz - hz, cz + hz);
    }
  }
  function porthole(x, y, z, facing) {           // facing: +1/-1 along z (outer walls are along x)
    const ring = new THREE.TorusGeometry(0.26, 0.045, 8, 20);
    ring.translate(x, y, z - facing * 0.07); addGeo(bucket, 'brass', ring);
    const glassDisc = new THREE.CircleGeometry(0.24, 20);
    if (facing > 0) glassDisc.rotateY(Math.PI);           // face into the room
    glassDisc.translate(x, y, z - facing * 0.065); addGeo(bucket, 'porthole', glassDisc);
  }
  function door(hx, hz, width, alongX, openDir, key = 'darkwood', h = 2.0) {
    // hinge at (hx,hz); leaf extends +width along the wall axis; swings by openDir (+1/-1) * 95deg
    const geo = new THREE.BoxGeometry(width, h, 0.05); geo.translate(width / 2, h / 2, 0);
    const knob = new THREE.SphereGeometry(0.035, 8, 6); knob.translate(width - 0.08, 1.0, 0.05);
    const knob2 = knob.clone(); knob2.translate(0, 0, -0.1);
    const leaf = new THREE.Mesh(geo, MATS[key].shared);
    leaf.add(new THREE.Mesh(mergeGeometries([knob, knob2]), MATS.brass.shared));
    const pivot = new THREE.Group(); pivot.position.set(hx, 0, hz);
    pivot.rotation.y = alongX ? 0 : -Math.PI / 2;
    pivot.add(leaf); scene.add(pivot);
    const base = pivot.rotation.y;
    const cx = alongX ? hx + width / 2 : hx, cz = alongX ? hz : hz + width / 2;
    const col = alongX ? { minX: hx, maxX: hx + width, minZ: hz - 0.06, maxZ: hz + 0.06 }
                       : { minX: hx - 0.06, maxX: hx + 0.06, minZ: hz, maxZ: hz + width };
    colliders.push(col);
    doors.push({ pivot, base, openDir, angle: 0, target: 0, open: false, center: new THREE.Vector3(cx, 1, cz), col });
  }

  // =========================== CABIN CORRIDOR (x 0..28, z -1.1..1.1) ===========================
  const CAB_X0 = 3, CAB_W = 4, CAB_N = 6, CAB_D = 4;   // cabins x 3..27, 4m deep each side
  const corrDoors = [];
  for (let i = 0; i < CAB_N; i++) corrDoors.push({ c: CAB_X0 + CAB_W * i + 0.8, w: 0.9 });
  wall(0, 1.1, 28, 1.1, H_CORR, corrDoors);
  wall(0, -1.1, 28, -1.1, H_CORR, corrDoors);
  floor('carpet', 0, 28, -1.1, 1.1);
  ceiling('plaster', 0, 28, -1.1, 1.1, H_CORR);
  for (const side of [1, -1]) {
    let x = 0.2;
    for (const d of corrDoors) {
      const e = d.c - d.w / 2 - 0.15;
      const rail = new THREE.CylinderGeometry(0.025, 0.025, e - x, 8); rail.rotateZ(Math.PI / 2); rail.translate((x + e) / 2, 0.95, side * 1.02); addGeo(bucket, 'brass', rail);
      for (const bx of [x + 0.1, e - 0.1]) box(bucket, 'brass', bx, 0.95, side * 1.05, 0.03, 0.03, 0.07);
      x = d.c + d.w / 2 + 0.15;
    }
    const rail = new THREE.CylinderGeometry(0.025, 0.025, 27.8 - x, 8); rail.rotateZ(Math.PI / 2); rail.translate((x + 27.8) / 2, 0.95, side * 1.02); addGeo(bucket, 'brass', rail);
  }
  // cabin number plates beside each door
  for (let i = 0; i < CAB_N; i++) for (const side of [1, -1]) box(bucket, 'brass', CAB_X0 + CAB_W * i + 1.45, 1.55, side * 1.04, 0.16, 0.1, 0.01);
  for (const x of [2, 6, 10, 14, 18, 22, 26]) lamps.push({ pos: new THREE.Vector3(x, H_CORR - 0.08, 0), kind: 'ceiling' });

  // cabins both sides
  for (const side of [1, -1]) {
    const zIn = 1.1 * side, zOut = (1.1 + CAB_D) * side;
    for (let i = 0; i <= CAB_N; i++) wall(CAB_X0 + CAB_W * i, zIn, CAB_X0 + CAB_W * i, zOut, H_CORR);
    wall(CAB_X0, zOut, CAB_X0 + CAB_W * CAB_N, zOut, H_CORR);
    floor('carpet', CAB_X0, CAB_X0 + CAB_W * CAB_N, Math.min(zIn, zOut), Math.max(zIn, zOut));
    ceiling('plaster', CAB_X0, CAB_X0 + CAB_W * CAB_N, Math.min(zIn, zOut), Math.max(zIn, zOut), H_CORR);
    for (let i = 0; i < CAB_N; i++) {
      const x0 = CAB_X0 + CAB_W * i;
      const zc = (1.1 + CAB_D / 2) * side;
      const zFar = zOut - 0.75 * side;
      // bed: frame on legs (you can hide under it later), mattress + rumpled blanket
      solid('darkwood', x0 + 2.4, 0.32, zFar, 2.0, 0.14, 1.3);
      for (const [lx, lz] of [[-0.9, -0.55], [0.9, -0.55], [-0.9, 0.55], [0.9, 0.55]]) box(bucket, 'darkwood', x0 + 2.4 + lx, 0.13, zFar + lz, 0.07, 0.26, 0.07);
      box(bucket, 'linen', x0 + 2.4, 0.47, zFar, 1.95, 0.16, 1.25);
      box(bucket, 'linen', x0 + 2.0, 0.58, zFar + 0.1 * side, 1.2, 0.08, 1.2, 0.15 * (i % 2 ? 1 : -1));
      box(bucket, 'darkwood', x0 + 3.45, 0.75, zFar, 0.06, 0.9, 1.3);               // headboard
      hides.push({ pos: new THREE.Vector3(x0 + 2.4, 0.2, zFar), kind: 'bed' });
      // wardrobe by the corridor wall, away from the door
      solid('wood', x0 + 3.35, 1.0, zIn + 0.36 * side, 1.0, 2.0, 0.6);
      hides.push({ pos: new THREE.Vector3(x0 + 3.35, 1.0, zIn + 0.36 * side), kind: 'wardrobe' });
      // small desk + chair under the porthole side
      solid('wood', x0 + 0.55, 0.38, zFar - 0.1 * side, 0.7, 0.76, 0.5);
      porthole(x0 + 2.4, 1.55, zOut, side);
      if (i % 3 === 1) porthole(x0 + 0.9, 1.55, zOut, side);
      // cabin door: hinge on the aft side of the opening, swings into the cabin
      door(x0 + 0.8 - 0.45, zIn, 0.9, true, side);
      // a wall lamp in some cabins (most are dead)
      lamps.push({ pos: new THREE.Vector3(x0 + 2.4, 2.1, zOut - 0.12 * side), kind: (i + (side > 0 ? 0 : 1)) % 3 === 0 ? 'cabin' : 'dead' });
    }
  }
  // sealed pockets at the corridor ends (x 0..3 and 27..28 beyond the corridor walls) are never visible

  // =========================== CREW ROOM + FLOODED STAIRWELL (x -7..0) ===========================
  wall(0, -3.5, 0, 3.5, H_CREW, [{ c: 0, w: 1.0, h: 2.0 }], 'rust');
  wall(-7, -3.5, 0, -3.5, H_CREW, [], 'rust');
  wall(-7, 3.5, 0, 3.5, H_CREW, [], 'rust');
  wall(-7, -3.5, -7, 3.5, H_CREW, [], 'rust');
  // floor is laid around the stairwell opening (x -5.2..-1.3, z 1.25..3.5)
  floor('deckplate', -7, 0, -3.5, 1.25);
  floor('deckplate', -7, -5.2, 1.25, 3.5);
  floor('deckplate', -1.3, 0, 1.25, 3.5);
  ceiling('rust', -7, 0, -3.5, 3.5, H_CREW);
  door(0, -0.5, 1.0, false, 1, 'steel');
  lamps.push({ pos: new THREE.Vector3(-3.5, H_CREW - 0.1, 0), kind: 'red' });
  // lockers along the aft wall (hiding spots)
  for (let k = 0; k < 5; k++) {
    const z = -2.4 + k * 0.62;
    solid('steel', -6.68, 0.95, z, 0.55, 1.9, 0.58);
    box(bucket, 'black', -6.40, 1.6, z, 0.01, 0.05, 0.3);                               // vents
    box(bucket, 'black', -6.40, 1.5, z, 0.01, 0.05, 0.3);
    hides.push({ pos: new THREE.Vector3(-6.68, 0.95, z), kind: 'locker' });
  }
  // stairwell going down into black water, fenced off by a railing
  for (let s = 0; s < 6; s++) box(bucket, 'deckplate', -2.2 - s * 0.32, -0.12 - s * 0.2, 2.35, 0.32, 0.1, 1.9);
  box(bucket, 'water', -3.3, -0.55, 2.35, 3.6, 0.02, 2.2);
  box(bucket, 'black', -3.3, -1.2, 2.35, 3.6, 1.2, 2.2);
  solid('steel', -3.3, 0.5, 1.25, 3.6, 1.0, 0.05);                                      // railing panel
  for (const x of [-5.1, -3.3, -1.5]) box(bucket, 'steel', x, 0.5, 1.25, 0.05, 1.0, 0.05);
  solid('steel', -1.45, 0.5, 2.35, 0.05, 1.0, 2.2);

  // =========================== DINING HALL + BAR (x 28..44, z -7..7 minus kitchen) ===========================
  wall(28, -7, 28, 7, H_HALL, [{ c: 0, w: 2.2, h: H_CORR }], 'cabin');
  wall(28, -7, 44, -7, H_HALL, [], 'cabin');
  wall(28, 7, 44, 7, H_HALL, [], 'cabin');
  wall(44, -7, 44, 7, H_HALL, [], 'cabin');
  floor('parquet', 28, 38, -7, 7);
  floor('parquet', 38, 44, 0, 7);
  ceiling('plaster', 28, 44, -7, 7, H_HALL);
  for (const x of [30.5, 33.5, 36.5, 40.5]) { porthole(x, 1.7, 7, 1); porthole(x, 1.7, -7, -1); }
  // round tables with cloths and chairs; some chairs knocked over
  let tIndex = 0;
  for (const tx of [30.5, 33.5, 36.5]) for (const tz of [-5, -2.4, 2.4, 5]) {
    const top = new THREE.CylinderGeometry(0.62, 0.62, 0.05, 20); top.translate(tx, 0.76, tz); addGeo(bucket, 'linen', top);
    const cloth = new THREE.CylinderGeometry(0.64, 0.7, 0.35, 20, 1, true); cloth.translate(tx, 0.58, tz); addGeo(bucket, 'linen', cloth);
    const leg = new THREE.CylinderGeometry(0.06, 0.12, 0.74, 8); leg.translate(tx, 0.37, tz); addGeo(bucket, 'darkwood', leg);
    collide(tx - 0.6, tx + 0.6, tz - 0.6, tz + 0.6);
    for (let c = 0; c < 4; c++) {
      const a = c * Math.PI / 2 + 0.3 * (tIndex % 3);
      const cx = tx + Math.cos(a) * 0.95, cz = tz + Math.sin(a) * 0.95;
      const fallen = (tIndex * 4 + c) % 7 === 3;
      if (fallen) {
        box(bucket, 'darkwood', cx, 0.22, cz, 0.45, 0.44, 0.9, a);                     // chair on its back
      } else {
        box(bucket, 'darkwood', cx, 0.45, cz, 0.44, 0.05, 0.44, a);                    // seat
        box(bucket, 'darkwood', cx + Math.cos(a) * 0.2, 0.75, cz + Math.sin(a) * 0.2, 0.05, 0.6, 0.44, a);
        for (const [lx, lz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]])
          box(bucket, 'darkwood', cx + lx, 0.22, cz + lz, 0.04, 0.44, 0.04);
      }
      collide(cx - 0.25, cx + 0.25, cz - 0.25, cz + 0.25);
    }
    tIndex++;
  }
  // two dead chandeliers
  for (const cx of [31.5, 35.5]) {
    const ring = new THREE.TorusGeometry(0.55, 0.03, 6, 24); ring.rotateX(Math.PI / 2); ring.translate(cx, H_HALL - 0.8, 0); addGeo(bucket, 'brass', ring);
    const rod = new THREE.CylinderGeometry(0.015, 0.015, 0.75, 6); rod.translate(cx, H_HALL - 0.4, 0); addGeo(bucket, 'brass', rod);
    for (let k = 0; k < 10; k++) {
      const a = k / 10 * Math.PI * 2;
      const drop = new THREE.OctahedronGeometry(0.05); drop.translate(cx + Math.cos(a) * 0.55, H_HALL - 0.92, Math.sin(a) * 0.55); addGeo(bucket, 'glass', drop);
    }
  }
  lamps.push({ pos: new THREE.Vector3(29.2, 2.6, 6.8), kind: 'wall' }, { pos: new THREE.Vector3(29.2, 2.6, -6.8), kind: 'red' },
             { pos: new THREE.Vector3(36.5, 2.6, 6.8), kind: 'dead' }, { pos: new THREE.Vector3(36.5, 2.6, -6.8), kind: 'wall' },
             { pos: new THREE.Vector3(35.5, H_HALL - 0.95, 0), kind: 'chandelier' });
  // bar: L-shaped counter (hide behind it), back shelves with bottles, stools
  solid('darkwood', 40.3, 0.55, 3.6, 0.6, 1.1, 4.4);
  solid('darkwood', 41.6, 0.55, 1.1, 3.2, 1.1, 0.6);
  box(bucket, 'brass', 39.98, 1.12, 3.6, 0.04, 0.04, 4.4);
  hides.push({ pos: new THREE.Vector3(41.8, 0.4, 3.6), kind: 'bar' });
  solid('darkwood', 43.65, 1.1, 4.0, 0.5, 2.2, 5.6);
  for (let k = 0; k < 26; k++) {
    const bz = 1.6 + (k % 13) * 0.4 + (k * 37 % 7) * 0.02, by = k < 13 ? 1.28 : 1.78;
    if (k * 7 % 5 === 0) continue;                                                        // gaps: bottles gone
    const b = new THREE.CylinderGeometry(0.035, 0.04, 0.3, 6); b.translate(43.4, by, bz); addGeo(bucket, 'glass', b);
  }
  for (const [sx, sz] of [[39.5, 2.2], [39.5, 3.3], [39.5, 4.4], [39.4, 5.6]]) {
    const s = new THREE.CylinderGeometry(0.2, 0.2, 0.06, 12); s.translate(sx, 0.75, sz); addGeo(bucket, 'darkwood', s);
    const p = new THREE.CylinderGeometry(0.03, 0.05, 0.72, 6); p.translate(sx, 0.36, sz); addGeo(bucket, 'brass', p);
    collide(sx - 0.2, sx + 0.2, sz - 0.2, sz + 0.2);
  }
  lamps.push({ pos: new THREE.Vector3(41.5, 2.4, 3.5), kind: 'warm' });

  // =========================== KITCHEN (x 38..44, z -7..0) ===========================
  wall(38, -7, 38, 0, H_HALL, [{ c: -3.5, w: 1.0, h: 2.0 }], 'cabin');
  wall(38, 0, 44, 0, H_HALL, [], 'cabin');
  // kitchen-side tile skins over the shared walls
  box(bucket, 'walltile', 41, H_HALL / 2, -0.07, 6, H_HALL, 0.02);
  box(bucket, 'walltile', 38.07, (H_HALL + 2.0) / 2, -3.5, 0.02, H_HALL - 2.0, 1.0);
  box(bucket, 'walltile', 38.07, H_HALL / 2, -5.5, 0.02, H_HALL, 3.0);
  box(bucket, 'walltile', 38.07, H_HALL / 2, -1.5, 0.02, H_HALL, 3.0);
  // tile the kitchen side of the hall walls it shares (thin skins so the hall keeps its panelling)
  box(bucket, 'walltile', 41, H_HALL / 2, -6.93, 6, H_HALL, 0.02);
  box(bucket, 'walltile', 43.93, H_HALL / 2, -3.5, 0.02, H_HALL, 7);
  floor('tiles', 38, 44, -7, 0);
  door(38, -4.0, 1.0, false, -1, 'steel');
  solid('steel', 41, 0.45, -6.55, 5.4, 0.9, 0.7);                                        // counter along the wall
  solid('steel', 41.2, 0.45, -3.3, 1.8, 0.9, 1.0);                                       // island
  box(bucket, 'steel', 41, 1.6, -6.75, 5.4, 0.04, 0.35);                                 // shelf
  solid('steel', 43.35, 1.05, -0.6, 1.1, 2.1, 0.9);                                       // tall cold store (hide inside)
  hides.push({ pos: new THREE.Vector3(43.35, 1.0, -0.6), kind: 'coldstore' });
  for (let k = 0; k < 5; k++) {                                                            // hanging pans
    const pan = new THREE.CylinderGeometry(0.16, 0.14, 0.05, 12); pan.rotateX(Math.PI / 2); pan.translate(40.4 + k * 0.4, 2.1, -3.3); addGeo(bucket, 'steel', pan);
  }
  box(bucket, 'steel', 41.2, 2.35, -3.3, 2.2, 0.03, 0.03);
  lamps.push({ pos: new THREE.Vector3(41, H_HALL - 0.1, -3.5), kind: 'tube' });

  // =========================== water on the floor ===========================
  const puddles = [[5, 0.3, 1.4], [12.5, -0.2, 0.9], [20, 0.1, 1.7], [27.5, 0, 1.2], [32, 1, 1.5], [41, -2, 1.1], [-2.5, -1, 1.6], [34.5, -4.5, 0.8]];
  for (const [x, z, r] of puddles) {
    const g = new THREE.CircleGeometry(r, 18); g.rotateX(-Math.PI / 2); g.scale(1.3, 1, 0.7); g.translate(x, 0.004, z); addGeo(bucket, 'water', g);
  }

  // =========================== what the passengers left behind ===========================
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // cabins: suitcase (some burst open), bedside table, clothes heaped on the floor
  for (const side of [1, -1]) for (let i = 0; i < CAB_N; i++) {
    const x0 = CAB_X0 + CAB_W * i, zOut = (1.1 + CAB_D) * side, zFar = zOut - 0.75 * side;
    solid('darkwood', x0 + 1.1, 0.3, zOut - 0.3 * side, 0.4, 0.6, 0.4);                            // bedside table
    const lamp = new THREE.CylinderGeometry(0.06, 0.1, 0.22, 10); lamp.translate(x0 + 1.1, 0.71, zOut - 0.3 * side); addGeo(bucket, 'brass', lamp);
    const sx = x0 + 1.3 + rnd() * 1.2, sz = zFar - 1.15 * side, a = rnd() * 1.2;
    if (rnd() < 0.5) {
      solid('leather', sx, 0.12, sz, 0.72, 0.24, 0.46, a);                                       // closed suitcase
    } else {
      box(bucket, 'leather', sx, 0.06, sz, 0.72, 0.12, 0.46, a);                                // burst open: base
      box(bucket, 'leather', sx + Math.sin(a) * 0.3 * side, 0.22, sz - Math.cos(a) * 0.3 * side, 0.72, 0.02, 0.44, a); // lid
      box(bucket, 'linen', sx, 0.14, sz, 0.6, 0.06, 0.36, a + 0.2);
      collide(sx - 0.45, sx + 0.45, sz - 0.45, sz + 0.45);
    }
    for (let k = 0; k < 3; k++) box(bucket, 'linen', x0 + 0.6 + rnd() * 2.6, 0.03, (1.1 + 0.6 + rnd() * 1.5) * side, 0.35 + rnd() * 0.3, 0.05, 0.3 + rnd() * 0.3, rnd() * 3);
  }
  // corridor: overturned room-service trolley, a fire extinguisher on the floor, a life ring, papers everywhere
  solid('steel', 16.3, 0.35, 0.45, 0.9, 0.7, 0.5, 0.35);
  box(bucket, 'linen', 16.3, 0.72, 0.45, 0.95, 0.03, 0.55, 0.35);
  for (let k = 0; k < 3; k++) { const pl = new THREE.CylinderGeometry(0.12, 0.1, 0.02, 14); pl.translate(15.4 + k * 0.35, 0.011, -0.2 + k * 0.2); addGeo(bucket, 'white', pl); }
  const ext = new THREE.CylinderGeometry(0.08, 0.08, 0.5, 10); ext.rotateZ(Math.PI / 2); ext.rotateY(0.6); ext.translate(11.2, 0.08, -0.65); addGeo(bucket, 'redpaint', ext);
  const ring = new THREE.TorusGeometry(0.3, 0.07, 8, 20); ring.translate(24.7, 1.5, -1.0); addGeo(bucket, 'redpaint', ring);
  for (let k = 0; k < 40; k++) box(bucket, 'paper', 0.5 + rnd() * 27, 0.004 + k * 0.0004, (rnd() - 0.5) * 1.8, 0.21, 0.004, 0.29, rnd() * 3.14);
  // dining hall: plates, glasses and bottles left on tables and floor
  for (const tx of [30.5, 33.5, 36.5]) for (const tz of [-5, -2.4, 2.4, 5]) {
    if (rnd() < 0.3) continue;
    for (let k = 0; k < 3; k++) {
      const a = rnd() * 6.28, r = 0.3 + rnd() * 0.15;
      const pl = new THREE.CylinderGeometry(0.11, 0.09, 0.015, 14); pl.translate(tx + Math.cos(a) * r, 0.795, tz + Math.sin(a) * r); addGeo(bucket, 'white', pl);
      if (rnd() < 0.6) { const gl = new THREE.CylinderGeometry(0.035, 0.025, 0.14, 8); gl.translate(tx + Math.cos(a + 0.4) * r * 0.7, 0.86, tz + Math.sin(a + 0.4) * r * 0.7); addGeo(bucket, 'glass', gl); }
    }
  }
  for (let k = 0; k < 8; k++) { const b = new THREE.CylinderGeometry(0.035, 0.04, 0.3, 6); b.rotateZ(Math.PI / 2); b.rotateY(rnd() * 6); b.translate(29 + rnd() * 12, 0.04, (rnd() - 0.5) * 12); addGeo(bucket, 'glass', b); }
  // kitchen: pots left on the counter
  for (let k = 0; k < 4; k++) { const pot = new THREE.CylinderGeometry(0.15, 0.14, 0.18 + k * 0.03, 14); pot.translate(39 + k * 1.1, 0.99 + k * 0.015, -6.55); addGeo(bucket, 'steel', pot); }
  // crew room: pipes along the ceiling
  for (const [z, r] of [[-3.2, 0.06], [-2.95, 0.04], [3.2, 0.08]]) { const p = new THREE.CylinderGeometry(r, r, 7, 8); p.rotateZ(Math.PI / 2); p.translate(-3.5, H_CREW - 0.15, z); addGeo(bucket, 'rust', p); }

  // ---------- merge everything static, one mesh per material ----------
  for (const [key, list] of Object.entries(bucket)) {
    if (!list.length) continue;
    const merged = mergeGeometries(list.map((g) => g.index ? g.toNonIndexed() : g), false);
    const mesh = new THREE.Mesh(merged, MATS[key].shared);
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    scene.add(mesh);
  }

  const spawn = { pos: new THREE.Vector3(4.5, 0, 0), yaw: -Math.PI / 2 };   // corridor, looking toward the dining hall (+x)
  return { colliders, doors, lamps, hides, spawn };
}

// materials are created once and shared (doors reuse them)
for (const k of Object.keys(MATS)) MATS[k].shared = MATS[k].m();
