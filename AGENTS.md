# AGENTS.md — Image Download - Batch

## What this repo is

- **Chrome Extension (Manifest V3)** — the repo root IS the unpacked extension. Load it directly in `chrome://extensions`.
- **No build system** — there are no `package.json` scripts and no webpack config. All JavaScript is original, unminified source — readable and editable directly.
- **Node test suite, no bundler** — the tests under `docs/superpowers/tests/` run the *shipped* source through `node:vm` with Chrome/DOM doubles. `.github/workflows/publish.yml` runs them on every release tag.
- **All source is in the root** (not a `dist/` folder). `popup.js`, `background.js`, `inject.js`, etc. are plain ES2015+ JavaScript files.

## Entrypoints & architecture

- `manifest.json` — defines the service worker (`bg-entry.js`), popup (`popup.html`), content script (`inject.js`), and keyboard shortcut `Ctrl+Shift+Y` / `Cmd+Shift+Y`.
- `bg-entry.js` — service worker bootstrap; opens welcome.html on install, then loads `filenameTokens.js`, `sanitize.js`, `downloadNaming.js`, `contextMenu.js`, and `background.js` via `importScripts`.
- `background.js` — service worker core; orchestrates downloads, messaging, storage, display mode (popup/sidePanel), and download filename shaping.
- `popup.html` + `popup.js` + `popup.css` + `popup-bridge.js` — popup UI and side-panel logic (preferences include `displayMode: sidePanel`).
- **Content scripts**
  - `inject.js` — auto-injected into pages; highlights selected images, forwards page-to-extension messages.
  - `imageScraper.js` — injected on demand by the popup and context menu to collect images from the DOM (img, srcset, CSS backgrounds, SVGs, shadow DOM, lazy-loaded, meta tags, etc.).
  - `captureSelection.js` — area-screenshot helper injected on demand for side-panel mode.
- `filenameTokens.js` — resolves filename templates for custom download names.
- `downloadNaming.js` — shared download-naming helpers (`shapeDownloadFilename`, `resolveFinalName`, `inferImageExtension`, `resolveSubfolder`); used by both the worker and the context menu so every route names files identically.
- `contextMenu.js` — "Download all images on this page" right-click menu action.
- `sanitize.js` — filename sanitizer for filesystem-safe names.
- `welcome.html` + `welcome.js` — onboarding page shown on first install.
- `733.js` — vendored JSZip library for ZIP download functionality (loaded dynamically by popup.js).

## How to verify changes

Run the automated suite first — it needs no browser and no build step:

```sh
node --test docs/superpowers/tests/bug-regressions.test.cjs
node --test docs/superpowers/tests/bug-regressions-3.test.cjs
for t in dedupeUrls filenameTokens flattenDedupeImages upgradeToLargest; do
  node "docs/superpowers/tests/$t.test.cjs"
done
```

The `bug-regressions*.test.cjs` files are `node --test` suites; the four helper suites are plain scripts that exit non-zero on failure. CI runs exactly these commands.

Then check the extension in Chrome:

1. Open Chrome → `chrome://extensions` → enable **Developer mode**.
2. Click **Load unpacked** and select this directory.
3. Test the popup via the toolbar icon or the keyboard shortcut.

A new root-level runtime script must be added to `ROOT_FILES` in `scripts/build-zip.sh`, otherwise the published package is missing it.

## Localization

- `manifest.json` uses `__MSG_appName__` / `__MSG_appDesc__`.
- HTML elements use `messagesKey` attributes for runtime localization.
- Translations live in `_locales/<lang>/messages.json` (54 languages).

## Quirks & gotchas

- `733.js.LICENSE.txt` is the JSZip license file and must be kept alongside `733.js`.
- `.gitignore` excludes `*.zip`, `*.pem`, and packaging artifacts. If you build a release package, keep those files out of git.

## External dependencies

- jQuery 3.7.1 and jQuery UI are vendored in `external/` and loaded by `popup.html`.
- `733.js` is the JSZip library (vendored, for ZIP download functionality).
- `sanitize.js` is a self-contained original filename sanitizer.