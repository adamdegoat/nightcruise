// Nightcruise, stage 2: walk the first deck. No captain yet (stage 3), no hiding/timer yet (stage 4).
import * as THREE from 'three';
import { buildLevel } from './level.js';
import { Input } from './input.js';
import { Player, PLAYER } from './player.js';

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
    running = true;
  });
}
if (new URLSearchParams(location.search).has('play')) { ui.start.style.display = 'none'; document.body.classList.add('playing'); running = true; }

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

// ---- loop
const clock = new THREE.Clock();
let frames = 0, acc = 0, shownDoor = null;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  const inp = input.read();
  if (running) {
    player.update(dt, inp, t);
    const d = nearestDoor();
    if (d !== shownDoor) {
      shownDoor = d;
      ui.act.style.display = d ? 'grid' : 'none';
    }
    if (d) ui.act.textContent = d.target > 0 ? 'CLOSE' : 'OPEN';
    if (d && inp.action) { d.target = d.target > 0 ? 0 : 1.66; }
    const s = player.stamina / PLAYER.staminaMax;
    ui.stamina.style.opacity = s < 0.99 ? 1 : 0;
    ui.fill.style.transform = `scaleX(${s})`;
    ui.fill.classList.toggle('empty', player.exhausted);
  } else {
    // behind the start screen: slow look down the corridor
    camera.position.set(3.2, 1.62, 0); camera.rotation.set(0, -Math.PI / 2 + Math.sin(t * 0.2) * 0.15, 0.03, 'YXZ');
    player.pos.set(level.spawn.pos.x, 0, level.spawn.pos.z);
  }
  updateDoors(dt);
  updateLamps(dt);
  renderer.render(scene, camera);
  frames++; acc += dt;
  if (acc > 1) { ui.fps.textContent = Math.round(frames / acc) + ' fps'; frames = 0; acc = 0; }
});
window.__game = { player, level, camera, scene, input };
