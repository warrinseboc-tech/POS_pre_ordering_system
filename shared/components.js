(() => {
  'use strict';
  const S = window.Istilo, e = S.escape;
  let toastTimer;
  function toast(message) {
    const box = document.getElementById('toast');
    box.textContent = message;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, 5000);
  }
  function confirm(message, title = 'Please confirm', confirmText = 'Yes', cancelText = 'Cancel') {
    let dialog = document.getElementById('appConfirmDialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'appConfirmDialog';
      dialog.setAttribute('aria-labelledby', 'appConfirmTitle');
      dialog.innerHTML = `<div class="dialog-body"><h2 id="appConfirmTitle"></h2><p id="appConfirmMessage"></p><div class="row full" id="appConfirmActions"><button type="button" class="outline" id="appConfirmCancel"></button><button type="button" class="primary" id="appConfirmYes"></button></div></div>`;
      document.body.appendChild(dialog);
    }
    dialog.querySelector('#appConfirmTitle').textContent = title;
    dialog.querySelector('#appConfirmMessage').textContent = message;
    dialog.querySelector('#appConfirmCancel').textContent = cancelText;
    dialog.querySelector('#appConfirmYes').textContent = confirmText;
    return new Promise(resolve => {
      const cancelButton = dialog.querySelector('#appConfirmCancel');
      const yesButton = dialog.querySelector('#appConfirmYes');
      const finish = value => {
        cancelButton.onclick = null;
        yesButton.onclick = null;
        dialog.oncancel = null;
        dialog.close();
        resolve(value);
      };
      cancelButton.onclick = () => finish(false);
      yesButton.onclick = () => finish(true);
      dialog.oncancel = event => { event.preventDefault(); finish(false); };
      dialog.showModal();
    });
  }
  function card(p, action = 'product') {
    const art = p.imageUrl
      ? `<img src="${e(p.imageUrl)}" alt="${e(p.name)}">`
      : e(p.icon);
    return `<article class="product"><div class="product-art" data-category="${e(p.category)}" aria-hidden="true">${art}</div><small>${e(p.category)}</small><h3>${e(p.name)}</h3><p>${e(p.description)}</p><div class="row between"><span class="price">${S.money(p.price)}</span><button class="primary" data-${action}="${p.id}" ${S.available(p.id) ? '' : 'disabled'}>${S.available(p.id) ? 'Add to Cart ↗' : 'Sold out'}</button></div></article>`;
  }
  function cartHTML(cart, editable = true) {
    if (!cart.length) return '<div class="empty">Your cart is taking a coffee break.<br>Add something from the menu.</div>';
    return cart.map((i, n) => `<div class="cartline"><div><strong>${e(i.name)}</strong><small>${e(i.size)} · ${e(i.flavor)}</small><small>${S.money(i.price)} each</small>${!S.available(i.id) ? '<small class="error">Currently unavailable</small>' : ''}${editable ? `<button class="textbutton" data-remove="${n}" aria-label="Remove ${e(i.name)}">Remove</button>` : ''}</div><div>${editable ? `<div class="qty"><button data-quantity="${n}" data-delta="-1" aria-label="Decrease ${e(i.name)} quantity">−</button><input class="cart-qty-input" data-cart-quantity="${n}" type="number" min="1" max="99" step="1" value="${i.qty}" aria-label="${e(i.name)} quantity"><button data-quantity="${n}" data-delta="1" aria-label="Increase ${e(i.name)} quantity" ${i.qty >= 99 ? 'disabled' : ''}>+</button></div>` : `<small>Quantity ${i.qty}</small>`}<strong>${S.money(i.price * i.qty)}</strong></div></div>`).join('');
  }
  function bindCart(root, cart, rerender) {
    root.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => { cart.splice(Number(b.dataset.remove), 1); rerender(); });
    root.querySelectorAll('[data-quantity]').forEach(b => b.onclick = () => {
      const index = Number(b.dataset.quantity);
      cart[index].qty = Math.min(99, cart[index].qty + Number(b.dataset.delta));
      if (cart[index].qty < 1) cart.splice(index, 1);
      rerender();
    });
    root.querySelectorAll('[data-cart-quantity]').forEach(input => {
      input.oninput = () => {
        const index = Number(input.dataset.cartQuantity);
        const entered = Number(input.value);
        if (!input.value || !Number.isInteger(entered) || entered < 1) return;
        cart[index].qty = Math.min(99, entered);
        const position = input.selectionStart;
        rerender();
        const replacement = root.querySelector(`[data-cart-quantity="${index}"]`);
        if (replacement) {
          replacement.focus();
          if (position !== null) replacement.setSelectionRange(position, position);
        }
      };
      input.onchange = () => {
        const index = Number(input.dataset.cartQuantity);
        const entered = Number(input.value);
        const quantity = Number.isInteger(entered) ? Math.min(99, Math.max(1, entered)) : 1;
        cart[index].qty = quantity;
        rerender();
      };
    });
  }
  function picker(cart, done) {
    const dialog = document.getElementById('productDialog');
    let product;
    dialog.innerHTML = `<form class="dialog-body" id="productForm"><div class="row between"><span class="eyebrow">Make it yours</span><button type="button" class="iconbutton" id="closeProduct" aria-label="Close product details">×</button></div><div id="detailArt" class="product-art" aria-hidden="true"></div><h2 id="detailName"></h2><p id="detailDescription"></p><div class="grid two"><label class="field">Flavor<select id="detailFlavor"></select></label><label class="field">Type<select id="detailSize"></select></label></div><label class="field">Quantity<div class="quantity-stepper"><button type="button" id="detailQtyMinus" aria-label="Decrease quantity">−</button><input id="detailQty" type="number" min="1" max="99" step="1" value="1" required aria-label="Quantity"><button type="button" id="detailQtyPlus" aria-label="Increase quantity">+</button></div></label><div class="summary-total"><span>Item total</span><strong id="detailTotal"></strong></div><button class="primary full">Add to cart →</button></form>`;
    const q = id => dialog.querySelector('#' + id);
    function price() { return product.price + Number(q('detailSize').selectedOptions[0].dataset.extra); }
    function update() { q('detailTotal').textContent = S.money(price() * Math.max(1, Number(q('detailQty').value) || 1)); }
    q('closeProduct').onclick = () => dialog.close();
    q('detailSize').onchange = update;
    q('detailQty').oninput = update;
    q('detailQty').onchange = () => {
      q('detailQty').value = Math.min(99, Math.max(1, Number(q('detailQty').value) || 1));
      update();
    };
    q('detailQtyMinus').onclick = () => {
      q('detailQty').value = Math.max(1, (Number(q('detailQty').value) || 1) - 1);
      update();
    };
    q('detailQtyPlus').onclick = () => {
      q('detailQty').value = Math.min(99, (Number(q('detailQty').value) || 1) + 1);
      update();
    };
    q('productForm').onsubmit = event => {
      event.preventDefault();
      const qty = Number(q('detailQty').value);
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) return;
      if (!S.available(product.id)) return toast('This item has just sold out. Choose another product.');
      const latest = S.products.find(p => p.id === product.id);
      if (JSON.stringify(latest) !== JSON.stringify(product)) { dialog.close(); done(); return toast('This product changed. Open it again to review the new options and price.'); }
      const size = q('detailSize').value, flavor = q('detailFlavor').value;
      const existing = cart.find(i => i.id === product.id && i.size === size && i.flavor === flavor);
      if (existing && existing.qty + qty > 99) return toast('A maximum of 99 of each item can be ordered.');
      if (existing) existing.qty += qty;
      else cart.push({ id: product.id, name: product.name, size, flavor, price: price(), qty });
      dialog.close();
      done();
      toast(product.name + ' added to your cart.');
    };
    return id => {
      product = S.products.find(p => p.id === id);
      if (!product || !S.available(id)) return toast('This item is unavailable.');
      q('detailName').textContent = product.name;
      q('detailDescription').textContent = product.description;
      if (product.imageUrl) {
        q('detailArt').innerHTML = `<img src="${e(product.imageUrl)}" alt="${e(product.name)}">`;
      } else {
        q('detailArt').textContent = product.icon;
        q('detailArt').removeAttribute('data-category');
      }
      q('detailArt').dataset.category = product.category;
      q('detailFlavor').innerHTML = product.flavors.map(f => `<option>${e(f)}</option>`).join('');
      q('detailSize').innerHTML = product.category === 'Snacks'
        ? '<option data-extra="0">Regular</option>'
        : '<option data-extra="0">Hot</option><option data-extra="0">Ice</option>';
      q('detailQty').value = 1;
      update();
      dialog.showModal();
    };
  }
  const badge = status => `<span class="pill ${e(status.toLowerCase())}">${e(status)}</span>`;
  const shortId = id => '#' + String(id).replace('ORD-', '').slice(0, 8).toUpperCase();
  window.IstiloUI = { toast, confirm, card, cartHTML, bindCart, picker, badge, shortId };
})();
