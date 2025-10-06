/* Feed Cycle 2.0.0 (Early SPA Scaffold)
  Overview
  --------
  This file is an initial implementation of the version 2 single‑page application redesign.
  It intentionally keeps the surface area small while establishing the new architectural
  primitives so further features can “relax” into separate panels instead of competing for
  simultaneous screen space.

  Core Concepts Implemented
  - Panel stack (lightweight) with back navigation + scroll restoration.
  - Data (feeds/subscriptions + settings) persisted; article items kept ephemeral (runtime only).
  - Basic feed refresh (direct fetch) supporting RSS & Atom (podcast enclosures TODO).
  - OPML import/export + sample feed injection.
  - Filter/Search panel (simple substring search currently) and infinite scroll batching.
  - Media player toolbar scaffold (play/pause/progress + accessible draggable cue knob).
  - Theme toggle (system / light / dark) using <html data-theme> attribute.
  - Accessibility foundations: ARIA roles, keyboard for back, slider, and cards.

  Deferred / Upcoming (to port / implement)
  - Proxy & cache strategy + adaptive proxy ordering from v1 (CORS resilience).
  - Rich search scoring (substring + regex + soundex + cosine) & token index.
  - Virtualized window rendering for large article sets (v1 virtualization logic).
  - Tags (future). Favourites + read-state now persisted (v2 scaffold increment).
  - Media (audio/video) extraction & binding to central player (podcast + enclosure support).
  - Advanced HTML sanitization / media safety utilities from v1.
  - Rate limit awareness & scheduled refresh throttle respecting last download times.
  - Scroll-into-position when filtering by subscription from an article view.
  - Settings panes: About / Privacy / Licence content population (placeholders not yet added).
  - Offline hydration using Cache API.
  - Internationalization hooks & improved date formatting strategy.

  Guiding Principles
  - Small, explicit DOM + no framework; data driven via templates.
  - Progressive enhancement: baseline works without advanced JS features.
  - Accessibility over cleverness; semantic roles and keyboard parity.
  - Local-first: keep user data (feeds & settings) in LocalStorage, large content ephemeral.

  File Structure (v2 initial)
  - feedcycle.html : Markup shells + <template> panels.
  - feedcycle.css  : Layout, themes, panel & media player styles.
  - feedcycle.js   : This scaffold (panels, state, fetching, minimal search, media player).
*/
(function(){
  'use strict';

  const VERSION = '2.0.0';
  const LS_KEY = 'feedcycle-v2';
  const DEFAULTS = { theme:'system', feeds:[], categories:[], lastFetch:{}, lastFetchUrl:{}, settings:{ refreshMinutes:30, cacheMaxAgeMinutes:60, corsProxy:'' }, read:{}, favorites:{}, tags:{}, autoTags:{}, proxyScores:{}, proxyScoresResetAt:0 }; // posts ephemeral + tags mapping postId -> [tag]
  // state will be loaded after proxy scoring utilities are defined
  let state; // defer assignment
  let posts = {}; // id -> post (ephemeral)
  let lastFilteredPosts = [];
  let lastRenderedCount = 0;
  let pendingListRefresh = false;
  const INITIAL_RENDER_COUNT = 120;
  const CHUNK_SIZE = 120;

  // ---------- Proxy & Caching (ported/minimal from v1) ----------
  const PROXIES = [
    { name: 'AllOrigins', kind: 'param-enc', base: 'https://api.allorigins.win/raw?url=' },
    { name: 'corsproxy.io', kind: 'param-enc', base: 'https://corsproxy.io/?' },
    { name: 'CodeTabs', kind: 'param-enc', base: 'https://api.codetabs.com/v1/proxy?quest=' },
    { name: 'JinaMirror', kind: 'prefix', base: 'https://r.jina.ai/' }
  ];
  const proxyStats = new Map(); // name -> {success, fail, lastSuccess, lastFail, score}
  const proxyTempDisabledUntil = new Map(); // name -> ts
  const PROXY_DISABLE_MS = 10*60*1000;
  const FETCH_TIMEOUT_MS = 12000;
  const CACHE_NAME = 'feedcycle-cache-v2';
  const RATE_LIMIT_BACKOFF_BASE_MS = 60*1000;
  const RATE_LIMIT_BACKOFF_MAX_MS = 30*60*1000;
  const feedRateLimit = new Map(); // feedId -> { attempt, until, delay }

  // Enhanced proxy scoring with decay and weighted penalties
  const PROXY_FAIL_WEIGHT = 3;
  const PROXY_SUCCESS_WEIGHT = 1;
  const PROXY_DECAY_MS = 30*60*1000; // 30 minutes
  const PROXY_MIN_SAMPLE = 2; // dampen volatility for very small sample sizes
  function recalcProxyScore(name){
    const now = Date.now();
    const s = proxyStats.get(name) || {success:0, fail:0, lastSuccess:0, lastFail:0, score:0};
    const decay = (t)=> t? Math.exp(- (now - t) / PROXY_DECAY_MS) : 1;
    const successW = s.success * decay(s.lastSuccess);
    const failW = s.fail * decay(s.lastFail);
    const raw = (successW * PROXY_SUCCESS_WEIGHT) - (failW * PROXY_FAIL_WEIGHT);
    const attempts = s.success + s.fail;
    const confidence = attempts < PROXY_MIN_SAMPLE ? 0.25 : 1;
    s.score = raw * confidence;
    proxyStats.set(name, s);
    return s.score;
  }
  function recordProxyResult(name, ok){
    if(!name) return;
    const s = proxyStats.get(name) || {success:0, fail:0, lastSuccess:0, lastFail:0, score:0};
    if(ok){ s.success += 1; s.lastSuccess = Date.now(); }
    else { s.fail += 1; s.lastFail = Date.now(); }
    proxyStats.set(name, s);
    recalcProxyScore(name);
  }
  function proxyScore(p){ const s = proxyStats.get(p.name); return s? s.score||0 : 0; }

  // Now that proxy machinery exists, load state (hydrating proxy stats) and maybe rebase
  state = loadState();
  function maybeRebaseProxyScores(){
    try{
      const NOW = Date.now();
      const ONE_MONTH_MS = 30*24*60*60*1000; // approximate month
      const last = state.proxyScoresResetAt || 0;
      if(NOW - last < ONE_MONTH_MS) return; // not yet time
      const names = PROXIES.map(p=>p.name);
      names.forEach(n=>{ if(!proxyStats.has(n)) proxyStats.set(n,{success:0,fail:0,lastSuccess:0,lastFail:0,score:0}); recalcProxyScore(n); });
      const ordered = names.map(n=>({name:n, s: proxyStats.get(n)||{}})).sort((a,b)=> (b.s.score||0) - (a.s.score||0));
      const m = ordered.length || 1;
      const now = Date.now();
      ordered.forEach((entry, idx)=>{
        const syntheticSuccess = (m - idx) + 1; // ensures descending, >=2 successes for top
        const stats = { success: syntheticSuccess, fail:0, lastSuccess: now, lastFail:0, score:0 };
        proxyStats.set(entry.name, stats);
        recalcProxyScore(entry.name);
      });
      state.proxyScoresResetAt = NOW;
      saveState();
      console.info('[FeedCycle v2] Proxy scores rebased (monthly normalization)');
    }catch(e){ console.warn('Proxy score rebase skipped', e); }
  }
  maybeRebaseProxyScores();
  function buildProxiedUrl(targetUrl, proxySpec){
    if(typeof proxySpec === 'string'){
      const p = proxySpec.trim();
      if(!p) return targetUrl;
      if(p.includes('%s')) return p.replace('%s', encodeURIComponent(targetUrl));
      if(/[=]$/.test(p) || /[?&]url=$/i.test(p)) return p + encodeURIComponent(targetUrl);
      return p + targetUrl;
    }
    const { kind, base, name } = proxySpec;
    if(kind==='param-enc'){
      let u = base + encodeURIComponent(targetUrl);
      if(name==='AllOrigins') u += `&cache=${Date.now()}`; // bust any stale caching quirks
      return u;
    }
    if(kind==='prefix'){
      let clean = targetUrl;
      if(!/^https?:/i.test(clean)){
        try{ clean = new URL(clean, location.href).href; }catch{}
      }
      return base + clean.replace(/^https?:\/\//i, (match)=> match.toLowerCase() );
    }
    return targetUrl;
  }
  function getProxyCandidates(){
    const arr = [];
    const manual = state.settings.corsProxy?.trim(); if(manual) arr.push(manual);
    const now = Date.now();
    const active = PROXIES.filter(p=> !(proxyTempDisabledUntil.get(p.name)>now));
    // Ensure each has an initialized score object (prevents NaN sorting jitter)
    for(const p of active){ if(!proxyStats.has(p.name)) proxyStats.set(p.name, {success:0,fail:0,lastSuccess:0,lastFail:0,score:0}); }
    // Order by score (descending)
    active.sort((a,b)=> proxyScore(b)-proxyScore(a));
    return arr.concat(active);
  }
  async function fetchWithCache(url){
    const maxAge = clamp((state.settings.cacheMaxAgeMinutes||60)*60*1000, 5*60*1000, 24*60*60*1000);
    try{
      if(typeof caches !== 'undefined'){
        const cache = await caches.open(CACHE_NAME);
        const req = new Request(url);
        const hit = await cache.match(req);
        if(hit){
          const date = new Date(hit.headers.get('date')||0).getTime();
          if(Date.now()-date < maxAge){ return hit.text(); }
        }
        const controller = new AbortController();
        const to = setTimeout(()=> controller.abort(), FETCH_TIMEOUT_MS);
        let res;
        try{ res = await fetch(req, { signal: controller.signal }); }
        finally{ clearTimeout(to); }
        const text = await res.text();
        if(res.ok){
          const stored = new Response(text, { headers:{ 'content-type': res.headers.get('content-type')||'text/xml; charset=utf-8', 'date': new Date().toUTCString() }});
          try{ await cache.put(req, stored); }catch{}
          return text;
        }
        if(hit) return hit.text();
        throw new Error('HTTP '+res.status);
      }
    }catch(e){ /* fall through to no-cache fetch below */ }
    const controller = new AbortController();
    const to = setTimeout(()=> controller.abort(), FETCH_TIMEOUT_MS);
    let res; try{ res = await fetch(url, { signal: controller.signal }); } finally { clearTimeout(to); }
    if(!res.ok) throw new Error('HTTP '+res.status);
    return res.text();
  }
  function xmlHasParserError(xml){
    try{ const doc = new DOMParser().parseFromString(xml,'text/xml'); return !!doc.querySelector('parsererror'); }catch{ return true; }
  }
  function maybeExtractXmlFromJson(text){
    try{ const o = JSON.parse(text); if(o && typeof o.contents==='string') return o.contents; }catch{}
    return null;
  }
  function addCacheBuster(u){ try{ return u + (u.includes('?')?'&':'?') + 't=' + Date.now(); }catch{ return u; } }

  function getFeedRateLimit(feedId){
    if(!feedId) return null;
    const entry = feedRateLimit.get(feedId);
    if(!entry) return null;
    if(entry.until <= Date.now()){
      feedRateLimit.delete(feedId);
      return null;
    }
    return { ...entry, retryIn: Math.max(0, entry.until - Date.now()) };
  }
  function applyFeedRateLimit(feedId){
    if(!feedId) return null;
    const now = Date.now();
    const existing = feedRateLimit.get(feedId);
    let attempt = existing? existing.attempt : 0;
    if(existing && existing.until <= now){ attempt = 0; }
    attempt += 1;
    const delay = Math.min(RATE_LIMIT_BACKOFF_BASE_MS * (2 ** (attempt - 1)), RATE_LIMIT_BACKOFF_MAX_MS);
    const entry = { attempt, until: now + delay, delay };
    feedRateLimit.set(feedId, entry);
    return { ...entry, retryIn: delay };
  }
  function clearFeedRateLimit(feedId){ if(feedId) feedRateLimit.delete(feedId); }

  // ---------- Utilities ----------
  const $ = sel=> document.querySelector(sel);
  const byId = id=> document.getElementById(id);
  const el = (tag, props={}, ...kids)=>{ const n=document.createElement(tag); for(const [k,v] of Object.entries(props)){ if(k==='class') n.className=v; else if(k==='html') n.innerHTML=v; else if(k.startsWith('on')&&typeof v==='function') n.addEventListener(k.substring(2),v); else if(v===true) n.setAttribute(k,''); else if(v!==false && v!=null) n.setAttribute(k,v);} for(const k of kids){ if(k==null) continue; if(Array.isArray(k)) n.append(...k); else if(k.nodeType) n.append(k); else n.append(String(k)); } return n; };
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svgIcon(useHref){
    const svg = document.createElementNS(SVG_NS,'svg');
    svg.setAttribute('class','icon');
    svg.setAttribute('aria-hidden','true');
    const use = document.createElementNS(SVG_NS,'use');
    use.setAttribute('href', useHref);
    svg.appendChild(use);
    return svg;
  }
  const hashId = s=>{ let h=2166136261>>>0; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return (h>>>0).toString(36); };
  const clamp = (n,a,b)=> Math.max(a, Math.min(b,n));

  function saveState(){
    try{
      // Serialize proxyStats lightweight: only keep scalar fields
      if(proxyStats && typeof proxyStats.forEach==='function'){
        const out = {};
        proxyStats.forEach((v,k)=>{ out[k] = { success:v.success||0, fail:v.fail||0, lastSuccess:v.lastSuccess||0, lastFail:v.lastFail||0, score:v.score||0 }; });
        state.proxyScores = out;
      }
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    }catch(e){ console.warn('Save failed', e);} }
  function loadState(){
    try{
      const raw = JSON.parse(localStorage.getItem(LS_KEY)||'{}');
      const merged = Object.assign({}, DEFAULTS, raw);
      // hydrate proxyStats
      if(merged.proxyScores){
        Object.entries(merged.proxyScores).forEach(([name, s])=>{
          if(!s || typeof s !== 'object') return;
          proxyStats.set(name, { success:s.success||0, fail:s.fail||0, lastSuccess:s.lastSuccess||0, lastFail:s.lastFail||0, score:s.score||0 });
        });
      }
      return merged;
    }catch{ return {...DEFAULTS}; }
  }
  function applyTheme(){
    document.documentElement.setAttribute('data-theme', state.theme||'system');
    const btn = byId('btn-theme');
    if(btn){
      const use = btn.querySelector('#themeIconUse');
      const map = { dark:'#i-moon', light:'#i-sun', system:'#i-auto' };
      if(use) use.setAttribute('href', map[state.theme] || '#i-auto');
      btn.title = `Theme: ${state.theme}`;
      btn.setAttribute('aria-label', `Theme ${state.theme} (toggle)`);
    }
  }

  // ---------- Panel Stack ----------
  const stackEl = byId('panel-stack');
  const backStack = []; // {id, scroll, keep, el}
  let suspendListRenders = false; // prevent list rerenders while viewing an article
  function showPanel(id, opts={}){
    const top = stackEl.lastElementChild;
    const topId = top?.dataset.panel;
    if(topId==='videoViewer' && id!=='videoViewer'){
      cleanupActiveVideo();
    }
    if(id==='articleViewer' && top){
      const scrollEl = top.querySelector('.panel-body');
      backStack.push({ id: topId, scroll: scrollEl? scrollEl.scrollTop:0, keep:true, el: top });
      // Keep list panel in DOM without layout shift
      top.style.visibility='hidden';
      top.setAttribute('aria-hidden','true');
      suspendListRenders = (topId==='articlesInfiniteScrollable');
      renderPanel(id, opts.data); focusPanel(id);
      // Reset newly shown panel scroll
      const nb = stackEl.lastElementChild?.querySelector('.panel-body'); if(nb) nb.scrollTop = 0;
      if(nb) nb.focus?.();
    } else if(id==='videoViewer' && topId==='articleViewer'){
      const scrollEl = top.querySelector('.panel-body');
      backStack.push({ id: topId, scroll: scrollEl? scrollEl.scrollTop:0, keep:true, el: top });
      top.style.visibility='hidden';
      top.setAttribute('aria-hidden','true');
      renderPanel(id, opts.data); focusPanel(id);
      const nb = stackEl.lastElementChild?.querySelector('.panel-body'); if(nb) nb.scrollTop = 0;
      if(nb) nb.focus?.();
    }else{
      if(top){
        const scrollEl = top.querySelector('.panel-body');
        backStack.push({ id: topId, scroll: scrollEl? scrollEl.scrollTop:0 });
        while(stackEl.firstChild){ stackEl.removeChild(stackEl.firstChild); }
      }
      renderPanel(id, opts.data); focusPanel(id);
      const nb = stackEl.lastElementChild?.querySelector('.panel-body'); if(nb) nb.scrollTop = 0;
      if(nb) nb.focus?.();
    }
    try{ const st = { panel:id, ts:Date.now() }; history.pushState(st, '', '#'+id); }catch{}
  }
  function back(){
    if(!backStack.length) return;
    const top = stackEl.lastElementChild;
    if(top?.dataset.panel==='videoViewer'){
      cleanupActiveVideo();
    }
    const prev = backStack.pop();
    if(prev.keep && prev.el){
      if(top && top!==prev.el) top.remove();
      prev.el.style.visibility='';
      prev.el.removeAttribute('aria-hidden');
      let body = prev.el.querySelector('.panel-body');
      const restoreScroll = ()=>{ if(body) body.scrollTop = prev.scroll||0; };
      if(prev.id==='articlesInfiniteScrollable'){
        suspendListRenders=false;
        if(pendingListRefresh){
          pendingListRefresh=false;
          const desiredScroll = prev.scroll||0;
          renderArticles();
          body = prev.el.querySelector('.panel-body');
          if(body) body.scrollTop = desiredScroll;
        } else {
          restoreScroll();
        }
      } else {
        restoreScroll();
      }
      focusPanel(prev.id);
    } else {
      while(stackEl.firstChild){ stackEl.removeChild(stackEl.firstChild); }
      renderPanel(prev.id);
      const body = stackEl.lastElementChild?.querySelector('.panel-body'); if(body) body.scrollTop = prev.scroll||0;
      focusPanel(prev.id);
    }
  }
  function focusPanel(id){ const p = stackEl.querySelector(`[data-panel="${id}"]`); if(p){ const h = p.querySelector('.panel-bar h2, .panel-bar button.back-btn') || p; h.focus?.(); } }

  function renderPanel(id, data){
    const tpl = byId('tpl-'+ camelToKebab(id));
    if(!tpl){ stackEl.append(el('div',{class:'panel empty','data-panel':id},`Unknown panel: ${id}`)); return; }
    const frag = tpl.content.cloneNode(true);
    const root = frag.querySelector('[data-panel]');
    // Ensure a .panel-body exists for isolated scrolling
    if(root && !root.querySelector('.panel-body')){
      const body = el('div',{class:'panel-body'});
      // Move all non panel-bar children into body
      [...root.childNodes].forEach(n=>{
        if(n.nodeType===1 && n.classList.contains('panel-bar')) return; // keep bar outside
        if(n===body) return;
        body.append(n);
      });
      root.append(body);
    }
    stackEl.append(root);
    wirePanel(root, id, data);
  }
  function camelToKebab(s){ return s.replace(/[A-Z]/g,m=> '-'+m.toLowerCase()).replace(/^-/, ''); }

  function wirePanel(root, id, data){
  root.querySelectorAll('[data-action="back"]').forEach(btn=> btn.addEventListener('click', (e)=>{ e.preventDefault(); if(backStack.length){ history.back(); } else { back(); } }));
    if(id==='settingsMain'){
      root.querySelectorAll('[data-nav]').forEach(b=> b.addEventListener('click', ()=> showPanel(b.dataset.nav)));
    }
    if(id==='settingsSubscriptions'){
      renderSubscriptionsList();
      root.querySelector('[data-action="add-sub"]').addEventListener('click', ()=>{
        const url = prompt('Feed URL (RSS/Atom):'); if(!url) return;
        const f = { id: hashId(url), url, title: url, category:'' };
        if(!state.feeds.find(x=>x.id===f.id)) state.feeds.push(f);
        saveState(); renderSubscriptionsList();
      });
    }
    if(id==='subscriptionEdit' && data){
      renderSubscriptionEdit(data);
    }
    if(id==='settingsData'){
      root.querySelector('[button][data-action]');
      root.querySelectorAll('[data-action]').forEach(btn=>{
        btn.addEventListener('click', ()=> handleDataAction(btn.dataset.action));
      });
    }
    if(id==='settingsPreferences'){
      const form = root.querySelector('#prefsForm');
      const themeInputs = form.querySelectorAll('input[name="theme"]');
      themeInputs.forEach(r=>{ r.checked = (state.theme||'system')===r.value; });
      const refreshInput = form.querySelector('#globalRefreshInput');
      const cacheInput = form.querySelector('#cacheMaxAgeInput');
      const proxyInput = form.querySelector('#corsProxyInput');
      refreshInput.value = state.settings.refreshMinutes || 30;
      if(cacheInput) cacheInput.value = state.settings.cacheMaxAgeMinutes || 60;
      if(proxyInput) proxyInput.value = state.settings.corsProxy || '';
      form.addEventListener('submit', e=>{
        e.preventDefault();
        const selTheme = [...themeInputs].find(r=>r.checked)?.value||'system';
        state.theme = selTheme; applyTheme();
        const v = parseInt(refreshInput.value,10); if(!isNaN(v) && v>=5) state.settings.refreshMinutes = v;
        if(cacheInput){ const c = parseInt(cacheInput.value,10); if(!isNaN(c) && c>=5) state.settings.cacheMaxAgeMinutes = c; }
        if(proxyInput){ state.settings.corsProxy = proxyInput.value.trim(); }
        saveState();
        const status = form.querySelector('#prefsStatus'); if(status) status.textContent='Saved';
        setTimeout(()=> back(), 300);
      }, { once:true });
      form.querySelector('[data-action="back"]').addEventListener('click', back, { once:true });
    }
    if(id==='filterAndSortSettings'){
      const form = root.querySelector('#filterForm');
      populateFilters(form);
      form?.addEventListener('submit', e=>{
        e.preventDefault();
        applyFilterForm(form);
        renderArticles();
        if(backStack.length){ history.back(); } else back();
      });
      form?.querySelector('[data-action="reset"]')?.addEventListener('click', ()=>{
        Object.assign(currentFilters, { ...FILTER_DEFAULTS, tagList: [] });
        populateFilters(form);
        renderArticles();
      });
      form?.querySelector('[data-action="cancel"]')?.addEventListener('click', ()=>{
        populateFilters(form); // revert any unsaved edits
        if(backStack.length){ history.back(); } else back();
      });
    }
    if(id==='articlesInfiniteScrollable'){
      renderArticles();
      root.querySelector('[data-action="quick-refresh"]').onclick = ()=> refreshAll(true);
      root.querySelector('[data-action="open-filter"]').onclick = ()=> showPanel('filterAndSortSettings');
      setupInfiniteScroll(root);
    }
    if(id==='articleViewer' && data){ renderArticleViewer(data); }
    if(id==='videoViewer' && data){ renderVideoViewer(data); }
  }

  // ---------- Filters ----------
  const SORT_DEFAULT = 'published-desc';
  const SORT_OPTIONS = new Set(['published-desc','published-asc','title-asc','title-desc','feed-asc','feed-desc','host-asc','host-desc','favorite','unread']);
  const MEDIA_AUTO_TAGS = ['audio','video'];
  const FILTER_DEFAULTS = Object.freeze({ q:'', subscription:'', category:'', tag:'', tagList:[], unread:false, fav:false, readState:'', dateFrom:'', dateTo:'', sort: SORT_DEFAULT });
  const currentFilters = { ...FILTER_DEFAULTS, tagList: [] }; // mutable runtime copy
  function populateFilters(form){
    if(!form) return;
    const selSub = form.querySelector('#filterSubscription');
    const selCat = form.querySelector('#filterCategory');
  const tagWrap = form.querySelector('#filterTagsWrap');
    const feeds = state.feeds.slice().sort((a,b)=> (a.title||a.url||'').localeCompare(b.title||b.url||''));
    if(selSub){
      selSub.innerHTML = '<option value="">All subscriptions</option>' + feeds.map(f=> `<option value="${f.id}">${esc(f.title||f.url)}</option>`).join('');
      selSub.value = currentFilters.subscription || '';
    }
    const cats = Array.from(new Set(state.feeds.map(f=> f.category).filter(Boolean))).sort((a,b)=> a.localeCompare(b));
    if(selCat){
      selCat.innerHTML = '<option value="">All categories</option>' + cats.map(c=> `<option>${esc(c)}</option>`).join('');
      selCat.value = currentFilters.category || '';
    }
    if(tagWrap){
      const allTags = Array.from(new Set(Object.values(state.tags||{}).flat()))
        .map(t=> (t||'').trim())
        .filter(Boolean)
        .sort((a,b)=> a.localeCompare(b));
      tagWrap.innerHTML='';
      const baseSelections = Array.isArray(currentFilters.tagList) && currentFilters.tagList.length ? currentFilters.tagList : (currentFilters.tag? [currentFilters.tag]:[]);
      const selected = new Set(baseSelections.map(t=> (t||'').trim()).filter(Boolean));
      if(!allTags.length){
        tagWrap.append(el('span',{class:'muted'},'No tags yet.'));
      } else {
        allTags.forEach(t=>{
          const isSelected = selected.has(t);
          const btn = el('button',{type:'button',class:'tag-toggle'+(isSelected?' is-selected':''), 'data-tag':t, 'aria-pressed':isSelected?'true':'false'}, t);
          btn.addEventListener('click',()=>{
            const active = !btn.classList.contains('is-selected');
            btn.classList.toggle('is-selected', active);
            btn.setAttribute('aria-pressed', active?'true':'false');
          });
          tagWrap.append(btn);
        });
      }
    }
    const sortSelect = form.querySelector('#filterSort');
    if(sortSelect){
      const value = SORT_OPTIONS.has(currentFilters.sort) ? currentFilters.sort : SORT_DEFAULT;
      sortSelect.value = value;
    }
    const searchInput = form.querySelector('#filterSearch'); if(searchInput) searchInput.value = currentFilters.q || '';
    const favOnly = form.querySelector('input[name="favOnly"]'); if(favOnly) favOnly.checked = !!currentFilters.fav;
    const readStateInputs = form.querySelectorAll('input[name="readState"]');
    const desired = currentFilters.readState ? currentFilters.readState : (currentFilters.unread? 'unread':'all');
    readStateInputs.forEach(r=>{ r.checked = (r.value === (desired||'all')); });
    const fromInput = form.querySelector('#filterDateFrom'); if(fromInput) fromInput.value = currentFilters.dateFrom || '';
    const toInput = form.querySelector('#filterDateTo'); if(toInput) toInput.value = currentFilters.dateTo || '';
  }
  function applyFilterForm(form){
    if(!form) return;
    const data = new FormData(form);
    const q = (data.get('q')||'').toString().trim();
    const subscription = (data.get('subscription')||'').toString();
    const category = (data.get('category')||'').toString();
    const favOnlyInput = form.querySelector('input[name="favOnly"]');
    const fav = !!(favOnlyInput && favOnlyInput.checked);
    const readStateRaw = (data.get('readState')||'all').toString();
    const readState = readStateRaw==='all'? '' : readStateRaw;
    const unread = readState==='unread';
  const tagWrap = form.querySelector('#filterTagsWrap');
  const tagSelection = tagWrap ? [...tagWrap.querySelectorAll('.tag-toggle.is-selected')].map(btn=> (btn.dataset.tag||'').trim()).filter(Boolean) : [];
    const tagList = Array.from(new Set(tagSelection));
    const dateFrom = (data.get('dateFrom')||'').toString();
    const dateTo = (data.get('dateTo')||'').toString();
    const sortRaw = (data.get('sort')||SORT_DEFAULT).toString();
    const sort = SORT_OPTIONS.has(sortRaw)? sortRaw : SORT_DEFAULT;
    currentFilters.q = q;
    currentFilters.subscription = subscription;
    currentFilters.category = category;
    currentFilters.fav = fav;
    currentFilters.readState = readState;
    currentFilters.unread = unread;
    currentFilters.tagList = tagList;
    currentFilters.tag = tagList.length===1 ? tagList[0] : '';
    currentFilters.dateFrom = dateFrom;
    currentFilters.dateTo = dateTo;
    currentFilters.sort = sort;
  }
  function getFilteredPosts(){
    const feedMap = new Map(state.feeds.map(f=> [f.id,f]));
    const hostCache = new Map();
    const getHost = (post)=>{
      if(hostCache.has(post.id)) return hostCache.get(post.id);
      const host = safeHost(post.link||'') || '';
      hostCache.set(post.id, host);
      return host;
    };
    const getFeedTitle = (feedId)=>{
      const feed = feedMap.get(feedId);
      return (feed?.title || feed?.url || '').trim();
    };
    const getPublishedTime = (post)=>{
      const ts = new Date(post.published||post.updated||0).getTime();
      return isNaN(ts)? 0 : ts;
    };
    const fallbackCompare = (a,b)=>{
      const diff = getPublishedTime(b) - getPublishedTime(a);
      if(diff) return diff;
      const titleDiff = (a.title||'').localeCompare(b.title||'', undefined, { sensitivity:'base', numeric:true });
      if(titleDiff) return titleDiff;
      return (a.id||'').localeCompare(b.id||'');
    };
    let arr = Object.values(posts);
    if(currentFilters.subscription){
      arr = arr.filter(p=> p.feedId === currentFilters.subscription);
    }
    if(currentFilters.category){
      arr = arr.filter(p=> (feedMap.get(p.feedId)?.category||'') === currentFilters.category);
    }
    if(currentFilters.unread){
      arr = arr.filter(p=> !p.read);
    }
    if(currentFilters.fav){
      arr = arr.filter(p=> p.favorite);
    }
    if(currentFilters.readState === 'read'){
      arr = arr.filter(p=> p.read);
    }
    if(currentFilters.readState === 'unread'){
      arr = arr.filter(p=> !p.read);
    }
    const tagList = (currentFilters.tagList&&currentFilters.tagList.length)? currentFilters.tagList : [];
    if(tagList.length){
      arr = arr.filter(p=>{
        const tags = state.tags[p.id]||[];
        return tagList.some(t=> tags.includes(t));
      });
    } else if(currentFilters.tag){
      arr = arr.filter(p=> (state.tags[p.id]||[]).includes(currentFilters.tag));
    }
    const fromTime = currentFilters.dateFrom ? new Date(currentFilters.dateFrom).getTime() : NaN;
    const toTime = currentFilters.dateTo ? new Date(currentFilters.dateTo).getTime() : NaN;
    if(!isNaN(fromTime)){
      arr = arr.filter(p=>{
        const tp = new Date(p.published||p.updated||0).getTime();
        return !isNaN(tp) && tp >= fromTime;
      });
    }
    if(!isNaN(toTime)){
      const inclusiveTo = toTime + 24*60*60*1000 - 1;
      arr = arr.filter(p=>{
        const tp = new Date(p.published||p.updated||0).getTime();
        return !isNaN(tp) && tp <= inclusiveTo;
      });
    }
    if(currentFilters.q){
      const q = currentFilters.q.toLowerCase();
      arr = arr.filter(p=> (p.title||'').toLowerCase().includes(q) || (p.summary||'').toLowerCase().includes(q));
    }
    const sortKey = SORT_OPTIONS.has(currentFilters.sort) ? currentFilters.sort : SORT_DEFAULT;
    arr.sort((a,b)=>{
      switch(sortKey){
        case 'published-asc':{
          const diff = getPublishedTime(a) - getPublishedTime(b);
          if(diff) return diff;
          break;
        }
        case 'title-asc':
        case 'title-desc':{
          const dir = sortKey==='title-asc'? 1 : -1;
          const diff = (a.title||'').localeCompare(b.title||'', undefined, { sensitivity:'base', numeric:true });
          if(diff) return dir * diff;
          break;
        }
        case 'feed-asc':
        case 'feed-desc':{
          const dir = sortKey==='feed-asc'? 1 : -1;
          const diff = getFeedTitle(a.feedId).localeCompare(getFeedTitle(b.feedId), undefined, { sensitivity:'base', numeric:true });
          if(diff) return dir * diff;
          break;
        }
        case 'host-asc':
        case 'host-desc':{
          const dir = sortKey==='host-asc'? 1 : -1;
          const diff = getHost(a).localeCompare(getHost(b), undefined, { sensitivity:'base', numeric:true });
          if(diff) return dir * diff;
          break;
        }
        case 'favorite':{
          const diff = Number(b.favorite) - Number(a.favorite);
          if(diff) return diff;
          break;
        }
        case 'unread':{
          if(a.read !== b.read) return a.read ? 1 : -1;
          break;
        }
        case 'published-desc':
        default:
          break;
      }
      return fallbackCompare(a,b);
    });
    return arr;
  }

  // ---------- Articles List ----------
  function renderArticles(){
    const panel = stackEl.querySelector('[data-panel="articlesInfiniteScrollable"]'); if(!panel) return;
    const list = panel.querySelector('#articlesList'); if(!list) return;
    const filtered = getFilteredPosts();
    lastFilteredPosts = filtered;
    const total = filtered.length;
    if(suspendListRenders){
      pendingListRefresh = true;
      lastRenderedCount = Math.min(lastRenderedCount, total);
      if(total===0){
        if(!list.querySelector('.empty')){
          list.innerHTML='';
          list.append(el('div',{class:'empty'},'No articles match these filters.'));
        }
      }
      return;
    }
    pendingListRefresh = false;
    list.innerHTML='';
    if(!total){
      list.append(el('div',{class:'empty'},'No articles match these filters.'));
      lastRenderedCount = 0;
      return;
    }
    lastRenderedCount = 0;
    renderNextArticleChunk(list, INITIAL_RENDER_COUNT);
    ensureArticleListFilled(list);
  }
  function renderNextArticleChunk(list, count=CHUNK_SIZE){
    if(!lastFilteredPosts.length) return 0;
    const start = lastRenderedCount;
    const end = Math.min(lastFilteredPosts.length, start + count);
    for(let i=start; i<end; i++){
      list.append(articleCard(lastFilteredPosts[i]));
    }
    lastRenderedCount = end;
    return end - start;
  }
  function ensureArticleListFilled(list){
    const frame = list._scrollFrame;
    if(!frame) return;
    const threshold = frame.clientHeight + 400;
    let guard = 16;
    while(lastRenderedCount < lastFilteredPosts.length && frame.scrollHeight <= threshold && guard-- > 0){
      if(!renderNextArticleChunk(list)) break;
    }
  }
  function articleCard(p){
    const isFav = !!p.favorite;
    const classes = ['card', p.read? 'read':'unread'];
    if(isFav) classes.push('favorite');
    const c = el('div',{class:classes.join(' '), role:'article', tabindex:0, 'data-post-id':p.id, 'aria-label': (p.title||'Article') + (p.read? ' (read)':' (unread)')});
    const favBtn = el('button',{class:'fav', type:'button', title: isFav? 'Remove favourite':'Add favourite', 'aria-label': isFav? 'Remove favourite':'Add favourite', 'aria-pressed': String(isFav), 'data-post-id': p.id}, isFav? '★':'☆');
    favBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      toggleFavorite(p.id);
    });
    c.append(favBtn);
    const realImg = pickImage(p);
    const mw = el('div',{class:'card-media'});
    
    if(realImg){
      const im = el('img',{src:realImg, alt:'', loading:'lazy', decoding:'async', referrerpolicy:'no-referrer'});
      im.addEventListener('error', ()=>{
        if(im.dataset.fallback) return;
        im.dataset.fallback='1';
        const svg = generateInlinePlaceholderSVG(p);
        if(svg){ mw.innerHTML = svg; }
        else { im.src = onePixelPng(); }
      });
      mw.append(im);
    } else {
      // No sync image found, show placeholder initially
      mw.innerHTML = generateInlinePlaceholderSVG(p) || `<img src="${onePixelPng()}" alt="" loading="lazy" decoding="async">`;
      
      // Try async image loading for Open Graph fallback
      pickImageAsync(p).then(asyncImg => {
        if(asyncImg && asyncImg !== realImg) {
          // Replace placeholder with async image
          const newIm = el('img',{src:asyncImg, alt:'', loading:'lazy', decoding:'async', referrerpolicy:'no-referrer'});
          newIm.addEventListener('error', ()=>{
            if(newIm.dataset.fallback) return;
            newIm.dataset.fallback='1';
            const svg = generateInlinePlaceholderSVG(p);
            if(svg){ mw.innerHTML = svg; }
            else { newIm.src = onePixelPng(); }
          });
          mw.innerHTML = '';
          mw.append(newIm);
        }
      }).catch(() => {
        // Async loading failed, keep placeholder
      });
    }
    
    c.append(mw);
    c.append(el('h3',{}, p.title||'(untitled)'));
    const chips = el('div',{class:'chips'});
  p.read = true;
  state.read[p.id]=true;
  const feed = state.feeds.find(f=> f.id===p.feedId);
    if(feed){
      const feedChip = el('button',{class:'chip feed-chip', title:'Filter by subscription','aria-label':'Filter by '+(feed.title||feed.url), onclick:(e)=>{ e.stopPropagation(); currentFilters.subscription=feed.id; renderArticles(); }}, feed.title||feed.url);
      chips.append(feedChip);
      if(feed.category){ const catChip = el('button',{class:'chip cat-chip', title:'Filter by category','aria-label':'Filter by category '+feed.category, onclick:(e)=>{ e.stopPropagation(); currentFilters.category=feed.category; renderArticles(); }}, feed.category); chips.append(catChip); }
    }
    // Tag chips (existing)
    const tagList = state.tags[p.id]||[];
    if(tagList.length){
      tagList.forEach(t=> chips.append(createTagFilterChip(t)));
    }
    // Read state chip
    const readChip = el('button',{class:'chip read-chip', title:'Quick filter by read state', 'aria-label': p.read? 'Filter unread':'Filter read', onclick:(e)=>{ e.stopPropagation(); currentFilters.readState = p.read? 'unread':'read'; renderArticles(); }}, p.read? 'Read':'Unread');
    chips.append(readChip);
    if(chips.children.length) c.append(chips);
    const host = safeHost(p.link||'');
    c.append(el('div',{class:'meta'}, [host,' • ',fmtDate(p.published)]));
    c.append(el('div',{class:'excerpt'}, p.summary||stripHtml(p.content||'').slice(0,180)));
    c.onclick = ()=>{ openArticle(p); };
    c.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); openArticle(p);} });
    return c;
  }
  let lastArticlesScroll = 0;
  function rememberArticlesScroll(){
    const panel = stackEl.querySelector('[data-panel="articlesInfiniteScrollable"]');
    if(panel){ const body = panel.querySelector('.panel-body'); if(body) lastArticlesScroll = body.scrollTop; }
  }
  function restoreArticlesScroll(){
    const panel = stackEl.querySelector('[data-panel="articlesInfiniteScrollable"]');
    if(panel){ const body = panel.querySelector('.panel-body'); if(body) body.scrollTop = lastArticlesScroll; }
  }
  function openArticle(p){
    rememberArticlesScroll();
    showPanel('articleViewer', { data: p });
    requestAnimationFrame(()=>{ const pv = stackEl.querySelector('[data-panel="articleViewer"] .panel-body'); if(pv) pv.scrollTop = 0; });
  }
  function renderSubscriptionsList(){
    const body = byId('subsBody'); if(!body) return; body.innerHTML='';
    if(!state.feeds.length){ body.append(el('div',{class:'empty'},'No subscriptions yet. Use ＋ to add.')); return; }
    const list = el('div',{class:'subs-list'});
    state.feeds.sort((a,b)=> (a.category||'').localeCompare(b.category||'') || (a.title||'').localeCompare(b.title||'')).forEach(f=>{
      const row = el('div',{class:'row'});
      const titleBlock = el('strong',{}, f.title||f.url);
      const catLabel = el('span',{class:'muted'}, f.category? `(${f.category})`:'');
      const actions = el('div',{class:'subs-actions'});
      const editBtn = el('button',{title:'Edit subscription', 'aria-label':'Edit '+(f.title||f.url), onclick:()=>{ showPanel('subscriptionEdit', { data: f.id }); }}, 'Edit');
  const delBtn = el('button',{title:'Remove subscription', 'aria-label':'Remove '+(f.title||f.url), onclick:()=>{ if(confirm('Remove this subscription?')){ removeSubscription(f.id); } }}, '🗑');
      actions.append(editBtn, delBtn);
      row.append(titleBlock, catLabel, actions);
      list.append(row);
    });
    body.append(list);
  }
  function renderArticleViewer(p){
    const body = byId('articleBody'); if(!body) return;
    body.innerHTML='';
    body.classList.add('article-viewer');
    body.dataset.postId = p.id;
    const feed = state.feeds.find(f=> f.id===p.feedId);
    const heroUrl = pickImage(p);
    const host = safeHost(p.link||'');
    const published = fmtDate(p.published);
    const publishedIso = (()=>{
      const ts = Date.parse(p.published||'');
      return isNaN(ts)? null : new Date(ts).toISOString();
    })();
    const readingStats = computeReadingStats(p);

    const contextChips = el('div',{class:'chips article-context'}, []);
    if(feed){
      const feedChip = el('button',{class:'chip feed-chip', title:'Filter by subscription','aria-label':'Filter by '+(feed.title||feed.url), onclick:(e)=>{ e.stopPropagation(); currentFilters.subscription=feed.id; renderArticles(); }}, feed.title||feed.url);
      contextChips.append(feedChip);
      if(feed.category){
        contextChips.append(el('button',{class:'chip cat-chip', title:'Filter by category','aria-label':'Filter by category '+feed.category, onclick:(e)=>{ e.stopPropagation(); currentFilters.category=feed.category; renderArticles(); }}, feed.category));
      }
    }

    const readStateChip = el('button',{class:'chip read-chip', title:'Quick filter by read state','aria-label': p.read? 'Filter unread':'Filter read', onclick:(e)=>{ e.stopPropagation(); currentFilters.readState = p.read? 'unread':'read'; renderArticles(); }}, p.read? 'Read':'Unread');
  contextChips.append(readStateChip);

    const header = el('header',{class:'article-head'},[
      contextChips,
      el('h1',{class:'article-title', id:'articleViewerTitle'}, p.title||'(untitled)'),
      el('div',{class:'article-meta'},[
        published? el('span',{class:'meta-item'}, ['Published ', publishedIso? el('time',{datetime:publishedIso}, published) : published]) : null,
        host? el('span',{class:'meta-item'}, ['Source ', host]) : null,
        readingStats.minutes? el('span',{class:'meta-item'}, [`${readingStats.minutes} min read`, readingStats.words? ` • ${readingStats.words} words`:'' ]) : null
      ].filter(Boolean)),
      (function(){
        const actions = el('div',{class:'article-actions'});
        const favBtn = el('button',{type:'button', class:'action-btn favorite-toggle', 'aria-pressed':'false', 'aria-label':'Add favourite', 'data-post-id':p.id});
        const favIcon = svgIcon('#i-star');
        const favLabel = el('span',{class:'favorite-toggle-label'},' Favourite');
        favBtn.append(favIcon, favLabel);
        favBtn.addEventListener('click', ()=>{
          toggleFavorite(p.id);
          syncArticleViewerFavoriteState(p.id);
        });
        actions.append(favBtn);
          // compute a sensible original-article URL:
          (function(){
            let href = p.link || '';
            // if no link or link is just a hash/empty, attempt to extract first anchor from content
            try{
              if(!href || href.trim()==='#' || href.trim()===''){
                const dp = new DOMParser();
                const doc = dp.parseFromString(p.content||'', 'text/html');
                const a = doc.querySelector('a[href]');
                if(a){ href = a.getAttribute('href') || href; }
              }
              // If href is relative and we have a feed.url, resolve against feed.url
              if(href && feed && feed.url){
                try{ href = (new URL(href, feed.url)).toString(); }catch(e){}
              }
            }catch(e){ /* ignore and fallback to existing href */ }
            if(!href || href.trim()==='#') href = (feed && feed.url) ? feed.url : '#';
            actions.append(el('a',{href:href, target:'_blank', rel:'noopener noreferrer', class:'action-btn primary', title:'Open original article'}, 'Open original'));
          })();
        return actions;
      })()
    ]);
    body.append(header);
    syncArticleViewerFavoriteState(p.id);

    if(heroUrl){
      const hero = el('figure',{class:'article-hero'},[
        el('img',{src:heroUrl, alt:'', loading:'lazy'}),
        p.title? el('figcaption',{class:'visually-hidden'}, p.title):null
      ].filter(Boolean));
      body.append(hero);
    }

    const playableMedia = Array.isArray(p.media) ? p.media.filter(m=> m && (m.kind==='audio' || m.kind==='video')) : [];
    if(playableMedia.length){
      const mediaSection = el('section',{class:'article-media'},[
        el('div',{class:'article-media-head'},[
          el('h3',{class:'article-media-title'},'Media'),
          el('span',{class:'article-media-count muted'}, playableMedia.length>1? `${playableMedia.length} attachments` : '1 attachment')
        ])
      ]);
      playableMedia.forEach((mediaItem, idx)=>{
        const entry = createArticleMediaEntry(p, mediaItem, idx);
        if(entry) mediaSection.append(entry);
      });
      body.append(mediaSection);
    }

    const content = el('section',{class:'article-content', html: sanitizeHtml(p.content||p.summary||'')});
    body.append(content);

    const tagPills = el('div',{class:'tag-pills'});
    (state.tags[p.id]||[]).forEach(t=> tagPills.append(createArticleTagPill(p.id, t)));
    if(!tagPills.children.length){ tagPills.append(el('span',{class:'muted empty-placeholder'},'No tags yet.')); }
    const tagSection = el('section',{class:'article-tags'},[
      el('div',{class:'tag-manage-header'},[
        el('h3',{},'Tags')
      ]),
      tagPills
    ]);
    const addForm = el('form',{class:'tag-add-form', onsubmit:(e)=>{
      e.preventDefault();
      const inp = addForm.querySelector('input');
      const v = (inp.value||'').trim();
      if(!v) return;
      const arr = state.tags[p.id] = (state.tags[p.id]||[]);
      if(!arr.includes(v)){
        arr.push(v);
        saveState();
        const wrap = tagSection.querySelector('.tag-pills');
        wrap.querySelector('.empty-placeholder')?.remove();
        wrap.append(createArticleTagPill(p.id, v));
        updateCardTags(p.id);
        renderArticles();
      }
      inp.value='';
    }},[
      el('input',{type:'text', placeholder:'Add tag and press Enter', maxlength:40}),
      el('button',{type:'submit', class:'chip'}, '＋ Tag')
    ]);
    tagSection.append(addForm);
    body.append(tagSection);

    saveState();
    updateCardTags(p.id); // mark read persistently & sync list card
    updateCardReadState(p.id, true);
  }
  function createArticleMediaEntry(post, media, index){
    if(!media || !media.url) return null;
    const title = deriveMediaTitle(media);
    const meta = formatMediaMeta(media);
    const host = safeHost(media.url);
    const badgeLabel = media.kind==='video'? 'Video' : media.kind==='audio'? 'Audio' : 'Media';
    const badge = el('span',{class:'media-entry-kind'}, badgeLabel);
    const info = el('div',{class:'media-entry-info'},[
      el('div',{class:'media-entry-top'},[
        badge,
        el('h4',{class:'media-entry-title'}, title)
      ]),
      meta? el('p',{class:'media-entry-meta muted'}, meta):null,
      host? el('p',{class:'media-entry-host muted'}, `Source ${host}`):null
    ].filter(Boolean));
    const actions = el('div',{class:'media-entry-actions'});
    if(media.kind==='audio'){
      const playBtn = el('button',{type:'button',class:'action-btn primary', 'aria-label':`Play ${title}`, onclick:()=>{ playMediaFromArticle(post, media); }}, [svgIcon('#i-play'), ' Play']);
      actions.append(playBtn);
    } else if(media.kind==='video'){
      const watchBtn = el('button',{type:'button',class:'action-btn primary', 'aria-label':`Open video ${title}`, onclick:()=>{ openVideoMedia(post, index); }}, [svgIcon('#i-play'), ' Watch']);
      actions.append(watchBtn);
    }
    const downloadBtn = el('a',{class:'action-btn', href:media.url, target:'_blank', rel:'noopener noreferrer', download:'', 'aria-label':`Download ${title}`}, [svgIcon('#i-download'), ' Download']);
    actions.append(downloadBtn);
    return el('div',{class:`media-entry media-${media.kind}`},[
      info,
      actions
    ]);
  }

  const mediaFallbacks = new WeakMap();
  function buildMediaSourceCandidates(media){
    const original = (media?.url||'').trim();
    if(!original) return [];
    const candidates = [];
    const seen = new Set();
    const add = url=>{
      if(!url) return;
      const clean = String(url).trim();
      if(!clean || seen.has(clean)) return;
      seen.add(clean);
      candidates.push(clean);
    };
    const isHttp = /^http:\/\//i.test(original);
    const isHttps = /^https:\/\//i.test(original);
    if(isHttp){ add('https://'+original.slice(7)); }
    add(original);
    if(typeof location !== 'undefined' && location.protocol === 'https:'){
      const manual = state?.settings?.corsProxy?.trim();
      if(manual){
        try{ add(buildProxiedUrl(original, manual)); }
        catch{ /* ignore malformed manual proxy */ }
      }
      const mediaProxyBuilders = [];
      if(isHttp){
        mediaProxyBuilders.push(u=>`https://cors.isomorphic-git.org/${u}`);
        mediaProxyBuilders.push(u=>`https://thingproxy.freeboard.io/fetch/${u}`);
      }
      mediaProxyBuilders.push(u=>`https://corsproxy.io/?${encodeURIComponent(u)}`);
      mediaProxyBuilders.push(u=>`https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`);
      if(isHttp){ mediaProxyBuilders.push(u=>`https://r.jina.ai/http://${u.slice(7)}`); }
      const sharedProxySpecs = PROXIES || [];
      for(const builder of mediaProxyBuilders){
        try{ add(builder(original)); }
        catch{ /* skip unsupported builder */ }
      }
      for(const spec of sharedProxySpecs){
        if(!spec) continue;
        try{ add(buildProxiedUrl(original, spec)); }
        catch{ /* ignore */ }
      }
      if(isHttps){
        try{ add(`https://cors.isomorphic-git.org/${original}`); }
        catch{}
      }
    }
    return candidates;
  }
  async function fetchMediaToBlob(url){
    try{
      const controller = new AbortController();
      const to = setTimeout(()=>controller.abort(), 15000);
      const res = await fetch(url, { signal: controller.signal, mode:'cors' });
      clearTimeout(to);
      if(!res.ok) throw new Error('HTTP '+res.status);
      const ct = res.headers.get('content-type')||'';
      if(!/audio|video|application\/(octet-stream|mpegurl|x-mpegURL)/i.test(ct)){
        // Still accept but note
        console.info('[FeedCycle v2] Fetch media content-type', ct);
      }
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    }catch(e){
      throw e;
    }
  }
  async function attemptBlobFallback(el){
    const info = mediaFallbacks.get(el);
    if(!info || !info.original) return false;
    // Only attempt once per element
    if(info.blobTried) return false;
    info.blobTried = true; mediaFallbacks.set(el, info);
    try{
      const blobUrl = await fetchMediaToBlob(info.original);
      if(blobUrl){
        el.src = blobUrl;
        try{ el.load?.(); el.play?.().catch(()=>{}); }catch{}
        return true;
      }
    }catch(err){ console.warn('[FeedCycle v2] Blob fallback failed', err); }
    return false;
  }
  function prepareMediaElementSource(el, media){
    const candidates = buildMediaSourceCandidates(media);
    if(!candidates.length) return null;
    mediaFallbacks.set(el, { candidates, index:0, original: media?.url||'' });
    if(el && typeof el.setAttribute === 'function'){
      const first = candidates[0]||'';
      if(shouldUseCrossOrigin(first)) el.crossOrigin = 'anonymous'; else try{ delete el.crossOrigin; }catch{}
    }
    if(el?.src !== candidates[0]){
      el.src = candidates[0];
      try{ el.load?.(); }catch{}
    }
    return candidates;
  }
  function advanceMediaFallback(el){
    const info = mediaFallbacks.get(el);
    if(!info) return false;
    const { candidates } = info;
    if(!Array.isArray(candidates) || info.index >= candidates.length-1) return false;
    info.index += 1;
    mediaFallbacks.set(el, info);
    const next = candidates[info.index];
    if(el && typeof el.setAttribute === 'function'){
      if(shouldUseCrossOrigin(next)) el.crossOrigin = 'anonymous'; else try{ delete el.crossOrigin; }catch{}
    }
    el.src = next;
    try{ el.load?.(); }catch{}
    return true;
  }
  function handleMediaErrorEvent(e){
    const el = e?.target;
    if(!el) return;
    const switched = advanceMediaFallback(el);
    if(!switched){
      // As a last resort, try to fetch original to blob (if same-origin or CORS allows)
      attemptBlobFallback(el).then(success=>{
        if(success) return;
      const info = mediaFallbacks.get(el);
      console.warn('[FeedCycle v2] Media fallback exhausted for', info?.original || 'unknown media');
        try{
          const evt = new CustomEvent('feedcycle:media-fallback-exhausted',{detail:{url:info?.original||'', element:el}});
          window.dispatchEvent(evt);
        }catch{}
      });
      return;      
    }
    const resume = el.play?.();
    if(resume?.catch){ resume.catch(err=> console.warn('Playback fallback blocked', err)); }
  }
  function shouldUseCrossOrigin(url){
    if(!url) return false;
    try{
      const u = new URL(url, location.href);
      const host = u.hostname.toLowerCase();
      const manual = (state?.settings?.corsProxy||'').trim();
      const proxyIndicators = [
        'corsproxy.io',
        'allorigins.win',
        'isomorphic-git.org',
        'thingproxy.freeboard.io',
        'r.jina.ai'
      ];
      if(manual){
        try{
          const mu = new URL(manual.replace('%s','https://example.com'), location.href);
          proxyIndicators.push(mu.hostname.toLowerCase());
        }catch{}
      }
      // Only set crossOrigin if clearly a proxy/transforming host
      return proxyIndicators.some(p=> host.endsWith(p));
    }catch{ return false; }
  }

  // One-time UI helper when media fails due to hard CORS blocks
  let mediaHelpShown = false;
  function showMediaFailureHelp(detail){
    if(mediaHelpShown) return; mediaHelpShown = true;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;left:50%;bottom:12px;transform:translateX(-50%);background:#222;color:#fff;padding:12px 16px;border-radius:8px;z-index:9999;font:12px system-ui, sans-serif;max-width:520px;box-shadow:0 4px 14px -2px rgba(0,0,0,0.4);line-height:1.4';
    wrap.setAttribute('role','alert');
    const close = document.createElement('button');
    close.textContent = '×';
    close.setAttribute('aria-label','Dismiss');
    close.style.cssText='position:absolute;top:4px;right:6px;background:transparent;border:0;color:#fff;font-size:16px;cursor:pointer;font-weight:600';
    close.onclick = ()=>{ wrap.remove(); };
    const msg = document.createElement('div');
    msg.innerHTML = '<strong>Media could not be played (CORS).</strong><br>Some podcast/CDN endpoints (e.g. BBC) block direct browser playback without their own pages. You can try configuring a proxy in Settings → Network (e.g. a personal Cloudflare Worker) that adds permissive CORS headers.<br><br><code style="font-size:11px;user-select:all;display:inline-block;padding:2px 4px;background:#333;border-radius:4px;">https://your-worker.example.workers.dev/?url=%s</code>';
    wrap.append(close, msg);
    document.body.appendChild(wrap);
    setTimeout(()=>{ try{ wrap.style.transition='opacity .6s'; wrap.style.opacity='0'; setTimeout(()=>wrap.remove(), 700); }catch{} }, 20000);
  }
  window.addEventListener('feedcycle:media-fallback-exhausted', e=>{ showMediaFailureHelp(e.detail||{}); });
  function openVideoMedia(post, mediaIndex){
    showPanel('videoViewer', { data:{ postId: post.id, mediaIndex } });
  }
  function createArticleTagPill(postId, tag){
    const pill = el('div',{class:'tag-pill','data-tag':tag});
    const labelBtn = el('button',{type:'button',class:'tag-pill-label', title:'Filter by tag','aria-label':'Filter by tag '+tag, onclick:()=>{ currentFilters.tag=tag; currentFilters.tagList=[tag]; renderArticles(); }}, tag);
    const removeBtn = el('button',{type:'button',class:'tag-pill-remove', title:'Remove tag','aria-label':'Remove tag '+tag}, '×');
    removeBtn.addEventListener('click',(e)=>{
      e.stopPropagation();
      removeTagFromPost(postId, tag);
      pill.remove();
      const wrap = pill.parentElement;
      if(wrap && !wrap.querySelector('.tag-pill')){
        wrap.innerHTML='';
        wrap.append(el('span',{class:'muted empty-placeholder'},'No tags yet.'));
      }
    });
    pill.append(labelBtn, removeBtn);
    return pill;
  }
  function deriveMediaTitle(media){
    if(media?.title){ const t = media.title.trim(); if(t) return t; }
    try{
      const u = new URL(media.url);
      const parts = u.pathname.split('/').filter(Boolean);
      if(parts.length){
        const last = decodeURIComponent(parts[parts.length-1]);
        if(last) return last;
      }
      return u.hostname;
    }catch{ return media.url; }
  }
  function formatMediaMeta(media){
    if(!media) return '';
    const bits = [];
    if(media.type) bits.push(media.type);
    if(media.length){ const bytes = formatBytes(media.length); if(bytes) bits.push(bytes); }
    if(media.duration){ const dur = formatDuration(media.duration); if(dur) bits.push(dur); }
    return bits.join(' • ');
  }
  function formatBytes(bytes){
    if(!(bytes>0)) return '';
    const units = ['B','KB','MB','GB','TB'];
    let value = bytes;
    let unitIdx = 0;
    while(value>=1024 && unitIdx < units.length-1){ value/=1024; unitIdx++; }
    let str;
    if(unitIdx===0){ str = Math.round(value).toString(); }
    else if(value>=100){ str = value.toFixed(0); }
    else if(value>=10){ str = value.toFixed(1); }
    else { str = value.toFixed(2); }
    return str+' '+units[unitIdx];
  }
  function formatDuration(seconds){
    if(!(seconds>0)) return '';
    const total = Math.round(seconds);
    const h = Math.floor(total/3600);
    const m = Math.floor((total%3600)/60);
    const s = total%60;
    if(h>0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${m}:${String(s).padStart(2,'0')}`;
  }
  function playMediaFromArticle(post, media){
    queueMediaPlayback(post.id, media);
  }
  function queueMediaPlayback(postId, media){
    if(!media || media.kind!=='audio') return;
    const post = posts[postId] || null;
    const title = deriveMediaTitle(media);
    const host = safeHost(media.url);
    const audio = mp.audio;
    const previous = mp.current;
    const sameTrack = previous && previous.media?.url === media.url && previous.kind==='audio';
    if(mp.mediaEl && mp.mediaEl !== audio){
      try{ mp.mediaEl.pause(); }catch{}
    }
    mp.bindMediaElement?.(audio);
    if(sameTrack){
      mp.current = { ...previous, post, postId, title, host, media, kind:'audio' };
      mp.updateToolbar?.();
      mp.updateFavorite?.();
      mp.syncPlaybackButtons?.();
      if(audio.paused){
        audio.play().catch(err=> console.warn('Playback start blocked', err));
      } else {
        audio.currentTime = 0;
      }
      mp.lastAudioState = { ...mp.current, position: audio.currentTime, wasPlaying: !audio.paused };
      return;
    }
    mp.current = { postId, media, post, title, host, kind:'audio' };
    mp.updateToolbar?.();
    mp.updateFavorite?.();
    mp.syncPlaybackButtons?.();
    mp.lastAudioState = { ...mp.current, position: 0, wasPlaying: true };
  try{ audio.pause(); }catch{}
  const candidates = prepareMediaElementSource(audio, media) || [media.url];
  mp.current.sourceCandidates = candidates;
  audio.currentTime = 0;
    const playPromise = audio.play();
    if(playPromise && playPromise.catch){
      playPromise.catch(err=> console.warn('Playback start blocked', err));
    }
  }
  function removeTagFromPost(postId, tag){
    const arr = state.tags[postId];
    if(!arr) return;
    const idx = arr.indexOf(tag);
    if(idx===-1) return;
    arr.splice(idx,1);
    if(!arr.length){ delete state.tags[postId]; }
    if(state.autoTags && state.autoTags[postId]){
      const autoArr = state.autoTags[postId];
      const autoIdx = autoArr.indexOf(tag);
      if(autoIdx!==-1){
        autoArr.splice(autoIdx,1);
        if(!autoArr.length){ delete state.autoTags[postId]; }
      }
    }
    saveState();
    updateCardTags(postId);
    if(currentFilters.tag===tag){ currentFilters.tag=''; }
    if(Array.isArray(currentFilters.tagList) && currentFilters.tagList.length){
      currentFilters.tagList = currentFilters.tagList.filter(t=> t!==tag);
    }
    renderArticles();
  }
  function createTagFilterChip(tag){
    return el('button',{
      class:'chip tag-chip',
      title:'Filter by tag',
      'aria-label':'Filter by tag '+tag,
      onclick:(e)=>{
        e.stopPropagation();
        currentFilters.tag = tag;
        currentFilters.tagList = [tag];
        renderArticles();
      }
    }, tag);
  }

  function updateCardTags(postId){
    const card = document.querySelector(`.card[data-post-id='${postId}']`);
    if(card){
      const chips = card.querySelector('.chips');
      if(chips){
        chips.querySelectorAll('.tag-chip').forEach(n=> n.remove());
        const postTags = state.tags[postId]||[];
        const readChip = chips.querySelector('.read-chip');
        postTags.forEach(t=>{
          const chip = createTagFilterChip(t);
          if(readChip) chips.insertBefore(chip, readChip); else chips.append(chip);
        });
      }
    }
    refreshArticleViewerTags(postId);
  }

  function refreshArticleViewerTags(postId){
    const body = byId('articleBody');
    if(!body) return;
    if(String(body.dataset.postId||'') !== String(postId||'')) return;
    const tags = state.tags[postId]||[];

    const contextChips = body.querySelector('.article-context');
    if(contextChips){
      contextChips.querySelectorAll('.tag-chip').forEach(n=> n.remove());
      const readChip = contextChips.querySelector('.read-chip');
      tags.forEach(tag=>{
        const chip = createTagFilterChip(tag);
        if(readChip) contextChips.insertBefore(chip, readChip); else contextChips.append(chip);
      });
    }

    const pillWrap = body.querySelector('.tag-pills');
    if(pillWrap){
      pillWrap.querySelectorAll('.tag-pill').forEach(n=> n.remove());
      pillWrap.querySelector('.empty-placeholder')?.remove();
      tags.forEach(tag=> pillWrap.append(createArticleTagPill(postId, tag)));
      if(!pillWrap.querySelector('.tag-pill')){
        pillWrap.append(el('span',{class:'muted empty-placeholder'},'No tags yet.'));
      }
    }
  }

  function applyMediaAutoTags(post){
    if(!post || !post.id) return false;
    if(!state.autoTags) state.autoTags = {};
    const existing = Array.isArray(state.tags[post.id]) ? [...state.tags[post.id]] : [];
    const tagsSet = new Set(existing);
    const prevAuto = new Set(Array.isArray(state.autoTags[post.id]) ? state.autoTags[post.id] : []);
  const desired = new Set();
  const mediaList = Array.isArray(post.media) ? post.media : [];
  const hasAudio = mediaList.some(m=> m?.kind==='audio');
  const hasVideo = mediaList.some(m=> m?.kind==='video');
  if(hasAudio && MEDIA_AUTO_TAGS.includes('audio')) desired.add('audio');
  if(hasVideo && MEDIA_AUTO_TAGS.includes('video')) desired.add('video');

    let changed = false;
    desired.forEach(tag=>{
      if(!tagsSet.has(tag)){
        tagsSet.add(tag);
        changed = true;
      }
    });
    prevAuto.forEach(tag=>{
      if(!desired.has(tag) && tagsSet.has(tag)){
        tagsSet.delete(tag);
        changed = true;
      }
    });

    const finalTags = [...tagsSet].filter(Boolean);
    if(finalTags.length){ state.tags[post.id] = finalTags; }
    else { delete state.tags[post.id]; }

    if(desired.size){ state.autoTags[post.id] = [...desired]; }
    else { delete state.autoTags[post.id]; }

    return changed;
  }
  function updateCardReadState(postId, isRead){
    const card = document.querySelector(`.card[data-post-id='${postId}']`); if(!card) return;
    const read = !!isRead;
    card.classList.toggle('read', read);
    card.classList.toggle('unread', !read);
    const titleText = card.querySelector('h3')?.textContent?.trim() || 'Article';
    card.setAttribute('aria-label', `${titleText}${read ? ' (read)' : ' (unread)'}`);
    const readChip = card.querySelector('.read-chip');
    if(readChip){
      readChip.textContent = read ? 'Read' : 'Unread';
      readChip.setAttribute('aria-label', read ? 'Filter unread' : 'Filter read');
    }
  }

  function updateCardFavoriteState(postId, isFav){
    const card = document.querySelector(`.card[data-post-id='${postId}']`); if(!card) return;
    card.classList.toggle('favorite', !!isFav);
    const favBtn = card.querySelector('.fav');
    if(favBtn){
      const label = isFav ? 'Remove favourite' : 'Add favourite';
      favBtn.textContent = isFav ? '★' : '☆';
      favBtn.setAttribute('aria-pressed', String(!!isFav));
      favBtn.setAttribute('title', label);
      favBtn.setAttribute('aria-label', label);
    }
  }

  function syncArticleViewerFavoriteState(postId){
    const body = byId('articleBody'); if(!body) return;
    const favBtn = body.querySelector('.favorite-toggle'); if(!favBtn) return;
    const isFav = !!state.favorites[postId];
    favBtn.classList.toggle('is-favorite', isFav);
    favBtn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
    favBtn.setAttribute('aria-label', isFav ? 'Remove from favourites' : 'Add favourite');
    favBtn.setAttribute('title', isFav ? 'Remove from favourites' : 'Add favourite');
    const iconUse = favBtn.querySelector('use');
    if(iconUse){ iconUse.setAttribute('href', isFav ? '#i-star-fill' : '#i-star'); }
    const label = favBtn.querySelector('.favorite-toggle-label');
    if(label){ label.textContent = isFav ? ' Favourited' : ' Favourite'; }
  }
  function toggleFavorite(postId){
    if(!postId) return;
    const wasFav = !!state.favorites[postId];
    if(wasFav){ delete state.favorites[postId]; }
    else { state.favorites[postId] = true; }
    const nowFav = !wasFav;
    if(posts[postId]) posts[postId].favorite = nowFav;
    if(mp.current?.postId === postId){
      if(mp.current.post) mp.current.post.favorite = nowFav;
    }
    saveState();
    updateCardFavoriteState(postId, nowFav);
    syncArticleViewerFavoriteState(postId);
    mp.updateFavorite?.();
    renderArticles();
  }
  function renderVideoViewer(payload){
    const wrap = byId('videoBody'); if(!wrap) return;
    wrap.innerHTML='';
    const postId = payload?.postId;
    const mediaIndex = typeof payload?.mediaIndex === 'number' ? payload.mediaIndex : 0;
    const explicitMedia = payload?.media;
    const post = explicitMedia?.post || (postId ? posts[postId] : null);
    const mediaList = explicitMedia ? [explicitMedia] : (post?.media||[]);
    let media = explicitMedia || mediaList[mediaIndex];
    if(!media){ media = mediaList.find(m=> m.kind==='video') || null; }
    if(!media || media.kind!=='video'){
      wrap.append(el('div',{class:'empty'},'Video not available for this article.'));
      return;
    }
    const title = deriveMediaTitle(media);
    const meta = formatMediaMeta(media);
    const host = safeHost(media.url);
    const header = el('div',{class:'video-viewer-head'},[
      el('h3',{class:'video-viewer-title'}, title),
      meta? el('p',{class:'video-viewer-meta muted'}, meta):null,
      host? el('p',{class:'video-viewer-host muted'}, `Source ${host}`):null
    ].filter(Boolean));
  const video = document.createElement('video');
  video.setAttribute('controls','');
  video.setAttribute('playsinline','');
  video.setAttribute('preload','metadata');
  video.className = 'video-player';
  if(shouldUseCrossOrigin(media.url)) video.crossOrigin='anonymous';
  prepareMediaElementSource(video, media);
  video.addEventListener('error', handleMediaErrorEvent);
    const figure = el('figure',{class:'video-frame'},[video]);
    function tagOrientation(width, height){
      if(!(width>0 && height>0)) return;
      figure.dataset.ratio = `${width}:${height}`;
      if(width < height){ figure.classList.add('is-portrait'); }
      else { figure.classList.remove('is-portrait'); }
    }
    if(media.width && media.height){ tagOrientation(media.width, media.height); }
    video.addEventListener('loadedmetadata', ()=>{ tagOrientation(video.videoWidth, video.videoHeight); });
    if(mp.current?.kind==='audio'){
      mp.lastAudioState = { ...mp.current, position: mp.audio.currentTime, wasPlaying: !mp.audio.paused };
      try{ mp.audio.pause(); }catch{}
    }
    mp.bindMediaElement?.(video);
    mp.current = { postId: post?.id || postId || null, media, post, title, host, kind:'video', element: video };
    mp.updateToolbar?.();
    mp.updateFavorite?.();
    mp.syncPlaybackButtons?.();
    const actions = el('div',{class:'video-actions'},[
      el('a',{class:'action-btn primary', href:media.url, target:'_blank', rel:'noopener noreferrer', 'aria-label':`Open ${title} in new tab`}, [svgIcon('#i-play'), ' Open media']),
      el('a',{class:'action-btn', href:media.url, download:'', target:'_blank', rel:'noopener noreferrer', 'aria-label':`Download ${title}`}, [svgIcon('#i-download'), ' Download'])
    ]);
    if(post?.link){
      actions.append(el('a',{class:'action-btn', href:post.link, target:'_blank', rel:'noopener noreferrer'}, 'Open original article'));
    }
    wrap.append(header, figure, actions);
    video.focus?.();
    syncArticleViewerFavoriteState(post?.id || postId);
  }

  function cleanupActiveVideo(){
    if(mp.current?.kind!=='video') return;
    const activeVideo = mp.mediaEl;
    try{ activeVideo?.pause?.(); }catch{}
    mp.bindMediaElement?.(mp.audio);
    if(mp.lastAudioState){
      const snapshot = { ...mp.lastAudioState };
      mp.current = snapshot;
      mp.lastAudioState = snapshot;
      const audio = mp.audio;
      if(typeof snapshot.position === 'number'){
        try{ audio.currentTime = snapshot.position; }catch{}
      }
      audio.pause();
      mp.updateToolbar?.();
      mp.updateFavorite?.();
      mp.syncPlaybackButtons?.();
    } else {
      mp.current = null;
      mp.lastAudioState = null;
      mp.updateToolbar?.();
      mp.updateFavorite?.();
      mp.syncPlaybackButtons?.();
    }
  }

  function renderSubscriptionEdit(feedId){
    const feed = state.feeds.find(f=> f.id===feedId); if(!feed){ const b=byId('subEditBody'); if(b) b.innerHTML='<div class="empty">Not found.</div>'; return; }
    const form = byId('subEditForm'); if(!form) return;
    const titleInput = byId('subEditTitleInput');
    const urlInput = byId('subEditUrlInput');
    const catInput = byId('subEditCategoryInput');
    const refreshInput = byId('subEditRefreshInput');
    const statusEl = byId('subEditStatus');
    // Populate datalist of categories
    const dl = byId('categoryOptions');
    if(dl){
      const catSet = new Set([...(state.categories||[])].filter(Boolean));
      state.feeds.forEach(f=>{ if(f.category) catSet.add(f.category); });
      if(feed.category) catSet.add(feed.category);
      const options = Array.from(catSet).sort((a,b)=> a.localeCompare(b, undefined, { sensitivity:'base' }));
      dl.innerHTML = options.map(c=>`<option value="${esc(c)}">`).join('');
    }
    // Fill values
    titleInput.value = feed.title||feed.url;
    urlInput.value = feed.url;
    catInput.value = feed.category||'';
    refreshInput.value = feed.refreshMinutes||'';
    form.addEventListener('submit', e=>{
      e.preventDefault();
      statusEl.textContent='';
      const title = titleInput.value.trim();
      const url = urlInput.value.trim();
      if(!title || !url){ statusEl.textContent='Title and URL are required.'; return; }
      try{ new URL(url, location.href); }catch{ statusEl.textContent='Invalid URL.'; return; }
      feed.title = title;
      feed.url = url;
      feed.category = catInput.value.trim();
      const rm = parseInt(refreshInput.value,10); if(!isNaN(rm) && rm>=5) feed.refreshMinutes = rm; else delete feed.refreshMinutes;
      saveState();
      statusEl.textContent='Saved.';
      renderSubscriptionsList();
      setTimeout(()=>{ back(); }, 300);
    }, { once:true });
    form.querySelector('[data-action="cancel"]').addEventListener('click', back, { once:true });
  }

  // ---------- Removal / Purge ----------
  async function removeSubscription(feedId){
    const feed = state.feeds.find(f=> f.id===feedId);
    state.feeds = state.feeds.filter(f=> f.id!==feedId);
    // Purge posts for this feed
    for(const [pid,p] of Object.entries(posts)){
      if(p.feedId === feedId){ delete posts[pid]; delete state.read[pid]; delete state.favorites[pid]; if(state.autoTags) delete state.autoTags[pid]; }
    }
    delete state.lastFetch[feedId];
    const lastUrl = state.lastFetchUrl?.[feedId];
    delete state.lastFetchUrl[feedId];
    saveState();
    // Attempt cache cleanup (best effort, non-blocking UI)
    try{
      if(typeof caches !== 'undefined'){
        const cache = await caches.open('feedcycle-cache-v2');
        if(feed?.url){ await cache.delete(new Request(feed.url)); }
        if(lastUrl && lastUrl!==feed?.url){ await cache.delete(new Request(lastUrl)); }
      }
    }catch(e){ console.warn('Cache purge skipped', e); }
    // Refresh UI without re-fetching
    renderSubscriptionsList();
    renderArticles();
  }

  // ---------- Time / formatting helpers ----------
  function fmtDate(d){ if(!d) return ''; try{ return new Date(d).toLocaleString(); }catch{return '';} }
  function stripHtml(html){ return (html||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); }
  function computeReadingStats(post){
    const raw = stripHtml(post.content || post.summary || '');
    if(!raw){ return { words:0, minutes:0 }; }
    const words = raw.split(/\s+/).filter(Boolean).length;
    const minutes = words ? Math.max(1, Math.round(words/220)) : 0;
    return { words, minutes };
  }
  function esc(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&apos;'}[c])); }
  function safeHost(u){ try{ return new URL(u, location.href).hostname; }catch{ return ''; } }

  // ---------- Image / Placeholder Utilities ----------
  function isPrivateHost(host){
    if(!host) return true; host = host.toLowerCase();
    if(host==='localhost'||host==='::1') return true;
    if(/^127\./.test(host)) return true; if(/^10\./.test(host)) return true; if(/^192\.168\./.test(host)) return true;
    const m172=/^172\.(\d+)\./.exec(host); if(m172){ const o=Number(m172[1]); if(o>=16&&o<=31) return true; }
    return false;
  }
  function safeImageUrl(src){
    try{ if(!src) return null; const u=new URL(src, location.href); const prot=(u.protocol||'').toLowerCase();
      if(!(prot==='http:'||prot==='https:'||prot==='data:'||prot==='blob:')) return null;
      if((prot==='http:'||prot==='https:') && isPrivateHost(u.hostname)) return null;
      if(prot==='http:'){ try{ u.protocol='https:'; }catch{ return null; } }
      return u.href; }catch{ return null; }
  }
  function pickImage(post){
    // Priority 1: iTunes image (for podcasts, usually high quality)
    if(post.images?.length) {
      const itunesImg = post.images.find(img => img.source === 'itunes:image');
      if(itunesImg) return itunesImg.url;
    }

    // Priority 2: Media content/thumbnail with size preference (larger is better)
    if(post.images?.length) {
      const mediaImages = post.images.filter(img => 
        img.source === 'media:content' || img.source === 'media:thumbnail'
      );
      if(mediaImages.length) {
        // Sort by size (width * height), preferring larger images
        mediaImages.sort((a, b) => {
          const sizeA = (a.width || 0) * (a.height || 0);
          const sizeB = (b.width || 0) * (b.height || 0);
          return sizeB - sizeA; // Descending order
        });
        return mediaImages[0].url;
      }
    }

    // Priority 3: Traditional media array (enclosures, etc.)
    if(post.media){ 
      const m = post.media.find(m=> (m.type||'').startsWith('image/')); 
      if(m){ 
        const s=safeImageUrl(m.url); 
        if(s) return s; 
      } 
    }

    // Priority 4: Channel iTunes image (high quality for podcasts)
    if(post.images?.length) {
      const channelItunesImg = post.images.find(img => img.source === 'channel:itunes:image');
      if(channelItunesImg) return channelItunesImg.url;
    }

    // Priority 5: Other item-level image sources (enclosures, standard image tags)
    if(post.images?.length) {
      const otherItemImages = post.images.filter(img => 
        img.source !== 'itunes:image' && 
        img.source !== 'media:content' && 
        img.source !== 'media:thumbnail' &&
        !img.source.startsWith('channel:')
      );
      if(otherItemImages.length) return otherItemImages[0].url;
    }

    // Priority 6: Channel standard image (fallback for feeds without item-specific images)
    if(post.images?.length) {
      const channelImg = post.images.find(img => img.source === 'channel:image');
      if(channelImg) return channelImg.url;
    }

    // Priority 7: Images from content HTML
    const m = /<img[^>]+src=["']([^"']+)["']/i.exec(post.content||''); 
    if(m){ 
      const s=safeImageUrl(m[1]); 
      if(s) return s; 
    }

    // Priority 8: Open Graph image (if available in post metadata)
    if(post.ogImage) {
      const s = safeImageUrl(post.ogImage);
      if(s) return s;
    }

    return null;
  }

  // Enhanced async version that can attempt Open Graph extraction as fallback
  async function pickImageAsync(post) {
    const existingImage = pickImage(post);
    if (existingImage) return existingImage;
    
    // If no image found and we haven't tried Open Graph yet, attempt it
    if (post.ogImage === undefined && post.link) {
      const ogImage = await enhancePostWithOpenGraph(post);
      if (ogImage) return ogImage;
    }
    
    return null;
  }
  // Async function to enhance posts with Open Graph images (called when no other images found)
  async function enhancePostWithOpenGraph(post) {
    if (!post.link || post.ogImage !== undefined) return; // Skip if no link or already processed
    
    const ogImage = await extractOpenGraphImage(post.link);
    post.ogImage = ogImage; // Store result (null if not found) to prevent re-fetching
    
    return ogImage;
  }

  const placeholderCache = new Map();
  const PLACEHOLDER_VERSION = 2;
  function pickPlaceholder(post){
    const baseKey = post.id || hashId((post.title||'')+'|'+(post.link||''));
    const key = PLACEHOLDER_VERSION + ':' + baseKey;
    if(placeholderCache.has(key)) return placeholderCache.get(key);
    const dataUrl = generatePatternPlaceholder(key);
    placeholderCache.set(key,dataUrl); return dataUrl;
  }
  function h32(str){ let h=2166136261>>>0; for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,16777619);} return h>>>0; }
  function pickColors(seed){ const h1=seed%360; const h2=(h1+180+((seed>>7)%40)-20)%360; return [`hsl(${h1},65%,50%)`,`hsl(${h2},42%,18%)`]; }
  function generatePatternPlaceholder(key){
    const seed=h32(String(key)); const [fg,bg]=pickColors(seed); const type=['dots','squares','tri','stripes'][seed%4]; const size=80; let defs='',content='';
    if(type==='dots'){ defs=`<pattern id=p width=${size} height=${size} patternUnits=userSpaceOnUse><rect width=100% height=100% fill='${bg}'/><circle cx=${size/2} cy=${size/2} r=${Math.max(6,(seed%12)+6)} fill='${fg}'/></pattern>`; content=`<rect width=100% height=100% fill='url(#p)'/>`; }
    else if(type==='squares'){ defs=`<pattern id=p width=${size} height=${size} patternUnits=userSpaceOnUse><rect width=100% height=100% fill='${bg}'/><rect x=10 y=10 width=${size/2} height=${size/2} fill='${fg}' opacity=.8/></pattern>`; content=`<rect width=100% height=100% fill='url(#p)'/>`; }
    else if(type==='tri'){ defs=`<pattern id=p width=${size} height=${size} patternUnits=userSpaceOnUse><rect width=100% height=100% fill='${bg}'/><polygon points='0,${size} ${size/2},0 ${size},${size}' fill='${fg}' opacity=.8/></pattern>`; content=`<rect width=100% height=100% fill='url(#p)'/>`; }
    else { const angle=(seed%60)-30; defs=`<pattern id=p width=${size} height=${size} patternUnits=userSpaceOnUse patternTransform='rotate(${angle})'><rect width=100% height=100% fill='${bg}'/><rect y=0 width=${size/3} height=${size} fill='${fg}'/></pattern>`; content=`<rect width=100% height=100% fill='url(#p)'/>`; }
    const svg=`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 450' preserveAspectRatio='xMidYMid slice'><defs>${defs}</defs>${content}</svg>`;
    try{ const b64 = btoa(unescape(encodeURIComponent(svg))); return 'data:image/svg+xml;base64,'+b64; }catch{ return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg); }
  }
  // Inline placeholder (preferred for cards) + tiny PNG fallback
  function onePixelPng(){ return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4//8/AwAI/AL+7l+q8QAAAABJRU5ErkJggg=='; }
  function generateInlinePlaceholderSVG(post){
    try{
      const key = 'ph:' + (post.id||hashId((post.title||'')+'|'+(post.link||'')));
      const seed = h32(String(key));
      const [fg,bg] = pickColors(seed);
      const type=['dots','squares','tri','stripes'][seed%4];
      const size=80; let defs='';
      if(type==='dots') defs=`<pattern id="ph${seed}" width="${size}" height="${size}" patternUnits="userSpaceOnUse"><rect width="100%" height="100%" fill="${bg}"/><circle cx="${size/2}" cy="${size/2}" r="${Math.max(6,(seed%12)+6)}" fill="${fg}"/></pattern>`;
      else if(type==='squares') defs=`<pattern id="ph${seed}" width="${size}" height="${size}" patternUnits="userSpaceOnUse"><rect width="100%" height="100%" fill="${bg}"/><rect x="10" y="10" width="${size/2}" height="${size/2}" fill="${fg}" opacity=".8"/></pattern>`;
      else if(type==='tri') defs=`<pattern id="ph${seed}" width="${size}" height="${size}" patternUnits="userSpaceOnUse"><rect width="100%" height="100%" fill="${bg}"/><polygon points="0,${size} ${size/2},0 ${size},${size}" fill="${fg}" opacity=".8"/></pattern>`;
      else { const angle=(seed%60)-30; defs=`<pattern id="ph${seed}" width="${size}" height="${size}" patternUnits="userSpaceOnUse" patternTransform="rotate(${angle})"><rect width="100%" height="100%" fill="${bg}"/><rect y="0" width="${size/3}" height="${size}" fill="${fg}"/></pattern>`; }
      return `<svg class="ph" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" preserveAspectRatio="xMidYMid slice" role="img" aria-label="placeholder image"><defs>${defs}</defs><rect width="100%" height="100%" fill="url(#ph${seed})"/></svg>`;
    }catch{return ''}
  }

  // ---------- Media extraction helpers ----------
  function safeMediaUrl(src){
    try{
      if(!src) return null;
      const u = new URL(src, location.href);
      const prot = (u.protocol||'').toLowerCase();
      if(prot!=='http:' && prot!=='https:' && prot!=='data:' && prot!=='blob:') return null;
      if((prot==='http:'||prot==='https:') && isPrivateHost(u.hostname)) return null;
      return u.href;
    }catch{ return null; }
  }
  const AUDIO_EXTS = ['mp3','m4a','aac','ogg','oga','opus','wav','flac','mka','mpga'];
  const VIDEO_EXTS = ['mp4','m4v','mov','webm','mkv','avi','wmv','ogv'];
  const IMAGE_EXTS = ['jpg','jpeg','png','gif','webp','avif','svg'];
  function classifyMediaKind(type, url, medium){
    const t = (type||'').split(';')[0].trim().toLowerCase();
    let kind = '';
    if(t.startsWith('audio/')) kind='audio';
    else if(t.startsWith('video/')) kind='video';
    else if(t.startsWith('image/')) kind='image';
    else if(medium){
      const m = medium.toLowerCase();
      if(m.includes('audio')) kind='audio';
      else if(m.includes('video')) kind='video';
      else if(m.includes('image')) kind='image';
    }
    if(!kind && url){
      const cleanUrl = url.split('#')[0].split('?')[0];
      const extMatch = /\.([a-z0-9]+)$/i.exec(cleanUrl);
      const ext = extMatch? extMatch[1].toLowerCase() : '';
      if(AUDIO_EXTS.includes(ext)) kind='audio';
      else if(VIDEO_EXTS.includes(ext)) kind='video';
      else if(IMAGE_EXTS.includes(ext)) kind='image';
    }
    if(!kind) kind='file';
    const resolvedType = t || (kind==='audio'? 'audio/mpeg' : kind==='video'? 'video/mp4' : kind==='image'? 'image/jpeg' : '');
    return { kind, type: resolvedType };
  }
  function normalizeMediaEntry(raw){
    const url = safeMediaUrl(raw.url);
    if(!url) return null;
    const { kind, type } = classifyMediaKind(raw.type, url, raw.medium);
    const length = raw.length && /^[0-9]+$/.test(raw.length) ? parseInt(raw.length,10) : null;
    const duration = raw.duration && /^[0-9]+$/.test(raw.duration) ? parseInt(raw.duration,10) : null;
    return {
      url,
      type: (raw.type||'').split(';')[0].trim().toLowerCase() || type,
      kind,
      length,
      duration,
      title: raw.title||raw.label||'',
      medium: raw.medium||''
    };
  }
  function extractImageUrls(item){
    const images = [];
    const seen = new Set();
    const addImage = (url, source, width, height) => {
      if(!url || seen.has(url)) return;
      const safeUrl = safeImageUrl(url);
      if(!safeUrl) return;
      seen.add(url);
      images.push({ url: safeUrl, source, width: width ? parseInt(width) : null, height: height ? parseInt(height) : null });
    };

    // Try multiple approaches for namespace handling since different browsers/parsers handle it differently
    
    // iTunes namespace images (podcasts) - try both approaches
    let itunesImage = item.querySelector('itunes\\:image') || item.getElementsByTagName('itunes:image')[0];
    if(itunesImage) {
      const href = itunesImage.getAttribute('href');
      if(href) addImage(href, 'itunes:image');
    }

    // Media namespace thumbnails (BBC, Yahoo, etc.) - try both approaches
    let mediaThumbs = item.querySelectorAll('media\\:thumbnail');
    if(mediaThumbs.length === 0) {
      mediaThumbs = item.getElementsByTagName('media:thumbnail');
    }
    Array.from(mediaThumbs).forEach(thumb => {
      const url = thumb.getAttribute('url');
      const width = thumb.getAttribute('width');
      const height = thumb.getAttribute('height');
      if(url) addImage(url, 'media:thumbnail', width, height);
    });

    // Media namespace content with image types - try both approaches
    let mediaContent = item.querySelectorAll('media\\:content');
    if(mediaContent.length === 0) {
      mediaContent = item.getElementsByTagName('media:content');
    }
    Array.from(mediaContent).forEach(content => {
      const url = content.getAttribute('url');
      const type = content.getAttribute('type');
      const medium = content.getAttribute('medium');
      const width = content.getAttribute('width');
      const height = content.getAttribute('height');
      if(url && (type?.startsWith('image/') || medium === 'image')) {
        addImage(url, 'media:content', width, height);
      }
    });

    // Standard enclosure images
    item.querySelectorAll('enclosure').forEach(enc => {
      const url = enc.getAttribute('url');
      const type = enc.getAttribute('type');
      if(url && type?.startsWith('image/')) {
        addImage(url, 'enclosure');
      }
    });

    // Standard image elements  
    const imageEl = item.querySelector('image url');
    if(imageEl) {
      addImage(imageEl.textContent?.trim(), 'image');
    }

    return images;
  }

  function extractMediaEntries(item){
    const entries = [];
    const seen = new Set();
    const push = raw=>{
      const normal = normalizeMediaEntry(raw);
      if(!normal) return;
      if(seen.has(normal.url)) return;
      seen.add(normal.url);
      entries.push(normal);
    };
    item.querySelectorAll('enclosure').forEach(en=>{
      push({
        url: en.getAttribute('url'),
        type: en.getAttribute('type'),
        length: en.getAttribute('length'),
        title: en.getAttribute('title')||en.getAttribute('label'),
        medium: en.getAttribute('medium')
      });
    });
    item.querySelectorAll('link[rel="enclosure"]').forEach(link=>{
      push({
        url: link.getAttribute('href'),
        type: link.getAttribute('type'),
        length: link.getAttribute('length'),
        title: link.getAttribute('title')||link.getAttribute('label'),
        medium: link.getAttribute('medium')
      });
    });
    item.querySelectorAll('media\\:content, media\\:group > media\\:content, content').forEach(node=>{
      const url = node.getAttribute('url') || node.getAttribute('href') || node.getAttribute('src');
      if(!url) return;
      push({
        url,
        type: node.getAttribute('type'),
        length: node.getAttribute('fileSize')||node.getAttribute('length'),
        duration: node.getAttribute('duration'),
        title: node.getAttribute('label')||node.getAttribute('title'),
        medium: node.getAttribute('medium')
      });
    });
    item.querySelectorAll('audio, video').forEach(node=>{
      const url = node.getAttribute('src');
      if(!url) return;
      push({ url, type: node.getAttribute('type'), medium: node.tagName.toLowerCase(), title: node.getAttribute('title') });
    });
    return entries;
  }
  function parseFeedDocument(doc, feed){
    const isAtom = !!doc.querySelector('feed > entry');
    const items = isAtom? [...doc.querySelectorAll('feed > entry')] : [...doc.querySelectorAll('rss channel item')];
    
    // Extract channel-level images that can be used as fallbacks for individual items
    const channelImages = extractChannelImages(doc);
    
    return items.map(it=>{
      const title = (it.querySelector('title')?.textContent||'').trim();
      // canonical link from RSS/Atom
      let link = isAtom ? (it.querySelector('link[rel="alternate"]')?.getAttribute('href') || it.querySelector('link')?.getAttribute('href') || '') : (it.querySelector('link')?.textContent||'');
      const content = isAtom ? (it.querySelector('content')?.textContent || it.querySelector('summary')?.textContent || '') : (it.querySelector('description')?.textContent||'');
      // If link is missing or looks like it merely points to the feed/site, try to find an <a href="..."> inside the content/description
      try{
        const contentHtml = content || '';
        if(!link || (feed && feed.url && safeHost(link) === safeHost(feed.url))){
          // Create a DOMParser to look for the first anchor in the HTML fragment
          const dp = new DOMParser();
          const doc = dp.parseFromString(contentHtml, 'text/html');
          const a = doc.querySelector('a[href]');
          if(a){
            const href = a.getAttribute('href') || '';
            if(href && href.trim()) link = href.trim();
          }
        }
      }catch(e){ /* ignore parse failures and keep existing link */ }
      const guidSrc = isAtom ? (it.querySelector('id')?.textContent || link || title) : (it.querySelector('guid')?.textContent || link || title);
      const id = hashId((feed.id||'')+'|'+guidSrc);
      const published = it.querySelector('pubDate, updated, published')?.textContent||'';
      const media = extractMediaEntries(it);
      const images = extractImageUrls(it);
      
      // Combine item-specific images with channel images as fallbacks
      const allImages = [...images, ...channelImages];
      
      return {
        id,
        feedId: feed.id,
        title,
        link,
        content,
        summary: stripHtml(content).slice(0,400),
        published,
        media,
        images: allImages
      };
    });
  }

  async function extractOpenGraphImage(articleUrl) {
    if (!articleUrl) return null;
    
    try {
      // Use the same proxy/fetch system as feeds for CORS handling
      const candidates = getProxyCandidates();
      let html = '';
      let lastErr = null;
      
      for (const c of candidates.slice(0, 2)) { // Limit to 2 proxy attempts for performance
        const proxied = buildProxiedUrl(articleUrl, c);
        try {
          html = await fetchWithCache(proxied);
          if (html) break;
        } catch (e) {
          lastErr = e;
          // Silently handle common CORS/403 errors for Open Graph fetching
          if (typeof c !== 'string') {
            recordProxyResult(c.name, false);
          }
          // Don't log 403/CORS errors for Open Graph - they're expected
          if (!e.message?.includes('403') && !e.message?.includes('CORS')) {
            console.warn('[Feed Cycle] Open Graph proxy attempt failed:', e.message);
          }
        }
      }
      
      if (!html) {
        try {
          html = await fetchWithCache(articleUrl);
        } catch (e) {
          lastErr = e;
          // Don't log direct fetch errors for Open Graph - they're expected for many sites
        }
      }
      
      if (!html) return null;
      
      // Parse HTML to extract Open Graph image
      const ogImageMatch = /<meta\s+property\s*=\s*["']og:image["']\s+content\s*=\s*["']([^"']+)["']/i.exec(html);
      if (ogImageMatch) {
        const ogImageUrl = ogImageMatch[1];
        return safeImageUrl(ogImageUrl);
      }
      
      return null;
    } catch (e) {
      console.warn('Failed to extract Open Graph image from', articleUrl, e);
      return null;
    }
  }

  function extractChannelImages(doc){
    const images = [];
    const seen = new Set();
    const addImage = (url, source) => {
      if(!url || seen.has(url)) return;
      const safeUrl = safeImageUrl(url);
      if(!safeUrl) return;
      seen.add(url);
      images.push({ url: safeUrl, source });
    };

    const isAtom = !!doc.querySelector('feed > entry');
    const channelSelector = isAtom ? 'feed' : 'channel';

    // Standard RSS/Atom channel image
    const channelImageUrl = doc.querySelector(`${channelSelector} > image > url`);
    if(channelImageUrl) {
      addImage(channelImageUrl.textContent?.trim(), 'channel:image');
    }

    // iTunes channel image - try both selector approaches
    let itunesChannelImage = doc.querySelector(`${channelSelector} > itunes\\:image`) || 
                           doc.querySelector(`${channelSelector}`).getElementsByTagName('itunes:image')[0];
    if(itunesChannelImage) {
      const href = itunesChannelImage.getAttribute('href');
      if(href) addImage(href, 'channel:itunes:image');
    }

    return images;
  }

  function extractFeedTitle(doc){
    const node = doc.querySelector('feed > title') || doc.querySelector('channel > title');
    if(!node) return '';
    const text = node.textContent||'';
    return text.replace(/\s+/g,' ').trim();
  }

  // ---------- Basic Feed Refresh (placeholder) ----------
  async function refreshAll(force=false){
    const usedProxies = new Set();
    for(const f of state.feeds){
      const rateLimit = getFeedRateLimit(f.id);
      if(rateLimit){
        console.info('Feed refresh skipped due to backoff', f.url, Math.ceil(rateLimit.retryIn/1000)+'s');
        continue;
      }
      try{
        await refreshFeed(f, { force, usedProxies });
        state.lastFetch[f.id]=Date.now();
      }catch(e){ console.warn('Feed fail', f.url, e); }
    }
    saveState(); renderArticles();
    if(usedProxies.size){ console.log('[FeedCycle v2] Proxies used:', [...usedProxies].join(', ')); }
  }
  async function refreshFeed(feed, { force=false, usedProxies=new Set() }={}){
    const activeRateLimit = getFeedRateLimit(feed.id);
    if(activeRateLimit){
      const err = new Error('Rate limit active');
      err.code = 'RATE_LIMIT';
      err.retryIn = activeRateLimit.retryIn;
      throw err;
    }
    const candidates = getProxyCandidates();
    let xml=''; let lastErr=null; let used=null; let usedUrl=null;
    for(const c of candidates){
      if(typeof c !== 'string'){
        const until = proxyTempDisabledUntil.get(c.name)||0; if(until && Date.now()<until) continue;
      }
      const proxied = buildProxiedUrl(feed.url, c);
      for(let attempt=0; attempt<2; attempt++){
        const url = attempt? addCacheBuster(proxied) : proxied;
        try{
          let text = await fetchWithCache(url);
          if(xmlHasParserError(text)){
            const extracted = maybeExtractXmlFromJson(text); if(extracted) text = extracted;
          }
          if(xmlHasParserError(text)) throw new Error('XML parse error');
          xml = text; used = (typeof c==='string')?'Manual':c.name; usedUrl=url; break;
        }catch(e){
          lastErr = e;
          if(typeof c !== 'string'){
            recordProxyResult(c.name, false);
            const msg = String(e && e.message || e || '');
            if(/HTTP 429|HTTP 5\d\d/.test(msg) || /Failed to fetch|TypeError|NetworkError|ERR_/i.test(msg)){
              proxyTempDisabledUntil.set(c.name, Date.now()+PROXY_DISABLE_MS/2); // shorter initial cooldown
            }
          }
        }
      }
      if(used) break;
    }
    if(!used){
      try{ xml = await fetchWithCache(feed.url); if(xmlHasParserError(xml)) throw new Error('XML parse error'); used='Direct'; usedUrl=feed.url; }
      catch(e){ lastErr=e; }
    }
    if(!used){
      if(lastErr && /HTTP 429/.test(lastErr.message||'')){
        const penalty = applyFeedRateLimit(feed.id);
        const err = new Error(`HTTP 429 (retry in ${penalty? Math.ceil(penalty.delay/1000)+'s' : 'later'})`);
        err.code = 'RATE_LIMIT';
        err.retryIn = penalty?.delay || RATE_LIMIT_BACKOFF_BASE_MS;
        throw err;
      }
      throw lastErr || new Error('Failed to fetch feed');
    }
  if(used && used!=='Manual' && used!=='Direct'){ recordProxyResult(used, true); }
    if(used) usedProxies.add(used);
    state.lastFetchUrl[feed.id] = usedUrl;
  clearFeedRateLimit(feed.id);
    // Parse & merge posts
    const doc = new DOMParser().parseFromString(xml,'text/xml');
    const updatedTitle = extractFeedTitle(doc);
    let feedTitleChanged = false;
    if(updatedTitle && updatedTitle !== feed.title){
      feed.title = updatedTitle;
      feedTitleChanged = true;
    }
    const parsedPosts = parseFeedDocument(doc, feed);
    for(const post of parsedPosts){
      const id = post.id;
      const merged = posts[id] = Object.assign(posts[id]||{}, post, { read: !!state.read[id], favorite: !!state.favorites[id] });
      if(applyMediaAutoTags(merged)){
        updateCardTags(id);
      }
    }
    if(feedTitleChanged){
      renderSubscriptionsList();
    }
  }

  // ---------- Startup Hydration & Selective Refresh ----------
  async function hydrateFromCacheThenSelectiveRefresh(){
    try{ await hydrateFromCache(); }catch{}
    renderArticles();
    const now = Date.now();
    const globalInt = (state.settings.refreshMinutes||30)*60*1000;
    // Build list of feeds needing refresh
    const stale = state.feeds.filter(f=>{
      const last = state.lastFetch[f.id]||0;
      const interval = (f.refreshMinutes||state.settings.refreshMinutes||30)*60*1000;
      return now - last >= interval;
    });
    if(!stale.length) return; // all fresh
    for(const f of stale){
      const rateLimit = getFeedRateLimit(f.id);
      if(rateLimit){
        console.info('Initial refresh skipped (rate limit)', f.url, Math.ceil(rateLimit.retryIn/1000)+'s');
        continue;
      }
      try{ await refreshFeed(f, { usedProxies:new Set() }); state.lastFetch[f.id]=Date.now(); }
      catch(e){ console.warn('Initial selective refresh failed', f.url, e); }
    }
    saveState();
    renderArticles();
  }

  async function hydrateFromCache(){
    if(typeof caches === 'undefined') return;
    try{
      const cache = await caches.open('feedcycle-cache-v2');
      let updatedAnyTitle = false;
      for(const f of state.feeds){
        const url = state.lastFetchUrl?.[f.id] || f.url;
        if(!url) continue;
        const res = await cache.match(new Request(url));
        if(!res) continue;
        let text = await res.text();
        if(xmlHasParserError(text)){ const extracted = maybeExtractXmlFromJson(text); if(extracted) text = extracted; }
        if(xmlHasParserError(text)) continue;
        const doc = new DOMParser().parseFromString(text,'text/xml');
        const title = extractFeedTitle(doc);
        if(title && title !== f.title){
          f.title = title;
          updatedAnyTitle = true;
        }
        const parsedPosts = parseFeedDocument(doc, f);
        for(const post of parsedPosts){
          const id = post.id;
          const merged = posts[id] = Object.assign(posts[id]||{}, post, { read: !!state.read[id], favorite: !!state.favorites[id] });
          if(applyMediaAutoTags(merged)){
            updateCardTags(id);
          }
        }
      }
      if(updatedAnyTitle){
        renderSubscriptionsList();
      }
    }catch(e){ console.warn('Hydrate from cache failed', e); }
  }

  // ---------- Data Actions ----------
  function handleDataAction(action){
    if(action==='import-opml'){ byId('opmlFile').click(); }
    if(action==='export-opml'){ exportOPML(); }
    if(action==='add-sample'){ importOPMLText(SAMPLE_OPML); refreshAll(true); }
    if(action==='clear-cache'){ /* ephemeral -> nothing yet */ alert('Cache cleared (ephemeral stage).'); }
    if(action==='erase-all'){ if(confirm('Erase all data?')){ localStorage.removeItem(LS_KEY); state = {...DEFAULTS, theme: state.theme}; posts={}; backStack.length=0; while(stackEl.firstChild) stackEl.removeChild(stackEl.firstChild); showPanel('articlesInfiniteScrollable'); } }
  }

  // ---------- OPML ----------
  function importOPMLText(xml){
    const doc = new DOMParser().parseFromString(xml,'text/xml');
    const outlines = [...doc.querySelectorAll('outline[xmlUrl]')];
    const list = outlines.map(o=>({ id: hashId(o.getAttribute('xmlUrl')), url:o.getAttribute('xmlUrl'), title:o.getAttribute('text')||o.getAttribute('title')||o.getAttribute('xmlUrl'), category:o.getAttribute('category')||'' }));
    const map = new Map(state.feeds.map(f=> [f.url,f]));
    for(const f of list){ map.set(f.url, {...map.get(f.url), ...f}); }
    state.feeds = [...map.values()].sort((a,b)=> (a.category||'').localeCompare(b.category||'') || (a.title||'').localeCompare(b.title||''));
    saveState();
  }
  function exportOPML(){
    const body = state.feeds.map(f=>`    <outline type="rss" text="${escXml(f.title||f.url)}" xmlUrl="${escXml(f.url)}" ${f.category?`category="${escXml(f.category)}"`:''} />`).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>Feed Cycle Subscriptions</title></head>\n  <body>\n${body}\n  </body>\n</opml>`;
    download('feedcycle-subscriptions.opml', xml, 'text/xml');
  }
  function escXml(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function download(name, content, type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1200); }

  // ---------- Sanitizer (minimal) ----------
  function sanitizeHtml(html){ const t=document.createElement('div'); t.innerHTML=html||''; t.querySelectorAll('script,style,iframe,object,embed').forEach(n=>n.remove()); t.querySelectorAll('*').forEach(n=>{ [...n.attributes].forEach(a=>{ if(!['href','src','alt','title'].includes(a.name)) n.removeAttribute(a.name); }); if(n.nodeName==='A'){ n.setAttribute('target','_blank'); n.setAttribute('rel','noopener noreferrer'); } }); return t.innerHTML; }

  // ---------- Infinite Scroll (basic incremental) ----------
  function setupInfiniteScroll(panel){
    const list = panel.querySelector('#articlesList'); if(!list) return;
    const scrollFrame = panel.querySelector('.panel-body') || panel; // use panel-body if present
    list._scrollFrame = scrollFrame;
    if(scrollFrame._infHandler){ scrollFrame.removeEventListener('scroll', scrollFrame._infHandler); }
    function ensure(){
      if(!lastFilteredPosts.length) return;
      let guard = 6;
      while(guard-- > 0){
        const viewportBottom = scrollFrame.scrollTop + scrollFrame.clientHeight + 480;
        if(viewportBottom < scrollFrame.scrollHeight) break;
        if(!renderNextArticleChunk(list, CHUNK_SIZE)) break;
      }
    }
    scrollFrame._infHandler = ensure;
    scrollFrame.addEventListener('scroll', ensure, { passive:true });
    ensureArticleListFilled(list);
  }

  // ---------- Media Player (variable skip cue) ----------
  const mp = { audio: new Audio(), cue:{ dragging:false, lastSkip:0, pendingInterval:null }, current:null, elements:{}, mediaEl:null, boundEl:null, lastAudioState:null };
  mp.audio.preload = 'metadata';
  function initMediaPlayer(){
    const mpEl = byId('media-player');
    const playBtn = byId('mp-play');
    const pauseBtn = byId('mp-pause');
    const downloadBtn = byId('mp-download');
    const favBtn = byId('mp-fav');
    const prog = byId('mp-progress');
    const timeEl = byId('mp-time');
    const cueBtn = byId('cueBtn');
    const cueTrack = byId('cueTrack');
    // No inline track label — keep top controls compact. We'll repurpose favBtn as "View article" when media is active.
    const openCurrentArticle = ()=>{
      const current = mp.current;
      if(!current) return;
      const postId = current.postId || current.post?.id;
      let post = current.post || (postId ? posts[postId] : null);
      if(!post && postId && posts[postId]){
        post = posts[postId];
      }
      const top = stackEl.lastElementChild;
      if(top?.dataset.panel === 'articleViewer'){
        const panelBody = top.querySelector('.panel-body');
        const articleBody = top.querySelector('#articleBody');
        if(articleBody && articleBody.dataset.postId === String(postId||'')){
          if(!articleBody.children.length && post){
            renderArticleViewer(post);
          }
          if(panelBody?.scrollTo){ panelBody.scrollTo({ top:0, behavior:'smooth' }); }
          else if(panelBody){ panelBody.scrollTop = 0; }
          const heading = top.querySelector('.article-title');
          heading?.focus?.();
          return;
        }
      }
      if(post){
        showPanel('articleViewer', { data: post });
      }
    };
  // repurpose favBtn (now a view-article button)
  favBtn.addEventListener('click', openCurrentArticle);
  Object.assign(mp.elements, { playBtn, pauseBtn, downloadBtn, favBtn, progress:prog, time:timeEl, toolbar: mpEl });
    playBtn.disabled = true;
    pauseBtn.disabled = true;
    downloadBtn.disabled = true;
    favBtn.disabled = true;
    const favUse = byId('favIconUse');
    function fmtTime(sec){ if(!isFinite(sec)) return '0:00'; const m=Math.floor(sec/60); const s=Math.floor(sec%60); return m+':' + String(s).padStart(2,'0'); }
    function getMedia(){ return mp.mediaEl; }
    function clearProgress(){ if(prog){ prog.value = 0; } timeEl.textContent = fmtTime(0); }
    function syncPlaybackButtons(){
      const media = getMedia();
      const hasTrack = !!mp.current && !!media;
      if(!hasTrack){
        playBtn.disabled = true;
        pauseBtn.disabled = true;
        return;
      }
      if(media.paused){
        playBtn.disabled = false;
        pauseBtn.disabled = true;
      } else {
        playBtn.disabled = true;
        pauseBtn.disabled = false;
      }
    }
    const mediaHandlers = {
      play(){ syncPlaybackButtons(); },
      pause(){ syncPlaybackButtons(); },
      ended(){ syncPlaybackButtons(); },
      timeupdate(){
        const media = getMedia();
        if(!prog || !media) return;
        const ratio = media.duration ? (media.currentTime/media.duration) : 0;
        prog.value = clamp(ratio, 0, 1);
        timeEl.textContent = fmtTime(media.currentTime);
        if(mp.current?.kind==='audio'){
          mp.lastAudioState = { ...mp.current, position: media.currentTime, wasPlaying: !media.paused };
        }
      },
      loadedmetadata(){
        if(prog) prog.max = 1;
        const media = getMedia();
        timeEl.textContent = fmtTime(media?.currentTime || 0);
        updateMediaToolbar();
        syncPlaybackButtons();
      },
      emptied(){ clearProgress(); }
    };
    function bindMediaElement(el){
      if(mp.boundEl === el) return;
      if(mp.boundEl){
        for(const [evt, handler] of Object.entries(mediaHandlers)){
          mp.boundEl.removeEventListener(evt, handler);
        }
      }
      mp.boundEl = el || null;
      mp.mediaEl = el || null;
      if(el){
        for(const [evt, handler] of Object.entries(mediaHandlers)){
          el.addEventListener(evt, handler);
        }
      } else {
        clearProgress();
      }
      syncPlaybackButtons();
    }
    bindMediaElement(mp.audio);
    mp.bindMediaElement = bindMediaElement;
    mp.syncPlaybackButtons = syncPlaybackButtons;
  if(shouldUseCrossOrigin(mp.audio?.src)) mp.audio.crossOrigin='anonymous';
  mp.audio.addEventListener('error', handleMediaErrorEvent);
    playBtn.addEventListener('click', ()=>{
      const media = getMedia();
      if(!mp.current || !media) return;
      media.play().catch(err=> console.warn('Playback resume blocked', err));
    });
    pauseBtn.addEventListener('click', ()=>{
      const media = getMedia();
      if(media) media.pause();
    });
    downloadBtn.addEventListener('click', ()=>{
      if(!mp.current) return;
      window.open(mp.current.media.url, '_blank', 'noopener');
    });
    favBtn.addEventListener('click', ()=>{
      if(!mp.current) return;
      toggleFavorite(mp.current.postId);
      updateMediaFavoriteState();
    });
    // Variable skip logic
    let originX=0;
    function computeSkip(pxDist){
      const dir = Math.sign(pxDist)||0; const d = Math.abs(pxDist);
      const anchors = [
        [0,0],
        [120,4],
        [300,15],
        [600,60],
        [1000,240]
      ];
      let seconds;
      if(d >= 1000){
        const excess = d - 1000;
        const remain = 900 - 240;
        seconds = 240 + remain * (1 - Math.exp(-excess/400));
      } else {
        for(let i=0;i<anchors.length-1;i++){
          const [dx1,s1] = anchors[i];
          const [dx2,s2] = anchors[i+1];
          if(d >= dx1 && d <= dx2){
            const t = (d - dx1)/(dx2 - dx1);
            const tt = t*t*(3-2*t);
            seconds = s1 + (s2 - s1)*tt;
            break;
          }
        }
      }
      if(seconds==null) seconds = 0;
      seconds = Math.min(900, seconds);
      return dir * Math.round(seconds);
    }
    function applySkip(deltaSeconds){
      if(!deltaSeconds) return;
      const media = getMedia();
      if(!media) return;
      const dur = media.duration||0;
      if(!dur) return;
      let t = media.currentTime + deltaSeconds;
      t = clamp(t, 0, dur);
      media.currentTime = t;
    }
    const REPEAT_INTERVAL_MS = 750;
    function updateVisual(px){
      const skip = computeSkip(px);
      cueBtn.style.setProperty('--dx', px+'px');
      return skip;
    }
    function resetCue(){ cueBtn.classList.remove('dragging'); cueTrack.classList.remove('dragging'); cueBtn.style.removeProperty('--dx'); }
    function endDrag(finalPx){
      const skip = computeSkip(finalPx);
      if(skip) applySkip(skip);
      clearInterval(mp.cue.pendingInterval); mp.cue.pendingInterval=null;
      resetCue();
    }
    cueBtn.addEventListener('pointerdown', e=>{
      const media = getMedia();
      if(!mp.current || !media) return;
      e.preventDefault(); cueBtn.focus(); originX = e.clientX; cueBtn.classList.add('dragging'); cueTrack.classList.add('dragging');
      cueBtn.style.removeProperty('--dx');
      let lastVisual=0;
      const move = ev=>{ const dx = ev.clientX - originX; lastVisual = dx; const s = updateVisual(dx); if(mp.cue.pendingInterval) return; if(Math.abs(s)>=1){
        mp.cue.pendingInterval = setInterval(()=>{ const s2=computeSkip(lastVisual); applySkip(s2); }, REPEAT_INTERVAL_MS); }
      };
      const up = ev=>{ window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',up); endDrag(ev.clientX-originX); };
      window.addEventListener('pointermove',move); window.addEventListener('pointerup',up);
    });
    cueBtn.addEventListener('keydown', e=>{
      const media = getMedia();
      if(!mp.current || !media) return;
      const base= (e.shiftKey?60:10);
      if(e.key==='ArrowLeft'){ e.preventDefault(); applySkip(-base); }
      if(e.key==='ArrowRight'){ e.preventDefault(); applySkip(base); }
      if(e.key==='Escape'){ resetCue(); }
      if(e.key==='Enter' || e.key===' '){ e.preventDefault(); if(media.paused) media.play(); else media.pause(); }
    });
    function updateMediaToolbar(){
      const hasTrack = !!mp.current;
      if(!hasTrack){
        // compact state when nothing playing
        downloadBtn.disabled = true;
        favBtn.disabled = true; // view-article disabled
        syncPlaybackButtons();
        return;
      }
      const { media, title, host, post, postId } = mp.current;
      const postRef = post || (postId ? posts[postId] : null);
      downloadBtn.disabled = false;
      downloadBtn.title = `Download ${title}`;
      downloadBtn.setAttribute('aria-label', `Download ${title}`);
      // enable view-article button only when we have a post reference
      favBtn.disabled = !postRef;
      if(postRef){ favBtn.title = postRef.title ? `View “${postRef.title}”` : 'View article'; favBtn.setAttribute('aria-label', favBtn.title); }
      syncPlaybackButtons();
    }
    function updateMediaFavoriteState(){
      // retained API but now a no-op (favourites handled in article UI)
      return;
    }
    mp.updateToolbar = updateMediaToolbar;
    mp.updateFavorite = updateMediaFavoriteState;
  }

  // ---------- Misc ----------
  function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

  // ---------- File input (OPML) ----------
  byId('opmlFile').addEventListener('change', async (e)=>{ const f=e.target.files[0]; if(!f) return; const txt=await f.text(); importOPMLText(txt); renderArticles(); });

  // ---------- Theme toggle ----------
  byId('btn-theme').addEventListener('click', ()=>{ const order=['system','light','dark']; const i=order.indexOf(state.theme||'system'); state.theme=order[(i+1)%order.length]; saveState(); applyTheme(); });

  // ---------- Keyboard nav ----------
  window.addEventListener('keydown', e=>{ if(e.key==='Escape'){ if(backStack.length){ history.back(); } else back(); } });
  window.addEventListener('popstate', (e)=>{
    // If we have internal stack, perform back; else no-op letting initial state remain
    if(backStack.length){
      back();
      // After returning from article, restore scroll
      restoreArticlesScroll();
    }
  });

  // ---------- Samples ----------
  const SAMPLE_OPML = `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>Sample Feeds</title></head>\n  <body>\n    <outline text="BBC World" type="rss" xmlUrl="https://feeds.bbci.co.uk/news/world/rss.xml" category="News"/>\n    <outline text="NASA Image of the Day" type="rss" xmlUrl="https://www.nasa.gov/rss/dyn/lg_image_of_the_day.rss" category="Space"/>\n    <outline text="Hacker News" type="rss" xmlUrl="https://news.ycombinator.com/rss" category="Tech"/>\n    <outline text="The Verge" type="rss" xmlUrl="https://www.theverge.com/rss/index.xml" category="Tech"/>\n    <outline text="David Bombal Tech" type="rss" xmlUrl="https://www.youtube.com/feeds/videos.xml?channel_id=UCZTIRrENWr_rjVoA7BcUE_A" category="Tech"/>\n    <outline text="3Blue1Brown" type="rss" xmlUrl="https://www.youtube.com/feeds/videos.xml?channel_id=UCYO_jab_esuFRV4b17AJtAw" category="Tech"/>\n    <outline text="Syntax FM" type="rss" xmlUrl="https://feed.syntax.fm/rss" category="Podcasts"/>\n    <outline text="Darknet Diaries" type="rss" xmlUrl="https://podcast.darknetdiaries.com/" category="Podcasts"/>\n    <outline text="Risky Business" type="rss" xmlUrl="https://risky.biz/feeds/risky-business" category="Podcasts"/>\n    <outline text="Risky Business News" type="rss" xmlUrl="https://risky.biz/feeds/risky-business-news" category="Podcasts"/>\n    <outline text="BleepingComputer" type="rss" xmlUrl="https://www.bleepingcomputer.com/feed/" category="Tech"/>\n    <outline text="The Lovecraft Investigations" type="rss" xmlUrl="https://podcasts.files.bbci.co.uk/p06spb8w.rss" category="Podcasts"/>\n    <outline text="Graham Cluley" type="rss" xmlUrl="https://grahamcluley.com/feed/" category="Tech"/>\n    <!-- Bylines Network -->\n    <outline text="Bylines Cymru" type="rss" xmlUrl="https://bylines.cymru/feed/" category="Bylines"/>\n    <outline text="Bylines Scotland" type="rss" xmlUrl="https://bylines.scot/feed/" category="Bylines"/>\n    <outline text="Central Bylines" type="rss" xmlUrl="https://centralbylines.co.uk/feed/" category="Bylines"/>\n    <outline text="East Anglia Bylines" type="rss" xmlUrl="https://eastangliabylines.co.uk/feed/" category="Bylines"/>\n    <outline text="Kent and Surrey Bylines" type="rss" xmlUrl="https://kentandsurreybylines.co.uk/feed/" category="Bylines"/>\n    <outline text="North East Bylines" type="rss" xmlUrl="https://northeastbylines.co.uk/feed/" category="Bylines"/>\n    <outline text="North West Bylines" type="rss" xmlUrl="https://northwestbylines.co.uk/feed/" category="Bylines"/>\n    <outline text="Sussex Bylines" type="rss" xmlUrl="https://sussexbylines.co.uk/feed/" category="Bylines"/>\n    <outline text="West England Bylines" type="rss" xmlUrl="https://westenglandbylines.co.uk/feed/" category="Bylines"/>\n    <outline text="Yorkshire Bylines" type="rss" xmlUrl="https://yorkshirebylines.co.uk/feed/" category="Bylines"/>\n+    <outline text="Byline Podcast" type="rss" xmlUrl="https://podcasts.apple.com/gb/podcast/byline-podcast/id1747192337" category="Podcasts"/>\n  </body>\n</opml>`;

  // ---------- Init ----------
  function start(){
    applyTheme();
    initMediaPlayer();
    function computeStackOffset(){
      const header = document.querySelector('.fc-header');
      const mpEl = document.getElementById('media-player');
      const h = (header? header.getBoundingClientRect().height:0) + (mpEl? mpEl.getBoundingClientRect().height:0);
      document.documentElement.style.setProperty('--stackOffset', h+'px');
    }
    computeStackOffset();
    window.addEventListener('resize', debounce(computeStackOffset, 150));
    // Seed initial history state
    try{ history.replaceState({ panel:'articlesInfiniteScrollable', ts:Date.now() }, '', '#articles'); }catch{}
    showPanel('articlesInfiniteScrollable'); // default panel (adds one entry)
    // Initial hydration: attempt to load from Cache API (best effort) and only refresh stale feeds
    if(state.feeds.length){
      hydrateFromCacheThenSelectiveRefresh();
    }
    // Settings button brings up settings main panel (push stack)
    byId('btn-settings').onclick = ()=> showPanel('settingsMain');
    // Clicking the app title resets filters/search/sort and returns to the main articles list
    const appTitleEl = document.querySelector('.app-title');
    if(appTitleEl){
      appTitleEl.style.cursor = 'pointer';
      appTitleEl.addEventListener('click', ()=>{
        // reset runtime filters
        Object.assign(currentFilters, { ...FILTER_DEFAULTS, tagList: [] });
        // if filter panel is open, repopulate its form if present
        const filterPanel = stackEl.querySelector('[data-panel="filterAndSortSettings"]');
        const form = filterPanel?.querySelector('#filterForm') || document.querySelector('#filterForm');
        if(form) populateFilters(form);
        // navigate to default panel and reset history fragment
        try{ history.replaceState({ panel:'articlesInfiniteScrollable', ts:Date.now() }, '', '#articles'); }catch{}
        showPanel('articlesInfiniteScrollable');
      });
    }
    // Scheduled refresh loop
    setInterval(()=>{
      const now = Date.now();
      const globalInt = (state.settings.refreshMinutes||30)*60*1000;
      state.feeds.forEach(f=>{
        const last = state.lastFetch[f.id]||0;
        const interval = (f.refreshMinutes||state.settings.refreshMinutes||30)*60*1000;
        if(now - last >= interval){
          const rateLimit = getFeedRateLimit(f.id);
          if(rateLimit){
            return;
          }
          refreshFeed(f).then(()=>{ state.lastFetch[f.id]=Date.now(); saveState(); renderArticles(); }).catch(e=> console.warn('Scheduled refresh fail', f.url, e));
        }
      });
    }, 60*1000); // check every minute
  }
  document.addEventListener('DOMContentLoaded', start);
  console.log(`[FeedCycle] v${VERSION} scaffold loaded.`);
})();
