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
 *   5. Download shaping  — onDeterminingFilename renames extension-initiated downloads
 *   6. Referer injection — declarativeNetRequest session rules for cross-origin image fetches
 *   7. Install/update    — migrate any legacy chrome.storage.sync data to local
 *
 * This is original code. It does not reference any other extension or reuse
 * bundled artifacts.
 */
(function () {
  'use strict';

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
    return new Promise(function (resolve) {
      var obj = {};
      obj[STORAGE_PREFIX + key] = value;
      chrome.storage.local.set(obj, function () {
        // Swallow lastError — storage writes are best-effort.
        if (chrome.runtime.lastError) { /* intentionally ignored */ }
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
  function applyDisplayMode(mode) {
    return new Promise(function (resolve) {
      var isSidePanel = mode === MODE_SIDE_PANEL;

      // Toggle the toolbar popup. When side-panel mode is active we clear the
      // popup URL so clicking the icon opens the side panel instead.
      try {
        chrome.action.setPopup({ popup: isSidePanel ? '' : 'popup.html' });
      } catch (e) { /* action API not available */ }

      // Configure the side panel so it can host popup.html.
      if (chrome.sidePanel && chrome.sidePanel.setOptions) {
        try {
          chrome.sidePanel.setOptions({
            enabled: isSidePanel,
            path: 'popup.html'
          });
        } catch (e) { /* setOptions not available */ }
      }

      resolve();
    });
  }

  /**
   * Read the stored display mode and apply it. Falls back to popup.
   * @returns {Promise<string>} the resolved mode
   */
  function initDisplayMode() {
    return getPref(PREF_DISPLAY_MODE).then(function (mode) {
      if (mode !== MODE_SIDE_PANEL && mode !== MODE_POPUP) {
        mode = MODE_POPUP;
      }
      return applyDisplayMode(mode).then(function () { return mode; });
    });
  }

  /**
   * Switch the display mode and persist it.
   * @param {string} mode — 'popup' or 'sidePanel'
   * @param {number} [tabId] — active tab, used when opening the side panel
   * @returns {Promise<{success:boolean, mode:string}>}
   */
  function changeDisplayMode(mode, tabId) {
    return setPref(PREF_DISPLAY_MODE, mode).then(function () {
      return applyDisplayMode(mode);
    }).then(function () {
      // If switching to side panel, open it immediately on the active tab.
      if (mode === MODE_SIDE_PANEL && tabId != null && chrome.sidePanel && chrome.sidePanel.open) {
        try { chrome.sidePanel.open({ tabId: tabId }); } catch (e) { /* ignore */ }
      }
      return { success: true, mode: mode };
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
  // Consumed by chrome.downloads.onDeterminingFilename.
  var downloadOptions = null;

  /**
   * Open the extension UI. If side panel mode is active and available, open
   * the side panel; otherwise fall back to the toolbar popup.
   * @param {number} [tabId]
   */
  function openExtensionUi(tabId) {
    getPref(PREF_DISPLAY_MODE).then(function (mode) {
      var useSidePanel = mode === MODE_SIDE_PANEL && chrome.sidePanel && chrome.sidePanel.open;
      if (useSidePanel && tabId != null) {
        try {
          chrome.sidePanel.open({ tabId: tabId });
          return;
        } catch (e) { /* fall through to popup */ }
      }
      if (chrome.action && chrome.action.openPopup) {
        try { chrome.action.openPopup({ tabId: tabId }); } catch (e) { /* ignore */ }
      }
    });
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

        case 'setDownloadOptions': {
          // Store download options for the onDeterminingFilename listener.
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
          openExtensionUi(sender.tab ? sender.tab.id : null);
          sendResponse({ success: true });
          return false;
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
   * chrome.downloads.onDeterminingFilename lets us rewrite the filename for
   * downloads initiated by this extension. We detect our own downloads via a
   * marker prefix (imgdl___-_) embedded in the suggested filename or by
   * matching the initiator extension id.
   */

  // Marker prefix embedded in download filenames so we can identify our own.
  var DOWNLOAD_MARKER = 'imgdl___-_';

  /**
   * Extract the download index from a URL's query string if present.
   * The popup appends ?index=N to image URLs so we can sequence downloads.
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

  /**
   * Strip the download marker from a filename, if present.
   * @param {string} filename
   * @returns {string}
   */
  function stripMarker(filename) {
    if (typeof filename === 'string' && filename.indexOf(DOWNLOAD_MARKER) !== -1) {
      return filename.split(DOWNLOAD_MARKER).pop();
    }
    return filename;
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
   * @param {string} params.originalName — filename without marker
   * @param {string} params.url         — source URL
   * @param {string} params.filename     — raw filename from the download item
   * @returns {string} shaped filename (may include subfolder path)
   */
  function shapeDownloadFilename(params) {
    var originalName = params.originalName;
    var url = params.url;
    var opts = downloadOptions || {};
    var saveFileAs = opts.saveFileAs || 'SYSTEM_NAME';
    var template = opts.saveFileName || '';
    var folderPref = opts.saveFolderName || '';

    // Split original name into base + extension.
    var parts = String(originalName).split('.');
    var ext = parts.length > 1 ? parts.pop() : '';
    var base = parts.join('.') || 'image';

    var shaped;

    if (saveFileAs === 'ORIGINAL_FILE_NAME') {
      // Preserve the original filename exactly as the server provided it.
      shaped = originalName || (base + (ext ? '.' + ext : ''));
    } else if (saveFileAs === 'CUSTOM_NAME') {
      // Use the token template. applyFilenameTokens handles {ext} inclusion
      // and auto-appends the extension when {ext} is absent.
      if (typeof globalThis.applyFilenameTokens === 'function') {
        shaped = globalThis.applyFilenameTokens(template, {
          name: base,
          index: extractIndexFromUrl(url),
          ext: ext,
          url: url,
          now: new Date()
        });
      } else {
        shaped = template ? template + (ext ? '.' + ext : '') : originalName;
      }
    } else {
      // SYSTEM_NAME (default): deterministic index-based name.
      var index = extractIndexFromUrl(url);
      shaped = 'imgi_' + index + '_' + originalName;
    }

    // Prepend subfolder if specified.
    var folder = resolveSubfolder(folderPref, url);
    if (folder) {
      shaped = folder + '/' + shaped;
    }

    return shaped;
  }

  /**
   * onDeterminingFilename listener. Returns true to indicate an async suggest
   * call is pending.
   */
  function onDeterminingFilename(downloadItem, suggest) {
    // Only shape downloads that originate from this extension.
    var isOurs = false;
    if (downloadItem.byExtensionId === chrome.runtime.id) {
      isOurs = true;
    } else if (typeof downloadItem.filename === 'string' && downloadItem.filename.indexOf(DOWNLOAD_MARKER) !== -1) {
      isOurs = true;
    }

    if (!isOurs) {
      return false; // let Chrome use the default name
    }

    try {
      var originalName = stripMarker(downloadItem.filename || '');
      var shaped = shapeDownloadFilename({
        originalName: originalName,
        url: downloadItem.url || '',
        filename: downloadItem.filename || ''
      });
      suggest({ filename: shaped, conflictAction: 'uniquify' });
    } catch (e) {
      // Fall back to the original filename if shaping fails.
      suggest({ filename: downloadItem.filename, conflictAction: 'uniquify' });
    }
    return true;
  }

  /* =========================================================================
   * 6. Referer injection
   * =========================================================================
   *
   * Some image hosts reject requests without a Referer matching the page
   * origin. When the popup fetches a cross-origin image we add a session
   * declarativeNetRequest rule that sets the Referer header to the page
   * origin for requests from the extension to that image URL.
   *
   * Rules are created on demand and cleaned up when downloads complete.
   */

  // Start of the dynamic rule id range we allocate.
  var DNR_BASE_ID = 5000;
  // Map of ruleId -> { url, origin } so we can remove rules precisely.
  var activeRefererRules = {};

  /**
   * Add (or refresh) a Referer rule for a specific image URL.
   * @param {string} imageUrl   — the image URL being fetched
   * @param {string} pageUrl    — the page that links the image (for origin)
   * @returns {Promise<void>}
   */
  function addRefererRule(imageUrl, pageUrl) {
    if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateSessionRules) {
      return Promise.resolve();
    }
    var origin = '';
    try { origin = new URL(pageUrl).origin; } catch (e) { return Promise.resolve(); }

    // Allocate a stable rule id based on a simple counter.
    var ruleId = DNR_BASE_ID + Object.keys(activeRefererRules).length + 1;
    var rule = {
      id: ruleId,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Referer', operation: 'set', value: origin + '/' }
        ]
      },
      condition: {
        urlFilter: imageUrl,
        resourceTypes: ['image']
      }
    };

    return new Promise(function (resolve) {
      chrome.declarativeNetRequest.updateSessionRules(
        { addRules: [rule], removeRuleIds: [ruleId] },
        function () {
          if (chrome.runtime.lastError) { /* rule add failed */ }
          activeRefererRules[ruleId] = { url: imageUrl, origin: origin };
          resolve();
        }
      );
    });
  }

  /**
   * Remove all active referer rules. Called when downloads complete or the
   * worker is about to be idle.
   * @returns {Promise<void>}
   */
  function clearRefererRules() {
    if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateSessionRules) {
      return Promise.resolve();
    }
    var ids = Object.keys(activeRefererRules).map(function (k) { return parseInt(k, 10); });
    if (ids.length === 0) return Promise.resolve();
    return new Promise(function (resolve) {
      chrome.declarativeNetRequest.updateSessionRules(
        { removeRuleIds: ids },
        function () {
          if (chrome.runtime.lastError) { /* ignore */ }
          activeRefererRules = {};
          resolve();
        }
      );
    });
  }

  /* =========================================================================
   * 7. Install / update handler
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
          // Clear sync after copying regardless of lastError.
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
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(handleMessage);
  }

  // Port handler (popup disconnect -> clear selection).
  if (chrome.runtime && chrome.runtime.onConnect) {
    chrome.runtime.onConnect.addListener(handleConnect);
  }

  // Download filename shaping.
  if (chrome.downloads && chrome.downloads.onDeterminingFilename) {
    chrome.downloads.onDeterminingFilename.addListener(onDeterminingFilename);
  }

  // Clean up referer rules when all downloads from this extension finish.
  if (chrome.downloads && chrome.downloads.onChanged) {
    chrome.downloads.onChanged.addListener(function (delta) {
      if (delta.state && delta.state.current === 'complete') {
        clearRefererRules();
      }
    });
  }

  // Install/update.
  if (chrome.runtime && chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(onInstalled);
  }

  // Apply the stored display mode on every worker startup.
  initDisplayMode().catch(function () { /* ignore — defaults to popup */ });

})();