// First-person body: walk / run / crouch, stamina, head bob, collision against the level's 2D boxes.
import * as THREE from 'three';

export const PLAYER = {
  radius: 0.28,
  eye: 1.62, eyeCrouch: 1.05,
  walk: 1.45, run: 3.9, crouch: 0.75,          // m/s. Captain will chase at ~3.3: you out-run him only while you have breath.
  staminaMax: 100, drain: 15, regenWalk: 7, regenStill: 13, recoverAt: 35,
  lookSpeed: 0.0042,
};

export class Player {
  constructor(camera, level) {
    this.camera = camera; this.level = level;
    this.pos = level.spawn.pos.clone();
    this.yaw = level.spawn.yaw; this.pitch = 0;
    this.stamina = PLAYER.staminaMax; this.exhausted = false;
    this.eye = PLAYER.eye; this.bob = 0; this.speed = 0;
    this.running = false; this.crouching = false;
  }

  update(dt, inp, t) {
    // look
    this.yaw -= inp.lookX * PLAYER.lookSpeed;
    this.pitch -= inp.lookY * PLAYER.lookSpeed;
    this.pitch = Math.max(-1.25, Math.min(1.25, this.pitch));

    // stance + speed
    this.crouching = inp.crouch;
    const wantsMove = Math.hypot(inp.mx, inp.my) > 0.08;
    const canRun = !this.exhausted && !this.crouching && inp.my > 0.3;
    this.running = inp.run && wantsMove && canRun;
    const target = !wantsMove ? 0 : this.crouching ? PLAYER.crouch : this.running ? PLAYER.run : PLAYER.walk;
    this.speed += (target - this.speed) * Math.min(1, dt * (target > this.speed ? 4 : 8));

    // stamina: running drains it; walking recovers slowly, standing faster. Empty = no running until partly recovered.
    if (this.running) this.stamina -= PLAYER.drain * dt;
    else this.stamina += (wantsMove ? PLAYER.regenWalk : PLAYER.regenStill) * dt;
    this.stamina = Math.max(0, Math.min(PLAYER.staminaMax, this.stamina));
    if (this.stamina <= 0) this.exhausted = true;
    if (this.exhausted && this.stamina >= PLAYER.recoverAt) this.exhausted = false;

    // move in the look direction (flattened)
    const len = Math.min(1, Math.hypot(inp.mx, inp.my)) || 1;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let vx = (fx * inp.my + rx * inp.mx), vz = (fz * inp.my + rz * inp.mx);
    const vl = Math.hypot(vx, vz);
    if (vl > 1e-4) { vx = vx / vl * this.speed * Math.min(1, len); vz = vz / vl * this.speed * Math.min(1, len); }
    else { vx = 0; vz = 0; }
    this.moveAndCollide(vx * dt, vz * dt);

    // eye height, head bob, breathing sway when tired
    const eyeTarget = this.crouching ? PLAYER.eyeCrouch : PLAYER.eye;
    this.eye += (eyeTarget - this.eye) * Math.min(1, dt * 8);
    this.bob += dt * this.speed * (this.running ? 2.6 : 3.2);
    const bobAmp = this.running ? 0.045 : this.crouching ? 0.012 : 0.022;
    const tired = 1 - this.stamina / PLAYER.staminaMax;
    const breath = Math.sin(t * (1.6 + tired * 2.5)) * 0.012 * (0.3 + tired * 1.7);
    const bobY = Math.abs(Math.sin(this.bob)) * bobAmp * Math.min(1, this.speed);

    this.camera.position.set(this.pos.x, this.eye + bobY + breath, this.pos.z);
    // the ship lists a little to port and rolls slowly
    const list = 0.03 + Math.sin(t * 0.21) * 0.012;
    const sway = Math.sin(t * 0.33) * 0.006 + Math.sin(this.bob * 0.5) * 0.004 * Math.min(1, this.speed);
    this.camera.rotation.set(this.pitch + sway, this.yaw, list + tired * Math.sin(t * 3.1) * 0.01, 'YXZ');
  }

  moveAndCollide(dx, dz) {
    // two axis passes against circle-vs-box, small steps so fast running can't tunnel through thin walls
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.08));
    for (let i = 0; i < steps; i++) {
      this.pos.x += dx / steps; this.resolve();
      this.pos.z += dz / steps; this.resolve();
    }
  }

  resolve() {
    const r = PLAYER.radius, p = this.pos;
    for (const c of this.level.colliders) {
      if (c.disabled) continue;
      const nx = Math.max(c.minX, Math.min(p.x, c.maxX));
      const nz = Math.max(c.minZ, Math.min(p.z, c.maxZ));
      const dx = p.x - nx, dz = p.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2), push = r - d;
        p.x += dx / d * push; p.z += dz / d * push;
      } else {
        // centre inside the box: push out along the shallowest axis
        const l = p.x - c.minX, rr = c.maxX - p.x, b = p.z - c.minZ, f = c.maxZ - p.z;
        const m = Math.min(l, rr, b, f);
        if (m === l) p.x = c.minX - r; else if (m === rr) p.x = c.maxX + r; else if (m === b) p.z = c.minZ - r; else p.z = c.maxZ + r;
      }
    }
  }

  forward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
}
