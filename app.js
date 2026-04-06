const posterImage = document.getElementById("posterImage");
const posterFrame = document.getElementById("posterFrame");
const baseCanvas = document.getElementById("baseCanvas");
const effectCanvas = document.getElementById("effectCanvas");
const sampleCanvas = document.getElementById("sampleCanvas");
const inputVideo = document.getElementById("inputVideo");
const cameraButton = document.getElementById("cameraButton");
const debugButton = document.getElementById("debugButton");
const statusText = document.getElementById("statusText");

const baseContext = baseCanvas.getContext("2d");
const effectContext = effectCanvas.getContext("2d");
const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });

const flarePool = [];
const handPoints = [];
const pointerPoint = { x: 0.5, y: 0.5, active: false };
const textCanvas = document.createElement("canvas");
const graphicCanvas = document.createElement("canvas");
const textContext = textCanvas.getContext("2d");
const graphicContext = graphicCanvas.getContext("2d");

let lastTimestamp = 0;
let handsInstance = null;
let cameraInstance = null;
let detectionReady = false;
let handSeenAt = 0;

function resizeCanvas() {
  const bounds = posterFrame.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;

  baseCanvas.width = Math.round(bounds.width * scale);
  baseCanvas.height = Math.round(bounds.height * scale);
  baseCanvas.style.width = `${bounds.width}px`;
  baseCanvas.style.height = `${bounds.height}px`;
  baseContext.setTransform(scale, 0, 0, scale, 0, 0);

  effectCanvas.width = Math.round(bounds.width * scale);
  effectCanvas.height = Math.round(bounds.height * scale);
  effectCanvas.style.width = `${bounds.width}px`;
  effectCanvas.style.height = `${bounds.height}px`;
  effectContext.setTransform(scale, 0, 0, scale, 0, 0);

  drawBaseLayer();
}

function buildPosterLayers() {
  if (!posterImage.complete) {
    return;
  }

  const width = posterImage.naturalWidth;
  const height = posterImage.naturalHeight;
  sampleCanvas.width = width;
  sampleCanvas.height = height;
  textCanvas.width = width;
  textCanvas.height = height;
  graphicCanvas.width = width;
  graphicCanvas.height = height;
  sampleContext.clearRect(0, 0, width, height);
  sampleContext.drawImage(posterImage, 0, 0);
  const imageData = sampleContext.getImageData(0, 0, width, height);
  const textImage = new ImageData(width, height);
  const graphicImage = new ImageData(width, height);
  const pixels = imageData.data;
  const textPixels = textImage.data;
  const graphicPixels = graphicImage.data;
  const whiteMask = new Uint8Array(width * height);
  const integral = new Uint32Array((width + 1) * (height + 1));

  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const alpha = pixels[index + 3];
      const r = pixels[index];
      const g = pixels[index + 1];
      const b = pixels[index + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      const brightness = (r + g + b) / 3;
      const isWhite = alpha > 80 && brightness > 214 && saturation < 0.1;
      const maskValue = isWhite ? 1 : 0;
      whiteMask[y * width + x] = maskValue;
      rowSum += maskValue;
      integral[(y + 1) * (width + 1) + (x + 1)] = integral[y * (width + 1) + (x + 1)] + rowSum;
    }
  }

  for (let index = 0; index < pixels.length; index += 4) {
    const pixelIndex = index / 4;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    const alpha = pixels[index + 3];
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const brightness = (r + g + b) / 3;
    const radius = Math.max(10, Math.round(width / 55));
    const x0 = Math.max(0, x - radius);
    const y0 = Math.max(0, y - radius);
    const x1 = Math.min(width, x + radius + 1);
    const y1 = Math.min(height, y + radius + 1);
    const area = Math.max(1, (x1 - x0) * (y1 - y0));
    const whiteCount =
      integral[y1 * (width + 1) + x1] -
      integral[y0 * (width + 1) + x1] -
      integral[y1 * (width + 1) + x0] +
      integral[y0 * (width + 1) + x0];
    const density = whiteCount / area;
    let horizontalSpan = 0;
    let verticalSpan = 0;

    if (whiteMask[pixelIndex] === 1) {
      for (let offset = -3; offset <= 3; offset += 1) {
        const sampleX = x + offset;
        const sampleY = y + offset;

        if (sampleX >= 0 && sampleX < width) {
          horizontalSpan += whiteMask[y * width + sampleX];
        }

        if (sampleY >= 0 && sampleY < height) {
          verticalSpan += whiteMask[sampleY * width + x];
        }
      }
    }

    const compactStroke = horizontalSpan >= 3 && verticalSpan >= 3;
    const smallTextStroke = brightness > 228 && horizontalSpan >= 2 && verticalSpan >= 2;
    const denseTextBlock = density > 0.11;
    const isText = whiteMask[pixelIndex] === 1 && (denseTextBlock || compactStroke || smallTextStroke);
    const isGraphic = alpha > 80 && !isText && (saturation > 0.16 || brightness < 150);

    if (isText) {
      textPixels[index] = r;
      textPixels[index + 1] = g;
      textPixels[index + 2] = b;
      textPixels[index + 3] = alpha;
    }

    if (isGraphic) {
      graphicPixels[index] = r;
      graphicPixels[index + 1] = g;
      graphicPixels[index + 2] = b;
      graphicPixels[index + 3] = alpha;
    }
  }

  textContext.putImageData(textImage, 0, 0);
  graphicContext.putImageData(graphicImage, 0, 0);
}

