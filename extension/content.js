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
    <section class="settings" aria-label="Scroll and zoom sensitivity">
      <h3 class="settings-title">Adjust speed</h3>
      <label class="setting-row">
        <span class="setting-label">Scroll distance</span>
        <input id="scroll-sensitivity" type="range" min="1" max="5" step="1" value="3" />
        <span id="scroll-hint" class="setting-hint">Medium</span>
      </label>
      <label class="setting-row">
        <span class="setting-label">Zoom amount</span>
        <input id="zoom-sensitivity" type="range" min="1" max="5" step="1" value="3" />
        <span id="zoom-hint" class="setting-hint">Medium</span>
      </label>
      <label class="setting-row">
        <span class="setting-label">Zoom speed</span>
        <input id="zoom-speed-sensitivity" type="range" min="1" max="5" step="1" value="3" />
        <span id="zoom-speed-hint" class="setting-hint">Medium</span>
      </label>
    </section>
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
const scrollSlider = shadow.getElementById("scroll-sensitivity");
const zoomSlider = shadow.getElementById("zoom-sensitivity");
const zoomSpeedSlider = shadow.getElementById("zoom-speed-sensitivity");
const scrollHint = shadow.getElementById("scroll-hint");
const zoomHint = shadow.getElementById("zoom-hint");
const zoomSpeedHint = shadow.getElementById("zoom-speed-hint");

const STORAGE_KEY = "grn_ui";
const SENSITIVITY_KEY = "grn_sensitivity";

const SENSITIVITY_LABELS = ["Less", "Light", "Medium", "Strong", "More"];
const SCROLL_FRACTIONS = [0.3, 0.38, 0.45, 0.52, 0.6];
const ZOOM_STEPS = [0.05, 0.065, 0.08, 0.095, 0.11];
const ZOOM_INTERVALS_MS = [500, 425, 350, 300, 250];
const SCROLL_COOLDOWNS_MS = [950, 875, 800, 750, 700];

const DEFAULT_SENSITIVITY = {
  scroll: 3,
  zoom: 3,
  zoomSpeed: 3,
};

let sensitivity = { ...DEFAULT_SENSITIVITY };
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
let zoomLevel = 1;
let cameraOn = false;
let starting = false;

function levelIndex(level) {
  return Math.min(5, Math.max(1, level)) - 1;
}

function getSensitivityValues() {
  return {
    scrollFraction: SCROLL_FRACTIONS[levelIndex(sensitivity.scroll)],
    zoomStep: ZOOM_STEPS[levelIndex(sensitivity.zoom)],
    zoomIntervalMs: ZOOM_INTERVALS_MS[levelIndex(sensitivity.zoomSpeed)],
    scrollCooldownMs: SCROLL_COOLDOWNS_MS[levelIndex(sensitivity.scroll)],
  };
}

function updateSensitivityHints() {
  scrollHint.textContent = SENSITIVITY_LABELS[sensitivity.scroll - 1];
  zoomHint.textContent = SENSITIVITY_LABELS[sensitivity.zoom - 1];
  zoomSpeedHint.textContent = SENSITIVITY_LABELS[sensitivity.zoomSpeed - 1];
}

function applySensitivityFromSliders() {
  sensitivity = {
    scroll: Number(scrollSlider.value),
    zoom: Number(zoomSlider.value),
    zoomSpeed: Number(zoomSpeedSlider.value),
  };
  updateSensitivityHints();
  chrome.storage.local.set({ [SENSITIVITY_KEY]: sensitivity });
  pushSettingsToRunner();
}

function loadSensitivity() {
  chrome.storage.local.get(SENSITIVITY_KEY, (result) => {
    const saved = result[SENSITIVITY_KEY];
    if (saved) {
      sensitivity = { ...DEFAULT_SENSITIVITY, ...saved };
    }
    scrollSlider.value = String(sensitivity.scroll);
    zoomSlider.value = String(sensitivity.zoom);
    zoomSpeedSlider.value = String(sensitivity.zoomSpeed);
    updateSensitivityHints();
  });
}

function pushSettingsToRunner() {
  if (!cameraOn) return;
  const values = getSensitivityValues();
  window.postMessage(
    {
      source: "gesture-recipe-nav-cmd",
      type: "update-sensitivity",
      scrollCooldownMs: values.scrollCooldownMs,
      zoomIntervalMs: values.zoomIntervalMs,
    },
    "*",
  );
}

function buildRunnerConfig() {
  const values = getSensitivityValues();
  return {
    wasmRoot: chrome.runtime.getURL("vendor/mediapipe/wasm"),
    modelUrl: chrome.runtime.getURL("vendor/mediapipe/gesture_recognizer.task"),
    visionBundleUrl: chrome.runtime.getURL("vendor/mediapipe/vision_bundle.mjs"),
    sensitivity: values,
  };
}

scrollSlider.addEventListener("input", applySensitivityFromSliders);
zoomSlider.addEventListener("input", applySensitivityFromSliders);
zoomSpeedSlider.addEventListener("input", applySensitivityFromSliders);
loadSensitivity();

function scrollByViewport(direction) {
  const { scrollFraction } = getSensitivityValues();
  window.scrollBy({
    top: direction * window.innerHeight * scrollFraction,
    behavior: "smooth",
  });
}

function nudgeZoom(delta) {
  zoomLevel = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomLevel + delta));
  document.body.style.zoom = String(zoomLevel);
}

function runGestureAction(name) {
  const { zoomStep } = getSensitivityValues();
  switch (name) {
    case "Thumb_Up":
      scrollByViewport(-1);
      break;
    case "Thumb_Down":
      scrollByViewport(1);
      break;
    case "Closed_Fist":
      nudgeZoom(+zoomStep);
      break;
    case "Open_Palm":
      nudgeZoom(-zoomStep);
      break;
    default:
      break;
  }
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
    chrome.runtime.sendMessage(
      { type, config: buildRunnerConfig() },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response);
      },
    );
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
    return;
  }

  if (data.type === "preview" && data.bitmap) {
    previewIdleLabel.hidden = true;
    previewCtx.drawImage(data.bitmap, 0, 0, previewEl.width, previewEl.height);
    data.bitmap.close();
  }
});

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
    await sendBackground("grn-start");
  } catch (err) {
    showError(err);
    setCameraUi(false);
  } finally {
    toggleBtn.disabled = false;
    starting = false;
    if (!cameraOn) {
      toggleBtn.textContent = "Start camera";
      toggleBtn.dataset.state = "off";
    }
  }
});
