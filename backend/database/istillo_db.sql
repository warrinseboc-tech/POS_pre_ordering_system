-- Updated full schema for your existing database. MySQL 8.0+.
-- Run this entire file in MySQL Workbench (including DELIMITER blocks).
-- No accounts, inventory, orders, or payments are deleted.
CREATE DATABASE IF NOT EXISTS istillo_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE istillo_db;
SET NAMES utf8mb4;

-- The old products table is incompatible with the Python API's product schema.
-- Preserve it before creating the current table. No legacy rows are discarded.
DELIMITER $$
DROP PROCEDURE IF EXISTS prepare_istillo_products$$
CREATE PROCEDURE prepare_istillo_products()
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'id'
    ) THEN
        IF EXISTS (
            SELECT 1 FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products_legacy'
        ) THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'products_legacy already exists. Back up and resolve this table before continuing.';
        ELSE
            RENAME TABLE products TO products_legacy;
        END IF;
    END IF;
END$$
CALL prepare_istillo_products()$$
DROP PROCEDURE prepare_istillo_products$$
DELIMITER ;
-- MySQL 8.0+. Kept separate from the older account database.
CREATE DATABASE IF NOT EXISTS istillo_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE istillo_db;
CREATE TABLE IF NOT EXISTS users (
 id VARCHAR(64) PRIMARY KEY, employee_id VARCHAR(40) NOT NULL UNIQUE,
 name VARCHAR(100) NOT NULL, email VARCHAR(150) NOT NULL DEFAULT '',
 password_hash VARCHAR(255) NOT NULL, role ENUM('admin','crew') NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS products (
 id VARCHAR(64) PRIMARY KEY, name VARCHAR(100) NOT NULL,
 category ENUM('Coffee','Milk Tea','Frappe','Latte','Matcha','Snacks') NOT NULL,
 description TEXT NOT NULL, price_cents INT UNSIGNED NOT NULL,
 flavors JSON NOT NULL, sizes JSON NOT NULL, icon VARCHAR(16) NOT NULL,
 available BOOLEAN NOT NULL DEFAULT TRUE, updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 CHECK (price_cents > 0)
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


-- Preserve compatibility with the older customer-account tables.
-- New staff logins use users.password_hash, not accounts.password.
-- Existing password values are NOT converted to hashes by this script.
CREATE TABLE IF NOT EXISTS accounts (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    password VARCHAR(255),
    user_email VARCHAR(255),
    phone VARCHAR(20),
    email_verified TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

SET @email_verified_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'accounts'
      AND COLUMN_NAME = 'email_verified'
);
SET @email_verified_migration = IF(
    @email_verified_exists = 0,
    'ALTER TABLE accounts ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0',
    'SELECT ''accounts.email_verified already exists'' AS migration_status'
);
PREPARE email_verified_stmt FROM @email_verified_migration;
EXECUTE email_verified_stmt;
DEALLOCATE PREPARE email_verified_stmt;

CREATE TABLE IF NOT EXISTS pending_account_verifications (
    user_email VARCHAR(255) NOT NULL PRIMARY KEY,
    phone VARCHAR(20) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    otp_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    last_sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inventory (
    inventory_id INT PRIMARY KEY AUTO_INCREMENT,
    product_name VARCHAR(100) NOT NULL,
    category VARCHAR(50),
    quantity INT NOT NULL DEFAULT 0,
    unit VARCHAR(30),
    purchase_price DECIMAL(10,2),
    selling_price DECIMAL(10,2),
    reorder_level INT DEFAULT 10,
    supplier VARCHAR(100),
    expiration_date DATE,
    date_added TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Legacy products (including the old "quantiity" field) remain in products_legacy
-- if that table was renamed above. Review them before importing them into the
-- new catalog: the new application also requires category, flavors, and sizes.
-- The inventory table is preserved; inventory deduction is not wired into the API.
-- Staff passwords must be generated/hashed by the Python init-db command.
-- The former DELETE FROM accounts WHERE user_id=10 is intentionally omitted.
-- Seed the shared menu. Existing product records are never overwritten.
INSERT IGNORE INTO products(id,name,category,description,price_cents,flavors,sizes,icon,available) VALUES('C01','Iced Americano','Coffee','Bold espresso over ice with a clean, refreshing finish.',9500,'["Original"]','[{"name":"Medium","extra_cents":0},{"name":"Large","extra_cents":2000}]','☕',1);
INSERT IGNORE INTO products(id,name,category,description,price_cents,flavors,sizes,icon,available) VALUES('C02','Caramel Macchiato','Coffee','Espresso and silky milk finished with caramel.',13500,'["Caramel"]','[{"name":"Medium","extra_cents":0},{"name":"Large","extra_cents":2000}]','☕',1);
INSERT IGNORE INTO products(id,name,category,description,price_cents,flavors,sizes,icon,available) VALUES('C03','Spanish Latte','Coffee','Espresso with a sweet, creamy milk blend.',13000,'["Original"]','[{"name":"Medium","extra_cents":0},{"name":"Large","extra_cents":2000}]','☕',1);
INSERT IGNORE INTO products(id,name,category,description,price_cents,flavors,sizes,icon,available) VALUES('T01','Classic Milk Tea','Milk Tea','Black tea and milk with chewy tapioca pearls.',11000,'["Original","Wintermelon"]','[{"name":"Medium","extra_cents":0},{"name":"Large","extra_cents":2000}]','🧋',1);
INSERT IGNORE INTO products(id,name,category,description,price_cents,flavors,sizes,icon,available) VALUES('T02','Brown Sugar Milk Tea','Milk Tea','Creamy milk tea with deep brown sugar notes.',12500,'["Brown Sugar"]','[{"name":"Medium","extra_cents":0},{"name":"Large","extra_cents":2000}]','🧋',1);
INSERT IGNORE INTO products(id,name,category,description,price_cents,flavors,sizes,icon,available) VALUES('T03','Okinawa Milk Tea','Milk Tea','A rich roasted tea blend with caramel sweetness.',11500,'["Okinawa"]','[{"name":"Medium","extra_cents":0},{"name":"Large","extra_cents":2000}]','🧋',1);
INSERT IGNORE INTO products(id,name,category,description,price_cents,flavors,sizes,icon,available) VALUES('F01','Mocha Frappe','Frappe','Coffee and chocolate blended with ice.',15000,'["Mocha","Dark Chocolate"]','[{"name":"Medium","extra_cents":0},{"name":"Large","extra_cents":2000}]','🥤',1);
INSERT IGNORE INTO products(id,name,category,description,price_cents,flavors,sizes,icon,available) VALUES('F02','Cookies & Cream Frappe','Frappe','A creamy ice blend with crunchy cookie pieces.',15500,'["Cookies & Cream"]','[{"name":"Medium","extra_cents":0},{"name":"Large","extra_cents":2000}]','🥤',1);
INSERT IGNORE INTO products(id,name,category,description,price_cents,flavors,sizes,icon,available) VALUES('F03','Vanilla Frappe','Frappe','A smooth, chilled vanilla blend.',14500,'["Vanilla"]','[{"name":"Medium","extra_cents":0},{"name":"Hot","extra_cents":2000}]','🥤',1);
INSERT IGNORE INTO products(id,name,category,description,price_cents,flavors,sizes,icon,available) VALUES('L01','Vanilla Latte','Latte','Smooth espresso and milk with a mellow vanilla finish.',13500,'["Vanilla"]','[{"name":"Medium","extra_cents":0},{"name":"Large","extra_cents":2000}]','☕',1);
INSERT IGNORE INTO products(id,name,category,description,price_cents,flavors,sizes,icon,available) VALUES('L02','Hazelnut Latte','Latte','Creamy espresso with a warm, nutty finish.',14000,'["Hazelnut"]','[{"name":"Medium","extra_cents":0},{"name":"Large","extra_cents":2000}]','☕',1);
INSERT IGNORE INTO products(id,name,category,description,price_cents,flavors,sizes,icon,available) VALUES('L03','Caramel Latte','Latte','Fresh espresso, milk, and buttery caramel.',14000,'["Caramel"]','[{"name":"Medium","extra_cents":0},{"name":"Large","extra_cents":2000}]','☕',1);
INSERT IGNORE INTO products(id,name,category,description,price_cents,flavors,sizes,icon,available) VALUES('M01','Iced Matcha Latte','Matcha','Earthy green tea balanced with creamy milk.',14500,'["Original"]','[{"name":"Medium","extra_cents":0},{"name":"Large","extra_cents":2000}]','🍵',1);
INSERT IGNORE INTO products(id,name,category,description,price_cents,flavors,sizes,icon,available) VALUES('M02','Strawberry Matcha','Matcha','Layered matcha and milk with a fruity strawberry finish.',16000,'["Strawberry"]','[{"name":"Medium","extra_cents":0},{"name":"Large","extra_cents":2000}]','🍵',1);
INSERT IGNORE INTO products(id,name,category,description,price_cents,flavors,sizes,icon,available) VALUES('M03','Pure Matcha','Matcha','A simple, mellow green tea blend.',13500,'["Original"]','[{"name":"Medium","extra_cents":0},{"name":"Large","extra_cents":2000}]','🍵',1);
INSERT IGNORE INTO products(id,name,category,description,price_cents,flavors,sizes,icon,available) VALUES('S01','French Fries','Snacks','Golden, crispy fries served fresh.',8500,'["Original","Cheese","Barbecue"]','[{"name":"Regular","extra_cents":0}]','🥐',1);
INSERT IGNORE INTO products(id,name,category,description,price_cents,flavors,sizes,icon,available) VALUES('S02','Butter Croissant','Snacks','A flaky, buttery pastry for your coffee break.',9500,'["Butter"]','[{"name":"Regular","extra_cents":0}]','🥐',1);
INSERT IGNORE INTO products(id,name,category,description,price_cents,flavors,sizes,icon,available) VALUES('S03','Chocolate Cookie','Snacks','A soft cookie with rich chocolate pieces.',6500,'["Chocolate"]','[{"name":"Regular","extra_cents":0}]','🥐',1);

SELECT id, name, category, price_cents / 100.00 AS price_pesos, available FROM products;
