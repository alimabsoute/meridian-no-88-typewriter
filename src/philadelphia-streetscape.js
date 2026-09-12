import * as THREE from 'three';

// Delancey and St. James are the references: attached masonry houses, individual
// rooflines, real window openings and bay returns, rather than painted boxes.
export function createPhiladelphiaStreetscape(room, parent) {
  const group = new THREE.Group();
  group.name = 'RittenhouseMasonryStreetscape';
  parent.add(group);
  const geometryCache = new Map();
  const material = (color, options = {}) => room._material(new THREE.MeshStandardMaterial({
    color, roughness: 0.82, ...options,
  }));
  function surface(kind) {
    const size = 512;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const course = kind === 'brick' ? 24 : 72;
      const width = kind === 'brick' ? 76 : 148;
      const row = Math.floor(y / course);
      const xx = (x + (row % 2) * width * 0.5) % width;
      const joint = y % course < 2 || xx < 2;
      const grain = ((x * 13 + y * 17 + (x * y) % 43) % 17) - 8;
      const unit = (Math.floor((x + (row % 2) * width * 0.5) / width) * 11 + row * 7) % 19;
      const value = joint ? 106 : 195 + grain + unit;
      const index = (y * size + x) * 4;
      data[index] = value; data[index + 1] = value; data[index + 2] = value; data[index + 3] = 255;
    }
    const texture = room._texture(new THREE.DataTexture(data, size, size, THREE.RGBAFormat));
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  }
  const brickTexture = surface('brick');
  const stoneTexture = surface('stone');
  const brick = material(0x874c3c, { map: brickTexture, bumpMap: brickTexture, bumpScale: 0.009 });
  const darkBrick = material(0x623c32, { map: brickTexture, bumpMap: brickTexture, bumpScale: 0.009 });
  const brownstone = material(0x8b6c57, { map: stoneTexture, bumpMap: stoneTexture, bumpScale: 0.007 });
  const blueMarble = material(0x929b99, { map: stoneTexture, bumpMap: stoneTexture, bumpScale: 0.005 });
  const paleStone = material(0xb5aa95, { map: stoneTexture, bumpMap: stoneTexture, bumpScale: 0.004 });
  const weatheredStone = material(0x8b8072, { map: stoneTexture, bumpMap: stoneTexture, bumpScale: 0.004 });
  const cornice = material(0x4b4942);
  const slate = material(0x36444b, { metalness: 0.12, roughness: 0.71 });
  const slateLight = material(0x53616a, { metalness: 0.1, roughness: 0.74 });
  const copper = material(0x536a60, { metalness: 0.45, roughness: 0.64 });
  const roofSnow = { value: Math.max(0, Math.min(1, room.weatherState?.snow ?? 0)) };
  // Snow follows the real mansard, dormer and conical roof normals. Blending
  // these existing roof materials adds no covering boxes or additional draws.
  for (const roofMaterial of [slate, slateLight, copper]) {
    roofMaterial.onBeforeCompile = shader => {
      shader.uniforms.streetscapeSnow = roofSnow;
      shader.vertexShader = 'varying float vRoofSnowUp;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        vRoofSnowUp = max(0.0, inverseTransformDirection(transformedNormal, viewMatrix).y);`);
      shader.fragmentShader = 'uniform float streetscapeSnow; varying float vRoofSnowUp;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float roofSnowCoverage = smoothstep(0.18, 0.72, vRoofSnowUp) * streetscapeSnow * 0.96;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.79, 0.82, 0.85), roofSnowCoverage);`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.94, roofSnowCoverage);`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.0, roofSnowCoverage);`);
    };
    roofMaterial.customProgramCacheKey = () => 'rittenhouse-sloped-roof-snow-v1';
  }
  const iron = material(0x252c2b, { metalness: 0.55, roughness: 0.55 });
  const wood = material(0x38453e, { roughness: 0.6 });
  const oxblood = material(0x502e29, { roughness: 0.62 });
  const dark = material(0x141b1e);
  const glass = material(0x344a50, { roughness: 0.19, metalness: 0.55 });
  const litGlass = material(0x9e8861, { emissive: 0xe9b66c, emissiveIntensity: 0.29, roughness: 0.27, metalness: 0.17 });
  const curtain = material(0xb8ab8f, { roughness: 0.93 });
  const bronze = material(0x9d8050, { metalness: 0.7, roughness: 0.38 });
  const terracotta = material(0x72513b);
  const planting = material(0x3e4c35);
  const cylinder = room._geometry(new THREE.CylinderGeometry(1, 1, 1, 8));
  function box(name, x, y, z, w, h, d, mat, host = group, rotation = 0) {
    // World-scale UVs keep mortar courses fine on both broad walls and piers.
    const key = `${w.toFixed(4)},${h.toFixed(4)},${d.toFixed(4)}`;
    let geometry = geometryCache.get(key);
    if (!geometry) {
      geometry = room._geometry(new THREE.BoxGeometry(w, h, d));
      const p = geometry.attributes.position, n = geometry.attributes.normal, uv = geometry.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        const u = Math.abs(n.getX(i)) > 0.5 ? p.getZ(i) : p.getX(i);
        const v = Math.abs(n.getY(i)) > 0.5 ? p.getZ(i) : p.getY(i);
        uv.setXY(i, u * 1.35, v * 1.35);
      }
      geometryCache.set(key, geometry);
    }
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.name = name; mesh.position.set(x, y, z); mesh.rotation.y = rotation;
    host.add(mesh); return mesh;
  }
  function rod(name, a, b, radius, mat, host = group) {
    const delta = new THREE.Vector3().subVectors(b, a);
    const mesh = new THREE.Mesh(cylinder, mat);
    mesh.name = name; mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.scale.set(radius, delta.length(), radius);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    host.add(mesh);
  }
  function arch(name, x, y, z, width, height, mat, pointed = false, host = group) {
    // Curved trim is assembled from fine voussoirs so it has thickness and joints.
    const count = 14;
    for (let i = 0; i < count; i++) {
      const t0 = i / count, t1 = (i + 1) / count;
      const curve = t => new THREE.Vector3(x + (t - 0.5) * width,
        y + (pointed ? (1 - Math.abs(t * 2 - 1)) ** 0.72 : Math.sin(Math.PI * t)) * height, z);
      rod(name, curve(t0), curve(t1), 0.025, mat, host);
    }
  }
  function window(x, y, z, w, h, trim, warm, host = group, gothic = false) {
    box('DeepWindowInterior', x, y, z - 0.065, w, h, 0.05, dark, host);
    box('WindowGlassBehindReveal', x, y, z - 0.032, w - 0.065, h - 0.055, 0.015, warm ? litGlass : glass, host);
    for (const side of [-1, 1]) {
      box('MasonryWindowReveal', x + side * (w / 2 + 0.017), y, z + 0.005, 0.034, h + 0.05, 0.145, trim, host);
      box('PaintedSashStile', x + side * (w / 2 - 0.035), y, z + 0.025, 0.023, h - 0.035, 0.035, cornice, host);
      if (warm) box('InsetLinenCurtain', x + side * w * 0.29, y + 0.015, z - 0.016, w * 0.13, h - 0.11, 0.012, curtain, host);
    }
    box('ProjectingStoneSill', x, y - h / 2 - 0.033, z + 0.043, w + 0.15, 0.056, 0.23, trim, host);
    box('StoneWindowLintel', x, y + h / 2 + 0.027, z + 0.028, w + 0.1, 0.048, 0.18, trim, host);
    box('SashMeetingRail', x, y - 0.01, z + 0.039, w - 0.025, 0.021, 0.028, cornice, host);
    box('FineWindowMullion', x, y, z + 0.039, 0.016, h - 0.035, 0.028, cornice, host);
    if (gothic) arch('GothicMarbleDripMolding', x, y + h / 2 + 0.075, z + 0.065, w + 0.16, 0.15, trim, true, host);
  }
  function railing(x, y, z, width, host = group) {
    box('IronHandrail', x, y + 0.24, z, width, 0.023, 0.023, iron, host);
    box('IronLowerRail', x, y + 0.045, z, width, 0.017, 0.021, iron, host);
    for (let i = 0; i <= Math.floor(width / 0.095); i++) {
      const xx = x - width / 2 + i * 0.095;
      box('SlenderIronBaluster', xx, y + 0.14, z, 0.014, 0.25, 0.014, iron, host);
      box('BalusterCollar', xx, y + 0.15, z, 0.025, 0.027, 0.025, iron, host);
    }
  }
  function door(x, z, trim, index, host) {
    box('DeepDoorwayShadow', x, 0.53, z - 0.08, 0.5, 0.91, 0.06, dark, host);
    box('PaintedPanelDoor', x, 0.52, z - 0.025, 0.42, 0.76, 0.065, index % 2 ? wood : oxblood, host);
    for (const side of [-1, 1]) {
      box('DoorStoneJamb', x + side * 0.275, 0.56, z + 0.025, 0.08, 0.91, 0.19, trim, host);
      for (let j = 0; j < 3; j++) {
        box('RaisedDoorPanelBead', x + side * 0.1, 0.29 + j * 0.21, z + 0.015, 0.155, 0.155, 0.02, cornice, host);
        box('RecessedDoorPanel', x + side * 0.1, 0.29 + j * 0.21, z + 0.027, 0.125, 0.122, 0.011, index % 2 ? wood : oxblood, host);
      }
    }
    box('DoorTransomGlass', x, 0.974, z - 0.025, 0.44, 0.12, 0.025, litGlass, host);
    arch('CarvedFanlightHood', x, 1.03, z + 0.045, 0.6, 0.155, trim, false, host);
    for (const angle of [-0.8, 0, 0.8]) rod('FanlightRadialLead', new THREE.Vector3(x, 1.025, z + 0.06), new THREE.Vector3(x + Math.sin(angle) * 0.2, 1.12 + Math.cos(angle) * 0.025, z + 0.06), 0.007, iron, host);
    box('BrassDoorFurniture', x + 0.12, 0.55, z + 0.066, 0.025, 0.057, 0.028, bronze, host);
    for (let step = 0; step < 3; step++) box('WornStoneStoop', x, -0.09 + step * 0.055, z + 0.32 - step * 0.105, 0.75, 0.11, 0.37, trim, host);
    for (const side of [-1, 1]) {
      rod('StoopHandrail', new THREE.Vector3(x + side * 0.35, 0.19, z + 0.5), new THREE.Vector3(x + side * 0.35, 0.4, z + 0.08), 0.014, iron, host);
      for (let j = 0; j < 3; j++) box('StoopBaluster', x + side * 0.35, 0.115 + j * 0.067, z + 0.45 - j * 0.15, 0.012, 0.23 + j * 0.01, 0.012, iron, host);
    }
  }
  function mansard(x, eave, z, w, index, host) {
    const roofGeometry = room._geometry(new THREE.CylinderGeometry(0.7, 1, 0.56, 4, 1));
    roofGeometry.rotateY(Math.PI / 4);
    const roof = new THREE.Mesh(roofGeometry, slate);
    roof.name = 'FourSlopedMansardPlanes';
    roof.scale.set(w / Math.SQRT2, 1, 1.8 / Math.SQRT2);
    roof.position.set(x, eave + 0.27, z - 0.77); host.add(roof);
    // Separate horizontal slate courses catch grazing light on the roof slope.
    for (let row = 0; row < 6; row++) {
      const yy = eave + row * 0.084;
      const zz = z + 0.12 - row * 0.058;
      box('MansardSlateCourse', x, yy, zz, w - row * 0.092, 0.009, 0.015, row % 3 ? slate : slateLight, host);
    }
    for (const side of [-1, 1]) {
      const dx = x + side * w * 0.24;
      box('DormerBody', dx, eave + 0.24, z - 0.018, 0.41, 0.39, 0.32, brownstone, host);
      window(dx, eave + 0.24, z + 0.15, 0.255, 0.28, paleStone, index % 4 === 0, host);
      const cap = new THREE.Mesh(room._geometry(new THREE.ConeGeometry(0.34, 0.17, 4)), slate);
      cap.name = 'DormerPitchedCap'; cap.rotation.y = Math.PI / 4;
      cap.scale.z = 0.8; cap.position.set(dx, eave + 0.5, z + 0.035); host.add(cap);
    }
  }

  const houses = [];
  for (let index = 0; index < 11; index++) {
    const x = -10.5 + index * 2.5;
    const front = [-17.8, -18.15, -17.7, -18.35, -17.6, -17.9, -18.4, -17.75, -18.2, -17.6, -17.95][index];
    const height = [2.38, 2.65, 2.04, 2.64, 2.5, 2.39, 1.94, 2.55, 2.6, 2.1, 2.48][index];
    const w = 2.46;
    const host = new THREE.Group(); host.name = `DelanceyHouse${index + 1}`; group.add(host);
    const face = index % 4 === 0 ? brownstone : index % 4 === 2 ? blueMarble : index % 3 === 0 ? darkBrick : brick;
    const gothic = index === 2 || index === 8;
    const trim = gothic ? paleStone : index % 4 === 0 ? brownstone : index % 4 === 2 ? blueMarble : weatheredStone;
    const flatRoof = index === 1 || index === 4 || index === 7;
    // Set-back core plus an open facade grid creates genuine recessed openings.
    box('MasonryHouseCore', x, height / 2 - 0.1, front - 1.03, w, height, 1.72, face, host);
    box('DressedStoneWaterTable', x, 0.12, front - 0.01, w, 0.13, 0.2, trim, host);
    const floorCenters = height < 2.3 ? [0.64, 1.36] : [0.64, 1.36, height - 0.38];
    const columns = [x - 0.73, x, x + 0.73];
    for (let floor = 0; floor < floorCenters.length; floor++) {
      const yy = floorCenters[floor];
      box('BrickSpandrelCourse', x, yy - 0.36, front - 0.04, w, 0.16, 0.2, face, host);
      for (const xx of [x - 1.11, x - 0.365, x + 0.365, x + 1.11]) box('MasonryPier', xx, yy, front - 0.04, 0.23, 0.6, 0.2, face, host);
      for (let col = 0; col < 3; col++) {
        if (floor === 0 && col === 0) continue;
        window(columns[col], yy, front + 0.012, 0.46, 0.52, trim, (index + floor * 3 + col) % 5 === 0, host, gothic);
      }
    }
    door(columns[0], front + 0.045, trim, index, host);
    for (let band = 0; band < 3; band++) box('CarvedCorniceBand', x, height - 0.06 + band * 0.043, front - 0.82 + band * 0.025, w + 0.07 + band * 0.045, 0.044, 1.95 + band * 0.06, band === 1 ? trim : cornice, host);
    for (let j = 0; j < 15; j++) box('CorniceDentil', x - 1.12 + j * 0.16, height - 0.115, front + 0.14, 0.065, 0.07, 0.105, trim, host);
    if (flatRoof) {
      box('ItalianateFlatRoof', x, height + 0.04, front - 0.86, w + 0.13, 0.065, 2.05, slate, host);
      box('ItalianateParapet', x, height + 0.15, front + 0.06, w + 0.1, 0.21, 0.16, face, host);
      box('ParapetStoneCoping', x, height + 0.27, front + 0.065, w + 0.19, 0.055, 0.23, trim, host);
      for (let c = 0; c < 7; c++) {
        const xx = x - 1.08 + c * 0.36;
        box('ItalianateCorniceBracket', xx, height - 0.11, front + 0.16, 0.085, 0.19, 0.25, cornice, host);
        box('ItalianateBracketFoot', xx, height - 0.2, front + 0.075, 0.11, 0.047, 0.14, trim, host);
      }
    } else mansard(x, height + 0.03, front, w + 0.1, index, host);
    box('BrickChimneyStack', x + 0.72, height + 0.38, front - 1.12, 0.27, 0.4, 0.31, darkBrick, host);
    box('ChimneyCoping', x + 0.72, height + 0.58, front - 1.12, 0.33, 0.055, 0.37, trim, host);
    for (const side of [-1, 1]) {
      const pot = new THREE.Mesh(cylinder, brownstone); pot.name = 'TerracottaChimneyPot';
      pot.scale.set(0.043, 0.125, 0.043); pot.position.set(x + 0.72 + side * 0.067, height + 0.66, front - 1.12); host.add(pot);
    }
    // Three-faced semi-hexagonal bays: each angled return carries real glazing.
    if (index % 3 !== 2) {
      const bx = x + 0.37;
      for (let floor = 1; floor < floorCenters.length; floor++) {
        const yy = floorCenters[floor];
        const bay = new THREE.Group(); bay.name = 'ProjectingSemiHexagonalBay'; bay.position.set(bx, yy, front + 0.32); host.add(bay);
        for (const [xx, zz, angle, bw] of [[0, 0.23, 0, 0.57], [-0.43, 0.07, -0.8, 0.45], [0.43, 0.07, 0.8, 0.45]]) {
          const panel = new THREE.Group(); panel.position.set(xx, 0, zz); panel.rotation.y = angle; bay.add(panel);
          window(0, 0, 0, bw - 0.065, 0.5, trim, (index + floor) % 4 === 0, panel);
          box('BayApronPanel', 0, -0.32, -0.005, bw + 0.04, 0.105, 0.16, face, panel);
        }
        box('BayProjectingCornice', 0, 0.34, 0.07, 1.06, 0.055, 0.58, trim, bay);
        for (const side of [-1, 1]) box('BayStoneBracket', side * 0.35, -0.4, -0.03, 0.095, 0.16, 0.24, trim, bay);
      }
    }
    railing(x + 0.48, -0.12, front + 0.82, 1.32, host);
    // A narrow basement area, curb and drain keep the street from being a flat strip.
    box('BasementAreaShadow', x + 0.48, -0.145, front + 0.46, 1.32, 0.055, 0.52, dark, host);
    box('StoneAreaCoping', x + 0.48, -0.095, front + 0.84, 1.43, 0.055, 0.13, trim, host);
    for (let j = 0; j < 4; j++) box('SidewalkPavingSlab', x - 0.91 + j * 0.61, -0.205, front + 1.18, 0.59, 0.095, 0.65, blueMarble, host);
    if (index % 2 === 0) {
      const planter = new THREE.Mesh(room._geometry(new THREE.CylinderGeometry(0.115, 0.085, 0.18, 14)), terracotta);
      planter.name = 'StoopTerracottaPlanter'; planter.position.set(x - 0.24, -0.04, front + 0.49); host.add(planter);
      const leafGeometry = room._geometry(new THREE.PlaneGeometry(0.075, 0.023));
      for (let sprig = 0; sprig < 18; sprig++) {
        const angle = sprig * 2.4;
        const stemTop = new THREE.Vector3(x - 0.24 + Math.cos(angle) * 0.07, 0.08 + (sprig % 4) * 0.035, front + 0.49 + Math.sin(angle) * 0.07);
        rod('PlanterStem', new THREE.Vector3(x - 0.24, 0.03, front + 0.49), stemTop, 0.003, planting, host);
        const leaf = new THREE.Mesh(leafGeometry, planting); leaf.name = 'PlanterLeaf'; leaf.position.copy(stemTop); leaf.rotation.set(-0.65 + (sprig % 3) * 0.4, angle, 0.2); host.add(leaf);
      }
    }
    houses.push({ x, front, height, group: host });
  }
  // One corner accent after the Neff house: curved bay and a copper conical cap.
  const corner = houses[0];
  const bay = new THREE.Mesh(room._geometry(new THREE.CylinderGeometry(0.37, 0.37, 1.83, 20)), brownstone);
  bay.name = 'NeffInspiredCylindricalCornerBay'; bay.position.set(corner.x - 0.85, 1.49, corner.front + 0.08); group.add(bay);
  for (let floor = 0; floor < 2; floor++) for (const angle of [-0.85, 0, 0.85]) {
    const panel = new THREE.Group(); panel.position.set(corner.x - 0.85 + Math.sin(angle) * 0.35, 1.15 + floor * 0.7, corner.front + 0.08 + Math.cos(angle) * 0.35); panel.rotation.y = angle; group.add(panel);
    window(0, 0, 0, 0.26, 0.46, paleStone, floor === 0, panel);
  }
  const cap = new THREE.Mesh(room._geometry(new THREE.ConeGeometry(0.45, 0.49, 24)), copper);
  cap.name = 'NeffInspiredConicalCopperRoof'; cap.position.set(corner.x - 0.85, 2.67, corner.front + 0.08); group.add(cap);
  // Static batching is material-based, preserving detailed shapes with few draws.
  if (room._batchStaticMeshes) room._batchStaticMeshes(group, 'RittenhouseArchitecture');
  return {
    group, houses,
    bounds: { minX: -11.9, maxX: 15.9, minZ: -20.3, maxZ: -16.09, maxY: 3.38 },
    applyWeather(weather) {
      const amount = Number(weather?.snow);
      roofSnow.value = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0;
    },
    get snowAmount() { return roofSnow.value; },
  };
}