function drawBaseLayer() {
  if (!posterImage.complete || textCanvas.width === 0) {
    return;
  }

  const bounds = posterFrame.getBoundingClientRect();
  const width = bounds.width;
  const height = bounds.height;

  baseContext.clearRect(0, 0, width, height);
  baseContext.fillStyle = "#050505";
  baseContext.fillRect(0, 0, width, height);
  baseContext.drawImage(textCanvas, 0, 0, width, height);
}

function updateHandPoints(results) {
  handPoints.length = 0;

  if (!results.multiHandLandmarks) {
    return;
  }

  for (const landmarks of results.multiHandLandmarks) {
    for (const landmark of landmarks) {
      handPoints.push({
        x: 1 - landmark.x,
        y: landmark.y
      });
    }
  }

  if (handPoints.length > 0) {
    handSeenAt = performance.now();
    statusText.textContent = "손이 감지되었습니다. 포스터 위에서 움직여 보세요.";
  }
}

function getInteractionPoints() {
  if (handPoints.length > 0) {
    return handPoints;
  }

  if (pointerPoint.active) {
    return [pointerPoint];
  }

  return [];
}

function setPointerFromEvent(event) {
  const bounds = posterFrame.getBoundingClientRect();
  pointerPoint.x = (event.clientX - bounds.left) / bounds.width;
  pointerPoint.y = (event.clientY - bounds.top) / bounds.height;
  pointerPoint.active =
    pointerPoint.x >= 0 &&
    pointerPoint.x <= 1 &&
    pointerPoint.y >= 0 &&
    pointerPoint.y <= 1;
}

function emitFlare(x, y, color) {
  flarePool.push({
    x,
    y,
    color,
    life: 1,
    size: 10 + Math.random() * 24
  });
}

