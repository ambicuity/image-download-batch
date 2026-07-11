/*
 * contextMenu.js — "Download all images on this page" right-click action.
 *
 * Self-contained in the service worker: on click it injects the existing
 * scraper into the tab (which honors the prefer-full-resolution flag), then
 * downloads every discovered image. Imported by bg-entry.js.
 */
(function () {
  var MENU_ID = 'idb_download_all';

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
            for (var i = 0; i < urls.length; i++) {
              try {
                chrome.downloads.download({ url: urls[i], conflictAction: 'uniquify' }, function () {
                  if (chrome.runtime.lastError) { /* skip failed url */ }
                });
              } catch (e) {}
            }
          }
        );
      } catch (e) {}
    });
  }
})();
