let nodes = {};
let jobSocket = null;
let hasApiKey = false;

window.addEventListener("DOMContentLoaded", init);

async function init() {
  nodes = getNodes();
  const missingNodes = Object.entries(nodes)
    .filter(([, node]) => !node)
    .map(([name]) => name);
  if (missingNodes.length) {
    console.error(`ElevenLabs UI is missing nodes: ${missingNodes.join(", ")}`);
    return;
  }

  bindEvents();
  appendConsole("Ready. Configure ELEVENLABS_API_KEY, choose a file, and start transcription.");
  await loadConfig();
  await loadSubscription();
  setFormStatus("Choose a media file to upload.");
}

function getNodes() {
  return {
    form: document.querySelector("#elevenlabs-form"),
    apiStatus: document.querySelector("#api-status"),
    creditsStatus: document.querySelector("#credits-status"),
    creditsSummary: document.querySelector("#credits-summary"),
    creditsTier: document.querySelector("#credits-tier"),
    creditsFill: document.querySelector("#credits-fill"),
    creditsDetail: document.querySelector("#credits-detail"),
    mediaUpload: document.querySelector("#media-upload"),
    uploadStatus: document.querySelector("#upload-status"),
    modelId: document.querySelector("#model-id"),
    languageCode: document.querySelector("#language-code"),
    numSpeakers: document.querySelector("#num-speakers"),
    timestampsGranularity: document.querySelector("#timestamps-granularity"),
    tagAudioEvents: document.querySelector("#tag-audio-events"),
    diarize: document.querySelector("#diarize"),
    noVerbatim: document.querySelector("#no-verbatim"),
    zeroRetention: document.querySelector("#zero-retention"),
    createProject: document.querySelector("#create-project"),
    startJob: document.querySelector("#start-job"),
    formStatus: document.querySelector("#form-status"),
    consoleOutput: document.querySelector("#console-output"),
    jobState: document.querySelector("#job-state"),
    resultPanel: document.querySelector("#result-panel"),
    resultTitle: document.querySelector("#result-title"),
    exportJson: document.querySelector("#export-json"),
    exportSrt: document.querySelector("#export-srt"),
    exportVtt: document.querySelector("#export-vtt"),
    exportTxt: document.querySelector("#export-txt"),
    openProject: document.querySelector("#open-project"),
  };
}

function bindEvents() {
  nodes.form.addEventListener("submit", startJob);
  nodes.mediaUpload.addEventListener("change", onUploadChoice);
  nodes.zeroRetention.addEventListener("change", () => {
    if (nodes.zeroRetention.checked) {
      setFormStatus("Zero retention mode requires an ElevenLabs Enterprise or Trial account.", true);
      return;
    }
    setFormStatus("");
  });
}

