const result = document.getElementById("result");

document.getElementById("run").addEventListener("click", async () => {
  result.textContent = "Running WanderOS page agents...";

  chrome.runtime.sendMessage({ type: "WANDEROS_RUN_PAGE_CARD" }, (response) => {
    if (!response?.ok) {
      result.textContent = response?.error || "Failed.";
      return;
    }

    result.textContent = JSON.stringify(response.data.card, null, 2);
  });
});
