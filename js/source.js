/*
 * サイトのデータの読み込み元
 * --------------------------------------------------
 * 1. Shopify が設定されていれば Shopify（商品＋公開中のイベント設定・配置）
 * 2. そうでなければ、このサイトのサーバー（npm start）に保存された公開中の設定（/api/published）
 * 3. URL に ?preview=draft が付いていて、管理画面にログイン中なら、下書きを重ねて表示（公開前の確認用）
 */
(function () {
  async function getJson(url, opts) {
    const res = await fetch(url, { credentials: 'same-origin', ...opts });
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    return res.json();
  }

  function showPreviewBanner(text) {
    const el = document.createElement('div');
    el.className = 'preview-banner';
    el.textContent = text;
    document.body.appendChild(el);
  }

  async function load() {
    const E = window.HaneulEvent;
    const onServer = /^https?:$/.test(location.protocol);

    if (window.ShopifyData?.enabled) {
      try { await window.ShopifyData.load(); } catch (err) {
        console.error('Shopify の読み込みに失敗したため、見本データで表示します', err);
      }
    } else if (onServer) {
      try {
        const pub = await getJson('/api/published');
        // 管理画面から一度でも公開していれば、その内容で表示する
        const hasEvent = pub.event && Object.values(pub.event).some((v) => v !== '' && v != null);
        if (hasEvent || pub.layout) {
          E.applyEvent(pub.event || {});
          E.applyLayout(pub.layout || null);
        }
      } catch { /* サーバーなし（静的ホスティングなど）なら data.js のまま */ }
    }

    if (onServer && new URLSearchParams(location.search).get('preview') === 'draft') {
      try {
        const st = await getJson('/admin/api/state', { headers: { 'x-haneul-admin': '1' } });
        E.applyEvent(st.draft.event || {});
        E.applyLayout(st.draft.layout || null);
        window.PREVIEW_MODE = true;
        showPreviewBanner('下書きのプレビュー中です（お客さんにはまだ表示されていません）');
      } catch {
        showPreviewBanner('下書きのプレビューには、管理画面へのログインが必要です');
      }
    }
  }

  window.DataSource = { load };
})();
