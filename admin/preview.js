/*
 * 管理画面の 3D プレビュー
 * お客さんのサイトと同じ店内の組み立て（js/world/room.js）を使うので、見た目はサイトと同じです。
 */
import * as THREE from '/vendor/three.module.min.js';
import { buildRoom, disposeRoom } from '/js/world/room.js';

const VIEWS = {
  overview: { pos: [0, 5.4, 7.4], target: [0, 0.9, -1.6] },
  left: { pos: [1.6, 1.6, -0.6], target: [-7, 1.1, -0.6] },
  right: { pos: [-1.6, 1.6, -0.6], target: [7, 1.1, -0.6] },
  island: { pos: [0, 2.3, 1.4], target: [0, 0.9, -1.6] },
  back: { pos: [0, 2.2, 1.5], target: [0, 2.1, -7] },
};

export class Preview {
  constructor(box, loadingEl) {
    this.box = box;
    this.loadingEl = loadingEl;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    box.prepend(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.05, 60);
    this.target = new THREE.Vector3();
    this.sph = new THREE.Spherical();
    this.room = null;
    this.queue = Promise.resolve();
    this.pending = null;
    this.setView('overview');

    new ResizeObserver(() => this.resize()).observe(box);
    this.resize();
    this.bindControls();
    const loop = () => { this.renderer.render(this.scene, this.camera); requestAnimationFrame(loop); };
    loop();
  }

  resize() {
    const w = this.box.clientWidth;
    const h = this.box.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setView(id) {
    const v = VIEWS[id] || VIEWS.overview;
    this.target.set(...v.target);
    const offset = new THREE.Vector3(...v.pos).sub(this.target);
    this.sph.setFromVector3(offset);
    this.applyCamera();
  }

  applyCamera() {
    this.sph.phi = Math.min(Math.PI / 2 - 0.02, Math.max(0.15, this.sph.phi));
    this.sph.radius = Math.min(14, Math.max(1.2, this.sph.radius));
    const p = new THREE.Vector3().setFromSpherical(this.sph).add(this.target);
    p.x = Math.max(-6.9, Math.min(6.9, p.x));
    p.z = Math.max(-6.9, Math.min(6.9, p.z));
    p.y = Math.max(0.3, Math.min(4.1, p.y));
    this.camera.position.copy(p);
    this.camera.lookAt(this.target);
  }

  bindControls() {
    const el = this.renderer.domElement;
    let drag = null;
    el.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      // お店（js/world/controls.js）と同じ向き：右にドラッグすると左を向く／下にドラッグすると見上げる
      this.sph.theta += (e.clientX - drag.x) * 0.006;
      this.sph.phi += (e.clientY - drag.y) * 0.005;
      drag = { x: e.clientX, y: e.clientY };
      this.applyCamera();
    });
    el.addEventListener('pointerup', () => { drag = null; });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.sph.radius *= e.deltaY > 0 ? 1.1 : 0.9;
      this.applyCamera();
    }, { passive: false });
  }

  /** 最新の設定で店内を作り直す（連続で呼ばれたら最後の1回だけ実行） */
  update(themeKey) {
    this.pending = themeKey;
    this.queue = this.queue.then(async () => {
      if (this.pending == null) return;
      const key = this.pending;
      this.pending = null;
      this.loadingEl.hidden = false;
      try {
        await window.HaneulEvent.fontReady(); // 看板の文字を選んだフォントで描くため
        const built = await buildRoom(window.THEMES[key]);
        if (this.room) { this.scene.remove(this.room.group); disposeRoom(this.room.group); }
        this.room = built;
        this.scene.add(built.group);
        this.scene.background = new THREE.Color(window.THEMES[key].ceiling);
      } catch (e) {
        console.error(e);
      } finally {
        this.loadingEl.hidden = true;
      }
    });
    return this.queue;
  }
}
