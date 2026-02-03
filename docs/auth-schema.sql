-- License 主表
CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  license_key_hash TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active|expired|revoked
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  max_devices INTEGER NOT NULL DEFAULT 2,
  entitlements_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 激活设备表
CREATE TABLE IF NOT EXISTS license_activations (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active|deactivated
  activated_at INTEGER NOT NULL,
  deactivated_at INTEGER,
  last_seen_at INTEGER,
  UNIQUE(license_id, device_hash),
  FOREIGN KEY (license_id) REFERENCES licenses(id)
);

-- 审计事件表
CREATE TABLE IF NOT EXISTS license_events (
  id TEXT PRIMARY KEY,
  license_id TEXT,
  event_type TEXT NOT NULL, -- activate|deactivate|activate_denied|refund|revoke
  reason TEXT,
  device_hash TEXT,
  ip_hash TEXT,
  payload_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (license_id) REFERENCES licenses(id)
);

CREATE INDEX IF NOT EXISTS idx_license_activations_license_id ON license_activations(license_id);
CREATE INDEX IF NOT EXISTS idx_license_events_license_id ON license_events(license_id);
CREATE INDEX IF NOT EXISTS idx_license_events_type ON license_events(event_type);
