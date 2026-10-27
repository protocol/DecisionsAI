---
name: app-analytics
description: Wire baseline usage analytics (app opened, JS errors, session length) into every deployed AI App — do this during initial setup for every app, not only when asked. Also covers adding custom product-analytics events (button clicks, feature usage) when the member asks for usage tracking or "analytics" in their app. All of it forwards to the Directory PostHog project with server-enforced app attribution, helping the PL team understand usage across AI Apps — there is no dashboard yet for the member to view their own app's events. Also sends the route-sync message the dashboard uses for subpage deep links and the tab title. Never required for a deploy to succeed — a failure here must never block or break the app.
---

# App analytics — baseline events (automatic) + custom events (on request)

Deployed apps report usage data that feeds the PL team's understanding of how
AI Apps get used across the program. There is no PostHog key or SDK in this
kit — events go through the PLN backend, which resolves which app they belong
to from the request itself and stamps identity, so the app never handles
PostHog credentials or attribution.

**Two tiers, different trigger:**
1. **Baseline events** (`opened`, `error`, `closed`) — wire these into
   **every** app you build or deploy, unconditionally, during initial setup.
   Do not wait for the member to ask; this is a standard part of scaffolding
   an app with this kit, the same as adding a `/health` endpoint.
2. **Custom events** (e.g. `clicked_export`) — only add these when the
   member specifically asks for tracking on a feature or interaction. You
   have no way to know which clicks matter to them, so don't guess or
   instrument every element — that would just add noise.

**Set expectations correctly with the member if they ask about it:** there is
no usage dashboard for their own app today — this data is not shown back to
them anywhere. Don't tell them they'll be able to see clicks/usage
themselves; frame it as helping the PL team improve AI Apps. Since baseline
events are automatic and invisible, you don't need to bring this up
proactively — only explain it if the member notices the network requests or
asks what they're for.

## The endpoint

`analyticsEndpoint` in `pln-app.config.json`:

```
POST https://api-directory.os.pl.xyz/v1/ai-apps/track
Content-Type: application/json
{ "event": "clicked_export", "properties": { "format": "csv" } }
```

No deploy token, no auth header required — but send the same `authToken`
Bearer header as `pln-member-context` when you have it, so the event is
attributed to the signed-in member instead of an anonymous visitor. The
response is always empty (204), including when an event is silently dropped
(unattributable origin, malformed payload, oversized properties) — don't
treat any response as a signal of success or failure, just fire and forget.

## The analytics snippet

Bake this into the app's frontend as-is (no config file is shipped inside
`app/`, so inline the endpoint URL as a constant). Load it once, early, on
every page — for a React/Next.js app that means the root layout/`_app`; for a
plain-HTML app, a `<script>` included on every page:

```js
const ANALYTICS_URL = 'https://api-directory.os.pl.xyz/v1/ai-apps/track';
// The only page allowed to receive the route-sync message (the AI Apps dashboard).
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
  // Fire-and-forget: never await, never throw into the caller. keepalive lets
  // the request survive a page navigation right after the call.
  fetch(ANALYTICS_URL, { method: 'POST', headers, body, keepalive: true }).catch(() => {});
}

// ---- Baseline events — call initAppAnalytics() once at startup, for EVERY app ----
function initAppAnalytics() {
  const openedAt = Date.now();
  trackEvent('opened');

  // Cap error events so a crash-looping bug can't spam the shared project.
  let errorCount = 0;
  const MAX_ERROR_EVENTS = 5;
  // Property is named errorSource, not "source" — "source" is a server-stamped
  // attribution field (always overwritten to "ai-app"), so reusing that name
  // here would silently destroy this value.
  function trackErrorOnce(message, errorSource) {
    if (errorCount >= MAX_ERROR_EVENTS) return;
    errorCount += 1;
    trackEvent('error', { message: String(message).slice(0, 300), errorSource: errorSource });
  }
  window.addEventListener('error', (e) => trackErrorOnce(e.message, 'window.onerror'));
  window.addEventListener('unhandledrejection', (e) =>
    trackErrorOnce(e.reason && e.reason.message ? e.reason.message : String(e.reason), 'unhandledrejection')
  );

  // Approximate session length: fires once per time the tab goes to the
  // background, not a perfect single "closed" signal (a user can reopen it).
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

// ---- Route sync — the AI Apps dashboard mirrors the open page in its URL and tab title (shareable deep links) ----
function initRouteSync() {
  if (window.parent === window) return;
  let lastSent = '';
  const send = () => {
    // Pathname + query — never location.hash. The dashboard mirrors this into
    // its address bar and drops secret-like keys (OAuth ?code=, tokens), but
    // that denylist is not a guarantee: do not put secrets in the query string.
    const path = location.pathname + location.search;
    const title = document.title;
    if (path + '\n' + title === lastSent) return;
    lastSent = path + '\n' + title;
    // Addressed to the dashboard origin explicitly — a page other than the
    // dashboard framing the app never receives it (a '*' target would hand
    // the route to whoever embeds the app).
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

initAppAnalytics(); // Call this once, unconditionally — not gated on a member request.
initRouteSync();
```

