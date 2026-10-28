const catalog = {
  'Coffee Series': [
    { id: 1, name: 'Iced Americano', description: 'Bold espresso and chilled water for a crisp, clean finish.', price: 120, icon: '☕', size: 'Medium' },
    { id: 2, name: 'Cappuccino', description: 'Rich espresso with velvety foam and cocoa dust.', price: 145, icon: '☕', size: 'Medium' },
    { id: 3, name: 'Caramel Latte', description: 'Smooth espresso, milk, and sweet caramel drizzle.', price: 160, icon: '☕', size: 'Medium' }
  ],
  'Milk Tea Series': [
    { id: 4, name: 'Classic Pearl Milk Tea', description: 'Creamy milk tea with chewy tapioca pearls.', price: 150, icon: '🧋', size: 'Regular' },
    { id: 5, name: 'Brown Sugar Milk Tea', description: 'Deep caramel sweetness with rich tea flavor.', price: 170, icon: '🧋', size: 'Regular' },
    { id: 6, name: 'Oolong Milk Tea', description: 'Floral and smooth with a gentle roasted finish.', price: 165, icon: '🧋', size: 'Regular' }
  ],
  'Frappe Series': [
    { id: 7, name: 'Mocha Frappe', description: 'Chocolate and coffee blended into a cold dessert-like treat.', price: 180, icon: '🍫', size: 'Large' },
    { id: 8, name: 'Cookies & Cream Frappe', description: 'Sweet cream, cookies, and espresso blended smooth.', price: 190, icon: '🍪', size: 'Large' },
    { id: 9, name: 'Vanilla Bean Frappe', description: 'Smooth vanilla cream with a rich café twist.', price: 175, icon: '🥤', size: 'Large' }
  ],
  'Latte Series': [
    { id: 10, name: 'Hazelnut Latte', description: 'Nutty, creamy, and lightly sweetened for a comforting sip.', price: 155, icon: '☕', size: 'Medium' },
    { id: 11, name: 'Vanilla Latte', description: 'Classic espresso with creamy vanilla milk.', price: 150, icon: '☕', size: 'Medium' },
    { id: 12, name: 'Matcha Latte', description: 'Earthy green tea flavor with smooth milk finish.', price: 170, icon: '🍵', size: 'Medium' }
  ],
  'Matcha Series': [
    { id: 13, name: 'Ceremonial Matcha', description: 'Pure matcha with a bright, mellow finish.', price: 180, icon: '🍵', size: 'Medium' },
    { id: 14, name: 'Matcha Cheesecake', description: 'A sweet and creamy matcha-inspired blend.', price: 195, icon: '🍵', size: 'Large' },
    { id: 15, name: 'Iced Matcha Latte', description: 'Refreshing matcha with a smooth milk balance.', price: 175, icon: '🌿', size: 'Medium' }
  ],
  'Snacks': [
    { id: 16, name: 'Fries', description: 'Crispy golden fries served hot and crunchy.', price: 90, icon: '🍟', size: 'Regular' },
    { id: 17, name: 'Cheese Sandwich', description: 'Grilled sandwich with melted cheese and toasted bread.', price: 120, icon: '🥪', size: 'Regular' },
    { id: 18, name: 'Pancit Crunch', description: 'Savory, crunchy noodles with a flavorful bite.', price: 130, icon: '🍜', size: 'Regular' }
  ]
};

const state = {
  currentCategory: 'Coffee Series',
  selectedProduct: catalog['Coffee Series'][0],
  cart: []
};

function formatPrice(value) {
  return `P${Number(value).toFixed(2)}`;
}

