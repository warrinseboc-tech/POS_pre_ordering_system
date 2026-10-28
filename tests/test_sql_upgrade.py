"""Check the Workbench script against a disposable copy of the legacy layout."""
import secrets
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from istilo import create_app
from istilo.db import connect


def statements(source):
    delimiter = ';'
    pending = []
    for line in source.splitlines():
        if line.strip().upper().startswith('DELIMITER '):
            delimiter = line.strip().split(None, 1)[1]
            continue
        pending.append(line)
        if line.rstrip().endswith(delimiter):
            yield '\n'.join(pending).rstrip()[:-len(delimiter)]
            pending = []
    if '\n'.join(pending).strip():
        raise ValueError('Unterminated SQL statement')


class SQLUpgradeTests(unittest.TestCase):
    def test_preserves_legacy_data_and_reruns(self):
        name = 'istillo_sql_test_' + secrets.token_hex(6)
        app = create_app({'DB_NAME': name, 'TESTING': True})
        with app.app_context():
            connection = connect(False)
            cursor = connection.cursor()
            try:
                cursor.execute(f'CREATE DATABASE `{name}` CHARACTER SET utf8mb4')
                cursor.execute(f'USE `{name}`')
                cursor.execute('CREATE TABLE accounts(user_id INT PRIMARY KEY, password VARCHAR(255), user_email VARCHAR(255), phone VARCHAR(20), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)')
                cursor.execute("INSERT INTO accounts(user_id,user_email) VALUES(10,'preserved@example.com')")
                cursor.execute('CREATE TABLE products(product_id INT PRIMARY KEY AUTO_INCREMENT,product_name VARCHAR(255),price INT,quantiity INT,sell_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,descriptions TEXT)')
                cursor.execute("INSERT INTO products(product_name,price,quantiity,descriptions) VALUES('Legacy drink',120,3,'Retained original')")
                connection.commit()
                source = (Path(__file__).resolve().parents[1] / 'backend/database/istillo_db.sql').read_text(encoding='utf-8').replace('istillo_db', name)
                for _ in range(2):
                    for statement in statements(source):
                        cursor.execute(statement)
                        if cursor.with_rows:
                            cursor.fetchall()
                    connection.commit()
                cursor.execute('SELECT COUNT(*) FROM accounts WHERE user_id=10')
                self.assertEqual(cursor.fetchone()[0], 1)
                cursor.execute('SELECT email_verified FROM accounts WHERE user_id=10')
                self.assertEqual(cursor.fetchone()[0], 0)
                cursor.execute('SELECT product_name,price,quantiity FROM products_legacy')
                self.assertEqual(cursor.fetchone(), ('Legacy drink', 120, 3))
                cursor.execute('SELECT COUNT(*) FROM products')
                self.assertEqual(cursor.fetchone()[0], 18)
                cursor.execute('SHOW TABLES')
                names = {row[0] for row in cursor.fetchall()}
                self.assertTrue({'inventory','users','orders','payment_proofs','pending_account_verifications'} <= names)
            finally:
                if not name.startswith('istillo_sql_test_'):
                    raise RuntimeError('Refusing cleanup of a non-test database')
                cursor.execute(f'DROP DATABASE IF EXISTS `{name}`')
                cursor.close()
                connection.close()


if __name__ == '__main__':
    unittest.main()