Custom events reuse the same `trackEvent` helper: `trackEvent('clicked_export', { format: 'csv' })`.

## Rules

- **Baseline events (`opened`/`error`/`closed`) are mandatory, not opt-in.**
  Add `initAppAnalytics()` to every app you build or deploy with this kit,
  the same as you'd add the `/health` endpoint — don't wait to be asked, and
  don't skip it because the member didn't mention analytics.
- **Custom events are opt-in.** Only add feature-specific `trackEvent(...)`
  calls when the member asks for tracking on something specific. Don't
  instrument every button/click by default — that's exactly the noise this
  design avoids.
- **Route sync is mandatory too.** Keep `initRouteSync()` in: the dashboard
  mirrors the app's current page in its own URL (shareable deep links) and
  shows `document.title` as `<page title> · <app name>` in the browser tab.
  Deep links are opened as the iframe's initial URL, so every route must
  render on a hard load at its real URL — no in-memory-only routing — and
  every page needs a meaningful `document.title` (Next.js `metadata` per
  route, or a `<title>`). Never put secrets or member data in URLs or titles;
  both are mirrored into the dashboard.
- **Keep the route message addressed to the dashboard, and never send the hash.** The
  snippet sends `location.pathname + location.search` (never `location.hash`)
  and posts it to `https://os.pl.xyz` explicitly, never to `'*'` (which
  would deliver the route to whatever page frames the app). The dashboard mirrors
  that query into its own URL, except a denylist of secret-like names (`code`,
  `token`, and similar) and its own params (`settings`). The denylist is not a
  guarantee — never put secrets, tokens, or member data in the query string.
  Don't widen the post target when adapting the snippet.
- **Event names**: snake_case, plain words describing the action (e.g.
  `clicked_export`, `created_item`). The endpoint prefixes every name with
  `ai_app_` server-side — don't add that prefix yourself, and don't rely on
  the exact final name since normalization may adjust it.
- **No PII in properties.** Never send the member's email, name, or any other
  contact/identifying detail as a property — identity is attributed
  automatically from the Bearer token, not from anything you send. Stick to
  behavioral data: what was clicked, which feature, counts, durations. This
  also applies to the `error` event's `message` — it's capped at 300 chars,
  but still check it isn't logging user-entered data.
- **Never send `$`-prefixed properties** (PostHog-reserved) or your own
  `source`/`appId`/`appUid`/`appName`/`memberUid` — the backend stamps
  these itself and overwrites anything you send.
- **Analytics is optional and must never break the app.** Always fire-and-forget
  (don't `await` the call on a user action, don't throw on failure). If the
  endpoint is unreachable, blocked, or drops the event, the app must keep
  working exactly the same.
- **Keep properties small** — object-shaped scalars only, no large blobs; the
  backend caps and drops oversized payloads silently.
- This is the only analytics transport available to apps — don't add a
  PostHog SDK, autocapture, or any other analytics vendor directly.
