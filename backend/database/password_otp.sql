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
