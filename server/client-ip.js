/*
 * お客さんの接続元（IP アドレス）の判定
 * --------------------------------------------------
 * 公開サービス（Render など）では、お客さんとこのサーバーの間に中継サーバーが入るため、
 * 接続元は中継サーバーが付ける X-Forwarded-For ヘッダーから読みます。
 * ただし、このヘッダーの「左側」はお客さんが自由に書き換えられるので、
 * 中継サーバーが付け足した「右側」から数えて読みます。
 *
 * 環境変数:
 *   CLIENT_IP_HEADER  中継サーバーが付ける、接続元だけが入ったヘッダー名（例: true-client-ip, cf-connecting-ip）。
 *                     設定するとこれを優先します
 *   TRUST_PROXY_HOPS  中継サーバーの段数（既定 1）。X-Forwarded-For の右から何番目を使うか。
 *                     0 にするとヘッダーを使わず、直接の接続元を使います（中継なしで公開する場合）
 *
 * 公開後に https://（サイトのアドレス）/api/ip を開くと、サーバーが判定したあなたの IP が表示されます。
 * スマホ（Wi-Fi を切った状態）とパソコンで違う IP が出れば、正しく判定できています。
 */
const HEADER = (process.env.CLIENT_IP_HEADER || '').trim().toLowerCase();
const HOPS = process.env.TRUST_PROXY_HOPS === undefined || process.env.TRUST_PROXY_HOPS === ''
  ? 1
  : Math.max(0, Math.floor(Number(process.env.TRUST_PROXY_HOPS) || 0));

function clientIp(req) {
  const direct = req.socket.remoteAddress || '';
  if (HEADER) {
    const v = String(req.headers[HEADER] || '').split(',')[0].trim();
    if (v) return v;
  }
  if (HOPS > 0) {
    const list = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length) return list[Math.max(0, list.length - HOPS)];
  }
  return direct;
}

module.exports = { clientIp };
