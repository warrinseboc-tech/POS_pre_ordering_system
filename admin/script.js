(async () => {
await Istilo.ready;

const $ = id => document.getElementById(id);
const S = window.Istilo;
if (typeof Chart === 'function') { Chart.defaults.color = '#dec1a0'; Chart.defaults.borderColor = '#514031'; Chart.defaults.font.family = 'Arial, Helvetica, sans-serif'; }
let statusTimer;
function notify(message) {
  $('adminStatus').textContent = message;
  $('adminStatus').hidden = false;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { $('adminStatus').hidden = true; }, 6000);
}
async function attempt(action) { try { await action(); } catch (error) { notify(error.message); } }

const money = value => "₱" + Number(value).toLocaleString("en-PH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const today = () => {
  return S.today(new Date());
};

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;",
    '"':"&quot;", "'":"&#39;"
  })[c]);
}

let products = S.products;
let expenses = S.read('expenses', []);
let transactions = [];
let preorders = [];
let staff = S.staff();

let dashboardChart = null;
let analyticsChart = null;

async function save() {
  try { await S.write('expenses', expenses); return true; }
  catch (error) { notify(error.message); refresh(); return false; }
}

function chartFallback(id, rows) {
  const canvas = $(id), parent = canvas.parentElement;
  canvas.hidden = true;
  let fallback = parent.querySelector('.chart-fallback');
  if (!fallback) { fallback = document.createElement('div'); fallback.className = 'chart-fallback'; parent.append(fallback); }
  fallback.innerHTML = '<p>Chart library unavailable. Summary data:</p>' + (rows.length ? rows.map(([label,value]) => `<div><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></div>`).join('') : '<p>No completed sales yet.</p>');
}

