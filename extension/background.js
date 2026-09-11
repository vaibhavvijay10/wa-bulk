// Toolbar icon: open (or focus) WhatsApp Web and ask the panel to show itself.
const WA_URL = 'https://web.whatsapp.com/';

chrome.action.onClicked.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  if (tabs.length) {
    const tab = tabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
    try { await chrome.tabs.sendMessage(tab.id, { type: 'wab:toggle' }); } catch { /* content script not ready yet */ }
  } else {
    await chrome.storage.local.set({ wab_autoOpen: true });
    await chrome.tabs.create({ url: WA_URL });
  }
});
