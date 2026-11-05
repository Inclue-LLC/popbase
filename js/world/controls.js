/*
 * 操作
 *   PC   : WASD / 矢印キーで移動、ドラッグ（店内をつかんで動かす向き）・Q/E で視点を回す、ホイールで寄る/引く、床クリックでそこへ歩く
 *   スマホ: 左下のスティックで移動、画面スワイプで視点、床タップでそこへ歩く
 *   共通 : 1〜6 でスタンプ（商品を見る・カートを見るなどは、画面の案内をクリック）
 */
export class Controls {
  constructor(root, canvas, { onTap, onInteract, onEmote }) {
    this.root = root;
    this.keys = new Set();
    this.stick = { x: 0, y: 0 };
    this.yaw = 0;
    this.pitch = 0.22;
    this.distance = 3.6;
    this.onTap = onTap;

    const typing = (e) => /input|select|textarea/i.test(e.target.tagName);
    const active = () => root.contains(document.activeElement) && !window.App?.isLayerOpen();

    window.addEventListener('keydown', (e) => {
      if (!active() || typing(e)) return;
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'w', 'a', 's', 'd', 'q', 'e'].includes(k)) e.preventDefault();
      // Enter / Space では何もしない（商品を見る・カートを見るなどは、画面の案内をクリック）。
      // ただし Enter の既定の動き（開いた画面のボタンが押されてしまう）は止めておく
      if (k === 'enter' || k === ' ') { e.preventDefault(); return; }
      if (/^[1-6]$/.test(k)) { onEmote(Number(k) - 1); return; }
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());

    // ドラッグで視点、動かさずに離したらタップ
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      root.focus({ preventScroll: true });
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.moved > 6) {
        // 店内をつかんで動かす向き（右にドラッグすると左を向く／下にドラッグすると見上げる）
        this.yaw += dx * 0.006;
        this.pitch = Math.min(0.85, Math.max(0.08, this.pitch - dy * 0.004));
      }
    });
    const end = (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      if (drag.moved <= 6) {
        const r = canvas.getBoundingClientRect();
        onTap(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      }
      drag = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', () => { drag = null; });
    canvas.addEventListener('wheel', (e) => {
      if (!active()) return;
      e.preventDefault();
      this.distance = Math.min(8, Math.max(2.2, this.distance + Math.sign(e.deltaY) * 0.4));
    }, { passive: false });

    this.setupStick(root.querySelector('#joystick'));
  }

  setupStick(el) {
    if (!el) return;
    const knob = el.querySelector('.knob');
    let id = null;
    const set = (e) => {
      const r = el.getBoundingClientRect();
      const R = r.width / 2;
      let x = e.clientX - r.left - R;
      let y = e.clientY - r.top - R;
      const len = Math.hypot(x, y);
      if (len > R) { x = (x / len) * R; y = (y / len) * R; }
      this.stick = { x: x / R, y: y / R };
      knob.style.transform = `translate(${x}px, ${y}px)`;
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      id = e.pointerId;
      el.setPointerCapture(id);
      this.root.focus({ preventScroll: true });
      set(e);
    });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    const reset = () => { id = null; this.stick = { x: 0, y: 0 }; knob.style.transform = ''; };
    el.addEventListener('pointerup', reset);
    el.addEventListener('pointercancel', reset);
  }

  /** 入力（-1〜1）。x: 右が＋、y: 前が＋ */
  input(dt) {
    const k = this.keys;
    let x = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    let y = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    if (k.has('q')) this.yaw += dt * 1.8;
    if (k.has('e')) this.yaw -= dt * 1.8;
    if (Math.abs(this.stick.x) > 0.12 || Math.abs(this.stick.y) > 0.12) { x = this.stick.x; y = -this.stick.y; }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }
}
