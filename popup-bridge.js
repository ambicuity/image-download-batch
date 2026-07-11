(function () {
  var SELECT_ALL_SVG =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3" y="3" width="18" height="18" rx="2"></rect>' +
    '<path d="M9 12l2 2 4-4"></path></svg>';

  function restoreSelectAllIcon(btn) {
    if (!btn || btn.querySelector('svg')) return;

    var labelText = (btn.textContent || '').trim();
    if (labelText) {
      btn.setAttribute('aria-label', labelText);
      btn.setAttribute('title', labelText);
    }
    btn.innerHTML = SELECT_ALL_SVG;
  }

  function syncSelectAllPressed(btn) {
    btn.setAttribute(
      'aria-pressed',
      btn.classList.contains('--active') ? 'true' : 'false'
    );
  }

  function syncTwoColsPressed(btn) {
    var ancestor = btn.closest('.twocols');
    btn.setAttribute('aria-pressed', ancestor ? 'true' : 'false');
  }

  function init() {
    var btn = document.getElementById('selectalla');
    if (btn) {
      restoreSelectAllIcon(btn);
      syncSelectAllPressed(btn);

      var btnObserver = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          if (mutations[i].type === 'childList') restoreSelectAllIcon(btn);
          if (mutations[i].type === 'attributes') syncSelectAllPressed(btn);
        }
      });
      btnObserver.observe(btn, {
        childList: true,
        attributes: true,
        attributeFilter: ['class']
      });
    }

    var twoCols = document.querySelector('.twoColsPref');
    if (twoCols) {
      syncTwoColsPressed(twoCols);
      var ancestorObserver = new MutationObserver(function () {
        syncTwoColsPressed(twoCols);
      });
      var node = twoCols.parentNode;
      while (node && node.nodeType === 1) {
        ancestorObserver.observe(node, {
          attributes: true,
          attributeFilter: ['class']
        });
        node = node.parentNode;
      }
    }

    wirePreferFullRes();
    wireUrlActions();
  }

  /* __DEDUPE_START__ */
  // First-seen de-dupe of a URL string array (drops falsy / non-strings /
  // whitespace-only). Pure + unit-tested.
  function dedupeUrls(urls) {
    var seen = {}, out = [];
    if (!Array.isArray(urls)) return out;
    for (var i = 0; i < urls.length; i++) {
      var u = urls[i];
      if (typeof u !== 'string') continue;
      u = u.trim();
      if (!u || Object.prototype.hasOwnProperty.call(seen, u)) continue;
      seen[u] = 1;
      out.push(u);
    }
    return out;
  }
  /* __DEDUPE_END__ */

  // Collect grid image URLs: selected cards if any are selected, else all.
  function getImageUrls() {
    var selected = document.querySelectorAll('.imgContainer.imgSelected:not(.excluded)');
    var nodes = selected.length ? selected : document.querySelectorAll('.imgContainer:not(.excluded)');
    var urls = [];
    for (var i = 0; i < nodes.length; i++) urls.push(nodes[i].getAttribute('imgsrc'));
    return dedupeUrls(urls);
  }

  function showToast(message) {
    var container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      document.body.appendChild(container);
    }
    var toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function () {
      toast.classList.add('toast--out');
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 220);
    }, 2400);
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { legacyCopy(text); });
    }
    legacyCopy(text);
    return Promise.resolve();
  }

  function copyImageUrls() {
    var urls = getImageUrls();
    if (!urls.length) { showToast('No image URLs to copy'); return; }
    copyText(urls.join('\n')).then(function () {
      showToast('Copied ' + urls.length + ' URL' + (urls.length === 1 ? '' : 's'));
    });
  }

  function exportImageUrls() {
    var urls = getImageUrls();
    if (!urls.length) { showToast('No image URLs to export'); return; }
    try {
      var blob = new Blob([urls.join('\n') + '\n'], { type: 'text/plain' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'image-urls.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      showToast('Exported ' + urls.length + ' URL' + (urls.length === 1 ? '' : 's'));
    } catch (e) {
      showToast('Export failed');
    }
  }

  function isTypingTarget(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  }

  // Copy/export buttons + in-popup keyboard shortcuts (Cmd/Ctrl+A select-all,
  // C copy URLs, E export URLs). Shortcuts are ignored while typing in a field.
  function wireUrlActions() {
    var copyBtn = document.getElementById('copyImageUrls');
    if (copyBtn) copyBtn.addEventListener('click', copyImageUrls);

    document.addEventListener('keydown', function (e) {
      if (isTypingTarget(e.target)) return;
      var key = (e.key || '').toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === 'a') {
        var sel = document.getElementById('selectalla');
        if (sel) { e.preventDefault(); sel.click(); }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (key === 'c') copyImageUrls();
      else if (key === 'e') exportImageUrls();
    });
  }

  // "Prefer full resolution" toggle. Self-contained: reads/writes the pref
  // directly to chrome.storage.local (independent of popup.js's pref system).
  // The injected scraper reads the same key on the next scan.
  function wirePreferFullRes() {
    var cb = document.getElementById('preferFullRes');
    if (!cb || !(typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local)) return;
    var KEY = 'imgdl_preferFullRes';
    chrome.storage.local.get(KEY, function (cfg) {
      cb.checked = !!(cfg && cfg[KEY]);
    });
    cb.addEventListener('change', function () {
      var update = {};
      update[KEY] = cb.checked;
      chrome.storage.local.set(update, function () {
        // Re-scan so the change takes effect immediately, if a reload control exists.
        var reload = document.getElementById('reloadImageDownloadBatch');
        if (reload) reload.click();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
