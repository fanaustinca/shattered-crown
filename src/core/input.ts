// Keyboard + mouse input with edge detection and pointer lock. Tests can inject state via `input.sim`.

export class Input {
  down = new Set<string>();
  pressed = new Set<string>();   // went down this frame
  released = new Set<string>();
  mouse = { dx: 0, dy: 0, wheel: 0, buttons: 0, pressedButtons: 0, releasedButtons: 0, x: 0, y: 0 };
  locked = false;
  enabled = true;
  /** when a UI panel is open, gameplay ignores movement keys */
  uiOpen = false;
  private queue: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'F1', 'F3'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.queue.push(() => this.pressed.add(e.code));
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => { this.down.delete(e.code); this.queue.push(() => this.released.add(e.code)); });
    window.addEventListener('blur', () => { this.down.clear(); this.mouse.buttons = 0; });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked && !this.uiOpen) { this.lock(); }
      const bit = 1 << e.button;
      this.mouse.buttons |= bit;
      this.queue.push(() => { this.mouse.pressedButtons |= bit; });
    });
    window.addEventListener('mouseup', (e) => {
      const bit = 1 << e.button;
      this.mouse.buttons &= ~bit;
      this.queue.push(() => { this.mouse.releasedButtons |= bit; });
    });
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (this.locked) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
    });
    window.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
  }

  lock() { try { const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined; p?.catch?.(() => {}); } catch { /* not allowed */ } }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  /** Call once per frame before gameplay reads input. */
  beginFrame() {
    for (const f of this.queue) f();
    this.queue.length = 0;
  }
  /** Call at the end of the frame. */
  endFrame() {
    this.pressed.clear(); this.released.clear();
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
    this.mouse.pressedButtons = 0; this.mouse.releasedButtons = 0;
  }
  key(code: string) { return this.enabled && !this.uiOpen && this.down.has(code); }
  hit(code: string) { return this.enabled && this.pressed.has(code); }
  btn(b: number) { return this.enabled && !this.uiOpen && (this.mouse.buttons & (1 << b)) !== 0; }
  btnHit(b: number) { return this.enabled && !this.uiOpen && (this.mouse.pressedButtons & (1 << b)) !== 0; }
  btnUp(b: number) { return this.enabled && (this.mouse.releasedButtons & (1 << b)) !== 0; }

  // ---- simulation helpers for tests ----
  simDown(code: string) { this.down.add(code); this.pressed.add(code); }
  simUp(code: string) { this.down.delete(code); this.released.add(code); }
  simTap(code: string) { this.pressed.add(code); }
  simMouse(dx: number, dy: number) { this.mouse.dx += dx; this.mouse.dy += dy; }
  simButton(b: number, down: boolean) {
    const bit = 1 << b;
    if (down) { this.mouse.buttons |= bit; this.mouse.pressedButtons |= bit; } else { this.mouse.buttons &= ~bit; this.mouse.releasedButtons |= bit; }
  }
}
