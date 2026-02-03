#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

function arg(name, fallback=''){
  const i = process.argv.indexOf(name);
  if(i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

const dbId = String(arg('--db-id')).trim();
const dbName = String(arg('--db-name', 'hord-license-db')).trim();
const workerName = String(arg('--name', 'hord-license-service')).trim();
const main = String(arg('--main', 'scripts/license_worker_example.mjs')).trim();

if(!dbId){
  console.error('Usage: node scripts/setup_license_env.mjs --db-id <D1_DATABASE_ID> [--db-name hord-license-db] [--name hord-license-service]');
  process.exit(1);
}

let template = '';
if(existsSync('wrangler.toml.example')){
  template = readFileSync('wrangler.toml.example', 'utf8');
}else{
  template = `name = "${workerName}"\nmain = "${main}"\ncompatibility_date = "2026-02-03"\n\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "${dbName}"\ndatabase_id = "${dbId}"\n`;
}

let out = template;
out = out.replace(/name\s*=\s*"[^"]*"/, `name = "${workerName}"`);
out = out.replace(/main\s*=\s*"[^"]*"/, `main = "${main}"`);
out = out.replace(/database_name\s*=\s*"[^"]*"/, `database_name = "${dbName}"`);
out = out.replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${dbId}"`);

writeFileSync('wrangler.toml', out, 'utf8');

console.log('Generated: wrangler.toml');
console.log(`- worker: ${workerName}`);
console.log(`- db_name: ${dbName}`);
console.log(`- db_id: ${dbId}`);
