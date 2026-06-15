const state = {
  project: null,
  segments: [],
  selectedId: null,
  activeId: null,
  playingSegmentId: null,
  editingId: null,
  speakerColors: new Map(),
  dirty: false,
  showTiming: localStorage.getItem("showTiming") !== "false",
};

const speakerPalette = [
  { bg: "#fff4b8", active: "#ffd43b", border: "#e67700" },
  { bg: "#c3fae8", active: "#63e6be", border: "#099268" },
  { bg: "#d0ebff", active: "#74c0fc", border: "#1c7ed6" },
  { bg: "#ffe3e3", active: "#ff8787", border: "#e03131" },
  { bg: "#e5dbff", active: "#b197fc", border: "#7048e8" },
  { bg: "#d3f9d8", active: "#8ce99a", border: "#2f9e44" },
  { bg: "#ffd8a8", active: "#ffa94d", border: "#f76707" },
  { bg: "#f3d9fa", active: "#da77f2", border: "#ae3ec9" },
  { bg: "#c5f6fa", active: "#66d9e8", border: "#0c8599" },
  { bg: "#ffdeeb", active: "#f783ac", border: "#d6336c" },
  { bg: "#e9fac8", active: "#c0eb75", border: "#66a80f" },
  { bg: "#dbe4ff", active: "#91a7ff", border: "#4263eb" },
  { bg: "#fff0f6", active: "#faa2c1", border: "#c2255c" },
  { bg: "#d2f4ea", active: "#63c7b2", border: "#087f5b" },
  { bg: "#f1f3f5", active: "#adb5bd", border: "#495057" },
  { bg: "#ffe8cc", active: "#ffc078", border: "#e8590c" },
  { bg: "#e7f5ff", active: "#66d9e8", border: "#1971c2" },
  { bg: "#f8f0fc", active: "#cc5de8", border: "#9c36b5" },
];

const nodes = {
  audioInput: document.querySelector("#audioInput"),
  audioInputStatus: document.querySelector("#audioInputStatus"),
  transcriptInput: document.querySelector("#transcriptInput"),
  transcriptInputStatus: document.querySelector("#transcriptInputStatus"),
  createButton: document.querySelector("#createButton"),
  recentPanel: document.querySelector("#recentPanel"),
  recentProjects: document.querySelector("#recentProjects"),
  openRecentButton: document.querySelector("#openRecentButton"),
  importStatus: document.querySelector("#importStatus"),
  importPanel: document.querySelector("#importPanel"),
  editorPanel: document.querySelector("#editorPanel"),
  audioPlayer: document.querySelector("#audioPlayer"),
  searchInput: document.querySelector("#searchInput"),
  replaceInput: document.querySelector("#replaceInput"),
  replaceAllButton: document.querySelector("#replaceAllButton"),
  rateInput: document.querySelector("#rateInput"),
  rateOutput: document.querySelector("#rateOutput"),
  timingToggle: document.querySelector("#timingToggle"),
  currentTime: document.querySelector("#currentTime"),
  projectName: document.querySelector("#projectName"),
  segmentCount: document.querySelector("#segmentCount"),
  editorStatus: document.querySelector("#editorStatus"),
  segmentsList: document.querySelector("#segmentsList"),
  segmentTemplate: document.querySelector("#segmentTemplate"),
  saveButton: document.querySelector("#saveButton"),
  newProjectButton: document.querySelector("#newProjectButton"),
  addSegmentButton: document.querySelector("#addSegmentButton"),
  mergeButton: document.querySelector("#mergeButton"),
  splitButton: document.querySelector("#splitButton"),
  renameSpeakerButton: document.querySelector("#renameSpeakerButton"),
  renameSpeakerDialog: document.querySelector("#renameSpeakerDialog"),
  renameSpeakerCurrent: document.querySelector("#renameSpeakerCurrent"),
  renameSpeakerNew: document.querySelector("#renameSpeakerNew"),
  renameSpeakerStatus: document.querySelector("#renameSpeakerStatus"),
  cancelRenameSpeakerButton: document.querySelector("#cancelRenameSpeakerButton"),
  confirmRenameSpeakerButton: document.querySelector("#confirmRenameSpeakerButton"),
};

const importFileHints = {
  audio: "Choose a local audio or video file.",
  transcript: "Choose a CSV, SRT, VTT, TXT, or JSON file.",
};

nodes.audioInput.addEventListener("change", () => handleImportFileChoice("audio"));
nodes.transcriptInput.addEventListener("change", () => handleImportFileChoice("transcript"));
nodes.createButton.addEventListener("click", createProject);
nodes.openRecentButton.addEventListener("click", openRecentProject);
nodes.saveButton.addEventListener("click", saveProject);
nodes.newProjectButton.addEventListener("click", resetProject);
nodes.audioPlayer.addEventListener("timeupdate", syncActiveSegment);
nodes.audioPlayer.addEventListener("loadedmetadata", syncActiveSegment);
nodes.audioPlayer.addEventListener("play", updatePlaybackControls);
nodes.audioPlayer.addEventListener("pause", clearPlayingSegment);
nodes.audioPlayer.addEventListener("ended", clearPlayingSegment);
nodes.searchInput.addEventListener("input", applyFilter);
nodes.replaceInput.addEventListener("input", updateReplaceControls);
nodes.replaceAllButton.addEventListener("click", replaceAllMatches);
nodes.rateInput.addEventListener("input", updatePlaybackRate);
nodes.timingToggle.checked = state.showTiming;
nodes.timingToggle.addEventListener("change", updateTimingVisibility);
nodes.addSegmentButton.addEventListener("click", addSegmentAtCurrentTime);
nodes.mergeButton.addEventListener("click", mergeSelectedWithNext);
nodes.splitButton.addEventListener("click", splitSelectedAtCaret);
nodes.renameSpeakerButton.addEventListener("click", openRenameSpeakerDialog);
nodes.renameSpeakerCurrent.addEventListener("change", syncRenameSpeakerInput);
nodes.cancelRenameSpeakerButton.addEventListener("click", closeRenameSpeakerDialog);
nodes.renameSpeakerDialog.addEventListener("close", clearRenameSpeakerStatus);
nodes.renameSpeakerDialog.querySelector("form").addEventListener("submit", applySpeakerRename);
document.querySelectorAll("[data-export]").forEach((button) => {
  button.addEventListener("click", () => exportProject(button.dataset.export));
});
loadRecentProjects();
openProjectFromUrl();

