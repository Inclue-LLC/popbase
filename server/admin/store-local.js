/*
 * 保存先：このサーバーのファイル（Shopify 未設定のとき）
 * data/store.json に「下書き」と「公開中」を保存し、画像は data/uploads/ に置きます。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./auth');
const { cleanEvent, cleanLayout, flatten } = require('./fields');

const FILE = path.join(DATA_DIR, 'store.json');
const UPLOADS = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

const empty = () => ({
  draft: { event: {}, layout: null, rev: 0, updatedAt: null, updatedBy: null },
  published: { event: {}, layout: null, publishedAt: null, publishedBy: null },
  history: [],
});

function read() {
  try { return { ...empty(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { return empty(); }
}
function write(state) {
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

const imageOk = (v) => v && typeof v === 'object' && /^\/uploads\/[a-f0-9]{24}\.(png|jpg|webp)$/.test(v.url) && v.id === v.url;

class Conflict extends Error {}

module.exports = {
  mode: 'local',
  label: 'このサーバー（data/store.json）',

  async getState() {
    const s = read();
    return { draft: s.draft, published: s.published, history: s.history.slice(0, 20), products: null };
  },

  async saveDraft({ event, layout, rev }, user) {
    const s = read();
    if (rev !== s.draft.rev) throw new Conflict();
    s.draft = { event: cleanEvent(event, imageOk), layout: cleanLayout(layout), rev: s.draft.rev + 1, updatedAt: new Date().toISOString(), updatedBy: user };
    write(s);
    return s.draft;
  },

  async publish(user, rev) {
    const s = read();
    if (rev !== s.draft.rev) throw new Conflict();
    const at = new Date().toISOString();
    s.published = { event: s.draft.event, layout: s.draft.layout, publishedAt: at, publishedBy: user };
    s.history.unshift({ at, by: user });
    s.history = s.history.slice(0, 50);
    write(s);
    return s.published;
  },

  async discard(user) {
    const s = read();
    s.draft = { event: s.published.event, layout: s.published.layout, rev: s.draft.rev + 1, updatedAt: new Date().toISOString(), updatedBy: user };
    write(s);
    return s.draft;
  },

  async getPublished() {
    const p = read().published;
    return { event: flatten(p.event || {}), layout: p.layout };
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
