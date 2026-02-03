/**
 * Cloudflare Worker example for license backend.
 * Bindings expected:
 * - DB: D1 database
 * - LICENSE_KEY_SALT: secret string
 * - LICENSE_SIGN_PRIVATE_JWK: secret JSON string (Ed25519 private JWK)
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const PRODUCT_ID_DEFAULT = 'hord.vocabmaster.chrome';

function json(data, status = 200){
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
    },
  });
}

function badRequest(error){
  return json({ok:false, error}, 400);
}

function safeJsonParse(raw, fallback = null){
  try{ return JSON.parse(String(raw || '')); }
  catch(_){ return fallback; }
}

function toSortedObject(value){
  if(Array.isArray(value)) return value.map(toSortedObject);
  if(value && typeof value === 'object'){
    const out = {};
    for(const key of Object.keys(value).sort()) out[key] = toSortedObject(value[key]);
    return out;
  }
  return value;
}

function stableStringify(value){
  return JSON.stringify(toSortedObject(value));
}

function bytesToHex(bytes){
  return Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function bytesToBase64Url(bytes){
  const bin = String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

async function sha256Hex(input){
  const data = new TextEncoder().encode(String(input || ''));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(hash));
}

async function hashLicenseKey(licenseKey, salt){
  return await sha256Hex(`${String(salt || '')}|${String(licenseKey || '').trim()}`);
}

async function signCertificatePayload(payload, privateJwkRaw){
  const jwk = safeJsonParse(String(privateJwkRaw || '').trim(), null);
  if(!jwk) throw new Error('INVALID_PRIVATE_JWK_SECRET');
  const key = await crypto.subtle.importKey('jwk', jwk, {name:'Ed25519'}, false, ['sign']);
  const body = new TextEncoder().encode(stableStringify(payload));
  const sig = await crypto.subtle.sign({name:'Ed25519'}, key, body);
  return bytesToBase64Url(new Uint8Array(sig));
}

async function parseJson(request){
  try{ return await request.json(); }
  catch(_){ return null; }
}

function nowMs(){ return Date.now(); }

function normalizeEntitlements(raw){
  const fallback = {
    word_limit: -1,
    note_limit: -1,
    import_export: true,
    bulk_edit: true,
    review_mode: 'advanced',
    quote_export_enabled: true,
    quote_templates: ['light','dark','hordSignature','editorial','gradientSoft','boldImpact'],
    quote_advanced_settings: true,
  };
  if(!raw || typeof raw !== 'object') return fallback;
  return {...fallback, ...raw};
}

async function getLicenseByKey(db, productId, licenseKeyHash){
  return await db.prepare(
    'SELECT id, product_id, plan, status, expires_at, max_devices, entitlements_json FROM licenses WHERE product_id = ? AND license_key_hash = ? LIMIT 1'
  ).bind(productId, licenseKeyHash).first();
}

async function countActiveDevices(db, licenseId){
  const row = await db.prepare(
    'SELECT COUNT(1) AS c FROM license_activations WHERE license_id = ? AND status = ?'
  ).bind(licenseId, 'active').first();
  return Number(row?.c || 0);
}

async function getActivation(db, licenseId, deviceHash){
  return await db.prepare(
    'SELECT id, status FROM license_activations WHERE license_id = ? AND device_hash = ? LIMIT 1'
  ).bind(licenseId, deviceHash).first();
}

async function logEvent(db, licenseId, eventType, reason, payload){
  const id = crypto.randomUUID();
  const ts = nowMs();
  await db.prepare(
    'INSERT INTO license_events (id, license_id, event_type, reason, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, licenseId || null, eventType, reason || null, payload ? JSON.stringify(payload) : null, ts).run();
}

async function handleActivate(request, env){
  const body = await parseJson(request);
  if(!body) return badRequest('INVALID_JSON');

  const licenseKey = String(body.license_key || '').trim();
  const deviceHash = String(body.device_hash || '').trim();
  const productId = String(body.product_id || PRODUCT_ID_DEFAULT).trim();
  if(!licenseKey || !deviceHash || !productId) return badRequest('MISSING_FIELDS');

  const keyHash = await hashLicenseKey(licenseKey, env.LICENSE_KEY_SALT || '');
  const license = await getLicenseByKey(env.DB, productId, keyHash);
  if(!license){
    await logEvent(env.DB, null, 'activate_denied', 'license_not_found', {productId});
    return json({ok:false, error:'LICENSE_NOT_FOUND'}, 404);
  }

  const now = nowMs();
  if(String(license.status || '').toLowerCase() !== 'active'){
    await logEvent(env.DB, license.id, 'activate_denied', 'license_not_active');
    return json({ok:false, error:'LICENSE_NOT_ACTIVE'}, 403);
  }
  if(Number(license.expires_at || 0) <= now){
    await logEvent(env.DB, license.id, 'activate_denied', 'license_expired');
    return json({ok:false, error:'LICENSE_EXPIRED'}, 403);
  }

  const existing = await getActivation(env.DB, license.id, deviceHash);
  if(!existing || String(existing.status || '').toLowerCase() !== 'active'){
    const activeCount = await countActiveDevices(env.DB, license.id);
    if(activeCount >= Number(license.max_devices || 2)){
      await logEvent(env.DB, license.id, 'activate_denied', 'device_limit_reached', {activeCount});
      return json({ok:false, error:'DEVICE_LIMIT_REACHED', max_devices:Number(license.max_devices || 2), active_devices:activeCount}, 403);
    }
  }

  if(existing){
    await env.DB.prepare(
      'UPDATE license_activations SET status = ?, activated_at = ?, deactivated_at = NULL, last_seen_at = ? WHERE id = ?'
    ).bind('active', now, now, existing.id).run();
  }else{
    await env.DB.prepare(
      'INSERT INTO license_activations (id, license_id, device_hash, status, activated_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), license.id, deviceHash, 'active', now, now).run();
  }

  const entitlements = normalizeEntitlements(
    license.entitlements_json ? safeJsonParse(license.entitlements_json, null) : null
  );

  const payload = {
    license_id: license.id,
    product_id: productId,
    plan: String(license.plan || 'pro_annual'),
    issued_at: now,
    expires_at: Number(license.expires_at),
    device_hash: deviceHash,
    entitlements,
    cert_version: 1,
  };
  const sig = await signCertificatePayload(payload, env.LICENSE_SIGN_PRIVATE_JWK);
  const certificate = {...payload, sig};

  await logEvent(env.DB, license.id, 'activate', null, {deviceHash});
  return json({ok:true, certificate});
}

async function handleDeactivate(request, env){
  const body = await parseJson(request);
  if(!body) return badRequest('INVALID_JSON');

  const licenseKey = String(body.license_key || '').trim();
  const deviceHash = String(body.device_hash || '').trim();
  const productId = String(body.product_id || PRODUCT_ID_DEFAULT).trim();
  if(!licenseKey || !deviceHash || !productId) return badRequest('MISSING_FIELDS');

  const keyHash = await hashLicenseKey(licenseKey, env.LICENSE_KEY_SALT || '');
  const license = await getLicenseByKey(env.DB, productId, keyHash);
  if(!license) return json({ok:false, error:'LICENSE_NOT_FOUND'}, 404);

  const now = nowMs();
  await env.DB.prepare(
    'UPDATE license_activations SET status = ?, deactivated_at = ?, last_seen_at = ? WHERE license_id = ? AND device_hash = ? AND status = ?'
  ).bind('deactivated', now, now, license.id, deviceHash, 'active').run();

  await logEvent(env.DB, license.id, 'deactivate', null, {deviceHash});
  return json({ok:true});
}

async function handleStatus(request, env){
  const url = new URL(request.url);
  const licenseKey = String(url.searchParams.get('license_key') || '').trim();
  const productId = String(url.searchParams.get('product_id') || PRODUCT_ID_DEFAULT).trim();
  if(!licenseKey || !productId) return badRequest('MISSING_FIELDS');

  const keyHash = await hashLicenseKey(licenseKey, env.LICENSE_KEY_SALT || '');
  const license = await getLicenseByKey(env.DB, productId, keyHash);
  if(!license) return json({ok:false, error:'LICENSE_NOT_FOUND'}, 404);

  const activeDevices = await countActiveDevices(env.DB, license.id);
  const entitlements = normalizeEntitlements(
    license.entitlements_json ? safeJsonParse(license.entitlements_json, null) : null
  );

  return json({
    ok:true,
    plan: String(license.plan || 'pro_annual'),
    status: String(license.status || 'active'),
    expires_at: Number(license.expires_at || 0),
    max_devices: Number(license.max_devices || 2),
    active_devices: activeDevices,
    entitlements,
  });
}

export default {
  async fetch(request, env){
    try{
      if(request.method === 'OPTIONS') return new Response('', {status:204, headers:CORS_HEADERS});

      const url = new URL(request.url);
      if(url.pathname === '/v1/licenses/activate' && request.method === 'POST'){
        return await handleActivate(request, env);
      }
      if(url.pathname === '/v1/licenses/deactivate' && request.method === 'POST'){
        return await handleDeactivate(request, env);
      }
      if(url.pathname === '/v1/licenses/status' && request.method === 'GET'){
        return await handleStatus(request, env);
      }

      return json({ok:false, error:'NOT_FOUND'}, 404);
    }catch(err){
      return json({
        ok:false,
        error:'WORKER_INTERNAL_ERROR',
        message: String(err?.message || err || 'unknown'),
      }, 500);
    }
  }
};
