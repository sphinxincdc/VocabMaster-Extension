#!/usr/bin/env node
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });

console.log('PUBLIC_JWK=');
console.log(JSON.stringify(pub));
console.log('\nPRIVATE_JWK=');
console.log(JSON.stringify(priv));
