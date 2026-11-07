/*
 * 店内管理画面
 * イベントを選ぶ（作る・複製する）→ 下書きを編集 → 自動保存 → プレビューで確認 → 「サイトに反映する」
 * お客さんのサイトには、公開したイベントのうち会期中のもの（なければ次に始まるもの）が自動で出る
 */
import { Preview } from './preview.js';

const $ = (s, r = document) => r.querySelector(s);
const E = window.HaneulEvent;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const yen = (n) => `¥${Number(n || 0).toLocaleString('ja-JP')}`;
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

const SAMPLE_PRODUCTS = window.PRODUCTS; // Shopify につないでいないときの商品（js/data.js）

const state = {
  user: null,
  role: 'admin',     // 'admin'（運営） | 'seller'（出品者：担当のイベントだけ）
  mode: 'local',     // 'local' | 'shopify'
  events: [],        // イベントの一覧（サーバーの要約）
  eventId: null,     // 編集中のイベント
  collections: [],   // Shopify のコレクション
  draft: null,      // { event, layout, rev, updatedAt, updatedBy }
  published: null,
  history: [],
  products: [],
  saving: false,
  saveTimer: null,
  dirtyLocal: false, // 未保存の編集がある
  selected: null,    // クリック操作で選んでいるもの { id } or { zone, row, i }
};

const isSeller = () => state.role === 'seller';
// 必須の未入力（出品者は、自分で変えられない項目＝会期・送料など は数えない）
const missingNow = () => E.missingRequired(state.draft.event).filter((f) => !isSeller() || !E.SELLER_LOCKED.includes(f.key));

