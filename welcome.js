/*!
 * welcome.js — Onboarding page script for Image Download - Batch
 *
 * Wires up i18n messages for every element with a `messagesKey` attribute,
 * handles the "Get Started" button, and surfaces the keyboard shortcut that
 * opens the extension popup.
 *
 * Original implementation for Image Download - Batch by Ritesh Rana
 */
(function () {
  'use strict';

  // Shortcut command name defined in manifest.json > commands.
  // For MV3, `_execute_action` is the command bound to the toolbar action.
  var SHORTCUT_COMMAND = '_execute_action';

  /**
   * Apply a localized message to a single element, preserving any child
   * elements (icons) the node may contain. Only text nodes are swapped so
   * inline SVGs inside the CTA button survive localization.
   */
  function localizeElement(el, message) {
    if (!message) {
      return;
    }
    // Replace only the first text node so nested elements stay intact.
    var firstText = null;
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === Node.TEXT_NODE) {
        firstText = el.childNodes[i];
        break;
      }
    }
    if (firstText) {
      firstText.nodeValue = message;
    } else {
      el.textContent = message;
    }
  }

  /**
   * Walk every element carrying a `messagesKey` attribute and substitute its
   * text with the corresponding chrome.i18n message.
   */
  function applyLocalization() {
    if (typeof chrome === 'undefined' || !chrome.i18n ||
        typeof chrome.i18n.getMessage !== 'function') {
      return;
    }

    // Document title.
    var titleMsg = chrome.i18n.getMessage('welcomePageTitle');
    if (titleMsg) {
      document.title = titleMsg;
    }

    var nodes = document.querySelectorAll('[messagesKey]');
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('messagesKey');
      var msg = chrome.i18n.getMessage(key);
      localizeElement(nodes[i], msg);
    }
  }

  /**
   * Resolve the configured keyboard shortcut for the extension action and
   * inject it into the shortcut hint. Chrome does not expose arbitrary
   * command shortcuts to pages, so we fall back to the manifest defaults
   * (Ctrl+Shift+Y / Cmd+Shift+Y) when the API is unavailable.
   */
  function applyShortcut() {
    var hint = document.querySelector('.shortcut');
    if (!hint) {
      return;
    }

    // Detect platform for the Mac-specific label.
    var isMac = /Mac|iPhone|iPad/.test(navigator.platform) ||
                (navigator.userAgentData &&
                 navigator.userAgentData.platform &&
                 /mac/i.test(navigator.userAgentData.platform));

    var defaults = isMac
      ? ['Cmd', 'Shift', 'Y']
      : ['Ctrl', 'Shift', 'Y'];

    var keys = defaults.slice();

    // chrome.commands.getAll is available to extension pages.
    if (typeof chrome !== 'undefined' && chrome.commands &&
        typeof chrome.commands.getAll === 'function') {
      chrome.commands.getAll(function (commands) {
        if (chrome.runtime.lastError || !commands) {
          renderShortcut(hint, keys);
          return;
        }
        for (var i = 0; i < commands.length; i++) {
          if (commands[i].name === SHORTCUT_COMMAND && commands[i].shortcut) {
            // Chrome returns shortcuts like "Ctrl+Shift+Y" or "Command+Shift+Y".
            keys = commands[i].shortcut.split('+').map(function (part) {
              return part.trim();
            });
            break;
          }
        }
        renderShortcut(hint, keys);
      });
    } else {
      renderShortcut(hint, keys);
    }
  }

  /**
   * Rebuild the `<kbd>` sequence inside `.shortcut` while keeping the
   * localized label span intact.
   */
  function renderShortcut(hint, keys) {
    // Preserve the leading label span (the one carrying messagesKey).
    var label = hint.querySelector('span[messagesKey]');

    // Remove all <kbd> elements and stray text nodes.
    var children = Array.prototype.slice.call(hint.childNodes);
    for (var i = 0; i < children.length; i++) {
      var node = children[i];
      if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'KBD') {
        hint.removeChild(node);
      } else if (node.nodeType === Node.TEXT_NODE &&
                 node !== label && node.parentNode === hint) {
        // Drop the plain text separators (" + ") between <kbd> tags.
        if (label && node === label) {
          continue;
        }
        hint.removeChild(node);
      }
    }

    // Append " <kbd>key</kbd> + <kbd>key</kbd> ...".
    hint.appendChild(document.createTextNode(' '));
    for (var k = 0; k < keys.length; k++) {
      if (k > 0) {
        hint.appendChild(document.createTextNode(' + '));
      }
      var kbd = document.createElement('kbd');
      kbd.textContent = keys[k];
      hint.appendChild(kbd);
    }
  }

  /**
   * Close the welcome tab. `window.close()` works on tabs opened by the
   * extension; if that's blocked, walk back through history first.
   */
  function closeTab() {
    if (typeof chrome !== 'undefined' && chrome.tabs &&
        typeof chrome.tabs.getCurrent === 'function') {
      chrome.tabs.getCurrent(function (tab) {
        if (chrome.runtime.lastError || !tab) {
          window.close();
          return;
        }
        chrome.tabs.remove(tab.id, function () {
          if (chrome.runtime.lastError) {
            window.close();
          }
        });
      });
    } else {
      window.close();
    }
  }

  function init() {
    applyLocalization();
    applyShortcut();

    var getStarted = document.getElementById('getStartedButton');
    if (getStarted) {
      getStarted.addEventListener('click', closeTab);
    }

    // Allow Escape to dismiss the onboarding page as well.
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' || event.key === 'Enter') {
        if (event.key === 'Enter' && document.activeElement &&
            document.activeElement.id !== 'getStartedButton') {
          return;
        }
        event.preventDefault();
        closeTab();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();