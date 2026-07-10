const DEFAULT_API_BASE = "http://localhost:5050";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "WANDEROS_RUN_PAGE_CARD") return;

  chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
    try {
      if (!tab?.id) throw new Error("No active tab");

      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          url: location.href,
          title: document.title,
          selectedText: String(window.getSelection()?.toString() || ""),
          mainText: String((document.querySelector("article") || document.querySelector("main") || document.body)?.innerText || "").slice(0, 12000)
        })
      });

      const settings = await chrome.storage.sync.get(["apiBase"]);
      const apiBase = settings.apiBase || DEFAULT_API_BASE;

      const response = await fetch(`${apiBase}/api/extension/page-card`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result)
      });

      const data = await response.json();
      sendResponse({ ok: true, data });
    } catch (error) {
      sendResponse({ ok: false, error: error.message || "WanderOS extension failed" });
    }
  });

  return true;
});
