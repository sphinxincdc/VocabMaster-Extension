'use strict';

function $(id){ return document.getElementById(id); }

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
function applyTestTheme(dark){
  document.documentElement.classList.toggle('vb-dark', dark);
  document.body.classList.toggle('vb-force-dark', dark);
}
async function syncTestTheme(){
  try{
    const db = await chrome.storage.local.get(['themeMode','theme_auto_mode','theme_dark_mode','popup_force_dark']);
    const themeMode = resolveThemeMode(db);
    applyTestTheme(getEffectiveDark(themeMode));
  }catch(_){}
}
function bindThemeSync(){
  try{
    chrome.storage.onChanged.addListener((changes, area)=>{
      if(area !== 'local') return;
      if(!changes.themeMode && !changes.theme_auto_mode && !changes.theme_dark_mode && !changes.popup_force_dark) return;
      void syncTestTheme();
    });
    chrome.runtime.onMessage.addListener((msg)=>{
      if(msg && msg.type === 'THEME_UPDATED'){
        void syncTestTheme();
      }
    });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemTheme = ()=> void syncTestTheme();
    if(mq.addEventListener) mq.addEventListener('change', onSystemTheme);
    else if(mq.addListener) mq.addListener(onSystemTheme);
  }catch(_){}
}

function send(type, payload){
  return new Promise((resolve)=> chrome.runtime.sendMessage({type, payload}, resolve));
}

