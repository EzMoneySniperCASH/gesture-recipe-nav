/**
 * Injects the gesture runner into the page MAIN world (bypasses page CSP).
 */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (!tabId) {
    sendResponse({ error: "No tab id" });
    return;
  }

  if (msg.type === "grn-start") {
    startRunner(tabId, msg.config)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ error: err?.message || String(err) }));
    return true;
  }

  if (msg.type === "grn-stop") {
    stopRunner(tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ error: err?.message || String(err) }));
    return true;
  }
});

async function startRunner(tabId, config) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (cfg) => {
      window.__GRN_CONFIG__ = cfg;
    },
    args: [config],
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: ["page-runner.js"],
  });
}

async function stopRunner(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      window.dispatchEvent(new CustomEvent("grn-stop"));
    },
  });
}
