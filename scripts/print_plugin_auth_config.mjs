#!/usr/bin/env node

function arg(name, fallback=''){
  const i = process.argv.indexOf(name);
  if(i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

const api = String(arg('--api')).trim();
const pub = String(arg('--pub-jwk')).trim();
const key = String(arg('--key')).trim();

if(!api || !pub || !key){
  console.error('Usage: node scripts/print_plugin_auth_config.mjs --api https://xxx.workers.dev --pub-jwk "{...}" --key "TEST-KEY-2026"');
  process.exit(1);
}

console.log('在插件设置页填入以下值：');
console.log('--------------------------------');
console.log('授权 API 地址:');
console.log(api);
console.log('\n授权公钥 JWK:');
console.log(pub);
console.log('\nLicense Key:');
console.log(key);
console.log('--------------------------------');
