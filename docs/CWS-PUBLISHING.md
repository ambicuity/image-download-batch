# Publishing to the Chrome Web Store from GitHub

This repo can build and publish the extension to the Chrome Web Store
automatically via GitHub Actions (`.github/workflows/publish.yml`), which calls
the Chrome Web Store API. The workflow is ready — you only need to do a
**one-time credential setup**, then every version tag publishes automatically.

## How it works

```
git tag v1.0.1  ─►  GitHub Actions  ─►  build ZIP  ─►  CWS API: upload  ─►  publish
                    (publish.yml)       (runtime-only)     (your item)      (→ review)
```

- Trigger: pushing a `v*` tag, OR a manual run from the **Actions** tab
  (with upload-only / publish and default / trustedTesters options).
- The API can only **update an existing** store item — so the very first
  upload must be done manually to create the item and get its ID.
- "Publish" submits the new version for **Google review**; it goes live after
  approval (usually minutes to a few days).

## One-time setup

### 1. Create the store item (manual, once)
1. Register a Chrome Web Store developer account (one-time $5 fee):
   https://chrome.google.com/webstore/devconsole
2. Build the package locally: `scripts/build-zip.sh` (produces
   `image-download-batch.zip`).
3. In the dashboard: **New item → upload the ZIP**, fill the listing (use
   `docs/store-listing.md` + the images in `assets/store/`), and save.
4. Copy the **Item ID** (the long id in the item's dashboard URL). This is
   `CWS_EXTENSION_ID`.

### 2. Create Google API credentials
1. Google Cloud Console → create/select a project.
2. **APIs & Services → Library →** enable **Chrome Web Store API**.
3. **OAuth consent screen** → External → add your Google account as a *Test user*.
4. **Credentials → Create credentials → OAuth client ID → Desktop app.**
   Save the **Client ID** and **Client secret**.

### 3. Get a refresh token
The old "out-of-band" flow is deprecated; use the maintained helper, which runs
a local redirect and prints the token:

```bash
npx -y chrome-webstore-upload-keys
```

Paste the Client ID + Client secret when prompted, authorize in the browser, and
copy the **refresh token** it outputs.

### 4. Add GitHub repository secrets
Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `CWS_EXTENSION_ID` | the Item ID from step 1 |
| `CWS_CLIENT_ID` | OAuth client ID |
| `CWS_CLIENT_SECRET` | OAuth client secret |
| `CWS_REFRESH_TOKEN` | refresh token from step 3 |

## Publishing a new version

1. **Bump the version** in `manifest.json` — CWS rejects an upload whose version
   is not higher than the live one.
2. Commit it, then tag and push:
   ```bash
   git commit -am "release: v1.0.1"
   git tag v1.0.1
   git push origin master v1.0.1
   ```
3. The workflow builds, uploads, and publishes. Watch it in the **Actions** tab;
   the built ZIP is also saved as a run artifact.

Or run it manually: **Actions → Publish to Chrome Web Store → Run workflow**
(choose upload-only vs publish, and default vs trustedTesters).

## Notes & gotchas
- Keep the git tag and `manifest.json` version in sync (`v1.0.1` ↔ `"1.0.1"`).
- `trustedTesters` publishes to your test group only — handy for a dry run.
- The refresh token can expire if unused for ~6 months or if you revoke access;
  re-run step 3 to get a new one.
- Secrets are never printed by the workflow; it fails fast if any are missing.