function createTable(headers, rows) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows.length ? rows.join("") :
            `<tr><td colspan="${headers.length}">No records found.</td></tr>`}
        </tbody>
      </table>
    </div>`;
}

function summaryCards(element, cards) {
  $(element).innerHTML = cards.map(([label,value]) => `
    <div class="stat">
      <p>${escapeHTML(label)}</p>
      <strong>${escapeHTML(value)}</strong>
    </div>
  `).join("");
}

function totalSales() {
  return transactions.reduce((sum,t) => sum + Number(t.total || 0),0);
}

function totalExpenses() {
  return expenses.reduce((sum,e) => sum + Number(e.amount || 0),0);
}

// NAVIGATION
document.querySelectorAll(".nav").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));

    button.classList.add("active");
    $(button.dataset.page).classList.add("active");
    $("pageTitle").textContent = button.textContent.trim();

    refresh();
  });
});

// DASHBOARD
function renderDashboard() {
  const sales = totalSales();
  const spending = totalExpenses();

  summaryCards("dashboardStats", [
    ["Total Sales",money(sales)],
    ["Total Expenses",money(spending)],
    ["Estimated Net Earnings",money(sales-spending)],
    ["Total Pre-Orders",preorders.length]
  ]);

  const recent = [...expenses].sort((a,b) =>
    b.date.localeCompare(a.date)
  ).slice(0,5);

  $("recentExpenses").innerHTML = createTable(
    ["Expense","Category","Amount","Date"],
    recent.map(e => `
      <tr>
        <td>${escapeHTML(e.name)}</td>
        <td>${escapeHTML(e.category)}</td>
        <td>${money(e.amount)}</td>
        <td>${escapeHTML(e.date)}</td>
      </tr>
    `)
  );

  const labels = [];
  const salesData = [];
  const expenseData = [];

  for (let i=6; i>=0; i--) {
    const date = new Date(today() + 'T12:00:00+08:00');
    date.setUTCDate(date.getUTCDate()-i);

    const key = [
      date.getUTCFullYear(),
      String(date.getUTCMonth()+1).padStart(2,"0"),
      String(date.getUTCDate()).padStart(2,"0")
    ].join("-");

    labels.push(date.toLocaleDateString("en-US",{timeZone:"Asia/Manila",month:"short",day:"numeric"}));

    salesData.push(transactions
      .filter(t => S.today(t.date) === key)
      .reduce((sum,t) => sum + Number(t.total || 0),0));

    expenseData.push(expenses
      .filter(e => e.date === key)
      .reduce((sum,e) => sum + Number(e.amount),0));
  }

  if (dashboardChart) dashboardChart.destroy();
  if (typeof Chart !== 'function') {
    chartFallback('dashboardChart', labels.map((label,i) => [label, money(salesData[i]) + ' sales / ' + money(expenseData[i]) + ' expenses']));
    return;
  }

  dashboardChart = new Chart($("dashboardChart"), {
    type:"bar",
    data:{
      labels,
      datasets:[
        {label:"Sales",data:salesData,backgroundColor:"#5c4033"},
        {label:"Expenses",data:expenseData,backgroundColor:"#c68b59"}
      ]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      scales:{y:{beginAtZero:true}}
    }
  });
}

// PRODUCT MANAGEMENT
function renderProducts() {
  $("productsTable").innerHTML = createTable(
    ["Product","Category","Price","Status","Actions"],
    products.map(p => `
      <tr>
        <td>${escapeHTML(p.name)}</td>
        <td>${escapeHTML(p.category)}</td>
        <td>${money(p.price)}</td>
        <td>
          <span class="status ${S.available(p.id) ? "available" : ""}">
            ${S.available(p.id) ? "Available" : "Unavailable"}
          </span>
        </td>
        <td>
          <button class="action" data-edit-product="${escapeHTML(p.id)}">Edit</button>
          <button class="action" data-toggle-product="${escapeHTML(p.id)}">
            ${S.available(p.id) ? "Deactivate" : "Activate"}
          </button>
        </td>
      </tr>
    `)
  );
  $('productsTable').querySelectorAll('[data-edit-product]').forEach(b => b.onclick = () => editProduct(b.dataset.editProduct));
  $('productsTable').querySelectorAll('[data-toggle-product]').forEach(b => b.onclick = () => toggleProduct(b.dataset.toggleProduct));
}

$("addProductBtn").addEventListener("click", () => {
  $("productForm").reset();
  $("editProductId").value = "";
  $("productFormTitle").textContent = "Add Product";
  $('productFlavors').value = 'Original';
  $('productLargeExtra').value = '20';
  $("productDialog").showModal();
});

$("cancelProductBtn").addEventListener("click", () => {
  $("productDialog").close();
});

window.editProduct = async function(id) {
  const p = products.find(item => item.id === id);
  if (!p) return;

  $("editProductId").value = p.id;
  $("productName").value = p.name;
  $("productCategory").value = p.category;
  $("productDescription").value = p.description || "";
  $("productPrice").value = p.price;
  $("productStatus").value = String(S.available(p.id));
  $('productFlavors').value = p.flavors.join(', ');
  $('productLargeExtra').value = p.sizes.find(s => s.name === 'Large')?.extra ?? 20;
  $("productFormTitle").textContent = "Edit Product";
  $("productDialog").showModal();
};

$("productForm").addEventListener("submit", async event => {
  event.preventDefault();

  const name = $("productName").value.trim();
  const price = Number($("productPrice").value);
  const id = $("editProductId").value;

  if (!name || !Number.isFinite(price) || price <= 0) {
    alert("Enter a valid product name and price.");
    return;
  }

  const data = {
    name,
    category:$("productCategory").value,
    description:$("productDescription").value.trim(),
    price,
    id: id || undefined,
    flavors: $('productFlavors').value.split(','),
    largeExtra: Number($('productLargeExtra').value)
  };

  attempt(async () => {
    const product = await S.saveProduct(data);
    const availability = S.read('availability', {});
    availability[product.id] = $('productStatus').value === 'true';
    await S.write('availability', availability);
    $('productDialog').close();
    refresh();
    notify('Product saved to the customer and crew menus.');
  });
});

window.toggleProduct = async function(id) {
  attempt(async () => { const availability = S.read('availability', {}); availability[id] = !S.available(id); await S.write('availability', availability); refresh(); notify('Availability updated in all three portals.'); });
};

// EXPENSES MANAGEMENT
function renderExpenses() {
  const currentMonth = today().slice(0,7);

  const monthly = expenses
    .filter(e => e.date.startsWith(currentMonth))
    .reduce((sum,e) => sum+Number(e.amount),0);

  const largest = expenses.length
    ? Math.max(...expenses.map(e => Number(e.amount)))
    : 0;

  summaryCards("expenseStats",[
    ["Total Expenses",money(totalExpenses())],
    ["This Month",money(monthly)],
    ["Expense Records",expenses.length],
    ["Largest Expense",money(largest)]
  ]);

  const sorted = [...expenses].sort((a,b) =>
    b.date.localeCompare(a.date)
  );

  $("expensesTable").innerHTML = createTable(
    ["Expense","Category","Amount","Date","Description","Actions"],
    sorted.map(e => `
      <tr>
        <td>${escapeHTML(e.name)}</td>
        <td>${escapeHTML(e.category)}</td>
        <td>${money(e.amount)}</td>
        <td>${escapeHTML(e.date)}</td>
        <td>${escapeHTML(e.description)}</td>
        <td>
          <button class="action" data-edit-expense="${escapeHTML(e.id)}">Edit</button>
          <button class="action" data-delete-expense="${escapeHTML(e.id)}">Delete</button>
        </td>
      </tr>
    `)
  );
}

$("addExpenseBtn").addEventListener("click", () => {
  $("expenseForm").reset();
  $("editExpenseId").value = "";
  $("expenseDate").value = today();
  $("expenseFormTitle").textContent = "Add Expense";
  $("expenseDialog").showModal();
});

$("cancelExpenseBtn").addEventListener("click", () => {
  $("expenseDialog").close();
});

window.editExpense = async function(id) {
  const e = expenses.find(item => item.id === id);
  if (!e) return;

  $("editExpenseId").value = e.id;
  $("expenseName").value = e.name;
  $("expenseCategory").value = e.category;
  $("expenseAmount").value = e.amount;
  $("expenseDate").value = e.date;
  $("expenseDescription").value = e.description || "";
  $("expenseFormTitle").textContent = "Edit Expense";
  $("expenseDialog").showModal();
};

$("expenseForm").addEventListener("submit", async event => {
  event.preventDefault();

  const id = $("editExpenseId").value;
  const name = $("expenseName").value.trim();
  const amount = Number($("expenseAmount").value);
  const date = $("expenseDate").value;

  if (!name || !date || !Number.isFinite(amount) || amount <= 0) {
    alert("Please enter valid expense details.");
    return;
  }

  const data = {
    name,
    category:$("expenseCategory").value,
    amount,
    date,
    description:$("expenseDescription").value.trim()
  };

  if (id) {
    const index = expenses.findIndex(e => e.id === id);
    if (index >= 0) expenses[index] = {...expenses[index],...data};
  } else {
    expenses.push({
      id:S.uid('EXP'),
      ...data
    });
  }

  if (!await save()) return;
  $("expenseDialog").close();
  refresh();
});

window.deleteExpense = async function(id) {
  if (!confirm("Are you sure you want to delete this expense?")) return;
  expenses = expenses.filter(e => e.id !== id);
  if (!await save()) return;
  refresh();
};

// PRE-ORDER MANAGEMENT
function renderOrders() {
  $("ordersTable").innerHTML = createTable(
    ["Order ID","Customer","Total","Status","Action"],
    preorders.map((o,index) => `
      <tr>
        <td>${escapeHTML(o.id)}</td>
        <td>${escapeHTML(o.customer || "Guest")}<small class="order-items">${o.items.map(i => `${i.qty} × ${escapeHTML(i.name)} (${escapeHTML(i.size)}, ${escapeHTML(i.flavor)})`).join('<br>')}</small>${o.notes ? `<small class="order-items">Note: ${escapeHTML(o.notes)}</small>` : ''}</td>
        <td>${money(o.total)}</td>
        <td>${escapeHTML(o.status)}<small class="order-items">${o.payment === 'Cash' || o.collectedAt ? 'Paid' : 'Payment due'}</small></td>
        <td>
          <select data-order="${escapeHTML(o.id)}" aria-label="Status for ${escapeHTML(o.id)}">
            ${[o.status, ...(S.transitions[o.status] || []).filter(next => !(next === 'Preparing' && o.source === 'Customer' && !o.punchedAt))].map(status => `
              <option value="${status}" ${o.status === status ? "selected" : ""} ${status === 'Completed' && o.payment === 'Pay at counter' && !o.collectedAt ? 'disabled' : ''}>
                ${status}
              </option>
            `).join("")}
          </select>
        </td>
      </tr>
    `)
  );
  $('ordersTable').querySelectorAll('[data-order]').forEach(select => select.onchange = () => updateOrderStatus(select.dataset.order, select.value));
}

window.updateOrderStatus = async function(id,status) {
  await attempt(async () => { await S.setStatus(id, status); notify('Order status updated in customer and crew screens.'); });
  refresh();
};

// SALES ANALYTICS
function renderAnalytics() {
  const sold = {};

  transactions.forEach(t => {
    (t.items || []).forEach(item => {
      const name = item.name || "Unknown Product";
      sold[name] = (sold[name] || 0)+Number(item.quantity || 0);
    });
  });

  const ranked = Object.entries(sold).sort((a,b) => b[1]-a[1]);

  summaryCards("analyticsStats",[
    ["Total Revenue",money(totalSales())],
    ["Completed Transactions",transactions.length],
    ["Average Order Value",money(transactions.length ? totalSales()/transactions.length : 0)],
    ["Best-Selling Product",ranked[0]?.[0] || "None"]
  ]);

  $("productPerformance").innerHTML = createTable(
    ["Product","Quantity Sold"],
    ranked.map(([name,quantity]) => `
      <tr>
        <td>${escapeHTML(name)}</td>
        <td>${quantity}</td>
      </tr>
    `)
  );

  if (analyticsChart) analyticsChart.destroy();
  if (typeof Chart !== 'function') { chartFallback('analyticsChart', ranked.map(([name,quantity]) => [name, quantity + ' sold'])); return; }

  analyticsChart = new Chart($("analyticsChart"),{
    type:"bar",
    data:{
      labels:ranked.slice(0,7).map(item => item[0]),
      datasets:[{
        label:"Units Sold",
        data:ranked.slice(0,7).map(item => item[1]),
        backgroundColor:"#c68b59"
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      scales:{y:{beginAtZero:true}}
    }
  });
}

// REPORTS
function renderReports() {
  const rows = [
    ...transactions.map(t => ({
      type:"Sale",
      name:t.id,
      date:t.date,
      amount:Number(t.total)
    })),
    ...expenses.map(e => ({
      type:"Expense",
      name:e.name,
      date:e.date,
      amount:Number(e.amount)
    }))
  ];

  $("reportsTable").innerHTML = createTable(
    ["Type","Reference","Date","Amount"],
    rows.map(r => `
      <tr>
        <td>${escapeHTML(r.type)}</td>
        <td>${escapeHTML(r.name)}</td>
        <td>${escapeHTML(r.date)}</td>
        <td>${money(r.amount)}</td>
      </tr>
    `)
  );
}

$("exportBtn").addEventListener("click", () => {
  const rows = [
    ["Type","Reference","Date","Amount"],
    ...transactions.map(t => ["Sale",t.id,t.date,t.total]),
    ...expenses.map(e => ["Expense",e.name,e.date,e.amount])
  ];

  const csv = rows.map(row => row.map(value => {
    // Prevent spreadsheet applications interpreting text as formulas.
    let cell = String(value ?? "");
    if (/^[\s]*[=+\-@]/.test(cell)) cell = "'" + cell;
    return `"${cell.replace(/"/g,'""')}"`;
  }).join(",")).join("\r\n");

  const blob = new Blob(["\uFEFF",csv],{
    type:"text/csv;charset=utf-8"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ISTILO-Financial-Report.csv";
  link.click();

  setTimeout(() => URL.revokeObjectURL(url),1000);
});

