/*
 * お問い合わせフォーム（POST /api/contact）→ メールで届ける
 * --------------------------------------------------
 * サイトのお問い合わせフォーム（js/app.js）から届いた内容を、SMTP でメールにして送ります。
 * お客さんのメールアドレスは「返信先（Reply-To）」に入るので、届いたメールにそのまま返信できます。
 *
 * 環境変数（Render の Environment に設定。パスワードは GitHub やブラウザに出さない）:
 *   CONTACT_TO     お問い合わせの届け先（例: 担当者のメールアドレス。カンマ区切りで複数可）
 *   SMTP_HOST      メールサーバー（例: Xserver なら sv●●●●.xserver.jp）
 *   SMTP_PORT      ポート（既定 465。587 のときは STARTTLS）
 *   SMTP_USER      メールアカウント（例: info@popbase.jp）
 *   SMTP_PASS      そのパスワード
 *   CONTACT_FROM   差出人（既定は SMTP_USER）。例: "POP BASE <info@popbase.jp>"
 *
 * 迷惑な大量送信を防ぐため、同じ接続元からは 1 時間に 5 回まで、全体で 1 時間に 100 回まで。
 * 自動入力ロボット対策に、人には見えない欄（website）に何か入っていたら送ったふりをして捨てます。
 */
const { clientIp } = require('./client-ip');

const CATEGORIES = {
  product: '商品・ご注文について',
  shop: '出店について',
  other: 'その他',
};
const LIMITS = { name: 60, email: 254, order: 40, company: 80, links: 300, message: 2000 };
const PER_IP = 5;
const TOTAL = 100;
const HOUR = 3600e3;

const env = (k) => String(process.env[k] || '').trim();
const configured = () => !!(env('CONTACT_TO') && env('SMTP_HOST') && env('SMTP_USER') && env('SMTP_PASS'));

let transporter = null;
function getTransport() {
  if (transporter) return transporter;
  const nodemailer = require('nodemailer');
  const port = Number(env('SMTP_PORT')) || 465;
  transporter = nodemailer.createTransport({
    host: env('SMTP_HOST'),
    port,
    secure: port === 465,
    auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') },
    connectionTimeout: 15e3,
    socketTimeout: 20e3,
  });
  return transporter;
}

/* ---------- 送信回数の制限 ---------- */
const sentByIp = new Map(); // ip -> [時刻]
let sentAll = [];
function allowed(ip, now = Date.now()) {
  sentAll = sentAll.filter((t) => now - t < HOUR);
  const mine = (sentByIp.get(ip) || []).filter((t) => now - t < HOUR);
  sentByIp.set(ip, mine);
  if (sentByIp.size > 5000) for (const [k, v] of sentByIp) if (!v.length) sentByIp.delete(k);
  return mine.length < PER_IP && sentAll.length < TOTAL;
}
function record(ip, now = Date.now()) {
  sentAll.push(now);
  sentByIp.get(ip)?.push(now) ?? sentByIp.set(ip, [now]);
}

/* ---------- 入力の確認 ---------- */
// 改行は本文だけ許す（ほかの欄は1行）。見えない制御文字は取り除く
const oneLine = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const multiLine = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, max);
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

function validate(body) {
  const b = body && typeof body === 'object' ? body : {};
  const form = {
    category: Object.hasOwn(CATEGORIES, b.category) ? b.category : '',
    name: oneLine(b.name, LIMITS.name),
    email: oneLine(b.email, LIMITS.email),
    order: oneLine(b.order, LIMITS.order),
    company: oneLine(b.company, LIMITS.company),
    links: oneLine(b.links, LIMITS.links), // 出品のご案内（about.html）の「ブランド・商品が見られるURL」
    message: multiLine(b.message, LIMITS.message),
    agree: b.agree === true,
  };
  const errors = [];
  if (!form.category) errors.push('category');
  if (!form.name) errors.push('name');
  if (!EMAIL.test(form.email)) errors.push('email');
  if (!form.message) errors.push('message');
  if (!form.agree) errors.push('agree');
  return { form, errors };
}

function mailText(f) {
  const at = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  return [
    'POP BASE のお問い合わせフォームから送信がありました。',
    'このメールに返信すると、お客さまのメールアドレスに届きます。',
    '',
    `お問い合わせの種類：${CATEGORIES[f.category]}`,
    `お名前：${f.name}`,
    `メールアドレス：${f.email}`,
    ...(f.category === 'product' && f.order ? [`ご注文番号：${f.order}`] : []),
    ...(f.category === 'shop' && f.company ? [`会社名・ブランド名：${f.company}`] : []),
    ...(f.category === 'shop' && f.links ? [`ブランド・商品のURL：${f.links}`] : []),
    `送信日時：${at}`,
    '',
    '―――― お問い合わせ内容 ――――',
    f.message,
    '――――――――――――――――',
  ].join('\n');
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJson(req, limit = 20 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('json'), { status: 400 })); } });
    req.on('error', reject);
  });
}

/** 別のサイトから勝手に送らせないよう、同じサイトのページから送られたものだけ受け付ける */
function sameSite(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

async function handle(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  if (!sameSite(req) || !/^application\/json/.test(req.headers['content-type'] || '')) return json(res, 403, { error: 'forbidden' });
  let body;
  try { body = await readJson(req); } catch (e) { return json(res, e.status || 400, { error: 'bad_request' }); }
  // 人には見えない欄に入力がある＝自動入力ロボット。送ったふりをして捨てる
  if (body && typeof body.website === 'string' && body.website.trim()) return json(res, 200, { ok: true });
  const { form, errors } = validate(body);
  if (errors.length) return json(res, 400, { error: 'invalid', fields: errors });
  if (!configured()) {
    console.error('[contact] メールの送信設定（CONTACT_TO・SMTP_HOST・SMTP_USER・SMTP_PASS）がありません');
    return json(res, 503, { error: 'not_configured' });
  }
  const ip = clientIp(req);
  if (!allowed(ip)) return json(res, 429, { error: 'too_many' });
  try {
    await getTransport().sendMail({
      from: env('CONTACT_FROM') || env('SMTP_USER'),
      to: env('CONTACT_TO'),
      replyTo: { name: form.name, address: form.email },
      subject: `【POP BASE】お問い合わせ（${CATEGORIES[form.category]}）`,
      text: mailText(form),
    });
    record(ip);
    return json(res, 200, { ok: true });
  } catch (e) {
    console.error('[contact] メールを送れませんでした:', e.message);
    return json(res, 502, { error: 'send_failed' });
  }
}

/** 運営へのお知らせメール（出品者の確認依頼・商品の申請など）。送信設定がなければ何もしない */
async function notify(subject, text) {
  if (!configured()) return false;
  try {
    await getTransport().sendMail({ from: env('CONTACT_FROM') || env('SMTP_USER'), to: env('CONTACT_TO'), subject: `【POP BASE 管理画面】${subject}`, text });
    return true;
  } catch (e) { console.error('[notify] メールを送れませんでした:', e.message); return false; }
}

module.exports = { handle, validate, CATEGORIES, configured, notify };
