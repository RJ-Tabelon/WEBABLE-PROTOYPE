// AI-generated. Owns chrome.scripting.insertCSS: only callable from the
// extension side, not from a content script, so the content script asks
// here and we report back whether it threw.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'tier0-insert-user-css') return false;

  const tabId = sender.tab?.id;
  const frameId = sender.frameId;
  if (tabId == null) {
    sendResponse({ ok: false, error: 'no tab id' });
    return false;
  }

  chrome.scripting
    .insertCSS({
      target: { tabId, frameIds: frameId != null ? [frameId] : undefined },
      files: ['adaptation.css'],
      origin: 'USER',
    })
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));

  return true; // keep sendResponse alive for the async chrome.scripting call
});