// CREW ACCOUNT MANAGEMENT
function renderStaff() {
  $("staffTable").innerHTML = createTable(
    ["Staff Name","Employee ID","Role","Status","Actions"],
    staff.map(s => `
      <tr>
        <td>${escapeHTML(s.name)}</td>
        <td>${escapeHTML(s.employeeId)}</td>
        <td>Crew</td>
        <td>${s.active ? "Active" : "Inactive"}</td>
        <td>
          <button class="action" data-toggle-staff="${escapeHTML(s.employeeId)}">
            ${s.active ? "Deactivate" : "Activate"}
          </button>
        </td>
      </tr>
    `)
  );
  $('staffTable').querySelectorAll('[data-toggle-staff]').forEach(b => b.onclick = () => toggleStaff(b.dataset.toggleStaff));
}

$("addStaffBtn").addEventListener("click", () => {
  $('staffForm').reset();
  $('staffDialog').showModal();
});

$('cancelStaffBtn').onclick = () => $('staffDialog').close();
$('staffForm').onsubmit = async event => {
  event.preventDefault();
  attempt(async () => {
    const list = S.staff(), name = $('staffName').value.trim(), employeeId = $('staffEmployeeId').value.trim().toUpperCase();
    if (!name || !/^[A-Z0-9_-]+$/.test(employeeId)) throw new Error('Enter a name and a valid employee ID.');
    if (list.some(s => s.employeeId === employeeId)) throw new Error('That employee ID already exists.');
    list.push({ id: S.uid('STAFF'), employeeId, name, password: $('staffPassword').value, active: true });
    await S.write('staff', list);
    $('staffDialog').close(); refresh(); notify('Crew member added. Share the initial password privately.');
  });
};

