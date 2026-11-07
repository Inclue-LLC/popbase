/*
 * イベント（ポップアップ）ごとの管理：共通の処理
 * --------------------------------------------------
 * 1つのイベント = { id, draft（下書き）, published（公開済みの内容）, history（公開の履歴） }
 * お客さんのサイトに出すイベントは、公開済みのイベントの「会期」で自動で決まる（pickActive）。
 */
const crypto = require('crypto');
const schedule = require('../../js/schedule.js');

/** 新しいイベントの ID（Shopify のハンドルにも使える文字だけ） 例: e20261104-k3f9 */
function newId(now = new Date()) {
  const d = new Date(now.getTime() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
  return `e${d}-${crypto.randomBytes(3).toString('hex')}`;
}
const ID_RE = /^(main|e\d{8}-[a-f0-9]{6})$/;
const validId = (id) => typeof id === 'string' && ID_RE.test(id);

/**
 * お客さんのサイトに出すイベントを選ぶ
 *   1. 会期中（開始日時 ≦ 今 < 終了日時）のイベント（重なっていたら、あとから始まったもの）
 *   2. なければ、これから始まるイベントのうち一番早いもの（入口に「まもなくオープン」）
 *   3. なければ、一番最近終わったイベント（入口に「このポップアップは終了しました」）
 * 公開していないイベント（下書きだけ）は選ばない。
 * @param {{ id: string, published: { event: object } | null }[]} list
 */
function pickActive(list, now = Date.now()) {
  const items = list
    .filter((x) => x.published && x.published.event && Object.keys(x.published.event).length)
    .map((x) => ({
      x,
      open: schedule.parseDateTime(x.published.event.open_at),
      close: schedule.parseDateTime(x.published.event.close_at),
      at: Date.parse(x.published.publishedAt || '') || 0,
    }));
  if (!items.length) return null;
  const running = items.filter((i) => i.open != null && i.close != null && i.open <= now && now < i.close);
  if (running.length) return running.sort((a, b) => b.open - a.open || b.at - a.at)[0].x;
  const upcoming = items.filter((i) => i.open != null && i.open > now);
  if (upcoming.length) return upcoming.sort((a, b) => a.open - b.open)[0].x;
  const ended = items.filter((i) => i.close != null && i.close <= now);
  if (ended.length) return ended.sort((a, b) => b.close - a.close)[0].x;
  // 日時のないイベント（以前の形式）は、最後に公開したもの
  return items.sort((a, b) => b.at - a.at)[0].x;
}

/**
 * 会期が重なる別のイベント（1つの期間に開けるイベントは1つ）。重なりがなければ null
 * list = store.listEvents() の要約（公開済みなら公開中の会期、未公開なら下書きの会期）
 */
function findOverlap(list, id, openAt, closeAt) {
  const a0 = schedule.parseDateTime(openAt);
  const a1 = schedule.parseDateTime(closeAt);
  if (a0 == null || a1 == null) return null;
  for (const x of list) {
    if (x.id === id) continue;
    const e = x; // 一覧の要約（listEvents）：open_at / close_at は公開中の会期、未公開なら下書きの会期
    const b0 = schedule.parseDateTime(e.open_at);
    const b1 = schedule.parseDateTime(e.close_at);
    if (b0 == null || b1 == null) continue;
    if (a0 < b1 && b0 < a1) return { id: x.id, title: e.title || '（名前なし）', period: schedule.periodText(e) };
  }
  return null;
}
const overlapMessage = (o) => `この会期は、イベント「${o.title}」（${o.period}）と重なっています。1つの期間に開けるイベントは1つです`;

/** 一覧に出す要約 */
function summary(x, activeId) {
  const d = x.draft?.event || {};
  const p = x.published?.event || null;
  return {
    id: x.id,
    title: d.title || p?.title || '',
    brand: d.brand || p?.brand || '',
    open_at: (p || d).open_at || '',
    close_at: (p || d).close_at || '',
    collection: d.collection || p?.collection || '',
    published: !!p,
    publishedAt: x.published?.publishedAt || null,
    updatedAt: x.draft?.updatedAt || null,
    createdAt: x.createdAt || null,
    active: x.id === activeId,
  };
}

/** 複製するときに引き継がない項目（イベント名・会期・コレクションは新しく決める） */
const NOT_COPIED = ['title', 'open_at', 'close_at', 'period', 'collection', 'daily_open', 'daily_close'];
function copyForNew(event = {}, title = '') {
  const out = { ...event };
  for (const k of NOT_COPIED) out[k] = '';
  out.title = title;
  return out;
}

module.exports = { newId, validId, pickActive, summary, copyForNew, findOverlap, overlapMessage };
