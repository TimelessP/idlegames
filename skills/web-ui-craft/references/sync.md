# Multi-user sync to a shared record (ETag / If-Match)

Backend assumed: `GET /kv/<id>` returns `{ value: "<json string>" }` with an `ETag` header. `PUT /kv/<id>` takes a `text/plain` body with `If-Match` and answers 409 or 412 on a version mismatch. The same ideas fit any compare-and-swap store.

## Principles (each one was a real bug)

1. **Never refuse to save.** "Changed elsewhere, refresh to merge" loses someone's work. Instead: read, merge, write, and retry on 409/412 (up to about 4 attempts).
2. **Remote wins except where this device has unsaved changes.** Track exactly what is unsaved.
3. **Versioned dirty marks.** With a plain set of dirty keys, a keystroke made while a save was in flight was marked clean when that save finished, and lost. Store a sequence number per key and clear a key only if it hasn't changed since the save was taken.
4. **Text is merged three ways** (base, mine, theirs), so two people typing in different places both survive. If they edit the same span, keep both versions and tell them.
5. **Insert others' text without moving the writer's caret.**
6. **Independent loops are independent.** Change-checking started only after the first live-feed call returned; on the real server that call hung, so devices never saw each other's edits. Start every loop on its own.
7. **Every request has a timeout**, or one stuck connection freezes the busy flag forever.
8. **Catch up** on `visibilitychange`, `focus`, `online` and `pageshow`. Mobile browsers throttle timers in the background.
9. **Make sync visible:** "Shared on Desk 1111 · last edited 14:41 · checked for changes 14:46:46", or the reason it can't sync. A silent failure is the worst kind.
10. **Old clients:** add fields only as optional, keep writing legacy fields, and keep data that an old client's write dropped.

## Request helper

```js
function tfetch(url, opts = {}, ms = 15000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  return fetch(url, { ...opts, signal: ac.signal })
    .catch(e => { throw e.name === 'AbortError' ? new Error('timed out') : e; })
    .finally(() => clearTimeout(t));
}
const sameOrigin = u => { try { return new URL(u, location.href).origin === location.origin; } catch (e) { return false; } };
// cache:'no-store' adds Cache-Control/Pragma request headers -> a CORS preflight cross-origin. Use it same-origin only.
const r = await tfetch(u, { headers: authH(), ...(sameOrigin(u) ? { cache: 'no-store' } : {}) });
```

## Dirty marks

```js
const KV = {
  seq: 0, dirty: new Map(),                      // 'kind:key' -> seq
  mark(kind, key = '') { this.dirty.set(`${kind}:${key}`, ++this.seq); },
  keys(kind) { const out = new Set(), pre = kind + ':'; for (const k of this.dirty.keys()) if (k.startsWith(pre)) out.add(k.slice(pre.length)); return out; },
  isDirty() { return this.dirty.size > 0; },
  isDirtyKey(kind, key = '') { return this.dirty.has(`${kind}:${key}`); },
  takeDirty() { return new Map(this.dirty); },
  clearDirty(t) { for (const [k, n] of t) if (this.dirty.get(k) === n) this.dirty.delete(k); },  // keeps re-edited keys
};
// kinds used in Tiny ATC: e event, c card, o comment, s stamp, x discarded entity (tombstone), p polygon,
// n general note, m month note, f favourite
```

## The save loop

```js
async save() {
  if (this.busy) { this.queued = true; return; }
  this.busy = true;
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const taken = this.takeDirty();
      const remote = await this.fetchRemote();                 // { data, etag } | { missing } | { denied }
      if (remote.denied) return;
      let data = this.payload();
      if (remote.data) {
        if (JSON.stringify(remote.data) !== this.snapshot) { data = this.merge(remote.data); this.apply(data, remote.etag); VIEW.render(); }
        else this.etag = remote.etag;
      }
      const body = JSON.stringify(data);
      const r = await tfetch(url, { method: 'PUT', headers: { 'Content-Type': 'text/plain', ...authH(), ...(this.etag && !remote.missing ? { 'If-Match': this.etag } : {}) }, body });
      if (r.status === 409 || r.status === 412) continue;      // someone saved first: merge again
      if (!r.ok) throw new Error(`saving failed (HTTP ${r.status})`);
      this.snapshot = body; this.etag = r.headers.get('ETag') || this.etag; this.lastSave = Date.now(); this.clearDirty(taken);
      if (this.isDirty()) continue;                            // edited during the PUT: go again
      return;
    }
    toast('Could not save after several tries. Your changes are kept here and will be retried.');
  } catch (e) { this.status = 'error'; this.err = e.message; }
  finally { this.busy = false; showSyncStatus(); if (this.queued) { this.queued = false; this.saveSoon(); } }
}
```

- **Snapshot as received:** `this.snapshot = JSON.stringify(dataAsReceived)`. Comparing against your own re-serialisation can differ in key order, which re-applies the data on every poll.
- **Debounce with a ceiling:** debounce saves (500 ms) but cap the wait (3 s), so continuous typing still reaches others:

