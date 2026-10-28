(async () => {
  await Istilo.ready;
  'use strict';
  const S = Istilo, U = IstiloUI, e = S.escape, root = document.getElementById('content');
  let category = null, search = '', cart = [], receipt = null;
  const checkoutDraft = { customer: '', phone: '', notes: '', payment: 'GCash', reviewed: false };
  const pick = U.picker(cart, render);
  const placeholder = text => `<span class="blank-value">${e(text)}</span>`;
  const detail = (value, text) => value ? e(value) : placeholder(text);
  const page = () => ['menu', 'about', 'contact', 'checkout', 'confirmation'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'menu';
  function navigate(name) { if (page() === name) render(); else location.hash = name; }
  const steps = active => `<div class="steps">${['Menu', 'Order summary', 'Checkout'].map((s, i) => `<span class="${i === active ? 'active' : ''}">${String(i + 1).padStart(2, '0')} &nbsp; ${s}</span>`).join('<span>→</span>')}</div>`;
  function sidebar() {
    return `<aside class="order-sidebar" id="orderSummary"><div class="card"><div class="sidebar-label"><h3>Your order</h3><span>${cart.reduce((n, i) => n + i.qty, 0)} items</span></div>${U.cartHTML(cart)}<div class="summary-total"><span>Subtotal</span><strong>${S.money(S.total(cart))}</strong></div><div class="summary-total"><span>Total</span><strong class="total">${S.money(S.total(cart))}</strong></div>${page() === 'checkout' && cart.length ? inlineCheckout() : `<button class="primary full" id="toCheckout" ${cart.length ? '' : 'disabled'}>Review & checkout →</button>`}${cart.length ? '<button class="textbutton full" id="clearCart">Clear order</button>' : ''}<p class="notice">Online pickup · GCash or Maya<br>Payment verification is required before the crew prepares your order.</p></div></aside>`;
  }
  function inlineCheckout() {
    return `<form id="checkoutForm"><h3>Pickup details</h3><label class="field">Your name<input name="customer" autocomplete="name" maxlength="80" required placeholder="Name for your order"></label><label class="field">Contact number (optional)<input name="phone" type="tel" autocomplete="tel" maxlength="30"></label><label class="field">Order notes (optional)<textarea name="notes" maxlength="300" placeholder="Requests for the crew"></textarea></label><label class="field">Payment method<select name="payment"><option>GCash</option><option>Maya</option></select></label><label class="checkbox"><input type="checkbox" required>I’ve reviewed the items, options, and total.</label><button class="primary full" style="margin-top:16px">Place pickup order · ${S.money(S.total(cart))}</button><p id="checkoutError" class="error" role="alert"></p><p class="mini-note">Create the order, transfer via your selected wallet, then upload proof for verification.</p></form>`;
  }
  function menu() {
    const products = S.products.filter(p => p.category === category && p.name.toLowerCase().includes(search.toLowerCase()));
    return `<section class="customer-hero"><div><span class="eyebrow">A little pause, made just for you</span><h1>Good coffee.<br><em>Your kind of moment.</em></h1><p>Pick your favorite, make it yours, and let us take care of the rest.</p></div><div class="hero-seal" aria-hidden="true"><small>BREWED WITH CARE</small><span>☕</span><small>COFFEE WITH STYLE</small></div></section><div class="menu-layout"><section>${steps(0)}${category ? `<button class="textbutton category-back" id="backCategories">← All categories</button><div class="row between wrap product-heading"><div><span class="eyebrow">The menu / ${e(category)}</span><h2>${e(category)}</h2></div><input class="search" id="productSearch" aria-label="Search products in this category" placeholder="Find your favorite…" value="${e(search)}"></div><div class="tabs" role="group" aria-label="Product categories">${S.categories.map(c => `<button class="tab ${category === c.name ? 'active' : ''}" data-category="${e(c.name)}">${e(c.name)}</button>`).join('')}</div><div class="grid products">${products.map(p => U.card(p)).join('')}</div>${products.length ? '' : '<div class="empty">No products match your search.</div>'}` : `<div class="menu-heading"><h2>What are you in the mood for?</h2><p>Six ways to find your next favorite. Choose a category to begin.</p></div><div class="grid categories">${S.categories.map(c => `<button class="category" data-category="${e(c.name)}"><span class="category-icon" aria-hidden="true">${c.icon}</span><h3>${e(c.name)}</h3><p>${e(c.description)}</p><span class="category-link">Explore ${e(c.name)} ↗</span></button>`).join('')}</div>`}</section>${sidebar()}</div>`;
  }
  function confirmation() {
    const ownOrders=S.read('orders',[]);
    const order=ownOrders.find(o=>o.id===receipt?.id)||ownOrders.at(-1);
    if(!order)return '<section class="checkout-layout"><h1>No order to show.</h1><button class="primary" data-navigate="menu">Back to menu</button></section>';
    return `<section class="checkout-layout"><span class="eyebrow">Order ${U.shortId(order.id)}</span><h1>${S.isPaid(order)?'Your payment is verified.':'Your pickup order'}</h1><p class="page-intro">${e(order.customer)} · ${S.date(order.time)} · ${U.badge(order.status)}</p><div class="grid two">${IstiloPayments.panel(order)}<div class="card"><h3>Order summary</h3>${U.cartHTML(order.items,false)}<div class="summary-total"><span>Total</span><strong>${S.money(order.total)}</strong></div><p>Pickup: ${e(S.business.address)}</p><p class="mini-note">The crew manually accepts orders after successful payment verification.</p></div></div><button class="outline" data-navigate="menu" style="margin-top:22px">Back to menu</button></section>`;
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
    const existingForm = document.getElementById('checkoutForm');
    if (existingForm) {
      const values = new FormData(existingForm);
      checkoutDraft.customer = values.get('customer') || ''; checkoutDraft.phone = values.get('phone') || ''; checkoutDraft.notes = values.get('notes') || ''; checkoutDraft.payment = values.get('payment') || 'GCash';
      checkoutDraft.reviewed = existingForm.querySelector('[type="checkbox"]').checked;
    }
    S.syncCart(cart);
    const current = page();
    root.innerHTML = ({ menu, checkout: menu, confirmation, about, contact })[current]();
    document.querySelectorAll('[data-nav]').forEach(a => { const active = a.dataset.nav === (['checkout', 'confirmation'].includes(current) ? 'menu' : current); a.classList.toggle('active', active); if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    document.getElementById('cartCount').textContent = cart.reduce((n, i) => n + i.qty, 0);
    root.querySelectorAll('[data-category]').forEach(b => b.onclick = () => { category = b.dataset.category; search = ''; render(); });
    root.querySelectorAll('[data-product]').forEach(b => b.onclick = () => pick(b.dataset.product));
    root.querySelectorAll('[data-navigate]').forEach(b => b.onclick = () => navigate(b.dataset.navigate));
    U.bindCart(root, cart, render);
    const back = document.getElementById('backCategories');
    if (back) back.onclick = () => { category = null; search = ''; render(); };
    const clear = document.getElementById('clearCart');
    if (clear) clear.onclick = () => { cart.splice(0); render(); };
    const next = document.getElementById('toCheckout');
    if (next) next.onclick = () => { navigate('checkout'); setTimeout(() => document.getElementById('checkoutForm')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60); };
    const searchBox = document.getElementById('productSearch');
    if (searchBox) searchBox.oninput = event => { search = event.target.value; const position = event.target.selectionStart; render(); const input = document.getElementById('productSearch'); input.focus(); input.setSelectionRange(position, position); };
    IstiloPayments.bind(root, render);
    const form = document.getElementById('checkoutForm');
    if (form) {
      for (const name of ['customer', 'phone', 'notes', 'payment']) form.elements[name].value = checkoutDraft[name];
      form.querySelector('[type="checkbox"]').checked = checkoutDraft.reviewed;
    }
    if (form) form.onsubmit = async event => {
      event.preventDefault();
      const values = new FormData(form);
      const name = values.get('customer').trim();
      if (!name) { document.getElementById('checkoutError').textContent = 'Please enter your name.'; return; }
      try {
        receipt = await S.addOrder(cart, { customer: name, phone: values.get('phone').trim(), notes: values.get('notes').trim(), payment: values.get('payment'), source: 'Customer', type: 'Pickup' });
        cart.splice(0);
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
  }
  document.getElementById('cartButton').onclick = () => { if (page() !== 'menu') navigate('menu'); setTimeout(() => document.getElementById('orderSummary')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };
  window.addEventListener('hashchange', () => { render(); root.focus(); window.scrollTo(0, 0); });
  window.addEventListener('storage', event => {
    if (!Object.values(S.keys).includes(event.key)) return;
    // Preserve fields while someone is typing into checkout or contact forms.
    if (['menu', 'confirmation'].includes(page())) render();
    else if (event.key === S.keys.availability) U.toast('Menu availability changed. Your cart will be checked at checkout.');
  });
  render();
})();
