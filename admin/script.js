(async () => {
await Istilo.ready;

const $ = id => document.getElementById(id);
const S = window.Istilo;
const U = window.IstiloUI;
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

let productCrop = {x: 0, y: 0, scale: 1, dragging: false, startX: 0, startY: 0};

function resetProductCrop() {
  productCrop.x = 0;
  productCrop.y = 0;
  productCrop.scale = 1;
  $("productImageScale").value = "100";
  $("productImageScaleValue").textContent = "100%";
  applyProductImageAdjustment();
}

function clampProductCrop(preview, image) {
  const zoom = productCrop.scale;
  const width = Math.max(1, preview.clientWidth);
  const height = Math.max(1, preview.clientHeight);
  const base = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const renderedWidth = image.naturalWidth * base * zoom;
  const renderedHeight = image.naturalHeight * base * zoom;
  const maxX = Math.max(0, (renderedWidth - width) / 2);
  const maxY = Math.max(0, (renderedHeight - height) / 2);
  productCrop.x = Math.max(-maxX, Math.min(maxX, productCrop.x));
  productCrop.y = Math.max(-maxY, Math.min(maxY, productCrop.y));
}

function applyProductImageAdjustment() {
  const preview = $("productImagePreview");
  const image = preview.querySelector("img");
  if (!image || !image.complete) return;
  productCrop.scale = Number($("productImageScale").value) / 100;
  clampProductCrop(preview, image);
  const width = Math.max(1, preview.clientWidth);
  const height = Math.max(1, preview.clientHeight);
  const base = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const renderedWidth = image.naturalWidth * base * productCrop.scale;
  const renderedHeight = image.naturalHeight * base * productCrop.scale;
  image.style.width = `${renderedWidth}px`;
  image.style.height = `${renderedHeight}px`;
  image.style.left = `${(width - renderedWidth) / 2 + productCrop.x}px`;
  image.style.top = `${(height - renderedHeight) / 2 + productCrop.y}px`;
}

$("productImageScale").addEventListener("input", () => {
  $("productImageScaleValue").textContent = `${$("productImageScale").value}%`;
  applyProductImageAdjustment();
});
$("resetProductImage").addEventListener("click", resetProductCrop);

const imagePreview = $("productImagePreview");
imagePreview.addEventListener("pointerdown", event => {
  if (!imagePreview.querySelector("img")) return;
  productCrop.dragging = true;
  productCrop.startX = event.clientX - productCrop.x;
  productCrop.startY = event.clientY - productCrop.y;
  imagePreview.setPointerCapture(event.pointerId);
  imagePreview.classList.add("dragging");
});
imagePreview.addEventListener("pointermove", event => {
  if (!productCrop.dragging) return;
  productCrop.x = event.clientX - productCrop.startX;
  productCrop.y = event.clientY - productCrop.startY;
  applyProductImageAdjustment();
});
function stopImageDrag(event) {
  productCrop.dragging = false;
  imagePreview.classList.remove("dragging");
  if (event.pointerId !== undefined && imagePreview.hasPointerCapture(event.pointerId)) {
    imagePreview.releasePointerCapture(event.pointerId);
  }
}
imagePreview.addEventListener("pointerup", stopImageDrag);
imagePreview.addEventListener("pointercancel", stopImageDrag);

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
let inventory = S.read('inventory', []);
let inventoryAdjustments = S.read('inventoryAdjustments', []);
let transactions = [];
let preorders = [];
let staff = S.staff();

let dashboardChart = null;
let analyticsChart = null;
let analyticsPieChart = null;
let reportChart = null;

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

function crewName(order) {
  const crewId = order.collectedBy || order.punchedBy || order.createdBy;
  const member = staff.find(s => s.id === crewId);
  return member ? `${member.name} (${member.employeeId})` : (crewId || "Not recorded");
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
        <td>
          <div class="admin-product-name">
            ${p.imageUrl ? `<span class="admin-product-thumb"><img src="${escapeHTML(p.imageUrl)}" alt=""></span>` : '<span class="admin-product-placeholder" aria-hidden="true">☕</span>'}
            <span>${escapeHTML(p.name)}</span>
          </div>
        </td>
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
  $("productImage").required = true;
  $("productFormTitle").textContent = "Add Product";
  $("productImagePreview").textContent = "No image selected";
  $("productImagePreview").classList.remove("has-image");
  $("productImageScale").value = "100";
  $("productImageScaleValue").textContent = "100%";
  resetProductCrop();
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
  $("productImage").value = '';
  $("productImage").required = !p.imageUrl;
  $("productName").value = p.name;
  $("productCategory").value = p.category;
  $("productDescription").value = p.description || "";
  $("productPrice").value = p.price;
  $("productStatus").value = String(S.available(p.id));
  $('productFlavors').value = p.flavors.join(', ');
  $('productLargeExtra').value = p.sizes.find(s => s.name === 'Large')?.extra ?? 20;
  if (p.imageUrl) {
    $("productImagePreview").innerHTML = `<img src="${escapeHTML(p.imageUrl)}" alt="${escapeHTML(p.name)}">`;
    $("productImagePreview").classList.add("has-image");
    $("productImageScale").value = String(Math.round(Number(p.imageScale || 1) * 100));
    $("productImageScaleValue").textContent = `${$("productImageScale").value}%`;
    const image = $("productImagePreview").querySelector("img");
    image.onload = applyProductImageAdjustment;
    if (image.complete) applyProductImageAdjustment();
  } else {
    $("productImagePreview").textContent = "No image selected";
    $("productImagePreview").classList.remove("has-image");
  }
  $("productFormTitle").textContent = "Edit Product";
  $("productDialog").showModal();
};

$("productImage").addEventListener("change", event => {
  const file = event.target.files[0];
  if (!file) {
    $("productImagePreview").textContent = "No image selected";
    $("productImagePreview").classList.remove("has-image");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    $("productImagePreview").innerHTML = `<img src="${reader.result}" alt="Selected product preview">`;
    $("productImagePreview").classList.add("has-image");
    resetProductCrop();
    const image = $("productImagePreview").querySelector("img");
    image.onload = applyProductImageAdjustment;
  };
  reader.readAsDataURL(file);
});

async function createCroppedProductImage() {
  const preview = $("productImagePreview");
  const previewImage = preview.querySelector("img");
  if (!previewImage) return null;

  const source = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The selected image could not be loaded."));
    image.src = previewImage.src;
  });

  const outputWidth = 800;
  const outputHeight = 450;
  const previewWidth = preview.clientWidth || outputWidth;
  const previewHeight = preview.clientHeight || outputHeight;
  const baseScale = Math.max(previewWidth / source.naturalWidth, previewHeight / source.naturalHeight);
  const renderedScale = baseScale * productCrop.scale;
  const renderedWidth = source.naturalWidth * renderedScale;
  const renderedHeight = source.naturalHeight * renderedScale;
  const left = (previewWidth - renderedWidth) / 2 + productCrop.x;
  const top = (previewHeight - renderedHeight) / 2 + productCrop.y;

  const sourceX = Math.max(0, -left / renderedScale);
  const sourceY = Math.max(0, -top / renderedScale);
  const sourceWidth = Math.min(source.naturalWidth - sourceX, previewWidth / renderedScale);
  const sourceHeight = Math.min(source.naturalHeight - sourceY, previewHeight / renderedScale);

  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext("2d");
  context.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, outputWidth, outputHeight);
  return await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.92));
}