```js
KV.saveSoon = (() => { let t = 0, cap = 0; const go = () => { clearTimeout(t); clearTimeout(cap); t = cap = 0; KV.save(); };
  return () => { clearTimeout(t); t = setTimeout(go, 500); if (!cap) cap = setTimeout(go, 3000); }; })();
```

## The poll

```js
async poll() {
  if (this.busy || document.hidden) return;
  try {
    const remote = await this.fetchRemote(); if (remote.denied || remote.missing) return;
    this.status = 'ok'; this.err = ''; this.lastCheck = Date.now();
    if (this.isDirty()) { this.save(); return; }           // save merges remote in; also retries an earlier failed save
    if (JSON.stringify(remote.data) === this.snapshot) { this.etag = remote.etag; return; }
    this.apply(remote.data, remote.etag); VIEW.render();
  } catch (e) { this.status = 'error'; this.err = e.message; }
  finally { showSyncStatus(); }
}
// boot: start this BEFORE and INDEPENDENTLY of any other network loop
let tick = 0; setInterval(() => { tick++; if (VIEW.cur === 'notes' || tick % 3 === 0) KV.poll(); }, 3500);   // faster where people collaborate live
const catchUp = () => { if (!document.hidden) KV.poll(); };
document.addEventListener('visibilitychange', catchUp); addEventListener('focus', catchUp); addEventListener('online', catchUp); addEventListener('pageshow', catchUp);
LIVE.poll().finally(() => LIVE.schedule());   // never `await` this before starting the KV loop
```

## Merge

```js
merge(remote) {
  const base = this.base();   // JSON.parse(this.snapshot): the last version both sides agreed on
  // lists of immutable items (events): union by id, keep remote + local-dirty, drop tombstoned entities, de-duplicate
  // maps (cards, stamps, favourites): start from remote; overwrite or delete only the keys this device has dirty
  // texts (notes, comments): merge3(base, mine, theirs) for dirty keys
  // an old client may have written the record without new optional fields: if remote lacks them, start from base's copy
}
```

## Three-way text merge

```js
function merge3(base, mine, theirs) {
  if (mine === theirs || theirs === base) return { text: mine };
  if (mine === base) return { text: theirs };
  const region = (a, b) => { let p = 0; const n = Math.min(a.length, b.length); while (p < n && a[p] === b[p]) p++;
    let q = 0; while (q < n - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++; return { s: p, e: a.length - q, ins: b.slice(p, b.length - q) }; };
  const m = region(base, mine), t = region(base, theirs);
  if (m.e <= t.s) return { text: base.slice(0, m.s) + m.ins + base.slice(m.e, t.s) + t.ins + base.slice(t.e) };
  if (t.e <= m.s) return { text: base.slice(0, t.s) + t.ins + base.slice(t.e, m.s) + m.ins + base.slice(m.e) };
  return { text: m.ins.trim() ? `${theirs}\n\n[Also typed on another device at the same time]\n${m.ins}` : theirs, conflict: true };
}
```

This works because saves happen every few seconds, so each side's change since the base is usually one contiguous region. Tested cases: an insert at the start against an append at the end; the same word replaced on both sides (conflict, both kept); edits made during a slow PUT.

## Live text into an open textarea without moving the caret

```js
syncText(ta, want) {
  const have = ta.value; if (want === have) return;
  let p = 0; const n = Math.min(have.length, want.length); while (p < n && have[p] === want[p]) p++;
  let q = 0; while (q < n - p && have[have.length - 1 - q] === want[want.length - 1 - q]) q++;
  const map = i => i <= p ? i : i >= have.length - q ? i + want.length - have.length : p + (want.length - q - p);
  const focused = document.activeElement === ta, s0 = ta.selectionStart, s1 = ta.selectionEnd, top = ta.scrollTop;
  ta.value = want; if (focused) ta.setSelectionRange(map(s0), map(s1)); ta.scrollTop = top;
}
```

Call it from `apply()` for whichever note is on screen. The input handler writes into state synchronously on every keystroke and marks the note dirty. Keystrokes therefore can't fall between a poll's fetch and its apply: either they happen during the fetch (the note is dirty, so the poll saves and merges) or after the apply.

## Compatibility with older clients

- **Validators:** accept new fields as optional (`x.favs == null || typeof x.favs === 'object'`).
- **Mirror legacy fields:** e.g. `journal.current = months[thisMonth]` for clients that only know "This month".
- **Migrate ambiguous old data explicitly:** a non-empty legacy "current" with no `months` is filed under the month it's first seen in. Never drop it.
- **Keep what old clients drop:** if an old client wrote the record without `months` or `favs`, keep the last-known copy, mark those keys dirty, and save them back.
- **Tell the user:** a stale copy left open in a browser may refuse the new shape. Everyone should reload after deploy.

## Duplicate events from several open clients

Every open copy logs the same arrival. De-duplicate on merge and on display (same entity, same type, within 60 s, keeping the earliest), and guard the logger with the same window. On reload, seed the "currently inside" set from recent open events (the last ~6 hours), so a reload doesn't log a new arrival for a plane already inside. Don't seed older open events, or one from days ago will produce a bogus departure "now".
