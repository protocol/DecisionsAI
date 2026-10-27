---
name: kit-update
description: Offer and apply a newer PLN AI Apps starter kit to this project — kit files only (agent instructions, skills, design system, styles), never the member's app code. Use when the start-of-chat version check finds a newer kit, or when the member asks to update the kit.
---

# Updating the starter kit

The member's project started from a starter kit. Newer kit versions bring new
agent instructions and skills. This skill replaces **kit files only**, and only
after the member says yes. Their app code in `app/` is never touched.

## 1. Check the live version
```bash
curl -sS "https://api-directory.os.pl.xyz/v1/ai-apps/starter-kit/version"
# → { "version": "1.19", "whatsNew": ["…", "…"] }
```
(The URL is `kitVersionEndpoint` in `pln-app.config.json`; no token needed.)

Compare `version` with the config's `kitVersion` **number by number**: split
on `.` and compare each part as an integer (`1.17` is newer than `1.9` —
never compare them as strings). A missing or unreadable local `kitVersion`
counts as older. Any non-200 or network error: stop here and say nothing.

- **Not newer** → say nothing about updates.
- **Newer, and equal to `declinedKitVersion`** in the config → say nothing;
  the member already said no to this version. (Offer again only once an even
  newer version is live.)
- **Newer otherwise** → tell the member, in plain words, that kit
  `<version>` is available, summarize `whatsNew`, and ask whether to download
  and apply it. Mention that their app code won't change.

**If the member asks to update the kit themselves**, skip the
`declinedKitVersion` rule and go to step 2 for the live version.

## If the member says no
Set `"declinedKitVersion": "<version>"` in `pln-app.config.json` and change
nothing else. Don't bring it up again in this chat.

## 2. Get a token and download (only after a yes)
The download needs the same `x-app-token` credential as deploys. Reuse
a still-valid deploy token from this chat if you have one; otherwise follow
step 3 of the **deploy-to-labs** skill ("Get a deploy token via LabOS") and tell
the member the approval is for downloading the kit update. Do not copy that flow
here.

```bash
mkdir -p /tmp/pln-kit-update && cd /tmp/pln-kit-update
curl -sS -f -o kit-update.zip -H "x-app-token: <deployToken>" "https://api-directory.os.pl.xyz/v1/ai-apps/starter-kit/update"
unzip -o -q kit-update.zip -d new
```
(The URL is `kitUpdateEndpoint` in the config.) Unpack it **outside** the
project. A `401` means the token expired — reconnect and retry.

## 3. Work out what will change
- **New manifest:** `new/.pln-kit/manifest.json` lists every kit file with its SHA-256.
- **Installed manifest:** `.pln-kit/manifest.json` in the project (kits older than 1.17
  don't have one).

For every path in the new manifest:
- doesn't exist locally → **add**;
- identical to the new file → skip;
- local SHA-256 equals the **installed** manifest's hash → **update**
  (the member never edited it);
- otherwise → **locally edited** (with no installed manifest, every existing
  file that differs from the new one counts as locally edited).

For every path in the installed manifest that is **not** in the new one:
**remove** it if its local hash still matches the installed manifest; if it
was edited, keep it and report it.

## 4. Confirm, then apply
Show the member the list (add / update / remove), and ask once. If anything is
**locally edited**, name each of those files, say their edits will be
overwritten, offer to keep a copy as `<file>.local-backup`, and get an explicit
second yes before overwriting them. If they want to keep an edited file as is,
leave it out.

Then:
1. Copy the approved files from `new/` into the project (create folders as
   needed) and delete the approved removals.
2. Merge `pln-app.config.json`: start from `new/pln-app.config.json`; put back
   the local values of `appId`, `appUid`, `appName`, `appDescription`,
   `appTags` and `database`; copy any other local key the new config doesn't
   have; drop `declinedKitVersion`. Endpoints, `deployTokenHeader`,
   `kitVersion` and `notes` always take the new values.
3. Write `new/.pln-kit/manifest.json` to `.pln-kit/manifest.json` **last** — if
   anything fails before this, the next check offers the update again.
4. Delete `/tmp/pln-kit-update` and tell the member which version they're on now
   and what changed.

## Rules
- Never touch `app/` or any file that isn't in a kit manifest (the member's
  own skills, notes, etc. stay as they are).
- Never download or change kit files without the member's explicit yes for
  that version.
- Never write the deploy token to a file or print it.
- Reload the updated `CLAUDE.md`/`AGENTS.md` and skills before doing more
  work in this chat — the instructions you were following may have changed.
