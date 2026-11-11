# Real-time Webcam Background Blur with MediaPipe

A lightweight, static web application demonstrating real-time background blurring using Google's `@mediapipe/tasks-vision` ImageSegmenter API.

## Features

- **Google MediaPipe Image Segmenter**: Real-time segmentation running directly in the browser via WebAssembly.
- **Hardware Acceleration with Fallback**: Automatically requests GPU delegate (`WebGL`/`WebGPU`) and gracefully falls back to CPU if unsupported.
- **Local Model Serving**: Includes `selfie_segmenter.tflite` (~244 KB) locally for minimal latency and offline support.
- **Custom Blur Control**: Slider to adjust background blur intensity in real-time, plus a one-click toggle to enable/disable background blur.
- **Data Transfer Monitoring**: Real-time counter showing exact transferred network payload in megabytes (MB) using the browser's Performance API.

## Quick Start

You can run this project with any static file server:

```bash
# Using Python
python3 -m http.server 8080

# Or using npx serve
npx serve .
```

Open `http://localhost:8080` in any modern web browser (Chrome, Edge, Firefox, Safari) with camera permissions enabled.
