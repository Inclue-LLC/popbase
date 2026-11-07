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

  // 見本のお店（/demo）の内容。本番のイベントは読み込まない
  // 会期：見た日の前後1週間ずつ（日本時間 10:00 開始〜20:00 終了）。いつ見ても開催中になる
  const jstDay = (offsetDays, hm) => {
    const d = new Date(Date.now() + 9 * 3600e3 + offsetDays * 86400e3);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${hm}`;
  };
  const DEMO_EVENT = {
    brand: 'SAMPLE SHOP', title: '見本のお店',
    open_at: jstDay(-7, '10:00'), close_at: jstDay(7, '20:00'),
    novelty: 'on', novelty_name: 'アクリルキーホルダー', novelty_threshold: 5000,
    shipping_note: '会期終了後、順次発送します。',
    payment_text: 'クレジットカード、Apple Pay、Google Pay、PayPal、コンビニ決済、銀行振込をご利用いただけます。\n\n※コンビニ決済・銀行振込には、別途手数料が発生する場合があります。',
    left_label: 'ぬいぐるみ・キーホルダー', left_title: 'PLUSH & KEY HOLDER', right_label: '文具・雑貨', right_title: 'STATIONERY & GOODS',
    island_label: 'おすすめ', island_title: 'PICK UP',
  };
  function showDemoBanner() {
    const el = document.createElement('div');
    el.className = 'demo-bar';
    el.innerHTML = '<span class="db-long">これは見本のお店です。実際の商品の購入はできません。</span><span class="db-short">見本のお店です（購入はできません）</span><a href="/about">出品のご案内へ</a>';
    document.body.prepend(el);
    document.body.classList.add('is-demo');
  }

  async function load() {
    const E = window.HaneulEvent;
    if (window.DEMO) {
      showDemoBanner();
      E.applyEvent(DEMO_EVENT);
      E.applyLayout(null);
      return;
    }
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
    // サーバーには届いたが、お客さんに出すイベントが1つもない（予定もない）
    window.NO_EVENT = !!data && !previewId && !data.id;
    // お客さんに出しているイベント（カートがどのイベントのものかを覚えるのに使う。下書きの確認では使わない）
    window.EVENT_ID = !previewId && data?.id ? data.id : null;
    if (data?.visit) window.VISIT_RULES = data.visit; // 混雑中のお買い物時間（サーバーの設定）
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