async function loadConfig() {
  try {
    const response = await fetch("/api/elevenlabs/config", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    const config = await response.json();
    hasApiKey = Boolean(config.has_api_key);
    nodes.apiStatus.textContent = hasApiKey
      ? "ELEVENLABS_API_KEY is configured."
      : "ELEVENLABS_API_KEY is not configured.";
    nodes.apiStatus.className = hasApiKey ? "status" : "status error";
    nodes.startJob.disabled = !hasApiKey;
  } catch (error) {
    hasApiKey = false;
    nodes.apiStatus.textContent = error.message;
    nodes.apiStatus.className = "status error";
    nodes.startJob.disabled = true;
  }
}

async function loadSubscription() {
  if (!hasApiKey) {
    renderSubscriptionPlaceholder("Configure ELEVENLABS_API_KEY to see credits.");
    return;
  }

  renderSubscriptionPlaceholder("Checking balance...");
  try {
    const response = await fetch("/api/elevenlabs/subscription", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    renderSubscription(await response.json());
  } catch (error) {
    renderSubscriptionPlaceholder(error.message, true);
  }
}

function renderSubscription(subscription) {
  const used = Number(subscription.character_count);
  const limit = Number(subscription.character_limit);
  const remaining = Number(subscription.remaining);
  const percent = Number(subscription.used_percent);
  const hasLimit = Number.isFinite(used) && Number.isFinite(limit) && limit > 0;
  const hasRemaining = Number.isFinite(remaining);

  nodes.creditsStatus.classList.remove("is-low", "is-warn");
  nodes.creditsTier.textContent = subscription.tier || "unknown";
  nodes.creditsTier.className = "state-pill";

  if (hasLimit) {
    const safePercent = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
    const remainingRatio = hasRemaining ? remaining / limit : 1;
    nodes.creditsSummary.textContent = hasRemaining
      ? `${formatNumber(remaining)} credits left`
      : `${formatNumber(used)} of ${formatNumber(limit)} used`;
    nodes.creditsDetail.textContent = `${formatNumber(used)} used of ${formatNumber(limit)} · ${subscription.status || "status unknown"}`;
    nodes.creditsFill.style.width = `${safePercent}%`;

    if (remainingRatio <= 0.1) {
      nodes.creditsStatus.classList.add("is-low");
    } else if (remainingRatio <= 0.25) {
      nodes.creditsStatus.classList.add("is-warn");
    }
    return;
  }

  nodes.creditsSummary.textContent = "Credits data unavailable";
  nodes.creditsDetail.textContent = subscription.status || "ElevenLabs did not return a numeric limit.";
  nodes.creditsFill.style.width = "0%";
}

function renderSubscriptionPlaceholder(message, isError = false) {
  nodes.creditsStatus.classList.remove("is-low", "is-warn");
  nodes.creditsSummary.textContent = message;
  nodes.creditsTier.textContent = isError ? "error" : "unknown";
  nodes.creditsTier.className = isError ? "state-pill failed" : "state-pill";
  nodes.creditsDetail.textContent = isError ? "Could not load ElevenLabs subscription data." : "";
  nodes.creditsFill.style.width = "0%";
}

function onUploadChoice() {
  const file = nodes.mediaUpload.files?.[0];
  if (!file) {
    setUploadStatus("Choose a local audio/video file. It will upload when the job starts.");
    return;
  }
  setUploadStatus(`${file.name} is ready. It will upload when the job starts.`);
  setFormStatus(`Ready to upload ${file.name}.`);
}

async function startJob(event) {
  event.preventDefault();

  if (!hasApiKey) {
    setFormStatus("ELEVENLABS_API_KEY is not configured.", true);
    return;
  }

  clearConsole();
  hideResults();
  nodes.startJob.disabled = true;
  nodes.startJob.textContent = "Preparing...";
  setJobState("queued");

  try {
    const filePath = await getFileChoice();
    if (!filePath) {
      resetStartButton();
      return;
    }

    const payload = buildPayload(filePath);
    appendConsole(`Queued file: ${filePath}`);
    if (nodes.zeroRetention.checked) {
      appendConsole("[WARN] Zero retention mode requires an ElevenLabs Enterprise or Trial account.");
    }
    nodes.startJob.textContent = "Starting...";
    setFormStatus("Starting ElevenLabs transcription...");

    const response = await fetch("/api/elevenlabs/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const data = await response.json();
    appendConsole(`Job ID: ${data.job.id}`);
    nodes.startJob.textContent = "Running...";
    connectJobSocket(data.job.id);
  } catch (error) {
    appendConsole(`[ERROR] ${error.message}`);
    setFormStatus(error.message, true);
    setJobState("failed");
    resetStartButton();
  }
}

function buildPayload(filePath) {
  const languageCode = nodes.languageCode.value.trim();
  const numSpeakersValue = nodes.numSpeakers.value.trim();
  return {
    file_path: filePath,
    model_id: nodes.modelId.value,
    language_code: languageCode || null,
    tag_audio_events: nodes.tagAudioEvents.checked,
    diarize: nodes.diarize.checked,
    no_verbatim: nodes.noVerbatim.checked,
    num_speakers: numSpeakersValue ? Number(numSpeakersValue) : null,
    timestamps_granularity: nodes.timestampsGranularity.value,
    enable_logging: !nodes.zeroRetention.checked,
    create_project: nodes.createProject.checked,
  };
}

async function getFileChoice() {
  const uploadFile = nodes.mediaUpload.files?.[0];
  if (uploadFile) {
    return uploadLocalFile(uploadFile);
  }
  setFormStatus("Choose a media file.", true);
  appendConsole("[WARN] Choose a media file.");
  return null;
}

async function uploadLocalFile(file) {
  setUploadStatus(`Uploading ${file.name}...`);
  setFormStatus(`Uploading ${file.name}...`);
  appendConsole(`[UPLOAD] ${file.name} (${formatBytes(file.size)})`);

  const response = await fetch("/api/elevenlabs/uploads", {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Filename": encodeURIComponent(file.name),
    },
    body: file,
  });

  if (!response.ok) {
    const message = await readError(response);
    setUploadStatus(message, true);
    throw new Error(message);
  }

  const payload = await response.json();
  const uploadedFile = payload.file;
  nodes.mediaUpload.value = "";
  setUploadStatus(`Uploaded: ${uploadedFile.name}`);
  appendConsole(`[UPLOAD] Saved as ${uploadedFile.path}`);
  return uploadedFile.path;
}

function connectJobSocket(jobId) {
  if (jobSocket) {
    jobSocket.close();
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  jobSocket = new WebSocket(`${protocol}//${window.location.host}/api/elevenlabs/jobs/${jobId}/events`);

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
      appendConsole(`[DONE] ${message.data.message}`);
      setFormStatus(message.data.message);
      showResults(jobId, message.data);
      resetStartButton();
      loadSubscription();
      return;
    }
    if (message.type === "error") {
      setJobState("failed");
      appendConsole(`[ERROR] ${message.data.message}`);
      setFormStatus(message.data.message, true);
      resetStartButton();
    }
  };

  jobSocket.onerror = () => {
    appendConsole("[ERROR] Console connection failed.");
    setFormStatus("Console connection failed.", true);
    resetStartButton();
  };
}

function showResults(jobId, data) {
  nodes.resultPanel.classList.remove("hidden");
  nodes.resultTitle.textContent = `Finished · ${data.segment_count || 0} segments`;
  nodes.exportJson.href = `/api/elevenlabs/jobs/${jobId}/export/json`;
  nodes.exportSrt.href = `/api/elevenlabs/jobs/${jobId}/export/srt`;
  nodes.exportVtt.href = `/api/elevenlabs/jobs/${jobId}/export/vtt`;
  nodes.exportTxt.href = `/api/elevenlabs/jobs/${jobId}/export/txt`;

  if (data.project_id) {
    nodes.openProject.href = `/transcript_editor/?project=${encodeURIComponent(data.project_id)}`;
    nodes.openProject.classList.remove("hidden");
  } else {
    nodes.openProject.classList.add("hidden");
  }
}

function hideResults() {
  nodes.resultPanel.classList.add("hidden");
  nodes.openProject.classList.add("hidden");
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

function setUploadStatus(message, isError = false) {
  nodes.uploadStatus.textContent = message;
  nodes.uploadStatus.className = isError ? "field-hint error" : "field-hint";
}

function resetStartButton() {
  nodes.startJob.disabled = !hasApiKey;
  nodes.startJob.textContent = "Start transcription";
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
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("uk-UA").format(value);
}
