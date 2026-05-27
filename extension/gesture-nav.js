/**
 * Extension build of gesture-nav.js — same API as the demo, but loads
 * MediaPipe assets from the extension package (required for Manifest V3).
 */

import {
  GestureRecognizer,
  FilesetResolver,
} from "./vendor/mediapipe/vision_bundle.mjs";

const WASM_ROOT = chrome.runtime.getURL("vendor/mediapipe/wasm");
const MODEL_URL = chrome.runtime.getURL(
  "vendor/mediapipe/gesture_recognizer.task",
);

/**
 * MediaPipe normally loads WASM by injecting a <script> into the page. In a
 * Chrome extension content script that runs in an isolated world, that script
 * executes in the page context instead — so self.ModuleFactory is never set
 * and createFromOptions throws "ModuleFactory not set."
 *
 * Fetch the loader and eval it here so ModuleFactory lands in the content
 * script's global scope, then drop wasmLoaderPath so MediaPipe skips re-load.
 */
async function prepareVisionFileset(wasmRoot) {
  const fileset = await FilesetResolver.forVisionTasks(wasmRoot);
  const response = await fetch(fileset.wasmLoaderPath);
  if (!response.ok) {
    throw new Error(`WASM loader fetch failed (${response.status})`);
  }
  (0, eval)(await response.text());
  if (!globalThis.ModuleFactory) {
    throw new Error("WASM loader did not set ModuleFactory");
  }
  delete fileset.wasmLoaderPath;
  return fileset;
}

const DEFAULTS = {
  threshold: 0.7,
  holdFrames: 4,
  cooldownMs: 700,
  actions: {},
  onStateChange: () => {},
  onEvent: () => {},
};

const GESTURE_LABELS = {
  Thumb_Up: "thumbs up",
  Thumb_Down: "thumbs down",
  Open_Palm: "open palm",
  Closed_Fist: "closed fist",
  Pointing_Up: "pointing up",
  Victory: "peace sign",
  ILoveYou: "I love you",
};

export async function initGestureNav(userOpts = {}) {
  const opts = { ...DEFAULTS, ...userOpts };

  let video = opts.previewEl;
  if (!video) {
    video = document.createElement("video");
    video.style.display = "none";
    document.body.appendChild(video);
  }
  video.playsInline = true;
  video.muted = true;

  setStatus(opts, "Loading model…");
  opts.onStateChange("loading");

  const fileset = await prepareVisionFileset(WASM_ROOT);
  const recognizer = await GestureRecognizer.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL },
    runningMode: "VIDEO",
    numHands: 1,
  });

  let stream = null;
  let rafId = 0;
  let lastVideoTime = -1;
  let running = false;

  let lastGesture = null;
  let gestureStreak = 0;
  const lastFireAt = new Map();

  setStatus(opts, "Ready. Press Start.");
  opts.onStateChange("ready");

  async function start() {
    if (running) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      const msg = "Camera API unavailable in this browser.";
      setStatus(opts, msg);
      opts.onStateChange("error");
      throw new Error(msg);
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
    } catch (err) {
      setStatus(opts, "Camera blocked: " + (err?.message || err));
      opts.onStateChange("error");
      throw err;
    }
    video.srcObject = stream;
    await video.play();

    running = true;
    lastGesture = null;
    gestureStreak = 0;
    lastFireAt.clear();
    setStatus(opts, "Show a gesture…");
    opts.onStateChange("running");
    loop();
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    video.srcObject = null;
    lastVideoTime = -1;
    setStatus(opts, "Camera off");
    opts.onStateChange("stopped");
  }

  function loop() {
    if (!running) return;
    rafId = requestAnimationFrame(loop);
    if (video.readyState < 2) return;
    if (video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;

    let result;
    try {
      result = recognizer.recognizeForVideo(video, performance.now());
    } catch (err) {
      console.warn("[gesture-nav] recognizeForVideo failed:", err);
      return;
    }

    handleResult(result);
  }

  function handleResult(result) {
    const top = result?.gestures?.[0]?.[0];
    const name = top?.categoryName;
    const action = name ? normalizeAction(opts.actions[name]) : null;

    if (!name || name === "None" || top.score < opts.threshold || !action) {
      lastGesture = null;
      gestureStreak = 0;
      if (name && name !== "None" && top.score >= opts.threshold) {
        setStatus(opts, `Detected ${labelFor(name)} (no action bound)`);
      } else {
        setStatus(opts, "Show a gesture…");
      }
      return;
    }

    if (name === lastGesture) {
      gestureStreak += 1;
    } else {
      lastGesture = name;
      gestureStreak = 1;
    }

    setStatus(opts, `Detected: ${labelFor(name)}`);

    const now = performance.now();
    const lastFire = lastFireAt.get(name) ?? 0;
    const interval = action.repeatOnHold
      ? (action.intervalMs ?? opts.cooldownMs)
      : opts.cooldownMs;
    if (gestureStreak >= opts.holdFrames && now - lastFire >= interval) {
      lastFireAt.set(name, now);
      try {
        action.handler();
      } catch (err) {
        console.error("[gesture-nav] action threw:", err);
      }
      try {
        opts.onEvent({ type: "fire", gesture: name, score: top.score, time: now });
      } catch (err) {
        console.error("[gesture-nav] onEvent threw:", err);
      }
      if (!action.repeatOnHold) {
        gestureStreak = 0;
        lastGesture = null;
      }
    }
  }

  return { start, stop };
}

function normalizeAction(action) {
  if (!action) return null;
  if (typeof action === "function") {
    return { handler: action, repeatOnHold: false, intervalMs: null };
  }
  if (typeof action === "object" && typeof action.handler === "function") {
    return {
      handler: action.handler,
      repeatOnHold: !!action.repeatOnHold,
      intervalMs: typeof action.intervalMs === "number" ? action.intervalMs : null,
    };
  }
  return null;
}

function labelFor(name) {
  return GESTURE_LABELS[name] || name;
}

function setStatus(opts, text) {
  if (opts.statusEl) opts.statusEl.textContent = text;
}
