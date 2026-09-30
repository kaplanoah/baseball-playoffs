const LENS_EDGE_PX = 22;

/**
 * WebKit, which every iPhone browser runs on, and Gecko leave SVG filters out of backdrop-filter.
 * @param {string} userAgent
 */
export function canBendBackdrop(userAgent) {
  const isIos = /iPhone|iPad|iPod/.test(userAgent);
  const isSafari = /AppleWebKit/.test(userAgent) && !/Chrome\/|Chromium\/|Edg\//.test(userAgent);
  const isFirefox = /Firefox\//.test(userAgent);
  return !isIos && !isSafari && !isFirefox;
}

// How strongly a pixel bends, rising steeply toward the capsule's rim like a convex lens.
function measureBend(x, y, width, height) {
  const radius = height / 2;
  const centerX = Math.min(Math.max(x + 0.5, radius), width - radius);
  const offsetX = x + 0.5 - centerX;
  const offsetY = y + 0.5 - radius;
  const distance = Math.hypot(offsetX, offsetY) || 1;
  const nearness = Math.max(0, 1 - (radius - distance) / LENS_EDGE_PX);
  const strength = nearness ** 3;
  return { x: (offsetX / distance) * strength, y: (offsetY / distance) * strength };
}

// Each pixel stores which way the glass bends light there: red for x, green for y, 128 for none.
function paintLensMap(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bend = measureBend(x, y, width, height);
      const index = (y * width + x) * 4;
      image.data[index] = 128 + bend.x * 127;
      image.data[index + 1] = 128 + bend.y * 127;
      image.data[index + 2] = 128;
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

/**
 * Sizes the lens filter and its bend map to the glass it sits behind.
 * @param {SVGFilterElement} filter
 * @param {number} width
 * @param {number} height
 */
export function fitLens(filter, width, height) {
  const map = filter.querySelector("feImage");
  for (const element of [filter, map]) {
    element.setAttribute("width", String(width));
    element.setAttribute("height", String(height));
  }
  map.setAttribute("href", paintLensMap(width, height));
}
