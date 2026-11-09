(async () => {
  await Istilo.ready;
  'use strict';
  const S = Istilo, U = IstiloUI, e = S.escape, root = document.getElementById('content');
  const statusLabel = status => ({ Pending: 'Waiting for approval', Preparing: 'Preparing order', Ready: 'Ready for Pickup' }[status] || status);
  const statusBadge = status => `<span class="pill ${e(status.toLowerCase())}">${e(statusLabel(status))}</span>`;
  let category = null, search = '', cart = [], receipt = null;
  const checkoutDraft = { customer: '', phone: '', notes: '', payment: 'GCash', reviewed: false, termsAccepted: false };
  const pick = U.picker(cart, render);
  const loginDialog = document.getElementById('customerLoginDialog');
  const registerPhone = document.getElementById('customerRegisterPhone');
  registerPhone.addEventListener('input', () => {
    registerPhone.value = registerPhone.value.replace(/[^0-9]/g, '').slice(0, 12);
  });
  loginDialog.querySelectorAll('input[type="password"]').forEach(input => {
    const wrapper = document.createElement('span');
    wrapper.className = 'password-control';
    input.before(wrapper);
    wrapper.append(input);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'password-toggle';
    toggle.textContent = 'Show';
    toggle.setAttribute('aria-controls', input.id);
    toggle.setAttribute('aria-label', 'Show ' + input.closest('label').childNodes[0].textContent.trim().toLowerCase());
    toggle.setAttribute('aria-pressed', 'false');
    const hide = () => {
      input.type = 'password';
      toggle.textContent = 'Show';
      toggle.setAttribute('aria-pressed', 'false');
      toggle.setAttribute('aria-label', toggle.getAttribute('aria-label').replace(/^Hide/, 'Show'));
    };
    toggle.addEventListener('click', () => {
      if (input.type === 'text') return hide();
      input.type = 'text';
      toggle.textContent = 'Hide';
      toggle.setAttribute('aria-pressed', 'true');
      toggle.setAttribute('aria-label', toggle.getAttribute('aria-label').replace(/^Show/, 'Hide'));
    });
    input.form.addEventListener('reset', hide);
    loginDialog.addEventListener('close', hide);
    wrapper.append(toggle);
  });
  ['customerRegisterForm', 'customerForgotForm'].forEach(id => {
    const form = document.getElementById(id);
    const password = form.elements.namedItem('password');
    const confirm = form.elements.namedItem('confirm');
    const requirements = document.createElement('ul');
    requirements.className = 'password-requirements';
    requirements.id = password.id + 'Requirements';
    const checks = [
      ['At least 8 characters', value => value.length >= 8],
      ['A letter (A–Z)', value => /[A-Za-z]/.test(value)],
      ['A number (0–9)', value => /[0-9]/.test(value)],
      ['A special character (e.g. !@#)', value => /[^A-Za-z0-9\s]/.test(value)]
    ];
    const items = checks.map(() => requirements.appendChild(document.createElement('li')));
    password.closest('label').after(requirements);
    password.setAttribute('aria-describedby', requirements.id);
    const match = document.createElement('p');
    match.className = 'password-match';
    match.id = confirm.id + 'Match';
    match.setAttribute('aria-live', 'polite');
    confirm.closest('label').after(match);
    confirm.setAttribute('aria-describedby', match.id);
    const update = () => {
      const valid = checks.map(([label, check], index) => {
        const passed = check(password.value);
        items[index].textContent = (passed ? '✓ ' : '○ ') + label;
        items[index].classList.toggle('met', passed);
        return passed;
      }).every(Boolean);
      password.setCustomValidity(password.value && !valid ? 'Use at least 8 characters, including a letter, number, and special character.' : '');
      const matches = password.value === confirm.value;
      confirm.setCustomValidity(confirm.value && !matches ? 'Passwords do not match.' : '');
      match.textContent = confirm.value ? (matches ? 'Passwords match.' : 'Passwords do not match.') : '';
      match.classList.toggle('met', !!confirm.value && matches);
    };
    password.addEventListener('input', update);
    confirm.addEventListener('input', update);
    form.addEventListener('reset', () => setTimeout(update, 0));
    update();
  });
  const notificationsDialog = document.getElementById('customerNotificationsDialog');
  let otpPending = false, resendDeadline = 0, resendBusy = false;
  let otpMode = 'registration';
  const otpForm = document.getElementById('customerOTPForm');
  const otpResend = document.getElementById('customerOTPResend');
  function updateResendCountdown() {
    const seconds = Math.max(0, Math.ceil((resendDeadline - Date.now()) / 1000));
    otpResend.disabled = resendBusy || seconds > 0;
    otpResend.textContent = resendBusy ? 'Sending…' : seconds ? `Resend OTP in ${seconds}s` : 'Resend OTP';
  }
  setInterval(updateResendCountdown, 1000);
  function showOTP(seconds) {
    const passwordChange = otpMode === 'password';
    document.getElementById('customerOTPTitle').textContent = passwordChange ? 'Verify Password Change' : 'Verify Your Email';
    document.getElementById('customerOTPDescription').textContent = passwordChange
      ? 'Enter the 6-digit code sent to your registered email to confirm your new password.'
      : 'Enter the 6-digit verification code sent to your email.';
    document.getElementById('customerOTPSubmit').textContent = passwordChange ? 'Verify & Change Password' : 'Verify Email';
    document.getElementById('customerOTPBack').textContent = passwordChange ? 'Back to Password Reset' : 'Back to Registration';
    document.getElementById('customerLoginForm').hidden = true;
    document.getElementById('customerRegisterForm').hidden = true;
    document.getElementById('customerForgotForm').hidden = true;
    otpForm.hidden = false;
    loginDialog.setAttribute('aria-labelledby', 'customerOTPTitle');
    if (seconds !== undefined) resendDeadline = Date.now() + seconds * 1000;
    updateResendCountdown();
    document.getElementById('customerOTPCode').focus();
  }
  document.getElementById('closeCustomerOTP').onclick = () => loginDialog.close();
  document.getElementById('customerOTPBack').onclick = () => {
    otpForm.hidden = true;
    if (otpMode === 'password') {
      document.getElementById('customerForgotForm').hidden = false;
      document.getElementById('customerResetIdentifier').focus();
      return;
    }
    document.getElementById('customerRegisterForm').hidden = false;
    document.getElementById('customerRegisterEmail').focus();
  };
  otpForm.onsubmit = async event => {
    event.preventDefault();
    const button = document.getElementById('customerOTPSubmit');
    const error = document.getElementById('customerOTPError');
    error.textContent = '';
    button.disabled = true;
    button.textContent = 'Verifying…';
    const passwordChange = otpMode === 'password';
    try {
      const code = document.getElementById('customerOTPCode').value;
      if (passwordChange) await S.customerVerifyPassword(code);
      else { await S.customerVerifyEmail(code); otpPending = false; }
      otpForm.reset();
      showCustomerLogin();
      const message = passwordChange ? 'Password changed successfully. Please log in.' : 'Email verified successfully!';
      document.getElementById('customerLoginSuccess').textContent = message;
      document.getElementById('customerIdentifier').focus();
      U.toast(message);
      updateLoginButton();
      render();
    } catch (err) { error.textContent = err.message; }
    finally { button.disabled = false; button.textContent = passwordChange ? 'Verify & Change Password' : 'Verify Email'; }
  };
  otpResend.onclick = async () => {
    resendBusy = true;
    updateResendCountdown();
    document.getElementById('customerOTPError').textContent = '';
    try {
      const result = await (otpMode === 'password' ? S.customerResendPasswordOTP() : S.customerResendOTP());
      resendDeadline = Date.now() + result.resendAfter * 1000;
      document.getElementById('customerOTPStatus').textContent = 'A new verification code has been sent.';
      document.getElementById('customerOTPCode').value = '';
    } catch (err) {
      if (err.resendAfter) resendDeadline = Date.now() + err.resendAfter * 1000;
      document.getElementById('customerOTPError').textContent = err.message;
    }
    finally { resendBusy = false; updateResendCountdown(); }
  };
  try {
    const registration = await S.customerRegistrationStatus();
    otpPending = registration.pending;
    if (otpPending) resendDeadline = Date.now() + registration.resendAfter * 1000;
  } catch { /* Keep login available if registration status cannot be fetched. */ }
  function requireCustomer() {
    if (S.customer?.verified) return true;
    showCustomerLogin();
    loginDialog.showModal();
    document.getElementById('customerIdentifier').focus();
    return false;
  }
  function showCustomerLogin() {
    otpForm.hidden = true;
    loginDialog.setAttribute('aria-labelledby', 'customerLoginTitle');
    document.getElementById('customerLoginForm').hidden = false;
    document.getElementById('customerRegisterForm').hidden = true;
    document.getElementById('customerForgotForm').hidden = true;
  }
  function updateLoginButton() {
    const button = document.getElementById('loginButton');
    if (!button) return;
    button.textContent = S.customer?.verified ? 'Profile' : 'Log in';
    updateNotifications();
  }
  function orderNotifications() {
    return S.read('orders', []).filter(order => order.source === 'Customer').slice().reverse().map(order => {
      const proofStatus = order.proof?.status || '';
      const key = `${order.id}:${proofStatus}:${order.paymentStatus}:${order.status}:${order.proof?.note || ''}`;
      if (proofStatus === 'Rejected' || order.paymentStatus === 'Rejected') {
        return { key, type: 'rejected', title: 'Payment proof rejected', message: order.proof?.note || 'Submit a corrected payment receipt.', time: order.updatedAt || order.time };
      }
      if (order.status === 'Cancelled') return { key, type: 'rejected', title: 'Order cancelled', message: 'Your pickup order was cancelled by the shop.', time: order.updatedAt || order.time };
      if (S.isPaid(order)) {
        const statusMessages = { Pending: 'Payment verified. Your order is pending crew acceptance.', Preparing: 'Your payment is verified and the crew is preparing your order.', Ready: 'Your order is ready for pickup.', Completed: 'Your order has been completed and collected.' };
        return { key, type: 'process', title: statusLabel(order.status), message: statusMessages[order.status] || 'Your pickup order is being processed.', time: order.updatedAt || order.time };
      }
      if (proofStatus === 'Under review' || order.paymentStatus === 'Under review') return { key, type: 'process', title: 'Payment proof under review', message: 'The crew is checking your payment receipt.', time: order.updatedAt || order.time };
      if (order.status === 'Pending') return { key, type: 'process', title: 'Order submitted', message: 'Your pickup order is waiting for payment verification.', time: order.updatedAt || order.time };
      return { key, type: 'process', title: statusLabel(order.status), message: 'Your pickup order status was updated.', time: order.updatedAt || order.time };
    });
  }
  function seenNotificationKeys() {
    try { return JSON.parse(localStorage.getItem('istilo:seenCustomerNotifications') || '[]'); } catch { return []; }
  }
  function updateNotifications() {
    const button = document.getElementById('notificationButton');
    const badge = document.getElementById('notificationBadge');
    if (!button || !badge) return;
    const verified = !!S.customer?.verified;
    button.hidden = !verified;
    if (!verified) return;
    const seen = new Set(seenNotificationKeys());
    const unread = orderNotifications().filter(item => !seen.has(item.key)).length;
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.hidden = unread === 0;
  }
  const placeholder = text => `<span class="blank-value">${e(text)}</span>`;
  const detail = (value, text) => value ? e(value) : placeholder(text);
  const page = () => ['menu', 'about', 'contact', 'checkout', 'confirmation', 'tracking', 'profile'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'menu';
  function navigate(name) { if (page() === name) render(); else location.hash = name; }
  const steps = active => `<div class="steps">${['Menu', 'Order summary', 'Checkout'].map((s, i) => `<span class="${i === active ? 'active' : ''}">${String(i + 1).padStart(2, '0')} &nbsp; ${s}</span>`).join('<span>→</span>')}</div>`;
  function sidebar() {
    return `<aside class="order-sidebar" id="orderSummary"><div class="card"><div class="sidebar-label"><h3>Your order</h3><span>${cart.reduce((n, i) => n + i.qty, 0)} items</span></div>${U.cartHTML(cart)}<div class="summary-total"><span>Subtotal</span><strong>${S.money(S.total(cart))}</strong></div><div class="summary-total"><span>Total</span><strong class="total">${S.money(S.total(cart))}</strong></div>${page() === 'checkout' && cart.length ? inlineCheckout() : `<button class="primary full" id="toCheckout" ${cart.length ? '' : 'disabled'}>Review & checkout →</button>`}${cart.length ? '<button class="textbutton full" id="clearCart">Clear order</button>' : ''}<p class="notice">Online pickup · GCash or Maya<br>Payment verification is required before the crew prepares your order.</p></div></aside>`;
  }
  function inlineCheckout() {
    if (!S.acceptingOrders) return '<div class="notice" role="status">Online ordering is currently unavailable. A crew member must be clocked in before you can place an order. Please try again later.</div>';
    return `<form id="checkoutForm"><div class="pickup-banner"><span aria-hidden="true">PICKUP ONLY</span><strong>Order for pickup only</strong></div><h3>Pickup details</h3><label class="field">Your name<input name="customer" autocomplete="name" maxlength="80" required readonly placeholder="Name for your order"></label><label class="field">Contact number<input name="phone" type="tel" autocomplete="tel" maxlength="20" required readonly placeholder="Contact number"></label><label class="field">Order notes (optional)<textarea name="notes" maxlength="300" placeholder="Requests for the crew"></textarea></label><label class="field">Payment method<select name="payment"><option>GCash</option><option>Maya</option></select></label><label class="checkbox"><input name="reviewed" type="checkbox" required>I’ve reviewed the items, options, and total.</label><label class="checkbox checkout-agreement"><input name="termsAccepted" type="checkbox" required aria-describedby="checkoutAgreementError"><span>I have read and agree to the <a href="/terms-and-conditions" target="_blank" rel="noopener noreferrer">Terms and Conditions</a> and <a href="/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</span></label><p id="checkoutAgreementError" class="error" role="alert" aria-live="polite"></p><button class="primary full" style="margin-top:16px">Place pickup order · ${S.money(S.total(cart))}</button><p id="checkoutError" class="error" role="alert"></p><p class="mini-note">Create the order, transfer via your selected wallet, then upload proof for verification.</p></form>`;
  }
  function menu() {
    const products = S.products.filter(p => p.category === category && p.name.toLowerCase().includes(search.toLowerCase()));
    return `<section class="customer-hero"><div><span class="eyebrow">A little pause, made just for you</span><h1>Good coffee.<br><em>Your kind of moment.</em></h1><p>Pick your favorite, make it yours, and let us take care of the rest.</p></div><div class="hero-seal" aria-hidden="true"><small>BREWED WITH CARE</small><span>☕</span><small>COFFEE WITH STYLE</small></div></section><div class="menu-layout"><section>${steps(0)}${category ? `<button class="textbutton category-back" id="backCategories">← All categories</button><div class="row between wrap product-heading"><div><span class="eyebrow">The menu / ${e(category)}</span><h2>${e(category)}</h2></div><input class="search" id="productSearch" aria-label="Search products in this category" placeholder="Find your favorite…" value="${e(search)}"></div><div class="tabs" role="group" aria-label="Product categories">${S.categories.map(c => `<button class="tab ${category === c.name ? 'active' : ''}" data-category="${e(c.name)}">${e(c.name)}</button>`).join('')}</div><div class="grid products">${products.map(p => U.card(p)).join('')}</div>${products.length ? '' : '<div class="empty">No products match your search.</div>'}` : `<div class="menu-heading"><h2>What are you in the mood for?</h2><p>Six ways to find your next favorite. Choose a category to begin.</p></div><div class="grid categories">${S.categories.map(c => `<button class="category" data-category="${e(c.name)}"><span class="category-icon" aria-hidden="true">${c.icon}</span><h3>${e(c.name)}</h3><p>${e(c.description)}</p><span class="category-link">Explore ${e(c.name)} ↗</span></button>`).join('')}</div>`}</section>${sidebar()}</div>`;
  }
  function confirmation() {
    const ownOrders=S.read('orders',[]);
    const order=ownOrders.find(o=>o.id===receipt?.id)||ownOrders.at(-1);
    if(!order)return '<section class="checkout-layout"><h1>No order to show.</h1><button class="primary" data-navigate="menu">Back to menu</button></section>';
    return `<section class="checkout-layout"><span class="eyebrow">Order ${U.shortId(order.id)}</span><h1>${S.isPaid(order)?'Your payment is verified.':'Your pickup order'}</h1><p class="page-intro">${e(order.customer)} · ${S.date(order.time)} · ${statusBadge(order.status)}</p><div class="grid two">${IstiloPayments.panel(order)}<div class="card"><h3>Order summary</h3>${U.cartHTML(order.items,false)}<div class="summary-total"><span>Total</span><strong>${S.money(order.total)}</strong></div><p>Pickup: ${e(S.business.address)}</p><p class="mini-note">The crew manually accepts orders after successful payment verification.</p></div></div><button class="outline" data-navigate="menu" style="margin-top:22px">Back to menu</button></section>`;
  }
  function tracking() {
    const ownOrders=S.read('orders',[]).filter(o=>o.source==='Customer').slice().reverse();
    if(!ownOrders.length)return '<section class="checkout-layout"><span class="eyebrow">Order tracking</span><h1>No orders to track.</h1><p class="page-intro">Your connected database orders will appear here.</p><button class="primary" data-navigate="menu">Order from the menu</button></section>';
    return `<section class="checkout-layout"><span class="eyebrow">Live order tracking</span><h1>Track your order</h1><p class="page-intro">Status updates are synchronized with the database and crew portal.</p><div class="tracking-list">${ownOrders.map(order=>`<article class="card tracking-card"><div class="row between wrap"><div><small>Order ${U.shortId(order.id)}</small><h3>${e(order.customer)}</h3></div>${statusBadge(order.status)}</div><p>${order.items.map(i=>`${i.qty} × ${e(i.name)}`).join(', ')}</p><div class="tracking-progress" role="list" aria-label="Order progress">${['Pending','Preparing','Ready','Completed'].map((status,index)=>{const step=['Pending','Preparing','Ready','Completed'].indexOf(order.status);return `<span class="${index<=step?'active':''} ${status==='Cancelled'?'': ''}" role="listitem">${e(statusLabel(status))}</span>`}).join('')} </div><div class="row between wrap"><strong>${S.money(order.total)}</strong><small>${order.paymentStatus} · ${e(order.payment)}</small></div>${order.status==='Cancelled'?'<p class="error">This order was cancelled.</p>':''}</article>`).join('')}</div></section>`;
  }
  function profile() {
    if (!S.customer?.verified) {
      navigate('menu');
      showCustomerLogin();
      loginDialog.showModal();
      return '';
    }
    const customer = S.customer;
    const initial = e((customer.name || 'Customer').trim().charAt(0).toUpperCase());
    return `<section class="profile-page">
      <div class="profile-shell">
        <div class="profile-topbar">
          <button class="profile-back" type="button" data-navigate="menu" aria-label="Back to menu">←</button>
          <strong>Edit Profile</strong>
          <span class="profile-topbar-space"></span>
        </div>
        <form class="customer-profile-form" id="customerProfileForm">
          <div class="profile-avatar-wrap">
            <div class="profile-avatar" aria-hidden="true">${initial}</div>
            <span class="eyebrow">Customer account</span>
          </div>
          <label class="profile-field">Username
            <input name="name" autocomplete="name" maxlength="100" required value="${e(customer.name || '')}">
          </label>
          <label class="profile-field">Email address
            <input name="email" type="email" autocomplete="email" maxlength="255" required value="${e(customer.email || '')}">
          </label>
          <label class="profile-field">Phone number
            <input name="phone" type="tel" autocomplete="tel" maxlength="20" required value="${e(customer.phone || '')}">
          </label>
          <button class="primary full profile-update" type="submit">Update</button>
          <button class="profile-password outline full" id="customerProfilePassword" type="button">Change password</button>
          <button class="profile-logout outline full" id="customerProfileLogout" type="button">Log out</button>
          <p id="customerProfileError" class="error" role="alert"></p>
        </form>
      </div>
    </section>`;
  }
  function about() {
    const b = S.business;
    return `<section class="info-page"><span class="eyebrow">More than a cup</span><h1>A place for your everyday pause.</h1><p class="page-intro">Get to know ISTILO — the place, the people, and the story behind your cup.</p><div class="story-banner"><div><span class="eyebrow">Our story</span><h2>${e(b.tagline)}</h2><p>${e(b.story)}</p><p>Choose a favorite from our coffee, milk tea, frappe, latte, matcha, and snack menu.</p></div><div class="place-visual"><div>☕<small>Shop photo to be added</small></div></div></div><div class="grid facts"><div class="card fact"><small>Our place</small><h3>Visit ISTILO</h3><p>${detail(b.address, 'Shop location to be added')}</p><p>${detail(b.hours, 'Opening hours to be added')}</p></div><div class="card fact"><small>The beginning</small><h3>Our foundation</h3><p>${detail(b.founded, 'Founding date to be added')}</p></div><div class="card fact"><small>Behind the counter</small><h3>Our owner</h3><p>${detail(b.owner, 'Owner’s name and story to be added')}</p></div></div><div class="section-head"><div><span class="eyebrow">The people who make your day</span><h2>Meet the crew</h2></div></div><div class="people-grid">${b.crew.length ? b.crew.map(p => `<article class="card"><div class="person-icon" aria-hidden="true">☕</div><h3>${e(p.name)}</h3><p class="muted">${e(p.role)}</p></article>`).join('') : '<article class="card"><div class="person-icon" aria-hidden="true">☕</div><h3>Our crew</h3><p class="muted">Crew names, roles, and photos will be added here.</p></article>'}</div><div class="card" style="margin-top:26px"><span class="eyebrow">Our tagline</span><h2 style="margin-top:12px">“${e(b.tagline)}”</h2></div></section>`;
  }
  function contact() {
    const b = S.business;
    return `<section class="info-page"><span class="eyebrow">We’re here for your questions</span><h1>Let’s talk over coffee.</h1><p class="page-intro">Ask about the menu, share feedback, or find out how to get in touch with the owner.</p><div class="grid two"><div class="card"><h3>Visit or say hello</h3><dl class="contact-list"><dt>Owner</dt><dd>${detail(b.owner, 'Owner contact name to be added')}</dd><dt>Email</dt><dd>${b.email ? `<a href="mailto:${e(b.email)}">${e(b.email)}</a>` : placeholder('Official email to be added')}</dd><dt>Phone</dt><dd>${b.phone ? `<a href="tel:${e(b.phone)}">${e(b.phone)}</a>` : placeholder('Official phone number to be added')}</dd><dt>Find us</dt><dd>${detail(b.address, 'Shop location to be added')}</dd><dt>Opening hours</dt><dd>${detail(b.hours, 'Opening hours to be added')}</dd></dl><p class="notice">Official owner details haven’t been supplied yet. Contact links will appear when they are added.</p></div><form class="card contact-form" id="contactForm"><h3>Leave a message</h3><label class="field">Your name<input name="name" autocomplete="name" maxlength="80" required></label><label class="field">Email address<input name="email" type="email" autocomplete="email" maxlength="120" required></label><label class="field">What’s on your mind?<select name="topic"><option>Menu question</option><option>Order question</option><option>Feedback</option><option>Contact the owner</option><option>Other</option></select></label><label class="field">Message<textarea name="message" maxlength="2000" required placeholder="We’d love to hear from you."></textarea></label><label class="checkbox"><input type="checkbox" required>I consent to sharing my contact details with the shop to handle this inquiry.</label><button class="primary full">Send inquiry ↗</button><p class="muted" style="font-size:11px">Your message is saved securely to the shop inbox. This form does not send email.</p><p id="contactStatus" role="status"></p></form></div></section>`;
  }
  function render() {
    updateNotifications();
    const existingForm = document.getElementById('checkoutForm');
    if (existingForm) {
      const values = new FormData(existingForm);
      checkoutDraft.customer = values.get('customer') || ''; checkoutDraft.phone = values.get('phone') || ''; checkoutDraft.notes = values.get('notes') || ''; checkoutDraft.payment = values.get('payment') || 'GCash';
      checkoutDraft.reviewed = existingForm.elements.reviewed.checked;
      checkoutDraft.termsAccepted = existingForm.elements.termsAccepted.checked;
    }
    S.syncCart(cart);
    const current = page();
    if (current === 'checkout' && !S.customer?.verified) {
      navigate('menu');
      showCustomerLogin();
      loginDialog.showModal();
      return;
    }
    root.innerHTML = ({ menu, checkout: menu, confirmation, tracking, about, contact, profile })[current]();
    document.querySelectorAll('[data-nav]').forEach(a => { const active = a.dataset.nav === (['checkout', 'confirmation'].includes(current) ? 'menu' : current === 'tracking' ? 'tracking' : current); a.classList.toggle('active', active); if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    root.querySelectorAll('[data-category]').forEach(b => b.onclick = () => { category = b.dataset.category; search = ''; render(); });
    root.querySelectorAll('[data-product]').forEach(b => b.onclick = () => { if (requireCustomer()) pick(b.dataset.product); });
    root.querySelectorAll('[data-navigate]').forEach(b => b.onclick = () => navigate(b.dataset.navigate));
    U.bindCart(root, cart, render);
    const back = document.getElementById('backCategories');
    if (back) back.onclick = () => { category = null; search = ''; render(); };
    const clear = document.getElementById('clearCart');
    if (clear) clear.onclick = async () => {
      if (!await U.confirm('Clear every item from your current order?', 'Clear order?')) return;
      cart.splice(0);
      render();
    };
    const next = document.getElementById('toCheckout');
    if (next) next.onclick = async () => {
      if (!requireCustomer()) return;
      if (!await U.confirm('Review your items, options, quantity, and total before proceeding to checkout?', 'Proceed to checkout?')) return;
      navigate('checkout');
      setTimeout(() => document.getElementById('checkoutForm')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60);
    };
    const searchBox = document.getElementById('productSearch');
    if (searchBox) searchBox.oninput = event => { search = event.target.value; const position = event.target.selectionStart; render(); const input = document.getElementById('productSearch'); input.focus(); input.setSelectionRange(position, position); };
    IstiloPayments.bind(root, render);
    const form = document.getElementById('checkoutForm');
    if (form) {
      for (const name of ['customer', 'phone', 'notes', 'payment']) form.elements[name].value = checkoutDraft[name];
      if (!checkoutDraft.customer && S.customer?.name) form.elements.customer.value = S.customer.name;
      if (!checkoutDraft.phone && S.customer?.phone) form.elements.phone.value = S.customer.phone;
      form.elements.reviewed.checked = checkoutDraft.reviewed;
      form.elements.termsAccepted.checked = checkoutDraft.termsAccepted;
      form.elements.termsAccepted.addEventListener('invalid', () => {
        document.getElementById('checkoutAgreementError').textContent = 'Please agree to the Terms and Conditions and Privacy Policy before placing your order.';
      });
      form.elements.termsAccepted.addEventListener('change', () => {
        checkoutDraft.termsAccepted = form.elements.termsAccepted.checked;
        document.getElementById('checkoutAgreementError').textContent = '';
      });
    }
    if (form) form.onsubmit = async event => {
      event.preventDefault();
      if (!requireCustomer()) return;
      const values = new FormData(form);
      const name = values.get('customer').trim();
      if (!name) { document.getElementById('checkoutError').textContent = 'Please enter your name.'; return; }
      if (values.get('termsAccepted') !== 'on') {
        document.getElementById('checkoutAgreementError').textContent = 'Please agree to the Terms and Conditions and Privacy Policy before placing your order.';
        form.elements.termsAccepted.focus();
        return;
      }
      if (!await U.confirm('Please confirm that you reviewed your items, options, quantity, payment method, and total before placing this order.', 'Place this order?', 'Yes, place order')) return;
      try {
        receipt = await S.addOrder(cart, { customer: name, phone: values.get('phone').trim(), notes: values.get('notes').trim(), payment: values.get('payment'), source: 'Customer', type: 'Pickup', termsAccepted: values.get('termsAccepted') === 'on' });
        cart.splice(0);
        checkoutDraft.termsAccepted = false;
        navigate('confirmation');
      } catch (err) { document.getElementById('checkoutError').textContent = err.message; }
    };
    const contactForm = document.getElementById('contactForm');
    if (contactForm) contactForm.onsubmit = async event => {
      event.preventDefault();
      const values = new FormData(contactForm);
      const message = { id: S.uid('MSG'), name: values.get('name').trim(), email: values.get('email').trim(), topic: values.get('topic'), message: values.get('message').trim(), time: new Date().toISOString(), status: 'New' };
      if (!message.name || !message.message) return U.toast('Enter your name and message.');
      try { await S.write('inquiries', [...S.read('inquiries', []), message]); contactForm.reset(); document.getElementById('contactStatus').textContent = 'Your message was received by the shop.'; } catch (err) { U.toast(err.message); }
    };
    const profileForm = document.getElementById('customerProfileForm');
    if (profileForm) profileForm.onsubmit = async event => {
      event.preventDefault();
      const values = new FormData(profileForm);
      const error = document.getElementById('customerProfileError');
      error.textContent = '';
      try {
        await S.updateCustomerProfile({
          name: values.get('name').trim(),
          phone: values.get('phone').trim(),
          email: values.get('email').trim()
        });
        await S.refresh(true);
        updateLoginButton();
        U.toast('Profile updated successfully.');
        render();
      } catch (err) {
        error.textContent = err.message;
      }
    };
    const profileLogout = document.getElementById('customerProfileLogout');
    if (profileLogout) profileLogout.onclick = async () => {
      if (!await U.confirm('Are you sure you want to log out?', 'Log out?', 'Yes, log out')) return;
      await S.logout();
      await S.refresh(true);
      updateLoginButton();
      navigate('menu');
      U.toast('You have been logged out.');
    };
    const profilePassword = document.getElementById('customerProfilePassword');
    if (profilePassword) profilePassword.onclick = () => {
      otpForm.hidden = true;
      showCustomerLogin();
      document.getElementById('customerLoginForm').hidden = true;
      document.getElementById('customerRegisterForm').hidden = true;
      document.getElementById('customerForgotForm').hidden = false;
      document.getElementById('customerResetIdentifier').value = S.customer?.email || '';
      loginDialog.showModal();
    };
  }
  document.getElementById('customerMenuToggle').onclick = () => {
    const nav=document.getElementById('customerNav');
    const open=nav.classList.toggle('open');
    document.getElementById('customerMenuToggle').setAttribute('aria-expanded',String(open));
  };
  document.querySelectorAll('#customerNav a').forEach(link=>link.onclick=()=>{document.getElementById('customerNav').classList.remove('open');document.getElementById('customerMenuToggle').setAttribute('aria-expanded','false');});
  document.getElementById('closeCustomerLogin').onclick = () => loginDialog.close();
  document.getElementById('closeCustomerRegister').onclick = () => loginDialog.close();
  document.getElementById('closeCustomerForgot').onclick = () => loginDialog.close();
  document.getElementById('showCustomerRegister').onclick = () => {
    otpMode = 'registration';
    if (otpPending) { showOTP(); return; }
    document.getElementById('customerLoginForm').hidden = true;
    document.getElementById('customerRegisterForm').hidden = false;
    document.getElementById('customerRegisterEmail').focus();
  };
  document.getElementById('showCustomerLogin').onclick = () => {
    document.getElementById('customerRegisterForm').hidden = true;
    document.getElementById('customerLoginForm').hidden = false;
    document.getElementById('customerForgotForm').hidden = true;
    document.getElementById('customerIdentifier').focus();
  };
  document.getElementById('showForgotPassword').onclick = () => {
    otpForm.hidden = true;
    document.getElementById('customerLoginForm').hidden = true;
    document.getElementById('customerRegisterForm').hidden = true;
    document.getElementById('customerForgotForm').hidden = false;
    document.getElementById('customerResetIdentifier').focus();
  };
  document.getElementById('backToCustomerLogin').onclick = () => showCustomerLogin();
  document.getElementById('loginButton').onclick = async () => {
    if (S.customer?.verified) {
      navigate('profile');
      return;
    }
    document.getElementById('customerLoginError').textContent = '';
    showCustomerLogin();
    loginDialog.showModal();
    document.getElementById('customerIdentifier').focus();
  };
  document.getElementById('customerLoginForm').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    document.getElementById('customerLoginError').textContent = '';
    try {
      await S.customerLogin(values.get('identifier').trim(), values.get('password'));
      await S.refresh(true);
      updateLoginButton();
      loginDialog.close();
      form.reset();
      U.toast('Login successful. You can now place an order.');
      render();
    } catch (err) {
      document.getElementById('customerLoginError').textContent = err.message;
    }
  };
  document.getElementById('customerRegisterForm').onsubmit = async event => {
    event.preventDefault();
    event.stopPropagation();
    const form = event.currentTarget;
    const values = new FormData(form);
    document.getElementById('customerRegisterError').textContent = '';
    if (values.get('password') !== values.get('confirm')) {
      document.getElementById('customerRegisterError').textContent = 'Passwords do not match.';
      document.getElementById('customerRegisterConfirmPassword').focus();
      return;
    }
    const button = document.getElementById('customerRegisterSubmit');
    button.disabled = true;
    button.textContent = 'Sending verification code…';
    try {
      const result = await S.customerRegister(values.get('name').trim(), values.get('email').trim(), values.get('phone').trim(), values.get('password'), values.get('terms') === 'on');
      otpPending = true;
      form.reset();
      document.getElementById('customerOTPError').textContent = '';
      document.getElementById('customerOTPStatus').textContent = 'Check your inbox or spam folder.';
      showOTP(result.resendAfter);
    } catch (err) {
      document.getElementById('customerRegisterError').textContent = err.message;
    } finally { button.disabled = false; button.textContent = 'Create account'; }
  };
  document.getElementById('customerForgotForm').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = document.getElementById('customerForgotSubmit');
    if (button.disabled) return;
    const values = new FormData(form);
    const error = document.getElementById('customerForgotError');
    error.textContent = '';
    if (values.get('password') !== values.get('confirm')) {
      error.textContent = 'Passwords do not match.';
      return;
    }
    button.disabled = true;
    try {
      if (!await U.confirm('Are you sure you want to change your password?', 'Change password?', 'Yes, change password')) return;
      button.textContent = 'Sending verification code…';
      const identifier = values.get('identifier').trim();
      const result = await S.customerResetPassword(identifier, values.get('password'));
      form.reset();
      document.getElementById('customerIdentifier').value = identifier;
      otpMode = 'password';
      document.getElementById('customerOTPError').textContent = '';
      document.getElementById('customerOTPStatus').textContent = 'Your password will change only after verification. Check your inbox or spam folder.';
      document.getElementById('customerOTPCode').value = '';
      showOTP(result.resendAfter);
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
      button.textContent = 'Change password';
    }
  };
  document.getElementById('notificationButton').onclick = () => {
    const notifications = orderNotifications();
    const list = document.getElementById('customerNotificationsList');
    list.innerHTML = notifications.length ? notifications.map(item => `<article class="notification-item ${item.type === 'rejected' ? 'rejected' : ''}"><strong>${e(item.title)}</strong><p>${e(item.message)}</p><small>${e(S.date(item.time))}</small></article>`).join('') : '<div class="empty">No order updates yet.</div>';
    localStorage.setItem('istilo:seenCustomerNotifications', JSON.stringify(notifications.map(item => item.key)));
    updateNotifications();
    notificationsDialog.showModal();
  };
  document.getElementById('closeCustomerNotifications').onclick = () => notificationsDialog.close();
  document.getElementById('viewTrackedOrders').onclick = () => {
    notificationsDialog.close();
    navigate('tracking');
  };
  window.addEventListener('hashchange', () => { render(); root.focus(); window.scrollTo(0, 0); });
  let lastAcceptingOrders = S.acceptingOrders;
  window.addEventListener('istilo:updated', () => {
    if (lastAcceptingOrders === S.acceptingOrders) return;
    lastAcceptingOrders = S.acceptingOrders;
    if (page() === 'checkout') render();
  });
  window.addEventListener('storage', event => {
    if (!Object.values(S.keys).includes(event.key)) return;
    // Preserve fields while someone is typing into checkout or contact forms.
    if (['menu', 'confirmation', 'profile'].includes(page())) render(); 
    else if (event.key === S.keys.availability) U.toast('Menu availability changed. Your cart will be checked at checkout.');
  });
  updateLoginButton();
  render();
})();