window.addEventListener("beforeunload", (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

document.addEventListener("keydown", handleGlobalKeydown);

function handleGlobalKeydown(event) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    if (!state.project || nodes.saveButton.disabled) return;
    saveProject();
    return;
  }

  if (!state.project || isEditingControl(event.target)) return;

  if (event.key === " ") {
    event.preventDefault();
    toggleCurrentSegmentPlayback();
    return;
  }

  if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "Enter") {
    event.preventDefault();
    enterPlaybackEditMode();
    return;
  }

  if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "ArrowDown") {
    event.preventDefault();
    editAdjacentSegment(1);
    return;
  }

  if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "ArrowUp") {
    event.preventDefault();
    editAdjacentSegment(-1);
    return;
  }

  if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "ArrowLeft") {
    event.preventDefault();
    seekAudioBy(-5);
    return;
  }

  if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "ArrowRight") {
    event.preventDefault();
    seekAudioBy(5);
    return;
  }

  if (!event.metaKey && !event.ctrlKey && !event.altKey && /^[1-9]$/.test(event.key)) {
    event.preventDefault();
    assignSpeakerByShortcut(Number(event.key));
  }
}

function isEditingControl(target) {
  if (!(target instanceof HTMLElement)) return false;
  return ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable;
}

function handleImportFileChoice(role) {
  const input = importInputForRole(role);
  const file = input.files?.[0];
  if (!file) {
    setImportFileStatus(role, importFileHints[role]);
    return;
  }

  setImportFileStatus(role, `${file.name} is ready.`);
  setStatus(`${file.name} is ready.`);
}

async function createProject() {
  const audioFile = nodes.audioInput.files?.[0];
  const transcriptFile = nodes.transcriptInput.files?.[0];
  if (!audioFile || !transcriptFile) {
    if (!audioFile) {
      setImportFileStatus("audio", "Choose an audio or video file.", true);
    }
    if (!transcriptFile) {
      setImportFileStatus("transcript", "Choose a transcript file.", true);
    }
    setStatus("Choose both audio and transcript files.");
    return;
  }

  setBusy(true, "Reading transcript...");
  try {
    const transcriptText = await transcriptFile.text();
    const createResponse = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audio_filename: audioFile.name,
        audio_type: audioFile.type,
        transcript_filename: transcriptFile.name,
        transcript_text: transcriptText,
      }),
    });
    if (!createResponse.ok) {
      throw new Error(await readError(createResponse));
    }
    const project = await createResponse.json();

    setBusy(true, "Uploading audio...");
    const audioResponse = await fetch(`/api/projects/${project.id}/audio`, {
      method: "PUT",
      headers: {
        "Content-Type": audioFile.type || "application/octet-stream",
        "X-Filename": encodeURIComponent(audioFile.name),
      },
      body: audioFile,
    });
    if (!audioResponse.ok) {
      throw new Error(await readError(audioResponse));
    }
    const uploadResult = await audioResponse.json();
    loadProject(uploadResult.project);
    loadRecentProjects();
    setStatus("Project loaded.");
  } catch (error) {
    setStatus(error.message || "Could not load project.");
  } finally {
    setBusy(false);
  }
}

function loadProject(project) {
  state.project = project;
  state.segments = normalizeSegments(project.segments || []);
  const playbackState = normalizePlaybackState(project.playback_state);
  const playbackSegment = segmentAtTime(playbackState.currentTime);
  state.selectedId = playbackState.selectedId ?? playbackSegment?.id ?? state.segments[0]?.id ?? null;
  state.activeId = playbackSegment?.id ?? state.selectedId;
  state.playingSegmentId = null;
  state.editingId = null;
  state.dirty = false;
  nodes.audioPlayer.src = `/api/projects/${project.id}/audio`;
  nodes.projectName.textContent = `${project.audio_filename} / ${project.transcript_filename}`;
  nodes.importPanel.classList.add("hidden");
  nodes.editorPanel.classList.remove("hidden");
  renderSegments();
  restoreAudioPosition(playbackState.currentTime);
  requestAnimationFrame(() => centerSegmentInView(state.selectedId));
  updateToolbar();
}

function resetProject() {
  state.project = null;
  state.segments = [];
  state.selectedId = null;
  state.activeId = null;
  state.playingSegmentId = null;
  state.editingId = null;
  state.dirty = false;
  nodes.audioPlayer.removeAttribute("src");
  nodes.audioPlayer.load();
  nodes.audioInput.value = "";
  nodes.transcriptInput.value = "";
  resetImportFileStatuses();
  nodes.searchInput.value = "";
  nodes.replaceInput.value = "";
  nodes.importPanel.classList.remove("hidden");
  nodes.editorPanel.classList.add("hidden");
  nodes.saveButton.disabled = true;
  nodes.renameSpeakerButton.disabled = true;
  updateReplaceControls();
  setStatus("");
  loadRecentProjects();
}

async function loadRecentProjects() {
  try {
    const response = await fetch("/api/projects");
    if (!response.ok) return;
    const projects = await response.json();
    nodes.recentProjects.textContent = "";
    for (const project of projects) {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = `${project.audio_filename || "audio"} / ${project.transcript_filename || "transcript"} (${project.segment_count})`;
      nodes.recentProjects.append(option);
    }
    nodes.recentPanel.classList.toggle("hidden", projects.length === 0);
  } catch {
    nodes.recentPanel.classList.add("hidden");
  }
}

