let nodes = {};
let mediaFiles = [];
let jobSocket = null;
let currentJobId = null;
let lastOutputPath = "";

const operationConfig = {
  replace_audio: {
    video: true,
    audio: true,
    shortest: true,
    description: "Replace the audio stream in a video file.",
  },
  extract_audio: {
    input: "all",
    extract: true,
    description: "Extract audio from a media file.",
  },
  cut_media: {
    input: "all",
    cut: true,
    copy: true,
    description: "Cut a media file between two timestamps.",
  },
  encode_hevc: {
    input: "video",
    encode: true,
    description: "Encode MP4/MOV/MKV to HEVC.",
  },
};

const inputLabels = {
  video: "video file",
  audio: "audio file",
  input: "input file",
};

window.addEventListener("DOMContentLoaded", init);

async function init() {
  nodes = getNodes();
  const missingNodes = Object.entries(nodes)
    .filter(([, node]) => !node)
    .map(([name]) => name);

  if (missingNodes.length) {
    console.error(`FFmpeg UI is missing nodes: ${missingNodes.join(", ")}`);
    return;
  }

  bindEvents();
  updateOperationView();
  appendConsole("Ready. Pick an operation, choose files, and start a job.");
  await loadFiles();
}

function getNodes() {
  return {
    form: document.querySelector("#ffmpeg-form"),
    operation: document.querySelector("#operation"),
    videoField: document.querySelector("#video-field"),
    audioField: document.querySelector("#audio-field"),
    inputField: document.querySelector("#input-field"),
    videoFile: document.querySelector("#video-file"),
    audioFile: document.querySelector("#audio-file"),
    inputFile: document.querySelector("#input-file"),
    videoUpload: document.querySelector("#video-upload"),
    audioUpload: document.querySelector("#audio-upload"),
    inputUpload: document.querySelector("#input-upload"),
    videoUploadStatus: document.querySelector("#video-upload-status"),
    audioUploadStatus: document.querySelector("#audio-upload-status"),
    inputUploadStatus: document.querySelector("#input-upload-status"),
    encodeModeField: document.querySelector("#encode-mode-field"),
    encodeMode: document.querySelector("#encode-mode"),
    encodeFolderField: document.querySelector("#encode-folder-field"),
    inputFolder: document.querySelector("#input-folder"),
    chooseInputFolder: document.querySelector("#choose-input-folder"),
    outputPath: document.querySelector("#output-path"),
    chooseOutputFolder: document.querySelector("#choose-output-folder"),
    startTime: document.querySelector("#start-time"),
    stopTime: document.querySelector("#stop-time"),
    audioFormat: document.querySelector("#audio-format"),
    encodeQuality: document.querySelector("#encode-quality"),
    shortest: document.querySelector("#shortest"),
    shortestRow: document.querySelector("#shortest-row"),
    copyCodecs: document.querySelector("#copy-codecs"),
    copyRow: document.querySelector("#copy-row"),
    cutOptions: document.querySelector("#cut-options"),
    extractOptions: document.querySelector("#extract-options"),
    encodeOptions: document.querySelector("#encode-options"),
    refreshFiles: document.querySelector("#refresh-files"),
    startJob: document.querySelector("#start-job"),
    cancelJob: document.querySelector("#cancel-job"),
    openOutputsFolder: document.querySelector("#open-outputs-folder"),
    formStatus: document.querySelector("#form-status"),
    consoleOutput: document.querySelector("#console-output"),
    jobState: document.querySelector("#job-state"),
  };
}

function bindEvents() {
  nodes.operation.addEventListener("change", updateOperationView);
  nodes.encodeMode.addEventListener("change", updateOperationView);
  nodes.refreshFiles.addEventListener("click", loadFiles);
  nodes.form.addEventListener("submit", startJob);
  nodes.cancelJob.addEventListener("click", cancelCurrentJob);
  nodes.chooseInputFolder.addEventListener("click", chooseInputFolder);
  nodes.chooseOutputFolder.addEventListener("click", chooseOutputFolder);
  nodes.openOutputsFolder.addEventListener("click", openOutputsFolder);

  bindFileChoice("video");
  bindFileChoice("audio");
  bindFileChoice("input");
}

