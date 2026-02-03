-- Example seed for one Pro annual license.
-- 1) Generate hash with:
--    node scripts/hash_license_key.mjs --key "TEST-KEY-2026" --salt "YOUR_LICENSE_KEY_SALT"
-- 2) Replace LICENSE_KEY_HASH_HERE below.

INSERT INTO licenses (
  id,
  product_id,
  license_key_hash,
  plan,
  status,
  issued_at,
  expires_at,
  max_devices,
  entitlements_json,
  created_at,
  updated_at
) VALUES (
  'lic_test_2026_001',
  'hord.vocabmaster.chrome',
  'LICENSE_KEY_HASH_HERE',
  'pro_annual',
  'active',
  1760000000000,
  1791536000000,
  2,
  '{"word_limit":-1,"note_limit":-1,"import_export":true,"bulk_edit":true,"review_mode":"advanced","quote_export_enabled":true,"quote_templates":["light","dark","hordSignature","editorial","gradientSoft","boldImpact"],"quote_advanced_settings":true}',
  1760000000000,
  1760000000000
);
