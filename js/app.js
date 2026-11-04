/*
 * ページ全体の動き（商品一覧・商品詳細・カート・ガチャ）
 * Shopify が設定されていれば、まず Shopify から商品とイベント設定を読み込んでから表示します。
 */
window.AppReady = (async function () {
  await window.DataSource.load();
  const { SHOP, CHARACTERS, CATEGORIES, PRODUCTS, GACHA_PRIZES, Art } = window;
  const shopify = window.ShopifyData?.enabled ? window.ShopifyData : null;
  const $ = (sel, root = document) => root.querySelector(sel);
  const yen = (n) => `¥${n.toLocaleString('ja-JP')}`;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const charById = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
  const NO_CHAR = { id: '', name: '', color: '#e3e6f0' };
  const charOf = (p) => charById[p.character] || NO_CHAR;
  const productById = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));
  const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD

  /* ---------- 保存（localStorage は使えない環境もあるので必ず try/catch） ---------- */
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(`haneul:${key}`); return v ? JSON.parse(v) : fallback; }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(`haneul:${key}`, JSON.stringify(value)); } catch { /* noop */ }
    },
  };

  const state = {
    cart: store.get('cart', {}),
    coupon: store.get('coupon', null),
  };
  // 存在しない商品をカートから除外
  for (const id of Object.keys(state.cart)) if (!productById[id]) delete state.cart[id];

  const maxQty = (p) => Math.min(p.stock, p.limit || 10);
  const activeCoupon = () => (state.coupon && state.coupon.date === today() ? state.coupon : null);

  /* ---------- 共通テキスト ---------- */
  document.querySelectorAll('[data-bind]').forEach((el) => { el.textContent = SHOP[el.dataset.bind] ?? ''; });
  $('#noveltyInfo').textContent = `税込 ${yen(SHOP.novelty.threshold)} 以上お買い上げで「${SHOP.novelty.name}」をプレゼント。`;
  $('#shippingInfo').textContent = `全国一律 ${yen(SHOP.shippingFee)}。${yen(SHOP.freeShippingThreshold)} 以上で送料無料。`;

  /* ---------- 入口 ----------
   * 文字・画像・色は店内管理画面の「入口の画面」で設定（SHOP.entrance。js/event.js の applyEvent で反映）。
   * 管理画面のプレビュー（?entrance-preview=1）では、管理画面から届いた下書きをその場で表示する。 */
  const entrancePreview = new URLSearchParams(location.search).has('entrance-preview');
  const visibleChars = () => CHARACTERS.filter((c) => !c.hidden);

  function renderEntrance() {
    $('#entranceCast').innerHTML = visibleChars().map((c, i) =>
      `<div class="bob" style="animation-delay:${i * 0.25}s">${Art.characterSVG(c)}</div>`).join('');
    const el = $('#entrance');
    if (!el) return;
    const en = SHOP.entrance || {};
    const heading = en.heading || SHOP.brand;
    $('#entKicker').textContent = en.kicker || SHOP.title;
    $('#entHeading').textContent = heading;
    const logo = $('#entLogo');
    logo.hidden = !en.logo;
    $('#entHeading').hidden = !!en.logo;
    if (en.logo) { logo.src = en.logo; logo.alt = heading; }
    $('#entMessage').textContent = en.message || SHOP.themeLabel || '';
    $('#entPeriod').textContent = SHOP.period || '';
    $('#entNotice').textContent = en.notice || '';
    $('#entNotice').hidden = !en.notice;
    $('#enterBtn').textContent = en.button || 'お店に入る';
    $('#entranceCast').hidden = en.characters === 'hide';
    const bg = $('#entBg');
    bg.style.backgroundImage = en.image ? `url("${String(en.image).replace(/["\\\n]/g, '')}")` : '';
    el.classList.toggle('has-image', !!en.image);
    el.style.setProperty('--ent-ink', en.textColor || '');
    el.style.setProperty('--ent-heading', en.headingColor || '');
    if (!en.textColor) el.style.removeProperty('--ent-ink');
    if (!en.headingColor) el.style.removeProperty('--ent-heading');
    el.classList.add('is-ready');
  }
  renderEntrance();

  const entrance = $('#entrance');
  if (sessionStorageSafe('entered') && !entrancePreview) entrance.remove();
  $('#enterBtn')?.addEventListener('click', () => {
    if (entrancePreview) return; // 管理画面のプレビューでは入店しない
    entrance.classList.add('open');
    try { sessionStorage.setItem('haneul:entered', '1'); } catch { /* noop */ }
    setTimeout(() => entrance.remove(), 1400);
  });
  if (entrancePreview) {
    // 管理画面（同じサイトの親ウィンドウ）から届いた下書きを表示する
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin || e.source !== window.parent || e.data?.type !== 'haneul:entrance') return;
      window.HaneulEvent.applyEvent(e.data.event || {});
      renderEntrance();
      renderCast();
    });
    window.parent?.postMessage({ type: 'haneul:entrance-ready' }, location.origin);
  }
  function sessionStorageSafe(key) {
    try { return sessionStorage.getItem(`haneul:${key}`) === '1'; } catch { return false; }
  }

  /* ---------- 商品のバッジ ---------- */
  function badges(p) {
    const out = [];
    if (p.limited) out.push('<span class="badge badge-limited">会場限定</span>');
    if (p.isNew) out.push('<span class="badge badge-new">NEW</span>');
    if (p.stock === 0) out.push('<span class="badge badge-soldout">SOLD OUT</span>');
    else if (p.stock <= 5) out.push('<span class="badge badge-few">残りわずか</span>');
    return out.join('');
  }

  /* ---------- モーダル / ドロワー共通 ---------- */
  let lastFocus = null;
  function openLayer(el) {
    lastFocus = document.activeElement;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('is-open'));
    document.body.classList.add('no-scroll');
    (el.querySelector('[data-close].icon-btn') || el.querySelector('button'))?.focus();
  }
  function closeLayer(el) {
    el.classList.remove('is-open');
    setTimeout(() => { el.hidden = true; }, 250);
    if (!document.querySelector('.modal.is-open, .drawer.is-open')) document.body.classList.remove('no-scroll');
    lastFocus?.focus?.();
  }
  document.querySelectorAll('.modal, .drawer').forEach((layer) => {
    layer.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeLayer(layer); });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = [...document.querySelectorAll('.modal.is-open, .drawer.is-open')].pop();
    if (open) closeLayer(open);
  });

  /* ---------- 商品詳細 ---------- */
  let current = null;
  let qty = 1;
  function openProduct(id) {
    current = productById[id];
    const p = current;
    const c = charOf(p);
    qty = 1;
    $('#pmImage').innerHTML = Art.productSVG(p);
    $('#pmImage').style.setProperty('--c', c.color);
    $('#pmBadges').innerHTML = badges(p);
    $('#pmName').textContent = p.name;
    $('#pmPrice').innerHTML = `${yen(p.price)}<small>税込</small>`;
    $('#pmDesc').textContent = p.desc;
    $('#pmSpec').textContent = p.spec;
    syncDetail();
    openLayer($('#productModal'));
  }
  function syncDetail() {
    const p = current;
    const inCart = state.cart[p.id] || 0;
    const room = Math.max(0, maxQty(p) - inCart);
    qty = Math.max(1, Math.min(qty, room || 1));
    $('#pmQty').textContent = qty;
    $('#pmMinus').disabled = qty <= 1;
    $('#pmPlus').disabled = qty >= room;
    $('#pmAdd').disabled = room === 0;
    $('#pmAdd').textContent = p.stock === 0 ? '売り切れ' : room === 0 ? '上限まで追加済み' : 'カートに入れる';
    $('#pmStock').textContent = p.stock === 0 ? '在庫なし' : p.stock <= 5 ? `残り ${p.stock} 点` : '在庫あり';
    const notes = [];
    if (p.limit) notes.push(`お一人様 ${p.limit} 点まで`);
    if (inCart) notes.push(`カートに ${inCart} 点入っています`);
    $('#pmNote').textContent = notes.join('・');
  }
  $('#pmMinus').addEventListener('click', () => { qty--; syncDetail(); });
  $('#pmPlus').addEventListener('click', () => { qty++; syncDetail(); });
  $('#pmAdd').addEventListener('click', (e) => { addToCart(current.id, qty, e.currentTarget); syncDetail(); });

  /* ---------- カート ---------- */
  function addToCart(id, n, sourceEl) {
    const p = productById[id];
    const have = state.cart[id] || 0;
    const room = maxQty(p) - have;
    if (room <= 0) {
      return toast(p.limit && have >= p.limit ? `「${p.name}」はお一人様 ${p.limit} 点までです` : '在庫数を超えるため追加できません');
    }
    const added = Math.min(n, room);
    state.cart[id] = have + added;
    saveCart();
    flyToCart(sourceEl);
    toast(`「${p.name}」をカートに入れました${added < n ? `（上限のため ${added} 点）` : ''}`);
  }

  function flyToCart(el) {
    // 全画面のときは店内右上のカートボタンへ
    const target = document.body.classList.contains('world-fs') ? $('#hudCart') : $('#cartBtn');
    target.classList.remove('bump');
    void target.offsetWidth;
    target.classList.add('bump');
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const from = el.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const dot = document.createElement('div');
    dot.className = 'fly-dot';
    dot.style.left = `${from.left + from.width / 2}px`;
    dot.style.top = `${from.top + from.height / 2}px`;
    document.body.appendChild(dot);
    dot.animate([
      { transform: 'translate(-50%,-50%) scale(1)' },
      { transform: `translate(calc(-50% + ${to.left - from.left}px), calc(-50% + ${to.top - from.top}px)) scale(.4)`, opacity: 0.6 },
    ], { duration: 550, easing: 'cubic-bezier(.5,-0.3,.7,1)' }).onfinish = () => dot.remove();
  }

  function saveCart() {
    store.set('cart', state.cart);
    renderCart();
  }

  function totals() {
    const lines = Object.entries(state.cart).map(([id, q]) => ({ p: productById[id], q }));
    const count = lines.reduce((s, l) => s + l.q, 0);
    const subtotal = lines.reduce((s, l) => s + l.p.price * l.q, 0);
    const coupon = activeCoupon();
    const discount = coupon ? Math.floor((subtotal * coupon.rate) / 100) : 0;
    // Shopify 連携時は、送料・割引の最終額は Shopify の購入手続きで計算されます（ここでは目安）
    const shipping = subtotal === 0 || subtotal >= SHOP.freeShippingThreshold ? 0 : SHOP.shippingFee;
    return { lines, count, subtotal, coupon, discount, shipping, total: subtotal - discount + shipping };
  }

  function renderCart() {
    const t = totals();
    for (const id of ['#cartCount', '#hudCartCount']) {
      const el = $(id);
      if (!el) continue;
      el.textContent = t.count;
      el.hidden = t.count === 0;
    }

    const remain = SHOP.novelty.threshold - t.subtotal;
    const pct = Math.min(100, (t.subtotal / SHOP.novelty.threshold) * 100);
    $('#noveltyBar').innerHTML = `
      <p>${remain > 0 ? `あと <strong>${yen(remain)}</strong> で特典「${SHOP.novelty.name}」` : `🎉 特典「${SHOP.novelty.name}」が付きます`}</p>
      <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><span style="width:${pct}%"></span></div>`;

    $('#cartItems').innerHTML = t.lines.length ? t.lines.map(({ p, q }) => `
      <li class="cart-item" style="--c:${charOf(p).color}">
        <div class="ci-image">${Art.productSVG(p)}</div>
        <div class="ci-body">
          <p class="ci-name">${p.name}</p>
          <p class="ci-price">${yen(p.price)}</p>
          <div class="qty qty-sm">
            <button class="icon-btn" data-dec="${p.id}" aria-label="減らす">−</button>
            <output>${q}</output>
            <button class="icon-btn" data-inc="${p.id}" ${q >= maxQty(p) ? 'disabled' : ''} aria-label="増やす">＋</button>
          </div>
        </div>
        <button class="ci-remove" data-remove="${p.id}" aria-label="${p.name} を削除">削除</button>
      </li>`).join('') : `
      <li class="cart-empty">
        ${Art.characterSVG(CHARACTERS[0], 'empty-char')}
        <p>バッグはまだ空っぽです</p>
      </li>`;

    $('#cartSummary').innerHTML = t.lines.length ? `
      <dl>
        <div><dt>小計</dt><dd>${yen(t.subtotal)}</dd></div>
        ${t.coupon ? `<div class="discount"><dt>${t.coupon.label}</dt><dd>−${yen(t.discount)}</dd></div>` : ''}
        <div><dt>送料</dt><dd>${t.shipping ? yen(t.shipping) : '無料'}</dd></div>
        <div class="total"><dt>合計（税込）${shopify ? '<small>目安</small>' : ''}</dt><dd>${yen(t.total)}</dd></div>
      </dl>
      ${shopify ? '<p class="hint">送料・割引の最終金額は、次の購入手続き画面（Shopify）で確定します</p>' : ''}
      ${!t.coupon ? '<p class="hint">クーポンガチャで割引クーポンをゲットできます</p>' : ''}
      ${t.shipping ? `<p class="hint">あと ${yen(SHOP.freeShippingThreshold - t.subtotal)} で送料無料</p>` : ''}` : '';
    $('#checkoutBtn').disabled = t.lines.length === 0;
    document.dispatchEvent(new CustomEvent('haneul:cart', { detail: { count: t.count } }));
  }

  $('#cartItems').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.inc) addToCart(b.dataset.inc, 1);
    if (b.dataset.dec) { state.cart[b.dataset.dec]--; if (state.cart[b.dataset.dec] <= 0) delete state.cart[b.dataset.dec]; saveCart(); }
    if (b.dataset.remove) { delete state.cart[b.dataset.remove]; saveCart(); }
  });

  function openCart() { renderCart(); openLayer($('#cartDrawer')); }
  $('#cartBtn').addEventListener('click', openCart);

  if (shopify) $('#checkoutBtn').textContent = '購入手続きへ（Shopify）';
  $('#checkoutBtn').addEventListener('click', async () => {
    const t = totals();
    if (!t.lines.length) return;
    if (shopify) {
      const btn = $('#checkoutBtn');
      btn.disabled = true;
      btn.textContent = '購入手続きを準備しています…';
      try {
        const url = await shopify.checkout(t.lines.map(({ p, q }) => ({ variantId: p.variantId, quantity: q })), t.coupon?.code);
        window.location.href = url;
      } catch (err) {
        console.error(err);
        toast('購入手続きを開始できませんでした。時間をおいてもう一度お試しください');
        btn.disabled = false;
        btn.textContent = '購入手続きへ（Shopify）';
      }
      return;
    }
    for (const { p, q } of t.lines) p.stock = Math.max(0, p.stock - q);
    const orderNo = `HN-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    $('#doneText').innerHTML = `注文番号 <strong>${orderNo}</strong><br>${t.count} 点・合計 <strong>${yen(t.total)}</strong>` +
      (t.subtotal >= SHOP.novelty.threshold ? `<br>特典「${SHOP.novelty.name}」を同梱します。` : '');
    $('#doneCast').innerHTML = visibleChars().map((c, i) => `<div class="bob" style="animation-delay:${i * 0.2}s">${Art.characterSVG(c)}</div>`).join('');
    state.cart = {};
    if (t.coupon) { state.coupon = { ...t.coupon, date: 'used' }; store.set('coupon', state.coupon); }
    saveCart();
    window.World?.refresh();
    closeLayer($('#cartDrawer'));
    setTimeout(() => openLayer($('#doneModal')), 260);
  });

  /* ---------- ガチャ ---------- */
  const totalWeight = GACHA_PRIZES.reduce((s, p) => s + p.weight, 0);
  $('#gachaOdds').innerHTML = GACHA_PRIZES.map((p) =>
    `<li><span>${p.label}</span><span>${Math.round((p.weight / totalWeight) * 100)}%</span></li>`).join('');
  const capsuleColors = ['#8fc8f0', '#ffd76a', '#c9b8f0', '#f2b8a0', '#ffb3c6', '#a8e0c0'];
  $('#capsules').innerHTML = Array.from({ length: 14 }, (_, i) => {
    // ドームの底から積み重なるように配置（5・5・4 個）
    const row = Math.floor(i / 5);
    const x = 6 + (i % 5) * 17 + (row % 2) * 8 + ((i * 7) % 5);
    const y = 76 - row * 16 + ((i * 11) % 6);
    return `<span class="capsule" style="--cc:${capsuleColors[i % capsuleColors.length]};left:${x}%;top:${y}%;--r:${(i * 47) % 360}deg"></span>`;
  }).join('');

  function lastSpin() { return store.get('lastSpin', null); }
  function renderGachaState() {
    const c = activeCoupon();
    const btn = $('#gachaBtn');
    const spunToday = lastSpin() === today();
    btn.disabled = spunToday;
    if (spunToday) {
      $('#gachaResult').innerHTML = c
        ? `今日のクーポン：<strong>${c.label}</strong>（カートで自動適用されます）`
        : '今日のガチャは終了しました。また明日回してね！';
      if (!$('#gachaReset')) {
        $('#gachaResult').insertAdjacentHTML('afterend',
          '<button class="link-btn" id="gachaReset">（デモ用）もう一度回せるようにする</button>');
        $('#gachaReset').addEventListener('click', () => {
          store.set('lastSpin', null);
          $('#gachaReset').remove();
          $('#capsuleOut').className = 'capsule-out';
          renderGachaState();
        });
      }
    } else {
      $('#gachaResult').textContent = 'ハンドルをクリックして回してね';
    }
  }

  $('#gachaBtn').addEventListener('click', () => {
    if (lastSpin() === today()) return;
    let r = Math.random() * totalWeight;
    const prize = GACHA_PRIZES.find((p) => (r -= p.weight) < 0) || GACHA_PRIZES[0];
    const machine = $('#machine');
    const out = $('#capsuleOut');
    $('#gachaBtn').disabled = true;
    machine.classList.add('spinning');
    out.className = 'capsule-out';
    out.style.setProperty('--cc', capsuleColors[Math.floor(Math.random() * capsuleColors.length)]);
    $('#gachaResult').textContent = 'ガラガラ…';
    setTimeout(() => {
      machine.classList.remove('spinning');
      out.classList.add('drop');
    }, 1100);
    setTimeout(() => {
      out.classList.add('open');
      // より良いクーポンを持っていればそちらを残す
      const prev = activeCoupon();
      if (!prev || prize.rate > prev.rate) state.coupon = { label: prize.label, rate: prize.rate, code: prize.code, date: today() };
      store.set('coupon', state.coupon);
      store.set('lastSpin', today());
      renderCart();
      renderGachaState();
      toast(`🎉 ${prize.label} が当たりました！`);
    }, 1900);
  });

  /* ---------- キャラクター紹介 ---------- */
  function renderCast() {
    $('#castGrid').innerHTML = visibleChars().map((c) => `
    <div class="cast-card" style="--c:${c.color}">
      ${Art.characterSVG(c)}
      <div><h4>${esc(c.name)}<small>${esc(c.en)}</small></h4><p>${esc(c.profile)}</p></div>
    </div>`).join('');
  }
  renderCast();

  /* ---------- トースト ---------- */
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  /* ---------- 3D 店内（js/world/）から呼ぶ関数 ---------- */
  window.App = {
    openProduct,
    openCart,
    toast,
    cartCount: () => totals().count,
    isLayerOpen: () => !!document.querySelector('.modal.is-open, .drawer.is-open'),
    openGacha() { renderGachaState(); openLayer($('#gachaModal')); },
    // 壁のキャラクターに話しかけたとき
    showCharacter(id) {
      const c = charById[id];
      if (c) toast(`${c.name}：${c.profile}`);
    },
  };

  renderCart();
  renderGachaState();
  return window.App;
})();
