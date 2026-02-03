'use strict';
const $ = (id)=>document.getElementById(id);

const PRODUCT_ID = 'hord.vocabmaster.chrome';
const INSTALL_SECRET_KEY = 'auth_install_secret';

function systemDark(){
  try{ return !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; }catch(_){ return false; }
}

function resolveThemeMode(db){
  if(db && (db.themeMode === 'auto' || db.themeMode === 'light' || db.themeMode === 'dark')) return db.themeMode;
  const autoMode = db?.theme_auto_mode !== false;
  const manualDark = db?.theme_dark_mode != null ? !!db.theme_dark_mode : !!db?.popup_force_dark;
  if(autoMode) return 'auto';
  return manualDark ? 'dark' : 'light';
}

function applyTheme(db){
  const mode = resolveThemeMode(db || {});
  const dark = mode === 'dark' || (mode === 'auto' && systemDark());
  document.documentElement.classList.toggle('vb-dark', dark);
  document.body.classList.toggle('vb-force-dark', dark);
}

function setStatus(text){
  const node = $('status');
  if(node) node.textContent = text || '';
}

function setAuthState(text, level){
  const node = $('authState');
  if(!node) return;
  node.textContent = text || '授权状态：未检查';
  node.classList.remove('ok', 'warn', 'err');
  if(level) node.classList.add(level);
}

function formatTs(ts){
  const n = Number(ts || 0);
  if(!n) return '—';
  try{ return new Date(n).toLocaleString(); }catch(_){ return '—'; }
}

function normalizeApiBase(raw){
  return String(raw || '').trim().replace(/\/+$/, '');
}

async function sendMessage(msg){
  return await new Promise(res=>chrome.runtime.sendMessage(msg, res));
}

function timeoutFetch(url, options, timeoutMs){
  const ctrl = new AbortController();
  const id = setTimeout(()=>ctrl.abort(), timeoutMs);
  return fetch(url, { ...(options || {}), signal: ctrl.signal }).finally(()=>clearTimeout(id));
}

function bytesToHex(bytes){
  return Array.from(bytes).map(b=>b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text){
  const data = new TextEncoder().encode(String(text || ''));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(buf));
}

async function validatePublicKeyConfig(){
  const raw = String($('authPublicKeyJwk').value || '').trim();
  if(!raw){
    setAuthState('公钥为空：请先粘贴 Ed25519 JWK', 'warn');
    return false;
  }
  try{
    const jwk = JSON.parse(raw);
    await crypto.subtle.importKey('jwk', jwk, {name:'Ed25519'}, false, ['verify']);
    setAuthState('公钥格式校验通过，可用于证书验签。', 'ok');
    return true;
  }catch(e){
    setAuthState(`公钥格式无效：${e?.message || e}`, 'err');
    return false;
  }
}

async function getInstallSecret(){
  const db = await new Promise(res=>chrome.storage.local.get([INSTALL_SECRET_KEY], res));
  const old = String(db[INSTALL_SECRET_KEY] || '').trim();
  if(old) return old;
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const next = bytesToHex(bytes);
  await new Promise(res=>chrome.storage.local.set({ [INSTALL_SECRET_KEY]: next }, res));
  return next;
}

async function buildDeviceHash(){
  const secret = await getInstallSecret();
  return await sha256Hex(`${secret}|${PRODUCT_ID}|v1`);
}

async function callAuthApi(path, payload, method){
  const base = normalizeApiBase($('authApiBase')?.value || '');
  if(!base) throw new Error('请先填写授权 API 地址');
  const url = `${base}${path}`;
  const res = await timeoutFetch(url, {
    method: method || 'POST',
    headers: {'Content-Type':'application/json'},
    body: payload ? JSON.stringify(payload) : undefined,
  }, 12000);
  const data = await res.json().catch(()=>null);
  if(!res.ok || !data || data.ok === false){
    const msg = data?.error || data?.message || `HTTP_${res.status}`;
    throw new Error(String(msg));
  }
  return data;
}

function summarizeEntitlements(ent){
  const e = ent && typeof ent === 'object' ? ent : {};
  const wl = Number(e.word_limit);
  const nl = Number(e.note_limit);
  const wv = wl < 0 ? '无限' : (Number.isFinite(wl) ? String(wl) : '—');
  const nv = nl < 0 ? '无限' : (Number.isFinite(nl) ? String(nl) : '—');
  return `词数上限: ${wv} · 批注上限: ${nv} · 导入导出: ${e.import_export ? '开' : '关'} · 批量: ${e.bulk_edit ? '开' : '关'} · 复习: ${e.review_mode || 'basic'}`;
}

