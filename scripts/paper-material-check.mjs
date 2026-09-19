import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPaperMaterial } from '../src/paper-material.js';

const map = new THREE.Texture();
map.userData.inkCoverage = true;
const material = createPaperMaterial({ map });
assert.ok(material.isMeshPhysicalMaterial);
assert.equal(material.transparent, false);
assert.equal(material.specularIntensity, 0);
assert.equal(material.roughness, 1);
const shader = { fragmentShader: THREE.ShaderLib.physical.fragmentShader };
material.onBeforeCompile(shader);
assert.ok(shader.fragmentShader.includes('diffuseColor.a = opacity;'), 'coverage must not make blank stock transparent');
assert.ok(shader.fragmentShader.indexOf('octoberInkCoverage =') > shader.fragmentShader.indexOf('#include <map_fragment>'));
assert.ok(shader.fragmentShader.indexOf('gl_FragColor.rgb = mix') > shader.fragmentShader.indexOf('#include <fog_fragment>'));
assert.ok(shader.fragmentShader.indexOf('gl_FragColor.rgb = mix') < shader.fragmentShader.indexOf('#include <premultiplied_alpha_fragment>'));
assert.ok(shader.fragmentShader.includes('linearToOutputTexel'), 'pigment must honor the renderer output color space');
const coverageRamp = shader.fragmentShader.match(/float\s+octoberInkOpacity\s*=\s*smoothstep\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*octoberInkCoverage\s*\)/);
assert.ok(coverageRamp, 'final ink must use the soft coverage ramp');
assert.equal(Number(coverageRamp[1]), 0.025);
assert.equal(Number(coverageRamp[2]), 0.82);
assert.match(shader.fragmentShader, /gl_FragColor\.rgb\s*=\s*mix\(gl_FragColor\.rgb,\s*octoberPigmentOutput,\s*octoberInkOpacity\)/, 'the corrected coverage opacity must drive the final blend');
const blackPigment = shader.fragmentShader.match(/octoberPigmentSRGB\s*=\s*mix\(vec3\(\s*([\d.]+)\s*\)/);
assert.ok(blackPigment, 'neutral black must be a single equal-channel pigment');
const blackSRGB = Number(blackPigment[1]);
function inkOpacity(coverage) {
  const edge0 = Number(coverageRamp[1]);
  const edge1 = Number(coverageRamp[2]);
  const normalized = Math.max(0, Math.min(1, (coverage - edge0) / (edge1 - edge0)));
  return normalized * normalized * (3 - 2 * normalized);
}
assert.equal(inkOpacity(0), 0, 'unprinted stock must retain its physical lighting');
assert.equal(inkOpacity(0.82), 1, 'minified stroke cores must become fully inked');
let previousOpacity = 0;
for (let step = 1; step <= 100; step++) {
  const opacity = inkOpacity(step / 100);
  assert.ok(opacity >= previousOpacity && opacity <= 1, 'antialiased edge coverage must remain smooth and monotonic');
  previousOpacity = opacity;
}
let neutralCoreCases = 0;
for (const background of [[1, 1, 1], [1, 0.55, 0.1], [0.1, 0.4, 0.8], [0, 0, 0], [0.8, 0.62, 0.4]]) {
  for (const coverage of [0.85, 0.9, 0.95, 1]) {
    const opacity = inkOpacity(coverage);
    const rendered = background.map(channel => Math.round((channel * (1 - opacity) + blackSRGB * opacity) * 255));
    assert.deepEqual(rendered, [5, 5, 5], `black core must stay neutral over ${background}, coverage ${coverage}`);
    neutralCoreCases++;
  }
}
assert.throws(() => material.onBeforeCompile({ fragmentShader: 'void main() {}' }), /anchors/);
const coverageKey = material.customProgramCacheKey();
material.map = new THREE.Texture();
assert.notEqual(material.customProgramCacheKey(), coverageKey);
const ordinaryShader = { fragmentShader: THREE.ShaderLib.physical.fragmentShader };
material.onBeforeCompile(ordinaryShader);
assert.equal(ordinaryShader.fragmentShader, THREE.ShaderLib.physical.fragmentShader, 'ordinary texture maps retain standard physical shading');

function classifyRed(rgb, coverage) {
  const chroma = (rgb[0] - rgb[1] - (1 - coverage) * 0.05) / Math.max(coverage, 0.035);
  const linear = Math.max(0, Math.min(1, (chroma - 0.18) / 0.22));
  return linear * linear * (3 - 2 * linear);
}
let pigmentCases = 0;
for (const stock of [[238, 229, 207], [233, 222, 197], [220, 208, 183]]) {
  for (const coverage of [0.1, 0.25, 0.5, 0.75, 1]) {
    for (const [pigment, expected] of [[[8, 8, 8], 0], [[170, 8, 18], 1]]) {
      const rgb = stock.map((channel, index) => (channel * (1 - coverage) + pigment[index] * coverage) / 255);
      assert.equal(classifyRed(rgb, coverage), expected, `${pigment} on ${stock}, coverage ${coverage}`);
      pigmentCases++;
    }
  }
}
material.dispose();
map.dispose();
console.log(`Paper material checks passed: shader order, opaque coverage, physical stock, output color space, ${pigmentCases} black/red classification cases, ${neutralCoreCases} neutral black core cases and smooth edge coverage. GPU rendering still requires browser verification.`);
