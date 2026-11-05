/*
 * イベント設定・棚の配置の入力チェック（サーバー側）
 * キーは js/event.js の FIELDS と同じにしてください。
 */
const TEXT = ['brand', 'title', 'period', 'left_title', 'left_label', 'right_title', 'right_label', 'novelty_name',
  'entrance_kicker', 'entrance_heading', 'entrance_message', 'entrance_button'];
const MULTILINE = ['entrance_notice']; // 改行を許す（300文字まで）
const COLOR = ['wall_color', 'wall_pattern_color', 'lower_color', 'trim_color', 'floor_color_1', 'floor_color_2', 'rug_color', 'sign_color', 'sign_text_color', 'sign_sub_color',
  'entrance_color_top', 'entrance_color_bottom', 'entrance_heading_color', 'entrance_text_color', 'product_bg_color', 'avatar_ring_color', 'char_note_color'];
const IMAGE = ['wall_image', 'floor_image', 'entrance_logo', 'entrance_image'];
const SELECT = {
  theme_preset: ['', 'milktea', 'softpink', 'lavender', 'sage', 'powderblue'],
  wall_pattern: ['', 'clouds', 'stars', 'flowers', 'hearts', 'dots', 'stripes', 'gingham', 'none'],
  floor_style: ['', 'wood', 'check', 'tile', 'carpet'],
  light: ['', 'day', 'night'],
  entrance_characters: ['', 'hide'],
  novelty: ['', 'on', 'off'], // 購入特典のあり・なし（'' は名前が入っていればあり）
  // js/event.js の FONTS と同じ値
  font: ['', 'mplus-maru', 'zen-maru', 'kosugi-maru', 'kiwi-maru', 'noto-sans', 'zen-kaku', 'noto-serif', 'yusei', 'hachi-maru', 'dotgothic'],
};
const NUMBER = ['novelty_threshold'];
const DATETIME = ['open_at', 'close_at'];     // 'YYYY-MM-DDTHH:MM'（日本時間）
const TIME = ['daily_open', 'daily_close'];   // 'HH:MM'
const JSON_KEYS = ['characters', 'avatars', 'cast']; // 中身が入れ子のもの（Shopify には JSON として保存）
const HANDLE = ['collection']; // Shopify のコレクションのハンドル（このイベントで店内に並べる商品）
const KEYS = [...TEXT, ...MULTILINE, ...COLOR, ...IMAGE, ...Object.keys(SELECT), ...NUMBER, ...JSON_KEYS, ...DATETIME, ...TIME, ...HANDLE];
const schedule = require('../../js/schedule.js');
// キャラクターの ID（js/data.js の CHARACTERS と同じ。追加はできず、編集のみ）
const CHARACTER_IDS = ['haru', 'byeol', 'dalbit', 'gomi'];
const ROWS = 3;
const SLOTS = 5;
const TABLE_SLOTS = 5;

// 看板に収まる文字数（全角2・半角1で数える。js/event.js の FIELDS の maxUnits と同じ）
const UNIT_LIMITS = { brand: 30, title: 28 };
function textUnits(str) {
  let n = 0;
  for (const ch of String(str || '')) {
    const c = ch.codePointAt(0);
    n += c <= 0x7e || (c >= 0xff61 && c <= 0xff9f) ? 1 : 2;
  }
  return n;
}

