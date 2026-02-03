'use strict';

const $ = (id)=>document.getElementById(id);
let activeUrl = '';
let activeTitle = '';

function openPage(path){
  chrome.tabs.create({url: chrome.runtime.getURL(path)});
}

function uniq(arr){
  return Array.from(new Set(arr));
}

function norm(s){
  return String(s||'').trim();
}

async function getActiveTab(){
  const tabs = await chrome.tabs.query({active:true, currentWindow:true});
  return tabs && tabs[0] ? tabs[0] : null;
}

function pageKey(url){
  try{ return String(url||'').split('#')[0]; }catch(e){ return ''; }
}

function domainKey(url){
  try{ return new URL(url).hostname; }catch(e){ return ''; }
}

async function getDB(keys){
  return await new Promise(res=>{
    if(!keys) chrome.storage.local.get(r=>res(r));
    else chrome.storage.local.get(keys, r=>res(r));
  });
}

async function setDB(patch){
  return await new Promise(res=>chrome.storage.local.set(patch, res));
}

async function sendMsg(msg){
  return await new Promise(res=>chrome.runtime.sendMessage(msg, r=>res(r)));
}

function setError(text){
  $('err').style.display = text ? 'block' : 'none';
  $('err').textContent = text || '';
}

function setOut(text){
  $('out').style.display = text ? 'block' : 'none';
  $('out').textContent = text || '';
}

function isSystemDark(){
  try{ return !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; }catch(_){ return false; }
}

function resolveThemeMode(db){
  if(db && (db.themeMode === 'auto' || db.themeMode === 'light' || db.themeMode === 'dark')) return db.themeMode;
  const autoMode = db?.theme_auto_mode !== false;
  const manualDark = db?.theme_dark_mode != null ? !!db.theme_dark_mode : !!db?.popup_force_dark;
  if(autoMode) return 'auto';
  return manualDark ? 'dark' : 'light';
}

function getEffectiveDark(themeMode){
  return themeMode === 'dark' || (themeMode === 'auto' && isSystemDark());
}

function applyPopupTheme(isDark){
  const dark = !!isDark;
  document.documentElement.classList.toggle('vb-dark', dark);
  document.documentElement.classList.toggle('vb-light', !dark);
  document.body.classList.toggle('vb-force-dark', dark);
  document.body.classList.toggle('vb-force-light', !dark);
}


function isLikelyWord(text){
  // single token (allow apostrophe, hyphen)
  const t = norm(text);
  if(!t) return false;
  if(t.length > 48) return false;
  if(/[\s\n\r\t]/.test(t)) return false;
  return true;
}

async function doTranslate(text){
  const t = norm(text);
  if(!t) return null;
  const r = await sendMsg({type:'GET_TRANSLATIONS', text: t, mode:'translate'});
  if(r && r.ok){
    return {text: r.translation || '', translations: Array.isArray(r.translations) ? r.translations : []};
  }
  return {text:'', translations:[]};
}


async function addWordOrSentence(text, translation){
  const t = norm(text);
  if(!t) return {ok:false, error:'empty'};
  if(isLikelyWord(t)){
    return await sendMsg({
      type:'UPSERT_WORD',
      word: t,
      meaning: translation || '',
      status:'yellow'
    });
  }else{
    return await sendMsg({
      type:'ADD_SENTENCE', forceUrl: (typeof location!=='undefined'?location.href:''),
      text: t,
      translation: translation || '',
      url: activeUrl,
      title: activeTitle
    });
  }
}

