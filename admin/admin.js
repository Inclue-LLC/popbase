/*
 * 店内管理画面
 * 下書きを編集 → 自動保存 → プレビューで確認 → 「公開する」でお客さんのサイトに反映
 */
import { Preview } from './preview.js';

const $ = (s, r = document) => r.querySelector(s);
const E = window.HaneulEvent;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const yen = (n) => `¥${Number(n || 0).toLocaleString('ja-JP')}`;
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

const state = {
  user: null,
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
    $('#login').hidden = true;
    $('#app').hidden = false;
    await loadState();
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
  const st = await api('state');
  if (st.products) window.PRODUCTS = st.products; // Shopify の商品
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

function renderAll() {
  renderPalette();
  renderFixtures();
  renderForm();
  renderCharacters();
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
function renderStatus() {
  const differs = snapshot(state.draft) !== snapshot(state.published);
  const pill = differs
    ? '<span class="pill pill-dirty">未公開の変更があります</span>'
    : '<span class="pill pill-clean">公開中と同じ内容です</span>';
  const saved = state.saving || state.dirtyLocal
    ? '保存しています…'
    : state.draft.updatedAt ? `下書きを保存しました（${fmtTime(state.draft.updatedAt)}${state.draft.updatedBy ? `・${esc(state.draft.updatedBy)}` : ''}）` : '';
  $('#status').innerHTML = `${pill}<span>${saved}</span>`;
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
  state.saving = true;
  state.dirtyLocal = false;
  renderStatus();
  try {
    const r = await api('draft', { method: 'PUT', body: { event: state.draft.event, layout: state.draft.layout, rev: state.draft.rev } });
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

/* ---------- 公開・取り消し ---------- */
$('#publishBtn').addEventListener('click', async () => {
  await flushSave();
  if (!confirm('公開すると、お客さんのサイトにすぐ反映されます。公開しますか？')) return;
  try {
    const pub = await api('publish', { method: 'POST', body: { rev: state.draft.rev } });
    state.published = pub;
    state.history.unshift({ at: pub.publishedAt, by: pub.publishedBy });
    toast('公開しました');
    renderStatus();
    renderHistory();
  } catch (e) {
    toast(e.message, { error: true });
    if (e.status === 409) loadState();
  }
});

$('#discardBtn').addEventListener('click', async () => {
  if (!confirm('下書きの変更をすべて捨てて、公開中の内容に戻します。よろしいですか？')) return;
  await flushSave();
  try {
    await api('discard', { method: 'POST' });
    await loadState();
    toast('公開中の内容に戻しました');
  } catch (e) { toast(e.message, { error: true }); }
});

$('#previewLink').addEventListener('click', async (e) => {
  if (state.dirtyLocal || state.saving) {
    e.preventDefault();
    await flushSave();
    window.open('/?preview=draft', '_blank', 'noopener');
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
  $('#leftTitle').textContent = window.STORE_LAYOUT.left.title;
  $('#rightTitle').textContent = window.STORE_LAYOUT.right.title;
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
function where(layout, id) {
  for (const zone of ['left', 'right']) {
    for (let r = 0; r < layout[zone].length; r++) {
      const i = layout[zone][r].indexOf(id);
      if (i >= 0) return { zone, row: r, i };
    }
  }
  const i = layout.island.indexOf(id);
  return i >= 0 ? { zone: 'island', row: 0, i } : null;
}
const getSlot = (L, s) => (s.zone === 'island' ? L.island[s.i] : L[s.zone][s.row][s.i]);
const setSlot = (L, s, v) => { if (s.zone === 'island') L.island[s.i] = v; else L[s.zone][s.row][s.i] = v; };
const ZONE_NAME = { left: '左の棚', right: '右の棚', island: '限定テーブル' };
const placeText = (s) => (s.zone === 'island' ? `限定テーブル ${s.i + 1}番` : `${ZONE_NAME[s.zone]} ${['下段', '中段', '上段'][s.row]} ${s.i + 1}番`);

function thumb(p) {
  if (!p) return '';
  if (p.image) return `<span class="thumb"><img src="${esc(p.image)}" alt="" loading="lazy"></span>`;
  return `<span class="thumb">${window.Art.productSVG(p)}</span>`;
}

/** 商品 id を枠へ。移動元（枠）があれば入れ替え、なければ置き換え */
function place(id, to) {
  const L = editableLayout();
  const from = where(L, id);
  const occupant = getSlot(L, to);
  if (from) setSlot(L, from, occupant || null);
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
    const at = where(L, p.id);
    const sel = state.selected?.id === p.id;
    return `<li class="pcard ${at ? 'is-placed' : ''} ${sel ? 'is-selected' : ''}" draggable="true" data-id="${esc(p.id)}" tabindex="0"
      aria-label="${esc(p.name)}${at ? `（${placeText(at)}）` : '（未配置）'}">
      ${thumb(p)}
      <span><span class="pname">${esc(p.name)}</span><br>
      <span class="pmeta">${yen(p.price)}${p.limited ? ' ・<span class="tag-limited">会場限定</span>' : ''}${p.stock === 0 ? ' ・<span class="tag-sold">在庫なし</span>' : ''}<br>
      ${at ? esc(placeText(at)) : '未配置'}</span></span></li>`;
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
  if (path === 'shop.themeLabel') return `${ev.title || base.name} ― ${ev.subtitle || base.title}`;
  if (path.startsWith('shop.')) return E.original[path.slice(5)];
  if (path.startsWith('layout.')) return path.split('.').slice(1).reduce((o, k) => o?.[k], E.original.layout);
  return path.split('.').reduce((o, k) => o?.[k], base);
}

const FORMS = { event: '#eventForm', entrance: '#entranceForm' };
function renderForm() {
  const ev = state.draft.event;
  const base = window.THEMES[ev.theme_preset] || window.THEMES[E.original.theme];
  const placeholders = { title: base.name, subtitle: base.title, period: E.original.period, novelty_threshold: E.original.novelty.threshold, novelty_name: E.original.novelty.name };
  for (const [tab, sel] of Object.entries(FORMS)) {
    const fields = E.FIELDS.filter((f) => (f.tab || 'event') === tab);
    const groups = [...new Set(fields.map((f) => f.group))];
    $(sel).innerHTML = groups.map((g) => `
      <fieldset class="fgroup"><legend>${esc(g)}</legend>
        ${fields.filter((f) => f.group === g).map((f) => fieldHtml(f, ev[f.key], placeholders)).join('')}
      </fieldset>`).join('');
  }
}

function fieldHtml(f, value, placeholders) {
  const id = `f_${f.key}`;
  const label = `<label for="${id}">${esc(f.label)}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</label>`;
  const defaultColorLabel = f.tab === 'entrance' ? '初期の色' : 'テーマの色';
  let input = '';
  if (f.type === 'text' || f.type === 'number') {
    const ph = f.placeholderPath ? themeDefault(f.placeholderPath) : placeholders[f.key];
    input = `<input id="${id}" data-key="${f.key}" type="${f.type}" value="${esc(value ?? '')}" placeholder="${esc(ph ?? '')}" ${f.type === 'number' ? 'min="0" step="100"' : 'maxlength="120"'}>`;
  } else if (f.type === 'textarea') {
    input = `<textarea id="${id}" data-key="${f.key}" maxlength="300" rows="2">${esc(value ?? '')}</textarea>`;
  } else if (f.type === 'select') {
    const opts = f.options();
    const first = f.key === 'theme_preset' ? [{ value: '', label: `サイトの初期設定（${window.THEMES[E.original.theme]?.name || ''}）` }] : [];
    input = `<select id="${id}" data-key="${f.key}">${[...first, ...opts].map((o) =>
      `<option value="${esc(o.value)}" ${String(value ?? '') === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  } else if (f.type === 'color') {
    const def = themeDefault(f.themePath) || '#ffffff';
    const v = value || def;
    input = `<span class="color-row"><input id="${id}" data-key="${f.key}" type="color" value="${esc(v)}">
      <span class="color-note">${value ? esc(value) : defaultColorLabel}</span>
      ${value ? `<button type="button" class="btn btn-small btn-ghost" data-reset="${f.key}">${defaultColorLabel}に戻す</button>` : ''}</span>`;
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
    state.draft.event[key] = v;
    if (f.type === 'color') {
      const note = e.target.parentElement.querySelector('.color-note');
      if (note) note.textContent = v;
    }
    changed();
  });
  form.addEventListener('change', async (e) => {
    const key = e.target.dataset.key;
    // テーマや色の変更で「テーマの色」の表示が変わるので描き直す
    if (key === 'theme_preset' || e.target.type === 'color') { renderForm(); return; }
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
const charEdits = () => {
  const v = state.draft.event.characters;
  if (!v || typeof v !== 'object') state.draft.event.characters = {};
  return state.draft.event.characters;
};

function renderCharacters() {
  const edits = charEdits();
  E.applyCharacters(edits); // window.CHARACTERS に反映した結果で表示する
  $('#charEditor').innerHTML = E.original.characters.map((o) => {
    const v = edits[o.id] || {};
    const c = window.CHARACTERS.find((x) => x.id === o.id);
    const img = E.imageUrl(v.image);
    return `<div class="char-card ${v.hidden ? 'is-hidden' : ''}" data-char="${esc(o.id)}">
      <div class="char-art">
        <span class="art" style="background:color-mix(in srgb, ${esc(c.color)} 25%, transparent)">${window.Art.characterSVG(c)}</span>
        <label class="btn btn-small">画像を選ぶ<input type="file" accept="image/png,image/jpeg,image/webp" data-char-upload hidden></label>
        ${img ? '<button type="button" class="btn btn-small btn-ghost" data-char-reset="image">元の絵に戻す</button>' : ''}
      </div>
      <div class="char-fields">
        <div class="field"><label>名前</label><input type="text" data-char-key="name" maxlength="20" value="${esc(v.name || '')}" placeholder="${esc(o.name)}"></div>
        <div class="field"><label>英語名</label><input type="text" data-char-key="en" maxlength="30" value="${esc(v.en || '')}" placeholder="${esc(o.en)}"></div>
        <div class="field"><label>プロフィール</label><textarea data-char-key="profile" maxlength="200" rows="2" placeholder="${esc(o.profile)}">${esc(v.profile || '')}</textarea></div>
        <div class="field"><label>色</label><span class="color-row"><input type="color" data-char-key="color" value="${esc(v.color || o.color)}">
          <span class="color-note">${v.color ? esc(v.color) : '元の色'}</span>
          ${v.color ? '<button type="button" class="btn btn-small btn-ghost" data-char-reset="color">元の色に戻す</button>' : ''}</span></div>
        <div class="field"><label>表示</label><label class="check"><input type="checkbox" data-char-key="hidden" ${v.hidden ? 'checked' : ''}> 表示しない</label></div>
      </div>
    </div>`;
  }).join('');
}

function charChanged({ rerender = false } = {}) {
  if (rerender) renderCharacters();
  changed();
}

$('#charEditor').addEventListener('input', (e) => {
  const key = e.target.dataset.charKey;
  if (!key) return;
  const id = e.target.closest('[data-char]').dataset.char;
  const edits = charEdits();
  edits[id] ||= {};
  edits[id][key] = key === 'hidden' ? e.target.checked : e.target.value;
  if (key === 'color') {
    const note = e.target.parentElement.querySelector('.color-note');
    if (note) note.textContent = e.target.value;
  }
  E.applyCharacters(edits);
  charChanged();
});
$('#charEditor').addEventListener('change', async (e) => {
  const card = e.target.closest('[data-char]');
  if (!card) return;
  if (e.target.dataset.charKey === 'hidden' || e.target.dataset.charKey === 'color') { renderCharacters(); return; }
  if (!e.target.matches('[data-char-upload]') || !e.target.files[0]) return;
  const file = e.target.files[0];
  if (file.size > 8 * 1024 * 1024) { toast('8MB 以下の画像を選んでください', { error: true }); return; }
  toast('画像をアップロードしています…');
  try {
    const img = await api('upload', { method: 'POST', raw: file, type: file.type });
    const edits = charEdits();
    edits[card.dataset.char] ||= {};
    edits[card.dataset.char].image = img;
    charChanged({ rerender: true });
    toast('画像を設定しました');
  } catch (err) { toast(err.message, { error: true }); }
});
$('#charEditor').addEventListener('click', (e) => {
  const reset = e.target.closest('[data-char-reset]');
  if (!reset) return;
  const id = reset.closest('[data-char]').dataset.char;
  const edits = charEdits();
  if (edits[id]) edits[id][reset.dataset.charReset] = '';
  charChanged({ rerender: true });
});

/* ==========================================================
   公開の履歴
   ========================================================== */
function renderHistory() {
  const p = state.published;
  $('#historySummary').innerHTML = `
    <p><b>公開中：</b>${p?.publishedAt ? `${fmtTime(p.publishedAt)}（${esc(p.publishedBy || '—')}）` : 'まだ公開していません（サイトは初期設定で表示中）'}</p>
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
