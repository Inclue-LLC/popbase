/*
 * 保存先：このサーバーのファイル（Shopify 未設定のとき）
 * data/store.json にイベントごとの「下書き」と「公開済み」を保存し、画像は data/uploads/ に置きます。
 *   { version: 2, events: { <id>: { createdAt, createdBy, draft, published, history } } }
 * 以前の形式（イベント1つだけ）は、読み込むときに ID「main」のイベントに移します。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./auth');
const { cleanEvent, cleanLayout, flatten, InputError } = require('./fields');
const ev = require('./events');

const FILE = path.join(DATA_DIR, 'store.json');
const UPLOADS = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

const emptyEvent = () => ({
  createdAt: new Date().toISOString(),
  createdBy: null,
  draft: { event: {}, layout: null, rev: 0, updatedAt: null, updatedBy: null },
  published: null,
  history: [],
});

function read() {
  let s;
  try { s = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { s = null; }
  if (s && s.version === 2) return s;
  const out = { version: 2, events: {} };
  // 以前の形式（draft / published / history）→ イベント「main」
  if (s && (s.draft || s.published)) {
    const hadPublished = s.published && s.published.publishedAt;
    out.events.main = {
      ...emptyEvent(),
      createdAt: s.published?.publishedAt || s.draft?.updatedAt || new Date().toISOString(),
      draft: { ...emptyEvent().draft, ...s.draft },
      published: hadPublished ? s.published : null,
      history: s.history || [],
    };
  }
  return out;
}
function write(state) {
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}
function getEvent(s, id) {
  const x = s.events[id];
  if (!x) throw Object.assign(new InputError('イベントが見つかりません'), { status: 404 });
  return x;
}
const list = (s) => Object.entries(s.events).map(([id, x]) => ({ id, ...x }));

const imageOk = (v) => v && typeof v === 'object' && /^\/uploads\/[a-f0-9]{24}\.(png|jpg|webp)$/.test(v.url) && v.id === v.url;

class Conflict extends Error {}

module.exports = {
  mode: 'local',
  label: 'このサーバー（data/store.json）',
  enabled: true,

  async listEvents() {
    const s = read();
    const all = list(s);
    const active = ev.pickActive(all);
    return all.map((x) => ev.summary(x, active?.id))
      .sort((a, b) => (b.open_at || b.createdAt || '').localeCompare(a.open_at || a.createdAt || ''));
  },

  async createEvent({ title, copyFrom }, user) {
    const s = read();
    const id = ev.newId();
    const x = { ...emptyEvent(), createdBy: user };
    if (copyFrom) {
      const src = getEvent(s, copyFrom);
      x.draft.event = ev.copyForNew(src.draft.event, title);
      x.draft.layout = src.draft.layout;
    } else {
      x.draft.event = { title };
    }
    x.draft = { ...x.draft, rev: 1, updatedAt: new Date().toISOString(), updatedBy: user };
    s.events[id] = x;
    write(s);
    return { id };
  },

  async deleteEvent(id) {
    const s = read();
    getEvent(s, id);
    delete s.events[id];
    write(s);
  },

  async getState(id) {
    const x = getEvent(read(), id);
    return { id, draft: x.draft, published: x.published || { event: {}, layout: null, publishedAt: null, publishedBy: null }, history: (x.history || []).slice(0, 20), products: null };
  },

  async saveDraft(id, { event, layout, rev }, user) {
    const s = read();
    const x = getEvent(s, id);
    if (rev !== x.draft.rev) throw new Conflict();
    x.draft = { event: cleanEvent(event, imageOk), layout: cleanLayout(layout), rev: x.draft.rev + 1, updatedAt: new Date().toISOString(), updatedBy: user };
    write(s);
    return x.draft;
  },

  async publish(id, user, rev) {
    const s = read();
    const x = getEvent(s, id);
    if (rev !== x.draft.rev) throw new Conflict();
    const at = new Date().toISOString();
    x.published = { event: x.draft.event, layout: x.draft.layout, publishedAt: at, publishedBy: user };
    x.history = [{ at, by: user }, ...(x.history || [])].slice(0, 50);
    write(s);
    return x.published;
  },

  async discard(id, user) {
    const s = read();
    const x = getEvent(s, id);
    const p = x.published || { event: {}, layout: null };
    x.draft = { event: p.event, layout: p.layout, rev: x.draft.rev + 1, updatedAt: new Date().toISOString(), updatedBy: user };
    write(s);
    return x.draft;
  },

  /** お客さんのサイトに出すイベント（会期で自動） */
  async getPublished() {
    const active = ev.pickActive(list(read()));
    if (!active) return { id: null, event: {}, layout: null };
    return { id: active.id, event: flatten(active.published.event || {}), layout: active.published.layout };
  },

  /** 下書きのプレビュー用 */
  async getDraft(id) {
    const x = getEvent(read(), id);
    return { id, event: flatten(x.draft.event || {}), layout: x.draft.layout };
  },

  async upload(buffer, ext) {
    const name = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(UPLOADS, name), buffer);
    const url = `/uploads/${name}`;
    return { id: url, url };
  },

  uploadsDir: UPLOADS,
  Conflict,
};