async function refreshAuthState(opts){
  const withServer = !!opts?.withServer;
  const local = await sendMessage({type:'OP_GET_AUTH'});
  if(!local || !local.ok){
    setAuthState('授权状态读取失败', 'err');
    return;
  }

  const auth = local.auth || {};
  const ent = local.entitlements || auth.entitlements || {};
  let text = [
    `授权状态: ${auth.status || 'inactive'}`,
    `方案: ${auth.plan || 'free'}`,
    `来源: ${local.source || auth.source || 'free'}`,
    `到期时间: ${formatTs(auth.expiresAt)}`,
    summarizeEntitlements(ent),
  ];

  if(withServer){
    try{
      const key = String($('licenseCode')?.value || '').trim();
      const base = normalizeApiBase($('authApiBase')?.value || '');
      if(key && base){
        const query = new URLSearchParams({license_key: key, product_id: PRODUCT_ID});
        const data = await callAuthApi(`/v1/licenses/status?${query.toString()}`, null, 'GET');
        text.push(`服务器设备占用: ${data.active_devices ?? '-'} / ${data.max_devices ?? '-'}`);
      }
    }catch(e){
      text.push(`服务器状态查询失败: ${e.message || e}`);
    }
  }

  const level = auth.status === 'active' ? 'ok' : (auth.status === 'expired' ? 'warn' : 'warn');
  setAuthState(text.join('\n'), level);
}

async function load(){
  const db = await new Promise(res=>chrome.storage.local.get(res));
  $('licenseCode').value = db.licenseCode || '';
  $('authApiBase').value = db.authApiBase || '';
  $('authPublicKeyJwk').value = db.authPublicKeyJwk || '';
  $('authAllowUnsignedCert').checked = !!db.authAllowUnsignedCert;

  // existing
  $('aliyunId').value = db.aliyunId || '';
  $('aliyunKey').value = db.aliyunKey || '';
  $('tencentId').value = db.tencentId || '';
  $('tencentKey').value = db.tencentKey || '';

  // BYOK
  $('azureKey').value = db.azureKey || '';
  $('azureRegion').value = db.azureRegion || '';
  $('caiyunToken').value = db.caiyunToken || '';
  $('youdaoAppKey').value = db.youdaoAppKey || '';
  $('youdaoAppSecret').value = db.youdaoAppSecret || '';
  applyTheme(db);
  await refreshAuthState({withServer:false});
}

async function save(){
  const patch = {
    licenseCode: $('licenseCode').value.trim(),
    authApiBase: normalizeApiBase($('authApiBase').value),
    authPublicKeyJwk: String($('authPublicKeyJwk').value || '').trim(),
    authAllowUnsignedCert: !!$('authAllowUnsignedCert').checked,

    aliyunId: $('aliyunId').value.trim(),
    aliyunKey: $('aliyunKey').value.trim(),
    tencentId: $('tencentId').value.trim(),
    tencentKey: $('tencentKey').value.trim(),

    azureKey: $('azureKey').value.trim(),
    azureRegion: $('azureRegion').value.trim(),
    caiyunToken: $('caiyunToken').value.trim(),
    youdaoAppKey: $('youdaoAppKey').value.trim(),
    youdaoAppSecret: $('youdaoAppSecret').value.trim(),
  };
  await new Promise(res=>chrome.storage.local.set(patch, res));
  setStatus('已保存 ✅');
  setTimeout(()=>setStatus(''), 1500);
}

async function activateLicense(){
  const key = String($('licenseCode').value || '').trim();
  if(!key){
    setAuthState('激活失败：请先填写 License Key', 'err');
    return;
  }
  await save();
  setStatus('激活中...');
  try{
    const deviceHash = await buildDeviceHash();
    const appVersion = chrome.runtime.getManifest()?.version || '';
    const data = await callAuthApi('/v1/licenses/activate', {
      license_key: key,
      device_hash: deviceHash,
      product_id: PRODUCT_ID,
      app_version: appVersion,
    }, 'POST');

    const cert = data.certificate || data.cert;
    if(!cert) throw new Error('服务端未返回证书');
    const applied = await sendMessage({
      type:'OP_SET_AUTH_CERT',
      payload:{
        certificate: cert,
        licenseCode: key,
      }
    });
    if(!applied || !applied.ok){
      const map = {
        AUTH_PUBLIC_KEY_MISSING: '缺少授权公钥，请先填写公钥 JWK',
        AUTH_PUBLIC_KEY_INVALID_JSON: '公钥 JWK 不是合法 JSON',
        CERT_SIGNATURE_MISSING: '证书缺少签名字段',
        CERT_SIGNATURE_INVALID: '证书签名校验失败',
        CERT_VERIFY_FAILED: '证书验签失败',
      };
      throw new Error(map[applied?.error] || applied?.error || '本地写入授权失败');
    }
    await refreshAuthState({withServer:true});
    setStatus('激活成功 ✅');
  }catch(e){
    setAuthState(`激活失败：${e?.message || e}`, 'err');
    setStatus('激活失败');
  }finally{
    setTimeout(()=>setStatus(''), 2000);
  }
}

