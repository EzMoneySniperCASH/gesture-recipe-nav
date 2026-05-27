/**
 * Overlay UI (isolated world). MediaPipe runs in the page MAIN world via
 * background.js + page-runner.js to avoid CSP / ModuleFactory issues.
 */

const ROOT_ID = "gesture-recipe-nav-root";
const PAGE_SOURCE = "gesture-recipe-nav-page";

const stale = document.getElementById(ROOT_ID);
if (stale) stale.remove();

const host = document.createElement("div");
host.id = ROOT_ID;
host.style.cssText =
  "all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;";
document.documentElement.appendChild(host);

const shadow = host.attachShadow({ mode: "open" });

const style = document.createElement("link");
style.rel = "stylesheet";
style.href = chrome.runtime.getURL("overlay.css");
shadow.appendChild(style);

const overlay = document.createElement("div");
overlay.className = "gesture-overlay";
overlay.innerHTML = `
  <div class="overlay-toolbar" id="drag-handle">
    <span class="drag-grip" aria-hidden="true">⋮⋮</span>
    <div class="toolbar-text">
      <h2 class="overlay-title">Hands-free mode</h2>
      <span id="toolbar-status" class="toolbar-status">Camera off</span>
    </div>
    <button
      id="collapse-btn"
      type="button"
      class="collapse-btn"
      aria-expanded="true"
      aria-label="Minimize panel"
      title="Minimize"
    >
      <span class="collapse-icon" aria-hidden="true"></span>
    </button>
  </div>
  <div class="overlay-body" id="overlay-body">
    <p class="overlay-subtitle">Scroll and zoom without touching the screen</p>
    <button id="toggle-btn" type="button" class="toggle-btn" data-state="off">Start camera</button>
    <div class="preview-wrap">
      <canvas id="preview" class="preview" width="320" height="240" aria-label="Camera preview"></canvas>
      <span id="preview-idle-label" class="preview-idle-label">Camera off</span>
    </div>
    <div id="status" class="status status--idle">Press Start to enable gestures</div>
    <section class="gestures" aria-label="Gesture controls">
      <h3 class="gestures-title">Gestures</h3>
      <p class="gestures-tip">Hold each one steady for about half a second</p>
      <ul class="gesture-list">
        <li><span class="gesture-icon" aria-hidden="true">👍</span><span class="gesture-action">Scroll up</span></li>
        <li><span class="gesture-icon" aria-hidden="true">👎</span><span class="gesture-action">Scroll down</span></li>
        <li><span class="gesture-icon" aria-hidden="true">✊</span><span class="gesture-action">Zoom in</span></li>
        <li><span class="gesture-icon" aria-hidden="true">🖐</span><span class="gesture-action">Zoom out</span></li>
      </ul>
    </section>
    <button id="save-log-btn" type="button" class="save-log-btn">Save session log for testing</button>
  </div>
`;
shadow.appendChild(overlay);

const dragHandle = shadow.getElementById("drag-handle");
const collapseBtn = shadow.getElementById("collapse-btn");
const toolbarStatus = shadow.getElementById("toolbar-status");
const previewEl = shadow.getElementById("preview");
const previewCtx = previewEl.getContext("2d");
const previewIdleLabel = shadow.getElementById("preview-idle-label");
previewCtx.fillStyle = "#000";
previewCtx.fillRect(0, 0, previewEl.width, previewEl.height);
const statusEl = shadow.getElementById("status");
const toggleBtn = shadow.getElementById("toggle-btn");
const saveLogBtn = shadow.getElementById("save-log-btn");

const STORAGE_KEY = "grn_ui";
let collapsed = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let isDragging = false;

function clampPosition(left, top) {
  const rect = overlay.getBoundingClientRect();
  const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
  const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
  return {
    left: Math.min(Math.max(8, left), maxLeft),
    top: Math.min(Math.max(8, top), maxTop),
  };
}

function applyPosition(left, top) {
  const next = clampPosition(left, top);
  overlay.style.right = "auto";
  overlay.style.bottom = "auto";
  overlay.style.left = `${next.left}px`;
  overlay.style.top = `${next.top}px`;
  return next;
}

function saveUiState() {
  const rect = overlay.getBoundingClientRect();
  chrome.storage.local.set({
    [STORAGE_KEY]: {
      left: rect.left,
      top: rect.top,
      collapsed,
    },
  });
}

function loadUiState() {
  chrome.storage.local.get(STORAGE_KEY, (result) => {
    const saved = result[STORAGE_KEY];
    if (saved && typeof saved.left === "number" && typeof saved.top === "number") {
      applyPosition(saved.left, saved.top);
    }
    if (saved?.collapsed) {
      setCollapsed(true);
    }
  });
}

function setCollapsed(next) {
  collapsed = next;
  overlay.classList.toggle("is-collapsed", collapsed);
  collapseBtn.setAttribute("aria-expanded", String(!collapsed));
  collapseBtn.setAttribute(
    "aria-label",
    collapsed ? "Expand panel" : "Minimize panel",
  );
  collapseBtn.title = collapsed ? "Expand" : "Minimize";
  saveUiState();
}

function updateToolbarStatus(text) {
  toolbarStatus.textContent = text;
}

collapseBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  setCollapsed(!collapsed);
});

collapseBtn.addEventListener("pointerdown", (event) => {
  event.stopPropagation();
});

dragHandle.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || event.target.closest(".collapse-btn")) return;
  isDragging = true;
  overlay.classList.add("is-dragging");
  const rect = overlay.getBoundingClientRect();
  if (overlay.style.left === "" && overlay.style.top === "") {
    applyPosition(rect.left, rect.top);
  }
  dragOffsetX = event.clientX - rect.left;
  dragOffsetY = event.clientY - rect.top;
  dragHandle.setPointerCapture(event.pointerId);
  event.preventDefault();
});

