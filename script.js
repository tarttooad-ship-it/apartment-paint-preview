const canvas = document.querySelector("#previewCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const uploadInput = document.querySelector("#uploadInput");
const colorInput = document.querySelector("#paintColor");
const fillTolerance = document.querySelector("#fillTolerance");
const fillToleranceValue = document.querySelector("#fillToleranceValue");
const zoomLevel = document.querySelector("#zoomLevel");
const zoomLevelValue = document.querySelector("#zoomLevelValue");
const blendStrength = document.querySelector("#blendStrength");
const blendStrengthValue = document.querySelector("#blendStrengthValue");
const edgeAssist = document.querySelector("#edgeAssist");
const autoMaskButton = document.querySelector("#autoMaskButton");
const undoButton = document.querySelector("#undoButton");
const clearMaskButton = document.querySelector("#clearMaskButton");
const sampleButton = document.querySelector("#sampleButton");
const downloadButton = document.querySelector("#downloadButton");
const addZoneButton = document.querySelector("#addZoneButton");
const zoneList = document.querySelector("#zoneList");
const swatches = [...document.querySelectorAll(".swatch")];

const sourceImage = new Image();
const defaultZoneColors = ["#8f9691", "#c7c1af", "#cbd7d1", "#6e7b80", "#dde2df"];

let baseImageData = null;
let zones = [];
let activeZoneId = null;
let history = [];
let pointerStart = null;
let isSingleView = false;

sourceImage.onload = () => {
  fitCanvasToImage();
  resetZones();
  render();
};
sourceImage.src = "assets/demo-apartment.png";

function fitCanvasToImage() {
  isSingleView = window.matchMedia("(max-width: 760px)").matches;
  const maxWidth = isSingleView ? 960 : 1440;
  const ratio = sourceImage.naturalWidth / sourceImage.naturalHeight;
  const panelWidth = Math.min(isSingleView ? maxWidth : Math.floor(maxWidth / 2), sourceImage.naturalWidth);
  const width = isSingleView ? panelWidth : panelWidth * 2;
  const height = Math.round(panelWidth / ratio);
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(sourceImage, 0, 0, panelWidth, height);
  if (!isSingleView) ctx.drawImage(sourceImage, panelWidth, 0, panelWidth, height);
  baseImageData = ctx.getImageData(0, 0, width, height);
}

function createMaskCanvas() {
  const mask = document.createElement("canvas");
  mask.width = canvas.width;
  mask.height = canvas.height;
  return mask;
}

function createZone(name, color = defaultZoneColors[zones.length % defaultZoneColors.length]) {
  const canvasMask = createMaskCanvas();
  return {
    id: makeId(),
    name,
    color,
    canvas: canvasMask,
    ctx: canvasMask.getContext("2d", { willReadFrequently: true })
  };
}

function makeId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `zone-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function resetZones() {
  history = [];
  zones = [createZone("구역 1", "#8f9691"), createZone("구역 2", "#c7c1af")];
  activeZoneId = zones[0].id;
  syncActiveZoneControls();
  renderZoneList();
}

function activeZone() {
  return zones.find((zone) => zone.id === activeZoneId) || zones[0];
}

function saveHistory() {
  history.push({
    activeZoneId,
    zones: zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      color: zone.color,
      mask: zone.ctx.getImageData(0, 0, canvas.width, canvas.height)
    }))
  });
  if (history.length > 25) history.shift();
}

function restoreHistory(state) {
  zones = state.zones.map((item) => {
    const mask = createMaskCanvas();
    const maskCtx = mask.getContext("2d", { willReadFrequently: true });
    maskCtx.putImageData(item.mask, 0, 0);
    return { id: item.id, name: item.name, color: item.color, canvas: mask, ctx: maskCtx };
  });
  activeZoneId = state.activeZoneId;
  syncActiveZoneControls();
  renderZoneList();
  render();
}

function syncActiveZoneControls() {
  const zone = activeZone();
  if (!zone) return;
  colorInput.value = zone.color;
}

function renderZoneList() {
  zoneList.innerHTML = "";
  zones.forEach((zone) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `zone-item${zone.id === activeZoneId ? " is-active" : ""}`;
    button.dataset.zoneId = zone.id;
    button.innerHTML = `<span class="zone-chip" style="--zone-color: ${zone.color}"></span><span>${zone.name}</span>`;
    button.addEventListener("click", () => {
      activeZoneId = zone.id;
      syncActiveZoneControls();
      renderZoneList();
      render();
    });
    zoneList.appendChild(button);
  });
}

function getPointerPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height
  };
}

function afterSidePoint(point) {
  if (isSingleView) return point;
  const split = canvas.width / 2;
  if (point.x < split) return { x: point.x + split, y: point.y };
  return point;
}

function editableStartX() {
  return isSingleView ? 0 : Math.floor(canvas.width / 2);
}

function fillConnectedSurface(point) {
  const zone = activeZone();
  if (!zone || !baseImageData) return;

  const width = canvas.width;
  const height = canvas.height;
  const split = editableStartX();
  const seedX = Math.max(split, Math.min(width - 1, Math.round(point.x)));
  const seedY = Math.max(0, Math.min(height - 1, Math.round(point.y)));
  const seedIndex = (seedY * width + seedX) * 4;
  const source = baseImageData.data;
  const seed = {
    r: source[seedIndex],
    g: source[seedIndex + 1],
    b: source[seedIndex + 2],
    lum: luminance(source, seedIndex),
    sat: saturation(source, seedIndex)
  };
  const tolerance = Number(fillTolerance.value);
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const mask = zone.ctx.getImageData(0, 0, width, height);
  let head = 0;
  let tail = 0;

  queue[tail++] = seedY * width + seedX;
  visited[seedY * width + seedX] = 1;

  while (head < tail) {
    const pixel = queue[head++];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const i = pixel * 4;
    if (!isSimilarSurface(source, i, seed, tolerance)) continue;

    mask.data[i] = 255;
    mask.data[i + 1] = 255;
    mask.data[i + 2] = 255;
    mask.data[i + 3] = 220;

    addNeighbor(x + 1, y);
    addNeighbor(x - 1, y);
    addNeighbor(x, y + 1);
    addNeighbor(x, y - 1);
  }

  if (edgeAssist.checked) softenMask(mask, width, height, split);
  zone.ctx.putImageData(mask, 0, 0);
  render();

  function addNeighbor(x, y) {
    if (x < split || x >= width || y < 0 || y >= height) return;
    const pixel = y * width + x;
    if (visited[pixel]) return;
    visited[pixel] = 1;
    queue[tail++] = pixel;
  }
}

function isSimilarSurface(data, index, seed, tolerance) {
  const r = data[index];
  const g = data[index + 1];
  const b = data[index + 2];
  const dr = r - seed.r;
  const dg = g - seed.g;
  const db = b - seed.b;
  const colorDistance = Math.sqrt(dr * dr * 0.35 + dg * dg * 0.45 + db * db * 0.2);
  const lumDistance = Math.abs(luminance(data, index) - seed.lum);
  const satDistance = Math.abs(saturation(data, index) - seed.sat) * 100;
  return colorDistance <= tolerance * 1.35 && lumDistance <= tolerance * 1.1 && satDistance <= tolerance * 0.7;
}

function refinedMaskData(zone) {
  const mask = zone.ctx.getImageData(0, 0, canvas.width, canvas.height);
  if (!edgeAssist.checked || !baseImageData) return mask;

  const data = mask.data;
  const source = baseImageData.data;
  const copy = new Uint8ClampedArray(data);
  const width = mask.width;
  const height = mask.height;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = (y * width + x) * 4;
      if (copy[i + 3] > 10) continue;

      let nearbyMask = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (ox === 0 && oy === 0) continue;
          nearbyMask = Math.max(nearbyMask, copy[((y + oy) * width + x + ox) * 4 + 3]);
        }
      }

      if (nearbyMask < 100) continue;

      const left = luminance(source, i - 4);
      const right = luminance(source, i + 4);
      const up = luminance(source, i - width * 4);
      const down = luminance(source, i + width * 4);
      const edge = Math.abs(left - right) + Math.abs(up - down);
      if (edge < 42) data[i + 3] = Math.round(nearbyMask * 0.45);
    }
  }

  return mask;
}

function luminance(data, index) {
  return data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
}

function saturation(data, index) {
  const r = data[index] / 255;
  const g = data[index + 1] / 255;
  const b = data[index + 2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function render() {
  if (!baseImageData) return;
  const width = canvas.width;
  const result = new ImageData(new Uint8ClampedArray(baseImageData.data), width, canvas.height);
  const strength = Number(blendStrength.value) / 100;
  const split = editableStartX();

  zones.forEach((zone) => {
    const mask = refinedMaskData(zone).data;
    const paint = hexToRgb(zone.color);
    for (let i = 0; i < result.data.length; i += 4) {
      const pixel = i / 4;
      const x = pixel % width;
      if (x < split) continue;

      const alpha = (mask[i + 3] / 255) * strength;
      if (alpha <= 0) continue;

      const shade = Math.max(0.45, Math.min(1.45, luminance(baseImageData.data, i) / 150));
      result.data[i] = mix(result.data[i], paint.r * shade, alpha);
      result.data[i + 1] = mix(result.data[i + 1], paint.g * shade, alpha);
      result.data[i + 2] = mix(result.data[i + 2], paint.b * shade, alpha);
    }
  });

  ctx.putImageData(result, 0, 0);
  drawMaskOverlay(split);
  if (!isSingleView) drawDivider(split);
}

function drawMaskOverlay(split) {
  const overlayCanvas = document.createElement("canvas");
  overlayCanvas.width = canvas.width;
  overlayCanvas.height = canvas.height;
  const overlayCtx = overlayCanvas.getContext("2d");
  const overlay = overlayCtx.createImageData(canvas.width, canvas.height);

  zones.forEach((zone) => {
    const mask = zone.ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const color = hexToRgb(zone.color);
    const alpha = zone.id === activeZoneId ? 48 : 24;
    for (let i = 0; i < mask.length; i += 4) {
      const x = (i / 4) % canvas.width;
      if (x < split || mask[i + 3] < 10) continue;
      overlay.data[i] = color.r;
      overlay.data[i + 1] = color.g;
      overlay.data[i + 2] = color.b;
      overlay.data[i + 3] = Math.max(overlay.data[i + 3], alpha);
    }
  });

  overlayCtx.putImageData(overlay, 0, 0);
  ctx.drawImage(overlayCanvas, 0, 0);
}

function drawDivider(x) {
  ctx.save();
  ctx.strokeStyle = "rgba(25, 32, 35, 0.82)";
  ctx.lineWidth = Math.max(2, canvas.width / 480);
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, canvas.height);
  ctx.stroke();
  ctx.restore();
}

function mix(base, target, alpha) {
  return Math.round(base * (1 - alpha) + target * alpha);
}

function autoSelectFacade() {
  const zone = activeZone();
  if (!zone || !baseImageData) return;
  saveHistory();
  zone.ctx.clearRect(0, 0, canvas.width, canvas.height);

  const width = canvas.width;
  const height = canvas.height;
  const split = editableStartX();
  const mask = zone.ctx.createImageData(width, height);
  const source = baseImageData.data;

  for (let y = 0; y < height; y += 1) {
    for (let x = split; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = source[i];
      const g = source[i + 1];
      const b = source[i + 2];
      const lum = luminance(source, i);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      const blueSky = b > r + 16 && b > g + 8 && sat > 0.18 && lum > 115;
      const vegetation = g > r + 14 && g > b + 4 && sat > 0.22 && lum < 145;
      const windowOrShadow = lum < 76 || (sat < 0.18 && lum < 104);
      const facadeTone = lum > 92 && lum < 232 && sat < 0.42;

      if (facadeTone && !blueSky && !vegetation && !windowOrShadow) {
        mask.data[i] = 255;
        mask.data[i + 1] = 255;
        mask.data[i + 2] = 255;
        mask.data[i + 3] = 178;
      }
    }
  }

  softenMask(mask, width, height, split);
  zone.ctx.putImageData(mask, 0, 0);
  render();
}

function softenMask(mask, width, height, split) {
  const copy = new Uint8ClampedArray(mask.data);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = split + 1; x < width - 1; x += 1) {
      const i = (y * width + x) * 4;
      let total = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          total += copy[((y + oy) * width + x + ox) * 4 + 3];
        }
      }
      mask.data[i + 3] = Math.round(total / 9);
    }
  }
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

canvas.addEventListener("pointerdown", (event) => {
  pointerStart = getPointerPoint(event);
});

canvas.addEventListener("pointerup", (event) => {
  if (!pointerStart) return;
  const end = getPointerPoint(event);
  const distance = Math.hypot(end.x - pointerStart.x, end.y - pointerStart.y);
  pointerStart = null;
  if (distance > 8) return;
  saveHistory();
  fillConnectedSurface(afterSidePoint(end));
});

swatches.forEach((button) => {
  button.addEventListener("click", () => {
    const zone = activeZone();
    if (!zone) return;
    zone.color = button.dataset.color;
    colorInput.value = zone.color;
    renderZoneList();
    render();
  });
});

fillTolerance.addEventListener("input", () => {
  fillToleranceValue.value = fillTolerance.value;
});

zoomLevel.addEventListener("input", () => {
  const scale = Number(zoomLevel.value) / 100;
  zoomLevelValue.value = `${zoomLevel.value}%`;
  canvas.style.setProperty("--zoom", scale);
});

blendStrength.addEventListener("input", () => {
  blendStrengthValue.value = `${blendStrength.value}%`;
  render();
});

colorInput.addEventListener("input", () => {
  const zone = activeZone();
  if (!zone) return;
  zone.color = colorInput.value;
  renderZoneList();
  render();
});

edgeAssist.addEventListener("change", render);
autoMaskButton.addEventListener("click", autoSelectFacade);

addZoneButton.addEventListener("click", () => {
  saveHistory();
  const nextZone = createZone(`구역 ${zones.length + 1}`);
  zones.push(nextZone);
  activeZoneId = nextZone.id;
  syncActiveZoneControls();
  renderZoneList();
  render();
});

undoButton.addEventListener("click", () => {
  const previous = history.pop();
  if (!previous) return;
  restoreHistory(previous);
});

clearMaskButton.addEventListener("click", () => {
  const zone = activeZone();
  if (!zone) return;
  saveHistory();
  zone.ctx.clearRect(0, 0, canvas.width, canvas.height);
  render();
});

sampleButton.addEventListener("click", () => {
  sourceImage.src = "assets/demo-apartment.png";
});

downloadButton.addEventListener("click", () => {
  render();
  const link = document.createElement("a");
  link.download = "apartment-paint-preview.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
});

uploadInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    sourceImage.src = reader.result;
  };
  reader.readAsDataURL(file);
});

window.addEventListener("resize", () => {
  const nextSingleView = window.matchMedia("(max-width: 760px)").matches;
  if (nextSingleView === isSingleView) return;
  fitCanvasToImage();
  resetZones();
  render();
});