function bindFileChoice(role) {
  const uploadInput = uploadInputForRole(role);
  const select = fileSelectForRole(role);

  uploadInput.addEventListener("change", () => {
    const file = uploadInput.files?.[0];
    if (!file) {
      setUploadStatus(role, defaultUploadHint(role));
      return;
    }
    select.value = "";
    setUploadStatus(role, `${file.name} is ready. It will upload when the job starts.`);
    setFormStatus(`Ready to upload ${file.name}.`);
  });

  select.addEventListener("change", () => {
    if (!select.value) return;
    uploadInput.value = "";
    setUploadStatus(role, defaultUploadHint(role));
  });
}

async function loadFiles(options = {}) {
  const silent = Boolean(options.silent);
  if (!silent) {
    setFormStatus("Refreshing files...");
  }
  try {
    const response = await fetch("/api/ffmpeg/files", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    const payload = await response.json();
    mediaFiles = payload.files || [];
    populateFileSelects();
    updateOperationView();
    if (!silent) {
      setFormStatus(`Loaded ${mediaFiles.length} media files. Output folder: ${payload.output_dir}`);
    }
  } catch (error) {
    setFormStatus(error.message, true);
    appendConsole(`[ERROR] ${error.message}`);
  }
}

function populateFileSelects(preserved = {}) {
  const selected = {
    video: preserved.video ?? nodes.videoFile.value,
    audio: preserved.audio ?? nodes.audioFile.value,
    input: preserved.input ?? nodes.inputFile.value,
  };

  fillSelect(nodes.videoFile, filesByKind("video"), "Select video...", "No video files found");
  fillSelect(nodes.audioFile, filesByKind("audio"), "Select audio...", "No audio files found");
  fillInputSelect(operationConfig[nodes.operation.value]);

  restoreSelection(nodes.videoFile, selected.video);
  restoreSelection(nodes.audioFile, selected.audio);
  restoreSelection(nodes.inputFile, selected.input);
}

function fillInputSelect(config) {
  if (config.input === "video") {
    fillSelect(nodes.inputFile, filesByKind("video"), "Select video...", "No video files found");
    return;
  }
  fillSelect(nodes.inputFile, mediaFiles, "Select input...", "No media files found");
}

function fillSelect(select, files, placeholder, emptyText) {
  select.textContent = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = files.length ? placeholder : emptyText;
  select.append(empty);

  for (const file of files) {
    const option = document.createElement("option");
    option.value = file.path;
    option.textContent = `${file.name} · ${formatBytes(file.size)}`;
    select.append(option);
  }
}

function restoreSelection(select, value) {
  if (!value) return;
  const hasValue = Array.from(select.options).some((option) => option.value === value);
  if (hasValue) {
    select.value = value;
  }
}

function filesByKind(kind) {
  return mediaFiles.filter((file) => file.kind === kind);
}

function updateOperationView() {
  const config = operationConfig[nodes.operation.value] || operationConfig.replace_audio;
  const isFolderEncode = Boolean(config.encode && nodes.encodeMode.value === "folder");
  nodes.videoField.classList.toggle("hidden", !config.video);
  nodes.audioField.classList.toggle("hidden", !config.audio);
  nodes.inputField.classList.toggle("hidden", !config.input || isFolderEncode);
  nodes.encodeModeField.classList.toggle("hidden", !config.encode);
  nodes.encodeFolderField.classList.toggle("hidden", !isFolderEncode);
  nodes.cutOptions.classList.toggle("hidden", !config.cut);
  nodes.extractOptions.classList.toggle("hidden", !config.extract);
  nodes.encodeOptions.classList.toggle("hidden", !config.encode);
  nodes.shortestRow.classList.toggle("hidden", !config.shortest);
  nodes.copyRow.classList.toggle("hidden", !config.copy);
  fillInputSelect(config);
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

  try {
    const payload = await buildPayload();
    if (!payload) {
      resetJobButtons();
      return;
    }

    appendConsole(`Queued operation: ${payload.operation}`);
    if (payload.output_path) {
      appendConsole(`Requested output: ${payload.output_path}`);
    }
    nodes.startJob.textContent = "Starting...";
    setFormStatus("Starting FFmpeg job...");

    const response = await fetch("/api/ffmpeg/jobs", {
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
    appendConsole(`Job ID: ${job.id}`);
    appendConsole(`Output: ${job.output_path}`);
    lastOutputPath = job.output_path;
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

async function cancelCurrentJob() {
  if (!currentJobId) {
    setFormStatus("No active FFmpeg job to cancel.", true);
    return;
  }

  nodes.cancelJob.disabled = true;
  nodes.cancelJob.textContent = "Cancelling...";
  appendConsole("[CANCEL] Cancellation requested.");
  setFormStatus("Stopping current FFmpeg job...");

  try {
    const response = await fetch(`/api/ffmpeg/jobs/${encodeURIComponent(currentJobId)}/cancel`, {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    const payload = await response.json();
    if (payload.status === "cancelled") {
      finishCancelledJob("FFmpeg job cancelled.");
    } else if (payload.status === "finished" || payload.status === "failed") {
      setJobState(payload.status);
      setFormStatus(`FFmpeg job is already ${payload.status}.`, payload.status === "failed");
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

async function chooseOutputFolder() {
  nodes.chooseOutputFolder.disabled = true;
  setFormStatus("Choosing output folder...");

  try {
    const response = await fetch("/api/ffmpeg/select-output-folder", {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const payload = await response.json();
    nodes.outputPath.value = payload.path;
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

async function chooseInputFolder() {
  nodes.chooseInputFolder.disabled = true;
  setFormStatus("Choosing input folder...");

  try {
    const response = await fetch("/api/ffmpeg/select-input-folder", {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const payload = await response.json();
    nodes.inputFolder.value = payload.path;
    appendConsole(`[INPUT] Folder selected: ${payload.path}`);
    setFormStatus("Input folder selected.");
  } catch (error) {
    const isCancelled = error.message.toLowerCase().includes("cancelled");
    appendConsole(isCancelled ? "[INPUT] Folder selection cancelled." : `[ERROR] ${error.message}`);
    setFormStatus(isCancelled ? "Folder selection cancelled." : error.message, !isCancelled);
  } finally {
    nodes.chooseInputFolder.disabled = false;
  }
}

async function openOutputsFolder() {
  nodes.openOutputsFolder.disabled = true;
  setFormStatus("Opening output folder...");

  const path = lastOutputPath || nodes.outputPath.value.trim();

  try {
    const response = await fetch("/api/ffmpeg/open-output-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const payload = await response.json();
    appendConsole(`[OPEN] Output folder: ${payload.path}`);
    setFormStatus("Output folder opened.");
  } catch (error) {
    appendConsole(`[ERROR] ${error.message}`);
    setFormStatus(error.message, true);
  } finally {
    nodes.openOutputsFolder.disabled = false;
  }
}

async function buildPayload() {
  const operation = nodes.operation.value;
  const config = operationConfig[operation];
  const isFolderEncode = Boolean(config.encode && nodes.encodeMode.value === "folder");
  const payload = {
    operation,
    inputs: {},
    options: {},
  };

  if (config.video) {
    const video = await getFileChoice("video");
    if (!video) return null;
    payload.inputs.video = video;
  }
  if (config.audio) {
    const audio = await getFileChoice("audio");
    if (!audio) return null;
    payload.inputs.audio = audio;
  }
  if (config.input && !isFolderEncode) {
    const input = await getFileChoice("input");
    if (!input) return null;
    payload.inputs.input = input;
  }
  if (isFolderEncode) {
    const folder = nodes.inputFolder.value.trim();
    if (!folder) return invalid("Choose an input folder.");
    payload.inputs.folder = folder;
    payload.options.batch = true;
  }

  const outputPath = nodes.outputPath.value.trim();
  if (outputPath) {
    payload.output_path = outputPath;
  }
  if (config.shortest) {
    payload.options.shortest = nodes.shortest.checked;
  }
  if (config.copy) {
    payload.options.copy = nodes.copyCodecs.checked;
    payload.options.start_time = nodes.startTime.value.trim() || "00:00:00";
    payload.options.stop_time = nodes.stopTime.value.trim();
  }
  if (config.extract) {
    payload.options.format = nodes.audioFormat.value;
  }
  if (config.encode) {
    const quality = nodes.encodeQuality.value.trim() || "65";
    if (!isValidQuality(quality)) {
      return invalid("HEVC quality must be a number from 1 to 100.");
    }
    payload.options.quality = quality;
  }

  return payload;
}

async function getFileChoice(role) {
  const uploadInput = uploadInputForRole(role);
  const uploadFile = uploadInput.files?.[0];
  if (uploadFile) {
    return uploadLocalFile(role, uploadFile);
  }

  const select = fileSelectForRole(role);
  if (select.value) {
    return select.value;
  }

  return invalid(`Choose a ${inputLabels[role]}.`);
}

async function uploadLocalFile(role, file) {
  setUploadStatus(role, `Uploading ${file.name}...`);
  setFormStatus(`Uploading ${file.name}...`);
  appendConsole(`[UPLOAD] ${file.name} (${formatBytes(file.size)})`);

  const response = await fetch("/api/ffmpeg/uploads", {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Filename": encodeURIComponent(file.name),
    },
    body: file,
  });

  if (!response.ok) {
    const message = await readError(response);
    setUploadStatus(role, message, true);
    throw new Error(message);
  }

  const payload = await response.json();
  const uploadedFile = payload.file;
  mediaFiles = [
    uploadedFile,
    ...mediaFiles.filter((item) => item.path !== uploadedFile.path),
  ];

  uploadInputForRole(role).value = "";
  populateFileSelects({ [role]: uploadedFile.path });
  setUploadStatus(role, `Uploaded: ${uploadedFile.name}`);
  appendConsole(`[UPLOAD] Saved as ${uploadedFile.path}`);
  return uploadedFile.path;
}

function invalid(message) {
  setFormStatus(message, true);
  appendConsole(`[WARN] ${message}`);
  return null;
}

function connectJobSocket(jobId) {
  if (jobSocket) {
    jobSocket.close();
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  jobSocket = new WebSocket(`${protocol}//${window.location.host}/api/ffmpeg/jobs/${jobId}/events`);

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
      setFormStatus(`Finished: ${message.data.output_path || message.data.message}`);
      resetJobButtons();
      loadFiles({ silent: true });
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

function setUploadStatus(role, message, isError = false) {
  const status = uploadStatusForRole(role);
  status.textContent = message;
  status.className = isError ? "field-hint error" : "field-hint";
}

function resetJobButtons() {
  currentJobId = null;
  nodes.startJob.disabled = false;
  nodes.startJob.textContent = "Start job";
  nodes.cancelJob.disabled = true;
  nodes.cancelJob.textContent = "Cancel job";
}

function fileSelectForRole(role) {
  return nodes[`${role}File`];
}

function uploadInputForRole(role) {
  return nodes[`${role}Upload`];
}

function uploadStatusForRole(role) {
  return nodes[`${role}UploadStatus`];
}

function defaultUploadHint(role) {
  if (role === "video") return "Use the list or upload a local video.";
  if (role === "audio") return "Use the list or upload a local audio file.";
  return "Use the list or upload a local media file.";
}

function isValidQuality(value) {
  if (!/^\d+$/.test(value)) return false;
  const number = Number(value);
  return number >= 1 && number <= 100;
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
