/*
 * 出品のご案内（creators.html。企業・ブランド・クリエイター向け）：相談フォームの送信
 * 送信先はサイトのお問い合わせと同じ /api/contact（server/contact.js）。種類は「出店について」で届く。
 */
(function () {
  const $ = (s) => document.querySelector(s);
  const form = $('#crForm');
  const err = $('#crError');
  const showError = (msg) => { err.textContent = msg; err.hidden = !msg; };

  // プライバシーポリシー：Shopify のポリシーのページ（js/data.js の SHOPIFY_CONFIG）
  const domain = window.SHOPIFY_CONFIG?.domain;
  const privacy = $('#crPrivacy');
  if (domain) privacy.href = `https://${domain}/policies/privacy-policy`;
  else privacy.removeAttribute('target');

  // 「出品を相談する」：フォームへ移って、最初の欄にカーソルを置く
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-apply]')) return;
    e.preventDefault();
    $('#apply').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => form.hidden || form.elements.name.focus({ preventScroll: true }), 500);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    const data = {
      category: 'shop', name: f.name.value, email: f.email.value, company: f.company.value,
      links: f.links.value, message: f.message.value, agree: f.agree.checked, website: f.website.value,
    };
    const missing = [
      [!data.name.trim(), f.name, 'お名前'],
      [!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim()), f.email, '正しいメールアドレス'],
      [!data.message.trim(), f.message, 'ご相談内容'],
    ].filter(([bad]) => bad);
    if (missing.length) { showError(`${missing.map((m) => m[2]).join('・')}を入力してください`); missing[0][1].focus(); return; }
    if (!data.agree) { showError('プライバシーポリシーへの同意にチェックを入れてください'); f.agree.focus(); return; }
    showError('');
    const btn = form.querySelector('.cf-submit');
    btn.disabled = true;
    btn.textContent = '送信中…';
    try {
      const r = await fetch('/api/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
      if (r.ok) {
        form.hidden = true;
        $('#crDone').hidden = false;
        $('#crDone').focus({ preventScroll: true });
        $('#apply').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (r.status === 429) {
        showError('短い時間に何度も送信されたため、受け付けられませんでした。しばらくしてからお試しください。');
      } else if (r.status === 400) {
        showError('入力内容をご確認ください。');
      } else {
        showError('送信できませんでした。お手数ですが、しばらくしてからもう一度お試しください。');
      }
    } catch {
      showError('通信できませんでした。電波の良いところで、もう一度お試しください。');
    } finally {
      btn.disabled = false;
      btn.textContent = '送信する';
    }
  });
})();