function animate(timestamp) {
  const bounds = posterFrame.getBoundingClientRect();
  const width = bounds.width;
  const height = bounds.height;
  const delta = Math.min(0.05, (timestamp - lastTimestamp) / 1000 || 0.016);
  lastTimestamp = timestamp;
  const interactionPoints = getInteractionPoints();

  effectContext.clearRect(0, 0, width, height);
  effectContext.save();
  effectContext.globalCompositeOperation = "source-over";

  if (interactionPoints.length > 0) {
    effectContext.beginPath();

    for (const point of interactionPoints) {
      const px = point.x * width;
      const py = point.y * height;
      effectContext.moveTo(px + 130, py);
      effectContext.arc(px, py, 130, 0, Math.PI * 2);
      emitFlare(px, py, { r: 120, g: 220, b: 255 });
    }

    effectContext.clip();
    effectContext.drawImage(graphicCanvas, 0, 0, width, height);
  }

  effectContext.restore();
  effectContext.globalCompositeOperation = "screen";

  effectContext.shadowBlur = 0;

  for (let index = flarePool.length - 1; index >= 0; index -= 1) {
    const flare = flarePool[index];
    flare.life -= delta * 1.6;
    flare.size += delta * 38;

    if (flare.life <= 0) {
      flarePool.splice(index, 1);
      continue;
    }

    const gradient = effectContext.createRadialGradient(
      flare.x,
      flare.y,
      0,
      flare.x,
      flare.y,
      flare.size
    );
    gradient.addColorStop(0, `rgba(${flare.color.r}, ${flare.color.g}, ${flare.color.b}, ${flare.life * 0.45})`);
    gradient.addColorStop(0.35, `rgba(${flare.color.r}, ${flare.color.g}, ${flare.color.b}, ${flare.life * 0.16})`);
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    effectContext.fillStyle = gradient;
    effectContext.beginPath();
    effectContext.arc(flare.x, flare.y, flare.size, 0, Math.PI * 2);
    effectContext.fill();
  }

  effectContext.globalCompositeOperation = "source-over";
  requestAnimationFrame(animate);
}

async function startCamera() {
  if (!handsInstance || !cameraButton) {
    return;
  }

  cameraButton.disabled = true;
  statusText.textContent = "카메라를 연결하고 손을 인식하는 중입니다.";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    inputVideo.srcObject = stream;
    await inputVideo.play();

    cameraInstance = new Camera(inputVideo, {
      onFrame: async () => {
        if (!detectionReady) {
          return;
        }

        await handsInstance.send({ image: inputVideo });
      },
      width: 1280,
      height: 720
    });

    await cameraInstance.start();
    statusText.textContent = "카메라가 켜졌습니다. 손을 포스터 쪽으로 가져와 보세요.";

    window.setTimeout(() => {
      if (handSeenAt === 0) {
        statusText.textContent = "손 인식이 약하면 먼저 '마우스로 테스트'를 눌러 효과를 확인해 보세요.";
      }
    }, 3500);
  } catch (error) {
    statusText.textContent = "카메라 권한이 없거나 지원되지 않습니다. localhost 정적 서버에서 열어 주세요.";
    cameraButton.disabled = false;
    console.error(error);
  }
}

function setupHands() {
  if (!window.Hands) {
    statusText.textContent = "손 추적 라이브러리를 불러오지 못했습니다. 네트워크 연결을 확인해 주세요.";
    return;
  }

  handsInstance = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });

  handsInstance.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.65,
    minTrackingConfidence: 0.55
  });

  handsInstance.onResults((results) => {
    updateHandPoints(results);
  });

  detectionReady = true;
}

function init() {
  resizeCanvas();
  buildPosterLayers();
  drawBaseLayer();
  setupHands();
  requestAnimationFrame(animate);
}

window.addEventListener("resize", resizeCanvas);
cameraButton.addEventListener("click", startCamera);
debugButton.addEventListener("click", () => {
  pointerPoint.active = true;
  statusText.textContent = "마우스를 포스터 위에서 움직이면 픽셀이 반짝입니다.";
});
effectCanvas.addEventListener("pointermove", setPointerFromEvent);
effectCanvas.addEventListener("pointerenter", setPointerFromEvent);
effectCanvas.addEventListener("pointerleave", () => {
  pointerPoint.active = false;
});

if (posterImage.complete) {
  init();
} else {
  posterImage.addEventListener("load", init, { once: true });
}
