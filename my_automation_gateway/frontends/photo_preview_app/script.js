let nodes = {};
let jobSocket = null;
let currentJobId = null;

window.addEventListener("DOMContentLoaded", init);

async function init() {
  nodes = getNodes();
  const missingNodes = Object.entries(nodes)
    .filter(([, node]) => !node)
    .map(([name]) => name);

  if (missingNodes.length) {
    console.error(`Photo Preview UI is missing nodes: ${missingNodes.join(", ")}`);
    return;
  }

  bindEvents();
  resetStats();
  appendConsole("Ready. Choose a source folder and start a preview job.");
  await loadConfig();
}

function getNodes() {
  return {
    form: document.querySelector("#photo-form"),
    sourcePath: document.querySelector("#source-path"),
    chooseSourceFolder: document.querySelector("#choose-source-folder"),
    sourceHint: document.querySelector("#source-hint"),
    outputFormat: document.querySelector("#output-format"),
    nameFilter: document.querySelector("#name-filter"),
    maxSide: document.querySelector("#max-side"),
    quality: document.querySelector("#quality"),
    workers: document.querySelector("#workers"),
    skipUnchanged: document.querySelector("#skip-unchanged"),
    dryRun: document.querySelector("#dry-run"),
    startJob: document.querySelector("#start-job"),
    cancelJob: document.querySelector("#cancel-job"),
    openSourceFolder: document.querySelector("#open-source-folder"),
    formStatus: document.querySelector("#form-status"),
    consoleOutput: document.querySelector("#console-output"),
    jobState: document.querySelector("#job-state"),
    dependencyState: document.querySelector("#dependency-state"),
    statFound: document.querySelector("#stat-found"),
    statCreated: document.querySelector("#stat-created"),
    statSkipped: document.querySelector("#stat-skipped"),
    statFailed: document.querySelector("#stat-failed"),
    statOriginal: document.querySelector("#stat-original"),
    statPreview: document.querySelector("#stat-preview"),
  };
}

function bindEvents() {
  nodes.form.addEventListener("submit", startJob);
  nodes.chooseSourceFolder.addEventListener("click", chooseSourceFolder);
  nodes.cancelJob.addEventListener("click", cancelCurrentJob);
  nodes.openSourceFolder.addEventListener("click", openSourceFolder);
}

