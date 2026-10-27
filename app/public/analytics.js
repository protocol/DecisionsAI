// PLN baseline usage analytics (kit v1.16, .claude/skills/app-analytics).
// Fire-and-forget: never awaited, never throws — the app works identically
// if the endpoint is unreachable. No PII is sent; identity is attributed
// server-side from the Bearer token.
const ANALYTICS_URL = 'https://api-directory.os.pl.xyz/v1/ai-apps/track';

// The dashboard that frames this app. Route messages are addressed to it
// explicitly — a '*' target would hand the current route to whoever embeds
// the app.
const DASHBOARD_ORIGIN = 'https://os.pl.xyz';

function readAuthToken() {
  const match = document.cookie.match(/(?:^|;\s*)authToken=([^;]*)/);
  if (!match) return null;
  const raw = decodeURIComponent(match[1]).replace(/^"|"$/g, '');
  return raw || null;
}

function getAnonId() {
  let id = localStorage.getItem('pln_anon_id');
  if (!id) {
    id = `anon:${crypto.randomUUID()}`;
    localStorage.setItem('pln_anon_id', id);
  }
  return id;
}

function trackEvent(name, properties = {}) {
  const token = readAuthToken();
  const body = JSON.stringify({ event: name, properties, anonId: token ? undefined : getAnonId() });
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  fetch(ANALYTICS_URL, { method: 'POST', headers, body, keepalive: true }).catch(() => {});
}

function initAppAnalytics() {
  const openedAt = Date.now();
  trackEvent('opened');

  // Cap error events so a crash-looping bug can't spam the shared project.
  let errorCount = 0;
  const MAX_ERROR_EVENTS = 5;
  function trackErrorOnce(message, errorSource) {
    if (errorCount >= MAX_ERROR_EVENTS) return;
    errorCount += 1;
    trackEvent('error', { message: String(message).slice(0, 300), errorSource: errorSource });
  }
  window.addEventListener('error', (e) => trackErrorOnce(e.message, 'window.onerror'));
  window.addEventListener('unhandledrejection', (e) =>
    trackErrorOnce(e.reason && e.reason.message ? e.reason.message : String(e.reason), 'unhandledrejection')
  );

  // Approximate session length: fires once per background-tab transition.
  let closedSent = false;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && !closedSent) {
      closedSent = true;
      trackEvent('closed', { durationMs: Date.now() - openedAt });
    } else if (document.visibilityState === 'visible') {
      closedSent = false;
    }
  });
}

// ---- Route sync (kit v1.16) — the dashboard mirrors the open page in its own
// URL and tab title, and reopens a shared link as the iframe's initial URL. ----
function initRouteSync() {
  if (window.parent === window) return;
  let lastSent = '';
  const send = () => {
    // Pathname + query — never location.hash. The dashboard mirrors this into
    // its address bar, so no secret or member data belongs in either value.
    const path = location.pathname + location.search;
    const title = document.title;
    if (path + '\n' + title === lastSent) return;
    lastSent = path + '\n' + title;
    window.parent.postMessage({ type: 'pln-ai-app:route', path: path, title: title }, DASHBOARD_ORIGIN);
  };
  ['pushState', 'replaceState'].forEach((method) => {
    const original = history[method].bind(history);
    history[method] = (...args) => {
      original(...args);
      send();
    };
  });
  window.addEventListener('popstate', send); // also fires for hash changes
  // Frameworks set the title after navigation, so watch <head> for title changes too.
  new MutationObserver(send).observe(document.head, { subtree: true, childList: true, characterData: true });
  send();
}

initAppAnalytics();
initRouteSync();
