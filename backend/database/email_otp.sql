-- Run against the existing portal database. No accounts are deleted or recreated.
-- If duplicate emails/phones exist, the UNIQUE index fails safely: resolve them
-- manually before rerunning. Existing email_verified values are preserved.
DELIMITER $$
DROP PROCEDURE IF EXISTS upgrade_email_otp$$
CREATE PROCEDURE upgrade_email_otp()
BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='accounts' AND column_name='email_verified') THEN
  ALTER TABLE accounts ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT TRUE;
  ALTER TABLE accounts ALTER COLUMN email_verified SET DEFAULT FALSE;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='accounts' AND column_name='user_email' AND non_unique=0) THEN
  ALTER TABLE accounts ADD UNIQUE INDEX otp_account_email(user_email);
 END IF;
 CREATE TABLE IF NOT EXISTS pending_account_verifications (
  user_email VARCHAR(255) NOT NULL PRIMARY KEY,
  phone VARCHAR(20) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  otp_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  registration_token_hash CHAR(64) NOT NULL DEFAULT ''
 ) ENGINE=InnoDB;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='pending_account_verifications' AND column_name='registration_token_hash') THEN
  ALTER TABLE pending_account_verifications ADD COLUMN registration_token_hash CHAR(64) NOT NULL DEFAULT '';
 END IF;
END$$
CALL upgrade_email_otp()$$
DROP PROCEDURE upgrade_email_otp$$
DELIMITER ;