function renderCategoryButtons() {
  const boxes = document.getElementById('categoryBoxes');
  boxes.innerHTML = Object.keys(catalog)
    .map((category) => {
      const active = category === state.currentCategory ? 'active' : '';
      return `<button class="category-box ${active}" data-category="${category}">${category}</button>`;
    })
    .join('');

  boxes.querySelectorAll('.category-box').forEach((button) => {
    button.addEventListener('click', () => {
      state.currentCategory = button.dataset.category;
      state.selectedProduct = catalog[state.currentCategory][0];
      renderCategoryButtons();
      renderProducts();
      renderProductDetail();
    });
  });
}

function renderProducts() {
  const list = document.getElementById('productList');
  list.innerHTML = catalog[state.currentCategory]
    .map((product) => {
      const selected = product.id === state.selectedProduct.id ? 'selected' : '';
      return `
        <div class="product-card ${selected}" data-id="${product.id}">
          <div class="category-icon">${product.icon}</div>
          <h3>${product.name}</h3>
          <p>${product.description}</p>
          <div class="product-meta">
            <span>${product.size}</span>
            <strong>${formatPrice(product.price)}</strong>
          </div>
        </div>
      `;
    })
    .join('');

  list.querySelectorAll('.product-card').forEach((card) => {
    card.addEventListener('click', () => {
      const productId = Number(card.dataset.id);
      const selected = catalog[state.currentCategory].find((item) => item.id === productId);
      state.selectedProduct = selected;
      renderProducts();
      renderProductDetail();
    });
  });
}

function renderProductDetail() {
  const detailBox = document.querySelector('.detail-box');
  const product = state.selectedProduct;
  detailBox.innerHTML = `
    <h2>PRODUCT DETAILS</h2>
    <p><strong>${product.name}</strong> — ${product.description} | ${formatPrice(product.price)} | ${product.size}</p>
    <button class="detail-add-btn" id="addToOrderBtn">Add to Order</button>
  `;

  document.getElementById('addToOrderBtn').addEventListener('click', () => {
    addToCart(product);
  });
}

function addToCart(product) {
  const existing = state.cart.find((item) => item.id === product.id);
  if (existing) {
    existing.quantity += 1;
  } else {
    state.cart.push({ ...product, quantity: 1 });
  }
  renderCart();
}

function renderCart() {
  const cartList = document.getElementById('cartList');

  if (!state.cart.length) {
    cartList.innerHTML = '<div class="empty-cart">Your cart is empty.</div>';
    updateTotals();
    return;
  }

  cartList.innerHTML = state.cart
    .map((item) => `
      <div class="cart-item">
        <div>
          <div class="item-name">${item.name}</div>
          <div class="item-meta">${item.size}</div>
        </div>
        <div class="qty-badge">x${item.quantity}</div>
        <div class="item-price">${formatPrice(item.price * item.quantity)}</div>
      </div>
    `)
    .join('');

  updateTotals();
}

function updateTotals() {
  const subtotal = state.cart.reduce((total, item) => total + (item.price * item.quantity), 0);
  document.getElementById('subtotalValue').textContent = formatPrice(subtotal);
  document.getElementById('totalValue').textContent = formatPrice(subtotal);
}

function renderCategoryCards() {
  const container = document.getElementById('categoryGrid');
  container.innerHTML = Object.keys(catalog)
    .map((category) => {
      const first = catalog[category][0];
      const active = category === state.currentCategory ? 'active' : '';
      return `
        <button type="button" class="category-card ${active}" data-category="${category}">
          <div class="category-icon">${first.icon}</div>
          <h3>${category}</h3>
          <p>${first.description}</p>
          <span class="view-btn">View ${category}</span>
        </button>
      `;
    })
    .join('');

  container.querySelectorAll('.category-card').forEach((button) => {
    button.addEventListener('click', () => {
      state.currentCategory = button.dataset.category;
      state.selectedProduct = catalog[state.currentCategory][0];
      renderCategoryCards();
      renderCategoryButtons();
      renderProducts();
      renderProductDetail();
    });
  });
}

renderCategoryCards();
renderCategoryButtons();
renderProducts();
renderProductDetail();
renderCart();
