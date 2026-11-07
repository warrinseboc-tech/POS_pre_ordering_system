(() => {
  const S=Istilo,U=IstiloUI,e=S.escape;
  function panel(order) {
    if(order.status==='Cancelled')return '<div class="card payment-panel"><h2>Order cancelled</h2><p>Do not send another payment. If you already transferred funds, contact the shop about your payment and refund.</p></div>';
    const wallet=S.wallets.find(w=>w.method===order.payment);
    const verified=S.isPaid(order), review=order.paymentStatus==='Under review', rejected=order.paymentStatus==='Rejected';
    const qr=verified||review?'':`<figure class="payment-qr"><img src="/api/wallets/${encodeURIComponent(order.payment)}/qr" alt="${e(order.payment)} payment QR code"><figcaption>Scan with your ${e(order.payment)} app</figcaption></figure>`;
    return `<div class="card payment-panel"><span class="eyebrow">${e(order.payment)} transfer</span>${qr}<h2 style="margin:14px 0">${verified?'Payment verified':review?'Receipt under review':'Complete your payment'}</h2><div class="row between"><strong>Amount due</strong><strong class="total">${S.money(order.total)}</strong></div><dl class="contact-list"><dt>Send to</dt><dd>${e(wallet?.name||'Contact the shop')}</dd><dt>${e(order.payment)} account number</dt><dd><strong>${e(wallet?.number||'Not configured')}</strong></dd></dl>${verified?'<div class="notice">Payment and proof verified. Your order is now available to the crew for manual acceptance.</div>':review?'<div class="notice">Your image was received. The crew will check the transfer against the receiving wallet. Preparation starts only after the crew verifies your payment.</div>':`<div class="notice">Transfer the exact total using your ${e(order.payment)} app. Check the recipient name and number before sending. Then upload the receipt below.</div>${rejected?`<p class="error">Proof rejected: ${e(order.proof?.note||'Contact the shop or submit corrected proof.')}</p>`:''}<form id="proofForm" data-order="${e(order.id)}"><label class="field">Transferred amount (₱)<input name="amount" type="number" step="0.01" value="${order.total}" readonly></label><label class="field">Transaction reference<input name="reference" type="text" inputmode="numeric" minlength="13" maxlength="13" pattern="[0-9]{13}" title="Enter exactly 13 numbers" required placeholder="13-digit wallet reference"></label><label class="field">Receipt image<input name="proof" type="file" accept="image/png,image/jpeg,image/webp" required></label><small>PNG, JPEG, or WebP · Up to 5 MB · Minimum 100×100 pixels</small><img id="proofPreview" class="proof-preview" alt="Selected payment receipt" hidden><label class="checkbox" style="margin-top:18px"><input type="checkbox" required>I sent the exact amount to the account above and this is my transaction receipt.</label><button class="primary full" style="margin-top:18px">Submit payment proof</button><p id="proofError" class="error" role="alert"></p></form>`}${order.proof?`<a class="textbutton" href="/api/payments/proofs/${e(order.proof.id)}/image" target="_blank" rel="noopener">View your submitted receipt ↗</a>`:''}</div>`;
  }
  function bind(root,updated) {
    const form=root.querySelector('#proofForm');
    if(!form)return;
    let preview;
    const reference=form.elements.reference;
    reference.oninput=()=>{ reference.value=reference.value.replace(/[^0-9]/g,'').slice(0,13); };
    form.elements.proof.onchange=()=>{
      if(preview)URL.revokeObjectURL(preview);
      const file=form.elements.proof.files[0],img=root.querySelector('#proofPreview');
      img.hidden=!file;
      if(file){preview=URL.createObjectURL(file);img.src=preview;}
    };
    form.onsubmit=async event=>{
      event.preventDefault();const button=form.querySelector('button');button.disabled=true;
      try{await S.uploadProof(form.dataset.order,new FormData(form));if(preview)URL.revokeObjectURL(preview);updated();U.toast('Proof uploaded. Your order is waiting for payment verification.');}
      catch(err){root.querySelector('#proofError').textContent=err.message;button.disabled=false;}
    };
  }
  window.IstiloPayments={panel,bind};
})();
