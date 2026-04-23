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
