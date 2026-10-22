/*
 * contextMenu.js — "Download all images on this page" right-click action.
 *
 * Self-contained in the service worker: on click it injects the existing
 * scraper into the tab (which honors the prefer-full-resolution flag), then
 * downloads every discovered image.  The downloads use the same naming rules
 * as the popup (see downloadNaming.js) so the user's saved custom-name
 * template and subfolder are honoured here too, and a large batch is confirmed
 * before it starts instead of downloading silently.
 *
 * Imported by bg-entry.js.
 */
(function () {
  var MENU_ID = 'idb_download_all';

  /** Number of images above which the batch is confirmed first. */
  var MANY_FILES_THRESHOLD = 30;

  /** Session-storage key holding a batch that awaits the user's confirmation. */
  var PENDING_BATCH_KEY = 'imgdl_pendingBatch';

  /* __FLATTEN_START__ */
  // Flatten per-frame executeScript results into a first-seen deduped list of
  // image URL strings. Pure + unit-tested.
  function flattenDedupeImages(results) {
    var seen = {}, out = [];
    if (!Array.isArray(results)) return out;
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var imgs = r && r.result && r.result.images;
      if (!Array.isArray(imgs)) continue;
      for (var j = 0; j < imgs.length; j++) {
        var u = imgs[j];
        if (typeof u === 'string' && u && !Object.prototype.hasOwnProperty.call(seen, u)) {
          seen[u] = 1;
          out.push(u);
        }
      }
    }
    return out;
  }
  /* __FLATTEN_END__ */

  function menuTitle() {
    try {
      var m = chrome.i18n && chrome.i18n.getMessage('downloadAllImagesMenu');
      if (m) return m;
    } catch (e) {}
    return 'Download all images on this page';
  }

  function createMenu() {
    if (!chrome.contextMenus) return;
    chrome.contextMenus.removeAll(function () {
      if (chrome.runtime.lastError) { /* ignore */ }
      chrome.contextMenus.create({
        id: MENU_ID,
        title: menuTitle(),
        contexts: ['page', 'frame', 'image', 'link', 'video', 'selection']
      }, function () { if (chrome.runtime.lastError) { /* already exists */ } });
    });
  }

  /**
   * Read the preferences that decide how a batch is named and whether the
   * many-files warning applies.
   * @param {function} cb — receives {saveFileAs, saveFileName, saveFolderName, doNotBother}
   */
  function readBatchPreferences(cb) {
    var keys = ['imgdl_savefileas', 'imgdl_savefilename', 'imgdl_savefoldername', 'imgdl_donotbother'];
    try {
      chrome.storage.local.get(keys, function (cfg) {
        cfg = cfg || {};
        cb({
          saveFileAs: cfg.imgdl_savefileas || 'SYSTEM_NAME',
          saveFileName: cfg.imgdl_savefilename || '',
          saveFolderName: cfg.imgdl_savefoldername || '',
          doNotBother: !!cfg.imgdl_donotbother
        });
      });
    } catch (e) {
      cb({ saveFileAs: 'SYSTEM_NAME', saveFileName: '', saveFolderName: '', doNotBother: false });
    }
  }

  /**
   * Download one image using the shared naming rules.
   * @param {string} url
   * @param {number} index — 1-based position in the batch
   * @param {object} options — naming options
   */
  function downloadImage(url, index, options) {
    resolveFinalName(url, url).then(function (resolvedName) {
      var filename = shapeDownloadFilename({
        originalName: resolvedName,
        url: url,
        index: index,
        options: options
      });
      try {
        chrome.downloads.download({ url: url, filename: filename, conflictAction: 'uniquify' }, function () {
          if (chrome.runtime.lastError) { /* skip failed url */ }
        });
      } catch (e) {}
    }).catch(function () { /* skip failed url */ });
  }

  /**
   * Download every URL of the batch.
   * @param {string[]} urls
   * @param {object} options — naming options
   */
  function downloadBatch(urls, options) {
    for (var i = 0; i < urls.length; i++) {
      downloadImage(urls[i], i + 1, options);
    }
  }

  /**
   * Open the extension UI so the user can confirm a large batch.
   * @param {number} tabId
   */
  function openExtensionUi(tabId) {
    try {
      if (chrome.sidePanel && chrome.sidePanel.open && tabId != null) {
        return Promise.resolve(chrome.sidePanel.open({ tabId: tabId }))
          .catch(function () { return openPopup(); });
      }
      return openPopup();
    } catch (e) {
      return openPopup();
    }
  }

  function openPopup() {
    try {
      if (chrome.action && chrome.action.openPopup) {
        return Promise.resolve(chrome.action.openPopup());
      }
    } catch (e) { /* fall through */ }
    return Promise.reject(new Error('The extension UI cannot be opened.'));
  }

  /**
   * Hold the batch for confirmation and open the UI.  When the UI cannot be
   * opened the batch is downloaded directly so the feature still works.
   * @param {string[]} urls
   * @param {number} tabId
   */
  function requestConfirmation(urls, tabId) {
    var stored = false;
    try {
      if (chrome.storage && chrome.storage.session) {
        var payload = {};
        payload[PENDING_BATCH_KEY] = urls;
        chrome.storage.session.set(payload, function () { stored = true; });
      }
    } catch (e) { /* fall through to the direct download */ }

    openExtensionUi(tabId).then(function () {
      // The UI is open and reads the pending batch from session storage.
    }).catch(function () {
      // The UI could not be opened: download the batch directly so the
      // right-click action is not silently lost.
      readBatchPreferences(function (options) { downloadBatch(urls, options); });
    });
  }

  // Register the menu once per install/update and on each browser start.
  if (chrome.runtime && chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(createMenu);
  }
  if (chrome.runtime && chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(createMenu);
  }

  // Click handler must be registered synchronously on every worker startup.
  if (chrome.contextMenus && chrome.contextMenus.onClicked) {
    chrome.contextMenus.onClicked.addListener(function (info, tab) {
      if (info.menuItemId !== MENU_ID || !tab || !tab.id) return;
      try {
        chrome.scripting.executeScript(
          { target: { tabId: tab.id, allFrames: true }, files: ['imageScraper.js'] },
          function (results) {
            if (chrome.runtime.lastError || !results) return;
            var urls = flattenDedupeImages(results);
            if (!urls.length) return;
            readBatchPreferences(function (options) {
              if (urls.length > MANY_FILES_THRESHOLD && !options.doNotBother) {
                requestConfirmation(urls, tab.id);
                return;
              }
              downloadBatch(urls, options);
            });
          }
        );
      } catch (e) {}
    });
  }
})();
