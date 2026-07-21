import * as THREE from 'three';

export function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canvasTexture(canvas, { repeat = false } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  return texture;
}

export function makeKeyLabelTexture(primary, secondary = '') {
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 192;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(78, 58, 2, 96, 96, 98);
  gradient.addColorStop(0, '#fff9e7');
  gradient.addColorStop(0.55, '#e9dfc6');
  gradient.addColorStop(1, '#b9aa88');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 192, 192);
  context.strokeStyle = 'rgba(68, 58, 42, .18)';
  context.lineWidth = 3;
  context.beginPath();
  context.arc(96, 96, 88, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = '#171816';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = secondary ? '54px "Bebas Neue", sans-serif' : '68px "Bebas Neue", sans-serif';
  context.fillText(primary, 96, secondary ? 116 : 99);
  if (secondary) {
    context.fillStyle = '#8e3428';
    context.font = '31px "Bebas Neue", sans-serif';
    context.fillText(secondary, 96, 52);
  }
  for (let i = 0; i < 120; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * 87;
    context.fillStyle = `rgba(60, 50, 34, ${Math.random() * 0.035})`;
    context.fillRect(96 + Math.cos(angle) * radius, 96 + Math.sin(angle) * radius, 1, 1);
  }
  return canvasTexture(canvas);
}

export function makeRectLabelTexture(label) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 0, 128);
  gradient.addColorStop(0, '#252825');
  gradient.addColorStop(1, '#0a0c0b');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 384, 128);
  context.strokeStyle = '#827254';
  context.lineWidth = 5;
  context.strokeRect(7, 7, 370, 114);
  context.fillStyle = '#e5dbc2';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = `${label.length > 6 ? 36 : 46}px "Bebas Neue", sans-serif`;
  context.fillText(label, 192, 67);
  return canvasTexture(canvas);
}

export function makeBadgeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#c19a56';
  context.lineWidth = 7;
  context.strokeRect(15, 15, 994, 226);
  context.strokeStyle = 'rgba(193,154,86,.45)';
  context.lineWidth = 2;
  context.strokeRect(27, 27, 970, 202);
  context.fillStyle = '#d5b16f';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '128px "Bebas Neue", sans-serif';
  context.letterSpacing = '12px';
  context.fillText('MERIDIAN', 500, 129);
  context.font = '42px "Special Elite", monospace';
  context.fillStyle = '#bca16f';
  context.fillText('No. 88', 891, 188);
  return canvasTexture(canvas);
}

export function makeScaleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.fillStyle = '#dad0b8';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#282921';
  context.fillStyle = '#282921';
  context.textAlign = 'center';
  context.textBaseline = 'top';
  for (let i = 0; i <= 80; i += 1) {
    const x = 35 + (i / 80) * (canvas.width - 70);
    const height = i % 10 === 0 ? 52 : i % 5 === 0 ? 37 : 24;
    context.lineWidth = i % 10 === 0 ? 4 : 2;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
    if (i % 10 === 0) {
      context.font = '34px "Bebas Neue", sans-serif';
      context.fillText(String(i), x, 62);
    }
  }
  return canvasTexture(canvas);
}

export function makeWoodTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  const context = canvas.getContext('2d');
  const base = context.createLinearGradient(0, 0, 0, canvas.height);
  base.addColorStop(0, '#3c2113');
  base.addColorStop(0.4, '#5a321c');
  base.addColorStop(1, '#2b170f');
  context.fillStyle = base;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const random = seededRandom(98347);
  for (let i = 0; i < 190; i += 1) {
    const y = random() * canvas.height;
    const amplitude = 2 + random() * 16;
    const frequency = 0.003 + random() * 0.011;
    context.beginPath();
    for (let x = -20; x <= canvas.width + 20; x += 16) {
      const drift = Math.sin(x * frequency + random() * 0.4) * amplitude + Math.sin(x * 0.021) * 2;
      if (x === -20) context.moveTo(x, y + drift);
      else context.lineTo(x, y + drift);
    }
    context.strokeStyle = `rgba(${random() > 0.45 ? '28,12,6' : '178,105,53'},${0.025 + random() * 0.09})`;
    context.lineWidth = 0.5 + random() * 2.8;
    context.stroke();
  }

  for (let i = 0; i < 6; i += 1) {
    const x = random() * canvas.width;
    const y = random() * canvas.height;
    context.save();
    context.translate(x, y);
    context.scale(1, 0.34 + random() * 0.25);
    for (let ring = 0; ring < 8; ring += 1) {
      context.beginPath();
      context.ellipse(0, 0, 10 + ring * 11, 7 + ring * 7, random() * 0.4, 0, Math.PI * 2);
      context.strokeStyle = `rgba(22,9,4,${0.07 + (8 - ring) * 0.013})`;
      context.lineWidth = 2;
      context.stroke();
    }
    context.restore();
  }
  const texture = canvasTexture(canvas, { repeat: true });
  texture.repeat.set(1.5, 1.5);
  return texture;
}

export function makeCrinkleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  context.fillStyle = '#777';
  context.fillRect(0, 0, 512, 512);
  const image = context.getImageData(0, 0, 512, 512);
  const random = seededRandom(8821);
  for (let i = 0; i < image.data.length; i += 4) {
    const grain = 90 + Math.floor(random() * 85);
    image.data[i] = grain;
    image.data[i + 1] = grain;
    image.data[i + 2] = grain;
    image.data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 5);
  return texture;
}

