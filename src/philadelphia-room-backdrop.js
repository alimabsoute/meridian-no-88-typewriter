import * as THREE from 'three';

const DESIGN_WIDTH = 960;
const DESIGN_HEIGHT = 640;

/**
 * Default colors are expressed in display-space RGB because this module writes
 * directly into an sRGB DataTexture. Palette values may be CSS hex strings,
 * numbers, Three.js Color instances, normalized RGB objects, or RGB arrays.
 */
export const PHILADELPHIA_BACKDROP_PALETTE = Object.freeze({
  wallTop: Object.freeze([119, 112, 92]),
  wallBottom: Object.freeze([73, 68, 57]),
  lampGlow: Object.freeze([226, 171, 99]),
  plasterCool: Object.freeze([91, 99, 93]),
  trimLight: Object.freeze([205, 190, 153]),
  trimMid: Object.freeze([149, 132, 101]),
  trimShadow: Object.freeze([47, 43, 37]),
  skyTop: Object.freeze([42, 66, 92]),
  skyHorizon: Object.freeze([193, 126, 102]),
  cloud: Object.freeze([97, 100, 112]),
  distantBrick: Object.freeze([87, 53, 50]),
  brick: Object.freeze([118, 55, 43]),
  brickDark: Object.freeze([65, 38, 34]),
  mortar: Object.freeze([124, 100, 86]),
  windowDark: Object.freeze([23, 27, 30]),
  windowLight: Object.freeze([244, 178, 87]),
  radiator: Object.freeze([88, 88, 79]),
  baseboard: Object.freeze([93, 82, 62]),
  snow: Object.freeze([224, 232, 230]),
});

/** Recommended mount for the current Meridian writer camera and room origin. */
export const PHILADELPHIA_BACKDROP_PLANE = Object.freeze({
  width: 15,
  height: 10,
  position: Object.freeze([1.258, 4.5, -5.98]),
  rotation: Object.freeze([0, 0, 0]),
});

const WEATHER_PRESETS = new Set(['quiet', 'rain', 'snow', 'nor-easter']);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampByte(value) {
  return Math.round(clamp(Number(value) || 0, 0, 255));
}

function normalizeRgbComponent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return clampByte(numeric <= 1 ? numeric * 255 : numeric);
}

