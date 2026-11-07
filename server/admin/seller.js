/*
 * 出品者まわり（管理画面）
 * --------------------------------------------------
 * 1. 反映の確認依頼：出品者は「サイトに反映する」の代わりに、運営へ確認を依頼する
 * 2. 商品の申請：出品者が商品の情報と画像を登録 → 運営が画像をダウンロードして Shopify に登録する
 *
 * どちらもこのサーバーの保存先（DATA_DIR。Render ではディスク）に保存します:
 *   DATA_DIR/reviews.json                 { [イベントID]: { at, by, note } }
 *   DATA_DIR/submissions.json             { items: [...] }
 *   DATA_DIR/submissions/<ランダム>.<拡張子> 申請の画像
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./auth');

const REVIEWS = path.join(DATA_DIR, 'reviews.json');
const SUBS = path.join(DATA_DIR, 'submissions.json');
const SUB_DIR = path.join(DATA_DIR, 'submissions');
fs.mkdirSync(SUB_DIR, { recursive: true });

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

class SellerError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }

/* ---------- 1. 反映の確認依頼 ---------- */
const reviews = () => readJson(REVIEWS, {});
function requestReview(eventId, user, note = '') {
  const all = reviews();
  all[eventId] = { at: new Date().toISOString(), by: user, note: String(note || '').slice(0, 500) };
  writeJson(REVIEWS, all);
  return all[eventId];
}
function clearReview(eventId) {
  const all = reviews();
  if (!all[eventId]) return;
  delete all[eventId];
  writeJson(REVIEWS, all);
}

/* ---------- 2. 商品の申請 ---------- */
const SIZES = ['大', '中', '小'];
const STATUS = { pending: '申請中', registered: 'Shopifyに登録済み', returned: '差し戻し' };
const MAX_IMAGES = 1; // 商品の画像は1枚（サイトの商品の詳細も1枚だけ表示）
const oneLine = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const multiLine = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, max);
const intOr = (v, min, max) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
};
const FILE_RE = /^[a-f0-9]{24}\.(png|jpg|webp)$/;

const readSubs = () => readJson(SUBS, { items: [] }).items || [];
const writeSubs = (items) => writeJson(SUBS, { items });

function cleanSubmission(b) {
  const f = {
    name: oneLine(b?.name, 120),
    price: intOr(b?.price, 1, 10_000_000),
    stock: intOr(b?.stock, 0, 1_000_000),
    description: multiLine(b?.description, 2000),
    spec: oneLine(b?.spec, 200),
    size: SIZES.includes(b?.size) ? b.size : '中',
    limit: intOr(b?.limit, 1, 999),
    images: Array.isArray(b?.images) ? b.images.filter((x) => typeof x === 'string' && FILE_RE.test(x) && fs.existsSync(path.join(SUB_DIR, x))).slice(0, MAX_IMAGES) : [],
  };
  const miss = [];
  if (!f.name) miss.push('商品名');
  if (f.price == null || Number.isNaN(f.price)) miss.push('価格');
  if (f.stock == null || Number.isNaN(f.stock)) miss.push('在庫数');
  if (Number.isNaN(f.limit)) miss.push('お一人様の購入上限');
  if (!f.images.length) miss.push('商品の画像');
  if (miss.length) throw new SellerError(`入力内容を確認してください：${miss.join('・')}`);
  return f;
}

