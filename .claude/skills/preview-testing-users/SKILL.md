---
name: preview-testing-users
description: Create Preview-only testing users and mint 24h session tokens. Load only when the member asks for testing users, simulated sessions, or a Preview load test. Skip on a normal deploy.
---

# Preview testing users

Preview only. Not Production. Tokens last 24 hours.

Need `appUid` in `pln-app.config.json` and an `x-app-token` from the
**deploy-to-labs** connect flow (do not copy that flow here).

```bash
# Create (1–100). 400 = no Preview or the 100-user cap.
curl -sS -X POST "https://api-directory.os.pl.xyz/v1/ai-apps/{appUid}/agent/testing-users" \
  -H "x-app-token: <deployToken>" \
  -H "Content-Type: application/json" \
  -d '{"count":50}'

# Mint tokens for every active testing user (omit uids). Shown once.
curl -sS -X POST "https://api-directory.os.pl.xyz/v1/ai-apps/{appUid}/agent/testing-users/sessions" \
  -H "x-app-token: <deployToken>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Replace `{appUid}` in those URLs. Show tokens once; never write them to disk.
On Preview set both (same token): `__Host-pln_app_session=<token>` (LabOS
gate) and `authToken=<token>` (the app).

`GET /v1/ai-apps/me` returns `{ "testing": true, "member": { "uid", "name" } }`.
Real members omit `testing`. 403 = not this app's owner.