window.toggleStaff = async function(id) {
  attempt(async () => { const list = S.staff(), member = list.find(s => s.employeeId === id); if (!member) throw new Error('Crew member not found.'); member.active = !member.active; await S.write('staff', list); refresh(); notify('Crew access updated.'); });
};

// INITIALIZE
function refresh() {
  const signedIn=S.user?.role==='admin';
  $('adminLogin').hidden=signedIn; $('adminWorkspace').hidden=!signedIn;
  if(!signedIn)return;
  products = S.products;
  expenses = S.read('expenses', []);
  staff = S.staff();
  preorders = S.read('orders', []).filter(o => o.source === 'Customer');
  const completed = S.sales();
  transactions = completed;
  renderDashboard();
  renderProducts();
  renderExpenses();
  renderOrders();
  renderAnalytics();
  renderReports();
  renderStaff();
  renderPaymentProofs();
  $('expensesTable').querySelectorAll('[data-edit-expense]').forEach(b=>b.onclick=()=>editExpense(b.dataset.editExpense));
  $('expensesTable').querySelectorAll('[data-delete-expense]').forEach(b=>b.onclick=()=>deleteExpense(b.dataset.deleteExpense));
}

function renderPaymentProofs() {
  $('paymentProofs').textContent='Payment verification is handled by crew in the Ordering screen.';
}

$('adminLoginForm').onsubmit=async event=>{event.preventDefault();try{await S.login($('adminEmployee').value,$('adminPassword').value,'admin');$('adminPassword').value='';$('adminLoginError').textContent='';refresh();}catch(err){$('adminLoginError').textContent=err.message;}};
$('adminLogout').onclick=()=>attempt(async()=>{await S.logout();document.querySelectorAll('dialog[open]').forEach(d=>d.close());refresh();});

refresh();

window.addEventListener('storage', event => {
  if (!Object.values(S.keys).includes(event.key)) return;
  // Do not replace an in-progress form or an open product dialog.
  if (document.querySelector('dialog[open]') || document.activeElement?.matches('input,textarea,select')) notify('Shared data changed. Close this form or switch pages to refresh.');
  else refresh();
});
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', refresh));

})();
