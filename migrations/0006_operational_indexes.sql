CREATE INDEX IF NOT EXISTS login_attempts_expiry ON login_attempts(expires_at);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