async function loadConfig() {
  try {
    const response = await fetch("/api/photo-preview/config", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    const payload = await response.json();
    if (payload.has_pillow) {
      setDependencyState("ready");
      setFormStatus(`PREVIEW folder: ${payload.preview_folder_name}`);
    } else {
      setDependencyState("missing");
      setFormStatus("Pillow is missing. Install requirements before running jobs.", true);
    }
  } catch (error) {
    setDependencyState("failed");
    setFormStatus(error.message, true);
    appendConsole(`[ERROR] ${error.message}`);
  }
}

async function chooseSourceFolder() {
  nodes.chooseSourceFolder.disabled = true;
  setFormStatus("Choosing source folder...");

  try {
    const response = await fetch("/api/photo-preview/select-source-folder", {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const payload = await response.json();
    nodes.sourcePath.value = payload.path;
    appendConsole(`[SOURCE] Folder selected: ${payload.path}`);
    setFormStatus("Source folder selected.");
  } catch (error) {
    const isCancelled = error.message.toLowerCase().includes("cancelled");
    appendConsole(isCancelled ? "[SOURCE] Folder selection cancelled." : `[ERROR] ${error.message}`);
    setFormStatus(isCancelled ? "Folder selection cancelled." : error.message, !isCancelled);
  } finally {
    nodes.chooseSourceFolder.disabled = false;
  }
}

async function openSourceFolder() {
  const path = nodes.sourcePath.value.trim();
  if (!path) {
    invalid("Choose a source folder first.");
    return;
  }

  nodes.openSourceFolder.disabled = true;
  setFormStatus("Opening source folder...");

  try {
    const response = await fetch("/api/photo-preview/open-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const payload = await response.json();
    appendConsole(`[OPEN] ${payload.path}`);
    setFormStatus("Source folder opened.");
  } catch (error) {
    appendConsole(`[ERROR] ${error.message}`);
    setFormStatus(error.message, true);
  } finally {
    nodes.openSourceFolder.disabled = false;
  }
}

async function startJob(event) {
  event.preventDefault();

  currentJobId = null;
  nodes.startJob.disabled = true;
  nodes.cancelJob.disabled = true;
  nodes.cancelJob.textContent = "Cancel job";
  nodes.startJob.textContent = "Preparing...";
  setJobState("queued");
  clearConsole();
  resetStats();

  try {
    const payload = buildPayload();
    if (!payload) {
      resetJobButtons();
      return;
    }

    appendConsole(`Source: ${payload.source_path}`);
    appendConsole(`Format: ${payload.output_format}, long side: ${payload.max_side}, quality: ${payload.quality}`);
    if (payload.dry_run) {
      appendConsole("Check-only mode enabled. No PREVIEW files will be created.");
    }
    setFormStatus("Starting Photo Preview job...");

    const response = await fetch("/api/photo-preview/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const data = await response.json();
    const job = data.job;
    currentJobId = job.id;
    updateStats(job.stats);
    appendConsole(`Job ID: ${job.id}`);
    nodes.startJob.textContent = "Running...";
    nodes.cancelJob.disabled = false;
    connectJobSocket(job.id);
  } catch (error) {
    appendConsole(`[ERROR] ${error.message}`);
    setFormStatus(error.message, true);
    setJobState("failed");
    resetJobButtons();
  }
}

function buildPayload() {
  const sourcePath = nodes.sourcePath.value.trim();
  if (!sourcePath) {
    return invalid("Choose a source folder.");
  }

  const maxSide = parseNumber(nodes.maxSide.value, 1920);
  if (maxSide < 320 || maxSide > 10000) {
    return invalid("Long side must be from 320 to 10000.");
  }

  const quality = parseNumber(nodes.quality.value, 90);
  if (quality < 1 || quality > 100) {
    return invalid("Quality must be from 1 to 100.");
  }

  const workers = parseNumber(nodes.workers.value, 4);
  if (workers < 1 || workers > 16) {
    return invalid("Workers must be from 1 to 16.");
  }

  return {
    source_path: sourcePath,
    output_format: nodes.outputFormat.value,
    max_side: maxSide,
    quality,
    name_filter: nodes.nameFilter.value,
    skip_unchanged: nodes.skipUnchanged.checked,
    dry_run: nodes.dryRun.checked,
    workers,
  };
}

async function cancelCurrentJob() {
  if (!currentJobId) {
    setFormStatus("No active Photo Preview job to cancel.", true);
    return;
  }

  nodes.cancelJob.disabled = true;
  nodes.cancelJob.textContent = "Cancelling...";
  appendConsole("[CANCEL] Cancellation requested.");
  setFormStatus("Stopping current Photo Preview job...");

  try {
    const response = await fetch(`/api/photo-preview/jobs/${encodeURIComponent(currentJobId)}/cancel`, {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const payload = await response.json();
    if (payload.status === "cancelled") {
      finishCancelledJob("Photo Preview job cancelled.");
    } else if (payload.status === "finished" || payload.status === "failed") {
      setJobState(payload.status);
      setFormStatus(`Photo Preview job is already ${payload.status}.`, payload.status === "failed");
      resetJobButtons();
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

function connectJobSocket(jobId) {
  if (jobSocket) {
    jobSocket.close();
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  jobSocket = new WebSocket(`${protocol}//${window.location.host}/api/photo-preview/jobs/${jobId}/events`);

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
    if (message.type === "progress") {
      updateStats(message.data.stats);
      return;
    }
    if (message.type === "finished") {
      setJobState("finished");
      updateStats(message.data.stats);
      appendConsole(`[DONE] ${message.data.message}`);
      setFormStatus(message.data.message);
      resetJobButtons();
      return;
    }
    if (message.type === "error") {
      setJobState("failed");
      appendConsole(`[ERROR] ${message.data.message}`);
      setFormStatus(message.data.message, true);
      resetJobButtons();
      return;
    }
    if (message.type === "cancelled") {
      updateStats(message.data.stats);
      finishCancelledJob(message.data.message);
    }
  };

  jobSocket.onerror = () => {
    appendConsole("[ERROR] Console connection failed.");
    setFormStatus("Console connection failed.", true);
    resetJobButtons();
  };
}

function finishCancelledJob(message) {
  setJobState("cancelled");
  appendConsole(`[CANCEL] ${message}`);
  setFormStatus(message);
  resetJobButtons();
}

function invalid(message) {
  setFormStatus(message, true);
  appendConsole(`[WARN] ${message}`);
  return null;
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

function setDependencyState(state) {
  nodes.dependencyState.textContent = state;
  nodes.dependencyState.className = `state-pill ${state}`;
}

function setFormStatus(message, isError = false) {
  nodes.formStatus.textContent = message;
  nodes.formStatus.className = isError ? "status error" : "status";
}

function resetJobButtons() {
  currentJobId = null;
  nodes.startJob.disabled = false;
  nodes.startJob.textContent = "Start job";
  nodes.cancelJob.disabled = true;
  nodes.cancelJob.textContent = "Cancel job";
}

function resetStats() {
  updateStats({
    source_count: 0,
    created_count: 0,
    planned_count: 0,
    skipped_count: 0,
    failed_count: 0,
    original_bytes: 0,
    preview_bytes: 0,
  });
}

function updateStats(stats = {}) {
  const created = Number(stats.created_count || 0);
  const planned = Number(stats.planned_count || 0);
  nodes.statFound.textContent = String(stats.source_count || 0);
  nodes.statCreated.textContent = planned ? `${created} / ${planned} to create` : String(created);
  nodes.statSkipped.textContent = String(stats.skipped_count || 0);
  nodes.statFailed.textContent = String(stats.failed_count || 0);
  nodes.statOriginal.textContent = formatBytes(stats.original_bytes || 0);
  nodes.statPreview.textContent = formatBytes(stats.preview_bytes || 0);
}

function parseNumber(value, fallback) {
  const number = Number.parseInt(String(value).trim(), 10);
  return Number.isFinite(number) ? number : fallback;
}

async function readError(response) {
  try {
    const payload = await response.json();
    return payload.detail || JSON.stringify(payload);
  } catch {
    return response.statusText || "Request failed";
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
