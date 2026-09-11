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

// Once a day, look up the latest GitHub release so unpacked installs can be
// told that a newer version exists (store installs update on their own).
const RELEASES = 'https://api.github.com/repos/vaibhavvijay10/wa-bulk/releases/latest';
async function checkUpdate() {
  try {
    const { wab_updateCheckedAt } = await chrome.storage.local.get('wab_updateCheckedAt');
    if (wab_updateCheckedAt && Date.now() - wab_updateCheckedAt < 24 * 3600 * 1000) return;
    const r = await fetch(RELEASES, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return;
    const j = await r.json();
    const latest = String(j.tag_name || '').replace(/^v/, '');
    await chrome.storage.local.set({ wab_updateCheckedAt: Date.now(), wab_latest: { version: latest, url: j.html_url } });
  } catch { /* offline or rate limited: try again next time */ }
}
chrome.runtime.onInstalled.addListener(checkUpdate);
chrome.runtime.onStartup.addListener(checkUpdate);
chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'wab:checkUpdate') checkUpdate(); });
