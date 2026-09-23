/** Opaque stationery finishes; surface appearance only, with shared page physics. */
export const PAPER_STOCKS = Object.freeze({
  bond: Object.freeze({ id: 'bond', name: 'Classic Typing Bond', colors: ['#faf9f5', '#f5f4ee', '#eeede7'], fibers: 3000, grain: 0.018 }),
  cotton: Object.freeze({ id: 'cotton', name: 'Ivory Cotton', colors: ['#f5edd9', '#eee4cc', '#e7dcc2'], fibers: 6500, grain: 0.032 }),
  onionskin: Object.freeze({ id: 'onionskin', name: 'Onionskin', colors: ['#f3f4ed', '#e9ece5', '#e2e7df'], fibers: 2200, grain: 0.02 }),
  laid: Object.freeze({ id: 'laid', name: 'Laid Writing Paper', colors: ['#f4efdf', '#eee7d5', '#e5dcc8'], fibers: 3600, grain: 0.022 }),
});

export function normalizePaperStock(id) {
  return Object.hasOwn(PAPER_STOCKS, id) ? id : 'bond';
}

/** Paint once when loading/changing stock, never on every keystroke. */
export function drawPaperStock(context, width, height, id, random, scale = 1) {
  const stock = PAPER_STOCKS[normalizePaperStock(id)];
  const gradient = context.createLinearGradient(0, 0, width, height);
  stock.colors.forEach((color, index) => gradient.addColorStop(index / 2, color));
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  for (let i = 0; i < stock.fibers; i += 1) {
    const alpha = stock.grain * (0.6 + random());
    context.strokeStyle = random() > 0.48 ? `rgba(105,99,79,${alpha})` : `rgba(255,255,252,${alpha})`;
    context.lineWidth = (0.2 + random() * 0.8) * scale;
    const x = random() * width;
    const y = random() * height;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + (3 + random() * 15) * scale, y + (random() - 0.5) * 2 * scale);
    context.stroke();
  }
  if (stock.id === 'laid') {
    // Fine laid wires with sparse perpendicular chain lines, never ruled lines.
    context.fillStyle = 'rgba(121,111,85,0.032)';
    for (let y = 0; y < height; y += 5 * scale) context.fillRect(0, y, width, 0.65 * scale);
    context.fillStyle = 'rgba(121,111,85,0.026)';
    for (let x = 28 * scale; x < width; x += 115 * scale) context.fillRect(x, 0, 1.4 * scale, height);
  }
  if (stock.id === 'onionskin') {
    // Very faint long creases evoke thin stock without transparency/sorting or
    // extra geometry, and without reducing pigment opacity.
    for (let i = 0; i < 28; i += 1) {
      const x = random() * width;
      const y = random() * height;
      context.strokeStyle = i % 2 ? 'rgba(255,255,255,0.10)' : 'rgba(110,120,112,0.025)';
      context.lineWidth = 0.6 * scale;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + (random() - 0.5) * 100 * scale, y + (35 + random() * 110) * scale);
      context.stroke();
    }
  }
  context.fillStyle = 'rgba(100,96,81,0.035)';
  context.fillRect(0, 0, 3 * scale, height);
  context.fillRect(width - 3 * scale, 0, 3 * scale, height);
}
