/*
 * イベント設定・棚の配置の入力チェック（サーバー側）
 * キーは js/event.js の FIELDS と同じにしてください。
 */
const TEXT = ['title', 'subtitle', 'period', 'left_title', 'left_label', 'right_title', 'right_label', 'novelty_name'];
const COLOR = ['wall_color', 'wall_pattern_color', 'lower_color', 'trim_color', 'floor_color_1', 'floor_color_2', 'sign_color', 'sign_text_color'];
const IMAGE = ['wall_image', 'floor_image'];
const SELECT = {
  theme_preset: ['', 'sky', 'night', 'holiday', 'spring'],
  wall_pattern: ['', 'clouds', 'stars', 'flowers', 'hearts', 'dots', 'stripes', 'gingham', 'none'],
  floor_style: ['', 'wood', 'check', 'tile', 'carpet'],
  light: ['', 'day', 'night'],
};
const NUMBER = ['novelty_threshold'];
const KEYS = [...TEXT, ...COLOR, ...IMAGE, ...Object.keys(SELECT), ...NUMBER];
const ROWS = 3;
const SLOTS = 5;
const TABLE_SLOTS = 5;

class InputError extends Error {}

/**
 * @param {object} event
 * @param {(img: any) => boolean} imageOk 画像の値が正しいか（保存先ごとに判定）
 */
function cleanEvent(event, imageOk) {
  if (!event || typeof event !== 'object') throw new InputError('event');
  const out = {};
  for (const k of KEYS) {
    const v = event[k];
    if (v == null || v === '') { out[k] = ''; continue; }
    if (TEXT.includes(k)) {
      if (typeof v !== 'string' || v.length > 120) throw new InputError(k);
      out[k] = v.replace(/[\u0000-\u001f]/g, '');
    } else if (COLOR.includes(k)) {
      if (!/^#[0-9a-f]{6}$/i.test(v)) throw new InputError(k);
      out[k] = v.toLowerCase();
    } else if (SELECT[k]) {
      if (!SELECT[k].includes(v)) throw new InputError(k);
      out[k] = v;
    } else if (NUMBER.includes(k)) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw new InputError(k);
      out[k] = n;
    } else if (IMAGE.includes(k)) {
      if (!imageOk(v)) throw new InputError(k);
      out[k] = { id: String(v.id), url: String(v.url) };
    }
  }
  return out;
}

function cleanLayout(layout) {
  if (layout == null) return null;
  if (typeof layout !== 'object') throw new InputError('layout');
  const id = (v) => {
    if (v == null || v === '') return null;
    if (typeof v !== 'string' || v.length > 120 || /[\u0000-\u001f]/.test(v)) throw new InputError('layout');
    return v;
  };
  const rows = (src) => Array.from({ length: ROWS }, (_, r) => Array.from({ length: SLOTS }, (_, i) => id(src?.[r]?.[i])));
  return {
    left: rows(layout.left),
    right: rows(layout.right),
    island: Array.from({ length: TABLE_SLOTS }, (_, i) => id(layout.island?.[i])),
  };
}

/** 公開用：画像を URL 文字列にする */
function flatten(event) {
  const out = { ...event };
  for (const k of IMAGE) out[k] = out[k] && typeof out[k] === 'object' ? out[k].url : (out[k] || '');
  return out;
}

module.exports = { KEYS, TEXT, COLOR, IMAGE, SELECT, NUMBER, cleanEvent, cleanLayout, flatten, InputError };
