// The drowned captain: model setup (proportions, broken neck, jaw) + the hunting brain.
// States: RISE -> WANDER <-> INVESTIGATE (heard something) -> CHASE (saw you) -> SEARCH (lost you) -> WANDER.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { lineClear, segmentHitsBox } from './nav.js?v=4';

export const CAP = {
  wander: 0.8, investigate: 1.25, search: 1.1, chase: 3.3,   // m/s (you walk 1.45, run 3.9)
  sightLit: 16, sightDark: 8, sightCrouchDark: 4.5, sightChase: 24,
  fovCos: Math.cos(THREE.MathUtils.degToRad(65)),
  loseAfter: 2.6,          // seconds out of sight before he stops chasing and starts searching
  reach: 1.05,             // catch distance
};

const TUNE = { neck: 1.35, forearm: 1.3, hand: 1.25, finger: 1.55, gape: 0.34, height: 1.08, roll: 0.45, neckFwd: 0.25, shoulder: 0.16 };

export class Captain {
  constructor(scene, level, nav) {
    this.scene = scene; this.level = level; this.nav = nav;
    this.ready = false; this.state = 'WAIT'; this.stateT = 0;
    this.pos = new THREE.Vector3(); this.yaw = 0; this.speed = 0;
    this.path = []; this.repathT = 0; this.awareness = 0; this.unseenT = 0;
    this.lastSeen = null; this.searchLeft = 0; this.doorWait = 0; this.caught = false;
    this.visible = false; this.debug = '';
  }

