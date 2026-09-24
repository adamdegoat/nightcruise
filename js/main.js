// Nightcruise, stage 2: walk the first deck. No captain yet (stage 3), no hiding/timer yet (stage 4).
import * as THREE from 'three';
import { buildLevel } from './level.js';
import { Input } from './input.js';
import { Player, PLAYER } from './player.js';
import { buildNav } from './nav.js';
import { Captain } from './captain.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
document.getElementById('view').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070a);
scene.fog = new THREE.FogExp2(0x07090c, 0.055);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 60);
scene.add(camera);

// base light: dim, so walls and floor are always faintly readable
scene.add(new THREE.HemisphereLight(0x6a7f96, 0x2a2c30, 1.0));

const level = buildLevel(scene);
const nav = buildNav(level);
const captain = new Captain(scene, level, nav);
const captainReady = captain.load('captain.glb?v=3');
const DEBUG = new URLSearchParams(location.search).has('debug');

// ---- lamps: every lamp has a fixture; only the 6 nearest working ones get a real light (phones can't afford 30)
const KIND = {
  ceiling: { color: 0xa8c8ff, power: 3.0, range: 7 },
  wall:    { color: 0xa8c8ff, power: 2.2, range: 6 },
  cabin:   { color: 0xffc68a, power: 1.6, range: 4.5 },
  warm:    { color: 0xffb070, power: 2.2, range: 6 },
  tube:    { color: 0xd8f0ff, power: 3.0, range: 7, flicker: 0.06 },
  red:     { color: 0xff3322, power: 2.4, range: 7 },
  chandelier: { color: 0xffc27a, power: 2.6, range: 8, flicker: 0.03 },
  dead:    { color: 0x000000, power: 0, range: 0 },
};
const fixtureGeo = new THREE.BoxGeometry(0.28, 0.05, 0.12);
for (const L of level.lamps) {
  const k = KIND[L.kind];
  L.k = k; L.t = Math.random() * 20; L.level = 1;
  L.mat = new THREE.MeshBasicMaterial({ color: k.power ? k.color : 0x111111 });
  const m = new THREE.Mesh(fixtureGeo, L.mat); m.position.copy(L.pos); scene.add(m);
}
const POOL = 6;
const pool = [];
for (let i = 0; i < POOL; i++) { const l = new THREE.PointLight(0xffffff, 0, 7, 1.6); scene.add(l); pool.push(l); }

// ---- UI
const input = new Input(document.body);
const player = new Player(camera, level);
const ui = {
  start: document.getElementById('start'), stamina: document.getElementById('stamina'), fill: document.getElementById('stamina-fill'),
  act: document.getElementById('btn-act'), fps: document.getElementById('fps'),
};
let running = false, minutes = 10;
for (const b of document.querySelectorAll('[data-min]')) {
  b.addEventListener('click', () => {
    minutes = +b.dataset.min;
    ui.start.style.display = 'none'; document.body.classList.add('playing');
    const el = document.documentElement;
    el.requestFullscreen?.().catch(() => {});
    screen.orientation?.lock?.('landscape').catch(() => {});
    startGame();
  });
}
function startGame() {
  running = true;
  captainReady.then(() => {
    captain.spawn(player.pos);
    const q = new URLSearchParams(location.search).get('cap');        // test hook: ?cap=x,z puts him there, awake
    if (q) { const [x, z] = q.split(',').map(Number); captain.pos.set(x, 0, z); captain.setState('WANDER'); captain.yaw = Math.atan2(player.pos.x - x, player.pos.z - z); }
  });
}
if (new URLSearchParams(location.search).has('play')) { ui.start.style.display = 'none'; document.body.classList.add('playing'); startGame(); }

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});

// ---- doors: the action button appears when you're close to one and looking at it
function nearestDoor() {
  let best = null, bd = 1.7;
  const f = player.forward();
  for (const d of level.doors) {
    const dx = d.center.x - player.pos.x, dz = d.center.z - player.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > bd) continue;
    if ((dx * f.x + dz * f.z) / (dist || 1) < 0.35) continue;
    bd = dist; best = d;
  }
  return best;
}
function updateDoors(dt) {
  for (const d of level.doors) {
    d.angle += (d.target - d.angle) * Math.min(1, dt * 5);
    d.pivot.rotation.y = d.base - d.openDir * d.angle;
    d.col.disabled = d.angle > 0.35;
  }
}

// ---- lamp pool: flicker, and hand the real lights to the nearest working lamps
const tmp = new THREE.Vector3();
function updateLamps(dt) {
  for (const L of level.lamps) {
    if (!L.k.power) continue;
    L.t += dt;
    let f = 1;
    if (Math.sin(L.t * 2.3) > 0.985 || Math.random() < 0.006) f = 0.08;
    if (L.k.flicker && Math.random() < L.k.flicker) f = Math.random() * 0.5;
    if (captain.root?.visible) {                      // he's near: the lamp stutters, then dies
      const cd = Math.hypot(captain.pos.x - L.pos.x, captain.pos.z - L.pos.z);
      if (cd < 4.5) { const k = 1 - cd / 4.5; if (Math.random() < 0.25 + k * 0.6) f *= Math.random() * (1 - k * 0.9); }
    }
    L.level = f;
    L.mat.color.setHex(f > 0.3 ? L.k.color : 0x151515);
    L.dist = L.pos.distanceTo(tmp.set(player.pos.x, 1.5, player.pos.z));
  }
  const live = level.lamps.filter((L) => L.k.power).sort((a, b) => a.dist - b.dist).slice(0, POOL);
  for (let i = 0; i < POOL; i++) {
    const l = pool[i], L = live[i];
    if (!L) { l.intensity = 0; continue; }
    l.position.copy(L.pos); l.position.y -= 0.15;
    l.color.setHex(L.k.color); l.distance = L.k.range;
    // fade lights handed over at the edge of the pool so they don't pop
    const edge = i === POOL - 1 ? 0.4 : 1;
    l.intensity = L.k.power * L.level * edge;
  }
}