dragHandle.addEventListener("pointermove", (event) => {
  if (!isDragging) return;
  applyPosition(event.clientX - dragOffsetX, event.clientY - dragOffsetY);
});

function endDrag(event) {
  if (!isDragging) return;
  isDragging = false;
  overlay.classList.remove("is-dragging");
  saveUiState();
  if (event?.pointerId != null) {
    try {
      dragHandle.releasePointerCapture(event.pointerId);
    } catch (_) {
      /* ignore */
    }
  }
}

dragHandle.addEventListener("pointerup", endDrag);
dragHandle.addEventListener("pointercancel", endDrag);

loadUiState();

window.addEventListener("resize", () => {
  if (overlay.style.left !== "") {
    const rect = overlay.getBoundingClientRect();
    applyPosition(rect.left, rect.top);
  }
});

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;
let zoomLevel = 1;
let cameraOn = false;
let starting = false;

const runnerConfig = {
  wasmRoot: chrome.runtime.getURL("vendor/mediapipe/wasm"),
  modelUrl: chrome.runtime.getURL("vendor/mediapipe/gesture_recognizer.task"),
  visionBundleUrl: chrome.runtime.getURL("vendor/mediapipe/vision_bundle.mjs"),
};

function scrollByViewport(direction) {
  window.scrollBy({
    top: direction * window.innerHeight * 0.6,
    behavior: "smooth",
  });
}

function nudgeZoom(delta) {
  zoomLevel = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomLevel + delta));
  document.body.style.zoom = String(zoomLevel);
}

function runGestureAction(name) {
  switch (name) {
    case "Thumb_Up":
      scrollByViewport(-1);
      break;
    case "Thumb_Down":
      scrollByViewport(1);
      break;
    case "Closed_Fist":
      nudgeZoom(+ZOOM_STEP);
      break;
    case "Open_Palm":
      nudgeZoom(-ZOOM_STEP);
      break;
    default:
      break;
  }
}

let sessionLog = [];
let sessionStart = 0;
let participantId = "";

function resetLog() {
  sessionLog = [];
  sessionStart = performance.now();
}

function logEvent(evt) {
  if (!sessionStart) return;
  sessionLog.push({
    t_ms: Math.round(performance.now() - sessionStart),
    url: location.href,
    ...evt,
  });
}

function setStatus(text, tone = "active") {
  statusEl.textContent = text;
  statusEl.className = "status";
  if (tone === "idle") statusEl.classList.add("status--idle");
  else if (tone === "error") statusEl.classList.add("status--error");
  else statusEl.classList.add("status--active");
  updateToolbarStatus(text);
}

function showError(message) {
  setStatus(String(message).slice(0, 120), "error");
  console.error("[gesture-recipe-nav]", message);
}

function setCameraUi(on) {
  cameraOn = on;
  toggleBtn.textContent = on ? "Stop camera" : "Start camera";
  toggleBtn.dataset.state = on ? "on" : "off";
  previewIdleLabel.hidden = on;
  if (!on) {
    previewCtx.fillStyle = "#000";
    previewCtx.fillRect(0, 0, previewEl.width, previewEl.height);
    setStatus("Press Start to enable gestures", "idle");
  }
}

function sendBackground(type) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, config: runnerConfig }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response);
    });
  });
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== PAGE_SOURCE) return;

  if (data.type === "status") {
    setStatus(data.text, "active");
    return;
  }

  if (data.type === "started") {
    setCameraUi(true);
    return;
  }

  if (data.type === "stopped") {
    setCameraUi(false);
    return;
  }

  if (data.type === "error") {
    showError(data.message);
    setCameraUi(false);
    return;
  }

  if (data.type === "fire") {
    runGestureAction(data.gesture);
    logEvent({
      type: "fire",
      gesture: data.gesture,
      score: data.score,
      time: data.time,
    });
    return;
  }

  if (data.type === "preview" && data.bitmap) {
    previewIdleLabel.hidden = true;
    previewCtx.drawImage(data.bitmap, 0, 0, previewEl.width, previewEl.height);
    data.bitmap.close();
  }
});

function downloadLog() {
  if (!sessionLog.length && !confirm("Log is empty. Download anyway?")) {
    return;
  }
  if (!participantId) {
    participantId = prompt("Participant ID (used in filename):", "p1") || "anon";
  }
  const payload = {
    participant: participantId,
    page_url: location.href,
    session_start_iso: new Date(
      Date.now() - (performance.now() - sessionStart),
    ).toISOString(),
    duration_ms: sessionStart ? Math.round(performance.now() - sessionStart) : 0,
    fire_count: sessionLog.filter((e) => e.type === "fire").length,
    events: sessionLog,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `gesture-log-${participantId}-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

saveLogBtn.addEventListener("click", downloadLog);

toggleBtn.addEventListener("click", async () => {
  if (starting) return;

  if (cameraOn) {
    starting = true;
    toggleBtn.disabled = true;
    try {
      await sendBackground("grn-stop");
      setCameraUi(false);
    } catch (err) {
      showError(err);
    } finally {
      toggleBtn.disabled = false;
      starting = false;
    }
    return;
  }

  starting = true;
  toggleBtn.disabled = true;
  toggleBtn.textContent = "Loading…";
  setStatus("Loading camera and model…", "active");
  try {
    resetLog();
    await sendBackground("grn-start");
  } catch (err) {
    showError(err);
    setCameraUi(false);
  } finally {
    toggleBtn.disabled = false;
    starting = false;
  }
});
