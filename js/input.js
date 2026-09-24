// Phone: left half = floating move stick, right half = drag to look, buttons for run / crouch / action.
// Desktop (for testing): WASD + mouse drag (or pointer lock), Shift run, C crouch, E action.
export class Input {
  constructor(root) {
    this.move = { x: 0, y: 0 };       // -1..1, y forward
    this.look = { dx: 0, dy: 0 };     // accumulated pixels since last read
    this.run = false; this.crouchToggled = false; this.actionPressed = false;
    this.keys = new Set();
    this.stickTouch = null; this.lookTouch = null;
    this.stickEl = root.querySelector('#stick'); this.knobEl = root.querySelector('#knob');
    const target = root.querySelector('#touch');

    target.addEventListener('touchstart', (e) => this.onTouch(e, 'start'), { passive: false });
    target.addEventListener('touchmove', (e) => this.onTouch(e, 'move'), { passive: false });
    target.addEventListener('touchend', (e) => this.onTouch(e, 'end'), { passive: false });
    target.addEventListener('touchcancel', (e) => this.onTouch(e, 'end'), { passive: false });

    const hold = (el, on, off) => {
      el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); on(); el.classList.add('down'); }, { passive: false });
      el.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); off(); el.classList.remove('down'); }, { passive: false });
      el.addEventListener('mousedown', (e) => { e.stopPropagation(); on(); });
      el.addEventListener('mouseup', (e) => { e.stopPropagation(); off(); });
    };
    this.runBtn = root.querySelector('#btn-run'); this.crouchBtn = root.querySelector('#btn-crouch'); this.actBtn = root.querySelector('#btn-act');
    hold(this.runBtn, () => (this.run = true), () => (this.run = false));
    hold(this.crouchBtn, () => { this.crouchToggled = !this.crouchToggled; this.crouchBtn.classList.toggle('on', this.crouchToggled); }, () => {});
    hold(this.actBtn, () => (this.actionPressed = true), () => {});

    // desktop
    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyC') { this.crouchToggled = !this.crouchToggled; this.crouchBtn.classList.toggle('on', this.crouchToggled); }
      if (e.code === 'KeyE') this.actionPressed = true;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    let mouseDown = false;
    target.addEventListener('mousedown', () => { mouseDown = true; });
    addEventListener('mouseup', () => { mouseDown = false; });
    addEventListener('mousemove', (e) => {
      if (mouseDown || document.pointerLockElement) { this.look.dx += e.movementX; this.look.dy += e.movementY; }
    });
  }

  onTouch(e, phase) {
    e.preventDefault();
    const w = innerWidth;
    for (const t of e.changedTouches) {
      if (phase === 'start') {
        if (t.clientX < w * 0.45 && !this.stickTouch) {
          this.stickTouch = { id: t.identifier, ox: t.clientX, oy: t.clientY };
          this.stickEl.style.display = 'block';
          this.stickEl.style.left = t.clientX + 'px'; this.stickEl.style.top = t.clientY + 'px';
          this.knobEl.style.transform = 'translate(-50%,-50%)';
        } else if (!this.lookTouch) {
          this.lookTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
        }
      } else if (phase === 'move') {
        if (this.stickTouch && t.identifier === this.stickTouch.id) {
          const R = 56;
          let dx = t.clientX - this.stickTouch.ox, dy = t.clientY - this.stickTouch.oy;
          const d = Math.hypot(dx, dy);
          if (d > R) { dx *= R / d; dy *= R / d; }
          this.move.x = dx / R; this.move.y = -dy / R;
          this.knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        } else if (this.lookTouch && t.identifier === this.lookTouch.id) {
          this.look.dx += t.clientX - this.lookTouch.x; this.look.dy += t.clientY - this.lookTouch.y;
          this.lookTouch.x = t.clientX; this.lookTouch.y = t.clientY;
        }
      } else {
        if (this.stickTouch && t.identifier === this.stickTouch.id) {
          this.stickTouch = null; this.move.x = 0; this.move.y = 0; this.stickEl.style.display = 'none';
        } else if (this.lookTouch && t.identifier === this.lookTouch.id) this.lookTouch = null;
      }
    }
  }

  read() {
    let mx = this.move.x, my = this.move.y;
    if (this.keys.size) {
      mx = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0) || mx;
      my = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0) || my;
    }
    const out = {
      mx, my, lookX: this.look.dx, lookY: this.look.dy,
      run: this.run || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      crouch: this.crouchToggled, action: this.actionPressed,
    };
    this.look.dx = 0; this.look.dy = 0; this.actionPressed = false;
    return out;
  }
}
