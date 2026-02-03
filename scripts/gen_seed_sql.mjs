#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';

function arg(name, fallback=''){
  const i = process.argv.indexOf(name);
  if(i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

const licenseKey = String(arg('--key')).trim();
const salt = String(arg('--salt')).trim();
const productId = String(arg('--product', 'hord.vocabmaster.chrome')).trim();
const plan = String(arg('--plan', 'pro_annual')).trim();
const maxDevices = Number(arg('--max-devices', '2')) || 2;
const years = Number(arg('--years', '1')) || 1;

if(!licenseKey || !salt){
  console.error('Usage: node scripts/gen_seed_sql.mjs --key "TEST-KEY-2026" --salt "YOUR_LICENSE_KEY_SALT" [--product hord.vocabmaster.chrome] [--years 1] [--max-devices 2]');
  process.exit(1);
}

const now = Date.now();
const expiresAt = now + Math.floor(years * 365 * 24 * 60 * 60 * 1000);
const hash = createHash('sha256').update(`${salt}|${licenseKey}`).digest('hex');
const id = `lic_${randomUUID().replace(/-/g,'').slice(0,16)}`;

const entitlements = {
  word_limit: -1,
  note_limit: -1,
  import_export: true,
  bulk_edit: true,
  review_mode: 'advanced',
  quote_export_enabled: true,
  quote_templates: ['light','dark','hordSignature','editorial','gradientSoft','boldImpact'],
  quote_advanced_settings: true,
};

const sql = `INSERT INTO licenses (\n  id,\n  product_id,\n  license_key_hash,\n  plan,\n  status,\n  issued_at,\n  expires_at,\n  max_devices,\n  entitlements_json,\n  created_at,\n  updated_at\n) VALUES (\n  '${id}',\n  '${productId}',\n  '${hash}',\n  '${plan}',\n  'active',\n  ${now},\n  ${expiresAt},\n  ${maxDevices},\n  '${JSON.stringify(entitlements)}',\n  ${now},\n  ${now}\n);`;

console.log('-- license_key:', licenseKey);
console.log('-- license_id:', id);
console.log('-- expires_at:', new Date(expiresAt).toISOString());
console.log(sql);
