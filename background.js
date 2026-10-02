/*
 * background.js — Original implementation for Image Download - Batch by Ritesh Rana
 *
 * Chrome Extension (Manifest V3) service worker.
 *
 * Loaded via importScripts('background.js') in bg-entry.js, which also loads
 * filenameTokens.js (globalThis.applyFilenameTokens) and contextMenu.js.
 *
 * Responsibilities:
 *   1. Storage wrapper  — chrome.storage.local with imgdl_ key prefix
 *   2. Display mode     — popup / sidePanel toggle
 *   3. Message hub       — runtime.onMessage for popup <-> background communication
 *   4. Port handler      — popup port disconnect clears selection state in the tab
 *   5. Download shaping  — supplies relative filenames for image requests
 *   6. Install/update    — migrate any legacy chrome.storage.sync data to local
 *
 * This is original code. It does not reference any other extension or reuse
 * bundled artifacts.
 */
(function () {
  'use strict';

  importScripts('sanitize.js');

  /* =========================================================================
   * 1. Storage wrapper
   * =========================================================================
   *
   * All preferences are stored in chrome.storage.local as plain JSON values.
   * Every key is prefixed with imgdl_ so the extension's storage namespace is
   * self-contained and easy to inspect/migrate. No encryption or obfuscation.
   */

  var STORAGE_PREFIX = 'imgdl_';

  /**
   * Read a single preference from local storage.
   * @param {string} key  — preference name (without the imgdl_ prefix)
   * @returns {Promise<*>} — resolved value, or undefined if not set
   */
  function getPref(key) {
    return new Promise(function (resolve) {
      chrome.storage.local.get([STORAGE_PREFIX + key], function (items) {
        if (chrome.runtime.lastError) {
          resolve(undefined);
          return;
        }
        resolve(items[STORAGE_PREFIX + key]);
      });
    });
  }

  /**
   * Write a single preference to local storage.
   * @param {string} key   — preference name (without prefix)
   * @param {*} value      — JSON-serializable value
   * @returns {Promise<void>}
   */
  function setPref(key, value) {
    return new Promise(function (resolve, reject) {
      var obj = {};
      obj[STORAGE_PREFIX + key] = value;
      chrome.storage.local.set(obj, function () {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        resolve();
      });
    });
  }

  /* =========================================================================
   * 2. Display mode manager
   * =========================================================================
   *
   * The extension can present itself as a toolbar popup or as a docked
   * side panel. The active mode lives in imgdl_displayMode and is applied at
   * startup and whenever the popup sends a changeDisplayMode message.
   */

  var PREF_DISPLAY_MODE = 'displayMode';
  var MODE_POPUP = 'popup';
  var MODE_SIDE_PANEL = 'sidePanel';

  /**
   * Configure chrome.action.setPopup and chrome.sidePanel.setOptions based on
   * the stored display mode. Called on startup and on mode changes.
   * @param {string} mode — 'popup' or 'sidePanel'
   * @returns {Promise<void>}
   */
  var currentDisplayMode = MODE_POPUP;
  var displayModeUpdates = Promise.resolve();
  var displayModeGeneration = 0;

  function applyDisplayMode(mode) {
    var isSidePanel = mode === MODE_SIDE_PANEL && !!chrome.sidePanel;
    displayModeUpdates = displayModeUpdates.catch(function () {}).then(function () {
      var panel = chrome.sidePanel;
      if (!panel) return;
      return Promise.resolve(panel.setOptions({ enabled: isSidePanel, path: 'popup.html?view=sidePanel' })).then(function () {
        // Handle the action ourselves so Chrome grants activeTab for captures.
        if (panel.setPanelBehavior) return panel.setPanelBehavior({ openPanelOnActionClick: false });
      });
    }).then(function () {
      return chrome.action.setPopup({ popup: isSidePanel ? '' : 'popup.html' });
    }).then(function () {
      currentDisplayMode = isSidePanel ? MODE_SIDE_PANEL : MODE_POPUP;
    });
    return displayModeUpdates;
  }

  /**
   * Read the stored display mode and apply it. Falls back to popup.
   * @returns {Promise<string>} the resolved mode
   */
  function initDisplayMode() {
    var generation = displayModeGeneration;
    return getPref(PREF_DISPLAY_MODE).then(function (mode) {
      if (generation !== displayModeGeneration) return currentDisplayMode;
      if (mode !== MODE_SIDE_PANEL && mode !== MODE_POPUP) {
        mode = MODE_POPUP;
      }
      return applyDisplayMode(mode).then(function () { return mode; });
    });
  }

  /**
   * Switch the display mode and persist it.
   * @param {string} mode — 'popup' or 'sidePanel'
   * @returns {Promise<{success:boolean, mode:string}>}
   */
  function changeDisplayMode(mode) {
    displayModeGeneration++;
    var resolvedMode = mode === MODE_SIDE_PANEL && chrome.sidePanel ? MODE_SIDE_PANEL : MODE_POPUP;
    return applyDisplayMode(resolvedMode).then(function () {
      return setPref(PREF_DISPLAY_MODE, resolvedMode);
    }).then(function () {
      // The next toolbar click opens the panel through the action listener.
      // Opening here after asynchronous storage/API calls loses the user gesture.
      return { success: true, mode: resolvedMode };
    });
  }

  /* =========================================================================
   * 3. Message hub
   * =========================================================================
   *
   * chrome.runtime.onMessage routes messages from the popup/inject scripts to
   * the appropriate handler. Each message carries a `msg` string.
   */

  // Runtime variable holding the most recent download options set by the popup.
  // Compatibility fallback for callers without an explicit options snapshot.
  var downloadOptions = null;

  /**
   * Open the extension UI. If side panel mode is active and available, open
   * the side panel; otherwise fall back to the toolbar popup.
   * @param {number} [tabId]
   */
  function openExtensionUi(tabId) {
    // Invoke the browser API immediately while any incoming user gesture is live.
    if (currentDisplayMode === MODE_SIDE_PANEL && chrome.sidePanel && chrome.sidePanel.open && tabId != null) {
      return Promise.resolve(chrome.sidePanel.open({ tabId: tabId }));
    }
    if (chrome.action && chrome.action.openPopup) return Promise.resolve(chrome.action.openPopup());
    return Promise.reject(new Error('The extension UI cannot be opened in this browser.'));
  }

  /**
   * Handle a single inbound message.
   * @param {object} message   — the message object
   * @param {object} sender    — sender info
   * @param {function} sendResponse — callback
   * @returns {boolean|undefined} — true to keep sendResponse async
   */
  function handleMessage(message, sender, sendResponse) {
    if (!message || typeof message.msg !== 'string') {
      return false;
    }

    try {
      switch (message.msg) {

        case 'changeDisplayMode': {
          var mode = message.displayMode === MODE_SIDE_PANEL ? MODE_SIDE_PANEL : MODE_POPUP;
          var tabId = message.tabId != null ? message.tabId : (sender.tab ? sender.tab.id : null);
          changeDisplayMode(mode, tabId).then(function (res) {
            sendResponse(res);
          }).catch(function () {
            sendResponse({ success: false, mode: mode });
          });
          return true; // async
        }

        case 'downloadImage': {
          var sourceUrl = message.sourceUrl || message.url;
          var name = 'image';
          try {
            var source = new URL(sourceUrl);
            if (source.protocol === 'http:' || source.protocol === 'https:') {
              name = decodeURIComponent(source.pathname.split('/').pop()) || name;
            }
          } catch (e) {}
          if (message.url.indexOf('data:image/') === 0) {
            var mime = message.url.match(/^data:image\/([a-z0-9.+-]+)/i);
            var ext = mime ? mime[1].split('+')[0] : 'png';
            if (ext === 'jpeg') ext = 'jpg';
            name = name.replace(/\.[^.]+$/, '') + '.' + ext;
          }
          var startDownload = function (resolvedName) {
            var filename = shapeDownloadFilename({
              originalName: resolvedName, url: sourceUrl,
              index: Math.max(1, parseInt(message.index, 10) || 1),
              options: message.downloadOptions || {}
            });
            chrome.downloads.download({ url: message.url, filename: filename, conflictAction: 'uniquify' }, function (id) {
              var error = chrome.runtime.lastError;
              sendResponse(error ? { success: false, error: error.message } : { success: true, id: id });
            });
          };
          // Chrome does not add an extension to a supplied filename, so URLs
          // like /media/abc?format=jpg would otherwise save as "abc".
          if (IMAGE_EXT_RE.test(name)) {
            startDownload(name);
          } else {
            inferImageExtension(sourceUrl).then(function (inferred) {
              startDownload(inferred ? name.replace(SCRIPT_EXT_RE, '') + '.' + inferred : name);
            });
          }
          return true;
        }

        case 'setDownloadOptions': {
          // Retain the existing message contract; image requests carry snapshots.
          var opts = message.downloadOptions || {};
          downloadOptions = {
            saveFileAs: opts.saveFileAs || 'SYSTEM_NAME',
            saveFileName: opts.saveFileName || '',
            saveFolderName: opts.saveFolderName || ''
          };
          sendResponse({ success: true });
          return false;
        }

        case 'canDisplayInSidePanel': {
          // Report whether the sidePanel API is available.
          sendResponse({ canDisplay: !!(chrome.sidePanel && chrome.sidePanel.open) });
          return false;
        }

        case 'initImageScraperWithScroll': {
          // Inject the scraper into the specified tab. The scroll variant is
          // intentionally not used here — imageScraper.js covers the DOM walk.
          var targetTabId = message.tabId || (sender.tab ? sender.tab.id : null);
          if (targetTabId != null) {
            chrome.scripting.executeScript(
              { target: { tabId: targetTabId, allFrames: true }, files: ['imageScraper.js'] },
              function () {
                if (chrome.runtime.lastError) { /* injection failed */ }
                sendResponse({ success: !chrome.runtime.lastError });
              }
            );
          } else {
            sendResponse({ success: false });
          }
          return true; // async
        }

        case 'closeTab': {
          var closeTabId = message.tabId || (sender.tab ? sender.tab.id : null);
          if (closeTabId != null) {
            chrome.tabs.remove(closeTabId, function () {
              if (chrome.runtime.lastError) { /* already closed */ }
              sendResponse({ success: !chrome.runtime.lastError });
            });
          } else {
            sendResponse({ success: false });
          }
          return true; // async
        }

        case 'openExtension': {
          // Open the popup or side panel for the active tab.
          openExtensionUi(sender.tab ? sender.tab.id : null).then(function () {
            sendResponse({ success: true });
          }).catch(function (error) {
            sendResponse({ success: false, error: error.message });
          });
          return true;
        }

        default:
          // Unknown message — no response.
          return false;
      }
    } catch (e) {
      // Defensive: never let a handler crash the worker.
      sendResponse({ success: false, error: String(e && e.message || e) });
      return false;
    }
  }

  /* =========================================================================
   * 4. Port handler
   * =========================================================================
   *
   * When the popup connects over a port named "popup/<tabId>", we watch for
   * disconnection. On disconnect we tell the tab to clear its selected-image
   * and capture-selection state so stale highlights don't linger.
   */

  /**
   * Extract the tab id from a popup port name.
   * Supports both "popup/<tabId>" and "idb-popup/<tabId>" forms.
   * @param {string} name
   * @returns {number|null}
   */
  function portNameToTabId(name) {
    if (typeof name !== 'string') return null;
    // Strip any leading prefix up to the last "/".
    var slash = name.lastIndexOf('/');
    if (slash < 0) return null;
    var id = name.slice(slash + 1);
    var n = parseInt(id, 10);
    return isNaN(n) ? null : n;
  }

  /**
   * Send a message to a specific tab.
   * @param {number} tabId
   * @param {object} payload
   */
  function sendToTab(tabId, payload) {
    try {
      chrome.tabs.sendMessage(tabId, payload, function () {
        if (chrome.runtime.lastError) { /* tab may be gone */ }
      });
    } catch (e) { /* tab not reachable */ }
  }

  /**
   * Registered on every connect.
   * @param {chrome.runtime.Port} port
   */
  function handleConnect(port) {
    // Only popup ports drive the clear-on-disconnect behavior.
    if (typeof port.name !== 'string') return;
    if (port.name.indexOf('popup/') !== 0 && port.name.indexOf('idb-popup/') !== 0) return;

    port.onDisconnect.addListener(function () {
      var tabId = portNameToTabId(port.name);
      if (tabId == null) return;
      sendToTab(tabId, { type: 'clearSelectedImages' });
      sendToTab(tabId, { type: 'clearCaptureSelection' });
    });
  }

  /* =========================================================================
   * 5. Download filename shaping
   * =========================================================================
   *
   * Image requests carry their source URL, index and naming options. Supply the
   * resulting relative filename when starting the download.
   */

  /**
   * Extract the download index from a URL's query string if present.
   * Compatibility fallback; current popup requests supply the index separately.
   * @param {string} url
   * @returns {string} — index string, defaults to '1'
   */
  function extractIndexFromUrl(url) {
    try {
      var idx = new URL(url).searchParams.get('index');
      return idx || '1';
    } catch (e) {
      return '1';
    }
  }

  var IMAGE_EXT_RE = /\.(?:jpe?g|png|gif|webp|avif|svg|bmp|ico|tiff?|jfif|heic|heif)$/i;
  // Server-script suffixes replaced by the inferred image extension (view.php -> view.jpg).
  var SCRIPT_EXT_RE = /\.(?:php|aspx?|ashx|axd|jsp|cgi|do|html?)$/i;
  // Query parameters image CDNs use to select the output format.
  var FORMAT_PARAMS = ['format', 'fm', 'ext'];
  var HEAD_TIMEOUT_MS = 5000;

  /** Map a format/MIME subtype to a file extension, or '' when not an image type. */
  function normalizeImageExt(value) {
    var ext = String(value || '').toLowerCase().split('+')[0];
    if (ext === 'jpeg' || ext === 'pjpeg') ext = 'jpg';
    if (ext === 'x-icon' || ext === 'vnd.microsoft.icon') ext = 'ico';
    return IMAGE_EXT_RE.test('.' + ext) ? ext : '';
  }

  /**
   * Determine the image extension of a URL whose path has none: first from a
   * format query parameter, then from a HEAD request's Content-Type.
   * @param {string} url
   * @returns {Promise<string>} extension without the dot, or ''
   */
  function inferImageExtension(url) {
    var params;
    try { params = new URL(url).searchParams; } catch (e) { return Promise.resolve(''); }
    for (var i = 0; i < FORMAT_PARAMS.length; i++) {
      var fromQuery = normalizeImageExt(params.get(FORMAT_PARAMS[i]));
      if (fromQuery) return Promise.resolve(fromQuery);
    }
    if (typeof fetch !== 'function') return Promise.resolve('');
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, HEAD_TIMEOUT_MS);
    return fetch(url, { method: 'HEAD', credentials: 'include', signal: controller.signal }).then(function (response) {
      var type = (response.ok && response.headers.get('content-type')) || '';
      var match = type.match(/^\s*image\/([a-z0-9.+-]+)/i);
      return match ? normalizeImageExt(match[1]) : '';
    }).catch(function () { return ''; }).then(function (ext) {
      clearTimeout(timer);
      return ext;
    });
  }

  /**
   * Resolve a subfolder name. "basedonurl" means use the hostname of the
   * source URL; any other non-empty value is used literally.
   * @param {string} folder  — raw folder preference
   * @param {string} url     — source URL (for hostname resolution)
   * @returns {string} — resolved folder segment (no trailing slash), or ''
   */
  function resolveSubfolder(folder, url) {
    if (!folder) return '';
    if (folder === 'basedonurl') {
      try {
        var host = new URL(url).hostname;
        return host || '';
      } catch (e) {
        return '';
      }
    }
    return String(folder);
  }

  /**
   * Build the final filename for an extension-initiated download.
   * @param {object} params
   * @param {string} params.originalName — source URL basename or MIME-derived name
   * @param {string} params.url         — source URL
   * @param {number} params.index        — batch position
   * @param {object} params.options      — per-request naming settings
   * @returns {string} shaped filename (may include subfolder path)
   */
  function shapeDownloadFilename(params) {
    var originalName = params.originalName;
    var url = params.url;
    var opts = params.options || downloadOptions || {};
    var saveFileAs = opts.saveFileAs || 'SYSTEM_NAME';
    var template = opts.saveFileName || '';
    var folderPref = opts.saveFolderName || '';

    // Split original name into base + extension.
    originalName = String(originalName).split(/[\\/]/).pop() || 'image';
    var parts = String(originalName).split('.');
    var ext = parts.length > 1 ? parts.pop() : '';
    var base = parts.join('.') || 'image';

    var shaped;

    if (saveFileAs === 'ORIGINAL_FILE_NAME') {
      // Preserve the source URL's basename.
      shaped = originalName || (base + (ext ? '.' + ext : ''));
    } else if (saveFileAs === 'CUSTOM_NAME') {
      // Use the token template. applyFilenameTokens handles {ext} inclusion
      // and auto-appends the extension when {ext} is absent.
      if (typeof globalThis.applyFilenameTokens === 'function') {
        shaped = globalThis.applyFilenameTokens(template, {
          name: base,
          index: params.index || extractIndexFromUrl(url),
          ext: ext,
          url: url,
          now: new Date()
        });
      } else {
        shaped = template ? template + (ext ? '.' + ext : '') : originalName;
      }
    } else {
      // SYSTEM_NAME (default): deterministic index-based name.
      var index = params.index || extractIndexFromUrl(url);
      shaped = 'imgi_' + index + '_' + originalName;
    }

    shaped = sanitizeFilename(shaped);

    // Treat user input as one folder segment, preventing invalid download paths.
    var folder = resolveSubfolder(folderPref, url);
    if (folder) folder = sanitizeFilename(folder);
    if (folder) {
      shaped = folder + '/' + shaped;
    }

    return shaped;
  }

  /* =========================================================================
   * 6. Install / update handler
   * =========================================================================
   *
   * bg-entry.js handles opening welcome.html on install. Here we handle the
   * update case: migrate any legacy data from chrome.storage.sync to local.
   */

  /**
   * Copy every key from chrome.storage.sync into chrome.storage.local (under
   * the imgdl_ prefix if not already prefixed) and then clear sync storage.
   * This is a one-way migration; it only runs on update.
   * @returns {Promise<void>}
   */
  function migrateSyncToLocal() {
    return new Promise(function (resolve) {
      if (!chrome.storage.sync || !chrome.storage.sync.get) {
        resolve();
        return;
      }
      chrome.storage.sync.get(null, function (items) {
        if (chrome.runtime.lastError || !items) {
          resolve();
          return;
        }
        var keys = Object.keys(items);
        if (keys.length === 0) {
          resolve();
          return;
        }

        // Build a local-storage object, normalizing keys to imgdl_ prefix.
        var localObj = {};
        keys.forEach(function (k) {
          var dest = (k.indexOf(STORAGE_PREFIX) === 0) ? k : (STORAGE_PREFIX + k);
          localObj[dest] = items[k];
        });

        chrome.storage.local.set(localObj, function () {
          // Retain the source preferences if the local write fails.
          if (chrome.runtime.lastError) { resolve(); return; }
          chrome.storage.sync.clear(function () {
            if (chrome.runtime.lastError) { /* ignore */ }
            resolve();
          });
        });
      });
    });
  }

  /**
   * chrome.runtime.onInstalled listener. INSTALL is handled by bg-entry.js
   * (welcome page); we only act on UPDATE to run the sync->local migration.
   */
  function onInstalled(details) {
    if (details.reason === 'update') {
      migrateSyncToLocal().catch(function () { /* best-effort */ });
    }
  }

  /* =========================================================================
   * Registration
   * =========================================================================
   *
   * All listeners must be registered synchronously at the top level of the
   * service worker so they survive worker restarts.
   */

  // Message hub.
  if (chrome.action && chrome.action.onClicked) {
    chrome.action.onClicked.addListener(function (tab) {
      // Call synchronously within the toolbar/shortcut gesture, before any
      // storage access. Popup mode is handled by action.default_popup.
      if (!chrome.sidePanel || !tab || tab.id == null) return;
      try {
        Promise.resolve(chrome.sidePanel.open({ tabId: tab.id })).catch(function (error) {
          console.error('Could not open image download side panel:', error);
        });
      } catch (error) { console.error('Could not open image download side panel:', error); }
    });
  }
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(handleMessage);
  }

  // Port handler (popup disconnect -> clear selection).
  if (chrome.runtime && chrome.runtime.onConnect) {
    chrome.runtime.onConnect.addListener(handleConnect);
  }

  // Filenames are supplied per request to downloads.download. Registering a
  // determining-filename listener discards that supplied name in Chrome, even
  // when the listener declines to suggest a replacement.

  // Install/update.
  if (chrome.runtime && chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(onInstalled);
  }

  // Apply the stored display mode on every worker startup.
  initDisplayMode().catch(function () { /* ignore — defaults to popup */ });

})();
