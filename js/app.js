/*
 * ページ全体の動き（入口・商品詳細・カート・退店）
 * Shopify が設定されていれば、まず Shopify から商品とイベント設定を読み込んでから表示します。
 */
window.AppReady = (async function () {
  await window.DataSource.load();
  const { SHOP, CHARACTERS, CATEGORIES, PRODUCTS, Art } = window;
  const shopify = window.ShopifyData?.enabled ? window.ShopifyData : null;
  const $ = (sel, root = document) => root.querySelector(sel);
  const yen = (n) => `¥${n.toLocaleString('ja-JP')}`;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const charById = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
  const NO_CHAR = { id: '', name: '', color: '#e6dcf3' }; // キャラクターのない商品（他社の商品など）の背景はラベンダー
  const charOf = (p) => charById[p.character] || NO_CHAR;
  const productById = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));

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
  };
  // 存在しない商品をカートから除外
  for (const id of Object.keys(state.cart)) if (!productById[id]) delete state.cart[id];

  const maxQty = (p) => Math.min(p.stock, p.limit || 10);

  /* ---------- 共通テキスト ---------- */
  document.querySelectorAll('[data-bind]').forEach((el) => { el.textContent = SHOP[el.dataset.bind] ?? ''; });
  // ブラウザのタブ：お店の名前｜オンラインポップアップショップ（イベントのブランド名は出さない）
  document.title = SHOP.tagline ? `${SHOP.title} | ${SHOP.tagline}` : SHOP.title;
  // 購入特典（管理画面で特典の名前が空欄なら表示しない）
  if (SHOP.novelty) $('#noveltyInfo').textContent = `税込 ${yen(SHOP.novelty.threshold)} 以上お買い上げで「${SHOP.novelty.name}」をプレゼント。`;
  else $('#noveltyInfo').closest('.info-card').hidden = true;
  renderShippingInfo();

  /* ---------- フッター：規約・ポリシー ----------
   * Shopify 管理画面「設定 → ポリシー」で作ったページ（https://ストア/policies/…）へのリンク。
   * Shopify につないでいないお試し表示では、リンクを出さずに「デモです」の注意書きを出す */
  {
    const domain = window.SHOPIFY_CONFIG?.domain;
    const links = $('#footerLinks');
    if (shopify && domain && links) {
      links.querySelectorAll('[data-policy]').forEach((a) => {
        a.href = `https://${domain}/policies/${a.dataset.policy}`;
        a.target = '_blank';
        a.rel = 'noopener';
      });
    } else if (links) links.hidden = true;
    const demo = $('#demoNote');
    if (demo) demo.hidden = !!shopify;

    // サーバーが Shopify からポリシーの文章を読めたら、リンクを押したときに POP BASE の中で開く
    // （読めないとき＝権限がない・未入力などは、上の Shopify のページへのリンクのまま）
    if (shopify && links && /^https?:$/.test(location.protocol)) {
      fetch('/api/policies').then((r) => r.json()).then(({ policies = [] }) => {
        const byType = Object.fromEntries(policies.map((p) => [p.type, p]));
        links.addEventListener('click', (e) => {
          const a = e.target.closest('[data-policy]');
          const p = a && byType[a.dataset.policy];
          if (!p) return;
          e.preventDefault();
          $('#policyTitle').textContent = a.textContent.trim() || p.title;
          $('#policyBody').replaceChildren(safePolicyHtml(p.body));
          openLayer($('#policyModal'));
          $('#policyModal .modal-card').scrollTop = 0;
        });
      }).catch(() => { /* そのままリンクで開く */ });
    }
  }
  /* 入口の「ご利用案内を見る」：ご案内（INFORMATION）の枠をそのまま写して表示 */
  $('#entInfoBtn')?.addEventListener('click', () => {
    const grid = document.querySelector('#info .info-grid').cloneNode(true);
    grid.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    grid.querySelectorAll('.info-card[hidden]').forEach((el) => el.remove());
    $('#infoModalBody').replaceChildren(grid);
    openLayer($('#infoModal'));
    $('#infoModal .modal-card').scrollTop = 0;
  });

  /** Shopify のポリシーの文章（HTML）から、スクリプトなど表示に不要なものを取り除く */
  function safePolicyHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    doc.querySelectorAll('script, style, iframe, object, embed, form, link, meta').forEach((n) => n.remove());
    doc.body.querySelectorAll('*').forEach((el) => {
      for (const at of [...el.attributes]) {
        const v = at.value.trim().toLowerCase();
        if (at.name.startsWith('on') || ((at.name === 'href' || at.name === 'src') && v.startsWith('javascript:'))) el.removeAttribute(at.name);
      }
      if (el.tagName === 'A') { el.target = '_blank'; el.rel = 'noopener'; }
    });
    const frag = document.createDocumentFragment();
    frag.append(...doc.body.childNodes);
    return frag;
  }
  function renderShippingInfo() {
    // 送料・発送（店内管理画面の「送料・発送」で設定。送料無料になる金額が 0 なら送料無料なし）
    // 送料の文は管理画面で入力（未入力のとき＝お試し表示だけ、初期の送料から作る）
    const free = SHOP.freeShippingThreshold > 0;
    $('#shippingInfo').textContent = SHOP.shippingText || (!SHOP.shippingFee ? '送料無料。'
      : `全国一律 ${yen(SHOP.shippingFee)}。${free ? `${yen(SHOP.freeShippingThreshold)} 以上で送料無料。` : ''}`);
    $('#shippingNote').textContent = SHOP.shippingNote || '';
    $('#shippingNote').closest('.info-card').hidden = !SHOP.shippingNote;
    $('#paymentInfo').textContent = SHOP.paymentText || '';
    $('#paymentInfo').closest('.info-card').hidden = !SHOP.paymentText;
    $('#returnInfo').textContent = SHOP.returnText || '';
    $('#returnInfo').closest('.info-card').hidden = !SHOP.returnText;
    // 混雑時の入店（店内の上限人数・混雑中のお買い物時間）
    const rules = window.VISIT_RULES || { minutes: 30, warnMinutes: 5 };
    $('#crowdInfo').textContent = `店内に同時に入れるのは ${SHOP.capacity || 50} 名までです。満員のときは、入口で順番にお待ちいただきます。\n`
      + `順番を待っている方がいる間は、お一人様のお買い物時間は ${rules.minutes} 分までとなります。時間になると自動で退店となり、カートの中身は空になりますので、お会計はお早めにお済ませください。`;
  }

  /* ---------- 入口 ----------
   * 文字・画像・色は店内管理画面の「入口の画面」で設定（SHOP.entrance。js/event.js の applyEvent で反映）。
   * 管理画面のプレビュー（?entrance-preview=1）では、管理画面から届いた下書きをその場で表示する。 */
  const entrancePreview = new URLSearchParams(location.search).has('entrance-preview');
  const visibleChars = () => window.CAST || []; // このイベントのキャラクター（管理画面の「キャラクター」タブ）

  function renderEntrance() {
    $('#entranceCast').innerHTML = visibleChars().map((c, i) =>
      `<div class="bob" style="animation-delay:${i * 0.25}s">${Art.characterSVG(c)}</div>`).join('');
    const el = $('#entrance');
    if (!el) return;
    const en = SHOP.entrance || {};
    const heading = en.heading || SHOP.brand;
    $('#entKicker').textContent = en.kicker || SHOP.title;
    // 上の小さい文字を設定していなければ、お店のロゴ（マーク＋POP BASE）を出す
    $('#entBrand').classList.toggle('is-text', !!en.kicker);
    $('#entHeading').textContent = heading;
    const logo = $('#entLogo');
    logo.hidden = !en.logo;
    $('#entHeading').hidden = !!en.logo;
    if (en.logo) { logo.src = en.logo; logo.alt = heading; }
    $('#entMessage').textContent = en.message || SHOP.themeLabel || '';
    $('#entPeriod').textContent = [SHOP.period, SHOP.hours].filter(Boolean).join('\n');
    $('#entNotice').textContent = en.notice || '';
    $('#entNotice').hidden = !en.notice;
    $('#enterBtn').textContent = en.button || 'お店に入る';
    $('#entranceCast').hidden = en.characters === 'hide' || !visibleChars().length;
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

  /* ---------- 入店の手続き（入場制限・待機・お買い物時間。js/visit.js） ---------- */
  const entrance = $('#entrance');
  const Visit = window.Visit;
  const enterBtn = $('#enterBtn');
  const enterLabel = () => (SHOP.entrance?.button || 'お店に入る');

  function hideEntrance({ animate = true } = {}) {
    entrance.classList.remove('is-waiting');
    $('#entWait').hidden = true;
    if (!animate) { entrance.classList.add('is-hidden'); return; }
    entrance.classList.add('open');
    setTimeout(() => { entrance.classList.add('is-hidden'); entrance.classList.remove('open'); }, 1400);
  }
  // ended: 'timeout'（お買い物時間が終了）| 'exit'（EXIT から退店）| false
  function showEntrance({ ended = false } = {}) {
    entrance.classList.remove('is-hidden', 'open', 'is-waiting', 'is-picking');
    $('#entPick').hidden = true;
    $('#entEnded').hidden = !ended;
    if (ended === 'exit') {
      $('#entEndedTitle').textContent = 'ご来店ありがとうございました';
      $('#entEndedText').textContent = 'またのお越しをお待ちしています。';
    } else if (ended === 'closed') {
      $('#entEndedTitle').textContent = '閉店時間になりました';
      $('#entEndedText').textContent = 'ご来店ありがとうございました。カートの中身は空になりました。';
    } else if (ended) {
      $('#entEndedTitle').textContent = 'お買い物時間が終了しました';
      $('#entEndedText').textContent = 'ご来店ありがとうございました。カートの中身は空になりました。';
    }
    $('#entWait').hidden = true;
    enterBtn.disabled = false;
    enterBtn.textContent = ended === 'exit' ? 'もう一度入店する' : ended ? 'もう一度並ぶ' : enterLabel();
  }
  function requestEntry() {
    enterBtn.disabled = true;
    enterBtn.textContent = '入店の手続き中…';
    Visit.start();
  }

  /* ---------- 入店するときのアバター選び ---------- */
  const LOOK_KEY = 'haneul:look';
  let pickSel = null;
  function renderEntrancePick() {
    const escAttr = (v) => String(v).replace(/[&<>"']/g, '');
    $('#entPickGrid').innerHTML = window.AVATARS.map((a) => `
      <button type="button" class="pick-char" role="radio" data-avatar="${escAttr(a.id)}" aria-checked="${a.id === pickSel}"
        style="--c:${a.character ? a.character.color : '#e3e6f0'}${a.character?.cardBg ? `;--card-bg:${a.character.cardBg}` : ''}">
        ${Art.characterSVG(a.character || { image: a.image })}<span>${esc(a.name)}</span></button>`).join('');
  }
  function openEntrancePick() {
    // 入店のたびに、いちばん左のアバターを選んだ状態から（前回選んだものは引き継がない）
    pickSel = window.AVATARS[0].id;
    renderEntrancePick();
    entrance.classList.add('is-picking');
    $('#entPick').hidden = false;
    $('#entPickGo').focus({ preventScroll: true });
  }
  function closeEntrancePick() {
    entrance.classList.remove('is-picking');
    $('#entPick').hidden = true;
  }

  if (!entrancePreview) {
    enterBtn.addEventListener('click', () => {
      $('#entEnded').hidden = true;
      openEntrancePick();
    });
    $('#entPickGrid').addEventListener('click', (e) => {
      const b = e.target.closest('[data-avatar]');
      if (!b) return;
      pickSel = b.dataset.avatar;
      renderEntrancePick();
    });
    $('#entPickBack').addEventListener('click', () => { closeEntrancePick(); enterBtn.focus(); });
    $('#entPickGo').addEventListener('click', () => {
      try { localStorage.setItem(LOOK_KEY, JSON.stringify({ avatar: pickSel })); } catch { /* noop */ }
      // 店内（js/world/main.js）に選んだアバターを知らせる
      document.dispatchEvent(new CustomEvent('haneul:look', { detail: { avatar: pickSel } }));
      closeEntrancePick();
      requestEntry();
    });

    Visit.on('queued', (q) => {
      entrance.classList.remove('is-hidden', 'open');
      entrance.classList.add('is-waiting');
      $('#entWait').hidden = false;
      $('#ewAhead').textContent = q.ahead;
      $('#ewEst').textContent = q.estimateMinutes ? `目安：約 ${q.estimateMinutes} 分` : 'まもなく入店できます';
    });
    Visit.on('admitted', (info) => {
      const wasWaiting = entrance.classList.contains('is-waiting');
      try { sessionStorage.setItem('haneul:entered', '1'); } catch { /* noop */ }
      hideEntrance({ animate: !autoResumed || wasWaiting });
      autoResumed = false;
      if (wasWaiting) toast('お待たせしました！ ご入店ください');
      if (info.crowded && !info.offline) {
        setTimeout(() => toast(`混雑中のため、お買い物時間は ${info.visitMinutes} 分です（終了 ${info.warnMinutes} 分前からタイマーが出ます）`), wasWaiting ? 2600 : 600);
      }
    });
    Visit.on('closed', () => {
      // サーバーが「営業時間外」と判断したとき（開店前・営業終了・会期終了）
      entrance.classList.remove('is-hidden', 'open', 'is-waiting', 'is-picking');
      $('#entWait').hidden = true;
      $('#entPick').hidden = true;
      enterBtn.disabled = false;
      enterBtn.textContent = enterLabel();
      serverClosedAt = Date.now();
      renderStoreStatus();
    });
    Visit.on('timeout', (m = {}) => {
      // 時間切れ：開いている画面を閉じ、カートを空にして入口へ
      document.querySelectorAll('.modal.is-open, .drawer.is-open').forEach((el) => closeLayer(el));
      state.cart = {};
      saveCart();
      try { sessionStorage.removeItem('haneul:entered'); } catch { /* noop */ }
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      document.body.classList.remove('world-fs', 'no-scroll');
      showEntrance({ ended: m.reason === 'closed' ? 'closed' : 'timeout' });
      renderStoreStatus();
    });
    Visit.on('timer', () => updateTimer());

    // 再読み込みのときは、前の入店券で自動的に続きから（30秒以内なら席・順番・残り時間がそのまま）
    var autoResumed = false;
    if (Visit.hasTicket() || sessionStorageSafe('entered')) {
      autoResumed = true;
      requestEntry();
    }
  }

  /* ---------- 会期・営業時間（js/schedule.js）：入口と店内の表示 ---------- */
  const HS = window.HaneulSchedule;
  let lastOpen = null;
  let serverClosedAt = 0; // サーバーから「営業時間外」と言われた時刻（1分間はそれに従う）
  let countdownTo = null; // 次のイベントのオープン時刻（カウントダウン中だけ）
  function renderStoreStatus() {
    if (entrancePreview) return;
    const serverSaysClosed = Visit.state === 'closed' && Date.now() - serverClosedAt < 60e3;
    const st = HS.status(SHOP.schedule || {});
    const open = st.state === 'open' && !serverSaysClosed;
    // 開催中のイベントも次の予定もない（イベントが1つもない／最後のイベントが終わった）：POP BASE だけの画面
    // （次のイベントが予定されていれば、サーバーはそのイベントを返すので、ここには来ない）
    const idle = !window.PREVIEW_MODE && (window.NO_EVENT || st.state === 'ended');
    entrance.classList.toggle('is-idle', idle);
    $('#entIdle').hidden = !idle;
    document.body.classList.toggle('shop-idle', idle);
    entrance.classList.toggle('is-closed', !open);
    $('#entStatus').hidden = open || idle;
    countdownTo = null;
    if (!open && !idle) {
      const s2 = serverSaysClosed && st.state === 'open' ? { state: 'closed' } : st;
      const when = s2.opensAt ? HS.whenText(s2.opensAt) : '';
      if (s2.state === 'before') {
        // 次のイベント：オープンまでのカウントダウン
        $('#entStatusTitle').textContent = 'オープンまで';
        $('#entStatusText').textContent = `${when} オープン`;
        countdownTo = s2.opensAt;
      } else if (s2.state === 'closed') {
        $('#entStatusTitle').textContent = '本日の営業は終了しました';
        $('#entStatusText').textContent = when ? `次は ${when} オープンです` : '';
      } else {
        $('#entStatusTitle').textContent = 'このポップアップは終了しました';
        $('#entStatusText').textContent = 'たくさんのご来店ありがとうございました';
      }
    }
    // 開店時刻になったら、入口で待っている人に知らせる
    if (lastOpen === false && open && !entrance.classList.contains('is-hidden')) toast('オープンしました！ ご入店いただけます');
    lastOpen = open;
    // 店内の右上：今日の閉店時刻
    const hh = $('#hudHours');
    if (hh) {
      const closes = st.state === 'open' ? st.closesAt : null;
      hh.hidden = !closes;
      if (closes) {
        const w = HS.whenText(closes);
        hh.textContent = w.startsWith('本日') ? `本日 ${HS.timeText(closes)} 閉店` : `${w} 閉店`;
      }
    }
  }
  /* オープンまでのカウントダウン（1秒ごと）。0 になったら入口の表示を「オープン」に切り替える */
  function tickCountdown() {
    const box = $('#entCountdown');
    if (!countdownTo) { box.hidden = true; return; }
    const ms = countdownTo - Date.now();
    if (ms <= 0) { countdownTo = null; box.hidden = true; renderStoreStatus(); return; }
    box.hidden = false;
    const s = Math.floor(ms / 1000);
    $('#cdD').textContent = Math.floor(s / 86400);
    $('#cdH').textContent = String(Math.floor(s / 3600) % 24).padStart(2, '0');
    $('#cdM').textContent = String(Math.floor(s / 60) % 60).padStart(2, '0');
    $('#cdS').textContent = String(s % 60).padStart(2, '0');
  }
  renderStoreStatus();
  tickCountdown();
  setInterval(renderStoreStatus, 15000);
  setInterval(tickCountdown, 1000);

  /* ---------- お買い物時間の残り（終了5分前から表示） ---------- */
  let warned = { five: false, one: false };
  function updateTimer() {
    const el = $('#visitTimer');
    const dl = Visit?.deadline;
    const warnMs = (Visit?.info?.warnMinutes || 5) * 60e3;
    if (!dl) { el.hidden = true; warned = { five: false, one: false }; return; }
    const rem = Math.max(0, dl - Date.now());
    if (rem > warnMs) { el.hidden = true; return; }
    el.hidden = false;
    const sec = Math.ceil(rem / 1000);
    const closing = Visit.reason === 'closing';
    el.firstChild.textContent = closing ? '閉店まで ' : 'お買い物時間 残り ';
    $('#visitTimerText').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    el.classList.toggle('is-urgent', rem <= 60e3);
    if (!warned.five) {
      warned.five = true;
      toast(closing
        ? `まもなく閉店です（あと ${Math.ceil(rem / 60e3)} 分）。お会計はお早めにお願いします`
        : `お買い物時間は残り ${Math.ceil(rem / 60e3)} 分です。お会計はお早めにお願いします`);
    }
    if (!warned.one && rem <= 60e3) { warned.one = true; toast('残り1分です。時間になると自動で退店し、カートは空になります'); }
  }
  setInterval(updateTimer, 500);

  if (entrancePreview) {
    // 管理画面（同じサイトの親ウィンドウ）から届いた下書きを表示する
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin || e.source !== window.parent || e.data?.type !== 'haneul:entrance') return;
      window.HaneulEvent.applyEvent(e.data.event || {});
      renderEntrance();
      renderCast();
      applyCharacterSizes();
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
    clearTimeout(el._hideTimer); // 閉じた直後に開き直したとき、閉じる処理で隠れないように
    lastFocus = document.activeElement;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('is-open'));
    document.body.classList.add('no-scroll');
    (el.querySelector('[data-close].icon-btn') || el.querySelector('button'))?.focus();
  }
  function closeLayer(el) {
    el.classList.remove('is-open');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => { el.hidden = true; }, 250);
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
    // 管理画面で背景色を指定していれば、その色にする
    $('#pmImage').style.background = SHOP.productBg || window.THEMES[SHOP.theme]?.productBg || '';
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
    // Shopify 連携時は、送料の最終額は Shopify の購入手続きで計算されます（ここでは目安）
    const free = SHOP.freeShippingThreshold > 0 && subtotal >= SHOP.freeShippingThreshold;
    const shipping = subtotal === 0 || free ? 0 : SHOP.shippingFee;
    return { lines, count, subtotal, shipping, free, total: subtotal + shipping };
  }

  function renderCart() {
    const t = totals();
    for (const id of ['#cartCount', '#hudCartCount']) {
      const el = $(id);
      if (!el) continue;
      el.textContent = t.count;
      el.hidden = t.count === 0;
    }

    const nov = SHOP.novelty;
    $('#noveltyBar').hidden = !nov;
    const remain = nov ? nov.threshold - t.subtotal : 0;
    const pct = nov ? Math.min(100, (t.subtotal / nov.threshold) * 100) : 0;
    if (nov) $('#noveltyBar').innerHTML = `
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
        <p>カートは空です</p>
      </li>`;

    $('#cartSummary').innerHTML = t.lines.length ? `
      <dl>
        <div><dt>小計</dt><dd>${yen(t.subtotal)}</dd></div>
        <div><dt>送料</dt><dd>${t.free ? '無料' : shopify ? 'お会計時に計算' : t.shipping ? yen(t.shipping) : '無料'}</dd></div>
        <div class="total"><dt>${shopify && !t.free ? '合計（税込・送料別）' : '合計（税込）'}</dt><dd>${yen(shopify && !t.free ? t.subtotal : t.total)}</dd></div>
      </dl>
      ${shopify && !t.free ? '<p class="hint">送料は、次の購入手続き画面で計算されます</p>' : ''}
      ${!t.free && SHOP.freeShippingThreshold > 0 ? `<p class="hint">あと ${yen(SHOP.freeShippingThreshold - t.subtotal)} で送料無料</p>` : ''}` : '';
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

  if (shopify) $('#checkoutBtn').textContent = '購入手続きへ';
  $('#checkoutBtn').addEventListener('click', async () => {
    const t = totals();
    if (!t.lines.length) return;
    if (shopify) {
      const btn = $('#checkoutBtn');
      btn.disabled = true;
      btn.textContent = '購入手続きを準備しています…';
      try {
        const { url, cartId } = await shopify.checkout(t.lines.map(({ p, q }) => ({ variantId: p.variantId, quantity: q })));
        // お会計から戻ってきたときに、注文が完了したかを確かめるため、Shopify のカートを覚えておく
        try { localStorage.setItem(PENDING_KEY, JSON.stringify({ cartId, at: Date.now() })); } catch { /* noop */ }
        window.location.href = url;
      } catch (err) {
        console.error(err);
        toast('購入手続きを開始できませんでした。時間をおいてもう一度お試しください');
        btn.disabled = false;
        btn.textContent = '購入手続きへ';
      }
      return;
    }
    for (const { p, q } of t.lines) p.stock = Math.max(0, p.stock - q);
    const orderNo = `HN-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    $('#doneText').innerHTML = `注文番号 <strong>${orderNo}</strong><br>${t.count} 点・合計 <strong>${yen(t.total)}</strong>` +
      (SHOP.novelty && t.subtotal >= SHOP.novelty.threshold ? `<br>特典「${SHOP.novelty.name}」を同梱します。` : '');
    $('#doneCast').innerHTML = visibleChars().map((c, i) => `<div class="bob" style="animation-delay:${i * 0.2}s">${Art.characterSVG(c)}</div>`).join('');
    state.cart = {};
    saveCart();
    window.World?.refresh();
    closeLayer($('#cartDrawer'));
    setTimeout(() => openLayer($('#doneModal')), 260);
  });

  /*
   * お会計（Shopify）で注文が完了したら、POP BASE のカートを空にする
   * 「購入手続きへ」で作った Shopify のカートは、注文が完了すると Shopify から消える。
   * このページを開いたとき・ほかのタブから戻ってきたときに確かめ、消えていればカートを空にする。
   * （3日以上前のものは確かめずに忘れる：Shopify のカートの期限切れと区別できないため）
   */
  const PENDING_KEY = 'haneul:pendingCheckout';
  let checkingOrder = false;
  async function checkFinishedOrder() {
    if (!shopify?.cartState || checkingOrder) return;
    let pending = null;
    try { pending = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch { /* noop */ }
    if (!pending?.cartId) return;
    if (Date.now() - (pending.at || 0) > 3 * 86400e3) { try { localStorage.removeItem(PENDING_KEY); } catch { /* noop */ } return; }
    checkingOrder = true;
    const st = await shopify.cartState(pending.cartId);
    checkingOrder = false;
    if (st !== 'gone') return; // まだ注文していない（または通信できなかった）ときは、カートはそのまま
    try { localStorage.removeItem(PENDING_KEY); } catch { /* noop */ }
    if (!Object.keys(state.cart).length) return;
    state.cart = {};
    saveCart();
    toast('ご注文ありがとうございました。カートを空にしました');
  }
  checkFinishedOrder();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkFinishedOrder(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) checkFinishedOrder(); }); // ブラウザの「戻る」で戻ってきたとき

  /* ---------- 退店（店内の EXIT から） ---------- */
  function confirmExit() {
    const n = totals().count;
    $('#exitText').innerHTML = n
      ? `カートに入っている商品（<strong>${n} 点</strong>）は<strong>空になります</strong>。<br>お会計がまだの場合は、先にレジでお会計をお済ませください。`
      : 'カートは空です。';
    openLayer($('#exitModal'));
  }
  $('#exitConfirm').addEventListener('click', () => {
    closeLayer($('#exitModal'));
    state.cart = {};
    saveCart();
    Visit.leave(); // 席をすぐ空ける
    try { sessionStorage.removeItem('haneul:entered'); } catch { /* noop */ }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    document.body.classList.remove('world-fs', 'no-scroll');
    showEntrance({ ended: 'exit' });
  });

  const inkFor = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '';
    const n = parseInt(m[1], 16);
    const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return lum > 0.6 ? '#2e2729' : '#ffffff';
  };

  /* ---------- キャラクター紹介 ---------- */
  function renderCast() {
    // キャラクターを使わないイベント（または0体）では、見出しごと出さない
    document.querySelector('.cast').hidden = !visibleChars().length;
    // 背景色：管理画面でキャラクターごとに指定した色（なければキャラクターの色を淡くしたもの）
    $('#castGrid').innerHTML = visibleChars().map((c) => `
    <div class="cast-card" style="--c:${c.color || '#e6dcf3'}${c.cardBg ? `;--card-bg:${c.cardBg};color:${inkFor(c.cardBg)}` : ''}">
      ${Art.characterSVG(c)}
      <div><h4>${esc(c.name)}<small>${esc(c.en)}</small></h4><p>${esc(c.profile)}</p></div>
    </div>`).join('');
  }
  renderCast();

  // キャラクターどうしの大きさの比率（いちばん大きいキャラクターを 100%）を入口・キャラクター紹介・アバター選びにも反映
  // 画像の読み込みが終わったら描き直す
  function applyCharacterSizes() {
    window.Art.prepareSizes(window.CAST || []).then((ok) => {
      if (!ok) return;
      renderEntrance();
      renderCast();
      if (!$('#entPick').hidden) renderEntrancePick();
    });
  }
  applyCharacterSizes();

  /* ---------- トースト ---------- */
  let toastTimer;
  // 明るい色なら濃い文字、暗い色なら白い文字（キャラクター紹介文の背景色に合わせる）
  function toast(msg, { bg = '', ink = '', title = '' } = {}) {
    const el = $('#toast');
    if (bg) {
      // キャラクター紹介文：右上に閉じるボタン（すぐ消したい人向け）
      // 名前は見出しの行、紹介文はその下（管理画面で入れた改行のまま）
      el.innerHTML = `${title ? `<span class="toast-title">${esc(title)}</span>` : ''}${msg ? `<span class="toast-text">${esc(msg)}</span>` : ''}<button type="button" class="toast-close" aria-label="紹介文を閉じる">×</button>`;
      el.querySelector('.toast-close').addEventListener('click', (e) => {
        e.stopPropagation();
        clearTimeout(toastTimer);
        el.classList.remove('show');
      });
    } else {
      el.textContent = msg;
    }
    el.style.background = bg;
    el.style.color = bg ? (ink || inkFor(bg)) : '';
    el.classList.toggle('toast-note', !!bg);
    el.classList.add('show');
    clearTimeout(toastTimer);
    // 紹介文は長さに合わせて長めに出す（6〜15秒。閉じるボタンですぐ消せる）
    const wait = bg ? Math.min(15000, 6000 + String(msg).length * 60) : 2400;
    toastTimer = setTimeout(() => el.classList.remove('show'), wait);
  }

  /* ---------- 3D 店内（js/world/）から呼ぶ関数 ---------- */
  window.App = {
    openProduct,
    openCart,
    toast,
    cartCount: () => totals().count,
    isLayerOpen: () => !!document.querySelector('.modal.is-open, .drawer.is-open'),
    confirmExit,
    clearCart() { state.cart = {}; saveCart(); },
    // キャラクター紹介文を閉じる（店内で一定の距離を歩いたとき）
    hideNote() {
      const el = $('#toast');
      if (!el.classList.contains('toast-note')) return;
      clearTimeout(toastTimer);
      el.classList.remove('show');
    },
    // 壁のキャラクターに話しかけたとき
    showCharacter(id) {
      const c = (window.CAST || []).find((x) => x.id === id);
      const note = window.THEMES?.[SHOP.theme]?.charNote || {};
      if (c) toast(c.profile || '', { title: c.name, bg: note.bg || '', ink: note.ink || '' });
    },
  };

  renderCart();
  return window.App;
})();