// 必須項目（js/event.js の NEED で required のものと同じにする）。公開するときに確認する
const REQUIRED = { brand: 'ブランド名', title: 'イベント名', open_at: '開始日時', close_at: '終了日時' };
const blank = (v) => v == null || String(v).trim() === '';
function missingRequired(event = {}) {
  const miss = Object.entries(REQUIRED).filter(([k]) => blank(event[k])).map(([, label]) => label);
  // 購入特典を「あり」にしたときは、特典の名前も必須
  if (event.novelty === 'on' && blank(event.novelty_name)) miss.push('特典の名前');
  return miss;
}

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
      if (UNIT_LIMITS[k] && textUnits(v) > UNIT_LIMITS[k]) throw new InputError(`${k}（全角${UNIT_LIMITS[k] / 2}文字・半角${UNIT_LIMITS[k]}文字まで）`);
      out[k] = v.replace(/[\u0000-\u001f]/g, '');
    } else if (MULTILINE.includes(k)) {
      if (typeof v !== 'string' || v.length > 300) throw new InputError(k);
      out[k] = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f]/g, '');
    } else if (COLOR.includes(k)) {
      if (!/^#[0-9a-f]{6}$/i.test(v)) throw new InputError(k);
      out[k] = v.toLowerCase();
    } else if (SELECT[k]) {
      // 以前のテーマ（削除したもの）が入っているイベントは、初期設定（Milk Tea）に戻す
      if (k === 'theme_preset' && !SELECT[k].includes(v)) { out[k] = ''; continue; }
      if (!SELECT[k].includes(v)) throw new InputError(k);
      out[k] = v;
    } else if (NUMBER.includes(k)) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw new InputError(k);
      out[k] = n;
    } else if (IMAGE.includes(k)) {
      if (!imageOk(v)) throw new InputError(k);
      out[k] = { id: String(v.id), url: String(v.url) };
    } else if (DATETIME.includes(k)) {
      if (schedule.parseDateTime(v) == null) throw new InputError(`${k}（日時の形式）`);
      out[k] = v;
    } else if (TIME.includes(k)) {
      if (schedule.parseTime(v) == null) throw new InputError(`${k}（時刻の形式）`);
      out[k] = v;
    } else if (HANDLE.includes(k)) {
      if (typeof v !== 'string' || !/^[a-z0-9][a-z0-9-]{0,254}$/.test(v)) throw new InputError(`${k}（コレクション）`);
      out[k] = v;
    } else if (k === 'characters') {
      out[k] = cleanCharacters(v, imageOk);
    } else if (k === 'cast') {
      out[k] = cleanCast(v, imageOk);
    } else if (k === 'avatars') {
      out[k] = cleanAvatars(v, imageOk);
    }
  }
  // 日時の前後関係
  if (out.open_at && out.close_at && schedule.parseDateTime(out.close_at) <= schedule.parseDateTime(out.open_at)) {
    throw new InputError('終了日時は開始日時より後にしてください');
  }
  if (!!out.daily_open !== !!out.daily_close) throw new InputError('毎日の開店時刻と閉店時刻は両方入れてください（24時間営業なら両方空欄）');
  if (out.daily_open && schedule.parseTime(out.daily_close) <= schedule.parseTime(out.daily_open)) {
    throw new InputError('毎日の閉店時刻は開店時刻より後にしてください');
  }
  return out;
}

function cleanCharacters(value, imageOk) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { throw new InputError('characters'); } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new InputError('characters');
  const out = {};
  for (const id of CHARACTER_IDS) {
    const c = v[id];
    if (!c || typeof c !== 'object') continue;
    const text = (x, max, multi = false) => {
      if (x == null || x === '') return '';
      if (typeof x !== 'string' || x.length > max) throw new InputError(`characters.${id}`);
      return multi ? x.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f]/g, '') : x.replace(/[\u0000-\u001f]/g, '');
    };
    const item = {
      name: text(c.name, 20),
      en: text(c.en, 30),
      profile: text(c.profile, 200, true),
      color: '',
      image: '',
      hidden: c.hidden === true,
    };
    if (c.color) {
      if (!/^#[0-9a-f]{6}$/i.test(c.color)) throw new InputError(`characters.${id}.color`);
      item.color = c.color.toLowerCase();
    }
    if (c.image) {
      if (!imageOk(c.image)) throw new InputError(`characters.${id}.image`);
      item.image = { id: String(c.image.id), url: String(c.image.url) };
    }
    if (item.name || item.en || item.profile || item.color || item.image || item.hidden) out[id] = item;
  }
  return out;
}