async function openProjectFromUrl() {
  const projectId = new URLSearchParams(window.location.search).get("project");
  if (!projectId) return;

  setStatus("Opening project...");
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    loadProject(await response.json());
    setStatus("Project loaded.");
  } catch (error) {
    setStatus(error.message || "Could not open project.");
  }
}

async function openRecentProject() {
  const projectId = nodes.recentProjects.value;
  if (!projectId) return;
  setBusy(true, "Opening project...");
  try {
    const response = await fetch(`/api/projects/${projectId}`);
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    loadProject(await response.json());
    setStatus("Project loaded.");
  } catch (error) {
    setStatus(error.message || "Could not open project.");
  } finally {
    setBusy(false);
  }
}

function renderSegments() {
  nodes.segmentsList.textContent = "";
  nodes.segmentsList.classList.toggle("timing-hidden", !state.showTiming);
  const speakers = getSpeakers();
  const highlightedId = highlightedSegmentId();
  syncSpeakerColors(speakers);
  const fragment = document.createDocumentFragment();
  for (const segment of state.segments) {
    const row = nodes.segmentTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.id = String(segment.id);
    applySpeakerColor(row, segment.speaker);
    row.classList.toggle("selected", segment.id === highlightedId);
    row.classList.toggle("active", segment.id === state.activeId);
    row.classList.toggle("playing", isSegmentPlaying(segment.id));
    row.classList.toggle("editing", segment.id === state.editingId);
    populateSpeakerSelect(row.querySelector(".speaker-input"), speakers, segment.speaker);
    row.querySelector(".start-input").value = formatTime(segment.start);
    row.querySelector(".end-input").value = formatTime(segment.end);
    const preview = row.querySelector(".segment-preview");
    renderSegmentPreview(preview, segment);

    const playButton = row.querySelector(".play-segment");
    updatePlayButton(playButton, segment.id);
    row.addEventListener("click", () => selectSegment(segment.id));
    playButton.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleSegmentPlayback(segment);
    });
    row.querySelector(".set-start").addEventListener("click", (event) => {
      event.stopPropagation();
      updateSegment(segment.id, { start: roundTime(nodes.audioPlayer.currentTime) });
    });
    row.querySelector(".set-end").addEventListener("click", (event) => {
      event.stopPropagation();
      updateSegment(segment.id, { end: roundTime(nodes.audioPlayer.currentTime) });
    });

    const startInput = row.querySelector(".start-input");
    const endInput = row.querySelector(".end-input");
    const speakerInput = row.querySelector(".speaker-input");
    const textInput = row.querySelector(".segment-text");
    textInput.value = segment.text;

    speakerInput.addEventListener("focus", () => selectSegment(segment.id));
    speakerInput.addEventListener("change", () => {
      updateSegment(segment.id, { speaker: speakerInput.value }, false);
      renderSegments();
      scrollSelectedIntoView();
    });
    startInput.addEventListener("change", () => updateSegment(segment.id, { start: parseTime(startInput.value) }));
    endInput.addEventListener("change", () => updateSegment(segment.id, { end: parseTime(endInput.value) }));
    preview.addEventListener("mousedown", (event) => {
      preview.dataset.mouseDownCaret = String(caretPositionFromPoint(event, preview));
      preview.dataset.mouseDownX = String(event.clientX);
      preview.dataset.mouseDownY = String(event.clientY);
    });
    preview.addEventListener("mouseup", (event) => {
      const selectionRange = dragPreviewTextRange(event, preview) || selectedPreviewTextRange(preview);
      clearPreviewMouseState(preview);
      if (!selectionRange) return;
      preview.dataset.skipNextClick = "true";
      event.preventDefault();
      event.stopPropagation();
      window.setTimeout(() => {
        enterTextEditMode(segment.id, selectionRange);
      }, 0);
      clearPageSelection();
    });
    preview.addEventListener("click", (event) => {
      event.stopPropagation();
      if (preview.dataset.skipNextClick === "true") {
        delete preview.dataset.skipNextClick;
        return;
      }
      const selectionRange = selectedPreviewTextRange(preview);
      if (selectionRange) {
        enterTextEditMode(segment.id, selectionRange);
        clearPageSelection();
        return;
      }
      enterTextEditMode(segment.id, caretPositionFromPoint(event, preview));
    });
    textInput.addEventListener("focus", () => {
      state.editingId = segment.id;
      selectSegment(segment.id);
      row.classList.add("editing");
    });
    textInput.addEventListener("blur", () => {
      exitTextEditMode(segment.id);
    });
    textInput.addEventListener("input", () => {
      updateSegment(segment.id, { text: textInput.value }, false);
      segment.text = textInput.value;
      renderSegmentPreview(preview, segment);
      fitTextarea(textInput);
      updateWordHighlights();
    });
    textInput.addEventListener("keydown", (event) => handleTextKeydown(event, segment.id));
    fitTextarea(textInput);

    fragment.append(row);
  }
  nodes.segmentsList.append(fragment);
  nodes.segmentsList.querySelectorAll(".segment-text").forEach(fitTextarea);
  updateWordHighlights();
  nodes.segmentCount.textContent = `${state.segments.length} segments`;
  applyFilter();
  updateToolbar();
}

function getSpeakers() {
  return collectSpeakers(state.segments).sort(compareSpeakers);
}

function collectSpeakers(segments) {
  const speakers = [];
  for (const segment of segments) {
    const speaker = segment.speaker.trim();
    if (speaker && !speakers.includes(speaker)) {
      speakers.push(speaker);
    }
  }
  return speakers;
}

