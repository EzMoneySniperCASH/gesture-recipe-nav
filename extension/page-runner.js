/**
 * Runs MediaPipe in the page MAIN world so WASM can load via <script> tags.
 * Talks to the content-script overlay via window.postMessage.
 */
(function () {
  const SOURCE = "gesture-recipe-nav-page";
  const THRESHOLD = 0.7;
  const HOLD_FRAMES = 4;
  const COOLDOWN_MS = 700;
  const ZOOM_INTERVAL_MS = 250;

  const GESTURES = new Set([
    "Thumb_Up",
    "Thumb_Down",
    "Closed_Fist",
    "Open_Palm",
  ]);

  const LABELS = {
    Thumb_Up: "thumbs up",
    Thumb_Down: "thumbs down",
    Open_Palm: "open palm",
    Closed_Fist: "closed fist",
  };

  if (window.__GRN_ACTIVE__ || window.__GRN_BOOTING__) {
    post({ type: "error", message: "Gesture nav already running" });
    return;
  }
  window.__GRN_BOOTING__ = true;

  const cfg = window.__GRN_CONFIG__;
  if (!cfg?.wasmRoot || !cfg?.modelUrl || !cfg?.visionBundleUrl) {
    post({ type: "error", message: "Missing extension config" });
    return;
  }

  let running = false;
  let rafId = 0;
  let previewCanvas = null;
  let previewCtx = null;
  let previewPending = false;
  let stream = null;
  let video = null;
  let recognizer = null;
  let lastVideoTime = -1;
  let lastGesture = null;
  let gestureStreak = 0;
  const lastFireAt = new Map();

  window.addEventListener("grn-stop", () => {
    cleanup();
  });

  function post(data) {
    window.postMessage({ source: SOURCE, ...data }, "*");
  }

  function cleanup() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    if (video) {
      video.srcObject = null;
      video.remove();
      video = null;
    }
    previewCanvas = null;
    previewCtx = null;
    previewPending = false;
    recognizer = null;
    lastVideoTime = -1;
    lastGesture = null;
    gestureStreak = 0;
    lastFireAt.clear();
    window.__GRN_ACTIVE__ = false;
    window.__GRN_BOOTING__ = false;
    post({ type: "stopped" });
  }

  function ensureTrustedTypes() {
    if (!window.trustedTypes || window.trustedTypes.defaultPolicy) return;
    try {
      window.trustedTypes.createPolicy("grn-default", {
        createScriptURL: (url) => url,
        createScript: (script) => script,
      });
    } catch (_) {
      /* ignore */
    }
  }

  async function boot() {
    ensureTrustedTypes();
    post({ type: "status", text: "Loading model…" });

    const { GestureRecognizer, FilesetResolver } = await import(
      cfg.visionBundleUrl,
    );
    const fileset = await FilesetResolver.forVisionTasks(cfg.wasmRoot);
    recognizer = await GestureRecognizer.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: cfg.modelUrl },
      runningMode: "VIDEO",
      numHands: 1,
    });

    video = document.createElement("video");
    video.playsInline = true;
    video.muted = true;
    video.setAttribute("playsinline", "");
    video.style.cssText =
      "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;";
    document.documentElement.appendChild(video);

    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    previewCanvas = document.createElement("canvas");
    previewCanvas.width = 320;
    previewCanvas.height = 240;
    previewCtx = previewCanvas.getContext("2d");

    running = true;
    window.__GRN_ACTIVE__ = true;
    post({ type: "status", text: "Show a gesture…" });
    post({ type: "started" });
    loop();
  }

  function loop() {
    if (!running) return;
    rafId = requestAnimationFrame(loop);
    if (!video || video.readyState < 2) return;
    if (video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;

    let result;
    try {
      result = recognizer.recognizeForVideo(video, performance.now());
    } catch (err) {
      console.warn("[gesture-recipe-nav/page]", err);
      return;
    }

    handleResult(result);
    sendPreviewFrame();
  }

  async function sendPreviewFrame() {
    if (!running || !video || !previewCtx || previewPending || video.readyState < 2) {
      return;
    }
    previewPending = true;
    try {
      const w = previewCanvas.width;
      const h = previewCanvas.height;
      previewCtx.save();
      previewCtx.scale(-1, 1);
      previewCtx.drawImage(video, -w, 0, w, h);
      previewCtx.restore();
      const bitmap = await createImageBitmap(previewCanvas);
      window.postMessage({ source: SOURCE, type: "preview", bitmap }, "*", [bitmap]);
    } catch (_) {
      /* drop frame */
    } finally {
      previewPending = false;
    }
  }

  function handleResult(result) {
    const top = result?.gestures?.[0]?.[0];
    const name = top?.categoryName;

    if (!name || name === "None" || top.score < THRESHOLD || !GESTURES.has(name)) {
      lastGesture = null;
      gestureStreak = 0;
      post({
        type: "status",
        text: name && name !== "None" && top.score >= THRESHOLD ? `Detected ${label(name)}` : "Show a gesture…",
      });
      return;
    }

    if (name === lastGesture) {
      gestureStreak += 1;
    } else {
      lastGesture = name;
      gestureStreak = 1;
    }

    post({ type: "status", text: `Detected: ${label(name)}` });

    const now = performance.now();
    const lastFire = lastFireAt.get(name) ?? 0;
    const repeat = name === "Closed_Fist" || name === "Open_Palm";
    const interval = repeat ? ZOOM_INTERVAL_MS : COOLDOWN_MS;

    if (gestureStreak >= HOLD_FRAMES && now - lastFire >= interval) {
      lastFireAt.set(name, now);
      post({
        type: "fire",
        gesture: name,
        score: top.score,
        time: now,
      });
      if (!repeat) {
        gestureStreak = 0;
        lastGesture = null;
      }
    }
  }

  function label(name) {
    return LABELS[name] || name;
  }

  boot().catch((err) => {
    cleanup();
    post({ type: "error", message: err?.message || String(err) });
  });
})();
