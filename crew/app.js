(async () => {
  await Istilo.ready;
  'use strict';
  const S = Istilo, U = IstiloUI, e = S.escape, $ = id => document.getElementById(id);
  const pages = [['dashboard','Dashboard','◫'],['pos','Ordering','⊞'],['preorders','Customer orders','&#9776;'],['menu','Menu availability','☕'],['history','Order history','◷'],['inquiries','Customer inquiries','✉'],['shift','My shift','◴'],['profile','Crew profile','♙']];
  let user = null, category = 'All', search = '', historySearch = '', historyDate = '', historyStatus = 'All';
  let cancelId = null;
  user = S.user?.employeeId || null;
  const root = $('content'), orders = () => S.read('orders', []);
  let knownOrders = new Set(orders().map(o => o.id)), popupOrderId = null;
  const current = () => ['orders','incoming','checkout'].includes(location.hash.slice(1)) ? 'pos' : pages.some(p => p[0] === location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard';
  const profileData = () => S.read('profiles', {})[user] || { name: S.crewMember(user)?.name || 'Crew member', email: '' };
  const ordering = IstiloOrdering.create({ user: () => user, rerender: render, cancel: id => { cancelId = id; $('confirmDialog').showModal(); } });
  const editOrder = IstiloOrderEditor.create(render);
  function go(page) { if (page === current()) render(); else location.hash = page; }
  async function attempt(action) { try { await action(); } catch (err) { U.toast(err.message); } }
  function showAuth() { $('login').hidden = !!user; $('app').hidden = !user; if (user) { if (!location.hash) location.hash = 'pos'; render(); } }
  async function logout() {
    try { await S.logout(); } catch (err) { U.toast(err.message); return; }
    user = null; ordering.reset(); document.body.classList.remove('ordering-view');
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    $('sidebar').classList.remove('open'); $('menuToggle').setAttribute('aria-expanded', 'false');
    $('loginForm').reset(); $('loginError').textContent = ''; showAuth();
    $('onlinePopup').hidden = true;
  }
  $('loginForm').onsubmit = async event => {
    event.preventDefault();
    try { const account = await S.login($('employee').value.trim().toUpperCase(), $('password').value, 'crew'); user = account.employeeId; $('password').value = ''; $('loginError').textContent = ''; knownOrders = new Set(orders().map(o => o.id)); showAuth(); }
    catch (err) { $('loginError').textContent = err.message; }
  };
  $('logout').onclick = logout;
  $('menuToggle').onclick = () => { const open = $('sidebar').classList.toggle('open'); $('menuToggle').setAttribute('aria-expanded', String(open)); };
  function orderRow(o) {
    return `<article class="order"><div><div class="row wrap"><strong>${U.shortId(o.id)} · ${e(o.customer)}</strong>${U.badge(o.status)}</div><p>${o.items.map(i => `${i.qty} × ${e(i.name)}`).join(', ')}</p><small>${S.money(o.total)} · ${S.isPaid(o) ? 'Paid' : 'Unpaid'} · ${o.punchedAt ? 'Punched' : 'Not punched'}</small></div><button class="primary" data-open-order="${e(o.id)}">Open in Ordering →</button></article>`;
  }
  function dashboard() {
    const all = orders(), active = all.filter(o => !['Completed','Cancelled'].includes(o.status)), recent = active.slice().reverse().slice(0,4);
    const incoming = all.filter(o => o.source === 'Customer' && o.status === 'Pending');
    const stats = [['Active orders',active.length,'↗','Across the local queue'],['New pre-orders',incoming.length,'↓','Waiting to be prepared'],['Preparing',all.filter(o => o.status === 'Preparing').length,'☕','Currently in the works'],['Ready for pickup',all.filter(o => o.status === 'Ready').length,'✓','Ready to hand over']];
    return `<section class="card crew-hero"><div><span class="eyebrow">A good day starts with the crew</span><h1>Hello, ${e(profileData().name)}.</h1><p>One order, one cup, one good moment at a time.<br>Here’s what’s happening at your counter.</p></div><a class="primary" href="#pos">＋ Take an order</a></section><div class="grid stats">${stats.map(([label,value,icon,note]) => `<div class="card stat"><div class="stat-top"><small>${label}</small><span class="stat-icon">${icon}</span></div><strong class="number">${value}</strong><small>${note}</small></div>`).join('')}</div><div class="section-head"><h3>The order board</h3><a class="row-link" href="#pos">All orders ↗</a></div><div class="card">${recent.length ? recent.map(orderRow).join('') : '<div class="empty">A fresh start. No active orders yet.<br>Take a counter order or open the customer menu.</div>'}</div><div class="dashboard-bottom"><div class="card"><span class="eyebrow">Your counter, connected</span><h3 style="margin-top:12px">Ready for the next order?</h3><p class="mini-note">Verified orders and inquiries are synchronized through the shop database.</p><div class="quick-links"><a class="outline" href="../customer/index.html" target="_blank" rel="noopener">Open customer menu ↗</a><a class="outline" href="#menu">Check menu availability →</a></div></div><div class="card"><span class="eyebrow">Shift notes</span><h3 style="margin-top:12px">Keep the little things in sync.</h3><p class="mini-note">Mark sold-out items before taking orders. Collect payment before completing pickup orders. Leave a handover note when your shift ends.</p><a class="textbutton" href="#shift">My shift →</a></div></div>`;
  }
  function categoryTabs() { return `<div class="tabs" role="group" aria-label="Menu categories">${['All',...S.categories.map(c => c.name)].map(c => `<button class="tab ${category === c ? 'active' : ''}" data-category="${c}">${c}</button>`).join('')}</div>`; }
  const filteredProducts = () => S.products.filter(p => (category === 'All' || p.category === category) && p.name.toLowerCase().includes(search.toLowerCase()));
  const menuSearchHTML = () => `<input class="search" id="menuSearch" aria-label="Search menu" value="${e(search)}" placeholder="Find a drink or snack…">`;
  function pos() { return ordering.render(); }
  function menu() {
    const list = filteredProducts();
    return `<div class="row between wrap" style="margin-bottom:20px"><div><span class="eyebrow">What’s brewing</span><h2>Menu availability</h2></div>${menuSearchHTML()}</div><p class="queue-caption">Sold-out items cannot be ordered in either portal. Recipe and price editing belong to the administrator.</p>${categoryTabs()}<div class="availability-grid">${list.map(p => `<article class="card availability-row"><div class="row"><span class="availability-icon" aria-hidden="true">${p.icon}</span><div><h3>${e(p.name)}</h3><small>${e(p.category)} · ${S.money(p.price)}</small><br><span class="pill ${S.available(p.id) ? 'ready' : 'cancelled'}">${S.available(p.id) ? 'Available' : 'Sold out'}</span></div></div><button class="outline" data-availability="${p.id}">${S.available(p.id) ? 'Mark sold out' : 'Make available'}</button></article>`).join('')}</div>${list.length ? '' : '<div class="empty">No matching products.</div>'}`;
  }
  function customerOrderActions(order) {
    if (['Completed','Cancelled'].includes(order.status)) return '<span class="mini-note">No further actions</span>';
    const edit = order.status === 'Pending' && !order.punchedAt ? `<button class="outline" data-edit-order="${e(order.id)}">Edit items</button>` : '';
    if (!S.isPaid(order)) return edit + `<button class="outline" data-open-order="${e(order.id)}">Review payment</button>`;
    const actions = (S.transitions[order.status] || []).filter(status => status !== 'Completed' || S.isPaid(order));
    return edit + `<form class="customer-order-action" data-order="${e(order.id)}"><label class="field">Action<select name="status" aria-label="Action for ${e(U.shortId(order.id))}"><option value="">Choose action</option>${actions.map(status => `<option value="${status}">${status === 'Preparing' ? 'Accept and prepare' : status === 'Ready' ? 'Mark ready for pickup' : status === 'Completed' ? 'Complete order' : 'Cancel order'}</option>`).join('')}</select></label><button class="primary">Apply</button></form>`;
  }
  function preorders() {
    if (!S.onShift) return '<div class="card"><h2>You are off shift</h2><p>Clock in to receive and manage customer orders.</p><a class="primary" href="#shift">Go to My shift</a></div>';
    const list = orders().filter(o => o.source === 'Customer').slice().reverse();
    return `<div class="section-head"><h2>Customer orders</h2><a class="outline" href="#pos">Open Ordering</a></div><p class="queue-caption">Review customer receipts, then accept and prepare orders. Status changes also appear on the customer's confirmation screen.</p><div class="card table-wrap"><table class="data-table"><thead><tr><th>Order / placed</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th>Action</th></tr></thead><tbody>${list.map(o => `<tr><td><strong>${e(U.shortId(o.id))}</strong><small>${S.date(o.time)}</small></td><td>${e(o.customer)}${o.notes ? `<small>Note: ${e(o.notes)}</small>` : ''}</td><td>${o.items.map(i => `${i.qty} &times; ${e(i.name)}<small>${e(i.size)} &middot; ${e(i.flavor)}</small>`).join('<br>')}</td><td>${S.money(o.total)}</td><td>${e(o.paymentStatus)}</td><td>${U.badge(o.status)}</td><td>${customerOrderActions(o)}</td></tr>`).join('')}</tbody></table>${list.length ? '' : '<div class="empty">No customer orders yet.</div>'}</div>`;
  }
  function historyList() { return orders().filter(o => ['Completed','Cancelled'].includes(o.status) && (historyStatus === 'All' || historyStatus === o.status) && (!historyDate || S.today(o.time) === historyDate) && [o.id,U.shortId(o.id),o.customer,...o.items.map(i => i.name)].join(' ').toLowerCase().includes(historySearch.toLowerCase())).reverse(); }
  function history() {
    const list = historyList();
    return `<div class="row wrap" style="margin-bottom:20px"><input class="search" id="historySearch" aria-label="Search order history" placeholder="Search order or customer…" value="${e(historySearch)}"><input class="search" type="date" id="historyDate" aria-label="Filter by order date" value="${historyDate}"><select class="search" id="historyStatus" aria-label="History status">${['All','Completed','Cancelled'].map(s => `<option ${s === historyStatus ? 'selected' : ''}>${s}</option>`).join('')}</select><button class="outline" id="exportHistory" ${list.length ? '' : 'disabled'}>Export CSV ↓</button></div><p class="queue-caption">${list.length} matching orders · Asia/Manila time.</p><div class="card table-wrap"><table class="data-table"><thead><tr><th>Order / placed</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th></tr></thead><tbody>${list.map(o => `<tr><td><strong>${U.shortId(o.id)}</strong><small>${S.date(o.time)}</small></td><td>${e(o.customer)}<small>${e(o.source)}</small></td><td>${o.items.map(i => `${i.qty} × ${e(i.name)}<small>${e(i.size)} · ${e(i.flavor)}</small>`).join('<br>')}</td><td>${S.money(o.total)}</td><td>${o.collectedAt || o.payment === 'Cash' ? 'Paid' : 'Not collected'}</td><td>${U.badge(o.status)}</td></tr>`).join('')}</tbody></table>${list.length ? '' : '<div class="empty">No matching completed or cancelled orders.</div>'}</div>`;
  }
  function inquiries() {
    const list = S.read('inquiries',[]).slice().reverse();
    return `<div class="notice">Messages and notes are stored in the database. Replies are internal notes; no email is sent. Use the supplied email address to contact the customer separately.</div>${list.length ? list.map(m => `<article class="card inquiry"><div class="row between wrap"><div><span class="eyebrow">${e(m.topic)}</span><h3 style="margin:8px 0">${e(m.name)}</h3><a href="mailto:${e(m.email)}">${e(m.email)}</a></div><div>${U.badge(m.status)}<p class="mini-note">${S.date(m.time)}</p></div></div><p class="message">${e(m.message)}</p>${m.note ? `<p class="reply"><strong>Crew note</strong><br>${e(m.note)}</p>` : ''}<form class="inquiry-form" data-message="${e(m.id)}"><label class="field">Internal follow-up note<textarea name="note" maxlength="2000" required>${e(m.note || '')}</textarea></label><div class="row wrap"><button class="primary">Save note</button><button type="button" class="outline" data-inquiry="${e(m.id)}" data-state="${m.status === 'Resolved' ? 'New' : 'Resolved'}">${m.status === 'Resolved' ? 'Reopen inquiry' : 'Mark resolved'}</button></div></form></article>`).join('') : '<div class="card"><div class="empty">No inquiries yet. The customer Contact page saves messages here.</div></div>'}`;
  }
  function shift() {
    const list = S.read('shifts',[]).filter(s => s.employee === user), active = list.find(s => !s.end);
    const duration = s => Math.max(0,Math.round(((s.end ? new Date(s.end) : new Date()) - new Date(s.start)) / 60000));
    return `<div class="grid two"><div class="card shift-state"><span class="eyebrow">Your time at the counter</span><h2 style="margin-top:16px">${active ? 'You’re clocked in.' : 'Ready when you are.'}</h2><div class="number">${active ? duration(active) + ' min' : 'Off shift'}</div><p class="mini-note">${active ? 'Started ' + S.date(active.start) : 'Clock in to start a local shift record.'}</p>${active ? '<form id="clockOutForm"><label class="field" style="text-align:left">Handover note (optional)<textarea name="note" maxlength="1000" placeholder="Anything the next crew should know?"></textarea></label><button class="primary full">Clock out & save handover</button></form>' : '<button class="primary" id="clockIn">Clock in →</button>'}<p class="mini-note">Clock in to receive online orders. Clocking out removes your access to online orders.</p></div><div class="card"><h3>Recent shifts</h3>${list.length ? list.slice().reverse().map(s => `<div class="cartline"><div><strong>${S.date(s.start)}</strong><small>${s.end ? 'Ended ' + S.date(s.end) : 'In progress'}</small>${s.note ? `<p class="mini-note">${e(s.note)}</p>` : ''}</div><strong>${duration(s)} min</strong></div>`).join('') : '<div class="empty">Your first shift starts here.</div>'}</div></div>`;
  }
  function profile() {
    const p = profileData();
    return `<div class="grid two"><form class="card" id="profileForm"><div class="profile-header"><span class="avatar">${e(p.name.slice(0,1).toUpperCase())}</span><div><span class="eyebrow">Your crew profile</span><h2>${e(p.name)}</h2><small>${e(user)} · Crew / cashier</small></div></div><label class="field">Display name<input name="name" maxlength="80" value="${e(p.name)}" required></label><label class="field">Email (optional)<input name="email" type="email" maxlength="120" value="${e(p.email)}" autocomplete="email"></label><button class="primary">Save profile</button><p class="mini-note">Profile changes are saved in the database.</p></form><div class="card"><span class="eyebrow">Your workspace access</span><h3 style="margin-top:14px">The tools for your shift.</h3><p class="mini-note">Counter orders, preparation, payment collection, menu availability, order history, inquiries, and shift notes.</p><div class="divider"></div><h3>Account access</h3><p class="mini-note">Your account uses server authentication. Ask the administrator to reset your password if needed.</p><button class="outline" id="profileLogout">Log out</button></div></div>`;
  }
  function render() {
    if (!user) return;
    if (!S.crewMember(user)) { logout(); U.toast('This employee is inactive. Contact the administrator.'); return; }
    document.body.classList.toggle('ordering-view', current() === 'pos');
    const page = current(), count = orders().filter(o => o.source === 'Customer' && o.status === 'Pending').length;
    $('nav').innerHTML = pages.map(([id,label,icon]) => `<a class="navbtn ${page === id ? 'active' : ''}" href="#${id}" ${page === id ? 'aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${icon}</span>${label}${id === 'pos' && count ? `<span class="nav-count">${count}</span>` : ''}</a>`).join('');
    $('pageTitle').textContent = pages.find(p => p[0] === page)[1]; $('sideUser').textContent = profileData().name;
    $('today').textContent = new Date().toLocaleDateString('en-PH',{ timeZone:'Asia/Manila',weekday:'short',month:'short',day:'numeric',year:'numeric' });
    root.innerHTML = ({ dashboard,pos,preorders,menu,history,inquiries,shift,profile })[page](); bind();
  }
  function bindSearch(id, update) {
    if ($(id)) $(id).oninput = event => { update(event.target.value); const position = event.target.selectionStart; render(); $(id).focus(); $(id).setSelectionRange(position,position); };
  }
  function bind() {
    if (current() === 'pos') { ordering.bind(root); return; }
    root.querySelectorAll('[data-open-order]').forEach(b => b.onclick = () => { go('pos'); ordering.select(b.dataset.openOrder); });
    root.querySelectorAll('[data-edit-order]').forEach(button => button.onclick = () => editOrder(button.dataset.editOrder));
    root.querySelectorAll('.customer-order-action').forEach(form => form.onsubmit = event => {
      event.preventDefault();
      const id = form.dataset.order, status = form.elements.status.value;
      if (!status) return U.toast('Choose an order action first.');
      if (status === 'Cancelled') { cancelId = id; $('confirmDialog').showModal(); return; }
      const button = form.querySelector('button'); button.disabled = true;
      attempt(async () => {
        try {
          const order = orders().find(o => o.id === id);
          if (status === 'Preparing' && order?.source === 'Customer' && !order.punchedAt) await S.punchOrder(id);
          else await S.setStatus(id, status);
          render(); U.toast('Customer order status updated.');
        } finally { button.disabled = false; }
      });
    });
    root.querySelectorAll('[data-category]').forEach(b => b.onclick = () => { category = b.dataset.category; render(); });
    root.querySelectorAll('[data-status]').forEach(b => b.onclick = () => attempt(async () => { await S.setStatus(b.dataset.status,b.dataset.next); render(); U.toast('Order updated to ' + b.dataset.next + '.'); }));
    root.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => { cancelId = b.dataset.cancel; $('confirmDialog').showModal(); });
    root.querySelectorAll('[data-collect]').forEach(b => b.onclick = () => { go('pos'); ordering.select(b.dataset.collect); });
    root.querySelectorAll('[data-availability]').forEach(b => b.onclick = () => attempt(async () => { const data = S.read('availability',{}); data[b.dataset.availability] = !S.available(b.dataset.availability); await S.write('availability',data); render(); U.toast('Menu availability updated.'); }));
    bindSearch('menuSearch',value => { search = value; }); bindSearch('historySearch',value => { historySearch = value; });
    if ($('historyDate')) $('historyDate').onchange = event => { historyDate = event.target.value; render(); };
    if ($('historyStatus')) $('historyStatus').onchange = event => { historyStatus = event.target.value; render(); };
    if ($('exportHistory')) $('exportHistory').onclick = exportHistory;
    if ($('profileLogout')) $('profileLogout').onclick = logout;
    if ($('profileForm')) $('profileForm').onsubmit = event => { event.preventDefault(); attempt(async () => { const values = new FormData(event.target), name = values.get('name').trim(); if (!name) throw new Error('Enter a display name.'); const data = S.read('profiles',{}); data[user] = { name,email:values.get('email').trim() }; await S.write('profiles',data); render(); U.toast('Profile saved.'); }); };
    root.querySelectorAll('.inquiry-form').forEach(form => form.onsubmit = event => { event.preventDefault(); attempt(async () => { const list = S.read('inquiries',[]), m = list.find(m => m.id === form.dataset.message), note = new FormData(form).get('note').trim(); if (!m || !note) throw new Error('Enter a note for this inquiry.'); m.note = note; if (m.status === 'New') m.status = 'In progress'; m.updatedAt = new Date().toISOString(); await S.write('inquiries',list); render(); U.toast('Internal note saved. No email was sent.'); }); });
    root.querySelectorAll('[data-inquiry]').forEach(b => b.onclick = () => attempt(async () => { const list = S.read('inquiries',[]), m = list.find(m => m.id === b.dataset.inquiry); if (!m) throw new Error('Inquiry no longer exists.'); m.status = b.dataset.state; await S.write('inquiries',list); render(); }));
    if ($('clockIn')) $('clockIn').onclick = () => attempt(async () => { const list = S.read('shifts',[]); if (list.some(s => s.employee === user && !s.end)) throw new Error('You already have an active shift.'); list.push({ id:S.uid('SHIFT'),employee:user,start:new Date().toISOString() }); await S.write('shifts',list); render(); window.dispatchEvent(new StorageEvent('storage',{key:S.keys.orders})); U.toast('Clocked in. Have a good shift.'); });
    if ($('clockOutForm')) $('clockOutForm').onsubmit = event => { event.preventDefault(); attempt(async () => { const list = S.read('shifts',[]), active = list.find(s => s.employee === user && !s.end); if (!active) throw new Error('No active shift found.'); active.end = new Date().toISOString(); active.note = new FormData(event.target).get('note').trim(); await S.write('shifts',list); window.dispatchEvent(new StorageEvent('storage',{key:S.keys.orders})); render(); U.toast('Shift and handover saved.'); }); };
  }
  function exportHistory() {
    const cell = v => '"' + String(/^[=+@\-\t\r]/.test(String(v)) ? "'" + v : v).replace(/"/g,'""') + '"';
    const rows = [['Order ID','Customer','Items','Total PHP','Status','Source','Placed at'],...historyList().map(o => [o.id,o.customer,o.items.map(i => `${i.qty} x ${i.name} (${i.size}, ${i.flavor})`).join('; '),o.total,o.status,o.source,o.time])];
    const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n')],{ type:'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = 'istilo-order-history.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  $('keepOrder').onclick = () => $('confirmDialog').close();
  $('confirmCancel').onclick = () => attempt(async () => { await S.setStatus(cancelId,'Cancelled'); $('confirmDialog').close(); render(); U.toast('Order cancelled.'); });
  window.addEventListener('hashchange',() => { $('sidebar').classList.remove('open'); $('menuToggle').setAttribute('aria-expanded','false'); render(); root.focus(); window.scrollTo(0,0); });
  $('dismissOnlinePopup').onclick = () => { $('onlinePopup').hidden = true; };
  $('reviewOnlineOrder').onclick = () => { $('onlinePopup').hidden = true; go('pos'); ordering.select(popupOrderId); };
  window.addEventListener('storage', event => {
    if (!Object.values(S.keys).includes(event.key)) return;
    const list = orders(), arrivals = list.filter(o => !knownOrders.has(o.id) && o.source === 'Customer' && o.status === 'Pending' && !o.punchedAt);
    knownOrders = new Set(list.map(o => o.id));
    if (!user) return;
    if (!S.crewMember(user)) { logout(); U.toast('This employee has been deactivated by the administrator.'); return; }
    if (!S.onShift) {
      ordering.reset(); $('onlinePopup').hidden = true;
      $('orderEditDialog').close();
      render(); return;
    }
    if (arrivals.length) {
      const latest = arrivals.at(-1); popupOrderId = latest.id;
      $('onlinePopupText').textContent = latest.customer + ' · ' + S.money(latest.total) + ' · ' + (S.isPaid(latest) ? 'Paid' : 'Unpaid');
      $('onlinePopup').hidden = false;
      if (current() === 'pos') { ordering.refreshQueue(); return; }
    }
    if (current() === 'pos') { render(); return; }
    if (root.contains(document.activeElement) && document.activeElement.matches('input,textarea,select')) U.toast('Local data updated. Changes are checked when you save.'); else render();
  });
  showAuth();
})();
