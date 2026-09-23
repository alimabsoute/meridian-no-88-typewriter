import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const ROOM_COLLECTIBLE_MEDIA = Object.freeze({
  books: '/media/room-art/writers-four-books.png',
  painting: '/media/room-art/hungry-dogs-painting.png',
});

export const ROOM_DECOR_FOCUS = Object.freeze({
  television: Object.freeze([-10.4, 5.072, -5.222]),
  readingNook: Object.freeze([14.6, 4.0, -4.7]),
  books: Object.freeze([13.6592, 1.8194, -4.2]),
  painting: Object.freeze([14.6, 6.3, -5.83]),
});

// Static geometry and two source images only. The photos are preserved verbatim;
// UVs select individual book spines without allocating four duplicate textures.
export function buildRoomCollectibles(decor) {
  const root = new THREE.Group();
  root.name = 'PhiladelphiaWritersCollection';
  decor.root.add(root);
  // Keep art and console aligned, with breathing room beside the window.
  const nook = new THREE.Group();
  nook.name = 'CenteredReadingNook';
  nook.scale.set(0.84, 0.84, 1);
  nook.position.set(14.6 - 11.6 * 0.84, -0.1798, 0);
  root.add(nook);
  const material = (name, parameters) => {
    const value = decor._material(new THREE.MeshStandardMaterial(parameters));
    value.name = name;
    return value;
  };
  const walnut = material('ConsoleHoneyWalnut', { color: 0x88603b, roughness: 0.65 });
  const darkWood = material('ConsoleInsetWalnut', { color: 0x513520, roughness: 0.71 });
  // Small deterministic grain texture adds close-range surface detail without
  // downloading a third image or adding a material/shader pass.
  const grainPixels = new Uint8Array(256 * 128 * 4);
  for (let y=0;y<128;y++) for (let x=0;x<256;x++) {
    const wave = Math.sin(y * 1.12 + Math.sin(x * 0.023) * 2.4);
    const fine = Math.sin(y * 5.71 + x * 0.12) * 0.045;
    const shade = 0.81 + wave * 0.11 + fine;
    const i = (y * 256 + x) * 4;
    grainPixels[i] = Math.round(255 * shade);
    grainPixels[i+1] = Math.round(239 * shade);
    grainPixels[i+2] = Math.round(215 * shade);
    grainPixels[i+3] = 255;
  }
  const grain = decor._texture(new THREE.DataTexture(grainPixels,256,128));
  grain.generateMipmaps = true;
  grain.minFilter = THREE.LinearMipmapLinearFilter;
  grain.magFilter = THREE.LinearFilter;
  grain.needsUpdate = true;
  walnut.map = grain;
  darkWood.map = grain;
  const gold = material('AgedPictureFrameGold', { color: 0x9b733a, metalness: 0.74, roughness: 0.4 });
  const pages = material('BookPageEdges', { color: 0xb7a583, roughness: 1 });
  const covers = material('ClothBookCovers', { color: 0x302721, roughness: 0.85 });
  const red = decor._material(new THREE.MeshPhysicalMaterial({ color: 0xbe1421, metalness: 0.23, roughness: 0.22, clearcoat: 0.75, clearcoatRoughness: 0.21 }));
  red.name = 'LoveSculptureLacquer';
  const green = material('BottleGreenGlass', { color: 0x263b24, metalness: 0.3, roughness: 0.19 });
  const cream = material('BottlePaperLabel', { color: 0xd7bd84, roughness: 0.93 });
  const crystal = material('CutCrystalFacets', { color: 0xbeb09a, metalness: 0.62, roughness: 0.21 });
  const batches = new Map();
  const batch = (geometry, mat, position, rotation = [0, 0, 0]) => {
    geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(1, 1, 1)));
    const list = batches.get(mat) ?? [];
    list.push(geometry.index ? geometry.toNonIndexed() : geometry);
    if (geometry.index) geometry.dispose();
    batches.set(mat, list);
  };
  const box = (size, pos, mat) => batch(new THREE.BoxGeometry(...size), mat, pos);
  // The narrow console sits behind the desk and beneath the painting.
  box([4.7, 0.18, 1.46], [11.6, 1.30, -4.45], walnut);
  box([4.58, 0.48, 1.28], [11.6, 0.97, -4.47], darkWood);
  for (const x of [10.44, 12.76]) {
    box([2.15, 0.37, 0.07], [x, 0.98, -3.79], walnut);
    batch(new THREE.SphereGeometry(0.044, 12, 8), gold, [x, 0.98, -3.715]);
  }
  for (const x of [9.49, 13.71]) for (const z of [-4.99, -3.9]) {
    box([0.16, 2.15, 0.16], [x, -0.08, z], walnut);
  }
  box([4.26, 0.09, 1.16], [11.6, -0.79, -4.45], walnut);
  // Real page blocks, raised cover boards and marble bookends provide parallax.
  const bookMaterial = material('UserSuppliedBookSpines', { color: 0xffffff, roughness: 0.87 });
  const bookSpines = [];
  const bounds = [[327, 548], [553, 742], [752, 974], [988, 1132]];
  const widths = [0.53, 0.455, 0.535, 0.347];
  let left = 9.63;
  bounds.forEach(([pixelLeft, pixelRight], index) => {
    const width = widths[index];
    const height = [2.25, 2.23, 2.25, 2.24][index];
    const x = left + width / 2;
    box([width - 0.025, height - 0.055, 0.59], [x, 1.40 + height / 2, -4.38], pages);
    for (const edge of [-1, 1]) box([0.022, height, 0.71], [x + edge * (width / 2 - 0.011), 1.4 + height / 2, -4.35], covers);
    const face = new THREE.PlaneGeometry(width, height);
    const uv = face.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i,
      (pixelLeft + uv.getX(i) * (pixelRight - pixelLeft)) / 1448,
      (1086 - 1028 + uv.getY(i) * (1028 - 83)) / 1086);
    bookSpines.push(face.translate(x, 1.4 + height / 2, -3.982));
    // Fine exposed page lines are geometry only and merge into one draw call.
    for (let line = 0; line < 13; line++) box([width - 0.052, 0.006, 0.55], [x, 1.43 + height - 0.035 - line * 0.01, -4.39], covers);
    left += width + 0.022;
  });
  const spineGeometry = mergeGeometries(bookSpines);
  bookSpines.forEach((geometry) => geometry.dispose());
  decor._mesh(spineGeometry, bookMaterial, nook, 'FourWritersBookSpines', 0, 0, 0);
  for (const x of [9.49, 11.69]) {
    box([0.15, 0.78, 0.8], [x, 1.78, -4.34], darkWood);
    box([0.31, 0.045, 0.82], [x + (x < 10 ? 0.08 : -0.08), 1.415, -4.34], gold);
  }
  // Solid green glass avoids a scene-wide transmission pass. A shaped shoulder,
  // neck, foil and wrap label read clearly from the room and inspection camera.
  const bottleX = 13.10;
  const profile = [[0.15, 0], [0.19, 0.04], [0.19, 0.66], [0.175, 0.80], [0.071, 0.99], [0.065, 1.35]];
  batch(new THREE.LatheGeometry(profile.map(([x,y]) => new THREE.Vector2(x,y)), 28), green, [bottleX, 1.40, -4.36]);
  batch(new THREE.CylinderGeometry(0.068, 0.069, 0.20, 24), red, [bottleX, 2.69, -4.36]);
  batch(new THREE.CylinderGeometry(0.192, 0.192, 0.43, 28, 1, true), cream, [bottleX, 1.80, -4.36]);
  for (const y of [1.62, 1.99]) batch(new THREE.TorusGeometry(0.195, 0.007, 4, 28), gold, [bottleX, y, -4.36], [Math.PI / 2, 0, 0]);
  // Two faceted, genuinely hollow tumblers: opaque reflective cut surfaces,
  // rather than expensive refraction or transparent sorting layers.
  for (const x of [12.64, 13.55]) {
    batch(new THREE.LatheGeometry([[0.105,0], [0.14,0.035], [0.175,0.36], [0.158,0.36], [0.122,0.05], [0.105,0.05]].map(([x,y])=>new THREE.Vector2(x,y)), 12), crystal, [x, 1.40, -3.99]);
  }
  const flush = (parent) => {
    for (const [mat, geometries] of batches) {
      const geometry = mergeGeometries(geometries);
      geometries.forEach((part) => part.dispose());
      const mesh = decor._mesh(geometry, mat, parent, `Collection${mat.name}`, 0, 0, 0);
      mesh.castShadow = true;
    }
    batches.clear();
  };
  flush(nook);
  const paintingGroup = new THREE.Group();
  paintingGroup.name = 'RaisedGalleryPainting';
  paintingGroup.scale.set(1.5, 1.5, 1);
  paintingGroup.position.set(14.6 - 11.6 * 1.5, 6.3 - 5.45 * 1.5, 0);
  root.add(paintingGroup);
  // User artwork already contains its ornate frontal frame. A real wood case
  // and gold outer edge carry that frame around its sides at close angles.
  const picture = material('UserSuppliedHungryDogsArtwork', { color: 0xffffff, roughness: 0.86 });
  box([5.0, 3.333, 0.17], [11.6, 5.45, -5.79], darkWood);
  for (const x of [9.105, 14.095]) box([0.035, 3.333, 0.21], [x, 5.45, -5.755], gold);
  for (const y of [3.793, 7.107]) box([4.98, 0.033, 0.21], [11.6, y, -5.755], gold);
  const artwork = new THREE.PlaneGeometry(4.98, 3.32);
  // Remove only the source image's neutral outer backdrop; keep the full frame.
  const uv = artwork.getAttribute('uv');
  for (let i=0;i<uv.count;i++) uv.setXY(i, (20 + uv.getX(i)*1496)/1536, (1024-985 + uv.getY(i)*966)/1024);
  decor._mesh(artwork, picture, paintingGroup, 'HungryDogsFramedPainting', 11.6, 5.45, -5.671);
  flush(paintingGroup);
  // Custom serif silhouettes reproduce the tilted O and stacked LOVE profile.
  const polygon = (points) => new THREE.Shape(points.map(([x,y])=>new THREE.Vector2(x,y)));
  const letters = [
    polygon([[0,0],[1.02,0],[1.02,0.40],[0.85,0.40],[0.79,0.20],[0.37,0.20],[0.37,1.08],[0.54,1.12],[0.54,1.27],[0,1.27],[0,1.12],[0.16,1.08],[0.16,0.18],[0,0.14]]),
    polygon([[0,1.27],[0.51,1.27],[0.51,1.12],[0.38,1.08],[0.65,0.34],[0.91,1.08],[0.78,1.12],[0.78,1.27],[1.22,1.27],[1.22,1.12],[1.09,1.08],[0.70,0],[0.44,0],[0.06,1.08],[0,1.12]]),
    polygon([[0,0],[1.02,0],[1.02,0.35],[0.86,0.35],[0.80,0.18],[0.37,0.18],[0.37,0.56],[0.66,0.56],[0.70,0.45],[0.84,0.45],[0.84,0.86],[0.70,0.86],[0.66,0.73],[0.37,0.73],[0.37,1.09],[0.80,1.09],[0.86,0.93],[1.02,0.93],[1.02,1.27],[0,1.27],[0,1.12],[0.16,1.08],[0.16,0.18],[0,0.14]]),
  ];
  const o = new THREE.Shape();
  o.absellipse(0,0,0.61,0.68,0,Math.PI*2,false,0);
  const hole = new THREE.Path();
  hole.absellipse(0,0,0.32,0.47,0,Math.PI*2,true,0);
  o.holes.push(hole);
  const extrude = (shape) => new THREE.ExtrudeGeometry(shape, { depth:0.34, bevelEnabled:true, bevelSize:0.025, bevelThickness:0.025, bevelSegments:3, curveSegments:20, steps:1 });
  batch(extrude(letters[0]), red, [5.78,1.48,-0.15]);
  batch(extrude(o), red, [7.45,2.13,0], [0,0,-0.32]);
  batch(extrude(letters[1]), red, [5.78,0.16,-0.15]);
  batch(extrude(letters[2]), red, [7.0,0.16,-0.15]);
  const paperweight = new THREE.Group();
  paperweight.name = 'LoveManuscriptPaperweight';
  flush(paperweight);
  // Center the original sculpture at its feet, then make it desk-paperweight sized.
  for (const mesh of paperweight.children) mesh.geometry.translate(-6.9, -0.135, 0);
  paperweight.scale.setScalar(0.45);
  root.add(paperweight);
  decor.paperweight = paperweight;
  root.updateMatrixWorld(true);
  // Loading never blocks studio construction and late callbacks are disposed.
  decor.artLoadState = { books: 'loading', painting: 'loading' };
  const load = (url, target, key, attempt = 0) => {
    if (!decor.loader || decor.localFileMode || decor.disposed) return;
    decor.loader.load(attempt ? `${url}?retry=${attempt}` : url, texture => {
      if (decor.disposed) { texture.dispose(); return; }
      target.map = decor._texture(texture);
      target.needsUpdate = true;
      decor.artLoadState[key] = 'ready';
      if (target === picture) decor.artLoaded = true;
    }, undefined, () => {
      if (decor.disposed) return;
      if (attempt < 2) load(url, target, key, attempt + 1);
      else {
        decor.artLoadState[key] = 'failed';
        console.warn(`Room artwork could not load: ${url}`);
      }
    });
  };
  load(ROOM_COLLECTIBLE_MEDIA.books, bookMaterial, 'books');
  load(ROOM_COLLECTIBLE_MEDIA.painting, picture, 'painting');
  decor.artMaterials = [picture, bookMaterial];
  return root;
}
