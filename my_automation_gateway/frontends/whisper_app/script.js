const form = document.querySelector("#whisper-form");
const input = document.querySelector("#file-path");
const button = document.querySelector("#submit-button");
const statusNode = document.querySelector("#status");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  button.disabled = true;
  button.textContent = "Відправляється...";
  statusNode.className = "status";
  statusNode.textContent = "";

  try {
    const response = await fetch("/api/whisper", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file_path: input.value.trim(),
      }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.detail || "Не вдалося запустити задачу");
    }

    if (payload.status === "accepted") {
      button.textContent = "Обробляється у фоні";
      statusNode.className = "status success";
      statusNode.textContent = "Задачу прийнято. Результат дивіться у логах сервера.";
      return;
    }

    throw new Error("Сервер повернув неочікувану відповідь");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Запустити";
    statusNode.className = "status error";
    statusNode.textContent = error.message;
  }
});