function compareSpeakers(left, right) {
  const leftNumber = speakerNumber(left);
  const rightNumber = speakerNumber(right);
  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber - rightNumber;
  }
  if (leftNumber !== null) return -1;
  if (rightNumber !== null) return 1;
  return left.localeCompare(right, "uk", { numeric: true, sensitivity: "base" });
}

function speakerNumber(speaker) {
  const match = String(speaker).trim().match(/^(?:мовець|speaker)\s*(\d+)$/iu);
  return match ? Number(match[1]) : null;
}

function populateSpeakerSelect(select, speakers, currentSpeaker) {
  select.textContent = "";
  if (!currentSpeaker) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "No speaker assigned";
    select.append(emptyOption);
  }

  const options = [...speakers];
  if (currentSpeaker && !options.includes(currentSpeaker)) {
    options.push(currentSpeaker);
  }
  for (const speaker of options) {
    const option = document.createElement("option");
    option.value = speaker;
    option.textContent = speaker;
    select.append(option);
  }
  select.value = currentSpeaker || "";
}

function openRenameSpeakerDialog() {
  const speakers = getSpeakers();
  if (!speakers.length) return;
  const currentSegment = state.segments.find((segment) => segment.id === state.selectedId);
  const preferredSpeaker = currentSegment?.speaker && speakers.includes(currentSegment.speaker)
    ? currentSegment.speaker
    : speakers[0];

  nodes.renameSpeakerCurrent.textContent = "";
  for (const speaker of speakers) {
    const option = document.createElement("option");
    option.value = speaker;
    option.textContent = speaker;
    nodes.renameSpeakerCurrent.append(option);
  }
  nodes.renameSpeakerCurrent.value = preferredSpeaker;
  nodes.renameSpeakerNew.value = preferredSpeaker;
  clearRenameSpeakerStatus();

  nodes.renameSpeakerDialog.showModal();
  nodes.renameSpeakerNew.focus();
  nodes.renameSpeakerNew.select();
}

function closeRenameSpeakerDialog() {
  nodes.renameSpeakerDialog.close();
}

function clearRenameSpeakerStatus() {
  nodes.renameSpeakerStatus.textContent = "";
}

function syncRenameSpeakerInput() {
  nodes.renameSpeakerNew.value = nodes.renameSpeakerCurrent.value;
  nodes.renameSpeakerNew.focus();
  nodes.renameSpeakerNew.select();
}

function applySpeakerRename(event) {
  event.preventDefault();
  const oldName = nodes.renameSpeakerCurrent.value;
  const newName = nodes.renameSpeakerNew.value.trim();
  const speakers = getSpeakers();

  if (!oldName || !speakers.includes(oldName)) {
    nodes.renameSpeakerStatus.textContent = "Choose a current speaker.";
    return;
  }
  if (!newName) {
    nodes.renameSpeakerStatus.textContent = "Enter a new speaker name.";
    nodes.renameSpeakerNew.focus();
    return;
  }
  if (newName === oldName) {
    closeRenameSpeakerDialog();
    return;
  }
  if (speakers.includes(newName)) {
    const shouldMerge = window.confirm(`"${newName}" already exists. Merge "${oldName}" into "${newName}"?`);
    if (!shouldMerge) return;
  } else {
    const oldColor = state.speakerColors.get(oldName);
    if (oldColor && !state.speakerColors.has(newName)) {
      state.speakerColors.set(newName, oldColor);
    }
  }

  state.segments = state.segments.map((segment) => (
    segment.speaker === oldName ? { ...segment, speaker: newName } : segment
  ));
  markDirty();
  closeRenameSpeakerDialog();
  renderSegments();
  scrollSelectedIntoView();
  setStatus(`Renamed "${oldName}" to "${newName}".`);
}

function syncSpeakerColors(speakers) {
  const next = new Map();
  speakers.forEach((speaker, index) => {
    next.set(speaker, state.speakerColors.get(speaker) || speakerColor(index));
  });
  state.speakerColors = next;
}

function speakerColor(index) {
  if (index < speakerPalette.length) {
    return speakerPalette[index];
  }
  const hue = Math.round((index * 137.508) % 360);
  return {
    bg: `hsl(${hue} 88% 91%)`,
    active: `hsl(${hue} 84% 78%)`,
    border: `hsl(${hue} 70% 38%)`,
  };
}

function applySpeakerColor(row, speaker) {
  const color = state.speakerColors.get(speaker);
  if (!color) return;
  row.style.setProperty("--speaker-bg", color.bg);
  row.style.setProperty("--speaker-active-bg", color.active);
  row.style.setProperty("--speaker-border", color.border);
  row.classList.add("has-speaker");
}

function selectSegment(id) {
  state.selectedId = id;
  updateSelectedRows();
  updateToolbar();
}

function handleTextKeydown(event, id) {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    insertTextareaLineBreak(event.currentTarget, id);
    return;
  }
  if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "Enter") {
    event.preventDefault();
    selectSegment(id);
    event.currentTarget.blur();
    exitTextEditMode(id);
    return;
  }
}

function insertTextareaLineBreak(textarea, id) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  const nextValue = `${textarea.value.slice(0, start)}\n${textarea.value.slice(end)}`;
  textarea.value = nextValue;
  textarea.setSelectionRange(start + 1, start + 1);
  updateSegment(id, { text: nextValue }, false);
  fitTextarea(textarea);
}

function enterTextEditMode(id, selection = null) {
  state.editingId = id;
  selectSegment(id);
  const row = document.querySelector(`.segment-row[data-id="${id}"]`);
  row?.classList.add("editing");
  const textarea = row?.querySelector(".segment-text");
  if (textarea) {
    fitTextarea(textarea);
  }
  textarea?.focus();
  if (textarea && selection !== null) {
    const start = typeof selection === "number" ? selection : selection.start;
    const end = typeof selection === "number" ? selection : selection.end;
    textarea.setSelectionRange(start, end);
  }
}

