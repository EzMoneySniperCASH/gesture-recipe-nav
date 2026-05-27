#!/usr/bin/env node
/**
 * Copies MediaPipe assets into extension/vendor/ so the unpacked extension
 * can load WASM and the gesture model without CDN requests (MV3 requirement).
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const root = path.resolve(__dirname, "..");
const pkgRoot = path.join(root, "node_modules", "@mediapipe", "tasks-vision");
const vendorRoot = path.join(root, "extension", "vendor", "mediapipe");
const modelUrl =
  "https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/gesture_recognizer.task";

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else copyFile(from, to);
  }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed (${res.statusCode}): ${url}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", reject);
  });
}

async function main() {
  if (!fs.existsSync(pkgRoot)) {
    console.error("Run npm install first (@mediapipe/tasks-vision).");
    process.exit(1);
  }

  fs.mkdirSync(vendorRoot, { recursive: true });
  copyFile(
    path.join(pkgRoot, "vision_bundle.mjs"),
    path.join(vendorRoot, "vision_bundle.mjs"),
  );
  copyDir(path.join(pkgRoot, "wasm"), path.join(vendorRoot, "wasm"));

  const modelPath = path.join(vendorRoot, "gesture_recognizer.task");
  const minModelBytes = 1024 * 1024;
  if (fs.existsSync(modelPath) && fs.statSync(modelPath).size >= minModelBytes) {
    console.log("Model already present, skipping download.");
  } else {
    if (fs.existsSync(modelPath)) fs.unlinkSync(modelPath);
    await download(modelUrl, modelPath);
  }
  console.log("Extension vendor assets ready in extension/vendor/mediapipe/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
