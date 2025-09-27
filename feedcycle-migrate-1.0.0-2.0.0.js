'use strict';

(function(global){
  const V1_STORAGE_KEY = 'feedcycle';
  const V2_STORAGE_KEY = 'feedcycle-v2';
  const MARKER_KEY = 'feedcycle-migrated-v1';

  function readJSON(key){
    try{
      const raw = localStorage.getItem(key);
      if(!raw) return null;
      return JSON.parse(raw);
    }catch{
      return null;
    }
  }

  function writeJSON(key, value){
    try{ localStorage.setItem(key, JSON.stringify(value)); }
    catch(e){ console.warn('[FeedCycle v2] Migration store failed', e); }
  }

  function removeKey(key){
    try{ localStorage.removeItem(key); }
    catch(e){ console.warn('[FeedCycle v2] Migration cleanup failed', e); }
  }

  function migrateFeeds(){
    if(typeof localStorage === 'undefined') return null;
    try{
      if(localStorage.getItem(MARKER_KEY)) return null;
    }catch{return null; }

    const v2Data = readJSON(V2_STORAGE_KEY);
    if(v2Data && Array.isArray(v2Data.feeds) && v2Data.feeds.length){
      return null;
    }

    const v1Data = readJSON(V1_STORAGE_KEY);
    if(!v1Data || !Array.isArray(v1Data.feeds) || !v1Data.feeds.length){
      removeKey(V1_STORAGE_KEY);
      try{ localStorage.setItem(MARKER_KEY, '1'); }catch{}
      return null;
    }

    const migratedFeeds = v1Data.feeds.map(f=>({
      id: f.id || hashId(f.url||''),
      url: f.url,
      title: f.title || f.url,
      category: f.category || ''
    })).filter(f=> f.url);

    if(!migratedFeeds.length){
      removeKey(V1_STORAGE_KEY);
      try{ localStorage.setItem(MARKER_KEY, '1'); }catch{}
      return null;
    }

    const target = Object.assign({
      theme: 'system',
      feeds: [],
      categories: [],
      lastFetch: {},
      lastFetchUrl: {},
      settings: { refreshMinutes:30, cacheMaxAgeMinutes:60, corsProxy:'' },
      read: {},
      favorites: {},
      tags: {},
      autoTags: {}
    }, v2Data||{});

    const dedup = new Map();
    [...(target.feeds||[]), ...migratedFeeds].forEach(f=>{
      if(!f || !f.url) return;
      const key = (f.url||'').trim().toLowerCase();
      if(!key) return;
      if(!dedup.has(key)) dedup.set(key, {
        id: f.id || hashId(f.url||key),
        url: f.url,
        title: f.title || f.url,
        category: f.category || ''
      });
    });
    target.feeds = Array.from(dedup.values());

    writeJSON(V2_STORAGE_KEY, target);
    removeKey(V1_STORAGE_KEY);
    try{ localStorage.setItem(MARKER_KEY, '1'); }catch{}

    return { migratedFeeds: target.feeds.length };
  }

  function hashId(source){
    if(!source){
      return Math.random().toString(36).slice(2,10);
    }
    let h=2166136261>>>0;
    for(let i=0;i<source.length;i++){
      h ^= source.charCodeAt(i);
      h = Math.imul(h,16777619);
    }
    return (h>>>0).toString(36);
  }

  global.feedcycleMigrateV1toV2 = {
    run: migrateFeeds
  };
})(window);
