# Chrome Web Store — Submission Readiness

Reference for publishing **Image Download - Batch** (Manifest V3, v1.0.0) to the
Chrome Web Store. Copy the justifications below into the dashboard's permission
fields.

## Single purpose
> Discover, preview, filter, and batch-download images from any web page.

Everything in the extension serves that one purpose.

## Permission justifications (paste into the dashboard)

| Permission | Justification |
|---|---|
| `downloads` | Saving discovered images to the user's computer, individually or as a ZIP. |
| `scripting` | Injecting the image scraper into the active tab to find images (`<img>`, `srcset`, `<picture>`, CSS backgrounds, SVG, shadow DOM, lazy-loaded, `og:image`, video posters, etc.). |
| `storage` | Persisting the user's download options and UI preferences locally. |
| `declarativeNetRequest` | Adding a session rule that sets the correct `Referer` on image requests so referrer-protected images download successfully. |
| `webRequest` | **Observation only** — `onBeforeRedirect` / `onCompleted` resolve the final URL of redirected image requests so the right file is downloaded. (No blocking request modification is performed on modern Chrome; header changes go through `declarativeNetRequest`.) |
| `sidePanel` | Optional side-panel display mode for persistent access while browsing. |
| `contextMenus` | The right-click "Download all images on this page" action. |
| `host_permissions: http://*/*, https://*/*` | A general-purpose image downloader must read image URLs on **whatever page the user is on**; the target site is not known in advance. All processing is local — no data leaves the browser. |

## Privacy
- 100% local. No external servers, no analytics, no tracking, no account.
- State this in the dashboard privacy tab; the single-purpose + data-use answers
  should all be "does not collect user data".

## Known items a reviewer might flag (and the response)

1. **Broad host permissions** — expected for this category; justified above. Cannot
   be narrowed without breaking the core "download from any page" function.
2. **`webRequest`** — used only for redirect/URL resolution (observers), not for
   blocking modification. If review pushes back, the observers can be migrated to
   `declarativeNetRequest` response handling in a follow-up (requires rebuilding
   the minified `popup.js` bundle; source is not in this repo).
3. **`new Function()` in bundled vendor code** — present in webpack polyfills
   (`popup.js` globalThis shim, `733.js`/JSZip `setImmediate` shim). Both are
   guarded / rarely reached and are standard library output; the default MV3 CSP
   is not violated in normal flows. Removing them requires re-bundling from source.
4. **`.LICENSE.txt` files** — kept next to bundled JS for third-party license
   compliance; do not delete.

## Pre-submission checklist
- [x] `update_url` removed from manifest (CWS rejects it in uploaded packages)
- [x] `version` = 1.0.0
- [x] Unused `activeTab` permission removed
- [x] 16 / 48 / 128 px icons declared
- [x] No inline scripts / inline event handlers (CSP-clean)
- [ ] Store listing assets: screenshots (1280×800 or 640×400), small promo tile
      (440×280), detailed description
- [ ] Privacy practices tab completed (no data collection)
- [ ] ZIP the extension root **excluding** `docs/`, `.git`, `*.zip`, `*.pem`,
      and other non-runtime files before upload

## Packaging note
`.gitignore` already excludes `*.zip` / `*.pem`. When building the upload ZIP,
exclude `docs/` (specs + Node tests) and any dev-only files — they are not needed
at runtime and only inflate the package.
