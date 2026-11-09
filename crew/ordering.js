/* Single-screen counter and online-order workspace. */
(() => {
  'use strict';
  const S = Istilo, U = IstiloUI, e = S.escape;
  function create({ user, rerender, cancel }) {
    const cart = [];
    let selectedId = null, category = 'All', search = '', receipt = null;
    const draft = { customer: '', payment: 'Cash', cash: '' };
    let onlineCash = '', error = '';
    const all = () => S.read('orders', []);
    const selected = () => all().find(o => o.id === selectedId);
    const active = () => all().filter(o => !['Completed', 'Cancelled'].includes(o.status));
    const pick = U.picker(cart, rerender);
    const queueCard = order => `<button type="button" class="queue-card ${order.id === selectedId ? 'selected' : ''} ${order.source === 'Customer' && order.status === 'Pending' && !order.punchedAt ? 'new-order' : ''}" data-select-order="${e(order.id)}"><span class="row between"><strong>${U.shortId(order.id)}</strong><span class="payment-badge ${S.isPaid(order) ? 'paid' : 'unpaid'}">${S.isPaid(order) ? 'Paid' : e(order.paymentStatus)}</span></span><span class="queue-customer">${e(order.customer)}</span><span class="queue-items">${order.items.map(i => `${i.qty} × ${e(i.name)}`).join('<br>')}</span><span class="row between"><strong>${S.money(order.total)}</strong>${U.badge(order.status)}</span><small>${S.date(order.time)}${order.punchedAt ? ' · Punched' : ' · Not punched'}</small></button>`;
    function queueHTML() {
      if (!S.onShift) return '<div class="queue-heading"><h3>Online orders</h3><span class="pill">Off shift</span></div><div class="notice">Online orders are hidden while you are off shift.</div><button type="button" class="primary full" id="startQueueShift">Start shift &amp; receive orders</button><p class="mini-note">This clocks you in and loads waiting orders from the database.</p>';
      const online = active().filter(o => o.source === 'Customer'), counter = active().filter(o => o.source !== 'Customer');
      const pending = online.filter(o => o.status === 'Pending' && !o.punchedAt).length;
      return `<div class="queue-heading"><div><span class="eyebrow">Live queue</span><h3>Online orders</h3></div><span class="queue-count">${pending}</span></div><p class="mini-note">Select an order to verify its receipt. After approval, punch it for preparation.</p><div class="queue-list">${online.length ? online.slice().reverse().map(queueCard).join('') : '<div class="empty">No incoming online orders.</div>'}${counter.length ? '<h4>Walk-in in progress</h4>' + counter.slice().reverse().map(queueCard).join('') : ''}</div>`;
    }
    function productHTML() {
      const list = S.products.filter(p => (category === 'All' || p.category === category) && p.name.toLowerCase().includes(search.toLowerCase()));
      return `<div class="row between"><h3>Product menu</h3><small>Tap to add item</small></div><input id="orderSearch" aria-label="Search product menu" placeholder="Search product name…" value="${e(search)}"><div class="tabs order-categories" aria-label="Filter products">${['All', ...S.categories.map(c => c.name)].map(c => `<button type="button" class="tab ${category === c ? 'active' : ''}" data-order-category="${c}">${c}</button>`).join('')}</div><div class="punch-products">${list.map(p => `<button type="button" class="punch-product" data-punch-product="${e(p.id)}" ${S.available(p.id) ? '' : 'disabled'}><span aria-hidden="true">${p.icon}</span><strong>${e(p.name)}</strong><b>${S.money(p.price)}</b><small>${S.available(p.id) ? '+ Add to order' : 'Sold out'}</small></button>`).join('')}</div>${list.length ? '' : '<div class="empty">No matching products.</div>'}`;
    }
    function verificationHTML(order) {
      const proof = S.read('proofs', []).find(p => p.id === order.proof?.id);
      if (!proof || proof.status !== 'Under review') return '<p class="notice">Waiting for a payment receipt.</p>';
      return `<section class="payment-review"><h3>Verify ${e(proof.wallet)} payment</h3><a href="${e(proof.imageUrl)}" target="_blank" rel="noopener"><img src="${e(proof.imageUrl)}" alt="Customer payment receipt" style="width:100%;max-height:280px;object-fit:contain"></a><p>Submitted reference: <strong>${e(proof.reference)}</strong> <button type="button" class="outline" id="copySubmittedReference" data-reference="${e(proof.reference)}" aria-label="Copy submitted reference number">Copy</button></p><p>Expected amount: <strong>${S.money(order.total)}</strong></p><form id="crewProofForm"><label class="field">Reference actually received<input name="reference" maxlength="80" required></label><label class="field">Amount actually received<input name="receivedAmount" type="number" min="0.01" step="0.01" required></label><label class="field">Review note / rejection reason<textarea name="note" maxlength="500"></textarea></label><label class="checkbox"><input name="confirmedReceived" type="checkbox" required>I checked the receiving wallet transaction history and confirmed this exact payment.</label><button class="primary full">Approve payment</button><button type="button" class="outline full" id="rejectCrewProof">Reject receipt</button></form></section>`;
    }
    function currentHTML() {
      const order = selected(), online = !!order;
      const items = online ? order.items : cart, amount = online ? order.total : S.total(cart), paid = online && S.isPaid(order), cash = online ? onlineCash : draft.cash;
      const ended = online && ['Completed', 'Cancelled'].includes(order.status);
      const newOnline = online && paid && order.status === 'Pending' && !order.punchedAt;
      return `<div class="row between"><h3>Current order</h3><small>${online ? U.shortId(order.id) : 'Walk-in'}</small></div><div class="order-modes"><button type="button" class="tab ${!online ? 'active' : ''}" id="walkInMode">Walk-in</button>${online ? `<span class="pill">${e(order.source === 'Customer' ? 'Online pickup' : 'Walk-in order')}</span>${U.badge(order.status)}` : '<span class="mini-note">Counter ordering</span>'}</div><label class="field">Customer name ${online ? '' : '(optional)'}<input id="orderCustomer" name="customer" maxlength="80" placeholder="Walk-in customer" value="${e(online ? order.customer : draft.customer)}" ${online ? 'readonly' : ''}></label><div class="current-items">${U.cartHTML(items, !online)}</div>${order?.notes ? `<p class="order-note">${e(order.notes)}</p>` : ''}<div class="summary-total"><span>Subtotal</span><strong>${S.money(amount)}</strong></div><div class="summary-total grand-total"><span>Total</span><strong class="total">${S.money(amount)}</strong></div>${online ? `<div class="row between"><span>Payment status</span><span class="payment-badge ${paid ? 'paid' : 'unpaid'}">${paid ? 'Paid' : e(order.paymentStatus)}</span></div>` : ''}${online && !paid && order.source === 'Customer' ? verificationHTML(order) : ''}${!ended && !paid && (!online || order.source !== 'Customer') ? `<form id="orderPaymentForm"><label class="field">Payment method<select id="orderPayment"><option ${draft.payment === 'Cash' ? 'selected' : ''}>Cash</option>${!online ? `<option ${draft.payment === 'Pay at counter' ? 'selected' : ''}>Pay at counter</option>` : ''}</select></label><label class="field">Cash received (₱)<input id="orderCash" type="number" min="0" step="0.01" value="${e(cash)}" placeholder="0.00" ${!online && draft.payment !== 'Cash' ? 'disabled' : ''}></label><div class="row between change-line"><span>Change</span><strong id="orderChange">${S.money(Math.max(0, (Number(cash) || 0) - amount))}</strong></div><button class="primary full" ${!items.length ? 'disabled' : ''}>${online ? 'Record payment' : draft.payment === 'Cash' ? 'Complete walk-in order' : 'Punch walk-in order'}</button></form>` : paid ? `<div class="notice">Payment already recorded. Do not charge this order again.${order.change ? '<br>Change: ' + S.money(order.change) : ''}</div>` : ''}${newOnline ? '<button class="primary full punch-online" id="punchOnline">Punch online order →</button><p class="mini-note">Punching sends this order to preparation. It does not collect payment.</p>' : ''}${online && order.status === 'Preparing' ? '<button class="primary full" id="markReady">Mark ready for pickup</button>' : ''}${online && order.status === 'Ready' ? `<button class="primary full" id="completePickup" ${!paid ? 'disabled' : ''}>Complete order</button>${!paid ? '<p class="mini-note">Record payment to complete this order.</p>' : ''}` : ''}${online && (paid || order.source !== 'Customer') && ['Pending', 'Preparing'].includes(order.status) ? '<button type="button" class="textbutton full" id="cancelActiveOrder">Cancel this order</button>' : ''}<button type="button" class="outline full" id="clearCurrent">${online ? 'Back to walk-in' : 'Clear order'}</button><p id="orderingError" class="error" role="alert">${e(error)}</p>${receipt ? `<div class="inline-receipt" role="status"><strong>${U.shortId(receipt.id)} · ${e(receipt.status)}</strong><small>Total ${S.money(receipt.total)} · Change ${S.money(receipt.change)}</small><button type="button" class="textbutton" id="dismissReceipt">Dismiss</button></div>` : ''}`;
    }
    function render() {
      S.syncCart(cart);
      return `<div class="ordering-intro"><div><span class="eyebrow">Walk-in & online · One counter</span><h2>Ordering station</h2></div><span class="mini-note">Choose → Review → Punch → Prepare → Complete</span></div><div class="ordering-station"><section class="card product-pane" id="punchMenu">${productHTML()}</section><aside class="card current-pane" id="currentOrder">${currentHTML()}</aside></div>`;
    }
    function select(id) { if (busy) return; selectedId = id; onlineCash = ''; error = ''; receipt = null; rerender(); }
    function resetSelection() { selectedId = null; onlineCash = ''; error = ''; }
    let busy = false;
    async function act(action) { if (busy) return; busy = true; try { error = ''; await action(); rerender(); } catch (err) { error = err.message; const box = document.getElementById('orderingError'); if (box) box.textContent = error; else U.toast(error); } finally { busy = false; } }
    function bind(root) {
      root.querySelectorAll('[data-select-order]').forEach(b => b.onclick = () => select(b.dataset.selectOrder));
      root.querySelectorAll('[data-order-category]').forEach(b => b.onclick = () => { category = b.dataset.orderCategory; rerender(); });
      root.querySelectorAll('[data-punch-product]').forEach(b => b.onclick = () => { if (selectedId) return U.toast('Choose Walk-in to add items to your counter order. The online order stays unchanged.'); pick(b.dataset.punchProduct); });
      U.bindCart(root, cart, rerender);
      const $ = id => root.querySelector('#' + id);
      if ($('copySubmittedReference')) $('copySubmittedReference').onclick = async event => {
        const button = event.currentTarget, reference = button.dataset.reference;
        button.disabled = true;
        try {
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(reference);
          } else {
            const field = document.createElement('textarea');
            field.value = reference;
            field.style.position = 'fixed';
            field.style.opacity = '0';
            document.body.appendChild(field);
            try {
              field.select();
              if (!document.execCommand('copy')) throw new Error('Copy failed');
            } finally { field.remove(); button.focus(); }
          }
          U.toast('Reference number copied.');
        } catch (err) {
          U.toast('Unable to copy. Select the reference number and copy it manually.');
        } finally { button.disabled = false; }
      };
      if ($('startQueueShift')) $('startQueueShift').onclick = () => act(async () => {
        const button = $('startQueueShift'); button.disabled = true;
        try { await S.mutate('/shifts/in'); }
        finally { if (button.isConnected) button.disabled = false; }
        window.dispatchEvent(new StorageEvent('storage',{key:S.keys.orders}));
        U.toast('Shift started. Online orders are connected.');
      });
      $('orderSearch').oninput = event => { search = event.target.value; const position = event.target.selectionStart; const menu = $('punchMenu'); menu.innerHTML = productHTML(); bind(root); const input = $('orderSearch'); input.focus(); input.setSelectionRange(position, position); };
      $('walkInMode').onclick = () => { resetSelection(); rerender(); };
      $('clearCurrent').onclick = async () => {
        const hasWalkIn=!selectedId&&cart.length>0;
        const hasSelection=!!selectedId;
        if(hasWalkIn&&!await U.confirm('Clear all items from the current walk-in order?','Clear current order?'))return;
        if(hasSelection&&!await U.confirm('Leave this order and return to the walk-in counter?','Leave this order?'))return;
        if (!selectedId) { cart.splice(0); Object.assign(draft, { customer:'',payment:'Cash',cash:'' }); } resetSelection(); rerender();
      };
      if (!selectedId) {
        $('orderCustomer').oninput = event => { draft.customer = event.target.value; };
      }
      if ($('orderCash')) $('orderCash').oninput = event => {
        if (selectedId) onlineCash = event.target.value; else draft.cash = event.target.value;
        $('orderChange').textContent = S.money(Math.max(0, (Number(event.target.value) || 0) - (selected()?.total ?? S.total(cart))));
      };
      if ($('orderPayment')) $('orderPayment').onchange = event => { draft.payment = event.target.value; rerender(); };
      if ($('orderPaymentForm')) $('orderPaymentForm').onsubmit = event => {
        event.preventDefault();
        // Also read current controls at submission for browser autofill.
        const cash = $('orderCash').value;
        act(async () => {
          if (selectedId) { receipt = await S.recordPayment(selectedId, cash, user()); onlineCash = ''; U.toast('Payment recorded. Preparation status is unchanged.'); }
          else {
            receipt = await S.counterOrder(cart, { employee:user(),customer:$('orderCustomer').value.trim() || 'Walk-in customer',payment:$('orderPayment').value,paid:Number(cash) });
            cart.splice(0); draft.customer = ''; draft.cash = ''; U.toast('Walk-in order saved.');
          }
        });
      };
      if ($('crewProofForm')) {
        const form = $('crewProofForm');
        form.onsubmit = event => {
          event.preventDefault();
          const values = new FormData(form), proofId = selected().proof.id;
          act(async () => {
            await S.reviewProof(proofId, {decision:'approve',reference:values.get('reference'),receivedAmount:values.get('receivedAmount'),note:values.get('note'),confirmedReceived:form.elements.confirmedReceived.checked});
            U.toast('Payment verified. You can now punch the order.');
          });
        };
        $('rejectCrewProof').onclick = () => {
          const note = form.elements.note.value.trim(), proofId = selected().proof.id;
          if (!note) return U.toast('Enter a rejection reason for the customer.');
          act(async () => { await S.reviewProof(proofId, {decision:'reject',note}); resetSelection(); U.toast('Receipt rejected. The customer can submit a corrected receipt.'); });
        };
      }
      if ($('punchOnline')) $('punchOnline').onclick = () => act(async () => { await S.punchOrder(selectedId, user()); U.toast('Online order punched. Preparing now.'); });
      if ($('markReady')) $('markReady').onclick = () => act(() => S.setStatus(selectedId, 'Ready'));
      if ($('completePickup')) $('completePickup').onclick = () => act(async () => { await S.setStatus(selectedId, 'Completed'); receipt = selected(); U.toast('Order completed.'); });
      if ($('cancelActiveOrder')) $('cancelActiveOrder').onclick = () => cancel(selectedId);
      if ($('dismissReceipt')) $('dismissReceipt').onclick = () => { receipt = null; rerender(); };
    }
    function refreshQueue() {
      const queue = document.getElementById('incomingQueue');
      if (!queue) return;
      queue.innerHTML = queueHTML();
      queue.querySelectorAll('[data-select-order]').forEach(b => b.onclick = () => select(b.dataset.selectOrder));
    }
    return { render, bind, select, refreshQueue, reset: () => { cart.splice(0); resetSelection(); receipt = null; Object.assign(draft,{customer:'',payment:'Cash',cash:''}); } };
  }
  window.IstiloOrdering = { create };
})();
