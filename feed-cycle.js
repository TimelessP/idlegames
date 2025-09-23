/* Feed Cycle — Delightful local-first RSS/Atom reader (MVP)
   - LocalStorage persistence for config, feeds, post meta
   - OPML import/export/edit
   - Fetch & parse RSS/Atom, media aware
   - Cache API for network responses; basic scheduling
   - Search with combined scoring (substring, regex, soundex, cosine)
*/

(function(){
  "use strict";

  // --------- Utilities ---------
  const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));
  const clamp = (n, min, max)=> Math.max(min, Math.min(max, n));
  const byId = (id)=> document.getElementById(id);
  const fmtDate = (d)=> d ? new Date(d).toLocaleString() : "";
  const text = (node, s)=> { node.textContent = s; };
  const el = (tag, props={}, ...children)=>{
    const n = document.createElement(tag);
    Object.entries(props).forEach(([k,v])=>{
      if(k === 'class') n.className = v;
      else if(k === 'dataset') Object.assign(n.dataset, v);
      else if(k.startsWith('on') && typeof v === 'function') n.addEventListener(k.substring(2), v);
      else if(v === true) n.setAttribute(k, "");
      else if(v !== false && v != null) n.setAttribute(k, v);
    });
    for(const c of children){
      if(c == null) continue; if(Array.isArray(c)) n.append(...c); else if(c.nodeType) n.append(c); else n.append(String(c));
    }
    return n;
  };
  const hashId = (s)=> {
    // Simple stable hash -> base36 string
    let h = 2166136261 >>> 0;
    for(let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h>>>0).toString(36);
  };

  // --------- Storage Keys ---------
  const LS_KEY = 'feed-cycle-v1';
  const DEFAULTS = {
    theme: 'system',
    refreshMinutes: 30,
    cacheMaxAgeMinutes: 60,
    corsProxy: '', // e.g. https://r.jina.ai/http:// or https://api.allorigins.win/raw?url=
  feeds: [], // {id,url,title,siteUrl,category}
  categories: [], // list of category names
    posts: {}, // id -> { id, feedId, title, link, author, published, categories[], content, summary, media[], read, favorite, tags[] }
    read: {}, // postId -> true
    favorites: {}, // postId -> true
    tags: {}, // postId -> [tag]
    lastFetch: {}, // feedId -> ts
    lastFetchUrl: {}, // feedId -> last successful request URL (proxied or direct)
  };

  // Public proxy candidates (best-effort). Order matters.
  const PROXIES = [
    { name: 'AllOrigins', kind: 'param-enc', base: 'https://api.allorigins.win/raw?url=' },
    { name: 'AllOriginsJSON', kind: 'param-enc-json', base: 'https://api.allorigins.win/get?url=' },
    { name: 'CodeTabs', kind: 'param-enc', base: 'https://api.codetabs.com/v1/proxy?quest=' },
    { name: 'corsproxy.io', kind: 'param-enc', base: 'https://corsproxy.io/?' },
    { name: 'IsomorphicGit', kind: 'prefix-raw', base: 'https://cors.isomorphic-git.org/' },
    { name: 'ThingProxy', kind: 'prefix-raw', base: 'https://thingproxy.freeboard.io/fetch/' },
  ];

  function buildProxiedUrl(targetUrl, proxySpec){
    // Manual override string
    if(typeof proxySpec === 'string'){
      const p = proxySpec.trim();
      if(!p) return targetUrl;
      if(p.includes('%s')) return p.replace('%s', encodeURIComponent(targetUrl));
      if(/[=]$/.test(p) || /[?&]url=$/i.test(p)) return p + encodeURIComponent(targetUrl);
      return p + targetUrl;
    }
    // Known proxy formatters
    const { kind, base, name } = proxySpec;
    if(kind === 'param-enc'){
      // Add cache-busting hint for AllOrigins raw to avoid stale/transport quirks
      let u = base + encodeURIComponent(targetUrl);
      if(name === 'AllOrigins') u += `&cache=${Date.now()}`;
      return u;
    }
    if(kind === 'param-enc-json'){
      return base + encodeURIComponent(targetUrl);
    }
    if(kind === 'prefix-raw') return base + targetUrl;
    return targetUrl;
  }

  function getProxyCandidates(){
    const arr = [];
    if(state.corsProxy && state.corsProxy.trim()) arr.push(state.corsProxy.trim());
    // On file:// origins, prefer proxies that tend to work better and put AllOrigins later
    const isFile = (()=>{ try{ return location.protocol==='file:'; }catch{ return false; } })();
    if(isFile){
      // Exclude AllOrigins variants on file:// as they often block or error with QUIC
      const preferred = ['CodeTabs','corsproxy.io','IsomorphicGit','ThingProxy'];
      const built = preferred.map(name=> PROXIES.find(p=>p.name===name)).filter(Boolean);
      return arr.concat(built);
    } else {
      // Shallow shuffle of built-in proxies to spread load on http(s)
      const built = PROXIES.slice();
      for(let i=built.length-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [built[i], built[j]] = [built[j], built[i]]; }
      return arr.concat(built);
    }
  }

  // --------- State ---------
  let state = loadState();
  function loadState(){
    try{
      const s = JSON.parse(localStorage.getItem(LS_KEY));
      const merged = Object.assign({}, DEFAULTS, s||{});
      // Do not load persisted posts; keep posts only in memory to save quota
      merged.posts = {};
      return merged;
    }catch{ return {...DEFAULTS}; }
  }
  function saveState(){
    // Persist minimal state to avoid quota issues: omit large transient data (posts)
    try{
      const { posts, ...rest } = state;
      localStorage.setItem(LS_KEY, JSON.stringify(rest));
    }catch(e){
      // On quota issues, try trimming lastFetch, then settle for settings only
      try{
        const { posts, lastFetch, ...rest } = state;
        localStorage.setItem(LS_KEY, JSON.stringify(rest));
        try{ setBusy(false, 'Storage nearly full. Saved settings only.'); }catch{}
      }catch{
        // give up quietly
      }
    }
  }

  // --------- Migrations ---------
  function migrateFeeds(){
    // Map of outdated feed URL -> new URL
    const urlFixes = new Map([
      ['https://syntax.fm/rss', 'https://feed.syntax.fm/rss'],
    ]);
    let touched = false;
    const idRemap = new Map(); // oldId -> newId
    for(const f of state.feeds){
      const newUrl = urlFixes.get(f.url);
      if(newUrl && newUrl !== f.url){
        const oldId = f.id;
        f.url = newUrl;
        f.id = hashId(newUrl);
        idRemap.set(oldId, f.id);
        touched = true;
      }
    }
    if(!touched) return;
    // Remap posts feedId and lastFetch keys
    if(idRemap.size){
      for(const pId in state.posts){
        const p = state.posts[pId];
        const newId = idRemap.get(p.feedId);
        if(newId){ p.feedId = newId; }
      }
      for(const [oldId, newId] of idRemap){
        if(state.lastFetch[oldId] != null){ state.lastFetch[newId] = state.lastFetch[oldId]; delete state.lastFetch[oldId]; }
      }
    }
    saveState();
  }

  // --------- Theme ---------
  function applyTheme(sel){
    document.documentElement.setAttribute('data-theme', sel);
    // Update emoji toggle to reflect current theme if present
    try{
      const btn = document.getElementById('btn-theme-toggle');
      if(btn){ btn.textContent = sel==='dark' ? '🌙' : sel==='light' ? '☀️' : '🌓'; btn.title = `Theme: ${sel}`; }
    }catch{}
  }

  // --------- OPML ---------
  function exportOPML(){
    const feeds = state.feeds || [];
    const body = feeds.map(f=>`    <outline type="rss" text="${escXml(f.title||f.url)}" xmlUrl="${escXml(f.url)}" ${f.category?`category="${escXml(f.category)}"`:''} />`).join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>Feed Cycle Subscriptions</title></head>\n  <body>\n${body}\n  </body>\n</opml>`;
    download('feed-cycle.opml', xml, 'text/xml');
  }
  function importOPMLText(xml){
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const outlines = [...doc.querySelectorAll('outline[xmlUrl]')];
    const feeds = outlines.map(o=>({
      id: hashId(o.getAttribute('xmlUrl')),
      url: o.getAttribute('xmlUrl'),
      title: o.getAttribute('text') || o.getAttribute('title') || o.getAttribute('xmlUrl'),
      siteUrl: o.getAttribute('htmlUrl') || '',
      category: o.getAttribute('category') || '',
    }));
    // merge unique by url
    const map = new Map((state.feeds||[]).map(f=>[f.url, f]));
    for(const f of feeds){ map.set(f.url, {...map.get(f.url), ...f}); }
    state.feeds = [...map.values()].sort((a,b)=> (a.category||'').localeCompare(b.category||'') || (a.title||'').localeCompare(b.title||''));
    saveState();
    renderSidebar();
    updateEmptyState();
  }
  function escXml(s){ return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&apos;"}[c])); }
  function download(name, content, type){
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], {type}));
    a.download = name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  }

  // --------- Fetch & Cache ---------
  const FETCH_TIMEOUT_MS = 12000;
  async function fetchWithCache(url){
    const now = Date.now();
    const maxAge = clamp((state.cacheMaxAgeMinutes||60)*60*1000, 5*60*1000, 24*60*60*1000);
    const req = new Request(url);
  // Guard for Cache API (requires secure context in some browsers)
  if(typeof caches !== 'undefined'){
      const cache = await caches.open('feed-cycle-cache-v1');
      const hit = await cache.match(req);
      let staleResp = hit || null;
      if(hit){
        const date = new Date(hit.headers.get('date') || 0).getTime();
        if(now - date < maxAge){ return hit.text(); }
      }
      const controller = new AbortController();
      const to = setTimeout(()=>controller.abort(), FETCH_TIMEOUT_MS);
      let res;
      try{
        res = await fetch(req, { signal: controller.signal });
      } catch (e){
        // Network error: serve stale if available
        clearTimeout(to);
        if(staleResp) return staleResp.clone().text();
        throw e;
      } finally { clearTimeout(to); }
      const text = await res.text();
      if(res.ok){
        const stored = new Response(text, {headers: { 'content-type': res.headers.get('content-type')||'text/xml; charset=utf-8', 'date': new Date().toUTCString() }});
        await cache.put(req, stored);
        return text;
      } else {
        // HTTP error: serve stale if available
        if(staleResp) return staleResp.clone().text();
        const err = new Error(`HTTP ${res.status}`);
        err._status = res.status;
        throw err;
      }
    }
    // Fallback: fetch without cache
    const controller = new AbortController();
    const to = setTimeout(()=>controller.abort(), FETCH_TIMEOUT_MS);
    let res;
    try{
      res = await fetch(req, { signal: controller.signal });
    } finally { clearTimeout(to); }
    if(res.ok){ return res.text(); }
    const err = new Error(`HTTP ${res.status}`);
    err._status = res.status;
    throw err;
  }

  function maybeProxy(url){
    const p = state.corsProxy?.trim();
    if(!p) return url;
    if(p.includes('%s')) return p.replace('%s', encodeURIComponent(url));
    // Heuristic: if proxy ends with '=' or contains 'url=', encode; otherwise append raw URL
    if(/[=]$/.test(p) || /[?&]url=$/i.test(p)) return p + encodeURIComponent(url);
    return p + url;
  }

  function xmlHasParserError(xml){
    try{
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      return !!doc.querySelector('parsererror');
    }catch{ return true; }
  }

  function maybeExtractXmlFromJson(text){
    try{
      const obj = JSON.parse(text);
      if(obj && typeof obj.contents === 'string') return obj.contents;
      return null;
    }catch{ return null; }
  }

  function addCacheBuster(u){
    try{
      const hasQ = u.includes('?');
      return u + (hasQ?'&':'?') + 't=' + Date.now();
    }catch{ return u; }
  }

  async function refreshFeed(feed){
    const candidates = getProxyCandidates();
    let lastErr = null; let used = null; let usedUrl = null; let xml = '';
    for(const c of candidates){
      // Skip proxies in cooldown
      if(typeof c !== 'string'){
        const until = proxyCooldown.get(c.name)||0;
        if(until && Date.now() < until) continue;
      }
      const proxied = buildProxiedUrl(feed.url, c);
      // Try up to 2 attempts per candidate (with cache buster on retry)
      for(let attempt=0; attempt<2; attempt++){
        const url = attempt ? addCacheBuster(proxied) : proxied;
        try{
          let text = await fetchWithCache(url);
          // If proxy returned JSON wrapper, extract contents
          if(xmlHasParserError(text)){
            const extracted = maybeExtractXmlFromJson(text);
            if(extracted) text = extracted;
          }
          if(xmlHasParserError(text)) throw new Error('XML parse error');
          xml = text;
          used = (typeof c === 'string') ? 'Manual' : c.name;
          usedUrl = url;
          break;
        }catch(e){
          lastErr = e;
          // On 429 or 5xx, cool down this proxy
          if(typeof c !== 'string' && e && (e._status === 429 || (e._status>=500 && e._status<600))){
            proxyCooldown.set(c.name, Date.now() + PROXY_COOLDOWN_MS);
          }
        }
      }
      if(used) break;
    }
    if(!used){
      // Try direct as a final fallback
      try{ xml = await fetchWithCache(feed.url); if(xmlHasParserError(xml)) throw new Error('XML parse error'); used = 'Direct'; usedUrl = feed.url; }
      catch(e){ lastErr = e; }
    }
    if(!used) throw lastErr || new Error('Failed to fetch feed');
    else { lastProxiesUsed.add(used); state.lastFetchUrl[feed.id] = usedUrl; }
    // Update feed metadata (title/site) from the fetched XML if available
    let metaChanged = false;
    try{
      const meta = parseFeedMeta(xml);
      if(meta.title && meta.title !== feed.title){ feed.title = meta.title; metaChanged = true; }
      if(meta.siteUrl && meta.siteUrl !== feed.siteUrl){ feed.siteUrl = meta.siteUrl; metaChanged = true; }
    }catch{}

    const posts = parseFeed(xml, feed);
    for(const post of posts){
      state.posts[post.id] = {
        ...state.posts[post.id],
        ...post,
        read: !!state.read[post.id],
        favorite: !!state.favorites[post.id],
        tags: state.tags[post.id]||[],
      };
    }
    state.lastFetch[feed.id] = Date.now();
    // Defer save to refreshAll to minimize write frequency
    return metaChanged;
  }

  // Hydrate posts from Cache API without network to populate grid on load
  async function hydrateFromCache(){
    let loaded = 0;
    let metaChanged = false;
    if(typeof caches === 'undefined') return 0;
    try{
      const cache = await caches.open('feed-cycle-cache-v1');
      for(const feed of state.feeds){
        const url = state.lastFetchUrl[feed.id] || feed.url;
        const res = await cache.match(new Request(url));
        if(!res) continue;
        let text = await res.text();
        if(xmlHasParserError(text)){
          const extracted = maybeExtractXmlFromJson(text);
          if(extracted) text = extracted;
        }
        if(xmlHasParserError(text)) continue;
        // Update feed title/siteUrl from cached XML if present
        try{
          const meta = parseFeedMeta(text);
          if(meta.title && meta.title !== feed.title){ feed.title = meta.title; metaChanged = true; }
          if(meta.siteUrl && meta.siteUrl !== feed.siteUrl){ feed.siteUrl = meta.siteUrl; metaChanged = true; }
        }catch{}
        const posts = parseFeed(text, feed);
        for(const post of posts){
          state.posts[post.id] = {
            ...state.posts[post.id],
            ...post,
            read: !!state.read[post.id],
            favorite: !!state.favorites[post.id],
            tags: state.tags[post.id]||[],
          };
          loaded++;
        }
      }
      if(metaChanged){ saveState(); renderSidebar(); }
      if(loaded) renderPosts();
      return loaded;
    }catch{ return loaded; }
  }

  function parseFeed(xml, feed){
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    // Detect Atom vs RSS
    const isAtom = !!doc.querySelector('feed > entry');
    const items = isAtom ? [...doc.querySelectorAll('feed > entry')] : [...doc.querySelectorAll('rss channel item')];
    return items.map(it=>{
      const get = (sel)=> it.querySelector(sel)?.textContent?.trim() || '';
      const title = isAtom ? (get('title') || get('summary')) : get('title');
      const link = isAtom ? (it.querySelector('link[rel="alternate"]')?.getAttribute('href') || it.querySelector('link')?.getAttribute('href') || '') : get('link');
      const content = isAtom ? (it.querySelector('content')?.textContent || it.querySelector('summary')?.textContent || '') : (get('encoded,content\\:encoded') || get('description'));
      const author = isAtom ? (get('author name') || get('author') || '') : (get('author') || get('dc\\:creator'));
      const pub = isAtom ? (get('updated') || get('published')) : (get('pubDate') || get('date'));
      const categories = isAtom ? [...it.querySelectorAll('category')].map(c=>c.getAttribute('term')||c.textContent||'') : [...it.querySelectorAll('category')].map(c=>c.textContent||'');
      const enclosure = isAtom ? [...it.querySelectorAll('link[rel="enclosure"], link[rel="enclosure"]')].map(a=>({url:a.getAttribute('href'), type:a.getAttribute('type')})) : [...it.querySelectorAll('enclosure')].map(e=>({url:e.getAttribute('url'), type:e.getAttribute('type')}));
      const mediaContent = [...it.querySelectorAll('media\\:content, content')].map(m=>({url:m.getAttribute('url'), type:m.getAttribute('type')})).filter(m=>m.url);
      const media = [...enclosure, ...mediaContent];
      const idSrc = isAtom ? (get('id') || link || title) : (get('guid') || link || title);
      const id = hashId((feed.id||'') + '|' + idSrc);
      return { id, feedId: feed.id, title: decodeHtml(title), link, author, published: pub, categories, content, summary: stripHtml(content).slice(0, 400), media };
    });
  }

  function parseFeedMeta(xml){
    try{
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const isAtom = !!doc.querySelector('feed');
      if(isAtom){
        const title = doc.querySelector('feed > title')?.textContent?.trim() || '';
        const link = doc.querySelector('feed > link[rel="alternate"]')?.getAttribute('href') || doc.querySelector('feed > link')?.getAttribute('href') || '';
        return { title, siteUrl: link };
      } else {
        const title = doc.querySelector('rss channel > title')?.textContent?.trim() || '';
        const link = doc.querySelector('rss channel > link')?.textContent?.trim() || '';
        return { title, siteUrl: link };
      }
    }catch{
      return { title:'', siteUrl:'' };
    }
  }

  function stripHtml(html){
    if(!html) return '';
    let s = String(html);
    // Drop potentially heavy/embedded blocks entirely before any parsing
    s = s.replace(/<(script|style|iframe|object|embed|svg|math)[\s\S]*?>[\s\S]*?<\/\1>/gi, ' ');
    // Remove comments
    s = s.replace(/<!--[\s\S]*?-->/g, ' ');
    // Strip remaining tags
    s = s.replace(/<[^>]+>/g, ' ');
    // Decode basic entities using existing decoder
    s = decodeHtml(s);
    // Collapse whitespace
    return s.replace(/\s+/g, ' ').trim();
  }
  function decodeHtml(html){ const t = document.createElement('textarea'); t.innerHTML = html||''; return t.value; }

  // --------- Search ---------
  function buildIndex(posts){
    // token vector map for cosine
  const docs = posts.map(p=>({id:p.id, text: [p.title, p.summary, p.author, p.categories?.join(' '), stripHtml(p.content)].filter(Boolean).join(' \n ')}));
    return docs.map(d=>({id:d.id, vec: tfidf(d.text)}));
  }
  function tokenize(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean); }
  function tfidf(text){
    const tokens = tokenize(text); const tf = new Map(); tokens.forEach(t=>tf.set(t, (tf.get(t)||0)+1));
    const mag = Math.sqrt([...tf.values()].reduce((a,b)=>a+b*b,0));
    return { tf, mag: mag||1 };
  }
  function cosine(vecA, vecB){
    let dot = 0; for(const [t,c] of vecA.tf){ const cB = vecB.tf.get(t)||0; dot += c*cB; }
    return dot / (vecA.mag * vecB.mag);
  }
  function soundex(s){
    s = (s||'').toUpperCase().replace(/[^A-Z]/g,''); if(!s) return '';
    const m = {B:1,F:1,P:1,V:1,C:2,G:2,J:2,K:2,Q:2,S:2,X:2,Z:2,D:3,T:3,L:4,M:5,N:5,R:6};
    let out = s[0]; let prev = m[out]||0;
    for(let i=1;i<s.length;i++){ const d = m[s[i]]||0; if(d && d!==prev) out+=d; prev=d; }
    return (out+'000').slice(0,4);
  }
  function safeRegex(q){ try{ return new RegExp(q, 'i'); }catch{ return null; } }
  function scorePost(p, q, qVec, qSoundex, rx){
    const hay = [p.title, p.summary, p.author, p.categories?.join(' '), (state.tags[p.id]||[]).join(' '), stripHtml(p.content)].join(' \n ').toLowerCase();
    const s = q.toLowerCase();
    const substring = hay.includes(s) ? 1 : 0;
    const regex = rx && rx.test(hay) ? 1 : 0;
    const sx = Math.max(...tokenize(hay).map(t=> (soundex(t)===qSoundex?1:0)));
    const cos = cosine(p._vec, qVec);
    return 0.4*substring + 0.2*regex + 0.1*sx + 0.3*cos;
  }

  // --------- Render ---------
  function renderSidebar(){
    const feedList = byId('feed-list');
    feedList.innerHTML = '';
    for(const f of state.feeds){
      const li = el('li', {role:'treeitem', tabindex:0});
      const row = el('div', {class:'row'});
      const left = el('div', {class:'row-left'});
  left.append(el('span', {class:'title', title: f.title||f.url}, f.title||f.url));
      // Category chip as a button to assign/remove
  const chip = el('button', {class:'chip button', title:(f.category||'(no category)') + ' • Click to set', 'aria-label':'Set category for subscription'}, f.category||'(no category)');
      chip.onclick = (ev)=>{
        ev.stopPropagation();
        const cats = Array.from(new Set([...(state.categories||[]), ...state.feeds.map(ff=>ff.category).filter(Boolean)])).sort();
        const choice = prompt('Set category (leave blank to remove):\n'+cats.map(c=>' - '+c).join('\n'), f.category||'');
        if(choice==null) return;
        const newCat = (choice||'').trim();
        f.category = newCat;
        // ensure categories list contains it
        if(newCat && !state.categories.includes(newCat)) state.categories.push(newCat);
        saveState(); renderSidebar(); renderPosts();
      };
      left.append(chip);
      const delBtn = el('button', {class:'icon-btn', title:'Remove subscription', 'aria-label':`Remove ${f.title||f.url}`}, '🗑');
      delBtn.onclick = (ev)=>{
        ev.stopPropagation();
        if(!confirm(`Remove subscription:\n${f.title||f.url}?`)) return;
        removeFeed(f.id);
      };
      row.append(left, delBtn);
      li.append(row);
      const activate = ()=>{
        // toggle behavior
        if(currentFilters.subscription === f.id){
          currentFilters.subscription = "";
          setActive(feedList, null);
        } else {
          currentFilters.subscription = f.id;
          // clear category when picking a subscription
          currentFilters.category = "";
          // clear tag when picking a subscription
          currentFilters.tag = "";
          setActive(feedList, li);
          setActive(byId('category-list'), null);
          const tl = byId('tag-list'); if(tl) setActive(tl, null);
        }
        // sync dropdowns
        byId('filter-subscription').value = currentFilters.subscription || "";
        byId('filter-category').value = "";
        if(byId('filter-tag')) byId('filter-tag').value = "";
        renderPosts();
      };
      li.addEventListener('click', activate);
      li.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); activate(); }});
      feedList.append(li);
    }
    // Categories are from state.categories union existing feed categories
    const catSet = new Set([...(state.categories||[]), ...state.feeds.map(f=>f.category).filter(Boolean)]);
    const catList = byId('category-list'); catList.innerHTML='';
    for(const c of catSet){
      const li = el('li', {role:'listitem', tabindex:0});
      const row = el('div', {class:'row'});
      const left = el('div', {class:'row-left'});
      const titleSpan = el('span', {class:'title', title:c}, c);
      left.append(titleSpan);
      const renameBtn = el('button', {class:'chip button', title:'Rename category', 'aria-label':`Rename category ${c}`}, 'Rename');
      renameBtn.onclick = ()=>{
        const newName = prompt('Rename category:', c);
        if(newName==null) return;
        const t = newName.trim(); if(!t) return;
        // update categories list
        state.categories = Array.from(new Set((state.categories||[]).map(x=> x===c? t : x)));
        // update all feeds with this category
        for(const f of state.feeds){ if((f.category||'')===c) f.category = t; }
        // update current filter if it was this category
        if((currentFilters.category||'')===c) currentFilters.category = t;
        saveState(); renderSidebar(); renderPosts();
      };
      const deleteBtn = el('button', {class:'icon-btn', title:'Delete category', 'aria-label':`Delete category ${c}`}, '🗑');
      deleteBtn.onclick = ()=>{
        if(!confirm(`Delete category "${c}"? Subscriptions will be uncategorized.`)) return;
        // remove from categories list
        state.categories = (state.categories||[]).filter(x=>x!==c);
        // unassign from feeds
        for(const f of state.feeds){ if((f.category||'')===c) f.category = ''; }
        // clear filter if active
        if((currentFilters.category||'')===c){ currentFilters.category=''; byId('filter-category').value=''; }
        saveState(); renderSidebar(); renderPosts();
      };
      row.append(left, renameBtn, deleteBtn);
      li.append(row);
      const activate = ()=>{
        const val = (c||'').trim();
        if((currentFilters.category||'') === val){
          currentFilters.category = "";
          setActive(catList, null);
        } else {
          currentFilters.category = val;
          // clear subscription when picking a category
          currentFilters.subscription = "";
          // clear tag when picking a category
          currentFilters.tag = "";
          setActive(catList, li);
          setActive(byId('feed-list'), null);
          const tl = byId('tag-list'); if(tl) setActive(tl, null);
        }
        // sync dropdowns
        byId('filter-category').value = currentFilters.category || "";
        byId('filter-subscription').value = "";
        if(byId('filter-tag')) byId('filter-tag').value = "";
        renderPosts();
      };
      li.addEventListener('click', activate);
      li.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); activate(); }});
      catList.append(li);
    }
    // filters dropdowns
    const subSel = byId('filter-subscription'); subSel.innerHTML = '<option value="">All Subscriptions</option>' + state.feeds.map(f=>`<option value="${f.id}" title="${escHtml(f.title||f.url)}">${escHtml(f.title||f.url)}</option>`).join('');
    const catSel = byId('filter-category'); catSel.innerHTML = '<option value="">All Categories</option>' + [...catSet].map(c=>`<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
    // Build tag set from state.tags
    const tagSet = new Set();
    for(const arr of Object.values(state.tags||{})){
      for(const t of (arr||[])){
        const v = String(t||'').trim(); if(v) tagSet.add(v);
      }
    }
    const tagSel = byId('filter-tag');
    if(tagSel){
      tagSel.innerHTML = '<option value="">All Tags</option>' + [...tagSet].sort((a,b)=>a.localeCompare(b)).map(t=>`<option value="${escHtml(t)}">${escHtml(t)}</option>`).join('');
    }
    // Sidebar tags list
    const tagList = byId('tag-list');
    if(tagList){
      tagList.innerHTML = '';
      for(const t of [...tagSet].sort((a,b)=>a.localeCompare(b))){
        const li = el('li', {role:'listitem', tabindex:0});
        const nameSpan = el('span', {}, t);
        li.append(nameSpan);
        const activate = ()=>{
          const val = (t||'').trim();
          if((currentFilters.tag||'') === val){
            currentFilters.tag = '';
            setActive(tagList, null);
          } else {
            currentFilters.tag = val;
            currentFilters.subscription = '';
            currentFilters.category = '';
            byId('filter-subscription').value = '';
            byId('filter-category').value = '';
            if(byId('filter-tag')) byId('filter-tag').value = val;
            setActive(tagList, li);
            setActive(byId('feed-list'), null);
            setActive(byId('category-list'), null);
          }
          renderPosts();
        };
        li.addEventListener('click', activate);
        li.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); activate(); }});
        tagList.append(li);
      }
    }
    byId('btn-add-category').onclick = ()=>{
      const name = prompt('New category name:'); if(!name) return;
      const t = name.trim(); if(!t) return;
      state.categories = Array.from(new Set([...(state.categories||[]), t]));
      saveState(); renderSidebar(); renderPosts();
    };
  }

  function removeFeed(feedId){
    // remove from feeds
    const feed = state.feeds.find(f=>f.id===feedId);
    state.feeds = state.feeds.filter(f=>f.id!==feedId);
    // remove posts belonging to this feed
    for(const pid of Object.keys(state.posts)){
      if(state.posts[pid]?.feedId === feedId){ delete state.posts[pid]; delete state.read[pid]; delete state.favorites[pid]; delete state.tags[pid]; }
    }
    // cleanup fetch tracking
    delete state.lastFetch[feedId];
    delete state.lastFetchUrl[feedId];
    // clear filters if pointing to this feed
    if(currentFilters.subscription === feedId){ currentFilters.subscription=''; byId('filter-subscription').value=''; }
    saveState();
    renderSidebar();
    renderPosts();
    updateEmptyState();
    if(feed) setBusy(false, `Removed: ${feed.title||feed.url}`);
  }
  function setActive(parent, li){
    if(!parent) return;
    [...parent.children].forEach(n=>{
      const active = (li && n===li) ? true : false;
      n.classList.toggle('active', active);
      if(active) n.setAttribute('aria-current','true'); else n.removeAttribute('aria-current');
    });
  }
  function escHtml(s){ return String(s).replace(/[&<>]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }

  // --------- Virtualized Rendering (windowing) ---------
  const vState = { active:false, items: [], total: 0, cols: 1, rowH: 300, start: 0, end: 0, topPad: 0, botPad: 0 };
  function recalcLayout(){
    const grid = byId('post-grid'); if(!grid) return;
    const minCard = 320; // match CSS minmax width
    const ww = grid.clientWidth || grid.offsetWidth || document.documentElement.clientWidth || window.innerWidth || 800;
    const cols = Math.max(1, Math.floor(ww / minCard));
    vState.cols = cols;
    const cardW = ww / cols;
    vState.rowH = Math.max(260, Math.round((cardW * 9/16) + 200)); // media + body estimate
  }
  function computeWindow(){
    const grid = byId('post-grid'); if(!grid) return;
    const pageY = window.scrollY || document.documentElement.scrollTop || 0;
    const gridTop = grid.getBoundingClientRect().top + pageY;
    const topY = Math.max(0, pageY - gridTop);
    const vh = window.innerHeight || document.documentElement.clientHeight || 800;
    const startRow = Math.floor(topY / vState.rowH);
    const rowsInView = Math.ceil(vh / vState.rowH) + 3; // overscan
    const startIdx = Math.max(0, startRow * vState.cols);
    const endIdx = Math.min(vState.total, startIdx + rowsInView * vState.cols);
    vState.start = startIdx; vState.end = endIdx;
    const rowsBefore = Math.floor(startIdx / vState.cols);
    const rowsAfter = Math.ceil((vState.total - endIdx) / vState.cols);
    vState.topPad = Math.max(0, rowsBefore * vState.rowH);
    vState.botPad = Math.max(0, rowsAfter * vState.rowH);
  }
  let rafPending = false;
  function onScrollRender(){
    if(!vState.active || !vState.items.length) return;
    if(rafPending) return; rafPending = true;
    requestAnimationFrame(()=>{
      rafPending = false;
      const grid = byId('post-grid'); if(!grid) return;
      const oldStart = vState.start, oldEnd = vState.end;
      computeWindow();
      // Update padders; verify they exist and are marked
      const first = grid.firstElementChild, last = grid.lastElementChild;
      if(!(first && last && first.dataset.pad==='top' && last.dataset.pad==='bot')) return;
      first.style.height = `${vState.topPad|0}px`;
      first.style.gridColumn = '1 / -1';
      last.style.height = `${vState.botPad|0}px`;
      last.style.gridColumn = '1 / -1';
      if(vState.start===oldStart && vState.end===oldEnd) return;
      // Remove old cards
      while(grid.children.length>2){ grid.removeChild(grid.children[1]); }
      // Insert new window
      const frag = document.createDocumentFragment();
      for(let i=vState.start;i<vState.end;i++){ const p=vState.items[i]; if(p) frag.append(postCard(p)); }
      grid.insertBefore(frag, last);
    });
  }

  function renderPosts(){
    const grid = byId('post-grid');
    // Reset virtualization by default; re-enable only when we choose the virtual path
    vState.active = false; vState.items = []; vState.total = 0;
    const all = Object.values(state.posts);
    let posts = all;
    // filters
    if(currentFilters.subscription) posts = posts.filter(p=>p.feedId===currentFilters.subscription);
    if(currentFilters.category){
      const cat = (currentFilters.category||'').trim().toLowerCase();
      const feedById = new Map((state.feeds||[]).map(f=> [f.id, f]));
      posts = posts.filter(p=> ((feedById.get(p.feedId)?.category||'').trim().toLowerCase() === cat));
    }
    if(currentFilters.tag){
      const sel = (currentFilters.tag||'').trim().toLowerCase();
      posts = posts.filter(p=> (state.tags[p.id]||[]).some(t=> (t||'').trim().toLowerCase() === sel));
    }
    if(currentFilters.unread) posts = posts.filter(p=>!state.read[p.id]);
    if(currentFilters.favorites) posts = posts.filter(p=>!!state.favorites[p.id]);

    // search
    const q = (byId('search-input').value||'').trim();
    if(q){
      // build vecs
  for(const p of posts){ if(!p._vec) p._vec = tfidf([p.title,p.summary,p.author,(state.tags[p.id]||[]).join(' '),stripHtml(p.content)].join(' ')); }
      const qVec = tfidf(q);
      const rx = safeRegex(q);
      const qSound = soundex(q);
      posts = posts.map(p=>({p, score: scorePost(p, q, qVec, qSound, rx)})).sort((a,b)=>b.score - a.score).map(x=>x.p).slice(0, 400);
    } else {
      // default sort: date desc
      posts = posts.sort((a,b)=> new Date(b.published||0) - new Date(a.published||0));
    }

    grid.innerHTML = '';
    if(!posts.length){ grid.append(el('div', {class:'empty-state'}, 'No posts match.')); return; }
    // For a small number of posts, render all (simpler)
    if(posts.length <= 60){ for(const p of posts){ grid.append(postCard(p)); } return; }
    // Virtualized window
    vState.active = true; vState.items = posts; vState.total = posts.length; recalcLayout(); computeWindow();
    grid.append(el('div', {style:`height:${vState.topPad|0}px; grid-column: 1 / -1; width:100%`, dataset:{pad:'top'}}));
    for(let i=vState.start;i<vState.end;i++){ const p=posts[i]; if(p) grid.append(postCard(p)); }
    grid.append(el('div', {style:`height:${vState.botPad|0}px; grid-column: 1 / -1; width:100%`, dataset:{pad:'bot'}}));
  }

  function postCard(p){
  const img = pickImage(p) || pickPlaceholder(p);
    const mediaEl = img ? el('img', {class:'media', src: img, alt:'', loading:'lazy', decoding:'async', onerror:(e)=>{ e.target.removeAttribute('onerror'); e.target.src = pickPlaceholder(p); }}) : el('img', {class:'media', src: pickPlaceholder(p), alt:'', loading:'lazy', decoding:'async'});
    const card = el('article', {class:'card', tabindex:0});
    if(mediaEl) card.append(mediaEl);
    const body = el('div', {class:'body'});
    body.append(el('h4', {}, p.title||'(untitled)'));
    let host = '';
    try{ host = new URL(p.link||'#', location.href).hostname; }catch{ host=''; }
    body.append(el('div', {class:'meta'}, [ el('span', {}, host), ' • ', fmtDate(p.published) ]));
    body.append(el('div', {class:'excerpt'}, p.summary||stripHtml(p.content).slice(0,200)));
    const tags = el('div', {class:'tags'}, (state.tags[p.id]||[]).map(t=> el('span', {class:'tag'}, t)));
    const actions = el('div', {class:'actions'}, [
      el('button', {class:'favorite '+(state.favorites[p.id]?'active':''), title:'Favorite', 'aria-pressed': String(!!state.favorites[p.id]), onclick:()=>toggleFavorite(p.id)}, '★'),
      el('button', {title: state.read[p.id]? 'Mark Unread' : 'Mark Read', 'aria-pressed': String(!!state.read[p.id]), onclick:()=>toggleRead(p.id)}, state.read[p.id]? 'Unread' : 'Read'),
      el('span', {class:'spacer'}),
      el('button', {title:'Open post', 'aria-label':'Open post', onclick:()=>openPost(p)}, 'Open')
    ]);
    body.append(tags, actions);
    card.append(body);
    card.addEventListener('click', (e)=>{
      if(e.target.closest('button')) return; openPost(p);
    });
    return card;
  }

  function pickImage(p){
    // try media list first
    const img = p.media?.find(m=> (m.type||'').startsWith('image/') )?.url;
  if(img){
    const safe = safeImageUrl(img); if(safe) return safe;
  }
    // parse img from content
    const m = /<img[^>]+src=["']([^"']+)["']/i.exec(p.content||'');
    if(m){
      const safe = safeImageUrl(m[1]);
      return safe || null;
    }
    return null;
  }

  // --------- URL Safety Helpers ---------
  function isPrivateHost(host){
    if(!host) return true;
    host = host.toLowerCase();
    if(host === 'localhost' || host === '::1') return true;
    // IPv4 patterns
    if(/^127\./.test(host)) return true; // loopback
    if(/^10\./.test(host)) return true;  // private
    if(/^192\.168\./.test(host)) return true; // private
    const m172 = /^172\.(\d+)\./.exec(host); if(m172){ const o = Number(m172[1]); if(o>=16 && o<=31) return true; }
    // RFC1918 / link-local / other special-use could be added here
    return false;
  }
  function safeImageUrl(src){
    try{
      if(!src) return null;
      const u = new URL(src, location.href);
      const prot = (u.protocol||'').toLowerCase();
      if(!(prot==='http:'||prot==='https:'||prot==='data:'||prot==='blob:')) return null;
      if(prot==='http:'||prot==='https:'){ if(isPrivateHost(u.hostname)) return null; }
      // Upgrade http -> https by default; only allow http if same-origin (not typical for feeds) — we drop instead of returning http
      if(prot==='http:'){
        try{
          u.protocol = 'https:';
          return u.href; // optimistic upgrade
        }catch{ return null; }
      }
      return u.href;
    }catch{ return null; }
  }
  function safeMediaUrl(src){
    try{
      if(!src) return null;
      const u = new URL(src, location.href);
      const prot = (u.protocol||'').toLowerCase();
      if(!(prot==='http:'||prot==='https:'||prot==='data:'||prot==='blob:')) return null;
      if(prot==='http:'||prot==='https:'){ if(isPrivateHost(u.hostname)) return null; }
      if(prot==='http:'){
        try{ u.protocol='https:'; return u.href; }catch{ return null; }
      }
      return u.href;
    }catch{ return null; }
  }

  // --------- Placeholder Images ---------
  const placeholderCache = new Map(); // postId -> dataUrl
  function pickPlaceholder(p){
    const key = p.id || hashId((p.title||'') + '|' + (p.link||''));
    if(placeholderCache.has(key)) return placeholderCache.get(key);
    const dataUrl = generatePatternPlaceholder(key, p.title||'');
    placeholderCache.set(key, dataUrl);
    return dataUrl;
  }
  function h32(str){
    let h = 2166136261>>>0; for(let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h>>>0;
  }
  function pickColors(seed){
    // Simple HSL pairs with good contrast
    const h1 = seed % 360;
    const h2 = (h1 + 180 + ((seed>>7)%40)-20) % 360; // roughly opposite, some jitter
    const c1 = `hsl(${h1} 65% 50%)`;
    const c2 = `hsl(${h2} 40% 18%)`;
    return [c1,c2];
  }
  function generatePatternPlaceholder(key, label){
    const seed = h32(String(key));
    const [fg,bg] = pickColors(seed);
    const type = ['dots','squares','tri','stripes'][seed % 4];
    const size = 80; // tile size
    let defs = '';
    let content = '';
    if(type==='dots'){
      defs = `<pattern id="p" width="${size}" height="${size}" patternUnits="userSpaceOnUse" patternTransform="translate(0,0)">
        <rect width="100%" height="100%" fill="${bg}"/>
        <circle cx="${size/2}" cy="${size/2}" r="${Math.max(6, (seed%12)+6)}" fill="${fg}"/>
      </pattern>`;
      content = `<rect width="100%" height="100%" fill="url(#p)"/>`;
    } else if(type==='squares'){
      defs = `<pattern id="p" width="${size}" height="${size}" patternUnits="userSpaceOnUse">
        <rect width="100%" height="100%" fill="${bg}"/>
        <rect x="10" y="10" width="${size/2}" height="${size/2}" fill="${fg}" opacity="0.8"/>
      </pattern>`;
      content = `<rect width="100%" height="100%" fill="url(#p)"/>`;
    } else if(type==='tri'){
      defs = `<pattern id="p" width="${size}" height="${size}" patternUnits="userSpaceOnUse">
        <rect width="100%" height="100%" fill="${bg}"/>
        <polygon points="0,${size} ${size/2},0 ${size},${size}" fill="${fg}" opacity="0.8"/>
      </pattern>`;
      content = `<rect width="100%" height="100%" fill="url(#p)"/>`;
    } else { // stripes
      const angle = (seed % 60) - 30;
      defs = `<pattern id="p" width="${size}" height="${size}" patternUnits="userSpaceOnUse" patternTransform="rotate(${angle})">
        <rect width="100%" height="100%" fill="${bg}"/>
        <rect y="0" width="${size/3}" height="${size}" fill="${fg}"/>
      </pattern>`;
      content = `<rect width="100%" height="100%" fill="url(#p)"/>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" preserveAspectRatio="xMidYMid slice">
      <defs>${defs}</defs>${content}
      <rect width="100%" height="100%" fill="transparent"/>
    </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  function openPost(p){
    // fill modal
    byId('post-view-title').textContent = p.title||'(untitled)';
    let host='';
    try{ host = new URL(p.link||'#', location.href).hostname; }catch{ host=''; }
    byId('post-view-meta').textContent = `${fmtDate(p.published)} • ${host}`;
    const mediaWrap = byId('post-view-media'); mediaWrap.innerHTML='';
  const img = pickImage(p) || pickPlaceholder(p); if(img) mediaWrap.append(el('img', {src: img, alt:'', loading:'lazy', decoding:'async', referrerpolicy:'no-referrer'}));
    // audio/video from media list
    for(const m of p.media||[]){
      const u = safeMediaUrl(m.url);
      if(!u) continue;
      if((m.type||'').startsWith('audio/')) mediaWrap.append(el('audio', {src:u, controls:true}));
      if((m.type||'').startsWith('video/')) mediaWrap.append(el('video', {src:u, controls:true, style:'max-width:100%'}));
    }
  const content = byId('post-view-content'); content.innerHTML = sanitizeHtml(p.content||'');
  // Post-process sanitized content: lazy-load images and add privacy-friendly referrer policy
  try{ content.querySelectorAll('img').forEach(img=>{ img.loading='lazy'; img.decoding='async'; img.referrerPolicy='no-referrer'; }); }catch{}
    const tags = byId('post-view-tags'); tags.innerHTML = '';
    (state.tags[p.id]||[]).forEach(t=> tags.append(tagChip(p.id, t)) );
    const favBtn = byId('post-view-fav'); favBtn.classList.toggle('active', !!state.favorites[p.id]); favBtn.textContent = state.favorites[p.id]? '★ Favorited' : '☆ Favorite';
    const openA = byId('post-view-open');
    openA.href = p.link||'#';
    openA.setAttribute('rel','noopener noreferrer');
    openA.setAttribute('target','_blank');
  const modal = byId('modal-post');
  const prevFocus = document.activeElement;
  modal.showModal();
    // mark read on open
    state.read[p.id] = true; saveState(); renderPosts();
    // handlers
    favBtn.onclick = ()=>{ toggleFavorite(p.id); favBtn.classList.toggle('active', !!state.favorites[p.id]); favBtn.textContent = state.favorites[p.id]? '★ Favorited' : '☆ Favorite'; };
    const input = byId('post-view-tag-input'); input.value='';
    input.onkeydown = (e)=>{
      if(e.key==='Enter'){
        const val = input.value.trim(); if(val){ addTag(p.id, val); input.value=''; tags.append(tagChip(p.id, val)); /* addTag re-renders sidebar+posts */ }
      }
    };
    const closeBtn = byId('post-close-btn');
    if(closeBtn){
      closeBtn.onclick = ()=>{ modal.close(); if(prevFocus && prevFocus.focus) prevFocus.focus(); };
    }
    // Time offset links: handle #t=1:23, #t=83, and text forms like 1h2m3s in href
    const mediaEls = mediaWrap.querySelectorAll('audio,video');
    if(mediaEls.length){
      content.addEventListener('click', (e)=>{
        const a = e.target.closest && e.target.closest('a'); if(!a) return;
        const href = a.getAttribute('href')||'';
        const t = parseTimeOffsetFromHref(href);
        if(t != null && isFinite(t) && t >= 0){
          e.preventDefault();
          mediaEls.forEach(m=>{ try{ m.currentTime = t; if(m.paused && m.play) m.play(); }catch{} });
        }
  });
    }
  }
  function tagChip(postId, tag){
  const x = el('button', {title:`Remove tag ${tag}`, 'aria-label':`Remove tag ${tag}`, onclick:()=>{ removeTag(postId, tag); renderPosts(); x.parentElement.remove(); }}, '×');
    return el('span', {class:'tag'}, tag, ' ', x);
  }
  function sanitizeHtml(html){
    // very light allowlist: b,i,em,strong,a,p,ul,ol,li,br,img,pre,code,blockquote
    const t = document.createElement('div'); t.innerHTML = html||'';
    t.querySelectorAll('*').forEach(n=>{
      const name = n.nodeName.toLowerCase();
      const allowed = ['b','i','em','strong','a','p','ul','ol','li','br','img','pre','code','blockquote','h1','h2','h3','h4'];
      if(!allowed.includes(name)) n.replaceWith(...n.childNodes);
      else{
        // strip dangerous attrs
        [...n.attributes].forEach(a=>{
          const ok = ['href','src','alt','title'];
          const aname = a.name.toLowerCase();
          if(!ok.includes(aname)) n.removeAttribute(aname);
        });
        if(name==='a'){
          // Force safe link attributes
          n.setAttribute('target','_blank'); n.setAttribute('rel','noopener noreferrer');
          // Enforce safe href schemes (allow http, https, mailto, magnet, relative, and #anchors)
          const href = (n.getAttribute('href')||'').trim();
          if(href){
            let safe = false;
            if(href.startsWith('#')) safe = true;
            else{
              try{
                const u = new URL(href, location.href);
                const prot = (u.protocol||'').toLowerCase();
                if(prot==='http:'||prot==='https:'||prot==='mailto:'||prot==='magnet:') safe = true;
              }catch{ /* relative without base or invalid */ safe = false; }
            }
            if(!safe) n.removeAttribute('href');
          }
        }
        if(name==='img'){
          // Enforce safe src schemes and strip srcset
          n.removeAttribute('srcset');
          const src = (n.getAttribute('src')||'').trim();
          if(src){
            const safe = safeImageUrl(src);
            if(!safe) n.removeAttribute('src'); else n.setAttribute('src', safe);
          }
        }
      }
    });
    return t.innerHTML;
  }

  // Parse time offset from a link href like "#t=1:23", "#t=83", "?t=1m23s", "?t=83"
  function parseTimeOffsetFromHref(href){
    if(!href) return null;
    try{
      if(href.startsWith('#')){
        const m = /[#&?]t=([^&#]+)/i.exec(href);
        if(m) return parseTimeString(m[1]);
      } else {
        const u = new URL(href, location.href);
        const tParam = u.searchParams.get('t') || u.searchParams.get('start') || u.searchParams.get('time');
        if(tParam) return parseTimeString(tParam);
      }
    }catch{}
    return null;
  }
  // Accept formats: ss, mm:ss, hh:mm:ss, 90s, 2m3s, 1h2m3s
  function parseTimeString(s){
    if(!s) return null;
    s = String(s).trim();
    // 1) Units format
    const um = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(s);
    if(um){ const h=Number(um[1]||0), m=Number(um[2]||0), sec=Number(um[3]||0); return h*3600 + m*60 + sec; }
    // 2) mm:ss or hh:mm:ss
    const cm = /^([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?$/.exec(s);
    if(cm){ const a=cm.slice(1).filter(Boolean).map(Number); return a.length===3 ? a[0]*3600+a[1]*60+a[2] : a[0]*60+a[1]; }
    // 3) plain seconds number
    if(/^\d+$/.test(s)) return Number(s);
    return null;
  }

  // --------- Interactions ---------
  function toggleRead(id){ state.read[id] = !state.read[id]; saveState(); renderPosts(); }
  function toggleFavorite(id){ state.favorites[id] = !state.favorites[id]; saveState(); renderPosts(); }
  function addTag(id, tag){
    const s = new Set(state.tags[id]||[]); s.add(tag);
    state.tags[id] = [...s];
    saveState();
    // Refresh sidebar so new tag appears immediately
    renderSidebar();
    renderPosts();
  }
  function removeTag(id, tag){
    const arr = state.tags[id]||[];
    const s = new Set(arr); s.delete(tag);
    const next = [...s];
    if(next.length) state.tags[id] = next; else delete state.tags[id];
    saveState();
    // Refresh sidebar so tag disappears when unused
    renderSidebar();
    renderPosts();
  }

  // --------- Schedules ---------
  let refreshTimer = 0;
  let lastProxiesUsed = new Set();
  const PROXY_COOLDOWN_MS = 2*60*1000; // cool down proxies after 429 for 2 minutes
  const proxyCooldown = new Map(); // name -> untilTs
  function scheduleRefresh(){
    if(refreshTimer) clearInterval(refreshTimer);
    const min = clamp(Number(state.refreshMinutes)||30, 5, 360);
    refreshTimer = setInterval(()=>{
      refreshAll().catch(console.error);
    }, min*60*1000);
  }

  async function refreshAll(force=false){
    setBusy(true, force ? 'Refreshing (force)…' : 'Refreshing…');
    lastProxiesUsed = new Set();
    let failed = 0;
    let metaChangedAny = false;
    const minInterval = clamp((state.refreshMinutes||30)*60*1000, 5*60*1000, 24*60*60*1000);
    const now = Date.now();
    for(const feed of state.feeds){
      const last = state.lastFetch[feed.id]||0;
      if(!force && now - last < minInterval) {
        continue; // throttle: recently fetched
      }
      try{ const changed = await refreshFeed(feed); if(changed) metaChangedAny = true; }
      catch(e){ console.warn('Failed feed', feed.url, e); failed++; }
    }
    // Save once after all feeds processed (posts not persisted, but settings/lastFetch are)
    saveState();
    renderPosts();
    if(metaChangedAny) renderSidebar();
    const used = [...lastProxiesUsed];
    let msg = used.length ? `Refreshed via: ${used.join(', ')}` : 'Refreshed';
    if(failed) msg += ` (failed: ${failed})`;
    setBusy(false, msg);
  }

  function setBusy(b, msg){ byId('post-grid').setAttribute('aria-busy', String(!!b)); text(byId('status-text'), msg||''); }

  function updateEmptyState(){
    const empty = !state.feeds?.length;
    byId('empty-state').hidden = !empty;
  }

  // --------- Wire UI ---------
  const currentFilters = { subscription:"", category:"", tag:"", unread:false, favorites:false };

  function initUI(){
    // theme
    const themeSel = byId('theme-select'); themeSel.value = state.theme||'system';
    themeSel.onchange = ()=>{ state.theme = themeSel.value; saveState(); applyTheme(state.theme); };
    applyTheme(state.theme);
    const themeBtn = byId('btn-theme-toggle');
    if(themeBtn){
      themeBtn.addEventListener('click', ()=>{
        const order = ['system','light','dark'];
        const idx = Math.max(0, order.indexOf(state.theme||'system'));
        const next = order[(idx+1)%order.length];
        state.theme = next; saveState(); applyTheme(state.theme);
        if(themeSel) themeSel.value = state.theme;
      });
    }

    // filters
    byId('filter-subscription').onchange = (e)=>{
      currentFilters.subscription = e.target.value || "";
      if(currentFilters.subscription){
        currentFilters.category = ""; byId('filter-category').value = ""; setActive(byId('category-list'), null);
        currentFilters.tag = ""; if(byId('filter-tag')) byId('filter-tag').value = ""; const tl = byId('tag-list'); if(tl) setActive(tl, null);
      }
      // reflect active state in sidebar
      const feedList = byId('feed-list');
      if(currentFilters.subscription){
        const idx = (state.feeds||[]).findIndex(f=>f.id===currentFilters.subscription);
        setActive(feedList, feedList.children[idx]||null);
      } else setActive(feedList, null);
      renderPosts(); onScrollRender();
    };
    byId('filter-category').onchange = (e)=>{
      currentFilters.category = (e.target.value||"").trim();
      if(currentFilters.category){
        currentFilters.subscription = ""; byId('filter-subscription').value = ""; setActive(byId('feed-list'), null);
        currentFilters.tag = ""; if(byId('filter-tag')) byId('filter-tag').value = ""; const tl = byId('tag-list'); if(tl) setActive(tl, null);
      }
      // reflect active state in sidebar
      const catList = byId('category-list');
      if(currentFilters.category){
        const items = Array.from(catList.children);
        const idx = items.findIndex(li=> (li.firstChild?.textContent||'').trim() === currentFilters.category);
        setActive(catList, items[idx]||null);
      } else setActive(catList, null);
      renderPosts(); onScrollRender();
    };
  byId('filter-unread').onchange = (e)=>{ currentFilters.unread = e.target.checked; renderPosts(); onScrollRender(); };
  byId('filter-favorites').onchange = (e)=>{ currentFilters.favorites = e.target.checked; renderPosts(); onScrollRender(); };
    const tagSel2 = byId('filter-tag');
    if(tagSel2){
      tagSel2.onchange = (e)=>{
        currentFilters.tag = (e.target.value||'').trim();
        if(currentFilters.tag){
          currentFilters.subscription = '';
          currentFilters.category = '';
          byId('filter-subscription').value = '';
          byId('filter-category').value = '';
          setActive(byId('feed-list'), null);
          setActive(byId('category-list'), null);
          const tl = byId('tag-list');
          if(tl){
            const items = Array.from(tl.children);
            const idx = items.findIndex(li=> (li.firstChild?.textContent||'').trim() === currentFilters.tag);
            setActive(tl, items[idx]||null);
          }
        } else {
          const tl = byId('tag-list'); if(tl) setActive(tl, null);
        }
        renderPosts(); onScrollRender();
      };
    }

    // search
  byId('btn-search').onclick = ()=> { renderPosts(); onScrollRender(); };
  byId('btn-clear').onclick = ()=>{ byId('search-input').value=''; renderPosts(); onScrollRender(); };
  byId('search-input').addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ renderPosts(); onScrollRender(); } });

    // import/export
    byId('btn-import').onclick = ()=> byId('opml-file-input').click();
    byId('opml-file-input').onchange = async (e)=>{
      const file = e.target.files[0]; if(!file) return;
      const txt = await file.text(); importOPMLText(txt);
    };
    byId('btn-export').onclick = exportOPML;

    // Edit OPML
    byId('btn-edit-opml').onclick = ()=>{
      const body = state.feeds.map(f=>`    <outline type="rss" text="${escXml(f.title||f.url)}" xmlUrl="${escXml(f.url)}" ${f.siteUrl?`htmlUrl="${escXml(f.siteUrl)}"`:''} ${f.category?`category="${escXml(f.category)}"`:''} />`).join("\n");
      byId('opml-editor').value = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<opml version=\"2.0\">\n  <head><title>Feed Cycle Subscriptions</title></head>\n  <body>\n${body}\n  </body>\n</opml>`;
      byId('modal-opml').showModal();
    };
    byId('btn-save-opml').onclick = ()=>{
      const txt = byId('opml-editor').value; importOPMLText(txt); byId('modal-opml').close();
    };

    // settings
    byId('btn-settings').onclick = ()=>{
      byId('setting-refresh-min').value = state.refreshMinutes;
      byId('setting-cache-maxage').value = state.cacheMaxAgeMinutes;
      byId('setting-cors-proxy').value = state.corsProxy||'';
      byId('modal-settings').showModal();
    };
    byId('btn-save-settings').onclick = ()=>{
      state.refreshMinutes = Number(byId('setting-refresh-min').value)||30;
      state.cacheMaxAgeMinutes = Number(byId('setting-cache-maxage').value)||60;
      state.corsProxy = byId('setting-cors-proxy').value.trim();
      saveState(); scheduleRefresh();
    };
    byId('btn-clear-data').onclick = async ()=>{
      const confirmed = window.confirm('This will erase all saved Feed Cycle data (feeds, posts cache, filters).\nTheme is kept. Continue?');
      if(!confirmed){
        return;
      }
      // 1) Clear LocalStorage snapshot
      try{ localStorage.removeItem(LS_KEY); }catch{}
      // 2) Clear Cache API entries used by the app
      try{
        if(typeof caches !== 'undefined' && caches?.keys){
          const keys = await caches.keys();
          await Promise.all(keys.filter(k=> k.startsWith('feed-cycle-cache')).map(k=> caches.delete(k)));
        }
      }catch(e){ console.warn('Cache clear failed', e); }
      // 3) Reset runtime state to defaults (preserving current theme)
      const currentTheme = state.theme;
      state = { ...DEFAULTS, theme: currentTheme, posts: {} };
      // Also reset in-memory helpers
      try{ if(typeof placeholderCache !== 'undefined' && placeholderCache.clear) placeholderCache.clear(); }catch{}
      try{ vState.active = false; vState.items = []; vState.total = 0; }catch{}
      // 4) Re-render UI to empty and clear posts grid immediately
      renderSidebar();
      renderPosts();
      updateEmptyState();
      // Optionally reset filters/search UI
      try{
        byId('filter-subscription').value = '';
        byId('filter-category').value = '';
        if(byId('filter-tag')) byId('filter-tag').value = '';
        byId('filter-unread').checked = false;
        byId('filter-favorites').checked = false;
        byId('search-input').value = '';
      }catch{}
      byId('modal-settings').close();
      setBusy(false, 'Cleared saved data and cache.');
    };

    // misc
  byId('btn-refresh').onclick = (e)=> refreshAll(!!e.shiftKey);
    // Sidebar drawer (mobile)
    const sidebar = byId('sidebar');
    const backdrop = byId('sidebar-backdrop');
    const toggleBtn = byId('btn-toggle-sidebar');
    function openSidebar(){ sidebar.classList.add('open'); backdrop.hidden = false; toggleBtn.setAttribute('aria-expanded','true'); document.body.style.overflow='hidden'; }
    function closeSidebar(){ sidebar.classList.remove('open'); backdrop.hidden = true; toggleBtn.setAttribute('aria-expanded','false'); document.body.style.overflow=''; }
    if(toggleBtn){ toggleBtn.onclick = ()=>{ if(sidebar.classList.contains('open')) closeSidebar(); else openSidebar(); }; }
    if(backdrop){ backdrop.onclick = closeSidebar; }
    // Close drawer on ESC (listener exists; integrate here)
    window.addEventListener('keydown', (e)=>{ if(e.key==='Escape'){ closeSidebar(); } });
    // Reset on resize to desktop
    window.addEventListener('resize', ()=>{ if(window.innerWidth>900) closeSidebar(); });
    byId('get-sample-opml').onclick = async ()=>{
      const txt = SAMPLE_OPML; importOPMLText(txt); await refreshAll();
    };
    byId('btn-add-feed').onclick = async ()=>{
      const url = prompt('Enter feed URL (RSS/Atom):'); if(!url) return;
      const f = { id: hashId(url), url, title: url, siteUrl:'', category:'' };
      state.feeds.push(f); saveState(); renderSidebar(); updateEmptyState();
      try{
        const changed = await refreshFeed(f);
        if(changed){ saveState(); renderSidebar(); }
      }catch(e){ alert('Failed to fetch feed. You may need a CORS proxy in Settings.'); }
      renderPosts();
    };

    // Ensure media stops when closing the post modal (via Close button or Esc)
    const postModal = byId('modal-post');
    const stopModalMedia = ()=>{
      try{
        postModal.querySelectorAll('audio,video').forEach(m=>{
          try{ m.pause(); }catch{}
          try{ m.currentTime = 0; }catch{}
          try{ m.removeAttribute('src'); m.load(); }catch{}
        });
      }catch{}
    };
    postModal.addEventListener('close', stopModalMedia);

  function setActive(parent, li){
    [...parent.children].forEach(n=>{
      const active = n===li;
      n.classList.toggle('active', active);
      if(active) n.setAttribute('aria-current','true'); else n.removeAttribute('aria-current');
    });
  }
    // keyboard
    window.addEventListener('keydown', (e)=>{
      if(e.key==='r' && !e.metaKey && !e.ctrlKey){ refreshAll(!!e.shiftKey); }
    });
    window.addEventListener('keydown', (e)=>{
      if(e.key === 'Escape'){
        document.querySelectorAll('dialog[open]').forEach(d=> d.close());
      }
    });
  }

  // --------- Sample OPML ---------
  const SAMPLE_OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Sample</title></head>
  <body>
    <outline text="BBC World" type="rss" xmlUrl="https://feeds.bbci.co.uk/news/world/rss.xml" category="News"/>
    <outline text="NASA Image of the Day" type="rss" xmlUrl="https://www.nasa.gov/rss/dyn/lg_image_of_the_day.rss" category="Space"/>
    <outline text="Hacker News" type="rss" xmlUrl="https://news.ycombinator.com/rss" category="Tech"/>
    <outline text="The Verge" type="rss" xmlUrl="https://www.theverge.com/rss/index.xml" category="Tech"/>
    <outline text="Syntax FM" type="rss" xmlUrl="https://feed.syntax.fm/rss" category="Podcasts"/>
    <outline text="Darknet Diaries" type="rss" xmlUrl="https://podcast.darknetdiaries.com/" category="Podcasts"/>
    <outline text="Risky Business" type="rss" xmlUrl="https://risky.biz/feeds/risky-business" category="Podcasts"/>
    <outline text="Risky Business News" type="rss" xmlUrl="https://risky.biz/feeds/risky-business-news" category="Podcasts"/>
    <outline text="BleepingComputer" type="rss" xmlUrl="https://www.bleepingcomputer.com/feed/" category="Tech"/>
    <outline text="The Lovecraft Investigations" type="rss" xmlUrl="https://podcasts.files.bbci.co.uk/p06spb8w.rss" category="Podcasts"/>
  <outline text="Graham Cluley" type="rss" xmlUrl="https://grahamcluley.com/feed/" category="Tech"/>
    <!-- Bylines Network -->
    <outline text="Bylines Cymru" type="rss" xmlUrl="https://bylines.cymru/feed/" category="Bylines"/>
    <outline text="Bylines Scotland" type="rss" xmlUrl="https://bylines.scot/feed/" category="Bylines"/>
    <outline text="Central Bylines" type="rss" xmlUrl="https://centralbylines.co.uk/feed/" category="Bylines"/>
    <outline text="East Anglia Bylines" type="rss" xmlUrl="https://eastangliabylines.co.uk/feed/" category="Bylines"/>
    <outline text="Kent and Surrey Bylines" type="rss" xmlUrl="https://kentandsurreybylines.co.uk/feed/" category="Bylines"/>
    <outline text="North East Bylines" type="rss" xmlUrl="https://northeastbylines.co.uk/feed/" category="Bylines"/>
    <outline text="North West Bylines" type="rss" xmlUrl="https://northwestbylines.co.uk/feed/" category="Bylines"/>
    <outline text="Sussex Bylines" type="rss" xmlUrl="https://sussexbylines.co.uk/feed/" category="Bylines"/>
    <outline text="West England Bylines" type="rss" xmlUrl="https://westenglandbylines.co.uk/feed/" category="Bylines"/>
    <outline text="Yorkshire Bylines" type="rss" xmlUrl="https://yorkshirebylines.co.uk/feed/" category="Bylines"/>
  </body>
</opml>`;

  // --------- Init ---------
  async function start(){
    initUI();
    migrateFeeds();
    renderSidebar();
    updateEmptyState();
    scheduleRefresh();
    // Hint for local file:// CORS restrictions
    try{
      if(location.protocol === 'file:'){
        setBusy(false, 'Tip: CORS may block some feeds when opened as file://. Use a local server or set a CORS proxy in Settings.');
      }
    }catch{}
    if(state.feeds.length){
      const count = await hydrateFromCache();
      // Refresh only feeds needing it (throttle applies). If nothing hydrated (e.g., Cache API unavailable), force once to populate.
      if(count>0) refreshAll(false); else refreshAll(true);
    }
  }

  document.addEventListener('DOMContentLoaded', start);
  window.addEventListener('scroll', onScrollRender, { passive:true });
  window.addEventListener('resize', ()=>{ recalcLayout(); onScrollRender(); }, { passive:true });
})();
