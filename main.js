import { initGestureNav } from "./gesture-nav.js";

const previewEl = document.getElementById("preview");
const statusEl = document.getElementById("status");
const toggleBtn = document.getElementById("toggle-btn");
const saveLogBtn = document.getElementById("save-log-btn");

/* -------------------------------------------------------------------------- */
/* Recipe interactions                                                        */
/* -------------------------------------------------------------------------- */

function scrollByViewport(direction) {
  window.scrollBy({
    top: direction * window.innerHeight * 0.6,
    behavior: "smooth",
  });
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;
let zoomLevel = 1;

function nudgeZoom(delta) {
  zoomLevel = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomLevel + delta));
  document.body.style.zoom = String(zoomLevel);
}

/* -------------------------------------------------------------------------- */
/* Active-step highlighting                                                   */
/*                                                                            */
/* Marks whichever recipe step is closest to the vertical center of the       */
/* viewport with .is-active. Helps test participants not lose their place     */
/* between gesture scrolls.                                                   */
/* -------------------------------------------------------------------------- */

const steps = Array.from(document.querySelectorAll(".step"));
let currentActiveStep = null;

function setActiveStep(el) {
  if (el === currentActiveStep) return;
  if (currentActiveStep) currentActiveStep.classList.remove("is-active");
  if (el) el.classList.add("is-active");
  currentActiveStep = el;
  if (el) {
    logEvent({ type: "step", step: Number(el.dataset.step) });
  }
}

const stepObserver = new IntersectionObserver(
  (entries) => {
    // Of all currently-intersecting steps, pick the one whose center is
    // nearest to the viewport center. Avoids flicker when two steps both
    // intersect the activation band.
    const intersecting = entries.filter((e) => e.isIntersecting);
    if (intersecting.length === 0) return;
    const viewportCenter = window.innerHeight / 2;
    let best = null;
    let bestDist = Infinity;
    for (const e of intersecting) {
      const rect = e.target.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      const dist = Math.abs(center - viewportCenter);
      if (dist < bestDist) {
        bestDist = dist;
        best = e.target;
      }
    }
    if (best) setActiveStep(best);
  },
  {
    // 40% activation band centered vertically in the viewport.
    rootMargin: "-30% 0px -30% 0px",
    threshold: 0,
  },
);

steps.forEach((el) => stepObserver.observe(el));

/* -------------------------------------------------------------------------- */
/* Session logging                                                            */
/*                                                                            */
/* In-memory log of every gesture fire + step change during a single camera   */
/* session. Reset on each Start. Downloadable as JSON via the overlay button. */
/* -------------------------------------------------------------------------- */

let sessionLog = [];
let sessionStart = 0;
let participantId = "";

function resetLog() {
  sessionLog = [];
  sessionStart = performance.now();
}

function logEvent(evt) {
  if (!sessionStart) return; // not in a session
  sessionLog.push({
    t_ms: Math.round(performance.now() - sessionStart),
    ...evt,
  });
}

function downloadLog() {
  if (!sessionLog.length) {
    if (!confirm("Log is empty. Download anyway?")) return;
  }
  if (!participantId) {
    participantId = prompt("Participant ID (used in filename):", "p1") || "anon";
  }
  const payload = {
    participant: participantId,
    session_start_iso: new Date(
      Date.now() - (performance.now() - sessionStart),
    ).toISOString(),
    duration_ms: Math.round(performance.now() - sessionStart),
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

/* -------------------------------------------------------------------------- */
/* Camera toggle                                                              */
/* -------------------------------------------------------------------------- */

let nav = null;
let starting = false;

toggleBtn.addEventListener("click", async () => {
  if (starting) return;
  if (nav && toggleBtn.dataset.state === "on") {
    nav.stop();
    toggleBtn.textContent = "Start camera";
    toggleBtn.dataset.state = "off";
    return;
  }

  starting = true;
  toggleBtn.disabled = true;
  toggleBtn.textContent = "Loading…";
  try {
    if (!nav) {
      nav = await initGestureNav({
        previewEl,
        statusEl,
        onEvent: logEvent,
        actions: {
          Thumb_Up: () => scrollByViewport(-1),
          Thumb_Down: () => scrollByViewport(1),
          Closed_Fist: {
            handler: () => nudgeZoom(+ZOOM_STEP),
            repeatOnHold: true,
            intervalMs: 250,
          },
          Open_Palm: {
            handler: () => nudgeZoom(-ZOOM_STEP),
            repeatOnHold: true,
            intervalMs: 250,
          },
        },
      });
    }
    resetLog();
    await nav.start();
    toggleBtn.textContent = "Stop camera";
    toggleBtn.dataset.state = "on";
  } catch (err) {
    console.error(err);
    toggleBtn.textContent = "Start camera";
    toggleBtn.dataset.state = "off";
  } finally {
    toggleBtn.disabled = false;
    starting = false;
  }
});
