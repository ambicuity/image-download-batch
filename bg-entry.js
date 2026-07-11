chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});

importScripts('filenameTokens.js');
importScripts('contextMenu.js');
importScripts('background.js');
