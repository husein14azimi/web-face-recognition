import {
  FilesetResolver,
  ImageSegmenter,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";

// DOM Elements
const video = document.getElementById("webcam");
const canvas = document.getElementById("output-canvas");
const ctx = canvas.getContext("2d");
const toggleCameraBtn = document.getElementById("toggle-camera-btn");
const toggleCameraText = document.getElementById("toggle-camera-text");
const toggleBlurBtn = document.getElementById("toggle-blur-btn");
const toggleBlurText = document.getElementById("toggle-blur-text");
const blurRange = document.getElementById("blur-range");
const blurVal = document.getElementById("blur-val");
const statusOverlay = document.getElementById("status-overlay");
const statusMessage = document.getElementById("status-message");
const loadingSpinner = document.getElementById("loading-spinner");
const dataTransferredEl = document.getElementById("data-transferred");
const backendStatusEl = document.getElementById("backend-status");
const fpsCounterEl = document.getElementById("fps-counter");

// State
let imageSegmenter = null;
let isCameraActive = false;
let isBlurEnabled = true;
let blurRadius = 15;
let animationFrameId = null;
let lastVideoTime = -1;
let stream = null;

// FPS tracking
let frameCount = 0;
let lastFpsUpdateTime = performance.now();

// Offscreen canvases for fast compositing
let maskCanvas = document.createElement("canvas");
let maskCtx = maskCanvas.getContext("2d");
let blurredCanvas = document.createElement("canvas");
let blurredCtx = blurredCanvas.getContext("2d");

// Track data transfer
function updateDataTransferMetrics() {
  if (!window.performance || !performance.getEntriesByType) return;
  const resources = performance.getEntriesByType("resource");
  let totalBytes = 0;

  for (const res of resources) {
    if (res.transferSize && res.transferSize > 0) {
      totalBytes += res.transferSize;
    } else if (res.encodedBodySize && res.encodedBodySize > 0) {
      totalBytes += res.encodedBodySize;
    } else if (res.decodedBodySize && res.decodedBodySize > 0) {
      totalBytes += res.decodedBodySize;
    }
  }

  // Include navigation if available
  const navEntries = performance.getEntriesByType("navigation");
  if (navEntries && navEntries.length > 0) {
    const nav = navEntries[0];
    if (nav.transferSize) totalBytes += nav.transferSize;
  }

  const megabytes = (totalBytes / (1024 * 1024)).toFixed(2);
  dataTransferredEl.textContent = `${megabytes} MB`;
}

// Observe new network requests
if (window.PerformanceObserver) {
  try {
    const observer = new PerformanceObserver(() => {
      updateDataTransferMetrics();
    });
    observer.observe({ type: "resource", buffered: true });
  } catch (e) {
    console.warn("PerformanceObserver not supported or failed:", e);
  }
}
setInterval(updateDataTransferMetrics, 1000);

// Initialize MediaPipe Image Segmenter
async function initializeImageSegmenter() {
  try {
    statusMessage.textContent = "Loading MediaPipe WASM runtime...";
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );

    statusMessage.textContent = "Loading selfie segmentation model...";
    let delegate = "GPU";

    try {
      imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "selfie_segmenter.tflite",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });
      backendStatusEl.textContent = "GPU (WebGL/WebGPU)";
    } catch (gpuError) {
      console.warn("GPU delegate failed, falling back to CPU:", gpuError);
      imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "selfie_segmenter.tflite",
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });
      backendStatusEl.textContent = "CPU Fallback";
    }

    statusOverlay.classList.add("hidden");
    toggleCameraBtn.disabled = false;
    updateDataTransferMetrics();
  } catch (error) {
    console.error("Initialization error:", error);
    loadingSpinner.style.display = "none";
    statusMessage.textContent = `Error initializing MediaPipe: ${error.message}`;
    backendStatusEl.textContent = "Error";
  }
}