  load(url) {
    return new Promise((resolve, reject) => new GLTFLoader().load(url, (g) => {
      const root = g.scene; this.root = root; const bones = this.bones = {};
      root.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = false; o.frustumCulled = false;
          const m = o.material;
          if (m.name === 'milky_eye') { m.emissive = new THREE.Color(0x9fb0aa); m.emissiveIntensity = 0.35; }
          if (m.name === 'wet_hair' || m.name === 'seaweed' || m.name === 'coat') m.side = THREE.DoubleSide;
          if (m.name === 'throat') { m.color.setRGB(0, 0, 0); m.roughness = 1; }
          if (m.name === 'drowned_skin') m.color.setScalar(0.8);
          if (m.name === 'coat' || m.name === 'trousers') { m.color.setScalar(0.7); m.roughness = 0.85; }
        }
        if (o.isBone) bones[o.name] = o;
      });
      root.scale.setScalar(TUNE.height);
      for (const s_ of ['l', 'r']) {
        const sc = (n, v) => bones[n] && bones[n].scale.set(1, v, 1);
        sc('lowerarm_' + s_, TUNE.forearm);
        bones['hand_' + s_]?.scale.set(TUNE.hand, TUNE.hand / TUNE.forearm, TUNE.hand);
        for (const f of ['index', 'middle', 'ring', 'pinky']) { sc(`${f}_01_${s_}`, TUNE.finger); sc(`${f}_02_${s_}`, TUNE.finger); }
      }
      this.head = bones.head; this.neck = bones.neck_01; this.jaw = bones.jaw;
      this.headRest = this.head.position.clone(); this.jawRest = this.jaw?.quaternion.clone();
      this.mixer = new THREE.AnimationMixer(root);
      this.actions = {};
      for (const c of g.animations) {
        c.tracks = c.tracks.filter((tr) => !tr.name.endsWith('.scale'));   // keep the proportion tuning
        this.actions[c.name] = this.mixer.clipAction(c);
      }
      root.visible = false;
      this.scene.add(root);
      this.ready = true; resolve(this);
    }, undefined, reject));
  }

  play(name, { once = false, fade = 0.25, speed = 1 } = {}) {
    const a = this.actions[name]; if (!a) return;
    a.timeScale = speed;
    if (this.cur === a) return;
    a.reset(); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat); a.clampWhenFinished = true;
    if (this.cur) a.crossFadeFrom(this.cur, fade, false);
    a.play(); this.cur = a;
  }

  setState(s) { this.state = s; this.stateT = 0; }

  // ---------- spawn far from the player ----------
  spawn(playerPos) {
    const from = this.nav.nearest(playerPos.x, playerPos.z);
    const dist = this.nav.graphDist(from);
    let far = this.nav.nodes.filter((n) => dist[n.i] > 22 && dist[n.i] < Infinity && n.room !== 'corridor');
    if (!far.length) far = this.nav.nodes.filter((n) => dist[n.i] < Infinity).sort((a, b) => dist[b.i] - dist[a.i]).slice(0, 5);
    const n = far[Math.floor(Math.random() * far.length)];
    this.pos.set(n.x, 0, n.z); this.yaw = Math.random() * Math.PI * 2;
    this.root.visible = true;
    this.setState('RISE'); this.play('rise', { once: true, fade: 0 });
  }

  // ---------- senses ----------
  canSee(player, lightAt) {
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    const chasing = this.state === 'CHASE';
    const lit = lightAt(player.pos.x, player.pos.z);
    const range = chasing ? CAP.sightChase : lit ? CAP.sightLit : player.crouching ? CAP.sightCrouchDark : CAP.sightDark;
    if (d > range) return 0;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    if (d > 1.8 && !chasing && this.state !== 'ALERT' && (dx * fx + dz * fz) / d < CAP.fovCos) return 0;
    if (!lineClear(this.level, this.pos.x, this.pos.z, player.pos.x, player.pos.z, { m: 0.04 })) return 0;
    return 1 - d / range;                                     // 0..1, closer = clearer
  }

  hear(noise) {
    // noise: {x, z, r}. Walls muffle: without a clear line it only carries 55% as far.
    const d = Math.hypot(noise.x - this.pos.x, noise.z - this.pos.z);
    const clear = lineClear(this.level, this.pos.x, this.pos.z, noise.x, noise.z, { m: 0.04 });
    return d < noise.r * (clear ? 1 : 0.55);
  }

  // ---------- movement ----------
  goTo(x, z) {
    const a = this.nav.nearest(this.pos.x, this.pos.z), b = this.nav.nearest(x, z);
    this.path = a && b ? (this.nav.path(a, b) || []) : [];
    this.finalTarget = { x, z };
  }

  step(dt, speed) {
    // returns true when the path is finished
    let target = this.path[0] || this.finalTarget;
    if (!target) return true;
    let dx = target.x - this.pos.x, dz = target.z - this.pos.z, d = Math.hypot(dx, dz);
    // skip ahead when the next-next node is directly reachable (smoother corners)
    if (this.path.length > 1 && lineClear(this.level, this.pos.x, this.pos.z, this.path[1].x, this.path[1].z)) { this.path.shift(); return false; }
    if (d < 0.25) {
      if (this.path.length) this.path.shift(); else { this.finalTarget = null; return true; }
      return false;
    }
    // a closed door in the way: open it and pause a beat
    for (const door of this.level.doors) {
      if (door.target > 0) continue;
      if (Math.hypot(door.center.x - this.pos.x, door.center.z - this.pos.z) > 1.4) continue;
      if (segmentHitsBox(this.pos.x, this.pos.z, target.x, target.z, door.col, 0.05)) {
        door.target = 1.66; this.doorWait = 0.6; this.onDoor?.(door);
      }
    }
    if (this.doorWait > 0) { this.doorWait -= dt; this.speed = 0; return false; }
    const want = Math.atan2(dx, dz);
    let dy = want - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * Math.min(1, dt * (speed > 2 ? 7 : 3.5));
    const s = Math.min(speed, d / dt);
    const turnSlow = Math.abs(dy) > 1.2 ? 0.3 : 1;             // turns before walking off sideways
    this.pos.x += Math.sin(this.yaw) * s * turnSlow * dt;
    this.pos.z += Math.cos(this.yaw) * s * turnSlow * dt;
    this.speed = s * turnSlow;
    return false;
  }

  wanderTarget() {
    const from = this.nav.nearest(this.pos.x, this.pos.z);
    const dist = this.nav.graphDist(from);
    const pick = this.nav.nodes.filter((n) => dist[n.i] > 6 && dist[n.i] < 30);
    return pick[Math.floor(Math.random() * pick.length)];
  }

  // ---------- brain ----------
  update(dt, t, player, noises, lightAt) {
    if (!this.ready || this.state === 'WAIT') return;
    this.stateT += dt;
    const see = this.state === 'RISE' ? 0 : this.canSee(player, lightAt);
    this.visible = see > 0;
    const pd = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);

    // awareness builds while he can see you; faster when close and clear
    if (see > 0) { this.awareness += dt * (0.5 + 2.2 * see); this.lastSeen = player.pos.clone(); this.unseenT = 0; }
    else { this.awareness = Math.max(0, this.awareness - dt * 0.3); this.unseenT += dt; }

    if (this.state !== 'CHASE' && this.state !== 'RISE' && this.state !== 'CATCH') {
      if (this.awareness >= 1) { this.setState('CHASE'); this.repathT = 0; }
      else if (see > 0 && this.awareness > 0.2 && this.state !== 'ALERT') { this.setState('ALERT'); this.path = []; this.finalTarget = null; }
      else if (this.state !== 'ALERT') for (const n of noises) {
        if (this.hear(n)) { this.setState('INVESTIGATE'); this.goTo(n.x, n.z); this.noiseAt = n; if (n.r > 6 && pd < 5) this.awareness = Math.max(this.awareness, 0.7); break; }
      }
    }

    switch (this.state) {
      case 'RISE':
        if (this.stateT > 1.6) { this.setState('WANDER'); this.path = []; }
        break;
      case 'WANDER':
        if (!this.path.length && !this.finalTarget) {
          if (this.stateT > 0.5 && Math.random() < 0.35 && !this.lingered) { this.lingered = true; this.setState('LINGER'); break; }
          const n = this.wanderTarget(); if (n) this.goTo(n.x, n.z); this.lingered = false;
        }
        this.step(dt, CAP.wander);
        break;
      case 'ALERT': {                                  // glimpsed something: freeze, turn to it, stare
        this.speed = 0;
        const want = Math.atan2(this.lastSeen.x - this.pos.x, this.lastSeen.z - this.pos.z);
        let dy = want - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.yaw += dy * Math.min(1, dt * 5);
        if (see > 0) this.awareness += dt * 0.35;         // staring straight at you: it builds even from far
        if (this.unseenT > 1.4) { this.setState('INVESTIGATE'); this.goTo(this.lastSeen.x, this.lastSeen.z); }
        break;
      }
      case 'LINGER':                                   // stands still, head twitching, listening
        this.speed = 0;
        if (this.stateT > 2 + Math.random() * 3) this.setState('WANDER');
        break;
      case 'INVESTIGATE':
        if (this.step(dt, CAP.investigate)) { this.setState('LOOK'); }
        break;
      case 'LOOK':                                     // at the noise / last-seen spot: turns, sniffs
        this.speed = 0; this.yaw += Math.sin(this.stateT * 1.3) * dt * 1.4;
        if (this.stateT > 3.5) { if (this.searchLeft > 0) { this.searchLeft--; this.searchNext(); } else this.setState('WANDER'); }
        break;
      case 'CHASE': {
        this.repathT -= dt;
        const direct = pd < 6 && lineClear(this.level, this.pos.x, this.pos.z, player.pos.x, player.pos.z, { m: 0.3 });
        if (direct) { this.path = []; this.finalTarget = { x: player.pos.x, z: player.pos.z }; }
        else if (this.repathT <= 0) { this.repathT = 0.35; const tgt = see > 0 ? player.pos : this.lastSeen; this.goTo(tgt.x, tgt.z); }
        this.step(dt, CAP.chase);
        if (see > 0 && pd < CAP.reach) { this.setState('CATCH'); this.caught = true; }
        else if (this.unseenT > CAP.loseAfter) {
          this.awareness = 0.4; this.searchLeft = 3; this.setState('SEARCH'); this.goTo(this.lastSeen.x, this.lastSeen.z);
        }
        break;
      }
      case 'SEARCH':
        if (this.step(dt, CAP.search)) this.setState('LOOK');
        break;
      case 'CATCH':
        this.speed = 0;
        break;
    }
    // catch also works if you walk straight into him
    if (this.state !== 'CATCH' && this.state !== 'RISE' && pd < 0.8) { this.setState('CATCH'); this.caught = true; }

    // animation follows movement
    if (this.state === 'RISE') {}
    else if (this.state === 'CATCH') this.play('grab', { once: true, fade: 0.1 });
    else if (this.speed > 2) this.play('run', { speed: 0.85 * this.speed / CAP.chase });
    else if (this.speed > 0.1) this.play('walk', { speed: 0.55 + this.speed * 0.5 });
    else this.play(this.state === 'LOOK' ? 'look' : 'idle');

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.mixer.update(dt);
    this.wrongness(dt, t);
    this.debug = `${this.state} aware ${this.awareness.toFixed(2)} d ${pd.toFixed(1)}`;
  }

  searchNext() {
    const from = this.nav.nearest(this.pos.x, this.pos.z);
    const dist = this.nav.graphDist(from);
    const near = this.nav.nodes.filter((n) => dist[n.i] > 2 && dist[n.i] < 9);
    const n = near[Math.floor(Math.random() * near.length)];
    if (n) { this.setState('SEARCH'); this.goTo(n.x, n.z); } else this.setState('WANDER');
  }

  // broken neck, hitched shoulder, hooked fingers, twitching jaw, sudden head snaps
  wrongness(dt, t) {
    const b = this.bones;
    this.head.position.copy(this.headRest).multiplyScalar(TUNE.neck);
    this.head.rotation.z += TUNE.roll;
    this.neck.rotation.x += TUNE.neckFwd;
    b.clavicle_l && (b.clavicle_l.rotation.z -= TUNE.shoulder);
    b.clavicle_r && (b.clavicle_r.rotation.x += TUNE.shoulder * 0.5);
    for (const s_ of ['l', 'r']) for (const f of ['index', 'middle', 'ring', 'pinky']) {
      const b1 = b[`${f}_01_${s_}`], b2 = b[`${f}_02_${s_}`];
      if (b1) b1.rotation.x += 0.25; if (b2) b2.rotation.x += 0.35;
    }
    const snap = this.snap ||= { t: 0, hold: 0, x: 0, y: 0, z: 0 };
    snap.t += dt;
    if (snap.t > snap.hold) {
      snap.t = 0; snap.hold = 0.12 + Math.random() * (Math.random() < 0.3 ? 1.4 : 0.35);
      const big = Math.random() < 0.18;
      snap.x = (Math.random() - .5) * (big ? 0.8 : 0.22); snap.y = (Math.random() - .5) * (big ? 0.9 : 0.2); snap.z = (Math.random() - .5) * (big ? 0.9 : 0.25);
    }
    if (this.state === 'CATCH') {
      // he bends down into your face: neck thrust forward, head level, small violent shudders
      const k = Math.min(1, this.stateT * 4);
      this.neck.rotation.x += 0.35 * k; this.head.rotation.x -= 0.2 * k; this.head.rotation.z -= TUNE.roll * 0.7 * k;
      this.head.rotation.y += (Math.random() - .5) * 0.08; this.head.rotation.z += (Math.random() - .5) * 0.08;
      b.spine_03 && (b.spine_03.rotation.x += 0.2 * k);
    } else { this.head.rotation.x += snap.x; this.head.rotation.y += snap.y; this.head.rotation.z += snap.z; }
    if (this.jaw) {
      this.jaw.quaternion.copy(this.jawRest);
      const open = TUNE.gape + (this.state === 'CHASE' || this.state === 'CATCH' ? 0.1 : 0) + Math.sin(t * 23) * 0.05 * (Math.sin(t * 1.7) > 0.4 ? 1 : 0.1);
      this.jaw.rotateX(open);
    }
  }

  headWorld(out) { return this.head.getWorldPosition(out); }
}