async function deactivateLicense(){
  const key = String($('licenseCode').value || '').trim();
  const base = normalizeApiBase($('authApiBase').value);
  setStatus('解绑中...');
  try{
    if(key && base){
      const deviceHash = await buildDeviceHash();
      await callAuthApi('/v1/licenses/deactivate', {
        license_key: key,
        device_hash: deviceHash,
        product_id: PRODUCT_ID,
      }, 'POST');
    }
    await sendMessage({type:'OP_CLEAR_AUTH'});
    await refreshAuthState({withServer:false});
    setStatus('解绑完成 ✅');
  }catch(e){
    setAuthState(`解绑失败：${e?.message || e}`, 'err');
    setStatus('解绑失败');
  }finally{
    setTimeout(()=>setStatus(''), 2000);
  }
}

async function clearLocalAuth(){
  await sendMessage({type:'OP_CLEAR_AUTH'});
  await refreshAuthState({withServer:false});
  setStatus('已清除本地授权');
  setTimeout(()=>setStatus(''), 1500);
}

function openPage(path){
  chrome.tabs.create({url: chrome.runtime.getURL(path)});
}

document.addEventListener('DOMContentLoaded', ()=>{
  load();
  try{
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onThemeChange = ()=>chrome.storage.local.get(['themeMode','theme_auto_mode','theme_dark_mode','popup_force_dark'], applyTheme);
    if(mq.addEventListener) mq.addEventListener('change', onThemeChange);
    else if(mq.addListener) mq.addListener(onThemeChange);
  }catch(_){/* ignore */}

  $('save').addEventListener('click', save);
  $('openManager').addEventListener('click', ()=>openPage('manager.html'));
  $('openReview').addEventListener('click', ()=>openPage('test.html'));
  $('activateLicense').addEventListener('click', activateLicense);
  $('deactivateLicense').addEventListener('click', deactivateLicense);
  $('refreshAuth').addEventListener('click', ()=>refreshAuthState({withServer:true}));
  $('validatePublicKey').addEventListener('click', validatePublicKeyConfig);
  $('clearAuthLocal').addEventListener('click', clearLocalAuth);

  document.querySelectorAll('[data-eye-target]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.getAttribute('data-eye-target');
      const input = id ? $(id) : null;
      if(!input) return;
      const nextType = input.type === 'password' ? 'text' : 'password';
      input.type = nextType;
      btn.textContent = nextType === 'password' ? '👁' : '🙈';
    });
  });

  ['licenseCode','azureKey','tencentId','tencentKey','aliyunId','aliyunKey','caiyunToken','youdaoAppKey','youdaoAppSecret'].forEach(id=>{
    const input = $(id);
    if(input) input.type = 'password';
  });

  try{
    chrome.storage.onChanged.addListener((changes, area)=>{
      if(area !== 'local') return;
      if(!changes.themeMode && !changes.theme_auto_mode && !changes.theme_dark_mode && !changes.popup_force_dark) return;
      chrome.storage.local.get(['themeMode','theme_auto_mode','theme_dark_mode','popup_force_dark'], applyTheme);
    });
    chrome.runtime.onMessage.addListener((msg)=>{
      if(msg && msg.type === 'THEME_UPDATED'){
        chrome.storage.local.get(['themeMode','theme_auto_mode','theme_dark_mode','popup_force_dark'], applyTheme);
      }
    });
  }catch(_){/* ignore */}

  document.querySelectorAll('[data-test-provider]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const provider = btn.getAttribute('data-test-provider');
      if(!provider) return;
      btn.disabled = true;
      const old = btn.textContent;
      btn.dataset.state = 'pending';
      btn.textContent = '测试中...';
      try{
        const r = await new Promise(res=>chrome.runtime.sendMessage({
          type:'TEST_TRANSLATE_PROVIDER',
          provider,
          text:'Hello world. This is a test.'
        }, res));
        if(!r || !r.ok){
          btn.dataset.state = 'fail';
          btn.textContent = '失败';
        }else{
          const ok = !!(r.result && r.result.ok);
          btn.dataset.state = ok ? 'success' : 'fail';
          btn.textContent = ok ? '成功' : '失败';
        }
      }catch(e){
        btn.dataset.state = 'fail';
        btn.textContent = '失败';
      }finally{
        setTimeout(()=>{ btn.textContent = old; btn.disabled = false; btn.dataset.state = 'idle'; }, 1200);
      }
    });
  });
});
