/** A pinned upper edge with gravity curl and damped handling response.
 * UVs remain untouched: the exact impression texture follows the sheet.
 */
export function paperFlexOffset(x, y, width, height, { curl = 1, impulse = 0, progress = 0, reducedMotion = false } = {}) {
  const nx = x / (width * 0.5);
  const free = Math.max(0, Math.min(1, 0.5 - y / height));
  const sag = free * free;
  const movement = reducedMotion ? 0 : Math.sin(progress * Math.PI * 3) * Math.sin(progress * Math.PI) * impulse;
  return width * (0.038 * curl * sag + 0.013 * curl * nx * nx * free
    + movement * 0.045 * sag * Math.cos(nx * 1.2));
}

export function flexPaperGeometry(geometry, base, width, height, options = {}) {
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i += 1) {
    const offset = i * 3;
    const x = base[offset];
    const y = base[offset + 1];
    positions.setXYZ(i, x, y, base[offset + 2] + paperFlexOffset(x, y, width, height, options));
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

/** Vertex indices around a PlaneGeometry perimeter, without duplicate corners. */
export function paperPerimeterIndices(columns, rows) {
  const result = [];
  for (let x = 0; x < columns; x += 1) result.push(x);
  for (let y = 0; y < rows; y += 1) result.push(y * (columns + 1) + columns);
  for (let x = columns; x > 0; x -= 1) result.push(rows * (columns + 1) + x);
  for (let y = rows; y > 0; y -= 1) result.push(y * (columns + 1));
  return result;
}