function exitTextEditMode(id) {
  if (state.editingId === id) {
    state.editingId = null;
  }
  const row = document.querySelector(`.segment-row[data-id="${id}"]`);
  row?.classList.remove("editing");
  const preview = row?.querySelector(".segment-preview");
  const segment = state.segments.find((item) => item.id === id);
  if (preview && segment) {
    renderSegmentPreview(preview, segment);
  }
  updateWordHighlights();
}

function renderSegmentPreview(preview, segment) {
  preview.textContent = "";
  const tokens = buildTextTokens(segment.text);
  let wordIndex = 0;
  if (!tokens.length) {
    preview.append(document.createTextNode(" "));
    return;
  }
  for (const token of tokens) {
    const span = document.createElement("span");
    span.className = token.isWordLike ? "segment-word" : "segment-token";
    span.dataset.start = String(token.start);
    span.dataset.end = String(token.end);
    if (token.isWordLike) {
      span.dataset.wordIndex = String(wordIndex);
      wordIndex += 1;
    }
    span.textContent = token.text;
    preview.append(span);
  }
}

function caretPositionFromPoint(event, preview) {
  const doc = preview.ownerDocument;
  const range =
    doc.caretPositionFromPoint?.(event.clientX, event.clientY) ||
    doc.caretRangeFromPoint?.(event.clientX, event.clientY);
  if (!range) {
    return preview.textContent.length;
  }
  const node = range.offsetNode || range.startContainer;
  const offset = range.offset ?? range.startOffset ?? 0;
  if (!preview.contains(node)) {
    return preview.textContent.length;
  }
  return textOffsetFromPreviewPosition(preview, node, offset);
}

function dragPreviewTextRange(event, preview) {
  const start = Number(preview.dataset.mouseDownCaret);
  if (!Number.isFinite(start)) return null;
  const deltaX = Math.abs(event.clientX - Number(preview.dataset.mouseDownX || event.clientX));
  const deltaY = Math.abs(event.clientY - Number(preview.dataset.mouseDownY || event.clientY));
  if (deltaX < 4 && deltaY < 4) return null;
  const end = caretPositionFromPoint(event, preview);
  return start === end ? null : { start: Math.min(start, end), end: Math.max(start, end) };
}

function clearPreviewMouseState(preview) {
  delete preview.dataset.mouseDownCaret;
  delete preview.dataset.mouseDownX;
  delete preview.dataset.mouseDownY;
}

function selectedPreviewTextRange(preview) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!preview.contains(range.startContainer) || !preview.contains(range.endContainer)) {
    return null;
  }
  const start = textOffsetFromPreviewPosition(preview, range.startContainer, range.startOffset);
  const end = textOffsetFromPreviewPosition(preview, range.endContainer, range.endOffset);
  return start === end ? null : { start: Math.min(start, end), end: Math.max(start, end) };
}

function clearPageSelection() {
  window.getSelection()?.removeAllRanges();
}

function textOffsetFromPreviewPosition(preview, targetNode, targetOffset) {
  const range = document.createRange();
  try {
    range.selectNodeContents(preview);
    range.setEnd(targetNode, targetOffset);
    return range.toString().length;
  } catch {
    return preview.textContent.length;
  } finally {
    range.detach();
  }
}


