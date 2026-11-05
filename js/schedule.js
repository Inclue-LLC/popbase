/*
 * 会期と営業時間（ブラウザとサーバーの両方で使う）
 * --------------------------------------------------
 * 管理画面の「イベント」で設定する値（すべて日本時間）:
 *   open_at     開始日時   'YYYY-MM-DDTHH:MM'（空欄なら制限なし）
 *   close_at    終了日時   'YYYY-MM-DDTHH:MM'（空欄なら制限なし）
 *   daily_open  毎日の開店 'HH:MM'（daily_close とセット。空欄なら会期中は24時間）
 *   daily_close 毎日の閉店 'HH:MM'
 *
 * status() の結果:
 *   { state: 'open',   closesAt }   営業中（closesAt：次に閉まる時刻。なければ null）
 *   { state: 'before', opensAt }    会期が始まる前
 *   { state: 'closed', opensAt }    会期中だが営業時間外（opensAt：次に開く時刻）
 *   { state: 'ended' }              会期が終わった
 */
(function (root) {
  const TZ_OFFSET = 9 * 3600e3; // 日本時間（UTC+9）
  const DAY = 86400e3;
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

  const DT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
  const TM = /^(\d{2}):(\d{2})$/;

  /** 'YYYY-MM-DDTHH:MM'（日本時間）→ ミリ秒。不正・空なら null */
  function parseDateTime(s) {
    const m = DT.exec(String(s || ''));
    if (!m) return null;
    const [y, mo, d, h, mi] = m.slice(1).map(Number);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
    return Date.UTC(y, mo - 1, d, h, mi) - TZ_OFFSET;
  }
  /** 'HH:MM' → 0時からの分。不正・空なら null */
  function parseTime(s) {
    const m = TM.exec(String(s || ''));
    if (!m) return null;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return null;
    return h * 60 + mi;
  }

  function parse(f = {}) {
    const openAt = parseDateTime(f.open_at);
    const closeAt = parseDateTime(f.close_at);
    let daily = null;
    const o = parseTime(f.daily_open);
    const c = parseTime(f.daily_close);
    if (o != null && c != null && c > o) daily = { open: o, close: c };
    return { openAt, closeAt, daily };
  }

  /** 日本時間のその日の 0:00（ミリ秒） */
  const jstMidnight = (t) => Math.floor((t + TZ_OFFSET) / DAY) * DAY - TZ_OFFSET;

  function status(f, now = Date.now()) {
    const { openAt, closeAt, daily } = parse(f);
    if (closeAt != null && now >= closeAt) return { state: 'ended' };
    if (!daily) {
      if (openAt != null && now < openAt) return { state: 'before', opensAt: openAt };
      return { state: 'open', closesAt: closeAt };
    }
    // 今日から順に、営業時間の枠を探す
    const day0 = jstMidnight(now);
    for (let k = 0; k < 400; k++) {
      const s = Math.max(day0 + k * DAY + daily.open * 60e3, openAt ?? -Infinity);
      const e = Math.min(day0 + k * DAY + daily.close * 60e3, closeAt ?? Infinity);
      if (e <= s) continue;
      if (now < s) return { state: openAt != null && now < openAt ? 'before' : 'closed', opensAt: s };
      if (now < e) return { state: 'open', closesAt: e };
    }
    return { state: 'ended' };
  }

  /* ---------- 表示用 ---------- */
  function parts(t) {
    const d = new Date(t + TZ_OFFSET);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), w: WEEK[d.getUTCDay()], h: d.getUTCHours(), mi: d.getUTCMinutes() };
  }
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (p) => `${p.h}:${pad(p.mi)}`;

  /** 会期の表示 例：2026.12.01 (火) 10:00 – 12.31 (木) 20:00 */
  function periodText(f) {
    const { openAt, closeAt } = parse(f);
    if (openAt == null && closeAt == null) return '';
    const a = openAt != null ? parts(openAt) : null;
    const b = closeAt != null ? parts(closeAt) : null;
    const left = a ? `${a.y}.${pad(a.m)}.${pad(a.d)} (${a.w}) ${hm(a)}` : '';
    let right = '';
    const sameDay = a && b && a.y === b.y && a.m === b.m && a.d === b.d;
    if (sameDay) right = hm(b); // 同じ日なら時刻だけ
    else if (b) right = `${a && a.y === b.y ? '' : `${b.y}.`}${pad(b.m)}.${pad(b.d)} (${b.w}) ${hm(b)}`;
    return a && b ? `${left} – ${right}` : a ? `${left} 〜` : `〜 ${right}`;
  }

  /** 営業時間の表示 例：営業時間 10:00–20:00 */
  function hoursText(f) {
    const { daily } = parse(f);
    if (!daily) return '';
    const t = (min) => `${Math.floor(min / 60)}:${pad(min % 60)}`;
    return `営業時間 ${t(daily.open)}–${t(daily.close)}`;
  }

  /** 開く時刻の表示 例：12月1日(火) 10:00 ／ 本日 10:00 ／ 明日 10:00 */
  function whenText(t, now = Date.now()) {
    const p = parts(t);
    const days = Math.round((jstMidnight(t) - jstMidnight(now)) / DAY);
    const day = days === 0 ? '本日' : days === 1 ? '明日' : `${p.m}月${p.d}日(${p.w})`;
    return `${day} ${hm(p)}`;
  }
  /** 時刻だけ 例：20:00 */
  const timeText = (t) => hm(parts(t));

  const api = { parse, parseDateTime, parseTime, status, periodText, hoursText, whenText, timeText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HaneulSchedule = api;
})(typeof window !== 'undefined' ? window : globalThis);
