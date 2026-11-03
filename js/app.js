(function () {
  const { SHOP, CHARACTERS, CATEGORIES, PRODUCTS, GACHA_PRIZES, Art } = window;
  const $ = (sel, root = document) => root.querySelector(sel);
  const yen = (n) => `¥${n.toLocaleString('ja-JP')}`;
  const charById = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
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
    char: 'all',
    cat: 'all',
    sort: 'recommend',
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

  /* ---------- 入口 ---------- */
  $('#entranceCast').innerHTML = CHARACTERS.map((c, i) =>
    `<div class="bob" style="animation-delay:${i * 0.25}s">${Art.characterSVG(c)}</div>`).join('');

  const entrance = $('#entrance');
  if (sessionStorageSafe('entered')) entrance.remove();
  $('#enterBtn')?.addEventListener('click', () => {
    entrance.classList.add('open');
    try { sessionStorage.setItem('haneul:entered', '1'); } catch { /* noop */ }
    setTimeout(() => entrance.remove(), 1400);
  });
  function sessionStorageSafe(key) {
    try { return sessionStorage.getItem(`haneul:${key}`) === '1'; } catch { return false; }
  }

  /* ---------- 絞り込み ---------- */
  function chip(group, id, label, active, extra = '') {
    return `<button class="chip ${active ? 'is-active' : ''}" data-group="${group}" data-id="${id}" aria-pressed="${active}" ${extra}>${label}</button>`;
  }
  function renderFilters() {
    $('#charChips').innerHTML = chip('char', 'all', 'すべて', state.char === 'all') +
      CHARACTERS.map((c) => chip('char', c.id,
        `<span class="chip-face">${Art.characterSVG(c)}</span>${c.name}`, state.char === c.id, `style="--c:${c.color}"`)).join('');
    $('#catChips').innerHTML = chip('cat', 'all', '全カテゴリ', state.cat === 'all') +
      chip('cat', 'limited', '会場限定', state.cat === 'limited') +
      CATEGORIES.map((c) => chip('cat', c.id, c.name, state.cat === c.id)).join('');
    $('#sortSelect').value = state.sort;

    const parts = [];
    if (state.char !== 'all') parts.push(`${charById[state.char].name}のブース`);
    if (state.cat === 'limited') parts.push('会場限定');
    else if (state.cat !== 'all') parts.push(CATEGORIES.find((c) => c.id === state.cat).name);
    $('#shelfTitle').textContent = parts.length ? parts.join(' / ') : 'すべての商品';
  }
  document.querySelector('.filters').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    state[b.dataset.group] = b.dataset.id;
    renderFilters();
    renderProducts();
  });
  $('#sortSelect').addEventListener('change', (e) => { state.sort = e.target.value; renderProducts(); });

  /* ---------- 商品一覧 ---------- */
  function badges(p) {
    const out = [];
    if (p.limited) out.push('<span class="badge badge-limited">会場限定</span>');
    if (p.isNew) out.push('<span class="badge badge-new">NEW</span>');
    if (p.stock === 0) out.push('<span class="badge badge-soldout">SOLD OUT</span>');
    else if (p.stock <= 5) out.push('<span class="badge badge-few">残りわずか</span>');
    return out.join('');
  }

  function renderProducts() {
    let list = PRODUCTS.filter((p) =>
      (state.char === 'all' || p.character === state.char) &&
      (state.cat === 'all' || (state.cat === 'limited' ? p.limited : p.category === state.cat)));
    const order = PRODUCTS.map((p) => p.id);
    const sorters = {
      recommend: (a, b) => (b.limited - a.limited) || order.indexOf(a.id) - order.indexOf(b.id),
      new: (a, b) => (!!b.isNew - !!a.isNew) || order.indexOf(a.id) - order.indexOf(b.id),
      priceAsc: (a, b) => a.price - b.price,
      priceDesc: (a, b) => b.price - a.price,
    };
    list = [...list].sort((a, b) => (a.stock === 0) - (b.stock === 0) || sorters[state.sort](a, b));

    $('#productGrid').innerHTML = list.map((p) => {
      const c = charById[p.character];
      return `
      <article class="card ${p.stock === 0 ? 'is-soldout' : ''}" style="--c:${c.color}">
        <button class="card-hit" data-open="${p.id}" aria-label="${p.name} の詳細を見る"></button>
        <div class="card-image">${Art.productSVG(p)}<div class="badges">${badges(p)}</div></div>
        <div class="card-body">
          <p class="card-char">${c.name}</p>
          <h3 class="card-name">${p.name}</h3>
          <div class="card-foot">
            <span class="price">${yen(p.price)}<small>税込</small></span>
            <button class="add-btn" data-add="${p.id}" ${p.stock === 0 ? 'disabled' : ''} aria-label="${p.name} をカートに入れる">＋</button>
          </div>
        </div>
      </article>`;
    }).join('');
    $('#emptyMsg').hidden = list.length > 0;
  }

  $('#productGrid').addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) return addToCart(add.dataset.add, 1, add);
    const open = e.target.closest('[data-open]');
    if (open) openProduct(open.dataset.open);
  });

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
    const c = charById[p.character];
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
    const target = $('#cartBtn');
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
    const shipping = subtotal === 0 || subtotal >= SHOP.freeShippingThreshold ? 0 : SHOP.shippingFee;
    return { lines, count, subtotal, coupon, discount, shipping, total: subtotal - discount + shipping };
  }

  function renderCart() {
    const t = totals();
    $('#cartCount').textContent = t.count;
    $('#cartCount').hidden = t.count === 0;
    const reg = $('#registerCount');
    if (reg) reg.textContent = t.count ? `バッグに ${t.count} 点` : '';

    const remain = SHOP.novelty.threshold - t.subtotal;
    const pct = Math.min(100, (t.subtotal / SHOP.novelty.threshold) * 100);
    $('#noveltyBar').innerHTML = `
      <p>${remain > 0 ? `あと <strong>${yen(remain)}</strong> で特典「${SHOP.novelty.name}」` : `🎉 特典「${SHOP.novelty.name}」が付きます`}</p>
      <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><span style="width:${pct}%"></span></div>`;

    $('#cartItems').innerHTML = t.lines.length ? t.lines.map(({ p, q }) => `
      <li class="cart-item" style="--c:${charById[p.character].color}">
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
        <div class="total"><dt>合計（税込）</dt><dd>${yen(t.total)}</dd></div>
      </dl>
      ${!t.coupon ? '<p class="hint">クーポンガチャで割引クーポンをゲットできます</p>' : ''}
      ${t.shipping ? `<p class="hint">あと ${yen(SHOP.freeShippingThreshold - t.subtotal)} で送料無料</p>` : ''}` : '';
    $('#checkoutBtn').disabled = t.lines.length === 0;
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

  $('#checkoutBtn').addEventListener('click', () => {
    const t = totals();
    if (!t.lines.length) return;
    for (const { p, q } of t.lines) p.stock = Math.max(0, p.stock - q);
    const orderNo = `HN-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    $('#doneText').innerHTML = `注文番号 <strong>${orderNo}</strong><br>${t.count} 点・合計 <strong>${yen(t.total)}</strong>` +
      (t.subtotal >= SHOP.novelty.threshold ? `<br>特典「${SHOP.novelty.name}」を同梱します。` : '');
    $('#doneCast').innerHTML = CHARACTERS.map((c, i) => `<div class="bob" style="animation-delay:${i * 0.2}s">${Art.characterSVG(c)}</div>`).join('');
    state.cart = {};
    if (t.coupon) { state.coupon = { ...t.coupon, date: 'used' }; store.set('coupon', state.coupon); }
    saveCart();
    renderProducts();
    window.Store?.render();
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
      if (!prev || prize.rate > prev.rate) state.coupon = { label: prize.label, rate: prize.rate, date: today() };
      store.set('coupon', state.coupon);
      store.set('lastSpin', today());
      renderCart();
      renderGachaState();
      toast(`🎉 ${prize.label} が当たりました！`);
    }, 1900);
  });

  /* ---------- キャラクター紹介 ---------- */
  $('#castGrid').innerHTML = CHARACTERS.map((c) => `
    <div class="cast-card" style="--c:${c.color}">
      ${Art.characterSVG(c)}
      <div><h4>${c.name}<small>${c.en}</small></h4><p>${c.profile}</p></div>
    </div>`).join('');

  /* ---------- トースト ---------- */
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  /* ---------- 店内（store.js）から呼ぶ関数 ---------- */
  window.App = {
    openProduct,
    openCart,
    refreshRegister: renderCart,
    showCharacter(id) {
      state.char = id;
      state.cat = 'all';
      renderFilters();
      renderProducts();
      $('#shop').scrollIntoView({ behavior: 'smooth' });
    },
  };

  renderFilters();
  renderProducts();
  renderCart();
  renderGachaState();
  window.Store.init();
})();