/* ---------- 通信 ---------- */
async function api(path, { method = 'GET', body, raw, type } = {}) {
  const res = await fetch(`/admin/api/${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      'x-haneul-admin': '1',
      ...(raw ? { 'content-type': type || 'application/octet-stream' } : body ? { 'content-type': 'application/json' } : {}),
    },
    body: raw || (body ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `エラー（${res.status}）`), { status: res.status, data });
  return data;
}

// 編集中のイベントの API（?event=ID を付ける）
const evApi = (path, opts) => api(`${path}?event=${encodeURIComponent(state.eventId)}`, opts);

let toastTimer;
function toast(msg, { error = false } = {}) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), error ? 5000 : 2400);
}

/* ---------- ログイン ---------- */
async function start() {
  try {
    const s = await api('session');
    state.user = s.user;
    state.role = s.role || 'admin';
    state.minPassword = s.minPassword || 10;
    document.body.classList.toggle('is-seller', isSeller());
    $('#accountsBtn').hidden = isSeller();
    $('#publishBtn').textContent = isSeller() ? '反映の確認を依頼する' : 'サイトに反映する';
    $('#publishBtn').title = isSeller() ? '運営が内容を確認して、お客さんのサイトに反映します' : '';
    $('#storage').textContent = isSeller() ? '出品者のアカウント' : `保存先：${s.storage}`;
    $('#userName').textContent = `${s.user} さん`;
    state.mode = s.mode;
    window.ADMIN_SHOPIFY = s.mode === 'shopify';
    $('#login').hidden = true;
    $('#app').hidden = false;
    if (window.ADMIN_SHOPIFY) {
      try { state.collections = (await api('collections')).collections; } catch (e) { toast(`コレクションを読み込めませんでした：${e.message}`, { error: true }); }
    }
    await loadEvents();
    await route();
  } catch (e) {
    if (e.status === 401) showLogin(e.data?.needsSetup);
    else toast(e.message, { error: true });
  }
}

function showLogin(needsSetup) {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#loginSetup').hidden = !needsSetup;
  $('#loginForm [name=user]').focus();
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget; // await のあとは e.currentTarget が null になるので先に取っておく
  const f = new FormData(form);
  $('#loginError').textContent = '';
  try {
    await api('login', { method: 'POST', body: { user: f.get('user'), password: f.get('password') } });
    form.reset();
    start();
  } catch (err) {
    $('#loginError').textContent = err.message;
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  await flushSave();
  await api('logout', { method: 'POST' }).catch(() => {});
  location.reload();
});

/* ---------- 読み込み ---------- */
let preview;
async function loadState() {
  const st = await evApi('state');
  window.PRODUCTS = st.products || SAMPLE_PRODUCTS; // Shopify ならイベントのコレクションの商品
  state.products = window.PRODUCTS;
  state.draft = st.draft;
  state.draft.event ||= {};
  const filled = fillDefaults(state.draft.event);
  state.published = st.published;
  state.history = st.history || [];
  state.dirtyLocal = false;
  if (!preview) {
    try { preview = new Preview($('#previewBox'), $('#previewLoading')); } catch (e) {
      $('#previewLoading').textContent = 'このブラウザでは 3D プレビューを表示できません';
    }
  }
  renderAll();
  if (filled) changed(); // 初期の文を入れたので保存する
}

/** 初期の文がある必須の欄（お支払い方法・返品など）：空欄なら初期の文を入れる。前の初期の文のままなら新しい文にする */
function fillDefaults(ev) {
  let filled = false;
  for (const f of E.FIELDS.filter((x) => x.defaultValue)) {
    const v = f.key === 'return_text' ? E.returnTextOf(ev[f.key]) : (String(ev[f.key] ?? '').trim() ? ev[f.key] : f.defaultValue);
    if (v !== ev[f.key]) { ev[f.key] = v; filled = true; }
  }
  return filled;
}

/* ---------- イベント ---------- */
async function loadEvents() {
  state.events = (await api('events')).events;
  renderEventBar();
}

// イベントの状態（公開済みなら会期から：開催中／開催予定／終了。未公開なら「未公開」）
function eventStatus(x) {
  if (!x.published) return ['draftonly', '未公開'];
  const HS = window.HaneulSchedule;
  const now = Date.now();
  const open = HS.parseDateTime(x.open_at);
  const close = HS.parseDateTime(x.close_at);
  if (open != null && now < open) return ['soon', '開催予定'];
  if (close != null && now >= close) return ['ended', '終了'];
  return ['live', '開催中'];
}
function eventLabel(x) {
  const HS = window.HaneulSchedule;
  const when = x.open_at ? HS.periodText({ open_at: x.open_at, close_at: x.close_at }) : '会期未設定';
  return `${x.title || '（イベント名なし）'}（${when}）${x.active ? '　● 表示中' : ''}`;
}
function renderEventBar() {
  $('#eventSel').innerHTML = state.events.map((x) =>
    `<option value="${esc(x.id)}" ${x.id === state.eventId ? 'selected' : ''}>${esc(eventLabel(x))}</option>`).join('');
  const cur = state.events.find((x) => x.id === state.eventId);
  if (!cur) { $('#eventInfo').innerHTML = ''; return; }
  const [cls, label] = eventStatus(cur);
  // 状態だけを短く出し、説明は印にマウスを乗せると出す
  const note = cur.active ? 'いまお客さんのサイトに表示されています' : cur.published ? '会期になると自動でお客さんのサイトに表示されます' : '「サイトに反映する」を押すと、会期に合わせて表示されます';
  $('#eventInfo').innerHTML = `<span class="pill pill-${cls}" title="${note}">${label}</span>${cur.active ? ' <span class="pill pill-active" title="' + note + '">表示中</span>' : ''}`;
  $('#deleteEventBtn').disabled = !!cur.active;
  $('#deleteEventBtn').title = cur.active ? 'お客さんに表示中のイベントは削除できません' : '';
}
/* ---------- 画面の切り替え（#/ = イベント一覧、#/event/ID = イベントの編集） ---------- */
let openTab = null; // イベントを開いたときに選ぶタブ
async function route() {
  if (location.hash === '#/accounts' && !isSeller()) { await flushSave(); showAccounts(); return; }
  $('#accounts').hidden = true;
  const m = /^#\/event\/([\w-]+)$/.exec(location.hash);
  let target = m && state.events.find((x) => x.id === m[1]);
  // ほかのスタッフが作ったばかりのイベントなど、一覧にまだないときは読み込み直す
  if (m && !target) { await loadEvents().catch(() => {}); target = state.events.find((x) => x.id === m[1]); }
  await flushSave();
  if (!target) { showList(); return; }
  try {
    await selectEvent(target.id);
    if (openTab) { document.querySelector(`.tab[data-tab="${openTab}"]`)?.click(); openTab = null; }
  } catch (e) { toast(e.message, { error: true }); showList(); }
}
window.addEventListener('hashchange', () => { if (state.user) route(); });
const openEvent = (id, tab = null) => {
  openTab = tab;
  const h = `#/event/${id}`;
  if (location.hash === h) route(); else location.hash = h;
};

function showList() {
  state.eventId = null;
  state.draft = null;
  if (location.hash && !/^#\/?$/.test(location.hash)) history.replaceState(null, '', '#/');
  $('#app').classList.add('is-list');
  $('#eventList').hidden = false;
  renderEventList();
  window.scrollTo(0, 0);
}

/** イベント一覧：開催中 → 開催予定 → 準備中（未公開） → 終了 */
function renderEventList() {
  const HS = window.HaneulSchedule;
  const groups = { live: [], soon: [], draftonly: [], ended: [] };
  for (const x of state.events) groups[eventStatus(x)[0]].push(x);
  const t = (v) => HS.parseDateTime(v) ?? 0;
  groups.live.sort((a, b) => Number(b.active) - Number(a.active) || t(b.open_at) - t(a.open_at));
  groups.soon.sort((a, b) => t(a.open_at) - t(b.open_at));
  groups.draftonly.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  groups.ended.sort((a, b) => t(b.close_at) - t(a.close_at));
  const colTitle = (h) => state.collections.find((c) => c.handle === h)?.title || h;
  const card = (x) => {
    const [cls, label] = eventStatus(x);
    const when = x.open_at ? HS.periodText({ open_at: x.open_at, close_at: x.close_at }) : '会期未設定';
    const meta = [];
    if (window.ADMIN_SHOPIFY) meta.push(x.collection ? `コレクション：${esc(colTitle(x.collection))}` : '<span class="warn">コレクション未設定</span>');
    if (x.publishedAt) meta.push(`公開：${fmtTime(x.publishedAt)}`);
    if (x.updatedAt) meta.push(`最終更新：${fmtTime(x.updatedAt)}`);
    return `<article class="ev-card ${x.active ? 'is-active' : ''} ${cls === 'ended' ? 'is-ended' : ''}" data-id="${esc(x.id)}">
      <div class="ev-main">
        <div class="ev-badges"><span class="pill pill-${cls}">${label}</span>${x.active ? '<span class="pill pill-active">お客さんに表示中</span>' : ''}${x.review ? `<span class="pill pill-review" title="${esc(x.review.by)} さんが ${esc(fmtTime(x.review.at))} に依頼${x.review.note ? `：${esc(x.review.note)}` : ''}">${isSeller() ? '確認を依頼中' : '反映の確認依頼あり'}</span>` : ''}${x.pendingSubmissions ? `<span class="pill pill-sub">商品の申請 ${x.pendingSubmissions}件</span>` : ''}</div>
        ${x.brand ? `<p class="ev-brand">${esc(x.brand)}</p>` : ''}
        <h3>${esc(x.title || '（イベント名なし）')}</h3>
        <p class="ev-period">${esc(when)}</p>
        <p class="ev-meta">${meta.join('　')}</p>
      </div>
      <div class="ev-actions">
        <button class="btn btn-primary btn-small" data-open type="button">編集する</button>
        <button class="btn btn-small" data-copy type="button">複製</button>
        <button class="btn btn-small btn-ghost btn-danger" data-delete type="button" ${x.active ? 'disabled title="お客さんに表示中のイベントは削除できません"' : ''}>削除</button>
      </div>
    </article>`;
  };
  const section = (key, title, note) => (groups[key].length ? `
    <section class="el-group"><h2>${title}<small>${groups[key].length}件${note ? `・${note}` : ''}</small></h2>
      <div class="el-cards">${groups[key].map(card).join('')}</div></section>` : '');
  $('#eventGroups').innerHTML = state.events.length
    ? section('live', '開催中', '') + section('soon', '開催予定', '開始日時になると自動で表示') +
      section('draftonly', '準備中（未公開）', '「サイトに反映する」を押すまで表示されません') + section('ended', '終了', '')
    : isSeller()
      ? `<div class="el-empty"><h2>担当のイベントがまだありません</h2>
        <p>運営がイベントを用意して、このアカウントを担当にすると、ここに表示されます。</p></div>`
      : `<div class="el-empty"><h2>イベントがまだありません</h2>
        <p>「＋ 新しいイベント」でイベントを作ると、内装・棚の配置・入口の画面などを、イベントごとに設定できます。</p></div>`;
}

$('#eventGroups').addEventListener('click', (e) => {
  const card = e.target.closest('.ev-card');
  if (!card) return;
  const id = card.dataset.id;
  if (e.target.closest('[data-open]')) openEvent(id);
  else if (e.target.closest('[data-copy]')) createEvent({ copyFrom: id });
  else if (e.target.closest('[data-delete]')) deleteEvent(id);
});
$('#listNewBtn').addEventListener('click', () => createEvent());

async function selectEvent(id) {
  state.eventId = id;
  $('#app').classList.remove('is-list');
  $('#eventList').hidden = true;
  $('#previewLink').href = `/?preview=draft&event=${encodeURIComponent(id)}`;
  renderEventBar();
  await loadState();
  updateSubCount();
  $('#subForm').hidden = true;
  if (activeTab === 'submissions') loadSubmissions();
  if (activeTab === 'orders') loadOrders();
}

$('#eventSel').addEventListener('change', (e) => openEvent(e.target.value));

async function createEvent({ copyFrom = null } = {}) {
  const src = copyFrom && state.events.find((x) => x.id === copyFrom);
  const title = prompt(src
    ? `「${src.title || ''}」の内装・入口の画面・キャラクターなどの設定を引き継いで、新しいイベントを作ります。\n（会期・コレクションは引き継ぎません）\n\n新しいイベントの名前：`
    : '新しいイベントの名前（看板に出るイベント名。あとから変えられます）：');
  if (title == null) return;
  if (!title.trim()) { toast('イベント名を入れてください', { error: true }); return; }
  await flushSave();
  try {
    const r = await api('events', { method: 'POST', body: { title: title.trim(), copyFrom } });
    await loadEvents();
    openEvent(r.id, 'event');
    toast(src ? 'イベントを複製しました。会期とコレクションを設定してください' : 'イベントを作りました。会期とコレクションを設定してください');
  } catch (e) { toast(e.message, { error: true }); }
}
$('#copyEventBtn').addEventListener('click', () => createEvent({ copyFrom: state.eventId }));

async function deleteEvent(id) {
  const cur = state.events.find((x) => x.id === id);
  if (!cur) return;
  if (!confirm(`イベント「${cur.title || '（イベント名なし）'}」を削除します。\n下書き・公開済みの設定・公開の履歴が消え、元に戻せません。よろしいですか？`)) return;
  try {
    if (id === state.eventId) { clearTimeout(state.saveTimer); state.dirtyLocal = false; }
    await api(`events?event=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadEvents();
    if (location.hash === '#/' || !location.hash) showList(); else location.hash = '#/';
    toast('イベントを削除しました');
  } catch (e) { toast(e.message, { error: true }); }
}
$('#deleteEventBtn').addEventListener('click', () => deleteEvent(state.eventId));

/** コレクションを変えたら、そのコレクションの商品を読み込み直す */
async function changeCollection(handle) {
  if (!handle) return;
  try {
    const r = await api(`products?collection=${encodeURIComponent(handle)}`);
    window.PRODUCTS = r.products || SAMPLE_PRODUCTS;
    state.products = window.PRODUCTS;
    renderPalette();
    renderFixtures();
    refreshPreview();
    if (!state.products.length) toast('このコレクションには、まだ商品がありません（Shopify で商品を入れてください）');
  } catch (e) { toast(`商品を読み込めませんでした：${e.message}`, { error: true }); }
}

function renderAll() {
  renderPalette();
  renderFixtures();
  renderForm();
  renderCharacters();
  renderAvatars();
  renderHistory();
  renderStatus();
  refreshPreview();
}

/* ---------- 状態表示 ---------- */
const snapshot = (x) => JSON.stringify({ e: normEvent(x?.event), l: x?.layout ?? null });
function normEvent(ev = {}) {
  const out = {};
  for (const f of E.FIELDS) {
    const v = ev[f.key];
    if (f.type === 'characters') { out[f.key] = canonicalChars(v); continue; }
    if (f.type === 'cast') { out[f.key] = canonicalCast(v); continue; }
    if (f.type === 'avatars') { out[f.key] = canonicalAvatars(v); continue; }
    out[f.key] = v && typeof v === 'object' ? v.url : (v ?? '');
    if (out[f.key] !== '' && f.type === 'number') out[f.key] = Number(out[f.key]);
  }
  return out;
}
// キャラクターの設定を比較用にそろえる（空の項目は無視、画像は URL で比べる）
function canonicalChars(v) {
  let obj = v;
  if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch { obj = {}; } }
  const out = {};
  for (const id of Object.keys(obj || {}).sort()) {
    const c = obj[id] || {};
    const item = {};
    for (const k of ['name', 'en', 'profile', 'color', 'image', 'hidden']) {
      const val = k === 'image' ? E.imageUrl(c[k]) : c[k];
      if (val) item[k] = val;
    }
    if (Object.keys(item).length) out[id] = item;
  }
  return JSON.stringify(out);
}
function canonicalCast(v) {
  let obj = v;
  if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch { obj = null; } }
  if (!obj || !Array.isArray(obj.list)) return '';
  return JSON.stringify({ use: obj.use !== false, list: obj.list.map((c) => ({ id: c.id, name: c.name || '', en: c.en || '', profile: c.profile || '', color: c.color || '', bg: c.bg || '', image: E.imageUrl(c.image) })) });
}
function canonicalAvatars(v) {
  let obj = v;
  if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch { obj = {}; } }
  obj = obj || {};
  return JSON.stringify({
    hide: [...(obj.hide || [])].sort(),
    custom: (obj.custom || []).map((a) => ({ id: a.id, name: a.name, image: E.imageUrl(a.image) })),
  });
}
function renderStatus() {
  const differs = snapshot(state.draft) !== snapshot(state.published);
  const pill = differs
    ? '<span class="pill pill-dirty">未公開の変更あり</span>'
    : '<span class="pill pill-clean">公開済みと同じ</span>';
  const saved = state.saving || state.dirtyLocal
    ? '保存しています…'
    : state.draft.updatedAt ? `保存済み ${fmtTime(state.draft.updatedAt)}` : '';
  const savedTitle = state.draft.updatedAt ? `下書きを保存しました（${fmtTime(state.draft.updatedAt)}${state.draft.updatedBy ? `・${state.draft.updatedBy}` : ''}）` : '';
  const miss = missingNow();
  const missPill = miss.length ? `<span class="pill pill-missing" title="${esc(miss.map((f) => f.label).join('・'))}">必須の未入力 ${miss.length}</span>` : '';
  $('#status').innerHTML = `${pill}${missPill}<span class="saved" title="${esc(savedTitle)}">${saved}</span>`;
  // 保存ボタン：未保存の変更があれば「保存」、保存中は「保存中…」、なければ「保存済み」
  const sb = $('#saveBtn');
  sb.textContent = state.saving ? '保存中…' : state.dirtyLocal ? '保存' : '保存済み ✓';
  sb.classList.toggle('is-dirty', state.dirtyLocal && !state.saving);
  // 出品者：確認を依頼済みなら、その旨を出す
  const rv = state.events.find((x) => x.id === state.eventId)?.review;
  if (isSeller() && rv) $('#status').insertAdjacentHTML('afterbegin', `<span class="pill pill-review" title="${esc(fmtTime(rv.at))} に依頼">確認を依頼中</span>`);
  $('#publishBtn').disabled = !differs || state.saving || state.dirtyLocal;
}

/* ---------- 自動保存 ---------- */
function changed({ previewNow = true } = {}) {
  state.dirtyLocal = true;
  renderStatus();
  if (previewNow) refreshPreview();
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(save, 700);
}

async function save() {
  if (state.saving) { state.saveTimer = setTimeout(save, 300); return; }
  // 名前が空のアバター・キャラクターがあるうちは保存しない（サーバーで受け付けないため）
  const blankName = (list) => (list || []).some((a) => !String(a.name || '').trim());
  if (blankName(state.draft.event.avatars?.custom) || blankName(state.draft.event.cast?.list)) {
    state.dirtyLocal = true;
    renderStatus();
    toast(blankName(state.draft.event.cast?.list) ? '名前が空のキャラクターがあります。名前を入れると保存されます' : '名前が空のアバターがあります。名前を入れると保存されます', { error: true });
    return;
  }
  state.saving = true;
  state.dirtyLocal = false;
  renderStatus();
  try {
    const r = await evApi('draft', { method: 'PUT', body: { event: state.draft.event, layout: state.draft.layout, rev: state.draft.rev } });
    Object.assign(state.draft, { rev: r.rev, updatedAt: r.updatedAt, updatedBy: r.updatedBy });
  } catch (e) {
    if (e.status === 409) { toast(e.message, { error: true }); await loadState(); return; }
    if (e.status === 401) { showLogin(false); return; }
    state.dirtyLocal = true;
    toast(`保存できませんでした：${e.message}`, { error: true });
  } finally {
    state.saving = false;
    renderStatus();
  }
}

async function flushSave() {
  if (state.dirtyLocal) { clearTimeout(state.saveTimer); await save(); }
  while (state.saving) await new Promise((r) => setTimeout(r, 100));
}

/* ---------- 保存ボタン（自動保存に加えて、手動でも保存できる） ---------- */
async function saveNow() {
  if (!state.draft) return;
  const had = state.dirtyLocal;
  await flushSave();
  if (state.dirtyLocal) return; // 保存できなかった（理由はトーストで表示済み）
  toast(had ? '保存しました' : 'すべて保存済みです');
}
$('#saveBtn').addEventListener('click', saveNow);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(); }
});

/* ---------- 公開・取り消し ---------- */
$('#publishBtn').addEventListener('click', async () => {
  if (isSeller()) { requestReview(); return; }
  // 必須項目が空欄なら公開しない
  const miss = E.missingRequired(state.draft.event);
  if (miss.length) {
    toast(`必須項目が未入力です：${miss.map((f) => f.label).join('・')}`, { error: true });
    document.querySelector('.tab[data-tab="event"]').click();
    renderForm();
    document.getElementById(`f_${miss[0].key}`)?.focus();
    return;
  }
  await flushSave();
  if (!confirm('サイトに反映します。会期中のイベントなら、お客さんのサイトにすぐ反映されます。よろしいですか？')) return;
  try {
    const pub = await evApi('publish', { method: 'POST', body: { rev: state.draft.rev } });
    state.published = pub;
    state.history.unshift({ at: pub.publishedAt, by: pub.publishedBy });
    await loadEvents(); // お客さんに出すイベントが変わることがある
    const cur = state.events.find((x) => x.id === state.eventId);
    toast(cur?.active ? 'サイトに反映しました。お客さんのサイトに表示されています' : 'サイトに反映しました。会期になると自動でお客さんのサイトに表示されます');
    renderStatus();
    renderHistory();
  } catch (e) {
    toast(e.message, { error: true });
    if (e.status === 409) loadState();
  }
});

$('#discardBtn').addEventListener('click', async () => {
  if (!confirm('下書きの変更をすべて捨てて、このイベントの公開済みの内容に戻します。よろしいですか？')) return;
  await flushSave();
  try {
    await evApi('discard', { method: 'POST' });
    await loadState();
    toast('公開中の内容に戻しました');
  } catch (e) { toast(e.message, { error: true }); }
});

$('#previewLink').addEventListener('click', async (e) => {
  if (state.dirtyLocal || state.saving) {
    e.preventDefault();
    await flushSave();
    window.open(`/?preview=draft&event=${encodeURIComponent(state.eventId)}`, '_blank', 'noopener');
  }
});

/* ---------- タブ ---------- */
let activeTab = 'layout';
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.setAttribute('aria-selected', String(x === t)));
  document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.dataset.panel !== t.dataset.tab; });
  const wasEntrance = activeTab === 'entrance';
  activeTab = t.dataset.tab;
  // 「入口の画面」タブでは、右側を入口のプレビューに切り替える
  const onEntrance = activeTab === 'entrance';
  $('.preview').classList.toggle('is-entrance', onEntrance);
  $('.preview').classList.toggle('is-avatars', activeTab === 'avatars');
  $('#avatarPreview').hidden = activeTab !== 'avatars';
  if (activeTab === 'avatars') renderAvatars();
  $('#entrancePreview').hidden = !onEntrance;
  if (onEntrance) openEntrancePreview();
  else if (wasEntrance) refreshPreview();
  // 商品の申請・注文：右の 3D プレビューは使わない
  $('.workspace').classList.toggle('no-preview', activeTab === 'submissions' || activeTab === 'orders');
  if (activeTab === 'submissions') loadSubmissions();
  if (activeTab === 'orders') loadOrders();
  if (activeTab === 'characters' && preview) {
    preview.setView('back');
    document.querySelectorAll('#previewViews button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.view === 'back')));
  }
}));

/* ---------- 入口の画面のプレビュー（実際のサイトを iframe で小さく表示） ---------- */
const DEVICES = { pc: [1280, 800], sp: [390, 844] };
let device = 'pc';
function openEntrancePreview() {
  const frame = $('#epFrame');
  if (!frame.src) frame.src = '/?entrance-preview=1';
  fitEntrance();
  postEntrance();
}
function fitEntrance() {
  const [dw, dh] = DEVICES[device];
  const w = $('.preview').clientWidth;
  const maxH = device === 'sp' ? Math.max(360, window.innerHeight - 260) : Infinity;
  const scale = Math.min(w / dw, maxH / dh);
  const stage = $('#epStage');
  stage.style.width = `${Math.round(dw * scale)}px`;
  stage.style.height = `${Math.round(dh * scale)}px`;
  const frame = $('#epFrame');
  frame.style.width = `${dw}px`;
  frame.style.height = `${dh}px`;
  frame.style.transform = `scale(${scale})`;
}
function postEntrance() {
  const win = $('#epFrame').contentWindow;
  if (win && state.draft) win.postMessage({ type: 'haneul:entrance', event: state.draft.event }, location.origin);
}
window.addEventListener('message', (e) => {
  if (e.origin === location.origin && e.source === $('#epFrame').contentWindow && e.data?.type === 'haneul:entrance-ready') postEntrance();
});
window.addEventListener('resize', () => { if (activeTab === 'entrance') fitEntrance(); });
$('#epDevices').addEventListener('click', (e) => {
  const b = e.target.closest('[data-device]');
  if (!b) return;
  device = b.dataset.device;
  document.querySelectorAll('#epDevices button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  fitEntrance();
});

/* ---------- プレビュー ---------- */
function refreshPreview() {
  if (activeTab === 'entrance') { postEntrance(); return; }
  if (!preview) return;
  E.applyEvent(state.draft.event);
  E.applyLayout(currentLayout());
  preview.update('event');
}
$('#previewViews').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b || !preview) return;
  preview.setView(b.dataset.view);
  document.querySelectorAll('#previewViews button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
});

/* ==========================================================
   商品の配置
   ========================================================== */
// 配置が未設定（自動）のときは、自動配置と同じ並びを表示する
function currentLayout() {
  return state.draft.layout ? E.normalize(state.draft.layout, state.products) : null;
}
function editableLayout() {
  return E.normalize(state.draft.layout || E.autoLayout(state.products.map((p) => ({ ...p, display: null }))), state.products);
}
/** 商品が置かれている枠の一覧（同じ商品を在庫数まで複数の枠に置ける） */
function placesOf(layout, id) {
  const out = [];
  for (const zone of ['left', 'right']) {
    layout[zone].forEach((row, r) => row.forEach((x, i) => { if (x === id) out.push({ zone, row: r, i }); }));
  }
  layout.island.forEach((x, i) => { if (x === id) out.push({ zone: 'island', row: 0, i }); });
  return out;
}
const where = (layout, id) => placesOf(layout, id)[0] || null;
const getSlot = (L, s) => (s.zone === 'island' ? L.island[s.i] : L[s.zone][s.row][s.i]);
const setSlot = (L, s, v) => { if (s.zone === 'island') L.island[s.i] = v; else L[s.zone][s.row][s.i] = v; };
const ZONE_NAME = { left: '左の棚', right: '右の棚', island: '中央のテーブル' };
const placeText = (s) => (s.zone === 'island' ? `中央のテーブル ${s.i + 1}番` : `${ZONE_NAME[s.zone]} ${['下段', '上段'][s.row]} ${s.i + 1}番`);

function thumb(p) {
  if (!p) return '';
  if (p.image) return `<span class="thumb"><img src="${esc(p.image)}" alt="" loading="lazy"></span>`;
  return `<span class="thumb">${window.Art.productSVG(p)}</span>`;
}

/** 一覧の商品を枠へ置く（在庫数までなら何か所にでも置ける。枠に別の商品があれば置き換え） */
function place(id, to) {
  const L = editableLayout();
  const p = state.products.find((x) => x.id === id);
  const occupant = getSlot(L, to);
  if (occupant === id) return;
  const limit = E.placeLimit(p);
  if (placesOf(L, id).length >= limit) {
    toast(`「${p?.name || '商品'}」は在庫数（${limit}個）までしか置けません。ほかの枠から外してから置いてください`, { error: true });
    return;
  }
  setSlot(L, to, id);
  state.draft.layout = L;
  afterLayoutChange();
}
function moveSlot(from, to) {
  const L = editableLayout();
  const a = getSlot(L, from);
  const b = getSlot(L, to);
  setSlot(L, from, b || null);
  setSlot(L, to, a || null);
  state.draft.layout = L;
  afterLayoutChange();
}
function removeFrom(slot) {
  const L = editableLayout();
  setSlot(L, slot, null);
  state.draft.layout = L;
  afterLayoutChange();
}
function afterLayoutChange() {
  state.selected = null;
  renderPalette();
  renderFixtures();
  changed();
}

$('#autoLayoutBtn').addEventListener('click', () => {
  if (!confirm('商品の種類にあわせて自動で並べ直します。今の配置は置き換わります。よろしいですか？')) return;
  state.draft.layout = E.autoLayout(state.products.map((p) => ({ ...p, display: null })));
  afterLayoutChange();
});
$('#clearLayoutBtn').addEventListener('click', () => {
  if (!confirm('棚とテーブルから、すべての商品を外します。よろしいですか？')) return;
  state.draft.layout = E.normalize({}, state.products);
  afterLayoutChange();
});

function renderPalette() {
  const L = editableLayout();
  const q = $('#search').value.trim().toLowerCase();
  const only = $('#onlyUnplaced').checked;
  const items = state.products.filter((p) => (!q || p.name.toLowerCase().includes(q)) && (!only || !where(L, p.id)));
  $('#productList').innerHTML = items.map((p) => {
    const places = placesOf(L, p.id);
    const at = places[0];
    const limit = E.placeLimit(p);
    const sel = state.selected?.id === p.id;
    return `<li class="pcard ${at ? 'is-placed' : ''} ${places.length >= limit ? 'is-full' : ''} ${sel ? 'is-selected' : ''}" draggable="true" data-id="${esc(p.id)}" tabindex="0"
      aria-label="${esc(p.name)}${at ? `（${placeText(at)}）` : '（未配置）'}">
      ${thumb(p)}
      <span><span class="pname">${esc(p.name)}</span><br>
      <span class="pmeta">${yen(p.price)}${p.limited && !tagEditable() ? ' ・<span class="tag-limited">会場限定</span>' : ''}${p.isNew && !tagEditable() ? ' ・<span class="tag-limited">NEW</span>' : ''}${p.stock === 0 ? ' ・<span class="tag-sold">在庫なし</span>' : ''}<br>
      ${at ? `${esc(placeText(at))}${places.length > 1 ? ` ほか${places.length - 1}か所` : ''}` : '未配置'}</span>
      ${tagEditable() ? `<span class="ptags"><button type="button" class="ptag ${p.isNew ? 'is-on' : ''}" data-tag="isNew" aria-pressed="${!!p.isNew}" title="Shopify の商品タグ new を付け外し">NEW</button><button type="button" class="ptag ${p.limited ? 'is-on' : ''}" data-tag="limited" aria-pressed="${!!p.limited}" title="Shopify の商品タグ limited を付け外し">会場限定</button></span>` : ''}</span></li>`;
  }).join('') || '<li class="pmeta">該当する商品がありません</li>';
}
$('#search').addEventListener('input', renderPalette);
$('#onlyUnplaced').addEventListener('change', renderPalette);

function renderFixtures() {
  const L = editableLayout();
  const byId = Object.fromEntries(state.products.map((p) => [p.id, p]));
  const slotHtml = (s, id) => {
    const p = byId[id];
    const sel = state.selected?.slot && state.selected.slot.zone === s.zone && state.selected.slot.row === s.row && state.selected.slot.i === s.i;
    return `<div class="slot ${p ? 'filled' : ''} ${sel ? 'is-selected' : ''}" data-zone="${s.zone}" data-row="${s.row}" data-i="${s.i}"
      ${p ? 'draggable="true"' : ''} tabindex="0" aria-label="${esc(placeText(s))}：${p ? esc(p.name) : '空き'}">
      ${p ? `${thumb(p)}<span class="sname">${esc(p.name)}</span><button class="remove" data-remove aria-label="外す">×</button>` : '<span class="slot-empty">空き</span>'}
    </div>`;
  };
  for (const zone of ['left', 'right']) {
    // 画面では上段を上に表示する
    $(`#zone-${zone}`).innerHTML = [...Array(E.ROWS).keys()].reverse().map((r) => `
      <div class="row"><span class="row-label">${['下段', '上段'][r]}</span>
      ${L[zone][r].map((id, i) => slotHtml({ zone, row: r, i }, id)).join('')}</div>`).join('');
  }
  $('#zone-island').innerHTML = `<div class="row"><span class="row-label">テーブル</span>${L.island.map((id, i) => slotHtml({ zone: 'island', row: 0, i }, id)).join('')}</div>`;
}

const slotOf = (el) => ({ zone: el.dataset.zone, row: Number(el.dataset.row), i: Number(el.dataset.i) });

/* ドラッグ＆ドロップ */
document.addEventListener('dragstart', (e) => {
  const card = e.target.closest?.('.pcard');
  const slot = e.target.closest?.('.slot.filled');
  if (card) e.dataTransfer.setData('text/plain', JSON.stringify({ id: card.dataset.id }));
  else if (slot) e.dataTransfer.setData('text/plain', JSON.stringify({ slot: slotOf(slot) }));
  else return;
  e.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragover', (e) => {
  const slot = e.target.closest?.('.slot');
  const pal = e.target.closest?.('#palette');
  if (!slot && !pal) return;
  e.preventDefault();
  document.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over'));
  slot?.classList.add('drag-over');
  $('#palette').classList.toggle('drop-target', !!pal);
});
document.addEventListener('dragleave', (e) => { e.target.closest?.('.slot')?.classList.remove('drag-over'); });
document.addEventListener('dragend', () => {
  document.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over'));
  $('#palette').classList.remove('drop-target');
});
document.addEventListener('drop', (e) => {
  const slot = e.target.closest?.('.slot');
  const pal = e.target.closest?.('#palette');
  if (!slot && !pal) return;
  e.preventDefault();
  $('#palette').classList.remove('drop-target');
  let data;
  try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
  if (slot) {
    if (data.id) place(data.id, slotOf(slot));
    else if (data.slot) moveSlot(data.slot, slotOf(slot));
  } else if (pal && data.slot) removeFrom(data.slot);
});

/* クリック操作（ドラッグが難しいとき用） */
// 商品の NEW・会場限定（運営のみ。Shopify の商品タグ new / limited を付け外しする）
const tagEditable = () => !isSeller() && window.ADMIN_SHOPIFY;
async function toggleTag(id, key) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;
  const next = !p[key];
  try {
    const r = await api('product-tags', { method: 'POST', body: { handle: id, [key]: next } });
    for (const x of state.products) if (x.id === id) { x.isNew = r.isNew; x.limited = r.limited; }
    renderPalette();
    refreshPreview();
    toast(`「${p.name}」の${key === 'isNew' ? 'NEW' : '会場限定'}を${next ? '付けました' : '外しました'}（Shopify の商品タグ）`);
  } catch (err) { toast(err.message, { error: true }); }
}
$('#productList').addEventListener('click', (e) => {
  const tag = e.target.closest('[data-tag]');
  if (tag) { e.stopPropagation(); toggleTag(tag.closest('.pcard').dataset.id, tag.dataset.tag); return; }
  const card = e.target.closest('.pcard');
  if (!card) return;
  state.selected = state.selected?.id === card.dataset.id ? null : { id: card.dataset.id };
  renderPalette();
  renderFixtures();
});
document.querySelector('.fixtures').addEventListener('click', (e) => {
  const rm = e.target.closest('[data-remove]');
  const slot = e.target.closest('.slot');
  if (!slot) return;
  const s = slotOf(slot);
  if (rm) { removeFrom(s); return; }
  if (state.selected?.id) { place(state.selected.id, s); return; }
  if (state.selected?.slot) {
    const same = state.selected.slot.zone === s.zone && state.selected.slot.row === s.row && state.selected.slot.i === s.i;
    if (same) state.selected = null;
    else { moveSlot(state.selected.slot, s); return; }
  } else if (slot.classList.contains('filled')) state.selected = { slot: s };
  renderFixtures();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.selected) { state.selected = null; renderPalette(); renderFixtures(); }
  if ((e.key === 'Enter' || e.key === ' ') && document.activeElement?.matches('.pcard, .slot')) {
    e.preventDefault();
    document.activeElement.click();
  }
});

/* ==========================================================
   内装・イベント
   ========================================================== */
function themeDefault(path) {
  const ev = state.draft.event;
  const base = window.THEMES[ev.theme_preset] || window.THEMES[E.original.theme];
  if (path.startsWith('const.')) return path.slice(6);
  if (path === 'shop.brand') return ev.brand || E.original.brand;
  if (path === 'schedule.period') return window.HaneulSchedule.periodText(ev) || E.original.period;
  if (path === 'shop.themeLabel') return ev.title || base.name;
  if (path.startsWith('shop.')) return E.original[path.slice(5)];
  if (path.startsWith('layout.')) return path.split('.').slice(1).reduce((o, k) => o?.[k], E.original.layout);
  return path.split('.').reduce((o, k) => o?.[k], base);
}

const FORMS = { event: '#eventForm', entrance: '#entranceForm', 'sign-left': '#signLeft', 'sign-island': '#signIsland', 'sign-right': '#signRight' };
function renderForm() {
  const ev = state.draft.event;
  const base = window.THEMES[ev.theme_preset] || window.THEMES[E.original.theme];
  // 入力欄の薄い文字は「空欄ならどうなるか」だけ（記入例は出さない。必須の欄は何も出さない）
  const placeholders = { free_shipping_threshold: '空欄なら表示しません' };
  for (const [tab, sel] of Object.entries(FORMS)) {
    const fields = E.FIELDS.filter((f) => (f.tab || 'event') === tab && (!f.showIf || f.showIf(ev)));
    const groups = [...new Set(fields.map((f) => f.group))];
    // 棚・テーブルの看板（商品の配置タブ）は、欄だけを並べる
    if (tab.startsWith('sign-')) {
      $(sel).innerHTML = fields.map((f) => fieldHtml(f, ev[f.key], placeholders)).join('');
      continue;
    }
    $(sel).innerHTML = NEED_LEGEND + groups.map((g) => `
      <fieldset class="fgroup"><legend>${esc(g)}</legend>
        ${fields.filter((f) => f.group === g).map((f) => fieldHtml(f, f.value ? f.value(ev) : ev[f.key], placeholders)).join('')}
        ${g === '会期・営業時間' ? '<p class="schedule-status" id="scheduleStatus"></p>' : ''}
      </fieldset>`).join('');
  }
  renderScheduleStatus();
  markMissing();
  // 出品者：会期・送料などは運営が設定する（見えるが変えられない）
  if (isSeller()) {
    for (const key of E.SELLER_LOCKED) {
      const el = document.getElementById(`f_${key}`);
      if (!el) continue;
      el.disabled = true;
      el.closest('.field')?.classList.add('is-locked');
      el.closest('.field')?.querySelector('label')?.insertAdjacentHTML('beforeend', '<span class="hint locked-note">運営が設定します</span>');
      el.closest('.field')?.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    }
  }
}

/** この設定で今お店が開いているか（日本時間） */
function renderScheduleStatus() {
  const el = $('#scheduleStatus');
  if (!el) return;
  const HS = window.HaneulSchedule;
  const ev = state.draft.event;
  const st = HS.status(ev);
  const hours = HS.hoursText(ev);
  const text = {
    open: `営業中${st.closesAt ? `（${HS.whenText(st.closesAt)} 閉店）` : '（閉店時刻の設定なし）'}`,
    before: `開店前（${st.opensAt ? HS.whenText(st.opensAt) : ''} オープン）`,
    closed: `営業時間外（次は ${st.opensAt ? HS.whenText(st.opensAt) : ''} オープン）`,
    ended: '会期終了（入店できません）',
  }[st.state];
  el.innerHTML = `この設定でサイトに反映すると、今は <b>${esc(text)}</b>${hours ? `　${esc(hours)}` : '　24時間営業'}`;
  // 「会期の表示文」の薄い文字（空欄のときに使われる文）も更新
  const per = $('#f_period');
  if (per) per.placeholder = `空欄なら「${HS.periodText(ev) || E.original.period}」`;
  el.dataset.state = st.state;
}
setInterval(() => { if (state.draft) renderScheduleStatus(); }, 30000);

/** 必須・任意の表示 */
function needBadge(f) {
  if (f.need === 'none') return '';
  if (f.need === 'required') return '<span class="need need-required">必須</span>';
  if (f.need === 'hide') return '<span class="need need-hide">任意・空欄なら非表示</span>';
  return `<span class="need need-default">任意・空欄なら${esc(f.fallback)}</span>`;
}
const NEED_LEGEND = `<p class="need-legend">
  <span class="need need-required">必須</span> 入れないと公開できません
  <span class="need need-default">任意・空欄なら○○</span> 空欄なら○○を使います
  <span class="need need-hide">任意・空欄なら非表示</span> 空欄なら店内に出しません</p>`;

/** 必須で空欄の欄に印を付ける */
function markMissing() {
  const miss = new Set(missingNow().map((f) => f.key));
  for (const f of E.FIELDS.filter((x) => x.need === 'required')) {
    document.getElementById(`f_${f.key}`)?.classList.toggle('is-missing', miss.has(f.key));
  }
}

function unitLabel(v, max) {
  const n = E.textUnits(v);
  return `残り 全角${Math.floor((max - n) / 2)}文字（半角${max - n}）`;
}

/* ---------- テーマを変えたとき ----------
 * テーマは配色のセット。個別に色を指定していると、その項目はテーマを変えても変わらないので、
 * 指定がある場合は確認して、テーマの色にそろえる（画像はそのまま） */
const THEME_KEYS = ['wall_color', 'wall_pattern', 'wall_pattern_color', 'lower_color', 'trim_color', 'floor_style', 'floor_color_1', 'floor_color_2',
  'rug_color', 'sign_color', 'sign_text_color', 'sign_sub_color', 'product_bg_color', 'avatar_ring_color', 'char_note_color'];
function applyThemeColors() {
  const ev = state.draft.event;
  const set = THEME_KEYS.filter((k) => ev[k] != null && ev[k] !== '');
  if (set.length) {
    const names = set.map((k) => E.FIELDS.find((f) => f.key === k)?.label || k);
    const ok = confirm(`テーマの配色にそろえますか？\n\n次の ${set.length} 項目は個別に色などを指定しているため、このままではテーマを変えても変わりません。\n「OK」でテーマの色に戻します（「キャンセル」なら指定した色のまま）。\n\n・${names.join('\n・')}`);
    if (ok) {
      for (const k of set) ev[k] = '';
      changed();
    }
  }
  renderForm();
}

/* ---------- 色のカラーコード（HEX）入力 ----------
 * 色の見本の横に、カラーコードを直接入れる欄を置く。「#」はなくてもよく、3桁（#fff）・全角でも受け付ける。
 * 正しいコードになった時点で、見本（input[type=color]）に入れて、いつもの処理（保存・プレビュー）に回す。 */
function hexInput(color, label) {
  return `<input type="text" class="hex-input" value="${esc(String(color || '').toUpperCase())}" maxlength="9" spellcheck="false"
    autocomplete="off" inputmode="text" aria-label="${esc(label)}（カラーコード）">`;
}
function normalizeHex(text) {
  const s = String(text || '')
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) // 全角 → 半角
    .trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
  if (/^[0-9a-f]{3}$/.test(s)) return `#${s.split('').map((c) => c + c).join('')}`;
  return null;
}
document.addEventListener('input', (e) => {
  const t = e.target;
  // カラーコードを打ったら、色の見本に反映
  if (t.classList?.contains('hex-input')) {
    const hex = normalizeHex(t.value);
    t.classList.toggle('is-invalid', !hex && t.value.trim() !== '');
    const swatch = t.parentElement.querySelector('input[type="color"]');
    if (hex && swatch && swatch.value !== hex) {
      swatch.value = hex;
      swatch.dataset.fromHex = '1';
      swatch.dispatchEvent(new Event('input', { bubbles: true }));
      delete swatch.dataset.fromHex;
    }
    return;
  }
  // 見本で色を選んだら、カラーコードの欄にも出す
  if (t.type === 'color' && !t.dataset.fromHex) {
    const box = t.parentElement.querySelector('.hex-input');
    if (box) { box.value = t.value.toUpperCase(); box.classList.remove('is-invalid'); }
  }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (!t.classList?.contains('hex-input')) return;
  const swatch = t.parentElement.querySelector('input[type="color"]');
  const hex = normalizeHex(t.value);
  if (!hex) {
    if (t.value.trim()) toast('カラーコードは「#FFAACC」「FFAACC」「#FAC」のように、6桁か3桁の英数字で入れてください', { error: true });
    t.value = (swatch?.value || '').toUpperCase();
    t.classList.remove('is-invalid');
    return;
  }
  t.value = hex.toUpperCase();
  swatch?.dispatchEvent(new Event('change', { bubbles: true })); // 入力を終えたら（Enter・欄の外）いつもどおり描き直す
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList?.contains('hex-input')) { e.preventDefault(); e.target.blur(); }
});

/** この会期と重なる、ほかのイベント（イベント一覧の会期で比べる）。なければ null */
function overlapWith(ev) {
  const HS = window.HaneulSchedule;
  const a0 = HS.parseDateTime(ev.open_at);
  const a1 = HS.parseDateTime(ev.close_at);
  if (a0 == null || a1 == null) return null;
  return (state.events || []).find((x) => {
    if (x.id === state.eventId) return false;
    const b0 = HS.parseDateTime(x.open_at);
    const b1 = HS.parseDateTime(x.close_at);
    return b0 != null && b1 != null && a0 < b1 && b0 < a1;
  }) || null;
}

function fieldHtml(f, value, placeholders) {
  const id = `f_${f.key}`;
  const label = `<label for="${id}">${esc(f.label)}${needBadge(f)}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</label>`;
  const defaultColorLabel = f.defaultLabel || (String(f.themePath || '').startsWith('const.') ? '初期の色' : 'テーマの色');
  let input = '';
  if (f.type === 'text' || f.type === 'number') {
    // 薄い文字は「空欄ならどうなるか」だけ。必須の欄には出さない
    let ph = f.placeholderPath ? themeDefault(f.placeholderPath) : placeholders[f.key];
    if (f.need === 'required') ph = '';
    else if (ph && f.placeholderPath && !String(ph).startsWith('空欄')) ph = `空欄なら「${ph}」`;
    input = `<input id="${id}" data-key="${f.key}" type="${f.type}" value="${esc(value ?? '')}" placeholder="${esc(ph ?? '')}" ${f.type === 'number' ? 'min="0" step="100"' : 'maxlength="120"'}>`;
    // 文字数の上限がある項目は、残りを表示（全角2・半角1で数える）
    if (f.maxUnits) input = `<span class="unit-row">${input}<span class="unit-count" data-count-for="${f.key}">${unitLabel(value, f.maxUnits)}</span></span>`;
  } else if (f.type === 'datetime' || f.type === 'time') {
    // 日時：max を付けると、年は4桁まで（4桁入れると自動で月へ進む。付けないと6桁まで入れられる）
    input = `<span class="dt-row"><input id="${id}" data-key="${f.key}" type="${f.type === 'datetime' ? 'datetime-local' : 'time'}" step="60"${f.type === 'datetime' ? ' min="2000-01-01T00:00" max="2099-12-31T23:59"' : ''} value="${esc(value ?? '')}">
      ${value ? `<button type="button" class="btn btn-small btn-ghost" data-reset="${f.key}">消す</button>` : ''}</span>`;
  } else if (f.type === 'textarea') {
    // 初期の文がある欄（返品・交換など）は、空欄のときその文を入れた状態で出す
    const text = value ?? '';
    input = `<textarea id="${id}" data-key="${f.key}" maxlength="300" rows="${f.defaultValue ? 4 : 2}">${esc(text)}</textarea>`;
  } else if (f.type === 'collection') {
    // Shopify のコレクションから選ぶ
    const list = state.collections.slice();
    if (value && !list.some((c) => c.handle === value)) list.unshift({ handle: value, title: `${value}（Shopify に見つかりません）`, count: null });
    input = `<select id="${id}" data-key="${f.key}">
      <option value="" ${value ? '' : 'selected'}>（選んでください）</option>
      ${list.map((c) => `<option value="${esc(c.handle)}" ${c.handle === value ? 'selected' : ''}>${esc(c.title)}${c.count != null ? `（${c.count}点）` : ''}</option>`).join('')}
    </select>`;
  } else if (f.type === 'select') {
    const opts = f.options();
    // ベースのテーマは、未選択（または削除したテーマ）なら初期設定のテーマ（Milk Tea）を選んだ状態で出す
    let cur = String(value ?? '');
    if (f.key === 'theme_preset' && !opts.some((o) => o.value === cur)) cur = E.original.theme;
    input = `<select id="${id}" data-key="${f.key}">${opts.map((o) =>
      `<option value="${esc(o.value)}" ${cur === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  } else if (f.type === 'color') {
    const def = themeDefault(f.themePath) || f.defaultSwatch || '#ffffff';
    const v = value || def;
    input = `${f.presets ? '<div class="color-wrap">' : ''}<span class="color-row"><input id="${id}" data-key="${f.key}" type="color" value="${esc(v)}" aria-label="${esc(f.label)}（色を選ぶ）">
      ${hexInput(v, f.label)}
      <span class="color-note">${value ? '' : defaultColorLabel}</span>
      ${value ? `<button type="button" class="btn btn-small btn-ghost" data-reset="${f.key}">${defaultColorLabel}に戻す</button>` : ''}</span>
      ${f.presets ? `<span class="color-presets">${f.presets.map(([hex, name]) => `<button type="button" class="color-preset${String(value).toLowerCase() === hex ? ' is-on' : ''}" data-preset="${f.key}" data-hex="${hex}" style="--p:${hex}" title="${esc(name)}"><i></i>${esc(name)}</button>`).join('')}</span></div>` : ''}`;
  } else if (f.type === 'image') {
    const url = E.imageUrl(value);
    input = `<span class="image-row">
      <span class="image-preview" style="${url ? `background-image:url('${esc(url)}')` : ''}">${url ? '' : 'なし'}</span>
      <label class="btn btn-small">画像を選ぶ<input type="file" accept="image/png,image/jpeg,image/webp" data-upload="${f.key}" hidden></label>
      ${url ? `<button type="button" class="btn btn-small btn-ghost" data-reset="${f.key}">外す</button>` : ''}</span>`;
  }
  return `<div class="field">${label}${input}</div>`;
}

for (const sel of Object.values(FORMS)) {
  const form = $(sel);
  form.addEventListener('input', (e) => {
    const key = e.target.dataset.key;
    if (!key) return;
    const f = E.FIELDS.find((x) => x.key === key);
    let v = e.target.value;
    if (f.type === 'number') v = v === '' ? '' : Math.max(0, Math.round(Number(v)));
    if (f.maxUnits && E.textUnits(v) > f.maxUnits) {
      v = E.clampUnits(v, f.maxUnits);
      e.target.value = v;
      toast(`${f.label}は全角${f.maxUnits / 2}文字（半角${f.maxUnits}文字）までです`, { error: true });
    }
    if (f.maxUnits) {
      const c = e.target.parentElement.querySelector(`[data-count-for="${key}"]`);
      if (c) c.textContent = unitLabel(v, f.maxUnits);
    }
    // 会期は、ほかのイベントの会期と重ならないこと（1つの期間に開けるイベントは1つ）。重なるときは入れた日時を元に戻す
    if (key === 'open_at' || key === 'close_at') {
      const o = overlapWith({ ...state.draft.event, [key]: v });
      if (o) {
        e.target.value = state.draft.event[key] || '';
        // 下のポップで知らせる：どのイベントと重なっているか、どう直せばよいか
        const HS = window.HaneulSchedule;
        const at = (v) => HS.periodText({ open_at: v }).replace(/ 〜$/, '');
        toast(`会期が「${o.title || '（名前なし）'}」（${HS.periodText(o)}）と重なっています。`
          + (key === 'open_at' ? `開始日時を ${at(o.close_at)} 以降にしてください` : `終了日時を ${at(o.open_at)} 以前にしてください`), { error: true });
        return;
      }
    }
    state.draft.event[key] = v;
    if (f.need === 'required') markMissing();
    if (f.type === 'datetime' || f.type === 'time') renderScheduleStatus();
    if (f.type === 'color') {
      const note = e.target.parentElement.querySelector('.color-note');
      if (note) note.textContent = '';
    }
    changed();
  });
  form.addEventListener('change', async (e) => {
    const key = e.target.dataset.key;
    // テーマや色の変更で「テーマの色」の表示が変わるので描き直す
    // 購入特典の「なし／あり」で、条件金額と名前の欄を出し入れする
    if (key === 'collection') { changeCollection(e.target.value); markMissing(); return; }
    if (key === 'theme_preset') { applyThemeColors(); return; }
    if (key === 'novelty' || e.target.type === 'color') { renderForm(); return; }
    const input = e.target.closest('[data-upload]');
    if (!input || !input.files[0]) return;
    const file = input.files[0];
    if (file.size > 8 * 1024 * 1024) { toast('8MB 以下の画像を選んでください', { error: true }); return; }
    toast('画像をアップロードしています…');
    try {
      const img = await api('upload', { method: 'POST', raw: file, type: file.type });
      state.draft.event[input.dataset.upload] = img;
      renderForm();
      changed();
      toast('画像を設定しました');
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
  form.addEventListener('click', (e) => {
    const preset = e.target.closest('[data-preset]');
    if (preset) {
      state.draft.event[preset.dataset.preset] = preset.dataset.hex;
      renderForm();
      changed();
      return;
    }
    const reset = e.target.closest('[data-reset]');
    if (!reset) return;
    state.draft.event[reset.dataset.reset] = '';
    renderForm();
    changed();
  });
}

/* ==========================================================
   キャラクター
   ========================================================== */
// このイベントのキャラクター（{ use, list }）。まだ設定していないイベントは、自社の4体から始める
function castEdits() {
  let v = state.draft.event.cast;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  if (!v || typeof v !== 'object' || !Array.isArray(v.list)) {
    v = JSON.parse(JSON.stringify(E.castOf('', state.draft.event.characters)));
  }
  state.draft.event.cast = v;
  return v;
}
const newCastId = () => `k_${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}`;

/** キャラクターの色を淡くした色（ご案内のキャラクター紹介の、指定がないときの枠の色に近いもの） */
function cardTint(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '#e6dcf3');
  const n = parseInt(m ? m[1] : 'e6dcf3', 16);
  const mix = (v) => Math.round(v * 0.22 + 255 * 0.78).toString(16).padStart(2, '0');
  return `#${mix(n >> 16)}${mix((n >> 8) & 255)}${mix(n & 255)}`;
}

function renderCharacters() {
  const v = castEdits();
  E.applyCast(v);
  const cards = v.list.map((x, i) => {
    const shown = (window.CAST || []).find((c) => c.id === x.id) || { ...x, image: E.imageUrl(x.image) };
    const own = E.original.characters.find((o) => o.id === x.id);
    const img = E.imageUrl(x.image);
    return `<div class="char-card" data-i="${i}">
      <div class="char-art">
        <span class="art" style="background:${x.bg ? esc(x.bg) : `color-mix(in srgb, ${esc(own?.color || '#e6dcf3')} 25%, transparent)`}">${window.Art.characterSVG({ ...shown, name: x.name, color: own?.color || '#e6dcf3' })}</span>
        <label class="btn btn-small">画像を選ぶ<input type="file" accept="image/png,image/jpeg,image/webp" data-cast-upload hidden></label>
        ${img ? `<button type="button" class="btn btn-small btn-ghost" data-cast-reset="image">${own ? '元の絵に戻す' : '画像を外す'}</button>` : ''}
      </div>
      <div class="char-fields">
        <div class="field"><label>名前 <span class="need need-required">必須</span><span class="hint">壁の名前の札・キャラクター紹介・アバター選びに出ます</span></label><input type="text" data-cast-key="name" maxlength="20" value="${esc(x.name || '')}" class="${x.name ? '' : 'is-missing'}"></div>
        <div class="field"><label>英語名 <span class="need need-hide">任意・空欄なら非表示</span></label><input type="text" data-cast-key="en" maxlength="30" value="${esc(x.en || '')}" placeholder="空欄なら表示しません"></div>
        <div class="field"><label>プロフィール <span class="need need-hide">任意・空欄なら非表示</span><span class="hint">ご案内のキャラクター紹介と、店内でキャラクターをタップしたときの紹介文</span></label><textarea data-cast-key="profile" maxlength="200" rows="2" placeholder="空欄なら表示しません">${esc(x.profile || '')}</textarea></div>
        <div class="field"><label>紹介の背景色 <span class="need need-default">任意・空欄ならキャラクターの色を淡く</span><span class="hint">ご案内の「キャラクター紹介」で、このキャラクターの枠の色（文字の色は自動で読みやすい色に）</span></label>
          <div class="color-wrap"><span class="color-row"><input type="color" data-cast-key="bg" value="${esc(x.bg || cardTint(own?.color))}" aria-label="紹介の背景色（色を選ぶ）">
            ${hexInput(x.bg || cardTint(own?.color), '紹介の背景色')}
            ${x.bg ? '<button type="button" class="btn btn-small btn-ghost" data-cast-reset="bg">キャラクターの色に戻す</button>' : '<span class="color-note">キャラクターの色を淡く</span>'}</span>
          <span class="color-presets">${E.CARD_PRESETS.map(([hex, label]) => `<button type="button" class="color-preset${x.bg === hex ? ' is-on' : ''}" data-cast-bg="${hex}" style="--p:${hex}" title="${esc(label)}"><i></i>${esc(label)}</button>`).join('')}</span></div></div>
        <div class="char-tools">
          <button type="button" class="btn btn-small" data-cast-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
          <button type="button" class="btn btn-small" data-cast-move="1" ${i === v.list.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button>
          <button type="button" class="btn btn-small btn-ghost btn-danger" data-cast-delete>削除</button>
        </div>
      </div>
    </div>`;
  }).join('');
  $('#charEditor').innerHTML = `
    <label class="check cast-use"><input type="checkbox" id="castUse" ${v.use ? 'checked' : ''}> このイベントでキャラクターを使う</label>
    <p class="hint">${v.use ? '入口・店内の正面の壁・ご案内の「キャラクター紹介」に、下のキャラクターが並びます（上から順に）。'
      : 'キャラクターを使わない設定です。入口・店内の正面の壁・ご案内の「キャラクター紹介」には何も出しません（登録したキャラクターは残ります）。'}</p>
    <div class="cast-list ${v.use ? '' : 'is-off'}">
      ${cards || '<p class="cast-empty">キャラクターはまだいません。「＋ キャラクターを追加」で登録します。</p>'}
      <button type="button" class="btn" id="castAdd" ${v.list.length >= E.MAX_CAST ? 'disabled' : ''}>＋ キャラクターを追加（${v.list.length}/${E.MAX_CAST}）</button>
    </div>`;
}

function castChanged({ rerender = false } = {}) {
  E.applyCast(castEdits());
  if (rerender) renderCharacters();
  changed();
}

$('#charEditor').addEventListener('input', (e) => {
  const key = e.target.dataset.castKey;
  if (!key) return;
  const i = Number(e.target.closest('[data-i]').dataset.i);
  const v = castEdits();
  v.list[i][key] = e.target.value;
  if (key === 'name') e.target.classList.toggle('is-missing', !e.target.value.trim());
  if (key === 'name') updateCastArt(i); // 絵だけその場で描き直す（入力欄は作り直さない）
  castChanged();
});
function updateCastArt(i) {
  const x = castEdits().list[i];
  const card = $(`#charEditor [data-i="${i}"]`);
  if (!x || !card) return;
  const own = E.original.characters.find((o) => o.id === x.id);
  const color = own?.color || '#e6dcf3';
  const art = card.querySelector('.art');
  art.style.background = x.bg || `color-mix(in srgb, ${color} 25%, transparent)`;
  art.innerHTML = window.Art.characterSVG({ ...(own || {}), ...x, color, image: E.imageUrl(x.image), kind: own?.kind || '' });
}
$('#charEditor').addEventListener('change', async (e) => {
  if (e.target.id === 'castUse') { castEdits().use = e.target.checked; castChanged({ rerender: true }); return; }
  if (e.target.dataset.castKey === 'bg') { castChanged({ rerender: true }); return; } // 色を決めたら「戻す」ボタンなどを出し直す
  if (!e.target.matches('[data-cast-upload]') || !e.target.files[0]) return;
  const i = Number(e.target.closest('[data-i]').dataset.i);
  const file = e.target.files[0];
  if (file.size > 8 * 1024 * 1024) { toast('8MB 以下の画像を選んでください', { error: true }); return; }
  toast('画像をアップロードしています…');
  try {
    const img = await api('upload', { method: 'POST', raw: file, type: file.type });
    castEdits().list[i].image = img;
    castChanged({ rerender: true });
    toast('画像を設定しました');
  } catch (err) { toast(err.message, { error: true }); }
});
$('#charEditor').addEventListener('click', (e) => {
  const v = castEdits();
  if (e.target.closest('#castAdd')) {
    if (v.list.length >= E.MAX_CAST) return;
    v.list.push({ id: newCastId(), name: '', en: '', profile: '', color: '', image: '' });
    castChanged({ rerender: true });
    $('#charEditor .char-card:last-of-type [data-cast-key="name"]')?.focus();
    return;
  }
  const card = e.target.closest('[data-i]');
  if (!card) return;
  const i = Number(card.dataset.i);
  if (e.target.closest('[data-cast-bg]')) {
    v.list[i].bg = e.target.closest('[data-cast-bg]').dataset.castBg;
  } else if (e.target.closest('[data-cast-reset]')) {
    v.list[i][e.target.closest('[data-cast-reset]').dataset.castReset] = '';
  } else if (e.target.closest('[data-cast-move]')) {
    const j = i + Number(e.target.closest('[data-cast-move]').dataset.castMove);
    if (j < 0 || j >= v.list.length) return;
    [v.list[i], v.list[j]] = [v.list[j], v.list[i]];
  } else if (e.target.closest('[data-cast-delete]')) {
    if (!confirm(`「${v.list[i].name || '名前なし'}」をこのイベントのキャラクターから削除します。よろしいですか？\n（アバターからも外れます。ほかのイベントには影響しません）`)) return;
    v.list.splice(i, 1);
  } else return;
  castChanged({ rerender: true });
});

/* ==========================================================
   アバター
   ========================================================== */
const MAX_AVATARS = 12;
function avatarEdits() {
  let v = state.draft.event.avatars;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  if (!v || typeof v !== 'object') v = {};
  v.hide = Array.isArray(v.hide) ? v.hide : [];
  v.custom = Array.isArray(v.custom) ? v.custom : [];
  state.draft.event.avatars = v;
  return v;
}
const newAvatarId = () => `c_${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10)}`;

function renderAvatars() {
  const v = avatarEdits();
  E.applyCharacters(state.draft.event.characters);
  E.applyCast(state.draft.event.cast, state.draft.event.characters);
  const list = E.applyAvatars(v);
  // キャラクターのアバター：このイベントのキャラクター（いなければ自社の4体）
  const own = !(window.CAST_ENABLED && window.CAST?.length);
  $('#avBuiltinNote').textContent = own
    ? 'このイベントにはキャラクターが登録されていないため、初期の4体（モク・キラリ・ルナ・ポム）をアバターにしています。'
    : '「キャラクター」タブで登録したキャラクターを、アバターにしています（自社の4体は出しません）。';
  $('#avBuiltin').innerHTML = E.avatarCharacters().map((c) => {
    const on = !v.hide.includes(c.id);
    return `<label class="av-chip ${on ? '' : 'is-off'}">
      <span class="art">${window.Art.characterSVG(c)}</span>
      <b>${esc(c.name)}</b>
      <span class="check"><input type="checkbox" data-av-builtin="${esc(c.id)}" ${on ? 'checked' : ''}> アバターとして選べる</span>
    </label>`;
  }).join('');
  $('#avCount').textContent = `（${v.custom.length} / ${MAX_AVATARS}）`;
  $('#avAddBtn').classList.toggle('is-disabled', v.custom.length >= MAX_AVATARS);
  $('#avAddInput').disabled = v.custom.length >= MAX_AVATARS;
  $('#avList').innerHTML = v.custom.length ? v.custom.map((a, i) => `
    <li class="av-item" data-i="${i}">
      <img src="${esc(E.imageUrl(a.image))}" alt="">
      <input type="text" data-av-name maxlength="12" value="${esc(a.name)}" aria-label="アバターの名前（12文字まで）">
      <span class="av-actions">
        <button type="button" class="icon" data-av-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
        <button type="button" class="icon" data-av-move="1" ${i === v.custom.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button>
        <button type="button" class="btn btn-small btn-danger" data-av-delete>削除</button>
      </span>
    </li>`).join('') : '<li class="av-empty">まだありません。「画像からアバターを追加」で追加できます。</li>';

  // プレビュー（お客さんのアバター選び）
  $('#apGrid').innerHTML = list.map((a) => `<span class="pick" style="--c:${a.character ? esc(a.character.color) : '#e3e6f0'}">
    ${window.Art.characterSVG(a.character || { image: a.image })}<span>${esc(a.name)}</span></span>`).join('');
}

$('#avBuiltin').addEventListener('change', (e) => {
  const id = e.target.dataset.avBuiltin;
  if (!id) return;
  const v = avatarEdits();
  v.hide = e.target.checked ? v.hide.filter((x) => x !== id) : [...new Set([...v.hide, id])];
  renderAvatars();
  changed({ previewNow: false });
});
$('#avAddInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const v = avatarEdits();
  if (v.custom.length >= MAX_AVATARS) { toast(`追加できるのは ${MAX_AVATARS} 個までです`, { error: true }); return; }
  if (file.size > 8 * 1024 * 1024) { toast('8MB 以下の画像を選んでください', { error: true }); return; }
  toast('画像をアップロードしています…');
  try {
    const img = await api('upload', { method: 'POST', raw: file, type: file.type });
    v.custom.push({ id: newAvatarId(), name: `アバター${v.custom.length + 1}`, image: img });
    renderAvatars();
    changed({ previewNow: false });
    toast('アバターを追加しました。名前を付けてください');
    const inputs = document.querySelectorAll('#avList [data-av-name]');
    inputs[inputs.length - 1]?.select();
  } catch (err) { toast(err.message, { error: true }); }
});
$('#avList').addEventListener('input', (e) => {
  if (!e.target.matches('[data-av-name]')) return;
  const i = Number(e.target.closest('[data-i]').dataset.i);
  const v = avatarEdits();
  v.custom[i].name = e.target.value;
  if (!e.target.value.trim()) return; // 空の名前は保存しない（入力中）
  E.applyAvatars(v);
  $('#apGrid').querySelectorAll('.pick > span')[window.AVATARS.findIndex((a) => a.id === v.custom[i].id)]?.replaceChildren(e.target.value);
  changed({ previewNow: false });
});
$('#avList').addEventListener('click', (e) => {
  const item = e.target.closest('[data-i]');
  if (!item) return;
  const i = Number(item.dataset.i);
  const v = avatarEdits();
  if (e.target.closest('[data-av-delete]')) {
    if (!confirm(`「${v.custom[i].name}」を削除します。よろしいですか？\n（このアバターで入店中のお客さんは、最初のアバターの見た目になります）`)) return;
    v.custom.splice(i, 1);
  } else if (e.target.closest('[data-av-move]')) {
    const j = i + Number(e.target.closest('[data-av-move]').dataset.avMove);
    if (j < 0 || j >= v.custom.length) return;
    [v.custom[i], v.custom[j]] = [v.custom[j], v.custom[i]];
  } else return;
  renderAvatars();
  changed({ previewNow: false });
});

/* ==========================================================
   公開の履歴
   ========================================================== */
function renderHistory() {
  const p = state.published;
  $('#historySummary').innerHTML = `
    <p><b>このイベントの公開：</b>${p?.publishedAt ? `${fmtTime(p.publishedAt)}（${esc(p.publishedBy || '—')}）` : 'まだ公開していません'}</p>
    <p><b>下書き：</b>${state.draft.updatedAt ? `${fmtTime(state.draft.updatedAt)}（${esc(state.draft.updatedBy || '—')}）に保存` : '変更なし'}</p>`;
  $('#historyList').innerHTML = state.history.length
    ? state.history.map((h) => `<li>${fmtTime(h.at)}　${esc(h.by)} さんが公開</li>`).join('')
    : '<li>公開の履歴はまだありません</li>';
}

// 未保存のまま閉じようとしたら確認
/* ==========================================================
   出品者まわり：反映の確認依頼・アカウント・商品の申請・注文
   ========================================================== */

/* ---------- 反映の確認依頼（出品者は「サイトに反映する」の代わりに、運営へ依頼する） ---------- */
async function requestReview() {
  await flushSave();
  const note = prompt('運営に、サイトへの反映の確認を依頼します。\n伝えたいことがあれば書いてください（なくても大丈夫です）：', '');
  if (note == null) return;
  try {
    await evApi('review', { method: 'POST', body: { note } });
    await loadEvents();
    renderStatus();
    toast('運営に確認を依頼しました。確認が済むと、お客さんのサイトに反映されます');
  } catch (e) { toast(e.message, { error: true }); }
}

/* ---------- アカウント（運営だけ） ---------- */
let accEditing = null; // 変更中のアカウントの ID
async function showAccounts() {
  state.eventId = null;
  state.draft = null;
  $('#app').classList.add('is-list');
  $('#eventList').hidden = true;
  $('#accounts').hidden = false;
  window.scrollTo(0, 0);
  await loadEvents().catch(() => {}); // 担当のイベントの選択肢を最新に
  resetAccForm();
  await renderAccounts();
}
function accEventChecks(selected = []) {
  const HS = window.HaneulSchedule;
  $('#accEventList').innerHTML = state.events.length
    ? state.events.map((x) => `<label class="check"><input type="checkbox" value="${esc(x.id)}" ${selected.includes(x.id) ? 'checked' : ''}>
        ${esc(x.title || '（イベント名なし）')}<small>${esc(x.open_at ? HS.periodText({ open_at: x.open_at, close_at: x.close_at }) : '会期未設定')}</small></label>`).join('')
    : '<p class="hint">イベントがまだありません。先にイベントを作ってください。</p>';
}
function resetAccForm() {
  accEditing = null;
  const f = $('#accForm');
  f.reset();
  f.name.readOnly = false;
  $('#accFormTitle').textContent = 'アカウントを追加';
  $('#accSubmit').textContent = '追加する';
  $('#accCancel').hidden = true;
  accEventChecks([]);
  syncAccRole();
}
function syncAccRole() {
  const seller = $('#accForm').role.value === 'seller';
  $('#accEvents').hidden = !seller;
  // 出品者の ID はメールアドレス。運営はメールアドレスか半角英数字
  const f = $('#accForm').elements.name;
  if (!f.readOnly) {
    f.type = seller ? 'email' : 'text';
    $('#accNameLabel').textContent = seller ? 'メールアドレス（ID）' : 'ID（メールアドレス、または半角英数字）';
    f.placeholder = seller ? '例: shop@example.com' : '例: staff@example.com';
  }
}
$('#accForm').role.addEventListener('change', syncAccRole);
$('#accCancel').addEventListener('click', resetAccForm);
function showAccLink(name, url, expiresAt) {
  $('#accLink').hidden = false;
  $('#accLinkTitle').textContent = `「${name}」のパスワード設定用リンク`;
  $('#accLinkUrl').value = url;
  $('#accLinkNote').textContent = `このリンクをご本人に送ってください。${fmtTime(expiresAt)} まで有効・1回限りです（この画面を閉じると、もう表示できません。必要なら発行し直せます）。`;
  $('#accLink').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('#accLinkCopy').addEventListener('click', async () => {
  const el = $('#accLinkUrl');
  try { await navigator.clipboard.writeText(el.value); } catch { el.select(); document.execCommand('copy'); }
  toast('リンクをコピーしました');
});
async function renderAccounts() {
  try {
    const { users } = await api('users');
    const title = (id) => state.events.find((x) => x.id === id)?.title || '（削除されたイベント）';
    $('#accList').innerHTML = users.sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name)).map((u) => `
      <li class="acc-item" data-name="${esc(u.name)}">
        <div><b>${esc(u.name)}</b> <span class="pill ${u.role === 'admin' ? 'pill-active' : 'pill-sub'}">${u.role === 'admin' ? '運営' : '出品者'}</span>${u.name === state.user ? ' <small>（あなた）</small>' : ''}
          ${!u.hasPassword ? ` <span class="pill pill-review">${u.setupPending ? `パスワード未設定（リンク ${esc(fmtTime(u.setupExpiresAt))} まで）` : 'パスワード未設定（リンクの期限切れ）'}</span>` : ''}
          <p class="hint">${u.role === 'admin' ? 'すべてのイベント' : u.events.length ? `担当：${u.events.map((id) => esc(title(id))).join('、')}` : '<span class="warn">担当のイベントがありません</span>'}</p></div>
        <div class="acc-item-actions">
          <button class="btn btn-small" data-edit type="button">変更</button>
          <button class="btn btn-small" data-link type="button" title="パスワードを忘れたときも、これで再設定できます">${u.hasPassword ? 'パスワード再設定リンク' : 'リンクを発行し直す'}</button>
          <button class="btn btn-small btn-ghost btn-danger" data-del type="button" ${u.name === state.user ? 'disabled title="自分のアカウントは削除できません"' : ''}>削除</button>
        </div>
      </li>`).join('');
    $('#accList')._users = users;
  } catch (e) { toast(e.message, { error: true }); }
}
$('#accList').addEventListener('click', async (e) => {
  const li = e.target.closest('.acc-item');
  if (!li) return;
  const u = $('#accList')._users.find((x) => x.name === li.dataset.name);
  if (e.target.closest('[data-edit]')) {
    accEditing = u.name;
    const f = $('#accForm');
    f.name.value = u.name;
    f.name.type = "text"; // 前からある ID（メールアドレスでないもの）もそのまま保存できるように
    f.name.readOnly = true;
    f.role.value = u.role;
    accEventChecks(u.events);
    syncAccRole();
    $('#accFormTitle').textContent = `「${u.name}」を変更`;
    $('#accSubmit').textContent = '変更を保存';
    $('#accCancel').hidden = false;
    f.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  if (e.target.closest('[data-link]')) {
    if (u.hasPassword && !confirm(`「${u.name}」のパスワード再設定用リンクを発行します。リンクからパスワードを設定し直すまでは、いまのパスワードでもログインできます。よろしいですか？`)) return;
    try {
      const r = await api(`setup-link?name=${encodeURIComponent(u.name)}`, { method: 'POST' });
      showAccLink(u.name, r.url, r.expiresAt);
      renderAccounts();
    } catch (err) { toast(err.message, { error: true }); }
    return;
  }
  if (e.target.closest('[data-del]')) {
    if (!confirm(`アカウント「${u.name}」を削除します。このアカウントではログインできなくなります。よろしいですか？`)) return;
    try {
      await api(`users?name=${encodeURIComponent(u.name)}`, { method: 'DELETE' });
      toast('アカウントを削除しました');
      if (accEditing === u.name) resetAccForm();
      renderAccounts();
    } catch (err) { toast(err.message, { error: true }); }
  }
});
$('#accForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const role = f.role.value;
  const events = [...document.querySelectorAll('#accEventList input:checked')].map((x) => x.value);
  if (role === 'seller' && !events.length && !confirm('担当のイベントが選ばれていません。このまま保存しますか？（ログインしても、何も表示されません）')) return;
  try {
    const r = await api('users', { method: 'POST', body: { name: f.name.value.trim(), role, events, edit: !!accEditing } });
    toast(accEditing ? 'アカウントを変更しました' : 'アカウントを追加しました。パスワード設定用のリンクをご本人に送ってください');
    if (r.url) showAccLink(r.user.name, r.url, r.expiresAt);
    resetAccForm();
    renderAccounts();
  } catch (err) { toast(err.message, { error: true }); }
});

/* ---------- 商品の申請 ---------- */
const SUB = { items: [], status: {}, editing: null, images: [] };
const subImg = (file, { download = false } = {}) => `/admin/api/submission-image?event=${encodeURIComponent(state.eventId)}&file=${encodeURIComponent(file)}${download ? '&download=1' : ''}`;
function updateSubCount() {
  const n = state.events.find((x) => x.id === state.eventId)?.pendingSubmissions || 0;
  $('#subCount').textContent = n;
  $('#subCount').hidden = !n;
}
async function loadSubmissions() {
  $('#subHelp').innerHTML = isSeller()
    ? '店内に並べたい商品を申請してください。運営が内容を確認して Shopify に登録すると、「商品の配置」タブに出てきて、棚に並べられるようになります。<br>登録済みになった商品の変更は、運営にご連絡ください。'
    : '出品者から届いた商品の申請です。画像と一覧（CSV）をダウンロードして Shopify に登録し、登録したら状態を「Shopifyに登録済み」にしてください。';
  $('#subZipAll').href = `/admin/api/submissions.zip?event=${encodeURIComponent(state.eventId)}`;
  $('#subZipPending').href = `/admin/api/submissions.zip?event=${encodeURIComponent(state.eventId)}&pending=1`;
  const evTitle = (state.events.find((x) => x.id === state.eventId)?.title || state.eventId).replace(/[\\/:*?"<>|]/g, '_');
  $('#subZipAll').download = `商品の申請_${evTitle}.zip`;
  $('#subZipPending').download = `商品の申請_${evTitle}_申請中.zip`;
  try {
    const r = await evApi('submissions');
    SUB.items = r.items;
    SUB.status = r.status;
    renderSubmissions();
  } catch (e) { toast(e.message, { error: true }); }
}
function renderSubmissions() {
  const list = SUB.items;
  $('#subZipAll').hidden = isSeller() || !list.length;
  $('#subZipPending').hidden = isSeller() || !list.some((x) => x.status === 'pending');
  $('#subList').innerHTML = list.length ? list.map((x) => `
    <li class="sub-item is-${x.status}" data-id="${esc(x.id)}">
      <div class="sub-pics">${x.images.map((f, i) => `<a href="${subImg(f, { download: !isSeller() })}" ${isSeller() ? 'target="_blank" rel="noopener"' : 'download'} title="${isSeller() ? '画像を開く' : 'この画像をダウンロード'}"><img src="${subImg(f)}" alt="" loading="lazy"></a>`).join('')}</div>
      <div class="sub-info">
        <p class="sub-head"><span class="pill sub-st-${x.status}">${esc(SUB.status[x.status] || x.status)}</span> <b>${esc(x.name)}</b>${x.isNew ? ' <span class="pill pill-new">NEW</span>' : ''}${x.limited ? ' <span class="pill pill-sub">会場限定</span>' : ''}</p>
        <p class="sub-meta">${yen(x.price)}（税込）　在庫 ${x.stock}　大きさ ${esc(x.size)}${x.limit ? `　お一人様 ${x.limit} 点まで` : ''}</p>
        ${x.spec ? `<p class="sub-meta">${esc(x.spec)}</p>` : ''}
        ${x.description ? `<p class="sub-desc">${esc(x.description)}</p>` : ''}
        <p class="hint">${esc(x.by)} さん・${fmtTime(x.createdAt)}${x.updatedAt !== x.createdAt ? `（更新 ${fmtTime(x.updatedAt)}）` : ''}</p>
        ${x.note && isSeller() ? `<p class="sub-note">運営より：${esc(x.note)}</p>` : ''}
        ${isSeller() ? '' : `<div class="sub-admin">
          <label>状態 <select data-status>${Object.entries(SUB.status).map(([k, v]) => `<option value="${k}" ${k === x.status ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
          <label class="sub-note-input">出品者へのメモ <input data-note value="${esc(x.note || '')}" maxlength="500" placeholder="差し戻しの理由など"></label>
        </div>`}
      </div>
      <div class="sub-item-actions">
        ${isSeller() && x.status === 'registered' ? '' : '<button class="btn btn-small" data-edit type="button">直す</button>'}
        ${isSeller() && x.status === 'registered' ? '' : '<button class="btn btn-small btn-ghost btn-danger" data-del type="button">削除</button>'}
      </div>
    </li>`).join('') : `<li class="sub-empty">${isSeller() ? 'まだ申請した商品はありません。「＋ 商品を申請する」から登録してください。' : 'まだ申請はありません。'}</li>`;
  const ev = state.events.find((x) => x.id === state.eventId);
  if (ev) ev.pendingSubmissions = list.filter((x) => x.status === 'pending').length;
  updateSubCount();
}
function openSubForm(item = null) {
  const f = $('#subForm');
  f.reset();
  SUB.editing = item?.id || null;
  SUB.images = item ? [...item.images] : [];
  if (item) for (const k of ['name', 'price', 'stock', 'size', 'limit', 'spec', 'description']) f.elements[k].value = item[k] ?? '';
  f.elements.isNew.checked = !!item?.isNew;
  f.elements.limited.checked = !!item?.limited;
  $('#subFormTitle').textContent = item ? `「${item.name}」を直す` : '商品を申請する';
  $('#subSubmit').textContent = item ? '変更を保存' : '申請する';
  $('#subError').textContent = '';
  f.hidden = false;
  renderSubThumbs();
  f.scrollIntoView({ behavior: 'smooth', block: 'start' });
  f.elements.name.focus({ preventScroll: true });
}
function renderSubThumbs() {
  $('#subThumbs').innerHTML = SUB.images.map((f, i) => `<li><img src="${subImg(f)}" alt=""><button type="button" data-rm="${i}" aria-label="この画像を外す">×</button></li>`).join('');
  $('#subAddImage').hidden = SUB.images.length >= 1; // 商品の画像は1枚（商品の詳細も1枚だけ表示）
}
$('#subNewBtn').addEventListener('click', () => openSubForm());
$('#subCancel').addEventListener('click', () => { $('#subForm').hidden = true; });
$('#subThumbs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rm]');
  if (!b) return;
  SUB.images.splice(Number(b.dataset.rm), 1);
  renderSubThumbs();
});
$('#subImageInput').addEventListener('change', async (e) => {
  const files = [...e.target.files].slice(0, 1 - SUB.images.length);
  e.target.value = '';
  for (const file of files) {
    if (file.size > 8 * 1024 * 1024) { toast(`「${file.name}」は 8MB を超えています`, { error: true }); continue; }
    try {
      const r = await api('submission-image', { method: 'POST', raw: file, type: file.type });
      SUB.images.push(r.file);
      renderSubThumbs();
    } catch (err) { toast(err.message, { error: true }); }
  }
});
$('#subForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget.elements;
  const body = { name: f.name.value, price: f.price.value, stock: f.stock.value, size: f.size.value, limit: f.limit.value, spec: f.spec.value, description: f.description.value, images: SUB.images, isNew: f.isNew.checked, limited: f.limited.checked };
  const miss = [[!body.name.trim(), '商品名'], [!body.price, '価格'], [body.stock === '', '在庫数'], [!body.images.length, '商品の画像']].filter(([b]) => b).map(([, l]) => l);
  if (miss.length) { $('#subError').textContent = `${miss.join('・')}を入力してください`; return; }
  try {
    if (SUB.editing) await api(`submissions?event=${encodeURIComponent(state.eventId)}&id=${encodeURIComponent(SUB.editing)}`, { method: 'PUT', body });
    else await evApi('submissions', { method: 'POST', body });
    $('#subForm').hidden = true;
    toast(SUB.editing ? '変更しました' : isSeller() ? '申請しました。運営が確認して Shopify に登録します' : '申請を追加しました');
    loadSubmissions();
  } catch (err) { $('#subError').textContent = err.message; }
});
$('#subList').addEventListener('click', async (e) => {
  const li = e.target.closest('.sub-item');
  if (!li) return;
  const item = SUB.items.find((x) => x.id === li.dataset.id);
  if (e.target.closest('[data-edit]')) openSubForm(item);
  if (e.target.closest('[data-del]')) {
    if (!confirm(`「${item.name}」の申請を削除します。よろしいですか？`)) return;
    try {
      await api(`submissions?event=${encodeURIComponent(state.eventId)}&id=${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      toast('申請を削除しました');
      loadSubmissions();
    } catch (err) { toast(err.message, { error: true }); }
  }
});
// 運営：状態・メモを変えたら保存
$('#subList').addEventListener('change', async (e) => {
  const li = e.target.closest('.sub-item');
  if (!li || !(e.target.matches('[data-status]') || e.target.matches('[data-note]'))) return;
  const body = e.target.matches('[data-status]') ? { status: e.target.value } : { note: e.target.value };
  try {
    const r = await api(`submissions?event=${encodeURIComponent(state.eventId)}&id=${encodeURIComponent(li.dataset.id)}`, { method: 'PUT', body });
    Object.assign(SUB.items.find((x) => x.id === r.item.id), r.item);
    renderSubmissions();
    toast(body.status ? `状態を「${SUB.status[body.status]}」にしました` : 'メモを保存しました');
  } catch (err) { toast(err.message, { error: true }); }
});

/* ---------- 注文（このイベントの商品が入った注文） ---------- */
const ORD = { list: [] };
const FIN = { PAID: '支払い済み', PENDING: '支払い待ち', AUTHORIZED: '承認済み', PARTIALLY_PAID: '一部支払い', REFUNDED: '返金済み', PARTIALLY_REFUNDED: '一部返金', VOIDED: '取消', EXPIRED: '期限切れ' };
const FUL = { UNFULFILLED: '未発送', FULFILLED: '発送済み', PARTIALLY_FULFILLED: '一部発送', IN_PROGRESS: '準備中', ON_HOLD: '保留', SCHEDULED: '予定', RESTOCKED: '返品・在庫戻し', PENDING_FULFILLMENT: '発送待ち', OPEN: '未発送' };
const shipText = (o) => [o.ship.zip && `〒${o.ship.zip}`, `${o.ship.province}${o.ship.city}${o.ship.address1}${o.ship.address2 ? ` ${o.ship.address2}` : ''}`].filter(Boolean).join(' ');
const needsShipping = (o) => !o.cancelled && !['FULFILLED', 'RESTOCKED'].includes(o.fulfillment);
async function loadOrders() {
  const body = $('#ordersBody');
  body.innerHTML = '<p class="hint">注文を読み込んでいます…</p>';
  $('#ordersCsv').disabled = true;
  try {
    const r = await evApi('orders');
    if (!r.orders) {
      const msg = {
        local: 'Shopify につないでいないため、注文はありません（Shopify につなぐと、ここに注文が出ます）。',
        no_collection: 'このイベントに Shopify のコレクションが設定されていません。',
        scope: 'Shopify のアプリに、注文を読む権限（read_orders）と、お客さまの情報（名前・住所・電話・メール）を読む許可がありません。運営に設定を依頼してください。',
        error: `注文を読み込めませんでした（${esc(r.message || '')}）。`,
      }[r.reason] || '注文を読み込めませんでした。';
      body.innerHTML = `<p class="note-box">${msg}</p>`;
      return;
    }
    ORD.list = r.orders;
    renderOrders();
  } catch (e) { body.innerHTML = `<p class="note-box">${esc(e.message)}</p>`; }
}
function renderOrders() {
  const only = $('#ordersUnfulfilled').checked;
  const list = ORD.list.filter((o) => !only || needsShipping(o));
  $('#ordersCsv').disabled = !list.length;
  const todo = ORD.list.filter(needsShipping).length;
  $('#ordersBody').innerHTML = `<p class="hint">${ORD.list.length}件の注文（未発送 ${todo}件）</p>` + (list.length ? `<ul class="order-list">${list.map((o) => `
    <li class="order ${o.cancelled ? 'is-cancelled' : ''}">
      <div class="order-head"><b>${esc(o.name)}</b><span class="hint">${fmtTime(o.createdAt)}</span>
        ${o.cancelled ? '<span class="pill pill-ended">キャンセル</span>' : ''}
        <span class="pill ${o.fulfillment === 'FULFILLED' ? 'pill-clean' : 'pill-dirty'}">${esc(FUL[o.fulfillment] || o.fulfillment || '')}</span>
        <span class="pill">${esc(FIN[o.financial] || o.financial || '')}</span></div>
      <ul class="order-items">${o.items.map((i) => `<li>${esc(i.title)}${i.variant && i.variant !== 'Default Title' ? `（${esc(i.variant)}）` : ''} × <b>${i.quantity}</b></li>`).join('')}</ul>
      <div class="order-ship"><b>お届け先</b><p>${esc(o.ship.name)}${o.ship.company ? `（${esc(o.ship.company)}）` : ''} 様<br>${esc(shipText(o))}${o.ship.phone || o.phone ? `<br>TEL ${esc(o.ship.phone || o.phone)}` : ''}${o.email ? `<br>${esc(o.email)}` : ''}</p>
        ${o.note ? `<p class="hint">備考：${esc(o.note)}</p>` : ''}</div>
    </li>`).join('')}</ul>` : '<p class="note-box">表示する注文はありません。</p>');
}
$('#ordersReload').addEventListener('click', loadOrders);
$('#ordersUnfulfilled').addEventListener('change', renderOrders);
$('#ordersCsv').addEventListener('click', () => {
  const only = $('#ordersUnfulfilled').checked;
  const rows = [['注文番号', '注文日時', '支払い', '発送', 'キャンセル', '商品', '数量', 'お届け先の名前', '会社名', '郵便番号', '住所', '電話番号', 'メール', '備考']];
  for (const o of ORD.list.filter((x) => !only || needsShipping(x))) {
    for (const i of o.items) {
      rows.push([o.name, new Date(o.createdAt).toLocaleString('ja-JP'), FIN[o.financial] || o.financial, FUL[o.fulfillment] || o.fulfillment, o.cancelled ? 'キャンセル' : '',
        `${i.title}${i.variant && i.variant !== 'Default Title' ? `（${i.variant}）` : ''}`, i.quantity, o.ship.name, o.ship.company, o.ship.zip,
        `${o.ship.province}${o.ship.city}${o.ship.address1}${o.ship.address2 ? ` ${o.ship.address2}` : ''}`, o.ship.phone || o.phone, o.email, o.note]);
    }
  }
  const csv = `﻿${rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n')}\r\n`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const ev = state.events.find((x) => x.id === state.eventId);
  a.download = `注文_${(ev?.title || state.eventId).replace(/[\\/:*?"<>|]/g, '_')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

window.addEventListener('beforeunload', (e) => {
  if (state.dirtyLocal || state.saving) { e.preventDefault(); e.returnValue = ''; }
});

/* ---------- パスワードの設定（運営が発行したリンク #/setup/TOKEN） ---------- */
let setupMin = 10;
async function showSetup(token) {
  $('#app').hidden = true;
  $('#login').hidden = true;
  $('#setup').hidden = false;
  try {
    const r = await fetch(`/admin/api/setup?token=${encodeURIComponent(token)}`, { headers: { 'x-haneul-admin': '1' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'このリンクは使えません');
    $('#setupId').textContent = `ID：${j.name}`;
    setupMin = j.minLength || 10;
    $('#setupForm .pw-label').textContent = `新しいパスワード（${setupMin}文字以上）`;
    $('#setupForm [name=password]').focus();
  } catch (e) {
    $('#setupId').textContent = '';
    $('#setupError').textContent = e.message;
    $('#setupForm button').disabled = true;
  }
  $('#setupForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget.elements;
    $('#setupError').textContent = '';
    if (f.password.value.length < setupMin) { $('#setupError').textContent = `パスワードは${setupMin}文字以上にしてください`; return; }
    if (f.password.value !== f.again.value) { $('#setupError').textContent = '2つのパスワードが一致しません'; return; }
    try {
      await api('setup', { method: 'POST', body: { token, password: f.password.value } });
      history.replaceState(null, '', '/admin/#/');
      $('#setup').hidden = true;
      toast('パスワードを設定しました');
      start();
    } catch (e) { $('#setupError').textContent = e.message; }
  };
}

/* ---------- パスワード変更（自分） ---------- */
$('#pwBtn').addEventListener('click', () => {
  $('#pwForm').reset();
  $('#pwError').textContent = '';
  $('#pwForm .pw-label').textContent = `新しいパスワード（${state.minPassword || 10}文字以上）`;
  $('#pwDialog').showModal();
});
$('#pwCancel').addEventListener('click', () => $('#pwDialog').close());
$('#pwForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.currentTarget.elements;
  $('#pwError').textContent = '';
  const min = state.minPassword || 10;
  if (f.password.value.length < min) { $('#pwError').textContent = `新しいパスワードは${min}文字以上にしてください`; return; }
  if (f.password.value !== f.again.value) { $('#pwError').textContent = '新しいパスワードが一致しません'; return; }
  try {
    await api('password', { method: 'POST', body: { current: f.current.value, password: f.password.value } });
    $('#pwDialog').close();
    toast('パスワードを変更しました');
  } catch (e) { $('#pwError').textContent = e.message; }
});

{
  const setupToken = () => /^#\/setup\/([\w-]+)$/.exec(location.hash)?.[1];
  // ページを開いたまま、リンクを貼り付けて開いたときも
  window.addEventListener('hashchange', () => { const t = setupToken(); if (t) showSetup(t); });
  if (setupToken()) showSetup(setupToken()); else start();
}

/* 上の帯（保存・公開ボタン）の高さを CSS に知らせて、タブをそのすぐ下に固定する（狭い画面では帯が折り返して高くなる） */
(() => {
  const bar = document.querySelector('.topbar');
  const eventbar = document.querySelector('.eventbar');
  if (!bar) return;
  const root = document.documentElement.style;
  const set = () => {
    root.setProperty('--topbar-h', `${Math.round(bar.getBoundingClientRect().height)}px`);
    root.setProperty('--eventbar-h', `${Math.round(eventbar?.getBoundingClientRect().height || 0)}px`);
  };
  set();
  if ('ResizeObserver' in window) { const ro = new ResizeObserver(set); ro.observe(bar); if (eventbar) ro.observe(eventbar); }
  else window.addEventListener('resize', set);
})();
