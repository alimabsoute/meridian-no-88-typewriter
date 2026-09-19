import * as THREE from 'three';

const MAP_ANCHOR = '#include <map_fragment>';
const FOG_ANCHOR = '#include <fog_fragment>';

// Alpha on these opaque page maps stores glyph coverage, not transparency.
// RGB keeps the ordinary textured paper for its physical lighting and fibers.
const SAMPLE_INK = /* glsl */`
  #ifdef USE_MAP
    float octoberInkCoverage = clamp(sampledDiffuseColor.a, 0.0, 1.0);
    vec3 octoberSampleSRGB = sRGBTransferOETF(vec4(sampledDiffuseColor.rgb, 1.0)).rgb;
    // Canvas pigment is composited in sRGB. Stock has an r-g difference of
    // approximately 0.035-0.05; subtract its remaining contribution before
    // deciding whether this particular impression came from the red ribbon.
    // Very faint antialiased/mip edges are approximate; solid pigment is exact.
    float octoberPigmentChroma = (octoberSampleSRGB.r - octoberSampleSRGB.g
      - (1.0 - octoberInkCoverage) * 0.05) / max(octoberInkCoverage, 0.035);
    float octoberRedInk = smoothstep(0.18, 0.40, octoberPigmentChroma);
    diffuseColor.a = opacity;
  #endif
`;

const FINISH_INK = /* glsl */`
  #ifdef USE_MAP
    // Apply pigment after scene exposure, output conversion and fog. This
    // keeps black neutral while the surrounding stock retains warm lighting.
    vec3 octoberPigmentSRGB = mix(vec3(0.02), vec3(0.667, 0.031, 0.071), octoberRedInk);
    vec3 octoberPigmentLinear = sRGBTransferEOTF(vec4(octoberPigmentSRGB, 1.0)).rgb;
    vec3 octoberPigmentOutput = linearToOutputTexel(vec4(octoberPigmentLinear, 1.0)).rgb;
    // Keep a fully inked core after minification. Mixing even 10% of the bright
    // warm stock into a fine black stroke made it visibly brown at Front view.
    // The soft coverage ramp retains antialiased edges without threshold speckle.
    float octoberInkOpacity = smoothstep(0.025, 0.82, octoberInkCoverage);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, octoberPigmentOutput, octoberInkOpacity);
    // At overview scale a whole stem can be an antialiased edge. Keep those
    // black edge pixels neutral too, while leaving untouched stock warm.
    float octoberNeutralEdge = (1.0 - octoberRedInk) * smoothstep(0.02, 0.20, octoberInkCoverage);
    float octoberInkLuma = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(octoberInkLuma), octoberNeutralEdge);
  #endif
`;

/** Opaque, physically lit stock with neutral pigment from a packed coverage map. */
export function createPaperMaterial(parameters = {}) {
  const material = new THREE.MeshPhysicalMaterial({
    roughness: 1,
    metalness: 0,
    specularIntensity: 0,
    envMapIntensity: 0,
    side: THREE.DoubleSide,
    ...parameters,
  });
  material.onBeforeCompile = shader => {
    if (!material.map?.userData?.inkCoverage) return;
    if (!shader.fragmentShader.includes(MAP_ANCHOR) || !shader.fragmentShader.includes(FOG_ANCHOR)) {
      throw new Error('Paper ink shader anchors are missing; update the material patch for this Three.js version.');
    }
    shader.fragmentShader = shader.fragmentShader
      .replace(MAP_ANCHOR, `${MAP_ANCHOR}\n${SAMPLE_INK}`)
      .replace(FOG_ANCHOR, `${FOG_ANCHOR}\n${FINISH_INK}`);
  };
  material.customProgramCacheKey = () => `october-paper-ink-v1:${material.map?.userData?.inkCoverage ? 'coverage' : 'ordinary'}`;
  return material;
}
