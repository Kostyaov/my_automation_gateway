let nodes = {};
let jobSocket = null;
let currentJobId = null;
let lastOutputPath = "";

window.addEventListener("DOMContentLoaded", init);

async function init() {
  nodes = getNodes();
  const missingNodes = Object.entries(nodes)
    .filter(([, node]) => !node)
    .map(([name]) => name);
  if (missingNodes.length) {
    console.error(`Web-DLP UI is missing nodes: ${missingNodes.join(", ")}`);
    return;
  }

  bindEvents();
  updateOperationView();
  appendConsole("Ready. Paste a URL, choose an operation, and start a yt-dlp job.");
  await loadConfig();
}

function getNodes() {
  return {
    form: document.querySelector("#web-dlp-form"),
    runtimeStatus: document.querySelector("#runtime-status"),
    sourceUrl: document.querySelector("#source-url"),
    operation: document.querySelector("#operation"),
    videoOptions: document.querySelector("#video-options"),
    audioOptions: document.querySelector("#audio-options"),
    subtitleOptions: document.querySelector("#subtitle-options"),
    quality: document.querySelector("#quality"),
    audioFormat: document.querySelector("#audio-format"),
    subtitleLanguages: document.querySelector("#subtitle-languages"),
    cookiesBrowser: document.querySelector("#cookies-browser"),
    outputPath: document.querySelector("#output-path"),
    chooseOutputFolder: document.querySelector("#choose-output-folder"),
    noPlaylist: document.querySelector("#no-playlist"),
    writeAutoSubs: document.querySelector("#write-auto-subs"),
    autoSubsRow: document.querySelector("#auto-subs-row"),
    writeThumbnail: document.querySelector("#write-thumbnail"),
    thumbnailRow: document.querySelector("#thumbnail-row"),
    updateYtdlp: document.querySelector("#update-ytdlp"),
    startJob: document.querySelector("#start-job"),
    cancelJob: document.querySelector("#cancel-job"),
    openOutputFolder: document.querySelector("#open-output-folder"),
    formStatus: document.querySelector("#form-status"),
    consoleOutput: document.querySelector("#console-output"),
    jobState: document.querySelector("#job-state"),
  };
}

function bindEvents() {
  nodes.operation.addEventListener("change", updateOperationView);
  nodes.form.addEventListener("submit", startJob);
  nodes.updateYtdlp.addEventListener("click", updateYtdlp);
  nodes.cancelJob.addEventListener("click", cancelCurrentJob);
  nodes.chooseOutputFolder.addEventListener("click", chooseOutputFolder);
  nodes.openOutputFolder.addEventListener("click", openOutputFolder);
}