$("productForm").addEventListener("submit", async event => {
  event.preventDefault();

  const name = $("productName").value.trim();
  const price = Number($("productPrice").value);
  const id = $("editProductId").value;
  if (!$("productForm").reportValidity()) return;
  if (!$("productDescription").value.trim()) {
    notify('Enter a product description.');
    $("productDescription").focus();
    return;
  }
  const flavors = $('productFlavors').value.split(',').map(value => value.trim());
  if (flavors.length > 20 || flavors.some(value => !value || value.length > 100)) {
    notify('Enter between one and twenty flavors, without empty entries (maximum 100 characters each).');
    $('productFlavors').focus();
    return;
  }
  if (!$("productImagePreview").querySelector('img')) {
    notify('Choose a product image before saving.');
    $("productImage").focus();
    return;
  }

  if (!name || !Number.isFinite(price) || price <= 0) {
    notify("Enter a valid product name and price.");
    return;
  }

  const data = new FormData();
  data.append('name', name);
  data.append('category', $("productCategory").value);
  data.append('description', $("productDescription").value.trim());
  data.append('price', String(price));
  if (id) data.append('id', id);
  data.append('flavors', JSON.stringify(flavors));
  data.append('largeExtra', String(Number($('productLargeExtra').value)));
  data.append('imageScale', String(Number($("productImageScale").value) / 100));

  attempt(async () => {
    const croppedImage = await createCroppedProductImage();
    if (!croppedImage) throw new Error('The product image is not ready. Select an image and try again.');
    if (croppedImage) data.append('image', croppedImage, 'product.jpg');
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

// INVENTORY MANAGEMENT
function renderInventory() {
  const lowStock = inventory.filter(i => Number(i.quantity) <= Number(i.minimum));
  summaryCards("inventoryStats", [
    ["Total Ingredients", inventory.length],
    ["Low Stock Items", lowStock.length],
    ["Stock Adjustments", inventoryAdjustments.length],
    ["Inventory Units", inventory.reduce((sum,i) => sum + Number(i.quantity), 0).toLocaleString("en-PH",{maximumFractionDigits:3})]
  ]);
  $("inventoryTable").innerHTML = createTable(
    ["Ingredient","Type","Quantity","Unit","Status","Actions"],
    inventory.map(i => {
      const low = Number(i.quantity) <= Number(i.minimum);
      return `<tr><td>${escapeHTML(i.name)}</td><td>${escapeHTML(i.category)}</td><td><strong>${Math.round(Number(i.quantity)).toLocaleString("en-PH")}</strong></td><td>${escapeHTML(i.unit)}</td><td><span class="status ${low ? "cancelled" : "available"}">${low ? "Low stock" : "In stock"}</span></td><td><button type="button" class="action" data-add-stock="${escapeHTML(i.id)}">Add / Deduct</button> <button type="button" class="action" data-edit-inventory="${escapeHTML(i.id)}">Edit</button> <button type="button" class="action danger" data-remove-stock="${escapeHTML(i.id)}">Delete</button></td></tr>`;
    })
  );
  $("inventoryTable").querySelectorAll("[data-add-stock]").forEach(button => {
    button.onclick=()=>openInventoryAdjustment(button.dataset.addStock);
  });
  $("inventoryTable").querySelectorAll("[data-remove-stock]").forEach(button => {
    button.onclick=()=>removeInventoryItem(button.dataset.removeStock);
  });
  $("inventoryTable").querySelectorAll("[data-edit-inventory]").forEach(button => {
    button.onclick=()=>openInventoryEditor(button.dataset.editInventory);
  });
  $("inventoryHistory").innerHTML = createTable(
    ["Ingredient","Change","Quantity After","Date"],
    inventoryAdjustments.map(a => `<tr><td>${escapeHTML(a.itemName)}</td><td>${a.change > 0 ? "+" : ""}${Math.round(Number(a.change)).toLocaleString("en-PH")}</td><td>${Math.round(Number(a.quantityAfter)).toLocaleString("en-PH")}</td><td>${escapeHTML(a.time)}</td></tr>`)
  );
}

async function removeInventoryItem(id) {
  const item=inventory.find(i=>i.id===id);
  if(!item)return;
  if(!await U.confirm(`Delete ${item.name} permanently from inventory?`, "Delete ingredient?", "Yes, delete"))return;
  await attempt(async()=>{
    await S.mutate("/inventory/"+encodeURIComponent(id)+"/delete","POST", {});
    inventory=inventory.filter(entry=>entry.id!==id);
    inventoryAdjustments=inventoryAdjustments.filter(entry=>entry.itemId!==id);
    refresh();
    notify("Ingredient deleted.");
  });
}

function openInventoryEditor(id) {
  const item=inventory.find(i=>i.id===id);
  if(!item)return;
  $("inventoryForm").reset();
  $("editInventoryId").value=id;
  $("inventoryFormTitle").textContent="Edit Ingredient";
  $("inventoryName").value=item.name;
  $("inventoryCategory").value=item.category;
  $("inventoryUnit").value=item.unit;
  $("inventoryQuantity").value=Math.round(Number(item.quantity));
  $("inventoryMinimum").value=Math.round(Number(item.minimum));
  $("inventoryDialog").showModal();
}

function openInventoryAdjustment(id) {
  const item=inventory.find(i=>i.id===id);
  if(!item)return;
  $("inventoryAdjustId").value=id;
  $("inventoryAdjustTitle").textContent=`Adjust ${item.name}`;
  $("inventoryAdjustForm").reset();
  $("inventoryAdjustId").value=id;
  $("inventoryAdjustDialog").showModal();
}

$("addInventoryBtn").onclick=()=>{
  $("inventoryForm").reset();
  $("editInventoryId").value="";
  $("inventoryFormTitle").textContent="Add Ingredient";
  $("inventoryCategory").value="Ingredients";
  $("inventoryQuantity").value="0";
  $("inventoryMinimum").value="0";
  $("inventoryDialog").showModal();
};
$("cancelInventoryBtn").onclick=()=>{$("inventoryDialog").close();};
$("inventoryForm").onsubmit=async event=>{
  event.preventDefault();
  const data={name:$("inventoryName").value.trim(),category:$("inventoryCategory").value.trim(),unit:$("inventoryUnit").value.trim(),quantity:Number($("inventoryQuantity").value),minimum:Number($("inventoryMinimum").value)};
  if(!data.name||!data.category||!data.unit||!Number.isInteger(data.quantity)||!Number.isInteger(data.minimum)||data.quantity<0||data.minimum<0){notify("Please enter whole-number ingredient quantities.");return;}
  await attempt(async()=>{
    const editId=$("editInventoryId").value;
    if(editId) await S.mutate("/inventory/"+encodeURIComponent(editId),"PATCH",{name:data.name,category:data.category,unit:data.unit});
    else await S.mutate("/inventory","POST",data);
    $("inventoryDialog").close();
    refresh();
    notify(editId?"Ingredient updated.":"Ingredient added.");
  });
};
$("cancelInventoryAdjustBtn").onclick=()=>{$("inventoryAdjustDialog").close();};
$("inventoryAdjustForm").onsubmit=async event=>{
  event.preventDefault();
  const data={mode:$("inventoryAdjustMode").value,amount:Number($("inventoryAdjustAmount").value)};
  if(!Number.isInteger(data.amount)||data.amount<=0){notify("Enter a whole-number quantity.");return;}
  await attempt(async()=>{await S.mutate("/inventory/"+encodeURIComponent($("inventoryAdjustId").value)+"/adjust","POST",data);$("inventoryAdjustDialog").close();refresh();notify("Stock adjusted.");});
};
document.querySelectorAll("[data-step-target]").forEach(button=>{
  button.onclick=()=>{
    const input=$(button.dataset.stepTarget);
    const current=Number(input.value)||0;
    const minimum=Number(input.min)||0;
    input.value=String(Math.max(minimum,current+Number(button.dataset.step)));
  };
});

// EXPENSES MANAGEMENT
function renderExpenses() {
  const currentMonth = today().slice(0,7);
  const selectedDate = $("expenseDateFilter").value;
  const filtered = expenses.filter(e => !selectedDate || e.date === selectedDate);

  const monthly = expenses
    .filter(e => e.date.startsWith(currentMonth))
    .reduce((sum,e) => sum+Number(e.amount),0);

  const selectedTotal = filtered.reduce((sum,e) => sum+Number(e.amount),0);
  const largest = filtered.length
    ? Math.max(...filtered.map(e => Number(e.amount)))
    : 0;

  summaryCards("expenseStats",[
    [selectedDate ? "Expenses on Selected Date" : "Total Expenses",money(selectedDate ? selectedTotal : totalExpenses())],
    ["This Month",money(monthly)],
    ["Expense Records",filtered.length],
    ["Largest Expense",money(largest)]
  ]);

  const sorted = [...filtered].sort((a,b) =>
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

$("expenseDateFilter").addEventListener("change", renderExpenses);
$("clearExpenseDateFilter").addEventListener("click", () => {
  $("expenseDateFilter").value = "";
  renderExpenses();
});
$("exportExpenseReportBtn").addEventListener("click", () => {
  const selectedDate = $("expenseDateFilter").value;
  const filtered = expenses
    .filter(e => !selectedDate || e.date === selectedDate)
    .sort((a,b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  const escapeCell = value => escapeHTML(String(value ?? ""));
  const html = [
    "<html xmlns:o=\"urn:schemas-microsoft-com:office:office\" xmlns:x=\"urn:schemas-microsoft-com:office:excel\"><head><meta charset=\"UTF-8\"><style>td,th{border:1px solid #777;padding:6px}th{background:#ddd}</style></head><body><table>",
    "<tr><th>Expense</th><th>Category</th><th>Amount</th><th>Date</th><th>Description</th></tr>",
    ...filtered.map(e => `<tr><td>${escapeCell(e.name)}</td><td>${escapeCell(e.category)}</td><td>${escapeCell(Number(e.amount).toFixed(2))}</td><td>${escapeCell(e.date)}</td><td>${escapeCell(e.description || "")}</td></tr>`),
    "</table></body></html>"
  ].join("");
  const blob = new Blob(["\uFEFF",html], {type:"application/vnd.ms-excel;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = selectedDate ? `ISTILO-Expenses-${selectedDate}.xls` : "ISTILO-All-Expenses.xls";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url),1000);
});
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
    notify("Please enter valid expense details.");
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
  if (!await U.confirm("Are you sure you want to delete this expense?", "Delete expense?", "Yes, delete")) return;
  await attempt(async () => {
    if (!expenses.some(expense => expense.id === id)) throw new Error("Expense no longer exists.");
    await S.mutate("/expenses/"+encodeURIComponent(id),"DELETE");
    await refresh();
    notify("Expense deleted.");
  });
};

// PRE-ORDER MANAGEMENT
function renderOrders() {
  $("ordersTable").innerHTML = createTable(
    ["Order ID","Placed","Customer","Total","Status","Action"],
    preorders.slice().sort((a,b) => new Date(b.time) - new Date(a.time)).map(o => `
      <tr>
        <td>${escapeHTML(o.id)}</td>
        <td>${escapeHTML(S.date(o.time))}</td>
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
          <button class="action danger" type="button" data-delete-order="${escapeHTML(o.id)}">Delete</button>
        </td>
      </tr>
    `)
  );
  $('ordersTable').querySelectorAll('[data-order]').forEach(select => select.onchange = () => updateOrderStatus(select.dataset.order, select.value));
  $('ordersTable').querySelectorAll('[data-delete-order]').forEach(button => button.onclick = async () => {
    const order = preorders.find(item => item.id === button.dataset.deleteOrder);
    if (!order) { notify("Order no longer exists."); return; }
    if (!await U.confirm(`Permanently delete order ${order.id} and its payment and sales records?`, "Delete order?", "Yes, delete")) return;
    button.disabled = true;
    await attempt(async () => {
      await S.mutate("/orders/"+encodeURIComponent(order.id),"DELETE");
      await refresh();
      notify("Order deleted.");
    });
    if (button.isConnected) button.disabled = false;
  });
}

window.updateOrderStatus = async function(id,status) {
  await attempt(async () => { await S.setStatus(id, status); notify('Order status updated in customer and crew screens.'); });
  refresh();
};

// SALES ANALYTICS
function renderAnalytics() {
  const productFilter = $("analyticsProductFilter");
  const productNames = [...new Set(transactions.flatMap(t => (t.items || []).map(item => item.name || "Unknown Product")))].sort((a,b) => a.localeCompare(b));
  if (productFilter.dataset.populated !== "true" || productFilter.options.length !== productNames.length + 1) {
    const selected = productFilter.value;
    productFilter.innerHTML = '<option value="">All products</option>' + productNames.map(name => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join("");
    productFilter.value = selected;
    productFilter.dataset.populated = "true";
  }

  const selectedProduct = productFilter.value;
  const startDate = $("analyticsStartDate").value;
  const endDate = $("analyticsEndDate").value;
  const filteredSales = transactions.filter(t => {
    const transactionDate = S.today(t.date);
    const dateMatches = (!startDate || transactionDate >= startDate) && (!endDate || transactionDate <= endDate);
    const productMatches = !selectedProduct || (t.items || []).some(item => (item.name || "Unknown Product") === selectedProduct);
    return dateMatches && productMatches;
  });

  const sold = {};

  filteredSales.forEach(t => {
    (t.items || []).forEach(item => {
      const name = item.name || "Unknown Product";
      if (selectedProduct && name !== selectedProduct) return;
      sold[name] = (sold[name] || 0)+Number(item.qty ?? item.quantity ?? 0);
    });
  });

  const ranked = Object.entries(sold).sort((a,b) => b[1]-a[1]);
  const filteredRevenue = selectedProduct
    ? filteredSales.reduce((sum,t) => sum + (t.items || [])
        .filter(item => (item.name || "Unknown Product") === selectedProduct)
        .reduce((itemSum,item) => itemSum + Number(item.qty ?? item.quantity ?? 0) * Number(item.price || 0),0),0)
    : filteredSales.reduce((sum,t) => sum + Number(t.total || 0),0);
  const filteredTransactions = filteredSales.length;
  const averageOrderValue = filteredTransactions ? filteredRevenue / filteredTransactions : 0;

  summaryCards("analyticsStats",[
    ["Total Revenue",money(filteredRevenue)],
    ["Completed Transactions",filteredTransactions],
    ["Average Order Value",money(averageOrderValue)],
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

  if (analyticsPieChart) analyticsPieChart.destroy();
  if (typeof Chart === 'function') {
    analyticsPieChart = new Chart($("analyticsPieChart"),{
      type:"pie",
      data:{
        labels:ranked.map(([name]) => name),
        datasets:[{
          data:ranked.map(([,quantity]) => quantity),
          backgroundColor:["#c68b59","#8f5d42","#d6ad7e","#6d8064","#a9b5a5","#7b5c4b","#e0c2a1","#5d4035"]
        }]
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        plugins:{legend:{position:"right"}}
      }
    });
  }
}

$("analyticsProductFilter").addEventListener("change", renderAnalytics);
$("analyticsStartDate").addEventListener("change", () => {
  if ($("analyticsEndDate").value && $("analyticsStartDate").value > $("analyticsEndDate").value) {
    $("analyticsEndDate").value = $("analyticsStartDate").value;
  }
  renderAnalytics();
});
$("analyticsEndDate").addEventListener("change", () => {
  if ($("analyticsStartDate").value && $("analyticsEndDate").value < $("analyticsStartDate").value) {
    $("analyticsStartDate").value = $("analyticsEndDate").value;
  }
  renderAnalytics();
});
$("clearAnalyticsFilters").addEventListener("click", () => {
  $("analyticsProductFilter").value = "";
  $("analyticsStartDate").value = "";
  $("analyticsEndDate").value = "";
  renderAnalytics();
});

// REPORTS
function reportDateRange(selectedDate, period) {
  if (!selectedDate) return null;

  const [year, month, day] = selectedDate.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day));
  if (period === "week") {
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  } else if (period === "month") {
    start.setUTCDate(1);
  }

  const end = new Date(start);
  if (period === "week") {
    end.setUTCDate(end.getUTCDate() + 7);
  } else if (period === "month") {
    end.setUTCMonth(end.getUTCMonth() + 1);
  } else {
    end.setUTCDate(end.getUTCDate() + 1);
  }

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10)
  };
}

function reportSales() {
  const selectedCrew = $("reportCrewFilter").value;
  const dateRange = reportDateRange(
    $("reportDateFilter").value,
    $("reportPeriodFilter").value
  );
  return transactions.filter(t => {
    const id = t.collectedBy || t.punchedBy || t.createdBy;
    const transactionDate = S.today(t.date);
    const dateMatches = !dateRange ||
      (transactionDate >= dateRange.start && transactionDate < dateRange.end);
    return dateMatches && (!selectedCrew || id === selectedCrew);
  });
}

function renderReports() {
  const crewFilter = $("reportCrewFilter");
  if (crewFilter.options.length === 1) {
    staff.forEach(member => {
      const option = document.createElement("option");
      option.value = member.id;
      option.textContent = `${member.name} (${member.employeeId})`;
      crewFilter.appendChild(option);
    });
  }

  const sales = reportSales();

  const rows = sales.map(t => ({
    type:"Sale",
    name:t.id,
    date:t.date,
    amount:Number(t.total),
    crew:crewName(t)
  }));

  $("reportsTable").innerHTML = createTable(
    ["Type","Reference","Date","Amount","Crew Member"],
    rows.map(r => `
      <tr>
        <td>${escapeHTML(r.type)}</td>
        <td>${escapeHTML(r.name)}</td>
        <td>${escapeHTML(r.date)}</td>
        <td>${money(r.amount)}</td>
        <td>${escapeHTML(r.crew)}</td>
      </tr>
    `)
  );

  const totals = {};
  sales.forEach(t => {
    const name = crewName(t);
    totals[name] = (totals[name] || 0) + Number(t.total || 0);
  });
  const labels = Object.keys(totals);
  const values = Object.values(totals);

  if (reportChart) reportChart.destroy();
  if (typeof Chart === "function") {
    reportChart = new Chart($("reportChart"),{
      type:"bar",
      data:{labels,datasets:[{label:"Sales total",data:values,backgroundColor:"#c68b59"}]},
      options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true}}}
    });
  } else {
    chartFallback("reportChart", labels.map((label,i) => [label,money(values[i])]));
  }
}

$("reportDateFilter").addEventListener("change", renderReports);
$("reportPeriodFilter").addEventListener("change", renderReports);
$("reportCrewFilter").addEventListener("change", renderReports);
$("clearReportFilters").addEventListener("click", () => {
  $("reportPeriodFilter").value = "day";
  $("reportDateFilter").value = "";
  $("reportCrewFilter").value = "";
  renderReports();
});

$("exportBtn").addEventListener("click", () => {
  const sales = reportSales();
  const productSales = new Map();
  let totalSales = 0;
  const rows = [
    ["Type","Date","Reference","Product Name","Quantity","Unit Price","Amount","Crew Member","Total of Sales","Best Selling Product"]
  ];
  sales.forEach(t => {
    totalSales += Number(t.total || 0);
    (t.items || []).forEach(item => {
      const name = item.name || "Unknown Product";
      const quantity = Number(item.quantity ?? item.qty ?? 0);
      const unitPrice = Number(item.price || 0);
      const product = productSales.get(name) || {quantity:0};
      product.quantity += quantity;
      productSales.set(name, product);
      rows.push([
        "Sale",
        S.today(t.date),
        t.id,
        name,
        quantity,
        unitPrice,
        unitPrice * quantity,
        crewName(t),
        "",
        ""
      ]);
    });
  });

  const bestSelling = [...productSales.entries()]
    .sort((a,b) => b[1].quantity - a[1].quantity || a[0].localeCompare(b[0]));
  rows.push([
    "Summary","","","","","","","",
    totalSales,
    bestSelling.length
      ? `${bestSelling[0][0]} (${bestSelling[0][1].quantity} units)`
      : "No sales"
  ]);

  const csv = rows.map(row => row.map(value => {
    let cell = String(value ?? "");
    if (/^[\s]*[=+\-@]/.test(cell)) cell = "'" + cell;
    return `"${cell.replace(/"/g,'""')}"`;
  }).join(",")).join("\r\n");

  const blob = new Blob(["\uFEFF",csv], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ISTILO-Financial-Report.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
});

// CREW ACCOUNT MANAGEMENT
function renderInquiries() {
  const list = S.read('inquiries', []).slice().reverse();
  if (!list.length) {
    $("inquiriesTable").innerHTML = '<div class="empty">No customer inquiries yet.</div>';
    return;
  }
  $("inquiriesTable").innerHTML = list.map(m => `
    <article class="card inquiry-card">
      <div class="row between wrap">
        <div>
          <span class="eyebrow">${escapeHTML(m.topic)}</span>
          <h3 style="margin:8px 0">${escapeHTML(m.name)}</h3>
          <a href="mailto:${escapeHTML(m.email)}">${escapeHTML(m.email)}</a>
        </div>
        <div><span class="status ${m.status === 'Resolved' ? 'available' : m.status === 'In progress' ? 'pending' : 'cancelled'}">${escapeHTML(m.status)}</span><p class="mini-note">${escapeHTML(m.time)}</p></div>
      </div>
      <p class="message">${escapeHTML(m.message)}</p>
      <form class="inquiry-form" data-message="${escapeHTML(m.id)}">
        <label class="field">Internal follow-up note
          <textarea name="note" maxlength="2000">${escapeHTML(m.note || '')}</textarea>
        </label>
        <label class="field">Status
          <select name="status">
            ${['New','In progress','Resolved'].map(status => `<option value="${status}" ${status === m.status ? 'selected' : ''}>${status}</option>`).join('')}
          </select>
        </label>
        <button type="submit" class="primary">Save inquiry</button>
      </form>
    </article>`).join('');
  $("inquiriesTable").querySelectorAll('.inquiry-form').forEach(form => {
    form.onsubmit = async event => {
      event.preventDefault();
      try {
        const list = S.read('inquiries', []);
        const inquiry = list.find(m => m.id === form.dataset.message);
        if (!inquiry) throw new Error('Inquiry no longer exists.');
        inquiry.note = new FormData(form).get('note').trim();
        inquiry.status = new FormData(form).get('status');
        await S.write('inquiries', list);
        renderInquiries();
        notify('Inquiry updated.');
      } catch (error) {
        notify(error.message);
      }
    };
  });
}

function renderStaff() {
  $("staffTable").innerHTML = createTable(
    ["Staff Name","Employee ID","Role","Status","Actions"],
    staff.map(s => `
      <tr>
        <td>${escapeHTML(s.name)}</td>
        <td>${escapeHTML(s.employeeId)}</td>
        <td>${s.role === "admin" ? "Admin" : "Crew"}</td>
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
  $('staffRole').value = 'crew';
  $('staffFormTitle').textContent = 'Create crew account';
  $('staffForm').querySelector('button.primary').textContent = 'Save crew member';
  $('staffDialog').showModal();
});

$("addAdminBtn").addEventListener("click", () => {
  $('staffForm').reset();
  $('staffRole').value = 'admin';
  $('staffFormTitle').textContent = 'Create admin account';
  $('staffForm').querySelector('button.primary').textContent = 'Save admin member';
  $('staffEmployeeId').placeholder = 'ADMIN002';
  $('staffDialog').showModal();
});

$('cancelStaffBtn').onclick = () => $('staffDialog').close();
$('staffForm').onsubmit = async event => {
  event.preventDefault();
  attempt(async () => {
    const list = S.staff(), name = $('staffName').value.trim(), employeeId = $('staffEmployeeId').value.trim().toUpperCase();
    if (!name || !/^[A-Z0-9_-]+$/.test(employeeId)) throw new Error('Enter a name and a valid employee ID.');
    if (list.some(s => s.employeeId === employeeId)) throw new Error('That employee ID already exists.');
    const role = $('staffRole').value === 'admin' ? 'admin' : 'crew';
    await S.api('/staff', { method: 'POST', body: {
      name,
      employeeId,
      role,
      email: '',
      password: $('staffPassword').value
    }});
    $('staffDialog').close();
    await refresh();
    staff = S.staff();
    renderStaff();
    notify(role === 'admin' ? 'Admin account added. Share the initial password privately.' : 'Crew member added. Share the initial password privately.');
  });
};

window.toggleStaff = async function(id) {
  attempt(async () => {
    const member = staff.find(s => s.employeeId === id);
    if (!member) throw new Error('Staff member not found.');
    await S.api(`/staff/${member.id}`, { method: 'PATCH', body: { active: !member.active } });
    await refresh();
    staff = S.staff();
    renderStaff();
    notify(`${member.role === 'admin' ? 'Admin' : 'Crew'} access updated.`);
  });
};

// INITIALIZE
function refresh() {
  const signedIn=S.user?.role==='admin';
  $('adminLogin').hidden=signedIn; $('adminWorkspace').hidden=!signedIn;
  if(!signedIn)return;
  products = S.products;
  expenses = S.read('expenses', []);
  inventory = S.read('inventory', []);
  inventoryAdjustments = S.read('inventoryAdjustments', []);
  staff = S.staff();
  preorders = S.read('orders', []).filter(o => o.source === 'Customer');
  const completed = S.sales();
  transactions = completed;
  renderDashboard();
  renderProducts();
  renderInventory();
  renderExpenses();
  renderOrders();
  renderAnalytics();
  renderReports();
  renderInquiries();
  renderStaff();
  renderPaymentProofs();
  $('expensesTable').querySelectorAll('[data-edit-expense]').forEach(b=>b.onclick=()=>editExpense(b.dataset.editExpense));
  $('expensesTable').querySelectorAll('[data-delete-expense]').forEach(b=>b.onclick=()=>deleteExpense(b.dataset.deleteExpense));
}

function renderPaymentProofs() {
  $('paymentProofs').textContent='Payment verification is handled by crew in the Ordering screen.';
}

$('adminLoginForm').onsubmit=async event=>{event.preventDefault();try{await S.login($('adminEmployee').value,$('adminPassword').value,'admin');$('adminPassword').value='';$('adminLoginError').textContent='';refresh();}catch(err){$('adminLoginError').textContent=err.message;}};
$('adminLogout').onclick=async()=>{if(!await U.confirm('Are you sure you want to log out?', 'Log out?', 'Yes, log out'))return;const button=$('adminLogout');button.disabled=true;try{await S.logout();document.querySelectorAll('dialog[open]').forEach(d=>d.close());$('adminEmployee').value='';$('adminPassword').value='';$('adminLoginError').textContent='';await S.refresh();refresh();}catch(error){notify(error.message);}finally{button.disabled=false;}};
$('adminMenuToggle').onclick=()=>{const sidebar=$('adminSidebar');const open=sidebar.classList.toggle('open');$('adminMenuToggle').setAttribute('aria-expanded',String(open));};
document.querySelectorAll('.sidebar .nav').forEach(button=>button.onclick=()=>{button.closest('.sidebar')?.classList.remove('open');$('adminMenuToggle').setAttribute('aria-expanded','false');});

refresh();

window.addEventListener('storage', event => {
  if (!Object.values(S.keys).includes(event.key)) return;
  // Do not replace an in-progress form or an open product dialog.
  if (document.querySelector('dialog[open]') || document.activeElement?.matches('input,textarea,select')) notify('Shared data changed. Close this form or switch pages to refresh.');
  else refresh();
});
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', refresh));

})();
