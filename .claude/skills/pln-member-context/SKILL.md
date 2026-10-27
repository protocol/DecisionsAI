---
name: pln-member-context
description: Get the signed-in PLN (or PL) member's identity (name, teams, role, skills) inside a deployed AI App, for personalization and feedback. Use whenever the app should greet the user, tag content with who created it, or adapt to the member using it. Load before writing any code that needs to know who is using the app.
---

# PLN Member Context — who is using the app

Deployed apps are opened by signed-in PLN members from the PL Infra → AI Apps
dashboard. The app's auth gate (in front of every deployed app) already knows
who the member is and answers `/_pln/me` on the app's own origin, so the app
never handles a token and needs no login UI of its own.

## The endpoint

Call **`GET /_pln/me`** on the app's own origin from **browser code**. It is a
same-origin request, so there is no token, no CORS and no Authorization header
to handle. Apps whose auth gate predates `/_pln/me` get a 404 there; for them
the snippet falls back to `memberContextEndpoint` from `pln-app.config.json`
(`https://api-directory.os.pl.xyz/v1/ai-apps/me`) with the `authToken` cookie as a Bearer token. The
config file is not shipped inside `app/`, so bake that URL in as a constant.
Use the snippet as-is:

```js
const MEMBER_CONTEXT_URL = 'https://api-directory.os.pl.xyz/v1/ai-apps/me';

// Fallback only: the cookie value is URL-encoded and JSON-quoted (e.g. %22eyJhbGci...%22).
function readAuthToken() {
  const match = document.cookie.match(/(?:^|;\s*)authToken=([^;]*)/);
  if (!match) return null;
  const raw = decodeURIComponent(match[1]).replace(/^"|"$/g, '');
  return raw || null;
}

async function getMemberContext() {
  try {
    let res = await fetch('/_pln/me', { credentials: 'same-origin' });
    if (res.status === 404) {
      // Older auth gate without /_pln/me: ask the PLN API directly.
      const token = readAuthToken();
      res = await fetch(MEMBER_CONTEXT_URL, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        credentials: token ? 'omit' : 'include',
      });
    }
    if (!res.ok) return null; // 401 = not signed in, 403 = no AI Apps access
    const { member } = await res.json();
    return member;
  } catch {
    return null; // network/CORS error — treat as signed out
  }
}
```

Response shape (`member`):

```json
{
  "uid": "…",
  "name": "Ada Lovelace",
  "image": "https://…/profile.png",
  "location": { "city": "London", "country": "United Kingdom", "continent": "Europe" },
  "skills": ["Engineering", "Research"],
  "teams": [
    { "uid": "…", "name": "Protocol Labs", "role": "Engineer", "mainTeam": true, "teamLead": false }
  ]
}
```

Fields may be `null`/empty, and new fields may be added over time — ignore
anything you don't recognize.

When the member's own AI agent opens the app for them (through LabOS MCP), the
response also has `"isAgent": true` and `"agentAccess"`: `"read"` means the
member gave their agent read-only access, so the app should not let that
caller change data; `"write"` means the member allowed changes. A normal
browser visit has neither field. The response deliberately contains **no contact
info** (no email, no office-hours link) — don't build features that assume a
way to reach the member, and don't ask them to type contact details in to
compensate.

## Rules

- **Always handle the signed-out case.** `getMemberContext()` returns `null`
  when the visitor is not signed in, lacks AI Apps access, or when the app runs
  locally (`npm start` — there is no auth gate or PLN cookie on localhost). Show a friendly note like
  *"Open this app from the LabOS → AI Apps dashboard to personalize it"* and keep
  the rest of the app working. Never crash or block on missing identity.
- **Personalization only, not authentication.** Use the identity to greet the
  member, tag feedback/content with who wrote it, or tailor behavior. Do not
  gate sensitive or destructive actions on it, and don't build your own
  session/auth system on top.
- Call it client-side. If you must know the member on your server, the
  `authToken` cookie arrives on every request to the app: decode it (URL-decode,
  strip the surrounding double quotes) and forward it to
  `memberContextEndpoint + "?appId=<appId>"` (your `appId` from
  `pln-app.config.json`) as `Authorization: Bearer <token>`. It is a session
  for this app only — it works for this endpoint and nothing else, and naming
  your `appId` makes LabOS refuse (401) a session minted for another app. Never store or log the token, and
  never send it — or the member's data — to any third-party service.
- Keep the token in memory for the current page only — don't persist it to
  localStorage, files, or your own backend.
- This is the only PLN member API available to apps. Don't call other internal
  PLN endpoints; if the app needs more PLN data than this provides, tell the
  member it isn't available yet.
