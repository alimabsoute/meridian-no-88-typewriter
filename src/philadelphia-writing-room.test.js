import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { PhiladelphiaWritingRoom } from './philadelphia-writing-room.js';

describe('PhiladelphiaWritingRoom', () => {
  it('mounts as a stationary, configurable and disposable scene module', () => {
    const scene = new THREE.Scene();
    const events = [];
    const room = new PhiladelphiaWritingRoom({
      scene,
      quality: 'low',
      weather: 'rain',
      unease: 'subtle',
      onAtmosphereEvent: (event) => events.push(event),
    });

    expect(scene.getObjectByName('PhiladelphiaWritingRoom')).toBe(room.root);
    expect(scene.getObjectByName('PhiladelphiaBayWindow')).toBeTruthy();
    expect(scene.getObjectByName('RearRowhouseBrick')).toBeTruthy();
    expect(room.getState()).toMatchObject({
      stationary: true,
      weather: 'rain',
      unease: 'subtle',
      effectiveQuality: 'low',
    });
    expect(room.backdropMesh.visible).toBe(false);
    expect(room.environment.visible).toBe(true);
    expect(room.exterior.visible).toBe(false);
    expect(room.simplifiedPecoCrown.visible).toBe(false);
    expect(room.highPecoCrown.visible).toBe(false);
    expect(scene.getObjectByName('PECOTowerCrownLightsSimplifiedBroadFace')).toBeTruthy();
    expect(room.eveningAmbient.visible).toBe(true);
    expect(room.backdrop.weather).toBe('rain');

    room.update(1 / 60, 30);
    room.configure({ weather: 'snow', unease: 'off', eveningProgress: 0.8 });
    expect(room.getState()).toMatchObject({ weather: 'snow', unease: 'off', eveningProgress: 0.8 });
    expect(room.backdrop.weather).toBe('snow');

    room.setQuality('high');
    expect(room.backdropMesh.visible).toBe(false);
    expect(room.environment.visible).toBe(true);
    expect(room.exterior.visible).toBe(false);
    expect(room.exteriorVista.visible).toBe(false);
    expect(room.highExteriorHybrid.visible).toBe(false);
    expect(room.simplifiedPecoCrown.visible).toBe(false);
    expect(room.highPecoCrown.visible).toBe(false);
    expect(room.hybridRearMasses.isInstancedMesh).toBe(true);
    expect(room.hybridRoofDetails.isInstancedMesh).toBe(true);
    expect(room.exteriorVistaTexture.image).toBe(room.backdrop.texture.image);
    expect(room.exteriorVistaTexture.repeat.x).toBeCloseTo(368 / 960);
    expect(room.exteriorVistaTexture.repeat.y).toBeCloseTo(408 / 640);
    expect(room.eveningAmbient.visible).toBe(true);

    const instanceDisposals = [];
    room.root.traverse((object) => {
      if (object.isInstancedMesh) instanceDisposals.push(vi.spyOn(object, 'dispose'));
    });
    expect(instanceDisposals.length).toBeGreaterThanOrEqual(27);
    room.dispose();
    room.dispose();
    for (const spy of instanceDisposals) expect(spy).toHaveBeenCalledTimes(1);
    expect(scene.getObjectByName('PhiladelphiaWritingRoom')).toBeUndefined();
    expect(room.disposed).toBe(true);
    expect(events).toEqual([]);
  }, 15_000);

  it('moves dimensional leaves and preserves the bay and skyline across quality tiers', () => {
    const scene = new THREE.Scene();
    const room = new PhiladelphiaWritingRoom({
      scene,
      quality: 'medium',
      weather: 'autumn-wind',
      unease: 'off',
      seed: 211,
    });

    expect(room.getState()).toMatchObject({
      weather: 'autumn-wind',
      weatherLevels: { rain: 0, snow: 0, wind: 0.38, cloud: 0.28, leaves: 1 },
    });
    expect(room.backdrop.weather).toBe('autumn-wind');
    expect(room.autumnLeaves.name).toBe('ExteriorAutumnLeaves');
    expect(room.autumnLeaves.visible).toBe(false);
    expect(room.livingCity.root.visible).toBe(true);
    expect(room.autumnLeaves.count).toBe(5);

    const before = Array.from(room.livingCity.leaves.instanceMatrix.array);
    const glassDrift = room.glassAtmosphereMaterial.uniforms.drift.value;
    room.update(1 / 30);
    expect(Array.from(room.livingCity.leaves.instanceMatrix.array)).not.toEqual(before);
    expect(room.glassAtmosphereMaterial.uniforms.drift.value).toBeGreaterThan(glassDrift);
    expect(room.simplifiedWindowDepth.visible).toBe(false);
    expect(room.livingCity.crownFront.isMesh).toBe(true);
    expect(room.livingCity.crownSide.rotation.y).toBeCloseTo(Math.PI / 2);
    for (const tier of ['low', 'medium', 'high']) {
      room.setQuality(tier);
      expect(room.livingCity.root.visible).toBe(true);
      expect(room.root.getObjectByName('OneLibertyPlace')).toBeTruthy();
      expect(room.root.getObjectByName('ComcastCenter')).toBeTruthy();
    }
    expect(room.depthFrame.isInstancedMesh).toBe(true);
    room.dispose();
  }, 15_000);

  it('keeps precipitation, leaves, automatic weather, and ambient cues static with reduced motion', () => {
    const scene = new THREE.Scene();
    const room = new PhiladelphiaWritingRoom({
      scene,
      quality: 'high',
      weather: 'autumn-wind',
      unease: 'unsettling',
      reducedMotion: true,
      seed: 211,
    });

    const actorPositions = room.livingCity.actors.map(({object}) => object.position.toArray());
    const treeRotations = room.livingCity.trees.map(({tree}) => tree.rotation.toArray());
    const leafMatrices = Array.from(room.livingCity.leaves.instanceMatrix.array);
    const glassDrift = room.glassAtmosphereMaterial.uniforms.drift.value;
    const initialState = room.getState();
    room.update(30, 300);

    expect(Array.from(room.livingCity.leaves.instanceMatrix.array)).toEqual(leafMatrices);
    expect(room.getState().weatherLevels).toEqual(initialState.weatherLevels);
    expect(room.getState().uneaseSignal).toBe(0);
    expect(room.elapsed).toBe(0);
    expect(room.livingCity.actors.map(({object}) => object.position.toArray())).toEqual(actorPositions);
    expect(room.livingCity.trees.map(({tree}) => tree.rotation.toArray())).toEqual(treeRotations);
    expect(room.glassAtmosphereMaterial.uniforms.drift.value).toBe(glassDrift);

    room.setWeatherPreset('nor-easter');
    const rainPositions = Array.from(room.rainPositions);
    const snowPositions = Array.from(room.snowPositions);
    room.update(30, 300);
    expect(Array.from(room.rainPositions)).toEqual(rainPositions);
    expect(Array.from(room.snowPositions)).toEqual(snowPositions);

    room.setWeatherPreset('automatic');
    const frozenAutomatic = room.getState().weatherLevels;
    room.update(30, 330);
    expect(room.getState().weatherLevels).toEqual(frozenAutomatic);
    room.dispose();
  }, 15_000);

  it('scrolls a ribbed two-face PECO Crown Lights message behind the window depth layers', () => {
    const scene = new THREE.Scene();
    const room = new PhiladelphiaWritingRoom({
      scene,
      quality: 'medium',
      weather: 'quiet',
      unease: 'off',
      seed: 211,
    });

    const initial = room.getState().pecoCrown;
    const crownBox = room.backdrop.layout.peco.crown;
    const crownBytes = () => {
      const pixels = [];
      const { data, width, height } = room.backdrop.texture.image;
      for (let y = 0; y < crownBox.height; y += 1) {
        const start = (((height - 1 - crownBox.y - y) * width) + crownBox.x) * 4;
        pixels.push(...data.subarray(start, start + crownBox.width * 4));
      }
      return pixels;
    };
    const realTexture = room.livingCity.crownFront.material.map;
    expect(realTexture.image).toBe(room.backdrop.texture.image);
    const initialRealVersion = realTexture.version;
    const initialPixels = crownBytes();
    const backdropVersion = room.backdrop.texture.version;
    const backdropTextureDispose = vi.spyOn(room.backdrop.texture, 'dispose');
    const vistaTextureDispose = vi.spyOn(room.exteriorVistaTexture, 'dispose');
    const backdropMaterialDispose = vi.spyOn(room.backdrop.material, 'dispose');
    expect(initial).toMatchObject({
      name: 'PECO Crown Lights',
      scrollOffset: 0,
      staticFrame: true,
      broadColumns: 40,
      sideColumns: 19,
    });
    expect(room.backdrop.texture.userData.pecoCrown).toMatchObject({
      animatedInPlace: true,
      broadColumns: 40,
      sideColumns: 19,
    });
    expect(room.simplifiedPecoBroadFace.isObject3D).toBe(true);
    expect(room.simplifiedPecoBroadFace.isMesh).not.toBe(true);
    expect(room.simplifiedPecoBroadFace.position.z).toBe(room.backdropMesh.position.z);
    expect(room.simplifiedPecoBroadFace.position.z).toBeLessThan(-5.73);

    room.update(0.075, 1);
    expect(room.getState().pecoCrown).toMatchObject({ staticFrame: true, scrollOffset: 0 });
    expect(crownBytes()).toEqual(initialPixels);

    room.update(0.075, 8.2);
    const advanced = room.getState().pecoCrown;
    expect(advanced.staticFrame).toBe(false);
    expect(advanced.scrollOffset).toBeGreaterThan(0);
    expect(advanced.frame).toBeGreaterThan(initial.frame);
    expect(crownBytes()).not.toEqual(initialPixels);
    expect(realTexture.version).toBeGreaterThan(initialRealVersion);
    expect(room.backdrop.texture.version).toBeGreaterThan(backdropVersion);
    expect(room.backdrop.texture.updateRanges).toHaveLength(crownBox.height);
    expect(room.exteriorVistaTexture.updateRanges).toHaveLength(crownBox.height);

    room.setQuality('high');
    expect(room.getState().pecoCrown).toEqual(advanced);
    expect(room.simplifiedPecoCrown.visible).toBe(false);
    expect(room.highPecoCrown.visible).toBe(false);

    room.setReducedMotion(true);
    const staticCrown = room.getState().pecoCrown;
    expect(staticCrown.staticFrame).toBe(true);
    expect(staticCrown.scrollOffset).toBe(0);
    room.update(30, 300);
    expect(room.getState().pecoCrown).toEqual(staticCrown);
    room.setReducedMotion(false);
    room.update(0.075, 8.4);
    expect(room.getState().pecoCrown.staticFrame).toBe(false);
    expect(room.getState().pecoCrown.scrollOffset).toBeGreaterThan(advanced.scrollOffset);
    room.dispose();
    room.dispose();
    expect(backdropTextureDispose).toHaveBeenCalledTimes(1);
    expect(vistaTextureDispose).toHaveBeenCalledTimes(1);
    expect(backdropMaterialDispose).toHaveBeenCalledTimes(1);
  }, 15_000);
  it('locks both PECO display faces while rebuilding the surrounding skyline', () => {
    const room = new PhiladelphiaWritingRoom({scene:new THREE.Scene(),quality:'low',weather:'quiet'});
    try {
      const {crownFront,crownSide,landmarks}=room.livingCity;
      expect(crownFront.position.toArray()).toEqual([6,6.3,-24.2]);
      expect(crownFront.geometry.parameters).toMatchObject({width:3.18,height:.61});
      expect(crownSide.position.toArray()).toEqual([7.62,6.3,-25]);
      expect(crownSide.geometry.parameters).toMatchObject({width:1.55,height:.61});
      expect(crownSide.rotation.y).toBeCloseTo(Math.PI/2);
      expect(crownFront.material.map.image).toBe(room.backdrop.texture.image);
      expect(crownSide.material.map.image).toBe(room.backdrop.texture.image);
      const names=landmarks.architecture.map(a=>a.name);
      expect(new Set(names)).toEqual(new Set(['OneLibertyPlace','TwoLibertyPlace','ComcastCenter','ComcastTechnologyCenter','BNYMellonCenter','ThreeLoganSquare','FMCTower','CiraCentre']));
      const lookup=name=>landmarks.architecture.find(a=>a.name===name);
      expect(lookup('ComcastTechnologyCenter').height).toBeGreaterThan(lookup('ComcastCenter').height);
      expect(lookup('OneLibertyPlace').height).toBeGreaterThan(lookup('TwoLibertyPlace').height);
      // The new landmarks occupy a real depth range behind the near PECO anchor.
      expect(lookup('CiraCentre').z).toBeGreaterThan(-25);
      expect(lookup('OneLibertyPlace').z).toBeLessThan(lookup('CiraCentre').z-5);
      for(const tier of ['medium','high','low']) {
        room.setQuality(tier);room.update(.05,12);
        expect(crownFront.position.toArray()).toEqual([6,6.3,-24.2]);
        expect(crownSide.position.toArray()).toEqual([7.62,6.3,-25]);
        expect(landmarks.root.visible).toBe(true);
      }
    } finally {room.dispose();}
  },15000);

  it('places Cira light panels on inclined side faces and freezes their shader clock when motion stops', () => {
    const room = new PhiladelphiaWritingRoom({scene:new THREE.Scene(),quality:'low',weather:'quiet'});
    try {
      const {landmarks}=room.livingCity;
      const {ciraLEDs,officeLights}=landmarks;
      const matrix=new THREE.Matrix4(), normal=new THREE.Vector3();const normals=new Set();
      for(let i=0;i<ciraLEDs.count;i++){
        ciraLEDs.getMatrixAt(i,matrix);
        normal.set(0,0,1).transformDirection(matrix);
        normals.add(normal.toArray().map(v=>v.toFixed(2)).join(','));
        expect(matrix.elements.every(Number.isFinite)).toBe(true);
      }
      // This rejects a flat billboard: front + beveled corner + side have
      // substantially different outward normals, including sloping facade Y.
      expect(normals.size).toBeGreaterThanOrEqual(3);
      expect([...normals].some(n=>Math.abs(Number(n.split(',')[0]))>.5)).toBe(true);
      expect([...normals].some(n=>Math.abs(Number(n.split(',')[1]))>.005)).toBe(true);
      const seeds=officeLights.geometry.getAttribute('aSeed').array;
      expect(Math.max(...seeds)-Math.min(...seeds)).toBeGreaterThan(.3);
      const initial=ciraLEDs.material.uniforms.uTime.value;
      room.update(.05,15);
      expect(ciraLEDs.material.uniforms.uTime.value).toBeGreaterThan(initial);
      expect(officeLights.material.uniforms.uTime).toBe(ciraLEDs.material.uniforms.uTime);
      room.setReducedMotion(true);
      const frozen=ciraLEDs.material.uniforms.uTime.value;
      room.update(.075,60);
      expect(ciraLEDs.material.uniforms.uTime.value).toBe(frozen);
      room.setReducedMotion(false);room.update(.05,61);
      expect(ciraLEDs.material.uniforms.uTime.value).toBeGreaterThan(frozen);
    } finally {room.dispose();}
  },15000);

  it('replaces block traffic with a volumetric detailed masonry streetscape', () => {
    const room=new PhiladelphiaWritingRoom({scene:new THREE.Scene(),quality:'low',weather:'quiet'});
    try {
      expect(room.livingCity.root.getObjectByName('PassingStreetCar')).toBeUndefined();
      expect(room.livingCity.actors.every(({object})=>object.name!=='PassingStreetCar')).toBe(true);
      const {group}=room.livingCity.streetscape;
      const bounds=new THREE.Box3().setFromObject(group);const size=bounds.getSize(new THREE.Vector3());
      expect(size.x).toBeGreaterThan(20);expect(size.y).toBeGreaterThan(3);expect(size.z).toBeGreaterThan(2);
      // Check rendered geometry after batching, rather than semantic name markers.
      let vertices=0;const heights=new Set(),depths=new Set();
      group.traverse(object=>{
        if(!object.isMesh)return;
        const position=object.geometry.getAttribute('position');vertices+=position.count;
        for(let i=0;i<position.count;i++){heights.add(position.getY(i).toFixed(2));depths.add(position.getZ(i).toFixed(2));}
      });
      expect(vertices).toBeGreaterThan(10000);
      expect(heights.size).toBeGreaterThan(30);expect(depths.size).toBeGreaterThan(30);
      expect(Number.isFinite(bounds.min.x+ bounds.max.z)).toBe(true);
      expect(room.livingCity.leaves.count).toBe(150);
    } finally {room.dispose();}
  },15000);

  it('lands airborne leaves on the sidewalk and bounds their lifetime and count', () => {
    const room = new PhiladelphiaWritingRoom({scene: new THREE.Scene(),weather:'autumn-wind',quality:'low'});
    const leaf = room.livingCity.leafData[149]; leaf.y = 0.001; leaf.rest = 100;
    room.livingCity.update(12,1,room.weatherState);
    expect(leaf.y).toBe(-0.12);
    for(let i=0;i<500;i++) room.livingCity.update(12+i*0.075,0.075,room.weatherState);
    expect(room.livingCity.leaves.count).toBe(150);
    expect(room.livingCity.leafData.every(l => Number.isFinite(l.x) && l.y >= -0.12)).toBe(true);
    leaf.y=-0.12;leaf.rest=-1;leaf.visibility=0.01;
    room.livingCity.update(0,0.1,{...room.weatherState,wind:1});
    expect(leaf.y).toBeGreaterThan(2);
    expect(leaf.visibility).toBe(0);
    for(const actor of room.livingCity.actors) {
      const expectedGround=actor.object.name==='DistantPedestrian'?-0.18:-0.32;
      expect(actor.object.position.y).toBe(expectedGround);
      const bounds=new THREE.Box3().setFromObject(actor.object);
      expect(bounds.min.y).toBeGreaterThanOrEqual(expectedGround-0.003);
      expect(bounds.min.y).toBeLessThanOrEqual(expectedGround+0.003);
    }
    room.dispose();
  }, 15000);

});
