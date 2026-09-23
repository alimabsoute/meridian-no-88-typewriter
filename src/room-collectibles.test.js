import * as THREE from 'three';
import { describe, it, expect, vi } from 'vitest';
import { PhiladelphiaRoomDecor, ROOM_DECOR_FOCUS } from './room-decor.js';
import { ROOM_COLLECTIBLE_MEDIA } from './room-collectibles.js';

describe('Room collectibles rendering budget and placement', () => {
  it('keeps the static collection outside the writing mechanism with no extra lights or transmission', () => {
    const decor = new PhiladelphiaRoomDecor({ parent: new THREE.Group(), documentRef: null });
    let draws = 0; let triangles = 0;
    decor.collection.traverse(object => {
      expect(object.isLight).not.toBe(true);
      if (!object.isMesh) return;
      draws++;
      triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
      expect(object.material.transmission ?? 0).toBe(0);
      expect(object.material.transparent).toBe(false);
      expect(object.geometry.attributes.position.array.every(Number.isFinite)).toBe(true);
    });
    expect(draws).toBeLessThanOrEqual(14);
    expect(triangles).toBeLessThan(6000);
    const bounds = new THREE.Box3().setFromObject(decor.collection);
    expect(new THREE.Box3().setFromObject(decor.collection.getObjectByName('CenteredReadingNook')).min.x).toBeGreaterThan(10.4);
    expect(decor.paperweight.scale.x).toBe(0.45);
    expect(bounds.max.x).toBeLessThan(18.5);
    const frame = decor.collection.getObjectByName('HungryDogsFramedPainting');
    expect(frame.getWorldPosition(new THREE.Vector3()).x).toBeCloseTo(ROOM_DECOR_FOCUS.painting[0]);
    const frameBounds = new THREE.Box3().setFromObject(frame);
    expect(frameBounds.min.x).toBeGreaterThan(10.4);
    expect(frameBounds.max.x).toBeLessThan(18.5);
    const nook = decor.collection.getObjectByName('CenteredReadingNook');
    const nookBounds = new THREE.Box3().setFromObject(nook);
    expect(nookBounds.min.y).toBeCloseTo(-1.15);
    expect(nookBounds.min.x).toBeGreaterThan(10.4);
    expect(nookBounds.max.x).toBeLessThan(18.5);
    const television = new THREE.Box3().setFromObject(decor.television);
    expect(television.getSize(new THREE.Vector3()).x).toBeGreaterThan(8);
    expect(television.min.x).toBeGreaterThan(-15);
    expect(television.max.x).toBeLessThan(-5.8);
    expect(television.getSize(new THREE.Vector3()).z).toBeGreaterThan(0.7);
    decor.dispose();
  });

  it('uses route-independent image URLs and retries transient errors twice', () => {
    const requests = [];
    const loader = { load: (url, success, progress, failure) => requests.push({url, success, failure}) };
    const decor = new PhiladelphiaRoomDecor({parent:new THREE.Group(), documentRef:null, textureLoader:loader});
    for (const path of Object.values(ROOM_COLLECTIBLE_MEDIA)) {
      expect(new URL(path, 'https://example.com/studio/').pathname).toBe(path);
    }
    const first = requests.find(r => r.url === ROOM_COLLECTIBLE_MEDIA.books);
    first.failure();
    const retry = requests.find(r => r.url === ROOM_COLLECTIBLE_MEDIA.books + '?retry=1');
    retry.success(new THREE.Texture());
    expect(decor.artLoadState.books).toBe('ready');
    expect(decor.collection.getObjectByName('FourWritersBookSpines').material.map).not.toBeNull();
    decor.dispose();
    const count = requests.length;
    requests.find(r => r.url === ROOM_COLLECTIBLE_MEDIA.painting).failure();
    expect(requests).toHaveLength(count);
  });

  it('requests each supplied image once, shares book texture, and disposes late loads', () => {
    const requests=[];
    const loader={load:(url,success)=>requests.push({url,success})};
    const decor = new PhiladelphiaRoomDecor({parent:new THREE.Group(), documentRef:null,textureLoader:loader});
    expect(requests.filter(r=>r.url===ROOM_COLLECTIBLE_MEDIA.books)).toHaveLength(1);
    expect(requests.filter(r=>r.url===ROOM_COLLECTIBLE_MEDIA.painting)).toHaveLength(1);
    const bookImage=new THREE.Texture();
    requests.find(r=>r.url===ROOM_COLLECTIBLE_MEDIA.books).success(bookImage);
    const spine=decor.collection.getObjectByName('FourWritersBookSpines');
    expect(spine.material.map).toBe(bookImage);
    expect(bookImage.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(bookImage.anisotropy).toBeLessThanOrEqual(8);
    const uv=spine.geometry.getAttribute('uv');
    for(let i=0;i<uv.count;i++) {
      expect(uv.getX(i)).toBeGreaterThan(0.2);
      expect(uv.getX(i)).toBeLessThan(0.8);
    }
    const disposed=vi.spyOn(bookImage,'dispose');
    decor.dispose();
    expect(disposed).toHaveBeenCalledOnce();
    const late=new THREE.Texture();
    const lateDisposal=vi.spyOn(late,'dispose');
    requests.find(r=>r.url===ROOM_COLLECTIBLE_MEDIA.painting).success(late);
    expect(lateDisposal).toHaveBeenCalledOnce();
  });
});