function buildTextTokens(text) {
  const tokens = [];
  const pattern = /(\n)|([\p{L}\p{M}\p{N}]+(?:[’'ʼ-][\p{L}\p{M}\p{N}]+)*)|([^\n\p{L}\p{M}\p{N}]+)/gu;
  for (const match of String(text || "").matchAll(pattern)) {
    tokens.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
      isWordLike: Boolean(match[2]),
    });
  }
  return tokens;
}

function getWordTokens(text) {
  return buildTextTokens(text).filter((token) => token.isWordLike && token.text.trim());
}

function activeWordIndex(segment, time) {
  const words = getWordTokens(segment.text);
  if (!words.length) return null;
  const duration = Math.max(0, segment.end - segment.start);
  if (duration === 0) return 0;
  const elapsed = Math.max(0, Math.min(duration, time - segment.start));
  const weights = words.map((word) => Math.max(word.text.length, 1));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;
  for (let index = 0; index < weights.length; index += 1) {
    cursor += (duration * weights[index]) / totalWeight;
    if (elapsed <= cursor || index === weights.length - 1) return index;
  }
  return null;
}

function activeWordCaretPosition(segment, time) {
  const words = getWordTokens(segment.text);
  const index = activeWordIndex(segment, time);
  if (index === null) return null;
  return words[index]?.start ?? null;
}

function updateSegment(id, patch, rerender = true) {
  const segment = state.segments.find((item) => item.id === id);
  if (!segment) return;
  Object.assign(segment, patch);
  if (segment.end < segment.start) {
    segment.end = segment.start;
  }
  state.segments = normalizeSegments(state.segments);
  markDirty();
  if (rerender) {
    renderSegments();
    scrollSelectedIntoView();
  }
}

function markDirty() {
  state.dirty = true;
  nodes.saveButton.disabled = false;
  setStatus("Unsaved changes.");
}

async function saveProject() {
  if (!state.project) return;
  setStatus("Saving...");
  const response = await fetch(`/api/projects/${state.project.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ segments: state.segments, playback_state: currentPlaybackState() }),
  });
  if (!response.ok) {
    setStatus(await readError(response));
    return;
  }
  state.project = await response.json();
  state.segments = normalizeSegments(state.project.segments || []);
  state.dirty = false;
  nodes.saveButton.disabled = true;
  renderSegments();
  setStatus("Saved.");
}

function addSegmentAtCurrentTime() {
  const current = roundTime(nodes.audioPlayer.currentTime || 0);
  const selectedIndex = selectedIndexOrLastBefore(current);
  const next = state.segments[selectedIndex + 1];
  const end = next ? Math.max(current + 0.5, next.start) : current + 3;
  const segment = {
    id: state.segments.length + 1,
    start: current,
    end,
    speaker: state.segments[selectedIndex]?.speaker || "",
    text: "",
  };
  state.segments.splice(selectedIndex + 1, 0, segment);
  state.segments = normalizeSegments(state.segments);
  state.selectedId = findSegmentIdByShape(segment, selectedIndex + 1);
  markDirty();
  renderSegments();
  scrollSelectedIntoView();
  focusSelectedText(0);
}

function selectedIndexOrLastBefore(time) {
  const selectedIndex = state.segments.findIndex((segment) => segment.id === state.selectedId);
  if (selectedIndex >= 0) return selectedIndex;
  let index = state.segments.findIndex((segment) => segment.start > time);
  return index > 0 ? index - 1 : state.segments.length - 1;
}

function mergeSelectedWithNext() {
  const index = state.segments.findIndex((segment) => segment.id === state.selectedId);
  if (index < 0 || index >= state.segments.length - 1) return;
  const current = state.segments[index];
  const next = state.segments[index + 1];
  current.end = Math.max(current.end, next.end);
  current.text = `${current.text.trim()} ${next.text.trim()}`.trim();
  state.segments.splice(index + 1, 1);
  state.segments = normalizeSegments(state.segments);
  state.selectedId = current.id;
  markDirty();
  renderSegments();
  scrollSelectedIntoView();
}

function splitSelectedAtCaret() {
  const index = state.segments.findIndex((segment) => segment.id === state.selectedId);
  if (index < 0) return;
  const row = document.querySelector(`.segment-row[data-id="${state.selectedId}"]`);
  const textarea = row?.querySelector(".segment-text");
  if (!textarea) return;
  const caret = textarea.selectionStart ?? 0;
  const text = textarea.value;
  const left = text.slice(0, caret).trim();
  const right = text.slice(caret).trim();
  if (!left || !right) return;

  const segment = state.segments[index];
  const originalEnd = segment.end;
  const midpoint = roundTime((segment.start + segment.end) / 2);
  segment.text = left;
  segment.end = midpoint;
  const inserted = {
    id: state.segments.length + 1,
    start: midpoint,
    end: Math.max(midpoint, originalEnd),
    speaker: segment.speaker,
    text: right,
  };
  state.segments.splice(index + 1, 0, inserted);
  state.segments = normalizeSegments(state.segments);
  state.selectedId = findSegmentIdByShape(inserted, index + 1);
  markDirty();
  renderSegments();
  scrollSelectedIntoView();
  focusSelectedText(0);
}

function toggleSegmentPlayback(segment) {
  if (isSegmentPlaying(segment.id)) {
    nodes.audioPlayer.pause();
    clearPlayingSegment();
    return;
  }
  state.playingSegmentId = segment.id;
  state.selectedId = segment.id;
  playFrom(segment.start, segment.id);
}

function toggleCurrentSegmentPlayback() {
  if (!nodes.audioPlayer.paused) {
    nodes.audioPlayer.pause();
    clearPlayingSegment();
    return;
  }
  if (nodes.audioPlayer.currentTime > 0) {
    resumeFromCurrentTime();
    return;
  }
  const segment = currentShortcutSegment();
  if (segment) {
    toggleSegmentPlayback(segment);
  }
}

function currentShortcutSegment() {
  const id = highlightedSegmentId() ?? state.selectedId ?? state.activeId;
  return state.segments.find((segment) => segment.id === id) || state.segments[0] || null;
}

function currentTimeSegment() {
  return segmentAtTime(nodes.audioPlayer.currentTime || 0);
}

function segmentAtTime(time) {
  return state.segments.find((segment) => time >= segment.start && time <= segment.end) || null;
}

function resumeFromCurrentTime() {
  const segment = currentTimeSegment() || currentShortcutSegment();
  if (segment) {
    state.playingSegmentId = segment.id;
    state.selectedId = segment.id;
    centerSegmentInView(segment.id);
    updatePlaybackControls();
  }
  const playPromise = nodes.audioPlayer.play();
  if (playPromise?.catch) {
    playPromise.catch(() => {
      clearPlayingSegment();
      setStatus("Could not resume playback.");
    });
  }
}

function assignSpeakerByShortcut(index) {
  const segment = currentShortcutSegment();
  if (!segment) return;
  const speakers = getSpeakers();
  const speaker = speakers.find((item) => speakerNumber(item) === index) || speakers[index - 1];
  if (speaker === undefined) return;
  if (segment.speaker === speaker) return;
  state.selectedId = segment.id;
  updateSegment(segment.id, { speaker }, false);
  renderSegments();
  centerSegmentInView(segment.id);
}

function enterPlaybackEditMode() {
  const time = nodes.audioPlayer.currentTime || 0;
  const segment = currentTimeSegment() || currentShortcutSegment();
  if (!segment) return;
  const caretPosition = activeWordCaretPosition(segment, time) ?? 0;
  nodes.audioPlayer.pause();
  state.playingSegmentId = null;
  state.selectedId = segment.id;
  state.activeId = segment.id;
  centerSegmentInView(segment.id);
  updateSelectedRows();
  updatePlaybackControls();
  enterTextEditMode(segment.id, caretPosition);
}

function playFrom(seconds, segmentId = null) {
  nodes.audioPlayer.currentTime = Math.max(0, seconds);
  if (segmentId !== null) {
    state.playingSegmentId = segmentId;
    centerSegmentInView(segmentId);
    updatePlaybackControls();
  }
  const playPromise = nodes.audioPlayer.play();
  if (playPromise?.catch) {
    playPromise.catch(() => {
      clearPlayingSegment();
      setStatus("Could not start playback.");
    });
  }
}

function seekAudioBy(deltaSeconds) {
  const current = nodes.audioPlayer.currentTime || 0;
  const duration = nodes.audioPlayer.duration;
  const maxTime = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  const nextTime = roundTime(Math.min(maxTime, Math.max(0, current + deltaSeconds)));
  const wasPlaying = !nodes.audioPlayer.paused;
  nodes.audioPlayer.currentTime = nextTime;
  nodes.currentTime.textContent = formatTime(nextTime);

  const segment = segmentAtTime(nextTime);
  state.activeId = segment?.id ?? null;
  if (segment) {
    state.selectedId = segment.id;
    state.playingSegmentId = wasPlaying ? segment.id : null;
    centerSegmentInView(segment.id);
  } else if (wasPlaying) {
    state.playingSegmentId = null;
  }

  updateSelectedRows();
  updateToolbar();
  updatePlaybackControls();
  updateWordHighlights(nextTime);
}

function editAdjacentSegment(direction) {
  const fallbackIndex = direction > 0 ? -1 : state.segments.length;
  const index = state.segments.findIndex((segment) => segment.id === state.selectedId);
  const currentIndex = index >= 0 ? index : fallbackIndex;
  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= state.segments.length) return;
  const segment = state.segments[nextIndex];
  nodes.audioPlayer.pause();
  state.playingSegmentId = null;
  state.selectedId = segment.id;
  state.activeId = segment.id;
  centerSegmentInView(segment.id);
  updateSelectedRows();
  updateToolbar();
  updatePlaybackControls();
  enterTextEditMode(segment.id, 0);
}

function syncActiveSegment() {
  const time = nodes.audioPlayer.currentTime || 0;
  nodes.currentTime.textContent = formatTime(time);
  const active = state.segments.find((segment) => time >= segment.start && time <= segment.end);
  const activeId = active?.id ?? null;
  const previousSelectedId = state.selectedId;
  if (!nodes.audioPlayer.paused) {
    state.playingSegmentId = activeId;
    if (activeId !== null) {
      state.selectedId = activeId;
    }
  }
  if (activeId === state.activeId) {
    if (previousSelectedId !== state.selectedId) {
      updateSelectedRows();
      updateToolbar();
    }
    updatePlaybackControls();
    updateWordHighlights(time);
    return;
  }
  state.activeId = activeId;
  document.querySelectorAll(".segment-row").forEach((row) => {
    const isActive = Number(row.dataset.id) === activeId;
    row.classList.toggle("active", isActive);
    if (!isActive) return;
    if (!nodes.audioPlayer.paused) {
      row.scrollIntoView({ block: "center" });
    } else if (document.activeElement?.tagName !== "TEXTAREA") {
      row.scrollIntoView({ block: "nearest" });
    }
  });
  updateSelectedRows();
  updateToolbar();
  updatePlaybackControls();
  updateWordHighlights(time);
}

function clearPlayingSegment() {
  state.playingSegmentId = null;
  updateSelectedRows();
  updatePlaybackControls();
  updateWordHighlights();
}

function highlightedSegmentId() {
  if (!nodes.audioPlayer.paused && state.activeId !== null) {
    return state.activeId;
  }
  return state.selectedId;
}

function updateSelectedRows() {
  const highlightedId = highlightedSegmentId();
  document.querySelectorAll(".segment-row").forEach((row) => {
    row.classList.toggle("selected", Number(row.dataset.id) === highlightedId);
  });
}

function isSegmentPlaying(id) {
  return !nodes.audioPlayer.paused && state.playingSegmentId === id;
}

function updatePlaybackControls() {
  document.querySelectorAll(".segment-row").forEach((row) => {
    const segmentId = Number(row.dataset.id);
    row.classList.toggle("playing", isSegmentPlaying(segmentId));
    updatePlayButton(row.querySelector(".play-segment"), segmentId);
  });
}

function updateWordHighlights(time = nodes.audioPlayer.currentTime || 0) {
  document.querySelectorAll(".segment-word.current-word").forEach((word) => {
    word.classList.remove("current-word");
  });
  if (nodes.audioPlayer.paused || state.activeId === null) return;
  const segment = state.segments.find((item) => item.id === state.activeId);
  if (!segment) return;
  const index = activeWordIndex(segment, time);
  if (index === null) return;
  const row = document.querySelector(`.segment-row[data-id="${segment.id}"]`);
  const word = row?.querySelector(`.segment-word[data-word-index="${index}"]`);
  word?.classList.add("current-word");
}

function updatePlayButton(button, segmentId) {
  if (!button) return;
  const isPlaying = isSegmentPlaying(segmentId);
  const label = isPlaying ? "Pause this segment" : "Play from this segment";
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
  button.setAttribute("aria-pressed", String(isPlaying));
}

function updatePlaybackRate() {
  const value = Number(nodes.rateInput.value);
  nodes.audioPlayer.playbackRate = value;
  nodes.rateOutput.textContent = `${value.toFixed(2)}x`;
}

function updateTimingVisibility() {
  state.showTiming = nodes.timingToggle.checked;
  localStorage.setItem("showTiming", String(state.showTiming));
  renderSegments();
}

function applyFilter() {
  const query = nodes.searchInput.value.trim().toLowerCase();
  document.querySelectorAll(".segment-row").forEach((row) => {
    const segment = state.segments.find((item) => item.id === Number(row.dataset.id));
    const searchable = `${segment?.speaker || ""} ${segment?.text || ""}`.toLowerCase();
    const visible = !query || searchable.includes(query);
    row.classList.toggle("filtered-out", !visible);
  });
  updateReplaceControls();
}

function updateReplaceControls() {
  nodes.replaceAllButton.disabled = !state.project || nodes.searchInput.value.trim() === "";
}

function replaceAllMatches() {
  if (!state.project) return;
  const search = nodes.searchInput.value.trim();
  if (!search) {
    setStatus("Enter text to replace.");
    updateReplaceControls();
    return;
  }

  const replacement = nodes.replaceInput.value;
  const pattern = new RegExp(escapeRegExp(search), "giu");
  let replacementCount = 0;
  state.segments = state.segments.map((segment) => {
    const text = String(segment.text || "");
    const matches = text.match(pattern);
    if (!matches) return segment;
    replacementCount += matches.length;
    return { ...segment, text: text.replace(pattern, () => replacement) };
  });

  if (replacementCount === 0) {
    setStatus(`No matches for "${search}".`);
    return;
  }

  state.editingId = null;
  markDirty();
  renderSegments();
  setStatus(`Replaced ${replacementCount} match${replacementCount === 1 ? "" : "es"}.`);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function exportProject(format) {
  if (!state.project) return;
  if (state.dirty) {
    await saveProject();
  }
  window.location.href = `/api/projects/${state.project.id}/export/${format}`;
}

function updateToolbar() {
  const index = state.segments.findIndex((segment) => segment.id === state.selectedId);
  nodes.mergeButton.disabled = index < 0 || index >= state.segments.length - 1;
  nodes.splitButton.disabled = index < 0;
  nodes.renameSpeakerButton.disabled = getSpeakers().length === 0;
}

function focusSelectedText(caretPosition = null) {
  if (state.selectedId !== null) {
    state.editingId = state.selectedId;
  }
  const row = document.querySelector(`.segment-row[data-id="${state.selectedId}"]`);
  row?.classList.add("editing");
  const textarea = row?.querySelector(".segment-text");
  textarea?.focus();
  if (textarea && caretPosition !== null) {
    textarea.setSelectionRange(caretPosition, caretPosition);
  }
}

function fitTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.max(40, textarea.scrollHeight)}px`;
}

function findSegmentIdByShape(target, fallbackIndex) {
  const index = state.segments.findIndex(
    (segment) =>
      segment.start === target.start &&
      segment.end === target.end &&
      segment.speaker === target.speaker &&
      segment.text === target.text
  );
  if (index >= 0) return state.segments[index].id;
  const boundedIndex = Math.max(0, Math.min(fallbackIndex, state.segments.length - 1));
  return state.segments[boundedIndex]?.id ?? null;
}

function scrollSelectedIntoView() {
  const row = document.querySelector(`.segment-row[data-id="${state.selectedId}"]`);
  row?.scrollIntoView({ block: "nearest" });
}

function centerSegmentInView(id) {
  const row = document.querySelector(`.segment-row[data-id="${id}"]`);
  row?.scrollIntoView({ block: "center" });
}

function normalizePlaybackState(playbackState) {
  const currentTime = roundTime(Number(playbackState?.current_time ?? 0) || 0);
  const selectedId = Number(playbackState?.selected_id);
  return {
    currentTime,
    selectedId: state.segments.some((segment) => segment.id === selectedId) ? selectedId : null,
  };
}

function currentPlaybackState() {
  const currentTime = roundTime(nodes.audioPlayer.currentTime || 0);
  const segment = segmentAtTime(currentTime);
  return {
    current_time: currentTime,
    selected_id: state.selectedId ?? segment?.id ?? null,
  };
}

function restoreAudioPosition(time) {
  const currentTime = roundTime(time || 0);
  nodes.currentTime.textContent = formatTime(currentTime);
  const restore = () => {
    try {
      nodes.audioPlayer.currentTime = currentTime;
      nodes.currentTime.textContent = formatTime(currentTime);
    } catch {
      nodes.currentTime.textContent = formatTime(currentTime);
    }
  };
  if (nodes.audioPlayer.readyState > 0) {
    restore();
    return;
  }
  nodes.audioPlayer.addEventListener("loadedmetadata", restore, { once: true });
}

function normalizeSegments(segments) {
  return segments
    .map((segment, index) => ({
      id: index + 1,
      start: roundTime(Number(segment.start) || 0),
      end: roundTime(Number(segment.end) || Number(segment.start) || 0),
      speaker: String(segment.speaker || ""),
      text: String(segment.text || ""),
    }))
    .sort((a, b) => a.start - b.start)
    .map((segment, index) => ({ ...segment, id: index + 1 }));
}

function parseTime(value) {
  const clean = String(value).trim().replace(",", ".");
  if (!clean) return 0;
  const parts = clean.split(":").map(Number);
  if (parts.some(Number.isNaN)) return Number(clean) || 0;
  if (parts.length === 3) return roundTime(parts[0] * 3600 + parts[1] * 60 + parts[2]);
  if (parts.length === 2) return roundTime(parts[0] * 60 + parts[1]);
  return roundTime(parts[0]);
}

function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = Math.floor(value % 60);
  const millis = Math.round((value - Math.floor(value)) * 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${String(millis).padStart(3, "0")}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function roundTime(value) {
  return Math.max(0, Math.round(Number(value) * 1000) / 1000);
}

function setBusy(isBusy, message = "") {
  nodes.createButton.disabled = isBusy;
  nodes.createButton.textContent = isBusy ? "Loading..." : "Load editor";
  if (message) setStatus(message);
}

function importInputForRole(role) {
  return role === "audio" ? nodes.audioInput : nodes.transcriptInput;
}

function importStatusForRole(role) {
  return role === "audio" ? nodes.audioInputStatus : nodes.transcriptInputStatus;
}

function setImportFileStatus(role, message, isError = false) {
  const status = importStatusForRole(role);
  status.textContent = message;
  status.className = isError ? "field-hint error" : "field-hint";
}

function resetImportFileStatuses() {
  setImportFileStatus("audio", importFileHints.audio);
  setImportFileStatus("transcript", importFileHints.transcript);
}

function setStatus(message) {
  nodes.importStatus.textContent = message;
  nodes.editorStatus.textContent = message;
}

async function readError(response) {
  try {
    const payload = await response.json();
    return payload.detail || response.statusText;
  } catch {
    return response.statusText;
  }
}
