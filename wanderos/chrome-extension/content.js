function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function collectPageContext() {
  const main = document.querySelector("article") || document.querySelector("main") || document.body;
  const image =
    document.querySelector("meta[property='og:image']")?.getAttribute("content") ||
    document.querySelector("img")?.src ||
    "";

  return {
    url: location.href,
    title: cleanText(document.title),
    description: cleanText(document.querySelector("meta[name='description']")?.getAttribute("content") || ""),
    selectedText: cleanText(window.getSelection()?.toString() || ""),
    mainText: cleanText(main?.innerText || "").slice(0, 12000),
    image,
    capturedAt: new Date().toISOString()
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "WANDEROS_COLLECT_PAGE") {
    sendResponse({ ok: true, page: collectPageContext() });
  }
});
