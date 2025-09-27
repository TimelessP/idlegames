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
  const DEFAULTS = { theme:'system', feeds:[], categories:[], lastFetch:{}, lastFetchUrl:{}, settings:{ refreshMinutes:30, cacheMaxAgeMinutes:60, corsProxy:'' }, read:{}, favorites:{}, tags:{} }; // posts ephemeral + tags mapping postId -> [tag]
  let state = loadState();
  let posts = {}; // id -> post (ephemeral)

  // ---------- Proxy & Caching (ported/minimal from v1) ----------
  const PROXIES = [
    { name: 'AllOrigins', kind: 'param-enc', base: 'https://api.allorigins.win/raw?url=' },
    { name: 'corsproxy.io', kind: 'param-enc', base: 'https://corsproxy.io/?' },
    { name: 'CodeTabs', kind: 'param-enc', base: 'https://api.codetabs.com/v1/proxy?quest=' }
  ];
  const proxyStats = new Map(); // name -> {success, fail}
  const proxyTempDisabledUntil = new Map(); // name -> ts
  const PROXY_DISABLE_MS = 10*60*1000;
  const FETCH_TIMEOUT_MS = 12000;
  const CACHE_NAME = 'feedcycle-cache-v2';

  function proxyScore(p){ const s = proxyStats.get(p.name)||{success:0,fail:0}; return s.success - 2*s.fail; }
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
    return targetUrl;
  }
  function getProxyCandidates(){
    const arr = [];
    const manual = state.settings.corsProxy?.trim(); if(manual) arr.push(manual);
    const now = Date.now();
    const active = PROXIES.filter(p=> !(proxyTempDisabledUntil.get(p.name)>now));
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

  // ---------- Utilities ----------
  const $ = sel=> document.querySelector(sel);
  const byId = id=> document.getElementById(id);
  const el = (tag, props={}, ...kids)=>{ const n=document.createElement(tag); for(const [k,v] of Object.entries(props)){ if(k==='class') n.className=v; else if(k==='html') n.innerHTML=v; else if(k.startsWith('on')&&typeof v==='function') n.addEventListener(k.substring(2),v); else if(v===true) n.setAttribute(k,''); else if(v!==false && v!=null) n.setAttribute(k,v);} for(const k of kids){ if(k==null) continue; if(Array.isArray(k)) n.append(...k); else if(k.nodeType) n.append(k); else n.append(String(k)); } return n; };
  const hashId = s=>{ let h=2166136261>>>0; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return (h>>>0).toString(36); };
  const clamp = (n,a,b)=> Math.max(a, Math.min(b,n));

  function saveState(){ try{ const { } = state; localStorage.setItem(LS_KEY, JSON.stringify(state)); }catch(e){ console.warn('Save failed', e);} }
  function loadState(){ try{ return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(LS_KEY)||'{}')); }catch{ return {...DEFAULTS}; } }
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
    if(id==='articleViewer' && top){
      const scrollEl = top.querySelector('.panel-body');
      backStack.push({ id: top.dataset.panel, scroll: scrollEl? scrollEl.scrollTop:0, keep:true, el: top });
      // Keep list panel in DOM without layout shift
      top.style.visibility='hidden';
      top.setAttribute('aria-hidden','true');
      suspendListRenders = (top.dataset.panel==='articlesInfiniteScrollable');
      renderPanel(id, opts.data); focusPanel(id);
      // Reset newly shown panel scroll
      const nb = stackEl.lastElementChild?.querySelector('.panel-body'); if(nb) nb.scrollTop = 0;
      if(nb) nb.focus?.();
    }else{
      if(top){
        const scrollEl = top.querySelector('.panel-body');
        backStack.push({ id: top.dataset.panel, scroll: scrollEl? scrollEl.scrollTop:0 });
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
    const prev = backStack.pop();
    const top = stackEl.lastElementChild;
    if(prev.keep && prev.el){
      if(top && top!==prev.el) top.remove();
      prev.el.style.visibility='';
      prev.el.removeAttribute('aria-hidden');
      const body = prev.el.querySelector('.panel-body'); if(body) body.scrollTop = prev.scroll||0;
      focusPanel(prev.id);
      if(prev.id==='articlesInfiniteScrollable'){ suspendListRenders=false; }
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
      const search = root.querySelector('#searchBox'); if(search){ search.addEventListener('input', debounce(()=>{ currentFilters.q = search.value.trim(); renderArticles(); }, 300)); }
      root.querySelector('#chk-unread')?.addEventListener('change', e=>{ currentFilters.unread = e.target.checked; renderArticles(); });
      root.querySelector('#chk-fav')?.addEventListener('change', e=>{ currentFilters.fav = e.target.checked; renderArticles(); });
      populateFilters(root);
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
  const currentFilters = { q:'', subscription:'', category:'', tag:'', unread:false, fav:false, readState:'' }; // readState: '' | 'read' | 'unread'
  function populateFilters(panel){
    const selSub = panel.querySelector('#sel-subscription');
    const selCat = panel.querySelector('#sel-category');
    if(selSub){ selSub.innerHTML = '<option value="">All Subscriptions</option>' + state.feeds.map(f=> `<option value="${f.id}">${esc(f.title||f.url)}</option>`).join(''); selSub.value = currentFilters.subscription; selSub.onchange = e=>{ currentFilters.subscription = e.target.value; renderArticles(); }; }
    const cats = Array.from(new Set(state.feeds.map(f=> f.category).filter(Boolean)));
    if(selCat){ selCat.innerHTML = '<option value="">All Categories</option>' + cats.map(c=> `<option>${esc(c)}</option>`).join(''); selCat.value = currentFilters.category; selCat.onchange = e=>{ currentFilters.category = e.target.value; renderArticles(); }; }
    // Tag selector (create if not present)
    let selTag = panel.querySelector('#sel-tag');
    if(selTag){
      const allTags = Array.from(new Set(Object.values(state.tags||{}).flat())).sort((a,b)=> a.localeCompare(b));
      selTag.innerHTML = '<option value="">All Tags</option>' + allTags.map(t=> `<option>${esc(t)}</option>`).join('');
      selTag.value = currentFilters.tag;
      selTag.onchange = e=>{ currentFilters.tag = e.target.value; renderArticles(); };
    }
  }

  // ---------- Articles List ----------
  function renderArticles(){
    if(suspendListRenders) return; // preserve scroll + DOM while article open
    const panel = stackEl.querySelector('[data-panel="articlesInfiniteScrollable"]'); if(!panel) return;
    const list = panel.querySelector('#articlesList'); if(!list) return;
    const all = Object.values(posts);
    let arr = all;
    if(currentFilters.subscription) arr = arr.filter(p=> p.feedId===currentFilters.subscription);
    if(currentFilters.category){ const feedMap = new Map(state.feeds.map(f=> [f.id,f])); arr = arr.filter(p=> (feedMap.get(p.feedId)?.category||'')===currentFilters.category); }
  if(currentFilters.unread) arr = arr.filter(p=> !p.read);
  if(currentFilters.fav) arr = arr.filter(p=> p.favorite);
  if(currentFilters.readState==='read') arr = arr.filter(p=> p.read);
  if(currentFilters.readState==='unread') arr = arr.filter(p=> !p.read);
  if(currentFilters.tag){ arr = arr.filter(p=> (state.tags[p.id]||[]).includes(currentFilters.tag)); }
    if(currentFilters.q){ const q = currentFilters.q.toLowerCase(); arr = arr.filter(p=> (p.title||'').toLowerCase().includes(q) || (p.summary||'').toLowerCase().includes(q)); }
    arr = arr.sort((a,b)=> new Date(b.published||0) - new Date(a.published||0));
    list.innerHTML='';
    if(!arr.length){ list.append(el('div',{class:'empty'},'No articles.')); return; }
    for(const p of arr.slice(0,500)){ list.append(articleCard(p)); }
  }
  function articleCard(p){
    const c = el('div',{class:'card'+(p.read?' read':' unread'), role:'article', tabindex:0, 'data-post-id':p.id, 'aria-label': (p.title||'Article') + (p.read? ' (read)':' (unread)')});
    const realImg = pickImage(p);
    if(realImg){
      const mw = el('div',{class:'card-media'});
      const im = el('img',{src:realImg, alt:'', loading:'lazy', decoding:'async', referrerpolicy:'no-referrer'});
      im.addEventListener('error', ()=>{
        if(im.dataset.fallback) return;
        im.dataset.fallback='1';
        const svg = generateInlinePlaceholderSVG(p);
        if(svg){ mw.innerHTML = svg; }
        else { im.src = onePixelPng(); }
      });
      mw.append(im); c.append(mw);
    } else {
      const mw = el('div',{class:'card-media'});
      mw.innerHTML = generateInlinePlaceholderSVG(p) || `<img src="${onePixelPng()}" alt="" loading="lazy" decoding="async">`;
      c.append(mw);
    }
    c.append(el('h3',{}, p.title||'(untitled)'));
    const chips = el('div',{class:'chips'});
    const feed = state.feeds.find(f=> f.id===p.feedId);
    if(feed){
      const feedChip = el('button',{class:'chip feed-chip', title:'Filter by subscription','aria-label':'Filter by '+(feed.title||feed.url), onclick:(e)=>{ e.stopPropagation(); currentFilters.subscription=feed.id; renderArticles(); }}, feed.title||feed.url);
      chips.append(feedChip);
      if(feed.category){ const catChip = el('button',{class:'chip cat-chip', title:'Filter by category','aria-label':'Filter by category '+feed.category, onclick:(e)=>{ e.stopPropagation(); currentFilters.category=feed.category; renderArticles(); }}, feed.category); chips.append(catChip); }
    }
    // Tag chips (existing)
    const tagList = state.tags[p.id]||[];
    if(tagList.length){
      tagList.forEach(t=> chips.append(el('button',{class:'chip tag-chip', title:'Filter by tag','aria-label':'Filter by tag '+t, onclick:(e)=>{ e.stopPropagation(); currentFilters.tag=t; renderArticles(); }}, t)));
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
    const body = byId('articleBody'); if(!body) return; body.innerHTML='';
    const topBar = el('div',{class:'meta'}, [fmtDate(p.published), ' • ', safeHost(p.link||' '), ' • ', el('a',{href:p.link||'#', target:'_blank', rel:'noopener noreferrer'}, 'Open Original')]);
    body.append(el('h2',{}, p.title||'(untitled)'));
    body.append(topBar);
    const content = el('div',{class:'content', html: sanitizeHtml(p.content||'')});
    body.append(content);
    // Tags management UI
    const tagSection = el('div',{class:'tag-manage'});
    const existing = el('div',{class:'chips'});
    (state.tags[p.id]||[]).forEach(t=> existing.append(el('button',{class:'chip tag-chip', title:'Filter by tag', onclick:()=>{ currentFilters.tag=t; renderArticles(); }}, t)));
  const addForm = el('form',{class:'tag-add-form', onsubmit:(e)=>{ e.preventDefault(); const inp = addForm.querySelector('input'); const v = (inp.value||'').trim(); if(!v) return; const arr = state.tags[p.id] = (state.tags[p.id]||[]); if(!arr.includes(v)){ arr.push(v); saveState(); existing.append(el('button',{class:'chip tag-chip', title:'Filter by tag', onclick:()=>{ currentFilters.tag=v; renderArticles(); }}, v)); updateCardTags(p.id); } inp.value=''; }}, [el('input',{type:'text', placeholder:'Add tag', maxlength:40}), el('button',{type:'submit', class:'chip'}, '＋ Tag')]);
    tagSection.append(existing, addForm);
    body.append(tagSection);
    p.read = true; state.read[p.id]=true; saveState(); updateCardTags(p.id); // mark read persistently & sync list card
  }
  function updateCardTags(postId){
    const card = document.querySelector(`.card[data-post-id='${postId}']`); if(!card) return;
    const chips = card.querySelector('.chips'); if(!chips) return;
    chips.querySelectorAll('.tag-chip').forEach(n=> n.remove());
    const postTags = state.tags[postId]||[];
    const readChip = chips.querySelector('.read-chip');
    postTags.forEach(t=>{
      const chip = el('button',{class:'chip tag-chip', title:'Filter by tag','aria-label':'Filter by tag '+t, onclick:(e)=>{ e.stopPropagation(); currentFilters.tag=t; renderArticles(); }}, t);
      if(readChip) chips.insertBefore(chip, readChip); else chips.append(chip);
    });
  }
  function renderVideoViewer(p){ const v = byId('videoBody'); if(!v) return; v.innerHTML='(video TBD)'; }

  function renderSubscriptionEdit(feedId){
    const feed = state.feeds.find(f=> f.id===feedId); if(!feed){ const b=byId('subEditBody'); if(b) b.innerHTML='<div class="empty">Not found.</div>'; return; }
    const form = byId('subEditForm'); if(!form) return;
    const titleInput = byId('subEditTitleInput');
    const urlInput = byId('subEditUrlInput');
    const catInput = byId('subEditCategoryInput');
    const refreshInput = byId('subEditRefreshInput');
    const statusEl = byId('subEditStatus');
    // Populate datalist of categories
    const dl = byId('categoryOptions'); if(dl){ dl.innerHTML = Array.from(new Set(state.feeds.map(f=> f.category).filter(Boolean))).map(c=>`<option value="${esc(c)}">`).join(''); }
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
      if(p.feedId === feedId){ delete posts[pid]; delete state.read[pid]; delete state.favorites[pid]; }
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
    if(post.media){ const m = post.media.find(m=> (m.type||'').startsWith('image/')); if(m){ const s=safeImageUrl(m.url); if(s) return s; } }
    const m = /<img[^>]+src=["']([^"']+)["']/i.exec(post.content||''); if(m){ const s=safeImageUrl(m[1]); if(s) return s; }
    return null;
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

  // ---------- Basic Feed Refresh (placeholder) ----------
  async function refreshAll(force=false){
    const usedProxies = new Set();
    for(const f of state.feeds){
      try{
        await refreshFeed(f, { force, usedProxies });
        state.lastFetch[f.id]=Date.now();
      }catch(e){ console.warn('Feed fail', f.url, e); }
    }
    saveState(); renderArticles();
    if(usedProxies.size){ console.log('[FeedCycle v2] Proxies used:', [...usedProxies].join(', ')); }
  }
  async function refreshFeed(feed, { force=false, usedProxies=new Set() }={}){
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
        }catch(e){ lastErr=e; if(typeof c!=='string'){ const stats=proxyStats.get(c.name)||{success:0,fail:0}; stats.fail++; proxyStats.set(c.name, stats); if(/HTTP 429|HTTP 5\d\d/.test(e.message)) proxyTempDisabledUntil.set(c.name, Date.now()+PROXY_DISABLE_MS); } }
      }
      if(used) break;
    }
    if(!used){
      try{ xml = await fetchWithCache(feed.url); if(xmlHasParserError(xml)) throw new Error('XML parse error'); used='Direct'; usedUrl=feed.url; }
      catch(e){ lastErr=e; }
    }
    if(!used){ throw lastErr || new Error('Failed to fetch feed'); }
    if(used && used!=='Manual' && used!=='Direct'){ const s=proxyStats.get(used)||{success:0,fail:0}; s.success++; proxyStats.set(used,s); }
    if(used) usedProxies.add(used);
    state.lastFetchUrl[feed.id] = usedUrl;
    // Parse & merge posts
    const doc = new DOMParser().parseFromString(xml,'text/xml');
    const isAtom = !!doc.querySelector('feed > entry');
    const items = isAtom? [...doc.querySelectorAll('feed > entry')] : [...doc.querySelectorAll('rss channel item')];
    for(const it of items){
      const title = (it.querySelector('title')?.textContent||'').trim();
      const link = isAtom ? (it.querySelector('link[rel="alternate"]')?.getAttribute('href') || it.querySelector('link')?.getAttribute('href') || '') : (it.querySelector('link')?.textContent||'');
      const content = isAtom ? (it.querySelector('content')?.textContent || it.querySelector('summary')?.textContent || '') : (it.querySelector('description')?.textContent||'');
      const guidSrc = isAtom ? (it.querySelector('id')?.textContent || link || title) : (it.querySelector('guid')?.textContent || link || title);
      const id = hashId(feed.id+'|'+guidSrc);
      posts[id] = Object.assign(posts[id]||{}, { id, feedId:feed.id, title, link, content, summary: stripHtml(content).slice(0,400), published: it.querySelector('pubDate, updated, published')?.textContent||'', read: !!state.read[id], favorite: !!state.favorites[id] });
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
      for(const f of state.feeds){
        const url = state.lastFetchUrl?.[f.id] || f.url;
        if(!url) continue;
        const res = await cache.match(new Request(url));
        if(!res) continue;
        let text = await res.text();
        if(xmlHasParserError(text)){ const extracted = maybeExtractXmlFromJson(text); if(extracted) text = extracted; }
        if(xmlHasParserError(text)) continue;
        const doc = new DOMParser().parseFromString(text,'text/xml');
        const isAtom = !!doc.querySelector('feed > entry');
        const items = isAtom? [...doc.querySelectorAll('feed > entry')] : [...doc.querySelectorAll('rss channel item')];
        for(const it of items){
          const title = (it.querySelector('title')?.textContent||'').trim();
          const link = isAtom ? (it.querySelector('link[rel="alternate"]')?.getAttribute('href') || it.querySelector('link')?.getAttribute('href') || '') : (it.querySelector('link')?.textContent||'');
          const content = isAtom ? (it.querySelector('content')?.textContent || it.querySelector('summary')?.textContent || '') : (it.querySelector('description')?.textContent||'');
          const guidSrc = isAtom ? (it.querySelector('id')?.textContent || link || title) : (it.querySelector('guid')?.textContent || link || title);
          const id = hashId(f.id+'|'+guidSrc);
          posts[id] = Object.assign(posts[id]||{}, { id, feedId:f.id, title, link, content, summary: stripHtml(content).slice(0,400), published: it.querySelector('pubDate, updated, published')?.textContent||'', read: !!state.read[id], favorite: !!state.favorites[id] });
        }
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
  let infScrollHandler = null;
  function setupInfiniteScroll(panel){
    const list = panel.querySelector('#articlesList'); if(!list) return;
    const scrollFrame = panel.querySelector('.panel-body') || panel; // use panel-body if present
    if(infScrollHandler && scrollFrame._infAttached){ scrollFrame.removeEventListener('scroll', infScrollHandler); }
    let rendered = 0; const CHUNK = 120; let sorted = [];
    function ensure(){
      if(!sorted.length) sorted = Object.values(posts).sort((a,b)=> new Date(b.published||0)-new Date(a.published||0));
      const bottom = scrollFrame.scrollTop + scrollFrame.clientHeight;
      const thresholdPx = bottom + 600; // start preloading earlier
      // Approximate per-card height (fallback 300)
      const avgHeight = 300; // could refine later
      const thresholdCount = Math.ceil(thresholdPx / avgHeight * 3); // inflate a bit
      while(rendered < sorted.length && rendered < thresholdCount){
        const nextSlice = sorted.slice(rendered, rendered+CHUNK);
        nextSlice.forEach(p=> list.append(articleCard(p)));
        rendered += nextSlice.length;
      }
    }
    infScrollHandler = ensure;
    scrollFrame.addEventListener('scroll', infScrollHandler, { passive:true });
    scrollFrame._infAttached = true;
    ensure();
  }

  // ---------- Media Player (variable skip cue) ----------
  const mp = { audio: new Audio(), cue:{ dragging:false, lastSkip:0, pendingInterval:null } };
  function initMediaPlayer(){
    const a = mp.audio; const playBtn=byId('mp-play'), pauseBtn=byId('mp-pause');
    const prog=byId('mp-progress'); const timeEl=byId('mp-time');
  const cueBtn = byId('cueBtn'); const cueTrack = byId('cueTrack');
    function fmtTime(sec){ if(!isFinite(sec)) return '0:00'; const m=Math.floor(sec/60); const s=Math.floor(sec%60); return m+':' + String(s).padStart(2,'0'); }
    playBtn.onclick = ()=> a.play();
    pauseBtn.onclick = ()=> a.pause();
    a.addEventListener('play', ()=>{ playBtn.disabled=true; pauseBtn.disabled=false; });
    a.addEventListener('pause', ()=>{ playBtn.disabled=false; pauseBtn.disabled=true; });
    a.addEventListener('timeupdate', ()=>{ const r=a.currentTime/(a.duration||1); prog.value=r; timeEl.textContent = fmtTime(a.currentTime); });
    a.addEventListener('loadedmetadata', ()=>{ prog.max=1; timeEl.textContent = fmtTime(0); });
    // Variable skip logic
    let originX=0;
    function computeSkip(pxDist){
      const dir = Math.sign(pxDist)||0; const d = Math.abs(pxDist);
      // Target anchor points (distance px -> seconds):
      // 0->0, 120->4, 300->15, 600->60, 1000->240, then ease toward 900 cap.
      // We'll implement piecewise interpolation then a soft exponential tail.
      const anchors = [
        [0,0],
        [120,4],
        [300,15],
        [600,60],
        [1000,240]
      ];
      let seconds;
      if(d >= 1000){
        // Beyond last anchor: exponential ease toward 900
        const excess = d - 1000;
        // Each additional 400px adds diminishing portion of remaining gap.
        const remain = 900 - 240;
        seconds = 240 + remain * (1 - Math.exp(-excess/400));
      } else {
        // Find segment
        for(let i=0;i<anchors.length-1;i++){
          const [dx1,s1] = anchors[i];
            const [dx2,s2] = anchors[i+1];
          if(d >= dx1 && d <= dx2){
            const t = (d - dx1)/(dx2 - dx1);
            // Smoothstep to make slope gentler at ends
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
      if(!deltaSeconds) return; const dur=a.duration||0; if(!dur) return; let t=a.currentTime + deltaSeconds; t=clamp(t,0,dur); a.currentTime=t; }
    const REPEAT_INTERVAL_MS = 750; // interval for repeated jumps while held
    function formatRate(skip){ return ''; }
    function updateVisual(px){
      const skip = computeSkip(px); // label removed
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
  e.preventDefault(); cueBtn.focus(); originX = e.clientX; cueBtn.classList.add('dragging'); cueTrack.classList.add('dragging');
  cueBtn.style.removeProperty('--dx');
      let lastVisual=0;
    const move = ev=>{ const dx = ev.clientX - originX; lastVisual = dx; const s = updateVisual(dx); if(mp.cue.pendingInterval) return; if(Math.abs(s)>=1){ // start repeating skip while held (continuous scanning)
      mp.cue.pendingInterval = setInterval(()=>{ const s2=computeSkip(lastVisual); applySkip(s2); }, REPEAT_INTERVAL_MS); }
      };
      const up = ev=>{ window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',up); endDrag(ev.clientX-originX); };
      window.addEventListener('pointermove',move); window.addEventListener('pointerup',up);
    });
    cueBtn.addEventListener('keydown', e=>{
      const base= (e.shiftKey?60:10);
      if(e.key==='ArrowLeft'){ e.preventDefault(); applySkip(-base); }
      if(e.key==='ArrowRight'){ e.preventDefault(); applySkip(base); }
      if(e.key==='Escape'){ resetCue(); }
      if(e.key==='Enter' || e.key===' '){ e.preventDefault(); if(a.paused) a.play(); else a.pause(); }
    });
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
  const SAMPLE_OPML = `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>Sample Feeds</title></head>\n  <body>\n    <outline text="BBC World" type="rss" xmlUrl="https://feeds.bbci.co.uk/news/world/rss.xml" category="News"/>\n    <outline text="NASA Image of the Day" type="rss" xmlUrl="https://www.nasa.gov/rss/dyn/lg_image_of_the_day.rss" category="Space"/>\n    <outline text="Hacker News" type="rss" xmlUrl="https://news.ycombinator.com/rss" category="Tech"/>\n    <outline text="The Verge" type="rss" xmlUrl="https://www.theverge.com/rss/index.xml" category="Tech"/>\n    <outline text="Syntax FM" type="rss" xmlUrl="https://feed.syntax.fm/rss" category="Podcasts"/>\n    <outline text="Darknet Diaries" type="rss" xmlUrl="https://podcast.darknetdiaries.com/" category="Podcasts"/>\n    <outline text="Risky Business" type="rss" xmlUrl="https://risky.biz/feeds/risky-business" category="Podcasts"/>\n    <outline text="Risky Business News" type="rss" xmlUrl="https://risky.biz/feeds/risky-business-news" category="Podcasts"/>\n    <outline text="BleepingComputer" type="rss" xmlUrl="https://www.bleepingcomputer.com/feed/" category="Tech"/>\n    <outline text="The Lovecraft Investigations" type="rss" xmlUrl="https://podcasts.files.bbci.co.uk/p06spb8w.rss" category="Podcasts"/>\n    <outline text="Graham Cluley" type="rss" xmlUrl="https://grahamcluley.com/feed/" category="Tech"/>\n    <!-- Bylines Network -->\n    <outline text="Bylines Cymru" type="rss" xmlUrl="https://bylines.cymru/feed/" category="Bylines"/>\n    <outline text="Bylines Scotland" type="rss" xmlUrl="https://bylines.scot/feed/" category="Bylines"/>\n    <outline text="Central Bylines" type="rss" xmlUrl="https://centralbylines.co.uk/feed/" category="Bylines"/>\n    <outline text="East Anglia Bylines" type="rss" xmlUrl="https://eastangliabylines.co.uk/feed/" category="Bylines"/>\n    <outline text="Kent and Surrey Bylines" type="rss" xmlUrl="https://kentandsurreybylines.co.uk/feed/" category="Bylines"/>\n    <outline text="North East Bylines" type="rss" xmlUrl="https://northeastbylines.co.uk/feed/" category="Bylines"/>\n    <outline text="North West Bylines" type="rss" xmlUrl="https://northwestbylines.co.uk/feed/" category="Bylines"/>\n    <outline text="Sussex Bylines" type="rss" xmlUrl="https://sussexbylines.co.uk/feed/" category="Bylines"/>\n    <outline text="West England Bylines" type="rss" xmlUrl="https://westenglandbylines.co.uk/feed/" category="Bylines"/>\n    <outline text="Yorkshire Bylines" type="rss" xmlUrl="https://yorkshirebylines.co.uk/feed/" category="Bylines"/>\n  </body>\n</opml>`;

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
    byId('btn-filterpanel').onclick = ()=> showPanel('filterAndSortSettings');
    // Scheduled refresh loop
    setInterval(()=>{
      const now = Date.now();
      const globalInt = (state.settings.refreshMinutes||30)*60*1000;
      state.feeds.forEach(f=>{
        const last = state.lastFetch[f.id]||0;
        const interval = (f.refreshMinutes||state.settings.refreshMinutes||30)*60*1000;
        if(now - last >= interval){ refreshFeed(f).then(()=>{ state.lastFetch[f.id]=Date.now(); saveState(); renderArticles(); }).catch(e=> console.warn('Scheduled refresh fail', f.url, e)); }
      });
    }, 60*1000); // check every minute
  }
  document.addEventListener('DOMContentLoaded', start);
  console.log(`[FeedCycle] v${VERSION} scaffold loaded.`);
})();
