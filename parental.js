// Parental Controls helper
// Provides APIs to set a password (salted SHA-256), verify password, manage allowed items and session.
// Storage keys:
//  - parental: { enabled: bool, hash: base64, salt: base64, allowed: {"cyber-deck.html": true}, session: { loggedIn: bool } }

const PARENTAL_KEY = 'idlegames-parental-v1';

function readState() {
  try {
    const raw = localStorage.getItem(PARENTAL_KEY);
    return raw ? JSON.parse(raw) : { enabled: false, hash: null, salt: null, allowed: {}, session: { loggedIn: false } };
  } catch (e) {
    console.error('par: read error', e);
    return { enabled: false, hash: null, salt: null, allowed: {}, session: { loggedIn: false } };
  }
}

function writeState(s) {
  localStorage.setItem(PARENTAL_KEY, JSON.stringify(s));
}

async function sha256Base64(message) {
  const enc = new TextEncoder();
  const data = enc.encode(message);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  let binary = '';
  for (let b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function randSaltBase64(len = 16) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  let s = '';
  for (let b of arr) s += String.fromCharCode(b);
  return btoa(s);
}

// Public API
window.parental = {
  isEnabled() {
    const s = readState();
    return !!s.enabled;
  },
  isLoggedIn() {
    const s = readState();
    return !!(s.session && s.session.loggedIn);
  },
  async setPassword(pass) {
    // generate salt and store hash
    const salt = randSaltBase64(16);
    const h = await sha256Base64(salt + '|' + pass);
    const s = readState();
    s.enabled = true;
    s.salt = salt;
    s.hash = h;
    s.session = { loggedIn: true };
    writeState(s);
    return true;
  },
  async verifyPassword(pass) {
    const s = readState();
    if (!s || !s.hash || !s.salt) return false;
    const h = await sha256Base64(s.salt + '|' + pass);
    const ok = h === s.hash;
    if (ok) {
      s.session = s.session || {};
      s.session.loggedIn = true;
      writeState(s);
    }
    return ok;
  },
  signOut() {
    const s = readState();
    s.session = { loggedIn: false };
    writeState(s);
  },
  disable() {
    // disables parental controls and clears password & allowed
    const s = { enabled: false, hash: null, salt: null, allowed: {}, session: { loggedIn: false } };
    writeState(s);
  },
  getAllowedMap() {
    const s = readState();
    return s.allowed || {};
  },
  setAllowedFor(href, allowed) {
    const s = readState();
    s.allowed = s.allowed || {};
    s.allowed[href] = !!allowed;
    writeState(s);
  },
  applyAndEnforce() {
    // set loggedIn=false and enforce mode
    const s = readState();
    s.session = { loggedIn: false };
    s.enabled = true;
    writeState(s);
  },
  // helper used by pages to check if allowed and redirect if not
  async checkAccessOrRedirect(currentHref) {
    const s = readState();
    if (!s.enabled) return true; // no enforcement
    // if logged in, allow
    if (s.session && s.session.loggedIn) return true;
    const allowed = (s.allowed && s.allowed[currentHref]) !== false; // default true
    if (!allowed) {
      // redirect to index
      try { window.location.replace('index.html'); } catch (e) { window.location.href = 'index.html'; }
      return false;
    }
    return true;
  }
};

// If this script runs in a page that's not index.html, perform a check and redirect if needed
(function autoCheck() {
  try {
    const path = window.location.pathname.split('/').pop() || 'index.html';
    if (path !== 'index.html') {
      // run check; if blocked it will redirect
      parental.checkAccessOrRedirect(path);
    }
  } catch (e) {
    // ignore
  }
})();