async function loadConfig() {
  try {
    const response = await fetch("/api/web-dlp/config", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    const config = await response.json();
    lastOutputPath = config.output_dir || "";
    nodes.runtimeStatus.textContent = config.has_yt_dlp
      ? `yt-dlp is available. Output folder: ${config.output_dir}`
      : "yt-dlp is not installed in this environment. Use Update yt-dlp first.";
    nodes.runtimeStatus.className = config.has_yt_dlp ? "status" : "status error";
    setFormStatus("Ready.");
  } catch (error) {
    nodes.runtimeStatus.textContent = error.message;
    nodes.runtimeStatus.className = "status error";
    setFormStatus(error.message, true);
  }
}

function updateOperationView() {
  const operation = nodes.operation.value;
  nodes.videoOptions.classList.toggle("hidden", operation !== "download_video");
  nodes.audioOptions.classList.toggle("hidden", operation !== "extract_audio");
  nodes.subtitleOptions.classList.toggle("hidden", operation !== "download_subtitles");
  nodes.autoSubsRow.classList.toggle("hidden", operation !== "download_subtitles");
  nodes.thumbnailRow.classList.toggle("hidden", operation !== "metadata");

  if (operation === "extract_audio") {
    nodes.startJob.textContent = "Start audio extraction";
    return;
  }
  if (operation === "download_subtitles") {
    nodes.startJob.textContent = "Start subtitles";
    return;
  }
  if (operation === "metadata") {
    nodes.startJob.textContent = "Start metadata job";
    return;
  }
  nodes.startJob.textContent = "Start download";
}

async function startJob(event) {
  event.preventDefault();

  const payload = buildPayload();
  if (!payload) {
    return;
  }

  prepareJobUi("Preparing...");
  appendConsole(`Queued URL: ${payload.url}`);
  appendConsole(`Operation: ${payload.operation}`);
  if (payload.output_path) {
    appendConsole(`Output folder: ${payload.output_path}`);
  }

  try {
    const response = await fetch("/api/web-dlp/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    const data = await response.json();
    startJobConsole(data.job, "Running...");
  } catch (error) {
    failJobUi(error.message);
  }
}

async function updateYtdlp() {
  prepareJobUi("Updating...");
  appendConsole("Queued yt-dlp update.");

  try {
    const response = await fetch("/api/web-dlp/update", { method: "POST" });
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    const data = await response.json();
    startJobConsole(data.job, "Updating...");
  } catch (error) {
    failJobUi(error.message);
  }
}

function buildPayload() {
  const url = nodes.sourceUrl.value.trim();
  if (!url) {
    invalid("Paste a URL first.");
    return null;
  }

  const operation = nodes.operation.value;
  const payload = {
    url,
    operation,
    options: {
      no_playlist: nodes.noPlaylist.checked,
      cookies_browser: nodes.cookiesBrowser.value,
    },
  };

  const outputPath = nodes.outputPath.value.trim();
  if (outputPath) {
    payload.output_path = outputPath;
  }

  if (operation === "download_video") {
    payload.options.quality = nodes.quality.value;
  }
  if (operation === "extract_audio") {
    payload.options.audio_format = nodes.audioFormat.value;
  }
  if (operation === "download_subtitles") {
    payload.options.subtitle_languages = nodes.subtitleLanguages.value.trim() || "uk,en,ru";
    payload.options.write_auto_subs = nodes.writeAutoSubs.checked;
  }
  if (operation === "metadata") {
    payload.options.write_thumbnail = nodes.writeThumbnail.checked;
  }

  return payload;
}

async function chooseOutputFolder() {
  nodes.chooseOutputFolder.disabled = true;
  setFormStatus("Choosing output folder...");

  try {
    const response = await fetch("/api/web-dlp/select-output-folder", { method: "POST" });
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    const payload = await response.json();
    nodes.outputPath.value = payload.path;
    lastOutputPath = payload.path;
    appendConsole(`[OUTPUT] Folder selected: ${payload.path}`);
    setFormStatus("Output folder selected.");
  } catch (error) {
    const isCancelled = error.message.toLowerCase().includes("cancelled");
    appendConsole(isCancelled ? "[OUTPUT] Folder selection cancelled." : `[ERROR] ${error.message}`);
    setFormStatus(isCancelled ? "Folder selection cancelled." : error.message, !isCancelled);
  } finally {
    nodes.chooseOutputFolder.disabled = false;
  }
}

async function openOutputFolder() {
  nodes.openOutputFolder.disabled = true;
  setFormStatus("Opening output folder...");

  const path = nodes.outputPath.value.trim() || lastOutputPath;
  try {
    const response = await fetch("/api/web-dlp/open-output-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    const payload = await response.json();
    lastOutputPath = payload.path;
    appendConsole(`[OPEN] Output folder: ${payload.path}`);
    setFormStatus("Output folder opened.");
  } catch (error) {
    appendConsole(`[ERROR] ${error.message}`);
    setFormStatus(error.message, true);
  } finally {
    nodes.openOutputFolder.disabled = false;
  }
}

async function cancelCurrentJob() {
  if (!currentJobId) {
    setFormStatus("No active Web-DLP job to cancel.", true);
    return;
  }

  nodes.cancelJob.disabled = true;
  nodes.cancelJob.textContent = "Cancelling...";
  appendConsole("[CANCEL] Cancellation requested.");
  setFormStatus("Stopping current Web-DLP job...");

  try {
    const response = await fetch(`/api/web-dlp/jobs/${encodeURIComponent(currentJobId)}/cancel`, {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    const payload = await response.json();
    if (payload.status === "cancelled") {
      finishCancelledJob("Web-DLP job cancelled.");
    } else if (payload.status === "finished" || payload.status === "failed") {
      setJobState(payload.status);
      setFormStatus(`Web-DLP job is already ${payload.status}.`, payload.status === "failed");
      resetButtons();
    } else {
      setJobState("cancelling");
    }
  } catch (error) {
    appendConsole(`[ERROR] ${error.message}`);
    setFormStatus(error.message, true);
    if (currentJobId) {
      nodes.cancelJob.disabled = false;
      nodes.cancelJob.textContent = "Cancel job";
    }
  }
}

function prepareJobUi(buttonText) {
  clearConsole();
  currentJobId = null;
  nodes.startJob.disabled = true;
  nodes.updateYtdlp.disabled = true;
  nodes.cancelJob.disabled = true;
  nodes.cancelJob.textContent = "Cancel job";
  setJobState("queued");
  setFormStatus(buttonText);
}

function startJobConsole(job, buttonText) {
  currentJobId = job.id;
  if (job.output_path) {
    lastOutputPath = job.output_path;
    appendConsole(`Output folder: ${job.output_path}`);
  }
  appendConsole(`Job ID: ${job.id}`);
  nodes.startJob.textContent = buttonText;
  nodes.cancelJob.disabled = false;
  connectJobSocket(job.id);
}

function connectJobSocket(jobId) {
  if (jobSocket) {
    jobSocket.close();
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  jobSocket = new WebSocket(`${protocol}//${window.location.host}/api/web-dlp/jobs/${jobId}/events`);

  jobSocket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "status") {
      setJobState(message.data.status);
      return;
    }
    if (message.type === "log") {
      appendConsole(message.data.message);
      return;
    }
    if (message.type === "finished") {
      setJobState("finished");
      if (message.data.output_path) {
        lastOutputPath = message.data.output_path;
      }
      appendConsole(`[DONE] ${message.data.message}`);
      setFormStatus(message.data.output_path ? `Finished: ${message.data.output_path}` : message.data.message);
      resetButtons();
      loadConfig();
      return;
    }
    if (message.type === "error") {
      setJobState("failed");
      appendConsole(`[ERROR] ${message.data.message}`);
      setFormStatus(message.data.message, true);
      resetButtons();
      return;
    }
    if (message.type === "cancelled") {
      finishCancelledJob(message.data.message);
    }
  };

  jobSocket.onerror = () => {
    appendConsole("[ERROR] Console connection failed.");
    setFormStatus("Console connection failed.", true);
    resetButtons();
  };
}

function finishCancelledJob(message) {
  setJobState("cancelled");
  appendConsole(`[CANCEL] ${message}`);
  setFormStatus(message);
  resetButtons();
}

function failJobUi(message) {
  appendConsole(`[ERROR] ${message}`);
  setFormStatus(message, true);
  setJobState("failed");
  resetButtons();
}

function invalid(message) {
  setFormStatus(message, true);
  appendConsole(`[WARN] ${message}`);
}

function resetButtons() {
  currentJobId = null;
  nodes.startJob.disabled = false;
  nodes.updateYtdlp.disabled = false;
  nodes.cancelJob.disabled = true;
  nodes.cancelJob.textContent = "Cancel job";
  updateOperationView();
}

function appendConsole(text) {
  nodes.consoleOutput.textContent += `${text}\n`;
  nodes.consoleOutput.scrollTop = nodes.consoleOutput.scrollHeight;
}

function clearConsole() {
  nodes.consoleOutput.textContent = "";
}

function setJobState(state) {
  nodes.jobState.textContent = state;
  nodes.jobState.className = `state-pill ${state}`;
}

function setFormStatus(message, isError = false) {
  nodes.formStatus.textContent = message;
  nodes.formStatus.className = isError ? "status error" : "status";
}

async function readError(response) {
  try {
    const payload = await response.json();
    return payload.detail || JSON.stringify(payload);
  } catch {
    return response.statusText || "Request failed";
  }
}