/* イベントのキャラクター：{ use: true/false, list: [{ id, name, en, profile, color, image }]（12体まで） }
 * id は自社の4体（haru など）か、追加したもの（k_xxxx） */
const MAX_CAST = 12;
function cleanCast(value, imageOk) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { throw new InputError('cast'); } }
  if (!v || typeof v !== 'object' || Array.isArray(v) || !Array.isArray(v.list)) throw new InputError('cast');
  if (v.list.length > MAX_CAST) throw new InputError(`キャラクターは${MAX_CAST}体までです`);
  const seen = new Set();
  const text = (x, max, i, key, multi = false) => {
    if (x == null || x === '') return '';
    if (typeof x !== 'string' || x.length > max) throw new InputError(`キャラクター${i + 1}体目の${key}`);
    return multi ? x.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f]/g, '') : x.replace(/[\u0000-\u001f]/g, '');
  };
  const list = v.list.map((c, i) => {
    if (!c || typeof c !== 'object') throw new InputError('cast');
    const ok = typeof c.id === 'string' && (CHARACTER_IDS.includes(c.id) || /^k_[a-z0-9]{6,16}$/.test(c.id));
    if (!ok || seen.has(c.id)) throw new InputError(`キャラクター${i + 1}体目の ID`);
    seen.add(c.id);
    const name = text(c.name, 20, i, '名前').trim();
    if (!name) throw new InputError(`キャラクター${i + 1}体目の名前を入れてください`);
    const item = { id: c.id, name, en: text(c.en, 30, i, '英語名'), profile: text(c.profile, 200, i, 'プロフィール', true), color: '', image: '' };
    if (c.color) {
      if (!/^#[0-9a-f]{6}$/i.test(c.color)) throw new InputError(`キャラクター${i + 1}体目の色`);
      item.color = c.color.toLowerCase();
    }
    if (c.image) {
      if (!imageOk(c.image)) throw new InputError(`キャラクター${i + 1}体目の画像`);
      item.image = { id: String(c.image.id), url: String(c.image.url) };
    }
    return item;
  });
  return { use: v.use !== false, list };
}

/* アバター：{ hide: [キャラクターID], custom: [{ id: 'c_xxxx', name, image }]（12個まで） } */
const MAX_CUSTOM_AVATARS = 12;
function cleanAvatars(value, imageOk) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { throw new InputError('avatars'); } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new InputError('avatars');
  // 外すキャラクター：自社の4体（haru など）か、イベントのキャラクター（k_xxxx）
  const hide = Array.isArray(v.hide) ? [...new Set(v.hide.filter((id) => typeof id === 'string' && (CHARACTER_IDS.includes(id) || /^k_[a-z0-9]{6,16}$/.test(id))))] : [];
  const custom = Array.isArray(v.custom) ? v.custom : [];
  if (custom.length > MAX_CUSTOM_AVATARS) throw new InputError('avatars.custom');
  const seen = new Set();
  const out = custom.map((a, i) => {
    if (!a || typeof a !== 'object') throw new InputError(`avatars.custom.${i}`);
    if (typeof a.id !== 'string' || !/^c_[a-z0-9]{6,16}$/.test(a.id) || seen.has(a.id)) throw new InputError(`avatars.custom.${i}.id`);
    seen.add(a.id);
    if (typeof a.name !== 'string' || !a.name.trim() || a.name.length > 12) throw new InputError(`avatars.custom.${i}.name`);
    if (!imageOk(a.image)) throw new InputError(`avatars.custom.${i}.image`);
    return { id: a.id, name: a.name.replace(/[\u0000-\u001f]/g, '').trim(), image: { id: String(a.image.id), url: String(a.image.url) } };
  });
  return { hide, custom: out };
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

module.exports = { REQUIRED, missingRequired, KEYS, TEXT, MULTILINE, COLOR, IMAGE, SELECT, NUMBER, JSON_KEYS, cleanEvent, cleanLayout, flatten, InputError };