// Start Camera Stream
async function startCamera() {
  try {
    statusOverlay.classList.remove("hidden");
    loadingSpinner.style.display = "block";
    statusMessage.textContent = "Requesting camera access...";

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: "user",
      },
      audio: false,
    });

    video.srcObject = stream;
    await new Promise((resolve) => {
      video.onloadedmetadata = () => {
        video.play();
        resolve();
      };
    });

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    maskCanvas.width = canvas.width;
    maskCanvas.height = canvas.height;
    blurredCanvas.width = canvas.width;
    blurredCanvas.height = canvas.height;

    isCameraActive = true;
    toggleCameraText.textContent = "Stop Camera";
    toggleCameraBtn.classList.replace("btn-primary", "btn-secondary");
    toggleBlurBtn.disabled = false;
    statusOverlay.classList.add("hidden");

    renderLoop();
  } catch (err) {
    console.error("Camera access error:", err);
    statusOverlay.classList.remove("hidden");
    loadingSpinner.style.display = "none";
    statusMessage.textContent = `Camera error: ${err.name || err.message}`;
  }
}

// Stop Camera Stream
function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  isCameraActive = false;
  video.srcObject = null;
  toggleCameraText.textContent = "Start Camera";
  toggleCameraBtn.classList.replace("btn-secondary", "btn-primary");
  toggleBlurBtn.disabled = true;

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  fpsCounterEl.textContent = "0 FPS";
}

// Render Loop with Compositing
function renderLoop() {
  if (!isCameraActive) return;

  const now = performance.now();
  frameCount++;
  if (now - lastFpsUpdateTime >= 1000) {
    const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdateTime));
    fpsCounterEl.textContent = `${fps} FPS`;
    frameCount = 0;
    lastFpsUpdateTime = now;
  }

  if (video.readyState >= 2) {
    if (!isBlurEnabled) {
      // Just draw the plain webcam video
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    } else {
      // Process segmentation mask
      if (video.currentTime !== lastVideoTime && imageSegmenter) {
        lastVideoTime = video.currentTime;

        try {
          imageSegmenter.segmentForVideo(video, performance.now(), (result) => {
            const mask = result.categoryMask;
            if (mask) {
              const maskData = mask.getAsUint8Array();
              const maskWidth = mask.width;
              const maskHeight = mask.height;

              // Create ImageData for mask
              const maskImageData = maskCtx.createImageData(maskWidth, maskHeight);
              const data = maskImageData.data;

              for (let i = 0; i < maskData.length; i++) {
                // If mask value > 0 (person detected)
                const isPerson = maskData[i] > 0;
                const offset = i * 4;
                data[offset] = 255;
                data[offset + 1] = 255;
                data[offset + 2] = 255;
                data[offset + 3] = isPerson ? 255 : 0;
              }

              // Draw mask to maskCanvas
              maskCtx.putImageData(maskImageData, 0, 0);

              // 1. Draw blurred background to output canvas
              ctx.save();
              ctx.filter = `blur(${blurRadius}px)`;
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              ctx.restore();

              // 2. Prepare sharp person cutout using offscreen blurredCanvas as scratchpad
              blurredCtx.clearRect(0, 0, canvas.width, canvas.height);
              blurredCtx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);

              blurredCtx.globalCompositeOperation = "source-in";
              blurredCtx.drawImage(video, 0, 0, canvas.width, canvas.height);
              blurredCtx.globalCompositeOperation = "source-over";

              // 3. Composite sharp person on top of blurred canvas
              ctx.drawImage(blurredCanvas, 0, 0);

              mask.close();
            } else {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            }
          });
        } catch (err) {
          console.error("Segmentation error:", err);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        }
      }
    }
  }

  animationFrameId = requestAnimationFrame(renderLoop);
}

// Event Listeners
toggleCameraBtn.addEventListener("click", () => {
  if (isCameraActive) {
    stopCamera();
  } else {
    startCamera();
  }
});

toggleBlurBtn.addEventListener("click", () => {
  isBlurEnabled = !isBlurEnabled;
  if (isBlurEnabled) {
    toggleBlurText.textContent = "Disable Blur";
    toggleBlurBtn.classList.remove("btn-primary");
    toggleBlurBtn.classList.add("btn-secondary");
  } else {
    toggleBlurText.textContent = "Enable Blur";
    toggleBlurBtn.classList.remove("btn-secondary");
    toggleBlurBtn.classList.add("btn-primary");
  }
});

blurRange.addEventListener("input", (e) => {
  blurRadius = parseInt(e.target.value, 10);
  blurVal.textContent = `${blurRadius}px`;
});

// Start initialization
initializeImageSegmenter();
