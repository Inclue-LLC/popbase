/*
 * サイト全体の設定（イベントに関係のないもの）
 * DATA_DIR/site.json に保存（Render ではディスク。Shopify の保存先とは別）
 *   { legal_notice: 'POP BASE（販売業者）の特定商取引法に基づく表記', updatedAt, updatedBy }
 *
 * 特定商取引法に基づく表記のページ（/legal-notice）は、ここの文と、公開中のイベントの「出店者（発送元）の表記」から作る。
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./auth');

const FILE = path.join(DATA_DIR, 'site.json');
const LEGAL_MAX = 5000;

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch { return {}; }
}
function write(s) {
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, FILE);
}

function getLegal() {
  const s = read();
  return { text: typeof s.legal_notice === 'string' ? s.legal_notice : '', updatedAt: s.updatedAt || null, updatedBy: s.updatedBy || null };
}
function setLegal(text, user) {
  if (typeof text !== 'string' || text.length > LEGAL_MAX) throw Object.assign(new Error(`${LEGAL_MAX}文字までで入力してください`), { status: 400 });
  const s = read();
  s.legal_notice = text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f]/g, '');
  s.updatedAt = new Date().toISOString();
  s.updatedBy = user || null;
  write(s);
  return getLegal();
}

/* ---------- /legal-notice のページ ---------- */
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<>"']+)/g, '<a href="$1" rel="noopener">$1</a>');

/** 「項目：内容」の行は表に、それ以外の行は前の項目の続き（なければ段落）にする（js/app.js の出店者の表記と同じ決まり） */
function legalHtml(text) {
  const out = [];
  let rows = null;
  let last = null;
  const flush = () => { if (rows) { out.push(`<table class="legal-table"><tbody>${rows.map((r) => `<tr><th scope="row">${esc(r.th)}</th><td>${r.td.map(linkify).join('<br>')}</td></tr>`).join('')}</tbody></table>`); rows = null; } };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) { last = null; continue; }
    const m = line.match(/^([^：:]{1,24})[：:]\s*(.*)$/);
    if (m) {
      if (!rows) rows = [];
      last = { th: m[1].trim(), td: [m[2]] };
      rows.push(last);
    } else if (last) {
      last.td.push(line);
    } else {
      flush();
      out.push(`<p>${linkify(line)}</p>`);
    }
  }
  flush();
  return out.join('\n');
}

function legalPage({ sellerText = '', brand = '' } = {}) {
  const own = getLegal().text.trim();
  const body = own
    ? legalHtml(own)
    : '<p>ただいま準備中です。お問い合わせは、トップページ下の「お問い合わせ」からお願いいたします。</p>';
  const seller = String(sellerText || '').trim();
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>特定商取引法に基づく表記 | POP BASE</title>
  <meta name="description" content="POP BASE（オンラインポップアップショップ）の特定商取引法に基づく表記です。">
  <link rel="icon" href="/images/popbase-mark.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600&family=Zen+Kaku+Gothic+New:wght@400;500;700;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/style.css">
  <link rel="stylesheet" href="/css/legal.css">
</head>
<body class="legal-page">
  <header class="site-header">
    <a class="logo" href="/" aria-label="POP BASE のトップへ"><img class="logo-mark" src="/images/popbase-mark.svg" alt="" width="30" height="32"><span>POP BASE</span><small>オンラインポップアップショップ</small></a>
  </header>
  <main class="legal-main">
    <h1>特定商取引法に基づく表記</h1>
    <section>
      <h2>販売業者（POP BASE）</h2>
      ${body}
    </section>
    ${seller ? `<section>
      <h2>出店者（発送元）${brand ? `<small>${esc(brand)}</small>` : ''}</h2>
      ${legalHtml(seller)}
    </section>` : ''}
  </main>
  <footer class="site-footer">
    <p><a href="/">POP BASE のトップへ</a></p>
    <p>&copy; POP BASE</p>
  </footer>
</body>
</html>`;
}

module.exports = { getLegal, setLegal, legalPage, legalHtml, LEGAL_MAX };
