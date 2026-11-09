/* API-backed portal data. The SQL database is authoritative; no local demo records. */
(() => {
  'use strict';
  const portal = ['admin','crew'].includes(location.pathname.split('/')[1]) ? location.pathname.split('/')[1] : 'customer';
  const categories = [['Coffee','☕','Espresso, made your way.'],['Milk Tea','🧋','Tea, pearls, and a moment to yourself.'],['Frappe','🥤','Cool, creamy, and full of flavor.'],['Latte','☕','Your everyday espresso companion.'],['Matcha','🍵','Earthy matcha meets creamy comfort.'],['Snacks','🥐','Small bites for your coffee break.']].map(([name,icon,description])=>({name,icon,description}));
  const keys=Object.fromEntries(['products','orders','availability','inquiries','shifts','profiles','staff','expenses','inventory','inventoryAdjustments','proofs'].map(name=>[name,'api:'+name]));
  let state={products:[],orders:[],availability:{},staff:[],inquiries:[],shifts:[],profiles:{},expenses:[],inventory:[],inventoryAdjustments:[],proofs:[],business:{},wallets:[],user:null,customer:null,csrf:''};
  let refreshing=null, mutating=0;
  async function api(path, options={}) {
    const headers={'X-Portal':portal,'X-CSRF-Token':state.csrf,...options.headers};
    if (options.body && !(options.body instanceof FormData)) { headers['Content-Type']='application/json'; options.body=JSON.stringify(options.body); }
    let response;
    try { response=await fetch('/api'+path,{credentials:'same-origin',...options,headers}); }
    catch { throw new Error('Cannot reach the Python server. Check your connection and try again.'); }
    let data;
    try { data=await response.json(); } catch { throw new Error('Open the portal using the Python server at http://127.0.0.1:5050, not Live Server.'); }
    if (!response.ok) {
      const message = [404,405].includes(response.status) && /^\/auth\/customer\/(register|verify-email|resend-otp|registration-status)$/.test(path)
        ? 'Email verification is unavailable on this server. Restart backend/app.py, then refresh this page.'
        : data.error||'Request failed.';
      const error=new Error(message); error.status=response.status; error.resendAfter=data.resendAfter; throw error;
    }
    return data;
  }
  async function refresh(emit=false) {
    if (refreshing) return refreshing;
    refreshing=(async()=>{
      const next=await api('/state'), previous=state;
      if (portal==='crew' && next.user && typeof next.onShift!=='boolean') throw new Error('The Python server is running an older version. Restart backend/app.py to reconnect orders and shifts.');
      state=next;
      if (emit) {
        const changed=Object.keys(keys).filter(name=>JSON.stringify(previous[name])!==JSON.stringify(next[name]));
        if ((previous.acceptingOrders!==next.acceptingOrders || previous.onShift!==next.onShift || JSON.stringify(previous.user)!==JSON.stringify(next.user)) && !changed.includes('staff')) changed.push('staff');
        if (changed.length) {
          const key=changed.includes('orders')?'orders':changed[0];
          window.dispatchEvent(new StorageEvent('storage',{key:keys[key]}));
          window.dispatchEvent(new CustomEvent('istilo:updated',{detail:changed}));
        }
      }
      return state;
    })().finally(()=>{refreshing=null;});
    return refreshing;
  }
  async function mutate(path, method='POST', body={}) {
    mutating++;
    try { if(refreshing)await refreshing; const data=await api(path,{method,body}); await refresh(false); return data; }
    finally { mutating--; }
  }
  const clone=value=>structuredClone(value);
  const read=(name,fallback)=>clone(state[name]??fallback);
  const uid=prefix=>prefix+'-'+crypto.randomUUID();
  const money=n=>'₱'+Number(n).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const total=cart=>cart.reduce((n,i)=>n+Math.round(i.price*100)*i.qty,0)/100;
  const available=id=>state.products.some(p=>p.id===id&&p.available);
  const transitions={Pending:['Preparing','Cancelled'],Preparing:['Ready','Cancelled'],Ready:['Completed'],Completed:[],Cancelled:[]};
  async function write(name,value) {
    if (name==='availability') {
      for (const [id,available] of Object.entries(value)) if (state.availability[id]!==available) await mutate('/products/'+encodeURIComponent(id)+'/availability','PATCH',{available});
    } else if (name==='profiles') {
      await mutate('/profile','PATCH',value[state.user.employeeId]);
    } else if (name==='inquiries') {
      for (const entry of value) {
        const old=state.inquiries.find(i=>i.id===entry.id);
        if (!old) await mutate('/inquiries','POST',entry);
        else if (JSON.stringify(old)!==JSON.stringify(entry)) await mutate('/inquiries/'+entry.id,'PATCH',entry);
      }
    } else if (name==='shifts') {
      const opened=value.find(s=>!state.shifts.some(old=>old.id===s.id));
      const ended=value.find(s=>s.end&&state.shifts.some(old=>old.id===s.id&&!old.end));
      if (opened) await mutate('/shifts/in');
      if (ended) await mutate('/shifts/out','POST',{note:ended.note});
    } else if (name==='expenses') {
      const before=clone(state.expenses);
      for (const entry of value) {
        const old=before.find(i=>i.id===entry.id);
        if (!old||JSON.stringify(old)!==JSON.stringify(entry)) await mutate('/expenses','POST',entry);
      }
      for (const old of before) if (!value.some(i=>i.id===old.id)) await mutate('/expenses/'+old.id,'DELETE');
    } else if (name==='staff') {
      for (const entry of value) {
        const old=state.staff.find(i=>i.id===entry.id);
        if (!old) await mutate('/staff','POST',entry);
        else if (old.active!==entry.active) await mutate('/staff/'+entry.id,'PATCH',{active:entry.active});
      }
    } else throw new Error('This data must be changed through its dedicated server route.');
    return read(name,[]);
  }
  async function addOrder(cart,details) {
    // Preserve the same key across retries of an unchanged order request.
    const signature=JSON.stringify({cart,details});
    if (addOrder.signature!==signature) { addOrder.signature=signature; addOrder.key=uid('REQ'); }
    const data=await mutate('/orders','POST',{...details,items:cart,requestKey:addOrder.key});
    addOrder.signature=null;
    return data.order;
  }
  function syncCart(cart) { cart.forEach(item=>{const p=state.products.find(p=>p.id===item.id);if(!p)return;item.name=p.name;if(['Hot','Ice','Regular'].includes(item.size)){item.price=p.price;}else{const size=p.sizes.find(s=>s.name===item.size);if(size)item.price=Math.round((p.price+size.extra)*100)/100;}}); }
  const store={ categories,keys,read,write,api,refresh,mutate,uid,money,escape,total,available,transitions,syncCart,
    get acceptingOrders(){return state.acceptingOrders === true;},
    get onShift(){return state.onShift === true;},get products(){return clone(state.products);},get business(){return clone(state.business);},get user(){return clone(state.user);},get customer(){return clone(state.customer);},get wallets(){return clone(state.wallets);},
    staff:()=>read('staff',[]),crewMember:id=>state.staff.find(s=>s.employeeId===id&&s.active),
    saveProduct:async data=>(await mutate('/products','POST',data)).product,
    addOrder,counterOrder:(cart,details)=>addOrder(cart,{...details,source:'Counter'}),
    isPaid:o=>o.paymentStatus==='Verified',
    editOrderItems:(id,body)=>mutate('/orders/'+id+'/items','PATCH',body),
    punchOrder:id=>mutate('/orders/'+id+'/punch'),
    setStatus:(id,status)=>mutate('/orders/'+id+'/status','POST',{status}),
    deleteOrder:id=>mutate('/orders/'+encodeURIComponent(id),'DELETE'),
    recordPayment:async(id,paid)=>(await mutate('/orders/'+id+'/cash','POST',{paid})).order,
    login:async(employee,password,role=portal)=>{await mutate('/auth/login','POST',{employee,password,role});return store.user;},
    customerLogin:async(identifier,password)=>(await mutate('/auth/customer/login','POST',{identifier,password})).user,
    customerRegister:(name,email,phone,password,terms=false)=>mutate('/auth/customer/register','POST',{name,email,phone,password,terms}),
    customerVerifyEmail:code=>mutate('/auth/customer/verify-email','POST',{code}),
    customerResendOTP:()=>mutate('/auth/customer/resend-otp'),
    customerRegistrationStatus:()=>api('/auth/customer/registration-status'),
    customerResetPassword:(identifier,password)=>mutate('/auth/customer/reset-password','POST',{identifier,password}),
    customerVerifyPassword:code=>mutate('/auth/customer/reset-password/verify','POST',{code}),
    customerResendPasswordOTP:()=>mutate('/auth/customer/reset-password/resend'),
    updateCustomerProfile:async(data)=>(await mutate('/auth/customer/profile','PATCH',data)).user,
    logout:()=>mutate('/auth/logout'),
    uploadProof:(id,body)=>mutate('/orders/'+id+'/proof','POST',body),
    reviewProof:(id,body)=>mutate('/payments/proofs/'+id+'/review','POST',body),
    sales:()=>state.orders.filter(o=>o.status==='Completed'&&o.paymentStatus==='Verified').map(o=>({...o,date:o.updatedAt||o.time,items:o.items.map(i=>({...i,quantity:i.qty}))})),
    date:value=>new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}),
    today:value=>new Date(value).toLocaleDateString('en-CA',{timeZone:'Asia/Manila'})
  };
  window.Istilo=store;
  store.ready=refresh().catch(error=>{
    const box=document.createElement('p');box.className='notice';box.style.margin='24px';box.textContent=error.message+' Start the backend, then refresh this page.';document.body.prepend(box);throw error;
  });
  setInterval(()=>{if(!mutating&&document.visibilityState!=='hidden')refresh(true).catch(()=>{});},2500);
  window.addEventListener('focus',()=>{if(!mutating)refresh(true).catch(()=>{});});
})();
