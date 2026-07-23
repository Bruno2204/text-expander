/**
 * Text Expander — Background Service Worker
 * 
 * Handles initial loading of shortcuts from shortcuts.json into
 * chrome.storage.local on extension install. Also serves as a
 * message broker between content scripts and the popup.
 */

// Load default shortcuts on first install
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    try {
      const response = await fetch(chrome.runtime.getURL('shortcuts.json'));
      const shortcuts = await response.json();
      
      await chrome.storage.local.set({ shortcuts });
      console.log(
        `[Text Expander] ✅ Loaded ${Object.keys(shortcuts).length} shortcuts on install`
      );
    } catch (error) {
      console.error('[Text Expander] ❌ Error loading default shortcuts:', error);
      // Initialize with empty shortcuts so the extension still works
      await chrome.storage.local.set({ shortcuts: {} });
    }
  }
});

// Message handler for content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'getShortcuts':
      chrome.storage.local.get('shortcuts', (data) => {
        sendResponse(data.shortcuts || {});
      });
      return true; // Keep channel open for async response

    case 'getShortcutCount':
      chrome.storage.local.get('shortcuts', (data) => {
        const count = Object.keys(data.shortcuts || {}).length;
        sendResponse({ count });
      });
      return true;

    default:
      return false;
  }
});
