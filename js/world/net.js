/*
 * 同時接続クライアント（server/index.js と通信）
 * サーバーにつながらないときは「ひとりで見ている」状態で、そのまま店内を歩けます。
 */
export function resolveUrl() {
  const configured = window.SHOP.multiplayerUrl;
  if (configured) return configured;
  if (!/^https?:$/.test(location.protocol)) return null;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

export class Net {
  constructor(url, handlers) {
    this.url = url;
    this.h = handlers;
    this.ws = null;
    this.joinMsg = null;
    this.failures = 0;
    this.lastSent = 0;
    this.pending = null;
    this.closed = false;
  }

  connect(joinMsg) {
    this.joinMsg = joinMsg;
    if (!this.url) { this.h.status?.('offline'); return; }
    this.h.status?.('connecting');
    let ws;
    try { ws = new WebSocket(this.url); } catch { this.retry(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.failures = 0;
      ws.send(JSON.stringify({ t: 'join', ...this.joinMsg }));
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this.h.message?.(msg);
    };
    ws.onclose = () => {
      this.ws = null;
      this.h.disconnected?.();
      if (!this.closed) this.retry();
    };
    ws.onerror = () => ws.close();
  }

  retry() {
    this.failures++;
    if (this.failures > 4) { this.h.status?.('offline'); return; }
    this.h.status?.('connecting');
    setTimeout(() => this.connect(this.joinMsg), Math.min(15000, 1000 * 2 ** this.failures));
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** 位置は 1 秒あたり最大 10 回だけ送る */
  move(state, now) {
    const key = `${state.x.toFixed(2)},${state.z.toFixed(2)},${state.m}`;
    if (key === this.lastKey) return;
    if (now - this.lastSent < 100) return;
    this.lastKey = key;
    this.lastSent = now;
    this.send({ t: 'move', x: +state.x.toFixed(2), z: +state.z.toFixed(2), ry: +state.ry.toFixed(2), m: state.m });
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }
}
