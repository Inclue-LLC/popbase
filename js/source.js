/*
 * サイトのデータの読み込み元
 * --------------------------------------------------
 * 1. イベントの設定と棚の配置：このサイトのサーバー（/api/published）。お客さんに出すイベントは会期で自動で決まる
 *    URL に ?preview=draft&event=ID が付いていて、管理画面にログイン中なら、そのイベントの下書き（公開前の確認用）
 * 2. 商品：Shopify が設定されていれば、イベントで選んだコレクションの商品。なければ js/data.js の見本
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
    const params = new URLSearchParams(location.search);
    const previewId = params.get('preview') === 'draft' ? params.get('event') || '' : '';

    // 1. イベントの設定：お客さんに出すイベント（会期で自動）／下書きの確認なら、そのイベントの下書き
    let data = null;
    if (onServer) {
      if (previewId) {
        try {
          data = await getJson(`/admin/api/preview?event=${encodeURIComponent(previewId)}`, { headers: { 'x-haneul-admin': '1' } });
          window.PREVIEW_MODE = true;
          showPreviewBanner('下書きのプレビュー中です（お客さんにはまだ表示されていません）');
        } catch {
          showPreviewBanner('下書きのプレビューには、管理画面へのログインが必要です');
        }
      }
      if (!data) {
        try { data = await getJson('/api/published'); } catch { /* サーバーなし（静的ホスティングなど）なら data.js のまま */ }
      }
    }
    const event = data?.event || {};
    const hasEvent = Object.values(event).some((v) => v !== '' && v != null);

    // 2. 商品：Shopify につないでいれば、イベントで選んだコレクションの商品
    if (window.ShopifyData?.enabled) {
      try { await window.ShopifyData.load(event.collection); } catch (err) {
        console.error('Shopify の読み込みに失敗したため、見本データで表示します', err);
      }
    }

    // 3. 設定と棚の配置を反映（商品を読み込んだあとに）
    if (hasEvent || data?.layout) {
      E.applyEvent(event);
      E.applyLayout(data.layout || null);
    }
  }

  window.DataSource = { load };
})();