function listSubmissions(eventId) {
  return readSubs().filter((x) => x.event === eventId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
function addSubmission(eventId, body, user) {
  const items = readSubs();
  if (items.filter((x) => x.event === eventId).length >= 300) throw new SellerError('このイベントの申請は300件までです');
  const item = { id: crypto.randomBytes(8).toString('hex'), event: eventId, ...cleanSubmission(body), status: 'pending', note: '', by: user, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  items.push(item);
  writeSubs(items);
  return item;
}
/** 出品者：申請中・差し戻しのものだけ内容を直せる（直すと申請中に戻る）／運営：状態とメモを変えられる */
function updateSubmission(eventId, id, body, user, isAdmin) {
  const items = readSubs();
  const it = items.find((x) => x.id === id && x.event === eventId);
  if (!it) throw new SellerError('申請が見つかりません', 404);
  if (isAdmin && (body.status !== undefined || body.note !== undefined) && body.name === undefined) {
    if (body.status !== undefined) {
      if (!Object.hasOwn(STATUS, body.status)) throw new SellerError('状態の値');
      it.status = body.status;
    }
    if (body.note !== undefined) it.note = multiLine(body.note, 500);
  } else {
    if (!isAdmin && it.status === 'registered') throw new SellerError('Shopify に登録済みの商品は変更できません。運営にご連絡ください');
    const old = it.images;
    Object.assign(it, cleanSubmission(body), { status: isAdmin ? it.status : 'pending' });
    removeUnused(old.filter((f) => !it.images.includes(f)), items);
  }
  it.updatedAt = new Date().toISOString();
  it.updatedBy = user;
  writeSubs(items);
  return it;
}
function deleteSubmission(eventId, id, isAdmin) {
  const items = readSubs();
  const it = items.find((x) => x.id === id && x.event === eventId);
  if (!it) throw new SellerError('申請が見つかりません', 404);
  if (!isAdmin && it.status === 'registered') throw new SellerError('Shopify に登録済みの商品は削除できません。運営にご連絡ください');
  const rest = items.filter((x) => x !== it);
  writeSubs(rest);
  removeUnused(it.images, rest);
}
// どの申請からも使われていない画像を消す
function removeUnused(files, items) {
  const used = new Set(items.flatMap((x) => x.images));
  for (const f of files) if (!used.has(f)) fs.rmSync(path.join(SUB_DIR, f), { force: true });
}
/** 申請の画像を保存（まだどの申請にも付いていない）。1時間たっても使われなければ消す */
function saveImage(buf, ext) {
  const name = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(SUB_DIR, name), buf, { mode: 0o600 });
  return name;
}
function sweepOrphans() {
  const used = new Set(readSubs().flatMap((x) => x.images));
  for (const f of fs.readdirSync(SUB_DIR)) {
    if (!FILE_RE.test(f) || used.has(f)) continue;
    try { if (Date.now() - fs.statSync(path.join(SUB_DIR, f)).mtimeMs > 3600e3) fs.rmSync(path.join(SUB_DIR, f)); } catch { /* noop */ }
  }
}
setInterval(sweepOrphans, 30 * 60e3).unref?.();

/** その申請の画像か（ダウンロードのとき、他のイベントの画像を取られないように） */
function imagePath(eventId, file) {
  if (!FILE_RE.test(file || '')) return null;
  const owned = readSubs().some((x) => x.event === eventId && x.images.includes(file));
  // 申請前（フォームで選んだばかり）の画像は、どのイベントでも本人の画面でプレビューできるよう許す
  const pending = !readSubs().some((x) => x.images.includes(file));
  const p = path.join(SUB_DIR, file);
  return (owned || pending) && fs.existsSync(p) ? p : null;
}

/* ---------- まとめてダウンロード（ZIP。圧縮なしの単純な形式） ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const n = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); // UTF-8 のファイル名
    head.writeUInt16LE(0, 8); head.writeUInt32LE(0, 10); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(n.length, 26); head.writeUInt16LE(0, 28);
    parts.push(head, n, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(0, 10); c.writeUInt32LE(0, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 60) || '商品';

/** イベントの申請をまとめた ZIP（商品ごとのフォルダに画像、全体の一覧 商品一覧.csv） */
function submissionsZip(eventId, { onlyPending = false } = {}) {
  const items = listSubmissions(eventId).filter((x) => !onlyPending || x.status === 'pending');
  const files = [];
  const rows = [['番号', '商品名', '価格（税込）', '在庫数', '棚での大きさ', 'お一人様の購入上限', '仕様', '説明', '状態', '申請者', '申請日時', '画像']];
  items.forEach((x, i) => {
    const dir = `${String(i + 1).padStart(3, '0')}_${safeName(x.name)}`;
    const names = x.images.map((f, k) => {
      const p = path.join(SUB_DIR, f);
      if (!fs.existsSync(p)) return null;
      const name = `${dir}/${k + 1}${path.extname(f)}`;
      files.push({ name, data: fs.readFileSync(p) });
      return name;
    }).filter(Boolean);
    rows.push([i + 1, x.name, x.price, x.stock, x.size, x.limit ?? '', x.spec, x.description, STATUS[x.status], x.by, x.createdAt, names.join(' / ')]);
  });
  // Excel で文字化けしないよう、先頭に BOM を付ける
  files.unshift({ name: '商品一覧.csv', data: Buffer.from(`﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`, 'utf8') });
  return zip(files);
}

module.exports = {
  SellerError, STATUS, SIZES, MAX_IMAGES,
  reviews, requestReview, clearReview,
  listSubmissions, addSubmission, updateSubmission, deleteSubmission, saveImage, imagePath, submissionsZip,
};
