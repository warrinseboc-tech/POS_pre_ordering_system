USE istillo_db;

-- Add the column only if it is missing, so this migration can be rerun safely.
SET @email_verified_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'accounts'
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
