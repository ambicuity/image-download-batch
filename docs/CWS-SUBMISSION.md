# Chrome Web Store — Submission Readiness

Reference for publishing **Image Download - Batch** (Manifest V3, v1.0.2) to the
Chrome Web Store. Copy the text below into the dashboard's **Privacy practices**
tab; it matches the permissions in `manifest.json`.

## Single purpose
> Discover, preview, filter, and batch-download images from any web page.

Everything in the extension serves that one purpose.

## Permission justifications (paste into the dashboard)

| Permission | Justification |
|---|---|
| `activeTab` | Area capture: after the user clicks the toolbar icon, `captureVisibleTab` screenshots the current tab so the user can crop a region into an image. |
| `downloads` | Saving discovered images to the user's computer, individually or as a ZIP. |
| `scripting` | Injecting the image scraper into the active tab to find images (`<img>`, `srcset`, `<picture>`, CSS backgrounds, SVG, shadow DOM, lazy-loaded, `og:image`, video posters, etc.), and the area-capture overlay. |
| `storage` | Persisting the user's download options and UI preferences locally. |
| `sidePanel` | Optional side-panel display mode for persistent access while browsing. |
| `contextMenus` | The right-click "Download all images on this page" action. |
| `host_permissions: http://*/*, https://*/*` | A general-purpose image downloader must read image URLs on **whatever page the user is on**; the target site is not known in advance. All processing is local — no data leaves the browser. |

**Remote code:** No. All JavaScript ships in the package (JSZip and jQuery are vendored).

**Data usage:** Collects none of the listed data types. Certify all three
statements (no selling, no unrelated use, no creditworthiness use).
Privacy policy: `PRIVACY-POLICY.md` (publish it at a public URL for the dashboard field).

## Privacy
- 100% local. No external servers, no analytics, no tracking, no account.
- State this in the dashboard privacy tab; the single-purpose + data-use answers
  should all be "does not collect user data".

## Known items a reviewer might flag (and the response)

1. **Broad host permissions** — expected for this category; justified above. Cannot
   be narrowed without breaking the core "download from any page" function.
2. **`new Function()` in bundled vendor code** — present in webpack polyfills
   (`popup.js` globalThis shim, `733.js`/JSZip `setImmediate` shim). Both are
   guarded / rarely reached and are standard library output; the default MV3 CSP
   is not violated in normal flows. Removing them requires re-bundling from source.
3. **`.LICENSE.txt` files** — kept next to bundled JS for third-party license
   compliance; do not delete.

## Pre-submission checklist
- [x] `update_url` removed from manifest (CWS rejects it in uploaded packages)
- [x] `version` = 1.0.2
- [x] Unused `declarativeNetRequest` permission removed
- [x] `activeTab` declared (required for area capture)
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