function parseHexColor(value) {
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1].length === 3
    ? match[1].split('').map((digit) => `${digit}${digit}`).join('')
    : match[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function normalizeColor(value, fallback) {
  if (typeof value === 'string') return parseHexColor(value) ?? [...fallback];
  if (typeof value === 'number' && Number.isFinite(value)) {
    const color = Math.trunc(value) >>> 0;
    return [(color >> 16) & 255, (color >> 8) & 255, color & 255];
  }
  if (value?.isColor) {
    const displayColor = value.clone().convertLinearToSRGB();
    return [displayColor.r, displayColor.g, displayColor.b].map(normalizeRgbComponent);
  }
  const channels = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? [value.r, value.g, value.b]
      : null;
  if (!channels || channels.length < 3) return [...fallback];
  const normalized = channels.slice(0, 3).map(normalizeRgbComponent);
  return normalized.some((component) => component === null) ? [...fallback] : normalized;
}

function resolvePalette(overrides = {}) {
  return Object.fromEntries(Object.entries(PHILADELPHIA_BACKDROP_PALETTE).map(([name, fallback]) => (
    [name, normalizeColor(overrides[name], fallback)]
  )));
}

function mixColor(a, b, amount) {
  const t = clamp(amount, 0, 1);
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function shiftColor(color, amount) {
  return color.map((channel) => clampByte(channel + amount));
}

function scaleColor(color, amount) {
  return color.map((channel) => clampByte(channel * amount));
}

function seededHash(x, y, seed) {
  let value = Math.imul((x | 0) ^ Math.imul(y | 0, 0x27d4eb2d), 0x165667b1);
  value ^= Math.imul(seed | 0, 0x9e3779b1);
  value ^= value >>> 15;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  return (value >>> 0) / 4294967295;
}

function createRng(seed) {
  let state = (Math.trunc(seed) || 88) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

class Raster {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
    this.clip = { x0: 0, y0: 0, x1: width, y1: height };
  }

  index(x, y) {
    // Design coordinates use a natural top-left origin. DataTexture rows are
    // uploaded bottom-up, so the image appears upright with flipY disabled.
    return (((this.height - 1 - y) * this.width) + x) * 4;
  }

  setPixel(x, y, color, alpha = 1) {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (
      px < this.clip.x0 || px >= this.clip.x1
      || py < this.clip.y0 || py >= this.clip.y1
      || px < 0 || px >= this.width || py < 0 || py >= this.height
    ) return;
    const index = this.index(px, py);
    const opacity = clamp(alpha, 0, 1);
    if (opacity >= 0.999) {
      this.data[index] = clampByte(color[0]);
      this.data[index + 1] = clampByte(color[1]);
      this.data[index + 2] = clampByte(color[2]);
      this.data[index + 3] = 255;
      return;
    }
    const inverse = 1 - opacity;
    this.data[index] = clampByte(this.data[index] * inverse + color[0] * opacity);
    this.data[index + 1] = clampByte(this.data[index + 1] * inverse + color[1] * opacity);
    this.data[index + 2] = clampByte(this.data[index + 2] * inverse + color[2] * opacity);
    this.data[index + 3] = 255;
  }

  withClip(x, y, width, height, draw) {
    const previous = this.clip;
    this.clip = {
      x0: Math.max(previous.x0, Math.floor(x)),
      y0: Math.max(previous.y0, Math.floor(y)),
      x1: Math.min(previous.x1, Math.ceil(x + width)),
      y1: Math.min(previous.y1, Math.ceil(y + height)),
    };
    draw();
    this.clip = previous;
  }

  rect(x, y, width, height, color, alpha = 1) {
    const x0 = Math.max(this.clip.x0, Math.floor(x));
    const y0 = Math.max(this.clip.y0, Math.floor(y));
    const x1 = Math.min(this.clip.x1, Math.ceil(x + width));
    const y1 = Math.min(this.clip.y1, Math.ceil(y + height));
    const opacity = clamp(alpha, 0, 1);
    const red = clampByte(color[0]);
    const green = clampByte(color[1]);
    const blue = clampByte(color[2]);
    for (let py = y0; py < y1; py += 1) {
      let index = this.index(x0, py);
      for (let px = x0; px < x1; px += 1) {
        if (opacity >= 0.999) {
          this.data[index] = red;
          this.data[index + 1] = green;
          this.data[index + 2] = blue;
        } else {
          const inverse = 1 - opacity;
          this.data[index] = clampByte(this.data[index] * inverse + red * opacity);
          this.data[index + 1] = clampByte(this.data[index + 1] * inverse + green * opacity);
          this.data[index + 2] = clampByte(this.data[index + 2] * inverse + blue * opacity);
        }
        this.data[index + 3] = 255;
        index += 4;
      }
    }
  }

  gradientRect(x, y, width, height, top, bottom, alpha = 1) {
    const y0 = Math.max(this.clip.y0, Math.floor(y));
    const y1 = Math.min(this.clip.y1, Math.ceil(y + height));
    for (let py = y0; py < y1; py += 1) {
      const color = mixColor(top, bottom, (py - y) / Math.max(1, height - 1));
      this.rect(x, py, width, 1, color, alpha);
    }
  }

  ellipse(cx, cy, rx, ry, color, alpha = 1, softness = 0) {
    const x0 = Math.max(this.clip.x0, Math.floor(cx - rx));
    const y0 = Math.max(this.clip.y0, Math.floor(cy - ry));
    const x1 = Math.min(this.clip.x1, Math.ceil(cx + rx));
    const y1 = Math.min(this.clip.y1, Math.ceil(cy + ry));
    for (let py = y0; py < y1; py += 1) {
      for (let px = x0; px < x1; px += 1) {
        const dx = (px + 0.5 - cx) / Math.max(1, rx);
        const dy = (py + 0.5 - cy) / Math.max(1, ry);
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > 1) continue;
        const feather = softness > 0
          ? clamp((1 - distance) / softness, 0, 1)
          : 1;
        this.setPixel(px, py, color, alpha * feather);
      }
    }
  }

  softRect(x, y, width, height, radius, color, alpha = 1) {
    const x0 = Math.floor(x - radius);
    const y0 = Math.floor(y - radius);
    const x1 = Math.ceil(x + width + radius);
    const y1 = Math.ceil(y + height + radius);
    for (let py = y0; py < y1; py += 1) {
      for (let px = x0; px < x1; px += 1) {
        const dx = Math.max(x - px, 0, px - (x + width));
        const dy = Math.max(y - py, 0, py - (y + height));
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > radius) continue;
        this.setPixel(px, py, color, alpha * (1 - distance / Math.max(1, radius)) ** 1.7);
      }
    }
  }

  line(x0, y0, x1, y1, color, thickness = 1, alpha = 1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    const radius = Math.max(0.5, thickness / 2);
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      this.ellipse(x0 + dx * t, y0 + dy * t, radius, radius, color, alpha);
    }
  }

  polygon(points, color, alpha = 1) {
    const minY = Math.max(this.clip.y0, Math.floor(Math.min(...points.map((point) => point[1]))));
    const maxY = Math.min(this.clip.y1, Math.ceil(Math.max(...points.map((point) => point[1]))));
    for (let y = minY; y < maxY; y += 1) {
      const intersections = [];
      for (let index = 0; index < points.length; index += 1) {
        const a = points[index];
        const b = points[(index + 1) % points.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          intersections.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      intersections.sort((a, b) => a - b);
      for (let index = 0; index < intersections.length; index += 2) {
        this.rect(intersections[index], y, intersections[index + 1] - intersections[index], 1, color, alpha);
      }
    }
  }
}

function scaleLayout(width, height) {
  const sx = width / DESIGN_WIDTH;
  const sy = height / DESIGN_HEIGHT;
  const box = (x, y, w, h) => Object.freeze({
    x: Math.round(x * sx),
    y: Math.round(y * sy),
    width: Math.round(w * sx),
    height: Math.round(h * sy),
  });
  return Object.freeze({
    window: box(452, 30, 458, 486),
    aperture: box(496, 68, 368, 408),
    radiator: box(535, 507, 320, 111),
    baseboard: box(0, 568, 960, 58),
    anchors: Object.freeze({
      wall: Object.freeze({ x: Math.round(165 * sx), y: Math.round(285 * sy) }),
      sky: Object.freeze({ x: Math.round(595 * sx), y: Math.round(120 * sy) }),
      brick: Object.freeze({ x: Math.round(565 * sx), y: Math.round(372 * sy) }),
      litWindow: Object.freeze({ x: Math.round(752 * sx), y: Math.round(382 * sy) }),
      sash: Object.freeze({ x: Math.round(681 * sx), y: Math.round(270 * sy) }),
      radiator: Object.freeze({ x: Math.round(677 * sx), y: Math.round(560 * sy) }),
    }),
  });
}

function drawPlasterWall(raster, palette, seed) {
  const { width, height } = raster;
  const data = raster.data;
  const lampX = new Float32Array(width);
  const coolX = new Float32Array(width);
  const edgeX = new Float32Array(width);
  for (let x = 0; x < width; x += 1) {
    const normalizedX = x / width;
    lampX[x] = ((normalizedX - 0.12) / 0.62) ** 2;
    coolX[x] = ((normalizedX - 0.76) / 0.42) ** 2;
    edgeX[x] = Math.abs(normalizedX - 0.5) / 0.5;
  }

  const broadWidth = Math.ceil(width / 16);
  const broadHeight = Math.ceil(height / 16);
  const broadNoise = new Float32Array(broadWidth * broadHeight);
  for (let y = 0; y < broadHeight; y += 1) {
    for (let x = 0; x < broadWidth; x += 1) {
      broadNoise[y * broadWidth + x] = (seededHash(x, y, seed + 41) - 0.5) * 9;
    }
  }

  let noiseState = ((seed | 0) ^ 0xa341316c) || 0x6d2b79f5;
  for (let y = 0; y < height; y += 1) {
    const vertical = y / Math.max(1, height - 1);
    const blend = vertical * 0.9;
    const baseRed = palette.wallTop[0] + (palette.wallBottom[0] - palette.wallTop[0]) * blend;
    const baseGreen = palette.wallTop[1] + (palette.wallBottom[1] - palette.wallTop[1]) * blend;
    const baseBlue = palette.wallTop[2] + (palette.wallBottom[2] - palette.wallTop[2]) * blend;
    const lampY = ((vertical - 0.22) / 0.66) ** 2;
    const coolY = ((vertical - 0.42) / 0.75) ** 2;
    const edgeY = Math.abs(vertical - 0.48) / 0.52;
    const broadRow = Math.min(broadHeight - 1, y >> 4) * broadWidth;
    let index = ((height - 1 - y) * width) * 4;
    for (let x = 0; x < width; x += 1) {
      noiseState ^= noiseState << 13;
      noiseState ^= noiseState >>> 17;
      noiseState ^= noiseState << 5;
      const fine = (((noiseState >>> 24) / 255) - 0.5) * 8;
      const broad = broadNoise[broadRow + (x >> 4)];
      let lamp = Math.max(0, 1 - lampX[x] - lampY);
      lamp = lamp * lamp * 0.23;
      const coolPatch = Math.max(0, 1 - coolX[x] - coolY) * 0.13;
      const vignette = Math.max(0, Math.max(edgeX[x], edgeY) - 0.72) * 18;

      let red = baseRed + (palette.lampGlow[0] - baseRed) * lamp;
      let green = baseGreen + (palette.lampGlow[1] - baseGreen) * lamp;
      let blue = baseBlue + (palette.lampGlow[2] - baseBlue) * lamp;
      red += (palette.plasterCool[0] - red) * coolPatch;
      green += (palette.plasterCool[1] - green) * coolPatch;
      blue += (palette.plasterCool[2] - blue) * coolPatch;
      const variation = fine + broad - vignette;
      data[index] = clampByte(red + variation);
      data[index + 1] = clampByte(green + variation);
      data[index + 2] = clampByte(blue + variation);
      data[index + 3] = 255;
      index += 4;
    }
  }

  const sx = width / DESIGN_WIDTH;
  const sy = height / DESIGN_HEIGHT;
  const rng = createRng(seed + 7);
  for (let patch = 0; patch < 9; patch += 1) {
    const x = (45 + rng() * 355) * sx;
    const y = (45 + rng() * 470) * sy;
    const rx = (24 + rng() * 75) * sx;
    const ry = (10 + rng() * 28) * sy;
    raster.ellipse(x, y, rx, ry, palette.plasterCool, 0.025 + rng() * 0.025, 0.72);
  }

  const crack = scaleColor(palette.wallBottom, 0.54);
  raster.line(278 * sx, 78 * sy, 286 * sx, 118 * sy, crack, Math.max(1, sx), 0.26);
  raster.line(286 * sx, 118 * sy, 278 * sx, 146 * sy, crack, Math.max(1, sx), 0.26);
  raster.line(286 * sx, 118 * sy, 306 * sx, 133 * sy, crack, Math.max(1, sx), 0.2);
  raster.line(64 * sx, 458 * sy, 105 * sx, 466 * sy, crack, Math.max(1, sx), 0.17);
}

function drawBaseboard(raster, palette) {
  const sx = raster.width / DESIGN_WIDTH;
  const sy = raster.height / DESIGN_HEIGHT;
  raster.softRect(0, 568 * sy, raster.width, 49 * sy, 14 * sy, [22, 21, 19], 0.4);
  raster.rect(0, 568 * sy, raster.width, 7 * sy, scaleColor(palette.baseboard, 0.52));
  raster.rect(0, 575 * sy, raster.width, 38 * sy, palette.baseboard);
  raster.gradientRect(0, 575 * sy, raster.width, 38 * sy, shiftColor(palette.baseboard, 16), scaleColor(palette.baseboard, 0.64));
  raster.rect(0, 612 * sy, raster.width, 7 * sy, scaleColor(palette.baseboard, 0.42));
  raster.rect(0, 619 * sy, raster.width, 21 * sy, scaleColor(palette.wallBottom, 0.54));
  raster.line(0, 579 * sy, raster.width, 579 * sy, shiftColor(palette.baseboard, 23), Math.max(1, sy), 0.55);

  // Old two-slot outlet: a modest period detail that also gives the empty wall scale.
  raster.softRect(338 * sx, 511 * sy, 45 * sx, 55 * sy, 5 * sx, [28, 27, 24], 0.24);
  raster.rect(342 * sx, 509 * sy, 38 * sx, 53 * sy, shiftColor(palette.trimMid, -14));
  raster.rect(345 * sx, 512 * sy, 32 * sx, 47 * sy, scaleColor(palette.trimLight, 0.72));
  [527, 546].forEach((y) => {
    raster.ellipse(356 * sx, y * sy, 2.2 * sx, 6 * sy, palette.trimShadow, 0.8);
    raster.ellipse(366 * sx, y * sy, 2.2 * sx, 6 * sy, palette.trimShadow, 0.8);
  });
}

function drawBrickCourses(raster, x, y, width, height, palette, seed, depth = 1) {
  const course = Math.max(5, Math.round(8 * raster.height / DESIGN_HEIGHT));
  const brickWidth = Math.max(11, Math.round(24 * raster.width / DESIGN_WIDTH));
  const mortar = mixColor(palette.mortar, palette.brickDark, depth * 0.46);
  for (let py = y; py < y + height; py += course) {
    raster.rect(x, py, width, Math.max(1, course * 0.12), mortar, 0.52);
    const row = Math.floor((py - y) / course);
    const offset = row % 2 ? brickWidth / 2 : 0;
    for (let px = x - offset; px < x + width; px += brickWidth) {
      raster.rect(px, py, Math.max(1, brickWidth * 0.06), course, mortar, 0.37);
    }
  }
  for (let sample = 0; sample < Math.max(3, Math.round(width * height / 5400)); sample += 1) {
    const noise = seededHash(sample, Math.round(x + y), seed);
    const px = x + noise * width;
    const py = y + seededHash(sample + 37, Math.round(y), seed) * height;
    raster.line(px, py, px + width * 0.05, py, shiftColor(palette.brick, 18), 1, 0.22);
  }
}

function drawRowhouseWindow(raster, x, y, width, height, palette, lit, depth = 0) {
  const frame = mixColor(palette.trimShadow, palette.trimMid, 0.3 - depth * 0.12);
  raster.softRect(x - 2, y - 2, width + 4, height + 5, 3, palette.windowDark, 0.45);
  raster.rect(x, y, width, height, frame);
  raster.rect(x + 3, y + 3, width - 6, height - 6, lit ? palette.windowLight : palette.windowDark);
  if (lit) {
    raster.gradientRect(
      x + 3,
      y + 3,
      width - 6,
      height - 6,
      shiftColor(palette.windowLight, 14),
      scaleColor(palette.windowLight, 0.72),
    );
  } else {
    raster.rect(x + 3, y + 3, width - 6, height - 6, palette.skyTop, 0.18);
  }
  raster.rect(x + width * 0.47, y + 2, Math.max(1, width * 0.08), height - 4, frame);
  raster.rect(x + 2, y + height * 0.49, width - 4, Math.max(1, height * 0.07), frame);
  if (lit) raster.rect(x + width * 0.14, y + height * 0.76, width * 0.72, 2, [251, 213, 143], 0.58);
}

function drawExterior(raster, palette, seed, weather, aperture) {
  const sx = raster.width / DESIGN_WIDTH;
  const sy = raster.height / DESIGN_HEIGHT;
  const rng = createRng(seed + 1931);
  const { x, y, width, height } = aperture;

  raster.withClip(x, y, width, height, () => {
    raster.gradientRect(x, y, width, height, palette.skyTop, palette.skyHorizon);

    // Broad clouds at blue hour; softened ellipses keep them painterly at one texture.
    raster.ellipse(610 * sx, 127 * sy, 118 * sx, 26 * sy, palette.cloud, 0.16, 0.75);
    raster.ellipse(777 * sx, 172 * sy, 104 * sx, 21 * sy, palette.cloud, 0.22, 0.7);
    raster.ellipse(526 * sx, 220 * sy, 80 * sx, 16 * sy, shiftColor(palette.cloud, 18), 0.13, 0.8);
    raster.ellipse(811 * sx, 95 * sy, 58 * sx, 14 * sy, scaleColor(palette.cloud, 0.8), 0.12, 0.8);

    // Distant roofline establishes the dense, low Philadelphia horizon.
    const distantY = 281 * sy;
    raster.polygon([
      [x, 311 * sy], [x, 292 * sy], [532 * sx, 292 * sy], [532 * sx, distantY],
      [585 * sx, distantY], [585 * sx, 299 * sy], [627 * sx, 299 * sy],
      [627 * sx, 275 * sy], [681 * sx, 275 * sy], [681 * sx, 296 * sy],
      [742 * sx, 296 * sy], [742 * sx, 280 * sy], [809 * sx, 280 * sy],
      [809 * sx, 301 * sy], [aperture.x + aperture.width, 301 * sy],
      [aperture.x + aperture.width, 399 * sy], [x, 399 * sy],
    ], palette.distantBrick, 0.91);

    for (let chimney = 0; chimney < 7; chimney += 1) {
      const chimneyX = (514 + chimney * 50 + rng() * 15) * sx;
      const chimneyY = (242 + rng() * 37) * sy;
      const chimneyWidth = (8 + rng() * 5) * sx;
      raster.rect(chimneyX, chimneyY, chimneyWidth, 49 * sy, scaleColor(palette.distantBrick, 0.7));
      raster.rect(chimneyX - 2 * sx, chimneyY - 3 * sy, chimneyWidth + 4 * sx, 5 * sy, scaleColor(palette.distantBrick, 0.55));
      raster.rect(chimneyX + chimneyWidth * 0.58, chimneyY + 3 * sy, 1.5 * sx, 39 * sy, shiftColor(palette.distantBrick, 16), 0.34);
    }

    // The near row is deliberately contiguous and narrow: flat roofs, brick
    // party walls, modest cornices, rear additions, and irregular chimneys.
    const buildings = [
      { x: 489, w: 67, roof: 332, tone: -6 },
      { x: 555, w: 73, roof: 318, tone: 7 },
      { x: 627, w: 69, roof: 340, tone: -12 },
      { x: 695, w: 77, roof: 309, tone: 11 },
      { x: 771, w: 64, roof: 329, tone: -3 },
      { x: 834, w: 47, roof: 316, tone: 4 },
    ];

    buildings.forEach((building, index) => {
      const bx = building.x * sx;
      const by = building.roof * sy;
      const bw = building.w * sx;
      const bh = aperture.y + aperture.height - by + 5 * sy;
      const facade = shiftColor(palette.brick, building.tone);
      raster.rect(bx, by, bw, bh, facade);
      drawBrickCourses(raster, bx, by, bw, bh, { ...palette, brick: facade }, seed + index * 31, 0);
      raster.rect(bx - 1 * sx, by - 4 * sy, bw + 2 * sx, 6 * sy, scaleColor(facade, 0.58));
      raster.rect(bx, by + 4 * sy, bw, 3 * sy, shiftColor(facade, 17), 0.5);
      raster.rect(bx + bw - 2 * sx, by, 2 * sx, bh, scaleColor(facade, 0.58), 0.75);

      const windowWidth = Math.max(12 * sx, Math.min(18 * sx, bw * 0.24));
      const windowHeight = 29 * sy;
      const left = bx + bw * 0.19;
      const right = bx + bw * 0.62;
      const top = by + 29 * sy;
      drawRowhouseWindow(raster, left, top, windowWidth, windowHeight, palette, index === 4, 0);
      if (bw > 55 * sx) drawRowhouseWindow(raster, right, top + (index % 2) * 2 * sy, windowWidth, windowHeight, palette, index === 3, 0);
      drawRowhouseWindow(raster, left, top + 55 * sy, windowWidth, windowHeight, palette, index === 1, 0);
      if (bw > 55 * sx) drawRowhouseWindow(raster, right, top + 55 * sy, windowWidth, windowHeight, palette, index === 3 || index === 5, 0);

      if (index % 2 === 1) {
        const fireEscape = scaleColor(palette.windowDark, 0.85);
        raster.line(bx + bw * 0.1, top + 49 * sy, bx + bw * 0.92, top + 49 * sy, fireEscape, Math.max(1, sx), 0.72);
        raster.line(bx + bw * 0.17, top + 47 * sy, bx + bw * 0.13, top + 80 * sy, fireEscape, Math.max(1, sx), 0.62);
        raster.line(bx + bw * 0.84, top + 47 * sy, bx + bw * 0.88, top + 80 * sy, fireEscape, Math.max(1, sx), 0.62);
      }
    });

    // Prominent warm windows are fixed semantic anchors, independent of seed.
    drawRowhouseWindow(raster, 745 * sx, 371 * sy, 30 * sx, 41 * sy, palette, true, 0);
    drawRowhouseWindow(raster, 802 * sx, 385 * sy, 24 * sx, 35 * sy, palette, false, 0);

    // Rear kitchen additions and tar roofs layer the view at sill level.
    raster.polygon([
      [500 * sx, 421 * sy], [590 * sx, 408 * sy], [657 * sx, 433 * sy],
      [738 * sx, 414 * sy], [866 * sx, 438 * sy], [866 * sx, 478 * sy],
      [496 * sx, 478 * sy],
    ], scaleColor(palette.brickDark, 0.78), 0.94);
    raster.line(501 * sx, 421 * sy, 590 * sx, 408 * sy, shiftColor(palette.brickDark, 25), 2 * sy, 0.55);
    raster.line(590 * sx, 408 * sy, 657 * sx, 433 * sy, shiftColor(palette.brickDark, 22), 2 * sy, 0.48);

    // A sagging utility line is a quiet urban cue, never a visual focal point.
    let lastX = aperture.x;
    let lastY = 234 * sy;
    for (let segment = 1; segment <= 22; segment += 1) {
      const t = segment / 22;
      const nextX = aperture.x + aperture.width * t;
      const nextY = (234 + Math.sin(t * Math.PI) * 17) * sy;
      raster.line(lastX, lastY, nextX, nextY, palette.windowDark, Math.max(0.7, sx), 0.38);
      lastX = nextX;
      lastY = nextY;
    }

    if (weather === 'rain' || weather === 'nor-easter') {
      const count = weather === 'nor-easter' ? 118 : 72;
      for (let streak = 0; streak < count; streak += 1) {
        const px = x + rng() * width;
        const py = y + rng() * height;
        const length = (5 + rng() * 15) * sy;
        const lean = (weather === 'nor-easter' ? 6 : 2) * sx;
        raster.line(px, py, px - lean, py + length, [194, 214, 226], Math.max(0.65, sx * 0.7), 0.18 + rng() * 0.2);
      }
    }

    if (weather === 'snow' || weather === 'nor-easter') {
      const count = weather === 'nor-easter' ? 86 : 112;
      for (let flake = 0; flake < count; flake += 1) {
        const px = x + rng() * width;
        const py = y + rng() * height;
        const radius = (0.7 + rng() * 1.5) * Math.min(sx, sy);
        raster.ellipse(px, py, radius, radius, palette.snow, 0.35 + rng() * 0.42, 0.28);
      }
      buildings.forEach((building) => {
        raster.rect((building.x - 1) * sx, (building.roof - 5) * sy, (building.w + 2) * sx, 4 * sy, palette.snow, 0.63);
      });
    }

    // Cool glass tint and two subdued room reflections retain depth without
    // flattening the exterior details.
    raster.rect(x, y, width, height, [68, 100, 126], 0.075);
    raster.polygon([
      [511 * sx, 68 * sy], [560 * sx, 68 * sy], [705 * sx, 476 * sy], [663 * sx, 476 * sy],
    ], [225, 198, 154], 0.055);
    raster.polygon([
      [739 * sx, 68 * sy], [768 * sx, 68 * sy], [858 * sx, 330 * sy], [858 * sx, 398 * sy],
    ], [225, 198, 154], 0.04);
  });
}

function drawWindowFrame(raster, palette, weather) {
  const sx = raster.width / DESIGN_WIDTH;
  const sy = raster.height / DESIGN_HEIGHT;
  const shadow = palette.trimShadow;
  const mid = palette.trimMid;
  const light = palette.trimLight;

  // Every layer below is a ring rather than a filled rectangle. Keeping the
  // aperture untouched is essential: the exterior remains a legible view,
  // not a decorative picture painted over by the casing.
  raster.softRect(436 * sx, 18 * sy, 21 * sx, 511 * sy, 16 * Math.max(sx, sy), [14, 14, 13], 0.5);
  raster.softRect(905 * sx, 18 * sy, 21 * sx, 511 * sy, 16 * Math.max(sx, sy), [14, 14, 13], 0.5);
  raster.softRect(447 * sx, 17 * sy, 468 * sx, 20 * sy, 16 * Math.max(sx, sy), [14, 14, 13], 0.5);
  raster.softRect(447 * sx, 510 * sy, 468 * sx, 18 * sy, 16 * Math.max(sx, sy), [14, 14, 13], 0.5);

  raster.rect(452 * sx, 30 * sy, 44 * sx, 486 * sy, shadow);
  raster.rect(864 * sx, 30 * sy, 46 * sx, 486 * sy, shadow);
  raster.rect(452 * sx, 30 * sy, 458 * sx, 38 * sy, shadow);
  raster.rect(452 * sx, 476 * sy, 458 * sx, 40 * sy, shadow);

  raster.gradientRect(458 * sx, 35 * sy, 38 * sx, 456 * sy, shiftColor(mid, 17), scaleColor(mid, 0.77));
  raster.gradientRect(864 * sx, 35 * sy, 40 * sx, 456 * sy, shiftColor(mid, 8), scaleColor(mid, 0.65));
  raster.gradientRect(458 * sx, 35 * sy, 446 * sx, 33 * sy, shiftColor(mid, 17), scaleColor(mid, 0.77));
  raster.gradientRect(458 * sx, 476 * sy, 446 * sx, 35 * sy, shiftColor(mid, 2), scaleColor(mid, 0.62));

  raster.rect(477 * sx, 51 * sy, 19 * sx, 444 * sy, light);
  raster.rect(864 * sx, 51 * sy, 19 * sx, 444 * sy, scaleColor(mid, 0.75));
  raster.rect(477 * sx, 51 * sy, 406 * sx, 17 * sy, shiftColor(light, 12));
  raster.rect(477 * sx, 476 * sy, 406 * sx, 19 * sy, scaleColor(mid, 0.63));

  // Double-hung sash: meeting rail, mullions, interior bevels, and brass latch.
  raster.softRect(491 * sx, 255 * sy, 378 * sx, 29 * sy, 7 * sy, [22, 23, 21], 0.52);
  raster.rect(491 * sx, 252 * sy, 378 * sx, 31 * sy, shadow);
  raster.gradientRect(494 * sx, 255 * sy, 372 * sx, 23 * sy, shiftColor(light, 8), scaleColor(mid, 0.65));
  raster.rect(674 * sx, 66 * sy, 14 * sx, 410 * sy, shadow);
  raster.gradientRect(677 * sx, 69 * sy, 9 * sx, 404 * sy, shiftColor(light, 4), scaleColor(mid, 0.72));
  raster.line(499 * sx, 71 * sy, 499 * sx, 473 * sy, shiftColor(light, 20), Math.max(1, sx), 0.58);
  raster.line(861 * sx, 71 * sy, 861 * sx, 473 * sy, shadow, Math.max(1, sx), 0.66);

  raster.softRect(650 * sx, 262 * sy, 62 * sx, 18 * sy, 4 * sy, [20, 19, 17], 0.52);
  raster.rect(653 * sx, 260 * sy, 56 * sx, 17 * sy, [103, 77, 39]);
  raster.rect(658 * sx, 263 * sy, 46 * sx, 6 * sy, [188, 144, 70]);
  raster.ellipse(681 * sx, 271 * sy, 4 * sx, 3 * sy, [49, 37, 23]);

  // Deep sill reads in silhouette behind the machine and keeps the window grounded.
  raster.softRect(438 * sx, 487 * sy, 482 * sx, 31 * sy, 10 * sy, [16, 16, 15], 0.57);
  raster.polygon([
    [445 * sx, 485 * sy], [908 * sx, 485 * sy], [919 * sx, 503 * sy], [437 * sx, 503 * sy],
  ], light);
  raster.rect(437 * sx, 503 * sy, 482 * sx, 15 * sy, scaleColor(mid, 0.62));
  raster.line(447 * sx, 487 * sy, 906 * sx, 487 * sy, shiftColor(light, 22), Math.max(1, sy), 0.8);

  if (weather === 'snow' || weather === 'nor-easter') {
    raster.polygon([
      [481 * sx, 478 * sy], [522 * sx, 475 * sy], [557 * sx, 479 * sy], [611 * sx, 476 * sy],
      [668 * sx, 480 * sy], [733 * sx, 476 * sy], [797 * sx, 479 * sy], [863 * sx, 476 * sy],
      [863 * sx, 485 * sy], [481 * sx, 485 * sy],
    ], palette.snow, 0.77);
  }

  // Paint wear is restrained but prevents the frame from looking synthetic.
  raster.line(469 * sx, 96 * sy, 471 * sx, 211 * sy, scaleColor(mid, 0.58), Math.max(1, sx), 0.33);
  raster.line(892 * sx, 306 * sy, 889 * sx, 441 * sy, shiftColor(light, 18), Math.max(1, sx), 0.24);
  raster.line(533 * sx, 510 * sy, 621 * sx, 510 * sy, shiftColor(mid, -24), Math.max(1, sy), 0.34);
}

function drawRadiator(raster, palette) {
  const sx = raster.width / DESIGN_WIDTH;
  const sy = raster.height / DESIGN_HEIGHT;
  const body = palette.radiator;
  const shadow = scaleColor(body, 0.41);
  const highlight = shiftColor(body, 35);

  raster.softRect(526 * sx, 508 * sy, 338 * sx, 111 * sy, 18 * sy, [15, 15, 14], 0.5);
  raster.rect(540 * sx, 519 * sy, 306 * sx, 13 * sy, shadow);
  raster.gradientRect(543 * sx, 514 * sy, 300 * sx, 15 * sy, highlight, scaleColor(body, 0.76));

  const ribCount = 14;
  for (let rib = 0; rib < ribCount; rib += 1) {
    const x = (548 + rib * 21) * sx;
    raster.ellipse(x, 532 * sy, 8.2 * sx, 10 * sy, shadow);
    raster.rect((x / sx - 8.2) * sx, 532 * sy, 16.4 * sx, 69 * sy, shadow);
    raster.ellipse(x, 600 * sy, 8.2 * sx, 10 * sy, shadow);
    raster.ellipse(x, 530 * sy, 6.3 * sx, 8 * sy, highlight);
    raster.gradientRect((x / sx - 6.3) * sx, 530 * sy, 12.6 * sx, 68 * sy, highlight, scaleColor(body, 0.63));
    raster.ellipse(x, 598 * sy, 6.3 * sx, 8 * sy, scaleColor(body, 0.63));
    raster.line((x / sx - 3.1) * sx, 538 * sy, (x / sx - 3.1) * sx, 590 * sy, [151, 149, 131], Math.max(1, sx), 0.43);
  }

  raster.rect(540 * sx, 599 * sy, 305 * sx, 10 * sy, scaleColor(body, 0.56));
  raster.rect(556 * sx, 607 * sy, 23 * sx, 12 * sy, shadow);
  raster.rect(807 * sx, 607 * sy, 23 * sx, 12 * sy, shadow);

  // Valve and exposed pipe place the radiator in an old working room.
  raster.rect(848 * sx, 550 * sy, 17 * sx, 9 * sy, shadow);
  raster.ellipse(868 * sx, 554 * sy, 9 * sx, 9 * sy, highlight);
  raster.line(868 * sx, 545 * sy, 868 * sx, 563 * sy, shadow, 3 * sx);
  raster.line(859 * sx, 554 * sy, 877 * sx, 554 * sy, shadow, 3 * sy);
  raster.rect(874 * sx, 556 * sy, 10 * sx, 63 * sy, scaleColor(body, 0.52));
  raster.ellipse(879 * sx, 619 * sy, 5 * sx, 4 * sy, shadow);
}

function normalizeDimension(value, fallback, name) {
  const numeric = Number(value ?? fallback);
  if (!Number.isInteger(numeric) || numeric < 160 || numeric > 4096) {
    throw new RangeError(`${name} must be an integer between 160 and 4096.`);
  }
  return numeric;
}

function normalizeWeather(weather) {
  const normalized = String(weather ?? 'snow').toLowerCase().replace(/[’']/g, '-').replace(/\s+/g, '-');
  if (normalized === 'noreaster' || normalized === 'nor--easter') return 'nor-easter';
  return WEATHER_PRESETS.has(normalized) ? normalized : 'quiet';
}

function renderBackdropData(width, height, seed, weather, palette) {
  const layout = scaleLayout(width, height);
  const raster = new Raster(width, height);
  drawPlasterWall(raster, palette, seed);
  drawBaseboard(raster, palette);
  drawExterior(raster, palette, seed, weather, layout.aperture);
  drawWindowFrame(raster, palette, weather);
  drawRadiator(raster, palette);
  return { data: raster.data, layout };
}

function freezePalette(palette) {
  return Object.freeze(Object.fromEntries(
    Object.entries(palette).map(([name, color]) => [name, Object.freeze([...color])]),
  ));
}

/**
 * Creates an inexpensive, self-contained Philadelphia room backdrop.
 *
 * The asset owns exactly one RGBA DataTexture and one unlit MeshBasicMaterial.
 * It has no canvas, DOM, renderer, scene, camera, animation, or storage
 * dependency, so callers can mount it on any plane behind the typewriter.
 *
 * @param {object} [options]
 * @param {number} [options.width=960] Texture width in pixels.
 * @param {number} [options.height=640] Texture height in pixels.
 * @param {number} [options.seed=88] Deterministic detail seed.
 * @param {'quiet'|'rain'|'snow'|'nor-easter'} [options.weather='snow'] Static window weather.
 * @param {object} [options.palette] Optional named palette overrides.
 * @returns {{texture: THREE.DataTexture, material: THREE.MeshBasicMaterial,
 * width: number, height: number, aspect: number, seed: number, weather: string,
 * palette: object, layout: object, dispose: Function}}
 */
export function createPhiladelphiaRoomBackdrop({
  width = DESIGN_WIDTH,
  height = DESIGN_HEIGHT,
  seed = 88,
  weather = 'snow',
  palette: paletteOverrides = {},
} = {}) {
  const resolvedWidth = normalizeDimension(width, DESIGN_WIDTH, 'width');
  const resolvedHeight = normalizeDimension(height, DESIGN_HEIGHT, 'height');
  let currentSeed = Number.isFinite(Number(seed)) ? Math.trunc(Number(seed)) : 88;
  let currentWeather = normalizeWeather(weather);
  let currentPaletteOverrides = { ...paletteOverrides };
  let currentPalette = resolvePalette(currentPaletteOverrides);
  let currentFrozenPalette = freezePalette(currentPalette);
  let brightness = 1;
  const { data, layout } = renderBackdropData(
    resolvedWidth,
    resolvedHeight,
    currentSeed,
    currentWeather,
    currentPalette,
  );

  const texture = new THREE.DataTexture(
    data,
    resolvedWidth,
    resolvedHeight,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = 'PhiladelphiaRoomBackdropTexture';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  texture.userData = {
    kind: 'stationary-philadelphia-room-backdrop',
    deterministic: true,
    coordinateOrigin: 'top-left',
    layout,
  };

  const material = new THREE.MeshBasicMaterial({
    name: 'PhiladelphiaRoomBackdropMaterial',
    map: texture,
    color: 0xffffff,
    transparent: false,
    depthWrite: true,
    fog: false,
    toneMapped: false,
  });

  let disposed = false;
  return {
    texture,
    material,
    width: resolvedWidth,
    height: resolvedHeight,
    aspect: resolvedWidth / resolvedHeight,
    get seed() { return currentSeed; },
    get weather() { return currentWeather; },
    get brightness() { return brightness; },
    get palette() { return currentFrozenPalette; },
    get disposed() { return disposed; },
    layout,
    /**
     * Updates infrequent fallback state without replacing the texture or
     * material. Weather, seed, or palette changes rerasterize into the existing
     * byte buffer; brightness is a cheap material-only adjustment.
     */
    update(options = {}) {
      if (disposed) throw new Error('Cannot update a disposed Philadelphia room backdrop.');
      let textureChanged = false;
      let materialChanged = false;
      if (Object.hasOwn(options, 'weather')) {
        const nextWeather = normalizeWeather(options.weather);
        if (nextWeather !== currentWeather) {
          currentWeather = nextWeather;
          textureChanged = true;
        }
      }
      if (Object.hasOwn(options, 'seed')) {
        const numericSeed = Number(options.seed);
        const nextSeed = Number.isFinite(numericSeed) ? Math.trunc(numericSeed) : 88;
        if (nextSeed !== currentSeed) {
          currentSeed = nextSeed;
          textureChanged = true;
        }
      }
      if (options.palette && typeof options.palette === 'object') {
        currentPaletteOverrides = { ...currentPaletteOverrides, ...options.palette };
        currentPalette = resolvePalette(currentPaletteOverrides);
        currentFrozenPalette = freezePalette(currentPalette);
        textureChanged = true;
      }
      if (Object.hasOwn(options, 'brightness')) {
        const nextBrightness = clamp(Number(options.brightness) || 1, 0.35, 1.35);
        if (nextBrightness !== brightness) {
          brightness = nextBrightness;
          material.color.setRGB(brightness, brightness, brightness);
          materialChanged = true;
        }
      }
      if (textureChanged) {
        const rendered = renderBackdropData(
          resolvedWidth,
          resolvedHeight,
          currentSeed,
          currentWeather,
          currentPalette,
        );
        texture.image.data.set(rendered.data);
        texture.needsUpdate = true;
      }
      return { textureChanged, materialChanged };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      material.dispose();
      texture.dispose();
    },
  };
}
