
const $ = id => document.getElementById(id);

const money = value => "₱" + Number(value).toLocaleString("en-PH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
};

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;",
    '"':"&quot;", "'":"&#39;"
  })[c]);
}

function load(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

const initialProducts = [
  {id:1,name:"Iced Americano",category:"Coffee Series",price:90,available:true,description:"Espresso with chilled water"},
  {id:2,name:"Caramel Macchiato",category:"Coffee Series",price:130,available:true,description:"Espresso, milk and caramel"},
  {id:3,name:"Wintermelon",category:"Milktea Series",price:110,available:true,description:"Creamy wintermelon milk tea"},
  {id:4,name:"Chocolate Frappe",category:"Frappe Series",price:145,available:true,description:"Blended chocolate beverage"},
  {id:5,name:"Spanish Latte",category:"Latte Series",price:135,available:true,description:"Sweet espresso latte"},
  {id:6,name:"Matcha Latte",category:"Matcha Series",price:140,available:true,description:"Matcha with fresh milk"},
  {id:7,name:"Strawberry Fruit Tea",category:"Fruit Series",price:115,available:true,description:"Refreshing strawberry tea"},
  {id:8,name:"French Fries",category:"Snacks",price:85,available:true,description:"Crispy seasoned fries"}
];

let products = load("istilo_products", initialProducts);
let expenses = load("istilo_expenses", []);
let transactions = load("istilo_transactions", []);
let preorders = load("istilo_preorders", []);
let staff = load("istilo_staff", []);

let dashboardChart = null;
let analyticsChart = null;

function save() {
  localStorage.setItem("istilo_products", JSON.stringify(products));
  localStorage.setItem("istilo_expenses", JSON.stringify(expenses));
  localStorage.setItem("istilo_transactions", JSON.stringify(transactions));
  localStorage.setItem("istilo_preorders", JSON.stringify(preorders));
  localStorage.setItem("istilo_staff", JSON.stringify(staff));
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
    const date = new Date();
    date.setDate(date.getDate()-i);

    const key = [
      date.getFullYear(),
      String(date.getMonth()+1).padStart(2,"0"),
      String(date.getDate()).padStart(2,"0")
    ].join("-");

    labels.push(date.toLocaleDateString("en-US",{month:"short",day:"numeric"}));

    salesData.push(transactions
      .filter(t => String(t.date).slice(0,10) === key)
      .reduce((sum,t) => sum + Number(t.total || 0),0));

    expenseData.push(expenses
      .filter(e => e.date === key)
      .reduce((sum,e) => sum + Number(e.amount),0));
  }

  if (dashboardChart) dashboardChart.destroy();

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
          <span class="status ${p.available ? "available" : ""}">
            ${p.available ? "Available" : "Unavailable"}
          </span>
        </td>
        <td>
          <button class="action" onclick="editProduct(${p.id})">Edit</button>
          <button class="action" onclick="toggleProduct(${p.id})">
            ${p.available ? "Deactivate" : "Activate"}
          </button>
        </td>
      </tr>
    `)
  );
}

$("addProductBtn").addEventListener("click", () => {
  $("productForm").reset();
  $("editProductId").value = "";
  $("productFormTitle").textContent = "Add Product";
  $("productDialog").showModal();
});

$("cancelProductBtn").addEventListener("click", () => {
  $("productDialog").close();
});

window.editProduct = function(id) {
  const p = products.find(item => item.id === id);
  if (!p) return;

  $("editProductId").value = p.id;
  $("productName").value = p.name;
  $("productCategory").value = p.category;
  $("productDescription").value = p.description || "";
  $("productPrice").value = p.price;
  $("productStatus").value = String(p.available);
  $("productFormTitle").textContent = "Edit Product";
  $("productDialog").showModal();
};

$("productForm").addEventListener("submit", event => {
  event.preventDefault();

  const name = $("productName").value.trim();
  const price = Number($("productPrice").value);
  const id = Number($("editProductId").value);

  if (!name || !Number.isFinite(price) || price <= 0) {
    alert("Enter a valid product name and price.");
    return;
  }

  const data = {
    name,
    category:$("productCategory").value,
    description:$("productDescription").value.trim(),
    price,
    available:$("productStatus").value === "true"
  };

  if (id) {
    const index = products.findIndex(p => p.id === id);
    if (index >= 0) products[index] = {...products[index],...data};
  } else {
    products.push({
      id:Math.max(0,...products.map(p => p.id))+1,
      ...data
    });
  }

  save();
  $("productDialog").close();
  refresh();
});

window.toggleProduct = function(id) {
  const p = products.find(item => item.id === id);
  if (!p) return;
  p.available = !p.available;
  save();
  refresh();
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
          <button class="action" onclick="editExpense(${e.id})">Edit</button>
          <button class="action" onclick="deleteExpense(${e.id})">Delete</button>
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

window.editExpense = function(id) {
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

$("expenseForm").addEventListener("submit", event => {
  event.preventDefault();

  const id = Number($("editExpenseId").value);
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
      id:Math.max(0,...expenses.map(e => e.id))+1,
      ...data
    });
  }

  save();
  $("expenseDialog").close();
  refresh();
});

window.deleteExpense = function(id) {
  if (!confirm("Are you sure you want to delete this expense?")) return;
  expenses = expenses.filter(e => e.id !== id);
  save();
  refresh();
};

// PRE-ORDER MANAGEMENT
const orderStatuses = [
  "Pending","Confirmed","Preparing",
  "Ready for Pickup","Completed","Cancelled"
];

function renderOrders() {
  $("ordersTable").innerHTML = createTable(
    ["Order ID","Customer","Total","Status","Action"],
    preorders.map((o,index) => `
      <tr>
        <td>${escapeHTML(o.id)}</td>
        <td>${escapeHTML(o.customer || "Guest")}</td>
        <td>${money(o.total)}</td>
        <td>${escapeHTML(o.status)}</td>
        <td>
          <select onchange="updateOrderStatus(${index},this.value)">
            ${orderStatuses.map(status => `
              <option value="${status}" ${o.status === status ? "selected" : ""}>
                ${status}
              </option>
            `).join("")}
          </select>
        </td>
      </tr>
    `)
  );
}

window.updateOrderStatus = function(index,status) {
  if (!preorders[index]) return;
  preorders[index].status = status;
  save();
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

// STAFF MANAGEMENT (DEMO)
function renderStaff() {
  $("staffTable").innerHTML = createTable(
    ["Staff Name","Role","Status","Actions"],
    staff.map(s => `
      <tr>
        <td>${escapeHTML(s.name)}</td>
        <td>Crew</td>
        <td>${s.active ? "Active" : "Inactive"}</td>
        <td>
          <button class="action" onclick="toggleStaff(${s.id})">
            ${s.active ? "Deactivate" : "Activate"}
          </button>
        </td>
      </tr>
    `)
  );
}

$("addStaffBtn").addEventListener("click", () => {
  const name = prompt("Enter staff name:");
  if (!name?.trim()) return;

  staff.push({
    id:Math.max(0,...staff.map(s => s.id))+1,
    name:name.trim(),
    active:true
  });

  save();
  refresh();
});

window.toggleStaff = function(id) {
  const member = staff.find(s => s.id === id);
  if (!member) return;

  member.active = !member.active;
  save();
  refresh();
};

// INITIALIZE
function refresh() {
  renderDashboard();
  renderProducts();
  renderExpenses();
  renderOrders();
  renderAnalytics();
  renderReports();
  renderStaff();
}

refresh();
