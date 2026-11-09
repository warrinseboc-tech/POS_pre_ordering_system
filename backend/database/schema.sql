-- MySQL 8.0+. Active database for the connected Python portals.
CREATE DATABASE IF NOT EXISTS istillo_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE istillo_db;
CREATE TABLE IF NOT EXISTS users (
 id VARCHAR(64) PRIMARY KEY, employee_id VARCHAR(40) NOT NULL UNIQUE,
 name VARCHAR(100) NOT NULL, email VARCHAR(150) NOT NULL DEFAULT '',
 password_hash VARCHAR(255) NOT NULL, role ENUM('admin','crew') NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS accounts (
 user_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 password VARCHAR(255) NOT NULL,
 name VARCHAR(100) NOT NULL DEFAULT '',
 user_email VARCHAR(255) NOT NULL UNIQUE,
 phone VARCHAR(20) NOT NULL DEFAULT '',
 email_verified BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS pending_account_verifications (
 user_email VARCHAR(255) NOT NULL PRIMARY KEY, phone VARCHAR(20) NOT NULL UNIQUE,
 password_hash VARCHAR(255) NOT NULL, otp_hash CHAR(64) NOT NULL,
 expires_at DATETIME NOT NULL, attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
 last_sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 registration_token_hash CHAR(64) NOT NULL DEFAULT ''
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS products (
 id VARCHAR(64) PRIMARY KEY, name VARCHAR(100) NOT NULL,
 category ENUM('Coffee','Milk Tea','Frappe','Latte','Matcha','Snacks') NOT NULL,
 description TEXT NOT NULL, price_cents INT UNSIGNED NOT NULL,
 flavors JSON NOT NULL, sizes JSON NOT NULL, icon VARCHAR(16) NOT NULL,
 image_url VARCHAR(500) NOT NULL DEFAULT '',
 image_position VARCHAR(20) NOT NULL DEFAULT 'center',
 image_scale DECIMAL(3,2) NOT NULL DEFAULT 1.00,
 available BOOLEAN NOT NULL DEFAULT TRUE, updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 CHECK (price_cents > 0)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS inventory_items (
 id VARCHAR(64) PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE,
 category VARCHAR(60) NOT NULL DEFAULT 'Ingredients',
 unit VARCHAR(30) NOT NULL, quantity DECIMAL(12,3) NOT NULL DEFAULT 0,
 minimum DECIMAL(12,3) NOT NULL DEFAULT 0,
 active BOOLEAN NOT NULL DEFAULT TRUE, updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 CHECK (quantity >= 0), CHECK (minimum >= 0)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS inventory_adjustments (
 id VARCHAR(64) PRIMARY KEY, item_id VARCHAR(64) NOT NULL,
 change_amount DECIMAL(12,3) NOT NULL, quantity_after DECIMAL(12,3) NOT NULL,
 reason VARCHAR(200) NOT NULL DEFAULT '', adjusted_by VARCHAR(64) NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 FOREIGN KEY (item_id) REFERENCES inventory_items(id),
 FOREIGN KEY (adjusted_by) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS orders (
 id VARCHAR(64) PRIMARY KEY, customer_token VARCHAR(64) NULL, request_key VARCHAR(64) NOT NULL UNIQUE,
 customer VARCHAR(100) NOT NULL, phone VARCHAR(40) NOT NULL DEFAULT '', notes VARCHAR(500) NOT NULL DEFAULT '',
 source ENUM('Customer','Counter') NOT NULL, order_type VARCHAR(30) NOT NULL DEFAULT 'Pickup',
 status ENUM('Pending','Preparing','Ready','Completed','Cancelled') NOT NULL DEFAULT 'Pending',
 total_cents INT UNSIGNED NOT NULL, payment_method ENUM('GCash','Maya','Cash','Pay at counter') NOT NULL,
 payment_status ENUM('Awaiting proof','Under review','Verified','Rejected','Unpaid') NOT NULL,
 cash_received_cents INT UNSIGNED NOT NULL DEFAULT 0, change_cents INT UNSIGNED NOT NULL DEFAULT 0,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 released_at DATETIME(6) NULL, punched_at DATETIME(6) NULL, punched_by VARCHAR(64) NULL,
 created_by VARCHAR(64) NULL, collected_at DATETIME(6) NULL, collected_by VARCHAR(64) NULL,
 FOREIGN KEY (punched_by) REFERENCES users(id), FOREIGN KEY (created_by) REFERENCES users(id),
 FOREIGN KEY (collected_by) REFERENCES users(id), INDEX queue_index(source,payment_status,status), INDEX customer_index(customer_token,created_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS order_items (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, order_id VARCHAR(64) NOT NULL,
 product_id VARCHAR(64) NOT NULL, name VARCHAR(100) NOT NULL, flavor VARCHAR(100) NOT NULL, size VARCHAR(40) NOT NULL,
 quantity TINYINT UNSIGNED NOT NULL, unit_price_cents INT UNSIGNED NOT NULL,
 FOREIGN KEY (order_id) REFERENCES orders(id), FOREIGN KEY (product_id) REFERENCES products(id), CHECK(quantity BETWEEN 1 AND 99)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS payment_references (
 wallet ENUM('GCash','Maya') NOT NULL, reference_number VARCHAR(80) NOT NULL,
 order_id VARCHAR(64) NOT NULL, PRIMARY KEY(wallet,reference_number), FOREIGN KEY(order_id) REFERENCES orders(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS payment_proofs (
 id VARCHAR(64) PRIMARY KEY, order_id VARCHAR(64) NOT NULL,
 reference_number VARCHAR(80) NOT NULL, wallet ENUM('GCash','Maya') NOT NULL,
 amount_cents INT UNSIGNED NOT NULL, original_hash CHAR(64) NOT NULL UNIQUE,
 storage_name VARCHAR(100) NOT NULL UNIQUE, mime_type VARCHAR(40) NOT NULL,
 status ENUM('Under review','Approved','Rejected') NOT NULL DEFAULT 'Under review',
 review_note VARCHAR(500) NOT NULL DEFAULT '', created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 reviewed_at DATETIME(6) NULL, reviewed_by VARCHAR(64) NULL,
 INDEX wallet_reference_lookup(wallet,reference_number), FOREIGN KEY(order_id) REFERENCES orders(id),
 FOREIGN KEY(reviewed_by) REFERENCES users(id), INDEX pending_proofs(status,created_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS order_events (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, order_id VARCHAR(64) NOT NULL, actor_id VARCHAR(64) NULL,
 event_type VARCHAR(50) NOT NULL, detail VARCHAR(500) NOT NULL DEFAULT '', created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 FOREIGN KEY(order_id) REFERENCES orders(id), FOREIGN KEY(actor_id) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS inquiries (
 id VARCHAR(64) PRIMARY KEY, customer_token VARCHAR(64) NOT NULL, name VARCHAR(100) NOT NULL,
 email VARCHAR(150) NOT NULL, topic VARCHAR(100) NOT NULL, message TEXT NOT NULL, note TEXT NOT NULL,
 status ENUM('New','In progress','Resolved') NOT NULL DEFAULT 'New', created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS expenses (
 id VARCHAR(64) PRIMARY KEY, name VARCHAR(100) NOT NULL, category VARCHAR(60) NOT NULL,
 amount_cents INT UNSIGNED NOT NULL, expense_date DATE NOT NULL, description VARCHAR(500) NOT NULL,
 created_by VARCHAR(64) NOT NULL, FOREIGN KEY(created_by) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS shifts (
 id VARCHAR(64) PRIMARY KEY, employee_id VARCHAR(64) NOT NULL, start_at DATETIME(6) NOT NULL, end_at DATETIME(6) NULL,
 note VARCHAR(1000) NOT NULL DEFAULT '',
 active_employee VARCHAR(64) GENERATED ALWAYS AS (IF(end_at IS NULL,employee_id,NULL)) STORED UNIQUE,
 FOREIGN KEY(employee_id) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS login_attempts (
 bucket CHAR(64) PRIMARY KEY, attempts INT UNSIGNED NOT NULL, expires_at DATETIME NOT NULL
) ENGINE=InnoDB;

-- Additive and rerunnable. Select the existing portal database before executing.
-- Email keys avoid assumptions about legacy accounts.user_id types.
CREATE TABLE IF NOT EXISTS password_change_verifications (
 user_email VARCHAR(255) NOT NULL PRIMARY KEY,
 token_hash CHAR(64) NOT NULL,
 password_hash VARCHAR(255) NOT NULL,
 otp_hash CHAR(64) NOT NULL,
 expires_at DATETIME(6) NOT NULL,
 attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
 last_sent_at DATETIME(6) NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;
