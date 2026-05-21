/**
 * gesture-nav.js
 * -----------------------------------------------------------------------------
 * Drop-in hands-free navigation widget powered by MediaPipe's Gesture
 * Recognizer. You hand it a map of gesture-name -> callback, it watches the
 * webcam, and fires callbacks when the user holds the gesture steadily.
 *
 * Built-in gesture names you can use as keys (see MediaPipe canned gestures):
 *   "Thumb_Up", "Thumb_Down", "Open_Palm", "Closed_Fist",
 *   "Pointing_Up", "Victory", "ILoveYou"
 *
 * Usage:
 *
 *   import { initGestureNav } from "./gesture-nav.js";
 *
 *   const nav = await initGestureNav({
 *     previewEl: document.querySelector("#preview"), // optional <video>
 *     statusEl:  document.querySelector("#status"),  // optional element for live text
 *     threshold:  0.7,    // min gesture score to consider (0..1)
 *     holdFrames: 4,      // consecutive frames in same gesture before firing
 *     cooldownMs: 700,    // min ms between two fires of the SAME gesture
 *     actions: {
 *       // Simple form: fires once per hand-up, must release to fire again.
 *       Thumb_Up:   () => window.scrollBy({ top: -window.innerHeight * 0.6, behavior: "smooth" }),
 *       Thumb_Down: () => window.scrollBy({ top:  window.innerHeight * 0.6, behavior: "smooth" }),
 *       // Object form: enables auto-repeat while the gesture is held.
 *       Closed_Fist: { handler: () => zoom(+0.1), repeatOnHold: true, intervalMs: 250 },
 *     },
 *     onStateChange: (state) => {}, // "loading" | "ready" | "running" | "stopped" | "error"
 *   });
 *
 *   await nav.start();
 *   nav.stop();
 *
 * All inference runs locally in the browser via WASM — the camera feed never
 * leaves the device. Requires a secure context (https:// or http://localhost
 * or http://127.0.0.1) because of getUserMedia.
 * -----------------------------------------------------------------------------
 */

import {
  GestureRecognizer,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM_ROOT =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/gesture_recognizer.task";

const DEFAULTS = {
  threshold: 0.7,
  holdFrames: 4,
  cooldownMs: 700,
  actions: {},
  onStateChange: () => {},
  // Fires for notable gesture events. Currently:
  //   { type: "fire", gesture, score, time }  -- an action handler ran
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

  warnIfInsecureContext();

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

  const fileset = await FilesetResolver.forVisionTasks(WASM_ROOT);
  const recognizer = await GestureRecognizer.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL },
    runningMode: "VIDEO",
    numHands: 1,
  });

  let stream = null;
  let rafId = 0;
  let lastVideoTime = -1;
  let running = false;

  // Debounce/cooldown state.
  let lastGesture = null;
  let gestureStreak = 0;
  const lastFireAt = new Map(); // gesture name -> timestamp ms

  setStatus(opts, "Ready. Press Start.");
  opts.onStateChange("ready");

  async function start() {
    if (running) return;

    // navigator.mediaDevices is only exposed in a "secure context".
    // localhost / 127.0.0.1 count, but http://[::]:PORT (IPv6 wildcard
    // that Python's http.server prints by default) does NOT in Safari.
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const insecure = !window.isSecureContext;
      const msg = insecure
        ? `Camera API unavailable: open this page on https:// or http://localhost (current: ${location.origin}).`
        : "Camera API unavailable: this browser does not support mediaDevices.getUserMedia.";
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
    if (video.readyState < 2) return; // HAVE_CURRENT_DATA
    if (video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;

    let result;
    try {
      result = recognizer.recognizeForVideo(video, performance.now());
    } catch (err) {
      // Recognizer can throw if the video frame isn't ready yet; skip the frame.
      console.warn("recognizeForVideo failed:", err);
      return;
    }

    handleResult(result);
  }

  function handleResult(result) {
    const top = result?.gestures?.[0]?.[0];
    const name = top?.categoryName;
    const action = name ? normalizeAction(opts.actions[name]) : null;

    // Reject if no gesture, "None", below threshold, or not in our action map.
    if (!name || name === "None" || top.score < opts.threshold || !action) {
      lastGesture = null;
      gestureStreak = 0;
      if (name && name !== "None" && top.score >= opts.threshold) {
        // Detected something we know but isn't bound — give a hint.
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
        // Fire-once mode: require the user to release before firing again.
        gestureStreak = 0;
        lastGesture = null;
      }
      // Repeat-on-hold mode: keep streak/lastGesture so the next eligible
      // frame fires again after `interval` ms have elapsed.
    }
  }

  return { start, stop };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Accept either `() => {}` or `{ handler, repeatOnHold?, intervalMs? }`.
 * Returns a uniform `{ handler, repeatOnHold, intervalMs }` or `null` for
 * anything we don't recognize.
 */
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

let warnedInsecure = false;
function warnIfInsecureContext() {
  if (warnedInsecure) return;
  warnedInsecure = true;
  if (typeof window === "undefined") return;
  const ok =
    window.isSecureContext ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";
  if (!ok) {
    console.warn(
      "[gesture-nav] getUserMedia requires https:// or http://localhost. " +
        "Current origin:",
      location.origin,
    );
  }
}
