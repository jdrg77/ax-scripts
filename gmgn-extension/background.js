// Inject content script into Axiom tabs when they load (after permission is granted)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url?.includes('axiom.trade')) return;
  chrome.permissions.contains({ origins: ['*://axiom.trade/*'] }, (has) => {
    if (!has) return;
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    }).catch(() => {});
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'OPEN_GMGN' || !msg.ca) return;

  const url = `https://gmgn.ai/sol/token/${msg.ca}`;

  chrome.tabs.query({ url: '*://gmgn.ai/*' }, (tabs) => {
    if (tabs.length > 0) {
      chrome.tabs.update(tabs[0].id, { url, active: true });
    } else {
      chrome.tabs.create({ url });
    }
  });
});