export class PaperRenderer {
  constructor(documentState) {
    this.width = 1280;
    this.height = 1656;
    this.displayScale = 0.6;
    this.displayWidth = Math.round(this.width * this.displayScale);
    this.displayHeight = Math.round(this.height * this.displayScale);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.context = this.canvas.getContext('2d');
    this.displayCanvas = document.createElement('canvas');
    this.displayCanvas.width = this.displayWidth;
    this.displayCanvas.height = this.displayHeight;
    this.displayContext = this.displayCanvas.getContext('2d');
    this.document = documentState;
    this.drawPaper();
    this.syncDisplayPaper();
    this.texture = canvasTexture(this.displayCanvas);
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    for (const mark of documentState.marks) this.drawImpression(mark, false);
    this.texture.needsUpdate = true;
  }

  drawPaper() {
    const context = this.context;
    const gradient = context.createLinearGradient(0, 0, this.width, this.height);
    gradient.addColorStop(0, '#eee5cf');
    gradient.addColorStop(0.48, '#e9dec5');
    gradient.addColorStop(1, '#dcd0b7');
    context.fillStyle = gradient;
    context.fillRect(0, 0, this.width, this.height);

    const random = seededRandom(24681357 + this.document.sheetNumber);
    for (let i = 0; i < 7200; i += 1) {
      const alpha = 0.018 + random() * 0.026;
      context.strokeStyle = random() > 0.48 ? `rgba(115,92,58,${alpha})` : `rgba(255,255,242,${alpha})`;
      context.lineWidth = random() * 0.8 + 0.2;
      const x = random() * this.width;
      const y = random() * this.height;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + 3 + random() * 15, y + (random() - 0.5) * 2);
      context.stroke();
    }

    context.fillStyle = 'rgba(120, 95, 55, .055)';
    context.fillRect(0, 0, 4, this.height);
    context.fillRect(this.width - 4, 0, 4, this.height);
    context.fillRect(0, 0, this.width, 3);
  }

  syncDisplayPaper() {
    this.displayContext.clearRect(0, 0, this.displayWidth, this.displayHeight);
    this.displayContext.drawImage(this.canvas, 0, 0, this.displayWidth, this.displayHeight);
  }

  impressionCoordinates(mark, scale = 1) {
    const marginX = 157;
    const columnPitch = 14.92;
    const topMargin = 182;
    const linePitch = 25.12;
    return {
      x: (marginX + mark.column * columnPitch) * scale,
      y: (topMargin + mark.line * linePitch) * scale,
    };
  }

  drawImpressionToContext(mark, context, scale = 1) {
    const { x, y } = this.impressionCoordinates(mark, scale);
    const random = seededRandom(mark.seed);
    const force = Math.max(0.25, Math.min(1, mark.force ?? 0.72));
    const rotation = (random() - 0.5) * 0.018;
    const jitterX = (random() - 0.5) * 1.35 * scale;
    const jitterY = (random() - 0.5) * 1.2 * scale;
    context.save();
    context.translate(x + jitterX, y + jitterY);
    context.rotate(rotation);
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    context.font = `${26 * scale}px "Special Elite", "Courier New", monospace`;

    if (mark.ink === 'stencil') {
      context.fillStyle = `rgba(110, 91, 61, ${0.035 + force * 0.035})`;
      context.fillText(mark.character, 0.8 * scale, 0.9 * scale);
      context.fillStyle = `rgba(255, 250, 230, ${0.11 + force * 0.06})`;
      context.fillText(mark.character, -0.65 * scale, -0.65 * scale);
    } else {
      const color = mark.ink === 'red' ? [118, 28, 21] : [20, 22, 19];
      const opacity = 0.62 + force * 0.34;
      context.fillStyle = `rgba(${color.join(',')}, ${opacity})`;
      context.fillText(mark.character, 0, 0);
      context.globalCompositeOperation = 'multiply';
      for (let pass = 0; pass < 2; pass += 1) {
        context.fillStyle = `rgba(${color.join(',')}, ${0.08 + random() * 0.09})`;
        context.fillText(mark.character, (random() - 0.5) * 1.25 * scale, (random() - 0.5) * 0.85 * scale);
      }
      context.globalCompositeOperation = 'destination-out';
      for (let speck = 0; speck < 5; speck += 1) {
        context.globalAlpha = 0.08 + random() * 0.13;
        context.fillRect(
          (random() - 0.5) * 10 * scale,
          (-8 + random() * 16) * scale,
          (0.5 + random()) * scale,
          (0.5 + random()) * scale,
        );
      }
    }
    context.restore();
  }

  drawImpression(mark, update = true) {
    this.drawImpressionToContext(mark, this.context, 1);
    this.drawImpressionToContext(mark, this.displayContext, this.displayScale);
    if (update) this.texture.needsUpdate = true;
  }

  redraw(documentState) {
    this.document = documentState;
    this.drawPaper();
    this.syncDisplayPaper();
    for (const mark of documentState.marks) this.drawImpression(mark, false);
    this.texture.needsUpdate = true;
  }

  download(filename) {
    const link = document.createElement('a');
    link.download = filename;
    link.href = this.canvas.toDataURL('image/png');
    link.click();
  }
}
