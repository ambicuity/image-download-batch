/*!
 * inject.js — Content script for Image Download - Batch
 * Original implementation for Image Download - Batch by Ritesh Rana
 *
 * Auto-injected into all http/https pages (see manifest.json content_scripts).
 * Responsibilities:
 *   1. Highlight selected <img> elements (outline) on popup request.
 *   2. Clear highlights on popup request.
 *   3. Forward a clear-selection signal to captureSelection.js via a custom window event.
 *   4. Bridge page-script postMessage({ action: 'imgdl_open' }) into the extension runtime
 *      so sites can programmatically open the extension UI.
 *   5. Optional debug logging behind a localStorage flag.
 *
 * No external dependencies. ES2015+ vanilla JS. IIFE-scoped to avoid leaking globals.
 */

(function () {
    'use strict';

    /* ------------------------------------------------------------------ *
     * Constants
     * ------------------------------------------------------------------ */

    // CSS class applied to highlighted images.
    var HIGHLIGHT_CLASS = 'idb-img-highlight';

    // Custom event dispatched on window to tell captureSelection.js to tear down
    // its area-screenshot overlay.
    var CLEAR_SELECTION_EVENT = 'idb-clear-selection';

    // Page-script -> content-script bridge message action.
    var PAGE_OPEN_ACTION = 'imgdl_open';

    // Toggle debug logging. Set via devtools: localStorage.idb_debug = '1'
    var DEBUG_FLAG_KEY = 'idb_debug';

    /* ------------------------------------------------------------------ *
     * Debug helpers
     * ------------------------------------------------------------------ */

    function debugEnabled() {
        try {
            return localStorage.getItem(DEBUG_FLAG_KEY) === '1';
        } catch (e) {
            // localStorage can throw on some restricted frames; treat as off.
            return false;
        }
    }

    function log() {
        if (!debugEnabled()) return;
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[ImageDownload-Batch]');
        // eslint-disable-next-line no-console
        console.log.apply(console, args);
    }

    log('content script initialized on', location.href);

    /* ------------------------------------------------------------------ *
     * Highlight style injection
     * ------------------------------------------------------------------ */

    // A single <style> node is inserted once into document.head and reused.
    // Using box-shadow rather than outline avoids layout shifts and works
    // over border-radius / transformed elements.
    var STYLE_ID = 'idb-highlight-style';

    function injectHighlightStyle() {
        if (document.getElementById(STYLE_ID)) return;

        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent =
            '.' + HIGHLIGHT_CLASS + ' {' +
            '  box-shadow: 0 0 0 3px #f4a261 !important;' +
            '  outline: none !important;' +
            '  transition: box-shadow 120ms ease-out !important;' +
            '  cursor: pointer !important;' +
            '}';
        // Mark for our own cleanup awareness.
        style.setAttribute('data-idb', 'true');

        (document.head || document.documentElement).appendChild(style);
        log('highlight style injected');
    }

    /* ------------------------------------------------------------------ *
     * Image matching helpers
     * ------------------------------------------------------------------ */

    // Normalize a URL for comparison: resolve relative URLs against the page
    // and strip fragments so equivalent images match.
    function normalizeUrl(src) {
        if (!src) return '';
        try {
            var u = new URL(src, location.href);
            u.hash = '';
            return u.href;
        } catch (e) {
            return String(src);
        }
    }

    // Build a Set of normalized URLs for O(1) lookup.
    function toNormalizedSet(urls) {
        var set = new Set();
        if (!urls || !urls.length) return set;
        for (var i = 0; i < urls.length; i++) {
            var n = normalizeUrl(urls[i]);
            if (n) set.add(n);
        }
        return set;
    }

    // Gather every <img> in the document, including those inside open shadow roots.
    // Recursively scan open shadow roots, including nested components.
    function allImages() {
        var imgs = [];
        function scan(root) {
            var elements = root.querySelectorAll('*');
            for (var i = 0; i < elements.length; i++) {
                var el = elements[i];
                if (el.tagName === 'IMG') imgs.push(el);
                if (el.shadowRoot) scan(el.shadowRoot);
            }
        }
        scan(document);
        return imgs;
    }

    /* ------------------------------------------------------------------ *
     * Highlight application
     * ------------------------------------------------------------------ */

    function applyHighlights(urls) {
        injectHighlightStyle();
        var set = toNormalizedSet(urls);
        var imgs = allImages();
        var count = 0;

        imgs.forEach(function (img) {
            var src = normalizeUrl(img.currentSrc || img.src);
            img.classList.toggle(HIGHLIGHT_CLASS, set.has(src));
            if (set.has(src)) {
                count++;
            }
        });

        log('highlighted', count, 'image(s) for', set.size, 'url(s)');
        return count;
    }

    function clearHighlights() {
        var marked = allImages().filter(function (img) { return img.classList.contains(HIGHLIGHT_CLASS); });
        for (var i = 0; i < marked.length; i++) {
            marked[i].classList.remove(HIGHLIGHT_CLASS);
        }
        log('cleared highlights from', marked.length, 'image(s)');
        return marked.length;
    }

    /* ------------------------------------------------------------------ *
     * Runtime message handling (popup / background -> content)
     * ------------------------------------------------------------------ */

    function handleRuntimeMessage(message, sender, sendResponse) {
        if (!message || typeof message !== 'object') return false;

        var type = message.type || message.action;

        switch (type) {
            case 'sendSelectedImages': {
                var urls = Array.isArray(message.urls) ? message.urls
                    : Array.isArray(message.images) ? message.images
                    : [];
                var highlighted = applyHighlights(urls);
                // Acknowledge asynchronously-safe.
                if (typeof sendResponse === 'function') {
                    sendResponse({ ok: true, count: highlighted });
                }
                return false;
            }

            case 'clearSelectedImages': {
                var cleared = clearHighlights();
                if (typeof sendResponse === 'function') {
                    sendResponse({ ok: true, count: cleared });
                }
                return false;
            }

            case 'clearCaptureSelection': {
                // Tell captureSelection.js (if loaded) to remove its overlay.
                window.dispatchEvent(new CustomEvent(CLEAR_SELECTION_EVENT));
                log('dispatched', CLEAR_SELECTION_EVENT);
                if (typeof sendResponse === 'function') {
                    sendResponse({ ok: true });
                }
                return false;
            }

            default:
                // Not our message; ignore.
                return false;
        }
    }

    /* ------------------------------------------------------------------ *
     * Page-script bridge (page -> content -> background)
     * ------------------------------------------------------------------ *
     * Pages that wish to open the extension UI can post a message:
     *
     *     window.postMessage({ action: 'imgdl_open' }, '*');
     *
     * We forward it to the background as { msg: 'openExtension' }.
     */
    function handlePageMessage(event) {
        var data = event.data;
        if (!data || typeof data !== 'object') return;
        // Only accept from the same frame context (window) for safety.
        if (event.source !== window) return;

        if (data.action === PAGE_OPEN_ACTION) {
            // Any script on the page can post this message. Only honor it right
            // after a real user interaction so pages cannot pop the UI unprompted.
            var activation = navigator.userActivation;
            if (!activation || !activation.isActive) {
                log('ignored page open request without user activation');
                return;
            }
            log('received page open request, forwarding to background');
            try {
                chrome.runtime.sendMessage({ msg: 'openExtension' }, function () {
                    // Swallow chrome.runtime.lastError silently — the background
                    // may be momentarily unavailable (service worker restart).
                    void chrome.runtime.lastError;
                });
            } catch (e) {
                log('failed to forward openExtension:', e && e.message);
            }
        }
    }

    /* ------------------------------------------------------------------ *
     * Wiring
     * ------------------------------------------------------------------ */

    function wireUp() {
        // Runtime messaging from popup/background.
        chrome.runtime.onMessage.addListener(handleRuntimeMessage);

        // Page-script bridge.
        window.addEventListener('message', handlePageMessage);

        log('listeners attached');
    }

    // Install as early as possible, even before DOMContentLoaded, since
    // messaging doesn't require a full DOM. Style injection self-defers
    // to document.head availability inside applyHighlights().
    wireUp();

    /* ------------------------------------------------------------------ *
     * Public surface (for debugging from devtools)
     * ------------------------------------------------------------------ */
    // Expose a tiny debug API under a namespaced global so it never collides.
    window.__idbInject = {
        version: '1.0.1',
        highlight: applyHighlights,
        clear: clearHighlights,
        debug: debugEnabled
    };
})();