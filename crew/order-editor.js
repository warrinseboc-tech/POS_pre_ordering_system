(() => {
  'use strict';
  const S = Istilo, U = IstiloUI, e = S.escape;
  window.IstiloOrderEditor = {
    create(done) {
      const dialog = document.getElementById('orderEditDialog');
      let order, items, reason = '', error = '', busy = false;
      const product = item => S.products.find(p => p.id === item.id);
      function render() {
        dialog.innerHTML = `<form class="dialog-body" id="orderEditForm"><h2>Edit ${e(U.shortId(order.id))}</h2><p class="mini-note">Edit items before preparation. Existing item prices are retained. The total must stay the same when payment is under review or verified.</p><div id="editOrderItems">${items.map((item,index) => {
          const p = product(item);
          return `<section class="card" data-edit-row="${index}"><label class="field">Product<select data-edit-field="id">${S.products.filter(p => p.available || p.id === item.id).map(p => `<option value="${e(p.id)}" ${p.id === item.id ? 'selected' : ''}>${e(p.name)}</option>`).join('')}</select></label><div class="grid two"><label class="field">Size<select data-edit-field="size">${(p?.sizes || [{name:item.size}]).map(size => `<option ${size.name === item.size ? 'selected' : ''}>${e(size.name)}</option>`).join('')}</select></label><label class="field">Flavor<select data-edit-field="flavor">${(p?.flavors || [item.flavor]).map(flavor => `<option ${flavor === item.flavor ? 'selected' : ''}>${e(flavor)}</option>`).join('')}</select></label></div><label class="field">Quantity<input data-edit-field="qty" type="number" min="1" max="99" step="1" value="${item.qty}" required></label><div class="row between"><strong>${S.money(item.price * item.qty)}</strong><button type="button" class="textbutton" data-edit-remove="${index}">Remove item</button></div></section>`;
        }).join('')}</div><button type="button" class="outline" id="addEditItem" ${items.length >= 60 ? 'disabled' : ''}>Add item</button><div class="summary-total"><span>New total</span><strong>${S.money(S.total(items))}</strong></div><p class="mini-note">Original total: ${S.money(order.total)}</p><label class="field">Reason for change<textarea id="orderEditReason" maxlength="300" required>${e(reason)}</textarea></label><p class="error" role="alert">${e(error)}</p><div class="row"><button type="button" class="outline" id="discardOrderEdit">Discard changes</button><button class="primary" ${busy || !items.length ? 'disabled' : ''}>Save items</button></div></form>`;
        dialog.querySelector('#orderEditReason').oninput = event => { reason = event.target.value; };
        dialog.querySelectorAll('[data-edit-field]').forEach(input => input.onchange = () => {
          const item = items[Number(input.closest('[data-edit-row]').dataset.editRow)];
          const field = input.dataset.editField;
          if (field === 'qty') {
            const qty = Number(input.value);
            if (!Number.isInteger(qty) || qty < 1 || qty > 99) return input.reportValidity();
            item.qty = qty;
          } else {
            item[field] = input.value;
            const p = product(item);
            if (field === 'id') { item.name = p.name; item.size = p.sizes[0].name; item.flavor = p.flavors[0]; }
            const old = order.items.find(i => i.id === item.id && i.size === item.size && i.flavor === item.flavor);
            item.price = old ? old.price : Math.round((p.price + p.sizes.find(size => size.name === item.size).extra) * 100) / 100;
          }
          render();
        });
        dialog.querySelectorAll('[data-edit-remove]').forEach(button => button.onclick = () => { items.splice(Number(button.dataset.editRemove),1); render(); });
        dialog.querySelector('#addEditItem').onclick = () => {
          const p = S.products.find(p => p.available);
          if (!p) return U.toast('No products are available.');
          items.push({id:p.id,name:p.name,size:p.sizes[0].name,flavor:p.flavors[0],qty:1,price:Math.round((p.price + p.sizes[0].extra) * 100) / 100});
          render();
        };
        dialog.querySelector('#discardOrderEdit').onclick = () => { if (!busy) dialog.close(); };
        dialog.querySelector('form').onsubmit = async event => {
          event.preventDefault();
          if (busy) return;
          reason = dialog.querySelector('#orderEditReason').value.trim();
          if (!reason) { error = 'Enter a reason for the change.'; render(); return; }
          busy = true; error = '';
          render();
          dialog.querySelectorAll('input,select,textarea,button').forEach(control => { control.disabled = true; });
          try {
            await S.editOrderItems(order.id,{items,reason,expectedUpdatedAt:order.updatedAt});
            dialog.close(); done(); U.toast('Order items updated.');
          } catch (err) { error = err.message; }
          finally { busy = false; if (dialog.open) render(); }
        };
      }
      dialog.addEventListener('cancel',event => { if (busy) event.preventDefault(); });
      return id => {
        order = S.read('orders',[]).find(o => o.id === id);
        if (!order || order.status !== 'Pending' || order.punchedAt) return U.toast('Items can only be edited before preparation starts.');
        items = structuredClone(order.items); reason = ''; error = ''; busy = false;
        render(); dialog.showModal();
      };
    }
  };
})();
