/*
 * 店内管理画面
 * イベントを選ぶ（作る・複製する）→ 下書きを編集 → 自動保存 → プレビューで確認 → 「公開する」
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
    $('#storage').textContent = `保存先：${s.storage}`;
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
  state.published = st.published;
  state.history = st.history || [];
  state.dirtyLocal = false;
  if (!preview) {
    try { preview = new Preview($('#previewBox'), $('#previewLoading')); } catch (e) {
      $('#previewLoading').textContent = 'このブラウザでは 3D プレビューを表示できません';
    }
  }
  renderAll();
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
  const note = cur.active ? 'いまお客さんのサイトに表示されています' : cur.published ? '会期になると自動でお客さんのサイトに表示されます' : '「公開する」を押すと、会期に合わせて表示されます';
  $('#eventInfo').innerHTML = `<span class="pill pill-${cls}" title="${note}">${label}</span>${cur.active ? ' <span class="pill pill-active" title="' + note + '">表示中</span>' : ''}`;
  $('#deleteEventBtn').disabled = !!cur.active;
  $('#deleteEventBtn').title = cur.active ? 'お客さんに表示中のイベントは削除できません' : '';
}
/* ---------- 画面の切り替え（#/ = イベント一覧、#/event/ID = イベントの編集） ---------- */
let openTab = null; // イベントを開いたときに選ぶタブ
async function route() {
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
        <div class="ev-badges"><span class="pill pill-${cls}">${label}</span>${x.active ? '<span class="pill pill-active">お客さんに表示中</span>' : ''}</div>
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
      section('draftonly', '準備中（未公開）', '「公開する」を押すまで表示されません') + section('ended', '終了', '')
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
  const miss = E.missingRequired(state.draft.event);
  const missPill = miss.length ? `<span class="pill pill-missing" title="${esc(miss.map((f) => f.label).join('・'))}">必須の未入力 ${miss.length}</span>` : '';
  $('#status').innerHTML = `${pill}${missPill}<span class="saved" title="${esc(savedTitle)}">${saved}</span>`;
  // 保存ボタン：未保存の変更があれば「保存」、保存中は「保存中…」、なければ「保存済み」
  const sb = $('#saveBtn');
  sb.textContent = state.saving ? '保存中…' : state.dirtyLocal ? '保存' : '保存済み ✓';
  sb.classList.toggle('is-dirty', state.dirtyLocal && !state.saving);
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
  if (!confirm('公開します。会期中のイベントなら、お客さんのサイトにすぐ反映されます。よろしいですか？')) return;
  try {
    const pub = await evApi('publish', { method: 'POST', body: { rev: state.draft.rev } });
    state.published = pub;
    state.history.unshift({ at: pub.publishedAt, by: pub.publishedBy });
    await loadEvents(); // お客さんに出すイベントが変わることがある
    const cur = state.events.find((x) => x.id === state.eventId);
    toast(cur?.active ? '公開しました。お客さんのサイトに表示されています' : '公開しました。会期になると自動でお客さんのサイトに表示されます');
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
  $('#leftTitle').textContent = window.STORE_LAYOUT.left.label || window.STORE_LAYOUT.left.title;
  $('#rightTitle').textContent = window.STORE_LAYOUT.right.label || window.STORE_LAYOUT.right.title;
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
const ZONE_NAME = { left: '左の棚', right: '右の棚', island: '限定テーブル' };
const placeText = (s) => (s.zone === 'island' ? `限定テーブル ${s.i + 1}番` : `${ZONE_NAME[s.zone]} ${['下段', '中段', '上段'][s.row]} ${s.i + 1}番`);

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
      <span class="pmeta">${yen(p.price)}${p.limited ? ' ・<span class="tag-limited">会場限定</span>' : ''}${p.stock === 0 ? ' ・<span class="tag-sold">在庫なし</span>' : ''}<br>
      ${at ? `${esc(placeText(at))}${places.length > 1 ? ` ほか${places.length - 1}か所` : ''}` : '未配置'}</span></span></li>`;
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
    $(`#zone-${zone}`).innerHTML = [2, 1, 0].map((r) => `
      <div class="row"><span class="row-label">${['下段', '中段', '上段'][r]}</span>
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
$('#productList').addEventListener('click', (e) => {
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

const FORMS = { event: '#eventForm', entrance: '#entranceForm' };
function renderForm() {
  const ev = state.draft.event;
  const base = window.THEMES[ev.theme_preset] || window.THEMES[E.original.theme];
  const placeholders = { title: base.name, period: E.original.period, novelty_threshold: `例：${E.NOVELTY_THRESHOLD}`, shipping_fee: '例：600', free_shipping_threshold: '例：5000（空欄なら送料無料なし）', shipping_note: '例：会期終了後、12月下旬より順次発送します', novelty_name: 'オリジナルステッカー' };
  for (const [tab, sel] of Object.entries(FORMS)) {
    const fields = E.FIELDS.filter((f) => (f.tab || 'event') === tab && (!f.showIf || f.showIf(ev)));
    const groups = [...new Set(fields.map((f) => f.group))];
    $(sel).innerHTML = NEED_LEGEND + groups.map((g) => `
      <fieldset class="fgroup"><legend>${esc(g)}</legend>
        ${fields.filter((f) => f.group === g).map((f) => fieldHtml(f, f.value ? f.value(ev) : ev[f.key], placeholders)).join('')}
        ${g === '会期・営業時間' ? '<p class="schedule-status" id="scheduleStatus"></p>' : ''}
      </fieldset>`).join('');
  }
  renderScheduleStatus();
  markMissing();
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
  el.innerHTML = `この設定で公開すると、今は <b>${esc(text)}</b>${hours ? `　${esc(hours)}` : '　24時間営業'}`;
  // 「会期の表示文」の薄い文字（空欄のときに使われる文）も更新
  const per = $('#f_period');
  if (per) per.placeholder = HS.periodText(ev) || E.original.period;
  el.dataset.state = st.state;
}
setInterval(() => { if (state.draft) renderScheduleStatus(); }, 30000);

/** 必須・任意の表示 */
function needBadge(f) {
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
  const miss = new Set(E.missingRequired(state.draft.event).map((f) => f.key));
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
    autocomplete="off" inputmode="text" placeholder="#RRGGBB" aria-label="${esc(label)}（カラーコード）">`;
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

function fieldHtml(f, value, placeholders) {
  const id = `f_${f.key}`;
  const label = `<label for="${id}">${esc(f.label)}${needBadge(f)}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</label>`;
  const defaultColorLabel = f.defaultLabel || (String(f.themePath || '').startsWith('const.') ? '初期の色' : 'テーマの色');
  let input = '';
  if (f.type === 'text' || f.type === 'number') {
    let ph = f.placeholderPath ? themeDefault(f.placeholderPath) : placeholders[f.key];
    if (f.need === 'required' && ph) ph = `例：${ph}`; // 必須の欄は、入力済みに見えないよう「例：」を付ける
    input = `<input id="${id}" data-key="${f.key}" type="${f.type}" value="${esc(value ?? '')}" placeholder="${esc(ph ?? '')}" ${f.type === 'number' ? 'min="0" step="100"' : 'maxlength="120"'}>`;
    // 文字数の上限がある項目は、残りを表示（全角2・半角1で数える）
    if (f.maxUnits) input = `<span class="unit-row">${input}<span class="unit-count" data-count-for="${f.key}">${unitLabel(value, f.maxUnits)}</span></span>`;
  } else if (f.type === 'datetime' || f.type === 'time') {
    input = `<span class="dt-row"><input id="${id}" data-key="${f.key}" type="${f.type === 'datetime' ? 'datetime-local' : 'time'}" step="60" value="${esc(value ?? '')}">
      ${value ? `<button type="button" class="btn btn-small btn-ghost" data-reset="${f.key}">消す</button>` : ''}</span>`;
  } else if (f.type === 'textarea') {
    input = `<textarea id="${id}" data-key="${f.key}" maxlength="300" rows="2">${esc(value ?? '')}</textarea>`;
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
        <div class="field"><label>名前 <span class="need need-required">必須</span><span class="hint">壁の名前の札・キャラクター紹介・アバター選びに出ます</span></label><input type="text" data-cast-key="name" maxlength="20" value="${esc(x.name || '')}" placeholder="例：ハル" class="${x.name ? '' : 'is-missing'}"></div>
        <div class="field"><label>英語名 <span class="need need-hide">任意・空欄なら非表示</span></label><input type="text" data-cast-key="en" maxlength="30" value="${esc(x.en || '')}" placeholder="例：HARU（空欄なら表示しません）"></div>
        <div class="field"><label>プロフィール <span class="need need-hide">任意・空欄なら非表示</span><span class="hint">ご案内のキャラクター紹介と、店内でキャラクターをタップしたときの紹介文</span></label><textarea data-cast-key="profile" maxlength="200" rows="2" placeholder="キャラクター紹介に出す短い説明（空欄なら表示しません）">${esc(x.profile || '')}</textarea></div>
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
    ? 'このイベントにはキャラクターが登録されていないため、自社の4体（ハル・ビョル・タルビ・ゴミ）をアバターにしています。'
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
      <input type="text" data-av-name maxlength="12" value="${esc(a.name)}" aria-label="アバターの名前" placeholder="名前（12文字まで）">
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
window.addEventListener('beforeunload', (e) => {
  if (state.dirtyLocal || state.saving) { e.preventDefault(); e.returnValue = ''; }
});

start();

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