// is this spot lit by a working lamp right now? (he sees you much further in the light)
function lightAt(x, z) {
  for (const L of level.lamps) {
    if (!L.k.power || L.level < 0.3) continue;
    if (Math.hypot(L.pos.x - x, L.pos.z - z) < L.k.range * 0.45) return true;
  }
  return false;
}

// ---- noise you make: running is loud, walking quiet, crouching near-silent, gasping when out of breath
const noises = [];
function playerNoise() {
  let r = 0;
  if (player.speed > 0.1) r = player.running ? 11 : player.crouching ? 0.8 : 3.5 * Math.min(1, player.speed / PLAYER.walk);
  if (player.stamina < 25) r = Math.max(r, 3);
  if (r > 0) noises.push({ x: player.pos.x, z: player.pos.z, r });
}

// ---- caught: he grabs you, the view snaps to his face, then black
const over = document.getElementById('over');
const catchLight = new THREE.PointLight(0xdfe6ff, 0, 3.5, 1.5); scene.add(catchLight);
let caughtT = -1;
const tmpV = new THREE.Vector3();
function caughtSequence(dt) {
  caughtT += dt;
  captain.headWorld(tmpV);
  // the view is dragged onto his face: camera ends up just in front of it, looking straight in
  const fwdX = Math.sin(captain.yaw), fwdZ = Math.cos(captain.yaw);
  const k = Math.min(1, caughtT * 5);
  const want = new THREE.Vector3(tmpV.x + fwdX * 0.7, tmpV.y + 0.0, tmpV.z + fwdZ * 0.7);
  if (caughtT < dt * 1.5) camera.userData.from = camera.position.clone();
  camera.position.lerpVectors(camera.userData.from, want, k);
  camera.lookAt(tmpV.x + fwdX * 0.1, tmpV.y + 0.04, tmpV.z + fwdZ * 0.1);
  camera.position.x += (Math.random() - .5) * 0.02 * k; camera.position.y += (Math.random() - .5) * 0.02 * k;
  // a stuttering light right on his face, so you see exactly what caught you
  catchLight.position.set(camera.position.x + (tmpV.x - camera.position.x) * 0.4, tmpV.y + 0.35, camera.position.z + (tmpV.z - camera.position.z) * 0.4);
  catchLight.intensity = Math.random() < 0.12 ? 0.2 : 3.2;
  // he closes the last half metre
  const dx = player.pos.x - captain.pos.x, dz = player.pos.z - captain.pos.z, d = Math.hypot(dx, dz);
  if (d > 0.85) { captain.pos.x += dx / d * dt * 2.5; captain.pos.z += dz / d * dt * 2.5; }
  captain.yaw = Math.atan2(dx, dz);
  if (caughtT > 1.3 && over.style.display !== 'flex') {
    over.style.display = 'flex';
    const secs = Math.round(simT - startedAt);
    document.getElementById('over-time').textContent = `You lasted ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}.`;
  }
}
document.getElementById('retry').addEventListener('click', () => location.reload());
let startedAt = 0;

// ---- loop
const clock = new THREE.Clock();
let frames = 0, acc = 0, shownDoor = null;
let simT = 0;
function tick(dt, t, render = true) {
  const inp = input.read();
  if (running && captain.caught) {
    if (caughtT < 0) { caughtT = 0; ui.act.style.display = 'none'; document.body.classList.remove('playing'); }
    caughtSequence(dt);
    captain.update(dt, t, player, [], lightAt);
  } else if (running) {
    if (!startedAt) startedAt = t;
    player.update(dt, inp, t);
    noises.length = 0; playerNoise();
    const d = nearestDoor();
    if (d !== shownDoor) {
      shownDoor = d;
      ui.act.style.display = d ? 'grid' : 'none';
    }
    if (d) ui.act.textContent = d.target > 0 ? 'CLOSE' : 'OPEN';
    if (d && inp.action) { d.target = d.target > 0 ? 0 : 1.66; noises.push({ x: d.center.x, z: d.center.z, r: 7 }); }
    const s = player.stamina / PLAYER.staminaMax;
    ui.stamina.style.opacity = s < 0.99 ? 1 : 0;
    ui.fill.style.transform = `scaleX(${s})`;
    ui.fill.classList.toggle('empty', player.exhausted);
    captain.update(dt, t, player, noises, lightAt);
    if (DEBUG) ui.fps.textContent = captain.debug;
  } else {
    // behind the start screen: slow look down the corridor
    camera.position.set(3.2, 1.62, 0); camera.rotation.set(0, -Math.PI / 2 + Math.sin(t * 0.2) * 0.15, 0.03, 'YXZ');
    player.pos.set(level.spawn.pos.x, 0, level.spawn.pos.z);
  }
  updateDoors(dt);
  updateLamps(dt);
  if (render) renderer.render(scene, camera);
  frames++; acc += dt;
  if (acc > 1 && !DEBUG) { ui.fps.textContent = Math.round(frames / acc) + ' fps'; frames = 0; acc = 0; }
}
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  simT += dt; tick(dt, simT);
});
window.__sim = (seconds, dt = 1 / 30, renderLast = false) => { const n = Math.round(seconds / dt); for (let k = 0; k < n; k++) { simT += dt; tick(dt, simT, renderLast && k === n - 1); } };
window.__game = { player, level, camera, scene, input, captain, nav };
