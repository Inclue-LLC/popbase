/*
 * アバター
 * --------------------------------------------------
 * 3D モデルの代わりに、キャラクターの絵（または管理画面で追加したアバターの画像）を
 * 立体の板（常にカメラを向くスプライト）にして歩かせます。選べるアバターは window.AVATARS（js/event.js）。
 * 名前は「形容詞＋キャラクター名」の組み合わせから選ぶ方式で、自由入力はありません（荒らし対策）。
 * NAMES / EMOTES の数は server/index.js の NAME_COUNT / EMOTE_COUNT と合わせてください。
 */
import * as THREE from '../../vendor/three.module.min.js';
import { characterTexture, shadowTexture } from './textures.js';

export const NAMES = ['ふわふわの', 'きらきらの', 'のんびり', 'おさんぽ中の', 'はらぺこの', 'ねむねむの',
  'わくわく', 'ぽかぽかの', 'にこにこ', 'そらいろの', 'ほしぞらの', 'おつきみ'];
export const EMOTES = ['👋', '❤️', '✨', '😆', '👍', '🎁'];

const texCache = new Map();
let shadowTex;

export function displayName(avatarId, nameIndex) {
  const a = window.HaneulEvent.findAvatar(avatarId);
  return `${NAMES[nameIndex] || NAMES[0]}${a.name}`;
}

export class Avatar {
  constructor({ avatar, name, isSelf = false, labelsEl }) {
    this.group = new THREE.Group();
    this.isSelf = isSelf;
    this.moving = false;
    this.t = Math.random() * 10;
    this.target = new THREE.Vector3();
    this.size = 0.9;

    shadowTex ||= shadowTexture();
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.01;
    this.group.add(shadow);

    if (isSelf) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.38, 0.46, 40),
        new THREE.MeshBasicMaterial({ color: '#4a90c8', transparent: true, opacity: 0.85, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.015;
      this.group.add(ring);
    }

    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, alphaTest: 0.05 }));
    this.sprite.center.set(0.5, 0);
    this.sprite.scale.set(this.size, this.size, 1);
    this.group.add(this.sprite);

    this.label = document.createElement('div');
    this.label.className = `avatar-label${isSelf ? ' is-self' : ''}`;
    this.label.innerHTML = '<span class="al-name"></span><span class="al-emote"></span>';
    labelsEl.appendChild(this.label);

    this.setLook(avatar, name);
  }

  async setLook(avatar, name) {
    this.avatar = avatar;
    this.name = name;
    this.label.querySelector('.al-name').textContent = displayName(avatar, name);
    // キャラクターならその絵、管理画面で追加したアバターならアップロードした画像
    const a = window.HaneulEvent.findAvatar(avatar);
    const src = a.character || { id: a.id, image: a.image };
    const key = `${a.id}|${src.image || ''}`;
    if (!texCache.has(key)) texCache.set(key, characterTexture(src, 256));
    const tex = await texCache.get(key);
    this.sprite.material.map = tex;
    this.sprite.material.needsUpdate = true;
  }

  emote(index) {
    const el = this.label.querySelector('.al-emote');
    el.textContent = EMOTES[index] || '';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.emoteTimer);
    this.emoteTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  /** 他のお客さん：受信した位置へなめらかに近づける */
  setTarget(x, z, moving) {
    this.target.set(x, 0, z);
    this.moving = moving;
  }

  update(dt, { follow = false } = {}) {
    if (follow) {
      const p = this.group.position;
      const k = 1 - Math.exp(-dt * 10);
      p.x += (this.target.x - p.x) * k;
      p.z += (this.target.z - p.z) * k;
      if (p.distanceToSquared(this.target) > 25) p.copy(this.target); // 大きくずれたら瞬間移動
    }
    this.t += dt;
    if (this.moving) {
      const b = Math.abs(Math.sin(this.t * 9));
      this.sprite.position.y = b * 0.08;
      this.sprite.scale.set(this.size * (1 + (1 - b) * 0.05), this.size * (1 - (1 - b) * 0.05), 1);
    } else {
      this.sprite.position.y += (0 - this.sprite.position.y) * Math.min(1, dt * 10);
      const breathe = 1 + Math.sin(this.t * 2) * 0.012;
      this.sprite.scale.set(this.size, this.size * breathe, 1);
    }
  }

  /** 名前ラベルを画面上の頭の位置へ */
  placeLabel(camera, width, height) {
    const v = new THREE.Vector3(0, this.size + 0.28, 0).add(this.group.position);
    const dist = v.distanceTo(camera.position);
    v.project(camera);
    const visible = v.z < 1 && dist < 16 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
    this.label.style.display = visible ? '' : 'none';
    if (visible) {
      this.label.style.transform = `translate(${((v.x + 1) / 2) * width}px, ${((1 - v.y) / 2) * height}px) translate(-50%, -100%)`;
      this.label.style.zIndex = String(1000 - Math.round(dist * 10));
    }
  }

  dispose() {
    this.label.remove();
    this.group.traverse((o) => { o.geometry?.dispose?.(); if (o.material && o !== this.sprite) o.material.dispose?.(); });
    this.sprite.material.dispose();
  }
}