(async function init(){

  $('openManager').addEventListener('click', ()=>openPage('manager.html'));
  $('openQuotes').addEventListener('click', ()=>openPage('manager.html?tab=sentences'));
  $('openReview').addEventListener('click', ()=>openPage('test.html'));
  $('openOptions').addEventListener('click', ()=>openPage('options.html'));

  const tab = await getActiveTab();
  activeUrl = tab && tab.url ? tab.url : '';
  activeTitle = tab && tab.title ? tab.title : '';
  const url = activeUrl;
  const dKey = (domainKey(url)||'').toLowerCase();
  const pKey = (pageKey(url)||'').toLowerCase();

  const db = await getDB(['blacklist_domain','blacklist_page','global_disable','popup_force_dark','theme_auto_mode','theme_dark_mode','themeMode']);
  const blDomain = Array.isArray(db.blacklist_domain) ? db.blacklist_domain.map(x=>String(x||'').toLowerCase()) : [];
  const blPage = Array.isArray(db.blacklist_page) ? db.blacklist_page.map(x=>String(x||'').toLowerCase()) : [];
  const gOff = !!db.global_disable;
  let themeModeCurrent = resolveThemeMode(db);

  let blockMode = 'off';
  if(gOff) blockMode = 'global';
  else if(pKey && blPage.includes(pKey)) blockMode = 'page';
  else if(dKey && blDomain.includes(dKey)) blockMode = 'domain';

  applyPopupTheme(getEffectiveDark(themeModeCurrent));

  function getThemeModeLabel(mode){
    if(mode === 'dark') return '始终深色';
    if(mode === 'light') return '始终浅色';
    return '跟随系统';
  }

  function getThemeModeHint(mode){
    if(mode === 'dark') return '当前：始终深色（不跟随系统）';
    if(mode === 'light') return '当前：始终浅色（不跟随系统）';
    return '当前：跟随系统';
  }

  function getNextThemeMode(mode){
    const modes = ['auto', 'dark', 'light'];
    const i = modes.indexOf(mode);
    return modes[(i + 1) % modes.length];
  }

  function getBlockModeLabel(mode){
    if(mode === 'page') return '本页停用';
    if(mode === 'domain') return '本域名停用';
    if(mode === 'global') return '全部停用';
    return '正常运行';
  }

  function getBlockModeHint(mode){
    if(mode === 'page') return `当前页已停用：${pKey ? (pKey.length > 38 ? pKey.slice(0, 38) + '…' : pKey) : '此页'}`;
    if(mode === 'domain') return `当前域名已停用：${dKey || '此域名'}`;
    if(mode === 'global') return '全部网页已停用（点击右侧切换）';
    return '正常运行（点击右侧切换：此页/域名/全部）';
  }

  function getNextBlockMode(mode){
    const modes = ['off'];
    if(pKey) modes.push('page');
    if(dKey) modes.push('domain');
    modes.push('global');
    const i = modes.indexOf(mode);
    return modes[(i + 1) % modes.length];
  }

  function paintToggleRows(){
    const setOn = (rowId, on)=>{ const el = $(rowId); if(el) el.dataset.on = on ? '1' : '0'; };
    if($('rowThemeMode')) setOn('rowThemeMode', themeModeCurrent === 'dark');
    if($('btnThemeMode')){
      $('btnThemeMode').dataset.mode = themeModeCurrent;
      $('btnThemeMode').textContent = getThemeModeLabel(themeModeCurrent);
    }
    if($('themeModeHint')){
      const hint = getThemeModeHint(themeModeCurrent);
      $('themeModeHint').textContent = hint;
      $('themeModeHint').title = hint;
    }
    setOn('rowBlockMode', blockMode !== 'off');
    if($('btnBlockMode')){
      $('btnBlockMode').dataset.mode = blockMode;
      $('btnBlockMode').textContent = getBlockModeLabel(blockMode);
    }
    if($('blockModeHint')){
      const hint = getBlockModeHint(blockMode);
      $('blockModeHint').textContent = hint;
      $('blockModeHint').title = hint;
    }
  }
  paintToggleRows();

  async function syncSwitches(){
    let nextBlDomain = blDomain.slice();
    let nextBlPage = blPage.slice();
    const nextGlobal = blockMode === 'global';

    if(dKey) nextBlDomain = nextBlDomain.filter(x=>x!==dKey);
    if(pKey) nextBlPage = nextBlPage.filter(x=>x!==pKey);

    if(blockMode === 'domain' && dKey && !nextBlDomain.includes(dKey)) nextBlDomain.push(dKey);
    if(blockMode === 'page' && pKey && !nextBlPage.includes(pKey)) nextBlPage.push(pKey);

    const nextThemeMode = themeModeCurrent;
    const nextAutoMode = nextThemeMode === 'auto';
    const nextManualDark = nextThemeMode === 'dark';
    await setDB({
      global_disable: nextGlobal,
      blacklist_domain: uniq(nextBlDomain),
      blacklist_page: uniq(nextBlPage),
      popup_force_dark: nextManualDark,
      theme_auto_mode: nextAutoMode,
      theme_dark_mode: nextManualDark,
      themeMode: nextThemeMode
    });
    try{ chrome.runtime.sendMessage({type:'THEME_UPDATED', themeMode: nextThemeMode}); }catch(_){/* ignore */}

    // Update local mirrors so additional toggles are consistent
    blDomain.length = 0; blDomain.push(...uniq(nextBlDomain));
    blPage.length = 0; blPage.push(...uniq(nextBlPage));

    applyPopupTheme(getEffectiveDark(nextThemeMode));
    paintToggleRows();
  }

  if($('btnThemeMode')) $('btnThemeMode').addEventListener('click', async ()=>{
    themeModeCurrent = getNextThemeMode(themeModeCurrent);
    await syncSwitches();
  });
  if($('btnBlockMode')) $('btnBlockMode').addEventListener('click', async ()=>{
    const nextMode = getNextBlockMode(blockMode);
    if(nextMode === 'global'){
      const ok = window.confirm('将完全关闭插件（所有网页停用），确定继续吗？');
      if(!ok) return;
    }
    blockMode = nextMode;
    await syncSwitches();
  });
  try{
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onThemeChange = ()=>{
      applyPopupTheme(getEffectiveDark(themeModeCurrent));
    };
    if (mq.addEventListener) mq.addEventListener('change', onThemeChange);
    else if (mq.addListener) mq.addListener(onThemeChange);
  }catch(_){/* ignore */}
  async function syncThemeModeFromStorage(){
    const themeDb = await getDB(['themeMode','theme_auto_mode','theme_dark_mode','popup_force_dark']);
    themeModeCurrent = resolveThemeMode(themeDb);
    applyPopupTheme(getEffectiveDark(themeModeCurrent));
    paintToggleRows();
  }
  try{
    chrome.storage.onChanged.addListener((changes, area)=>{
      if(area !== 'local') return;
      if(!changes.themeMode && !changes.theme_auto_mode && !changes.theme_dark_mode && !changes.popup_force_dark) return;
      syncThemeModeFromStorage();
    });
    chrome.runtime.onMessage.addListener((msg)=>{
      if(msg && msg.type === 'THEME_UPDATED'){
        syncThemeModeFromStorage();
      }
    });
  }catch(_){/* ignore */}

  async function runTranslate(){
    setError('');
    setOut('');
    const q = norm($('q').value);
    if(!q) return;
    $('btnTranslate').disabled = true;
    try{
      const res = await doTranslate(q);
      const t = res && res.text ? res.text : '';
      if(res && Array.isArray(res.translations) && res.translations.length >= 2){
        const lines = res.translations.slice(0,2).map((it, idx)=>{
          const label = it.provider ? `翻译 ${idx+1}（${it.provider}）` : `翻译 ${idx+1}`;
          return `${label}: ${it.text || ''}`;
        });
        setOut(lines.join('\n'));
      }else if(t){
        setOut(t);
      }
      else setOut('（无结果）');
    }catch(e){
      setError(String(e && e.message ? e.message : e));
    }finally{
      $('btnTranslate').disabled = false;
    }
  }

  async function runAdd(){
    setError('');
    const q = norm($('q').value);
    if(!q) return;
    $('btnAdd').disabled = true;
    try{
      const res = await doTranslate(q);
      const t = res && res.text ? res.text : '';
      const r = await addWordOrSentence(q, t);
      if(r && r.ok){
        setOut(isLikelyWord(q) ? '已添加到单词本 ✅' : '已收藏句子 ✅');
      }else{
        setError((r && r.error) ? String(r.error) : '添加失败');
      }
    }catch(e){
      setError(String(e && e.message ? e.message : e));
    }finally{
      $('btnAdd').disabled = false;
    }
  }

  $('btnTranslate').addEventListener('click', runTranslate);
  $('btnAdd').addEventListener('click', runAdd);
  $('q').addEventListener('keydown', (e)=>{
    if(e.key === 'Enter'){
      e.preventDefault();
      runTranslate();
    }
  });
})();
