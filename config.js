// ============================================================================
// Paste the UNIFIED app's Apps Script Web App URL here after deploying it (see
// SETUP_INSTRUCTIONS.md in this folder's parent). This is a NEW, separate deployment from the
// old "DO Dispatch Tracker" and "Freight Payment Tracker" URLs — one login, one URL, both
// modules. It looks like:
//   https://script.google.com/macros/s/AKfycb.../exec
// ============================================================================
const API_URL = 'https://script.google.com/macros/s/AKfycbyZiSWQPQ_w26Azs6DbtirdFaY4VhS9rFLbb2y252nJpeHFwQ5wz8dbCUob8qZSAVmOAA/exec';

// ---------------------------------------------------------------------------
// Session storage (kept in localStorage so the user stays logged in across
// visits/phone restarts, until the token naturally expires server-side).
// role is one of: SuperAdmin / DODispatch / Freight.
// ---------------------------------------------------------------------------
const Session = {
  get token() { return localStorage.getItem('unified_token') || ''; },
  get username() { return localStorage.getItem('unified_username') || ''; },
  get role() { return localStorage.getItem('unified_role') || ''; },
  isLoggedIn() { return !!this.token; },
  save(token, username, role) {
    localStorage.setItem('unified_token', token);
    localStorage.setItem('unified_username', username);
    localStorage.setItem('unified_role', role);
  },
  clear() {
    localStorage.removeItem('unified_token');
    localStorage.removeItem('unified_username');
    localStorage.removeItem('unified_role');
  }
};

// ---------------------------------------------------------------------------
// API helpers.
//
// GET is used for all read calls: plain query string, no request body, no
// custom headers -> the browser treats it as a "simple request" so it never
// sends a CORS preflight (which Apps Script cannot answer).
//
// POST is used for writes and login: body is sent with Content-Type
// text/plain (NOT application/json) for the same preflight-avoidance reason.
// Code.gs parses the text body as JSON regardless of the declared type.
// ---------------------------------------------------------------------------

async function apiGet(action, params) {
  params = params || {};
  const qs = new URLSearchParams(Object.assign({ action: action, token: Session.token }, params));
  const res = await fetch(API_URL + '?' + qs.toString());
  const data = await res.json();
  if (data.error) throw new Error(data.message || 'Request failed.');
  return data;
}

async function apiPost(action, payload) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, token: Session.token, payload: payload || {} })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.message || 'Request failed.');
  return data;
}

async function apiLogin(username, password) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'login', payload: { username: username, password: password } })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.message || 'Login failed.');
  return data;
}