function normalizeWord(w){ return String(w||'').toLowerCase().trim(); }
function escapeHtml(str){
  return (str ?? '').toString()
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function getStatus(word, db){
  if((db.greenList||[]).includes(word)) return 'green';
  if((db.yellowList||[]).includes(word)) return 'yellow';
  return 'red';
}

function nextIntervalMs(reviewCount){
  const mins = 60*1000, hrs = 60*mins, days = 24*hrs;
  const table = [5*mins, 30*mins, 12*hrs, 1*days, 2*days, 4*days, 7*days, 15*days];
  const i = Math.max(0, Math.min(table.length-1, (reviewCount||0)));
  return table[i];
}

function getNextReviewAt(meta){
  const next = Number(meta?.nextReviewAt)||0;
  if(next) return next;
  const last = Number(meta?.lastReviewAt)||0;
  const c = Number(meta?.reviewCount)||0;
  if(!last) return 0;
  return last + nextIntervalMs(c);
}

function getQueueParams(){
  const sp = new URLSearchParams(location.search || '');
  const mode = sp.get('mode') || '';
  // mode presets from manager cards
  if(mode === 'due_week') return { queue:'due', range:'week', status:'', notes:false };
  if(mode === 'difficult') return { queue:'difficult', range:'', status:'', notes:false };
  if(mode === 'status_red') return { queue:'due', range:'', status:'red', notes:false };
  if(mode === 'status_yellow') return { queue:'due', range:'', status:'yellow', notes:false };
  if(mode === 'status_green') return { queue:'all', range:'', status:'green', notes:false };
  if(mode === 'notes') return { queue:'all', range:'', status:'', notes:true };

  return {
    queue: sp.get('queue') || '',
    range: sp.get('range') || '',
    status: sp.get('status') || '',
    notes: sp.get('notes') === '1'
  };
}

function getReviewConfig(db){
  const cfg = db?.config?.reviewConfig || {};
  const displayRaw = cfg.display || null;
  const displayMode = cfg.displayMode || '';
  const display = displayRaw && typeof displayRaw === 'object'
    ? {
        cn: displayRaw.cn !== false,
        en: displayRaw.en === true,
        note: displayRaw.note === true
      }
    : (displayMode
        ? {
            cn: displayMode === 'cn',
            en: displayMode === 'en',
            note: displayMode === 'note'
          }
        : {cn:true, en:true, note:true});
  return {
    limit: Number(cfg.limit)||20,
    includeRed: cfg.includeRed !== false,
    includeYellow: cfg.includeYellow !== false,
    display
  };
}

function buildQueue(db, options){
  const now = Date.now();
  const cfg = getReviewConfig(db);
  const qp = getQueueParams();
  const opts = options || {};
  const limit = Number(opts.limit ?? cfg.limit) || 20;

  const words = Array.isArray(db.vocabList) && db.vocabList.length ? db.vocabList : Object.keys(db.vocabDict||{});
  const out = [];
  const set = new Set();

  // time windows
  const start = new Date(); start.setHours(0,0,0,0);
  const endOfToday = start.getTime() + 24*60*60*1000 - 1;
  const endOfWeek = start.getTime() + 7*24*60*60*1000 - 1;

  if(qp.queue === 'difficult'){
    const list = Array.isArray(db.difficultList) ? db.difficultList : [];
    for(const w0 of list){
      const w = normalizeWord(w0);
      if(!w || set.has(w)) continue;
      const st = getStatus(w, db);
      if(st === 'green') continue;
      set.add(w);
      out.push(w);
      if(!opts.noSlice && out.length >= limit) break;
    }
    return opts.noSlice ? out : out.slice(0, limit);
  }

  for(const w0 of words){
    const w = normalizeWord(w0);
    if(!w || set.has(w)) continue;
    set.add(w);

    const st = getStatus(w, db);
    // status filter from URL
    if(qp.status){
      if(st !== qp.status) continue;
    }else{
      // default behavior: don't review mastered words
      if(st === 'green') continue;
    }
    if(st === 'red' && !cfg.includeRed) continue;
    if(st === 'yellow' && !cfg.includeYellow) continue;
    if(qp.notes){
      const note = (db.vocabNotes||{})[w] || '';
      if(!String(note).trim()) continue;
    }

    const meta = (db.vocabMeta||{})[w] || {};
    const next = getNextReviewAt(meta);
    const isNew = (Number(meta.reviewCount)||0) === 0;
    const isDue = isNew || next === 0 || next <= now;
    if(qp.queue !== 'all'){
      if(!isDue) continue;
    }

    if(qp.queue === 'due' && qp.range){
      if(qp.range === 'today'){
        const dueToday = isNew || next === 0 || next <= endOfToday;
        if(!dueToday) continue;
      }else if(qp.range === 'week'){
        const dueWeek = isNew || next === 0 || next <= endOfWeek;
        if(!dueWeek) continue;
      }
    }

    out.push(w);
  }

  out.sort(()=>Math.random()-0.5);
  return opts.noSlice ? out : out.slice(0, limit);
}

let dbCache = null;
let queue = [];
let idx = 0;
let revealed = false;
let sessionStats = {total:0, sum:0, c0:0, c3:0, c5:0};
let reviewPrefs = {display:{cn:true, en:true, note:true}};
let reviewEntitlements = {review_mode: 'basic'};
const ADAPT_RULES = {
  highStreakToEarlyFinish: 6,
  minAnsweredForEarlyFinish: 8,
  lowScoreToExpand: 4,
  expandBatch: 4,
  expandCap: 10
};
let sessionFlow = null;

function applyReviewPolicy(){
  const advanced = String(reviewEntitlements?.review_mode || 'basic') === 'advanced';
  const lockNode = (id, locked, title)=>{
    const node = $(id);
    if(!node) return;
    node.disabled = !!locked;
    node.title = locked ? (title || '专业版功能') : '';
  };
  lockNode('cfg-limit', !advanced, '免费版固定 20 题');
  if(!advanced){
    if($('cfg-limit')) $('cfg-limit').value = '20';
  }
}

function resetSessionStats(){
  sessionStats = {total:0, sum:0, c0:0, c3:0, c5:0};
  sessionFlow = {
    startedAt: Date.now(),
    target: 0,
    highStreak: 0,
    lowAccumulator: 0,
    bonusAdded: 0,
    retryWords: [],
    retryAdded: false,
    seenCount: {},
    perWord: {},
    supplementPool: [],
    endedBy: '',
    feedbackTimer: null
  };
}

function fmtDuration(ms){
  const sec = Math.max(1, Math.round(ms/1000));
  if(sec < 60) return `${sec} 秒`;
  const min = Math.round(sec/60);
  if(min < 60) return `${min} 分钟`;
  const hr = Math.floor(min/60);
  const rem = min % 60;
  return rem ? `${hr} 小时 ${rem} 分` : `${hr} 小时`;
}

function fmtTime(ts){
  const d = new Date(Number(ts)||0);
  if(!Number.isFinite(d.getTime()) || !ts) return '—';
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  return `${hh}:${mm}`;
}

function predictNextDurationText(nextMode){
  const base = nextMode === '冲刺模式' ? 14 : nextMode === '回顾模式' ? 24 : 18;
  const size = Math.max(sessionFlow?.target || 20, sessionStats.total || 20);
  const mins = Math.max(8, Math.round(size * (base/20)));
  return `${mins}~${mins + 4} 分钟`;
}

function getSuggestedMode(){
  if(!sessionStats.total) return '巩固模式';
  const badRate = (sessionStats.c0 + sessionStats.c3) / Math.max(1, sessionStats.total);
  if(sessionStats.c0 >= 4 || badRate >= 0.42) return '冲刺模式';
  if(sessionStats.c5 >= Math.max(6, Math.floor(sessionStats.total * 0.65))) return '回顾模式';
  return '巩固模式';
}

function appendRetryQueueIfNeeded(){
  if(!sessionFlow || sessionFlow.retryAdded || !sessionFlow.retryWords.length) return false;
  sessionFlow.retryAdded = true;
  return true;
}

function buildSupplementPool(db, seedQueue){
  const full = buildQueue(db, {noSlice:true});
  const used = new Set(seedQueue || []);
  return full.filter(w => !used.has(w));
}

function updateFinishStats(){
  const scoreEl = $('test-score');
  const summaryEl = $('test-summary');
  const encourageEl = $('test-encourage');
  const reportModeEl = $('test-report-mode');
  const reportWeakEl = $('test-report-weak');
  const reportNextEl = $('test-report-next');
  const reportTimeEl = $('test-report-time');
  const total = sessionStats.total || 0;
  const score = total ? Math.round((sessionStats.sum / (total * 5)) * 100) : 0;

  if(scoreEl) scoreEl.textContent = `${score} 分`;
  if(summaryEl) summaryEl.textContent = `秒杀 ${sessionStats.c5} · 模糊 ${sessionStats.c3} · 忘了 ${sessionStats.c0}`;

  let msg = '继续加油！';
  if(score >= 90) msg = '太棒了！保持这个势头！';
  else if(score >= 75) msg = '很不错！再刷一轮更稳！';
  else if(score >= 60) msg = '进步明显！再巩固一下！';
  else if(total === 0) msg = '开始复习吧，下一次会更好！';
  if(encourageEl) encourageEl.textContent = msg;

  const reasonMap = {
    stable: '稳定度阈值达标，提前结束',
    target: '达到目标题量，正常结束'
  };
  if(reportModeEl){
    reportModeEl.textContent = `结束策略：${reasonMap[sessionFlow?.endedBy] || '达到目标，正常结束'}`;
  }

  const rows = Object.entries(sessionFlow?.perWord || {}).map(([w,v])=>({
    word: w,
    attempts: Number(v.attempts||0),
    avg: Number(v.sum||0) / Math.max(1, Number(v.attempts||0)),
    low: Number(v.min||0)
  }));
  rows.sort((a,b)=> a.avg - b.avg || a.low - b.low || b.attempts - a.attempts);
  const weakTop = rows.slice(0,5);
  if(reportWeakEl){
    reportWeakEl.textContent = weakTop.length
      ? `本轮最弱 Top5：${weakTop.map((r,i)=>`${i+1}.${r.word}(${r.avg.toFixed(1)})`).join('  ·  ')}`
      : '本轮最弱 Top5：—';
  }

  const nextMode = getSuggestedMode();
  const weakTips = weakTop.length ? `，优先重刷 ${weakTop.slice(0,2).map(x=>x.word).join('、')}` : '';
  if(reportNextEl) reportNextEl.textContent = `建议下轮模式：${nextMode}${weakTips}`;
  if(reportTimeEl){
    const elapsed = Date.now() - (sessionFlow?.startedAt || Date.now());
    reportTimeEl.textContent = `预计下轮用时：${predictNextDurationText(nextMode)}（本轮用时 ${fmtDuration(elapsed)}）`;
  }
}

function setCardFlipped(on){
  const card = $('test-card-inner');
  if(!card) return;
  card.style.transform = on ? 'rotateY(180deg)' : 'rotateY(0deg)';
}

function updateTopBar(){
  const total = queue.length || 0;
  const cur = Math.min(idx+1, total);
  const idxEl = $('test-idx');
  if(idxEl) idxEl.textContent = total ? `${cur} / ${total}` : `0 / 0`;
  const fill = $('test-progress-fill');
  if(fill) fill.style.width = total ? `${Math.round(cur/total*100)}%` : '0%';
}

function setConfigCollapsed(collapsed){
  const fields = $('test-config-fields');
  const summary = $('test-config-summary');
  if(fields) fields.style.display = collapsed ? 'none' : 'flex';
  if(summary) summary.style.display = collapsed ? 'flex' : 'none';
}

function getEntryModeLabel(){
  const sp = new URLSearchParams(location.search || '');
  const mode = sp.get('mode') || '';
  const map = {
    due_week: '英语仓库',
    difficult: '易错词',
    status_red: '陌生词',
    status_yellow: '学习中',
    status_green: '已掌握',
    notes: '有批注'
  };
  if(map[mode]) return map[mode];

  const qp = getQueueParams();
  if(qp.queue === 'due' && qp.range === 'today') return '今日到期';
  if(qp.queue === 'due' && qp.range === 'week') return '英语仓库';
  if(qp.queue === 'difficult') return '易错词';
  if(qp.status === 'red') return '陌生词';
  if(qp.status === 'yellow') return '学习中';
  if(qp.status === 'green') return '已掌握';
  if(qp.notes) return '有批注';
  return '默认复习';
}

function setHotkeysHintVisible(visible){
  const hint = $('test-hotkeys-inline');
  if(hint) hint.style.display = visible ? 'inline' : 'none';
}

function getIdleStatusText(){
  return revealed ? '待评分：请选择 1 / 2 / 3' : '待翻面：点击卡片或按 Space 查看答案';
}

function setStatusText(text){
  const txt = $('test-status-text');
  if(txt) txt.textContent = text || getIdleStatusText();
}

function updateToolbarState(){
  const bar = $('test-status-bar');
  if(bar){
    bar.classList.toggle('is-pending-flip', !revealed);
  }
  setStatusText(getIdleStatusText());
  const hint = $('test-hotkeys-inline');
  if(hint){
    hint.textContent = revealed
      ? '1 忘了 · 2 模糊 · 3 秒杀'
      : 'Space 翻面 · 1 忘了 · 2 模糊 · 3 秒杀';
  }
}

function setControlsEnabled(enabled){
  const controls = $('test-srs-controls');
  if(!controls) return;
  controls.classList.toggle('is-disabled', !enabled);
  controls.querySelectorAll('.test-rate-btn').forEach((btn)=>{
    btn.disabled = !enabled;
  });
}

function showRateFeedback(msg){
  if(!$('test-status-text')) return;
  setStatusText(msg || '已记录评分');
  if(sessionFlow?.feedbackTimer){
    clearTimeout(sessionFlow.feedbackTimer);
  }
  sessionFlow.feedbackTimer = setTimeout(()=>{
    updateToolbarState();
  }, 1600);
}

function flashRateButton(quality){
  const node = document.querySelector(`.test-rate-btn[data-q="${Number(quality)}"]`);
  if(!node) return;
  node.classList.add('is-last');
  setTimeout(()=> node.classList.remove('is-last'), 600);
}

function updateConfigSummary(){
  const txt = $('cfg-summary-text');
  if(!txt) return;
  const limit = Number($('cfg-limit')?.value || 20) || 20;
  const targets = [];
  if($('cfg-red')?.checked) targets.push('陌生');
  if($('cfg-yellow')?.checked) targets.push('学习中');
  if(!targets.length) targets.push('无');
  const display = [];
  if($('cfg-display-cn')?.checked) display.push('中释');
  if($('cfg-display-en')?.checked) display.push('英释');
  if($('cfg-display-note')?.checked) display.push('批注');
  if(!display.length) display.push('中释');
  txt.textContent = `已应用：${limit} 词 · 对象 ${targets.join('+')} · 显示 ${display.join('+')} · 入口 ${getEntryModeLabel()}`;
}

function showEmptyOverlay(db){
  const empty = $('test-empty-overlay');
  const finish = $('test-finish-overlay');
  const controls = $('test-srs-controls');
  const card = $('test-card-inner');
  const title = $('test-empty-title');
  const desc = $('test-empty-desc');
  const totalWords = Array.isArray(db?.vocabList) && db.vocabList.length
    ? db.vocabList.length
    : Object.keys(db?.vocabDict || {}).length;

  if(controls) controls.style.display = 'none';
  if(card) card.style.pointerEvents = 'none';
  if(finish) finish.style.display = 'none';
  if(empty) empty.style.display = 'flex';

  if(totalWords > 0){
    if(title) title.textContent = '当前筛选没有可复习单词';
    if(desc) desc.textContent = '可点击“恢复默认并重试”，或返回单词本调整状态。';
  }else{
    if(title) title.textContent = '你的单词本还是空的';
    if(desc) desc.textContent = '先去收集一些单词，再开始艾宾浩斯复习。';
  }
}

function render(){
  const finish = $('test-finish-overlay');
  const empty = $('test-empty-overlay');
  const card = $('test-card-inner');
  const controls = $('test-srs-controls');
  const statusBar = $('test-status-bar');

  if(!queue.length){
    setHotkeysHintVisible(false);
    if(statusBar) statusBar.style.display = 'none';
    if(controls) controls.style.display = 'none';
    showEmptyOverlay(dbCache);
    updateTopBar();
    return;
  }

  if(idx >= queue.length){
    appendRetryQueueIfNeeded();
    setHotkeysHintVisible(false);
    if(statusBar) statusBar.style.display = 'none';
    if(controls) controls.style.display = 'none';
    if(card) card.style.pointerEvents = 'none';
    if(empty) empty.style.display = 'none';
    if(finish) finish.style.display = 'flex';
    if(!sessionFlow?.endedBy) sessionFlow.endedBy = 'target';
    updateFinishStats();
    updateTopBar();
    return;
  }

  if(empty) empty.style.display = 'none';
  if(finish) finish.style.display = 'none';
  if(card) card.style.pointerEvents = 'auto';
  if(statusBar) statusBar.style.display = 'block';
  if(controls) controls.style.display = 'flex';
  updateToolbarState();
  setHotkeysHintVisible(true);
  setControlsEnabled(revealed);

  const w = queue[idx];
  const meaning = (dbCache.vocabDict||{})[w] || '';
  const enRaw = (dbCache.vocabEn||{})[w] || [];
  const enList = Array.isArray(enRaw) ? enRaw : String(enRaw||'').split(/\s*\|\s*|\s*;\s*|\s*\n\s*/).filter(Boolean);
  const enMeaning = enList.join('；');
  const note = (dbCache.vocabNotes||{})[w] || '';
  const ph = (dbCache.vocabPhonetics||{})[w] || {};
  const meta = (dbCache.vocabMeta||{})[w] || {};
  const st = getStatus(w, dbCache);

  // front
  $('test-q-word').textContent = w;
  const cloze = $('test-cloze-container');
  if(cloze){
    cloze.textContent = st === 'red' ? '请回忆这个单词的释义 / 用法' : '请回忆释义，并尝试造句';
  }

  // back
  $('test-ans-word').textContent = w;
  const phEl = $('test-ans-ph');
  if(phEl){
    const us = ph.us || '';
    const uk = ph.uk || '';
    phEl.innerHTML = (us || uk)
      ? `<span class="flag flag-us" aria-hidden="true"></span> ${escapeHtml(us||'-')}&nbsp;&nbsp;<span class="flag flag-uk" aria-hidden="true"></span> ${escapeHtml(uk||'-')}`
      : '';
  }
  const defEl = $('test-ans-def');
  if(defEl){
    const parts = [];
    if(reviewPrefs.display.cn){
      parts.push(`<div style="margin-bottom:10px;"><div style="font-weight:700;color:#333;margin-bottom:6px;">中文释义</div><div>${escapeHtml(meaning || '（暂无释义，建议回到网页弹窗补全一次）')}</div></div>`);
    }
    if(reviewPrefs.display.en){
      parts.push(`<div style="margin-bottom:10px;"><div style="font-weight:700;color:#333;margin-bottom:6px;">英文释义</div><div>${escapeHtml(enMeaning || '（暂无英文释义，建议补全一次）')}</div></div>`);
    }
    defEl.innerHTML = parts.length ? parts.join('') : '';
  }
  const noteEl = $('test-ans-note');
  if(noteEl){
    if(reviewPrefs.display.note){
      noteEl.style.display = 'block';
      noteEl.textContent = `💜 批注：${note || '（暂无批注）'}`;
    }else{
      noteEl.style.display = 'none';
      noteEl.textContent = '';
    }
  }

  // controls hidden until reveal
  revealed = false;
  setCardFlipped(false);
  setControlsEnabled(false);
  updateToolbarState();
  setHotkeysHintVisible(true);

  // update progress
  updateTopBar();

  // subtle hint on mastery
  try{
    const m = Math.round(Number(meta.mastery)||0);
    document.title = `复习：${w}（掌握度 ${m}）`;
  }catch(_){}
}

async function applyConfigAndStart(){
  const limit = Number($('cfg-limit')?.value||20) || 20;
  const includeRed = !!$('cfg-red')?.checked;
  const includeYellow = !!$('cfg-yellow')?.checked;
  const display = {
    cn: !!$('cfg-display-cn')?.checked,
    en: !!$('cfg-display-en')?.checked,
    note: !!$('cfg-display-note')?.checked
  };
  if(!display.cn && !display.en && !display.note){
    display.cn = true;
  }

  await send('OP_SET_REVIEW_CONFIG', {limit, includeRed, includeYellow, display});
  reviewPrefs = {display};

  const res = await send('OP_GET_STATE');
  dbCache = res?.db || {};
  reviewEntitlements = res?.entitlements || dbCache?.auth?.entitlements || {review_mode:'basic'};
  applyReviewPolicy();
  reviewPrefs = {display: getReviewConfig(dbCache).display};
  queue = buildQueue(dbCache);
  idx = 0;
  resetSessionStats();
  sessionFlow.target = queue.length;
  sessionFlow.supplementPool = buildSupplementPool(dbCache, queue);
  updateConfigSummary();
  setConfigCollapsed(false);
  render();
}

function reveal(){
  if(revealed) return;
  revealed = true;
  setCardFlipped(true);
  updateToolbarState();
  setHotkeysHintVisible(true);
  setControlsEnabled(true);
}

async function rate(quality){
  if(!queue.length || idx >= queue.length) return;
  flashRateButton(quality);
  const w = queue[idx];
  const q = Number(quality||0);
  const seen = Number(sessionFlow?.seenCount?.[w] || 0);
  const prevMeta = (dbCache?.vocabMeta || {})[w] || {};
  const prevMastery = Number(prevMeta.mastery) || 0;
  const prevDiff = !!prevMeta.isDifficult;

  sessionStats.total += 1;
  sessionStats.sum += q;
  if(q >= 5) sessionStats.c5 += 1;
  else if(q >= 3) sessionStats.c3 += 1;
  else sessionStats.c0 += 1;

  sessionFlow.seenCount[w] = seen + 1;
  if(!sessionFlow.perWord[w]){
    sessionFlow.perWord[w] = {attempts:0, sum:0, min:5};
  }
  const s = sessionFlow.perWord[w];
  s.attempts += 1;
  s.sum += q;
  s.min = Math.min(s.min, q);

  if(q >= 5) sessionFlow.highStreak += 1;
  else sessionFlow.highStreak = 0;
  if(q <= 3) sessionFlow.lowAccumulator += 1;

  if(q <= 3 && seen === 0 && !sessionFlow.retryWords.includes(w)){
    sessionFlow.retryWords.push(w);
  }

  const res = await send('OP_RATE_WORD', {word:w, quality});
  // refresh cache quickly
  let nextTs = 0;
  let nextMeta = prevMeta;
  if(res?.ok && res.meta){
    dbCache.vocabMeta = dbCache.vocabMeta || {};
    dbCache.vocabMeta[w] = res.meta;
    nextMeta = res.meta;
    nextTs = Number(res.meta.nextReviewAt) || 0;
  }else{
    nextTs = Number(prevMeta.nextReviewAt) || 0;
  }

  const mastery = Number(nextMeta.mastery) || 0;
  const masteryDelta = mastery - prevMastery;
  const diffNow = !!nextMeta.isDifficult;
  const diffText = !prevDiff && diffNow ? ' · 已进入易错词' : prevDiff && !diffNow ? ' · 已移出易错词' : '';
  showRateFeedback(`下次复习 ${fmtTime(nextTs)} · 掌握度 ${mastery} (${masteryDelta >= 0 ? '+' : ''}${masteryDelta})${diffText || ' · 状态稳定'}`);

  if(sessionFlow.lowAccumulator >= ADAPT_RULES.lowScoreToExpand && sessionFlow.bonusAdded < ADAPT_RULES.expandCap){
    const canAdd = Math.min(
      ADAPT_RULES.expandBatch,
      ADAPT_RULES.expandCap - sessionFlow.bonusAdded
    );
    if(canAdd > 0){
      sessionFlow.bonusAdded += canAdd;
      showRateFeedback(`低分偏多，建议补充 ${canAdd} 个巩固词（本轮仅提示，不加题）`);
    }
    sessionFlow.lowAccumulator = 0;
  }

  const canEarlyFinish =
    sessionFlow.highStreak >= ADAPT_RULES.highStreakToEarlyFinish &&
    sessionStats.total >= ADAPT_RULES.minAnsweredForEarlyFinish &&
    sessionFlow.retryWords.length === 0;
  if(canEarlyFinish){
    sessionFlow.endedBy = 'stable';
    idx = queue.length;
    render();
    return;
  }

  idx += 1;
  render();
}

function wire(){
  const goManager = ()=>{
    const url = chrome.runtime.getURL('manager.html');
    if(chrome.tabs?.update){
      chrome.tabs.update({url});
    }else{
      location.href = url;
    }
  };
  const closeBtn = $('test-close');
  if(closeBtn) closeBtn.addEventListener('click', ()=> goManager());

  const backMgr = $('test-back-mgr');
  if(backMgr) backMgr.addEventListener('click', ()=> goManager());
  const emptyBack = $('test-empty-back');
  if(emptyBack) emptyBack.addEventListener('click', ()=> goManager());
  const emptyReset = $('test-empty-reset');
  if(emptyReset){
    emptyReset.addEventListener('click', async ()=>{
      if($('cfg-limit')) $('cfg-limit').value = '20';
      if($('cfg-red')) $('cfg-red').checked = true;
      if($('cfg-yellow')) $('cfg-yellow').checked = true;
      if($('cfg-display-cn')) $('cfg-display-cn').checked = true;
      if($('cfg-display-en')) $('cfg-display-en').checked = true;
      if($('cfg-display-note')) $('cfg-display-note').checked = true;
      updateConfigSummary();
      if(location.search){
        location.href = chrome.runtime.getURL('test.html');
        return;
      }
      await applyConfigAndStart();
    });
  }
  const cfgEdit = $('cfg-edit');
  if(cfgEdit){
    cfgEdit.addEventListener('click', ()=> setConfigCollapsed(false));
  }

  const applyBtn = $('cfg-apply');
  if(applyBtn){
    applyBtn.addEventListener('click', async ()=>{
      applyBtn.disabled = true;
      applyBtn.style.opacity = '0.75';
      try{ await applyConfigAndStart(); } finally{
        applyBtn.disabled = false;
        applyBtn.style.opacity = '1';
      }
    });
  }

  const card = $('test-card-inner');
  if(card){
    card.addEventListener('click', ()=> reveal());
  }

  // rate buttons
  document.querySelectorAll('.test-rate-btn').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const q = Number(btn.getAttribute('data-q')||0);
      if(!revealed){
        reveal();
        return;
      }
      rate(q);
    });
  });

  // keyboard
  window.addEventListener('keydown', (e)=>{
    if(e.code === 'Space'){
      e.preventDefault();
      if(!revealed) reveal();
    }
    if(e.key === '1' || e.key === '2' || e.key === '3'){
      if(!revealed){
        reveal();
        return;
      }
      if(e.key === '1') rate(0);
      if(e.key === '2') rate(3);
      if(e.key === '3') rate(5);
    }
  });
}

async function start(){
  bindThemeSync();
  await syncTestTheme();
  wire();
  const res = await send('OP_GET_STATE');
  dbCache = res?.db || {};
  reviewEntitlements = res?.entitlements || dbCache?.auth?.entitlements || {review_mode:'basic'};
  applyReviewPolicy();
  // init UI from config
  const cfg = getReviewConfig(dbCache);
  if($('cfg-limit')) $('cfg-limit').value = String(cfg.limit||20);
  if($('cfg-red')) $('cfg-red').checked = !!cfg.includeRed;
  if($('cfg-yellow')) $('cfg-yellow').checked = !!cfg.includeYellow;
  if($('cfg-display-cn')) $('cfg-display-cn').checked = cfg.display.cn !== false;
  if($('cfg-display-en')) $('cfg-display-en').checked = cfg.display.en === true;
  if($('cfg-display-note')) $('cfg-display-note').checked = cfg.display.note === true;
  reviewPrefs = {display: cfg.display};
  updateConfigSummary();
  setConfigCollapsed(true);

  queue = buildQueue(dbCache);
  idx = 0;
  resetSessionStats();
  sessionFlow.target = queue.length;
  sessionFlow.supplementPool = buildSupplementPool(dbCache, queue);
  render();
}

start();
