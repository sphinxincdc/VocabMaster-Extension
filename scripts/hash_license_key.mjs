#!/usr/bin/env node
import { createHash } from 'node:crypto';

function arg(name){
  const i = process.argv.indexOf(name);
  if(i === -1) return '';
  return process.argv[i + 1] || '';
}

const key = arg('--key').trim();
const salt = arg('--salt').trim();

if(!key || !salt){
  console.error('Usage: node scripts/hash_license_key.mjs --key "XXXX-XXXX" --salt "YOUR_SALT"');
  process.exit(1);
}

const hash = createHash('sha256').update(`${salt}|${key}`).digest('hex');
console.log(hash);
