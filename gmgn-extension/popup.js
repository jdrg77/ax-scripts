const btn = document.getElementById('grant');
const status = document.getElementById('status');

chrome.permissions.contains({ origins: ['*://axiom.trade/*'] }, (already) => {
  if (already) {
    btn.textContent = '✅ Activado';
    btn.disabled = true;
    status.textContent = 'Listo — funciona en Axiom';
  }
});

btn.addEventListener('click', () => {
  chrome.permissions.request({ origins: ['*://axiom.trade/*'] }, (granted) => {
    if (!granted) {
      status.textContent = '❌ Permiso denegado';
      return;
    }
    btn.textContent = '✅ Activado';
    btn.disabled = true;
    status.textContent = 'Listo — funciona en Axiom';

    // Inject into any already-open Axiom tabs
    chrome.tabs.query({ url: '*://axiom.trade/*' }, (tabs) => {
      tabs.forEach(tab => {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        }).catch(() => {});
      });
    });
  });
});
