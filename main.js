import { initGestureNav } from "./gesture-nav.js";

const previewEl = document.getElementById("preview");
const statusEl = document.getElementById("status");
const toggleBtn = document.getElementById("toggle-btn");

/* -------------------------------------------------------------------------- */
/* Recipe interactions                                                        */
/* -------------------------------------------------------------------------- */

function scrollByViewport(direction) {
  window.scrollBy({
    top: direction * window.innerHeight * SCROLL_VIEWPORT_FRACTION,
    behavior: "smooth",
  });
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.08;
const SCROLL_VIEWPORT_FRACTION = 0.45;
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
        actions: {
          Thumb_Up: () => scrollByViewport(-1),
          Thumb_Down: () => scrollByViewport(1),
          Closed_Fist: {
            handler: () => nudgeZoom(+ZOOM_STEP),
            repeatOnHold: true,
            intervalMs: 350,
          },
          Open_Palm: {
            handler: () => nudgeZoom(-ZOOM_STEP),
            repeatOnHold: true,
            intervalMs: 350,
          },
        },
      });
    }
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
