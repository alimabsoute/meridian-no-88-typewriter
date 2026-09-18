import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { PhiladelphiaRoomDecor, ROOM_DECOR_MEDIA } from './room-decor.js';

const fixturePlaylist = [
  { id: 'first', title: 'First recording', src: ROOM_DECOR_MEDIA.film, source: 'https://archive.org/details/first', start: 0, end: 90 },
  { id: 'second', title: 'Second recording', src: './media/second-fixture.mp4', source: 'https://archive.org/details/second', start: 8, end: 75 },
];
function mediaFixture({ reducedMotion = false, tvPlaying = true, paused = false, protocol = 'https:', playlist = fixturePlaylist } = {}) {
  const video = new EventTarget();
  const attributes = new Map();
  const sourceAssignments = [];
  Object.assign(video, {
    readyState: 0,
    HAVE_CURRENT_DATA: 2,
    paused: true,
    currentTime: 0,
    duration: 120,
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: (name) => attributes.get(name),
    removeAttribute: (name) => attributes.delete(name),
    play: vi.fn(() => { video.paused = false; return Promise.resolve(); }),
    pause: vi.fn(() => { video.paused = true; }),
    load: vi.fn(),
  });
  Object.defineProperty(video, 'src', {
    set: (value) => {
      sourceAssignments.push({ source: value, crossOrigin: video.crossOrigin });
      attributes.set('src', value);
    },
    get: () => attributes.get('src'),
  });
  const documentRef = new EventTarget();
  documentRef.hidden = false;
  documentRef.location = { protocol };
  documentRef.createElement = vi.fn(() => video);
  const requests = [];
  const textureLoader = { load: (url, success, progress, failure) => requests.push({ url, success, failure }) };
  const parent = new THREE.Group();
  const decor = new PhiladelphiaRoomDecor({ parent, documentRef, textureLoader, reducedMotion, tvPlaying, paused, playlist });
  return { decor, parent, video, documentRef, requests, sourceAssignments };
}

describe('PhiladelphiaRoomDecor media lifecycle', () => {
  it('honors the saved room pause before assigning a source or attempting playback', async () => {
    const { decor, video, requests, sourceAssignments } = mediaFixture({ paused: true });
    expect(video.src).toBeUndefined();
    expect(video.play).not.toHaveBeenCalled();
    expect(sourceAssignments).toEqual([]);
    expect(decor.getState()).toMatchObject({ tvEnabled: true, paused: true, mediaStatus: 'poster' });
    const poster = new THREE.Texture();
    requests.find(({ url }) => url === ROOM_DECOR_MEDIA.poster).success(poster);
    expect(decor.screen.material.map).toBe(poster);
    decor.setPaused(true);
    expect(video.play).not.toHaveBeenCalled();
    decor.setPaused(false);
    await Promise.resolve();
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(sourceAssignments).toEqual([{ source: ROOM_DECOR_MEDIA.film, crossOrigin: 'anonymous' }]);
    expect(decor.getState().mediaStatus).toBe('playing');
    decor.dispose();
  });

  it('uses a dark, request-free fallback for ordinary file:// documents even after toggling controls', () => {
    const { decor, video, documentRef, requests, sourceAssignments } = mediaFixture({ protocol: 'file:' });
    expect(documentRef.createElement).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
    expect(sourceAssignments).toEqual([]);
    expect(decor.getState()).toMatchObject({ localFileMode: true, mediaStatus: 'local-file', paused: true, artLoaded: false });
    expect(decor.screen.material.map).toBeNull();
    expect(decor.artMaterials.every((material) => material.map === null)).toBe(true);
    decor.setTVPlaying(false);
    expect(decor.getState().mediaStatus).toBe('off');
    decor.setTVPlaying(true);
    decor.setPaused(true);
    decor.setPaused(false);
    decor.setReducedMotion(true);
    decor.setReducedMotion(false);
    documentRef.dispatchEvent(new Event('visibilitychange'));
    expect(decor.getState().mediaStatus).toBe('local-file');
    expect(decor.screen.material.map).toBeNull();
    expect(requests).toEqual([]);
    expect(video.play).not.toHaveBeenCalled();
    expect(sourceAssignments).toEqual([]);
    decor.dispose();
    expect(video.load).not.toHaveBeenCalled();
  });

  it('does not request or play the film when the saved TV preference is off', () => {
    const { decor, video } = mediaFixture({ tvPlaying: false });
    expect(video.src).toBeUndefined();
    expect(video.play).not.toHaveBeenCalled();
    expect(decor.getState()).toMatchObject({ tvEnabled: false, paused: true, mediaStatus: 'off' });
    expect(decor.screen.material.map).toBeNull();
    decor.dispose();
  });

  it('keeps television sound independent, clamps volume and never resumes a paused room', async () => {
    const { decor, video } = mediaFixture();
    await Promise.resolve();
    expect(video.muted).toBe(true);
    expect(video.volume).toBe(0.28);
    decor.setMuted(false);
    expect(video.muted).toBe(false);
    expect(decor.getState().muted).toBe(false);
    decor.setVolume(0.47);
    expect(video.volume).toBe(0.47);
    decor.setVolume(2);
    expect(video.volume).toBe(1);
    decor.setVolume(NaN);
    expect(video.volume).toBe(1);
    decor.setVolume(-1);
    expect(video.volume).toBe(0);
    decor.setPaused(true);
    const plays = video.play.mock.calls.length;
    decor.setMuted(true);
    decor.setMuted(false);
    decor.setVolume(0.3);
    expect(video.paused).toBe(true);
    expect(video.play).toHaveBeenCalledTimes(plays);
    decor.dispose();
  });

  it('defers the film for reduced motion, then respects pause, visibility and the TV switch independently', async () => {
    const { decor, video, documentRef } = mediaFixture({ reducedMotion: true });
    expect(video.src).toBeUndefined();
    expect(video.play).not.toHaveBeenCalled();
    decor.setReducedMotion(false);
    await Promise.resolve();
    expect(video.src).toBe(ROOM_DECOR_MEDIA.film);
    expect(video.muted && video.defaultMuted && !video.loop && video.playsInline).toBe(true);
    expect(decor.getState().mediaStatus).toBe('playing');

    decor.setPaused(true);
    expect(video.paused).toBe(true);
    documentRef.hidden = true;
    documentRef.dispatchEvent(new Event('visibilitychange'));
    decor.setPaused(false);
    expect(video.paused).toBe(true);
    documentRef.hidden = false;
    documentRef.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(video.paused).toBe(false);

    decor.setTVPlaying(false);
    decor.setPaused(true);
    decor.setPaused(false);
    expect(video.paused).toBe(true);
    decor.setTVPlaying(true);
    decor.setVisible(false);
    expect(video.paused).toBe(true);
    decor.setVisible(true);
    await Promise.resolve();
    expect(video.paused).toBe(false);
    decor.dispose();
  });

  it('freezes texture uploads when paused and releases media and late image results on disposal', async () => {
    const { decor, video, parent, requests, documentRef } = mediaFixture();
    await Promise.resolve();
    video.readyState = 2;
    video.dispatchEvent(new Event('loadeddata'));
    expect(decor.screen.material.map.isVideoTexture).toBe(true);
    const texture = decor.videoTexture;
    texture.update();
    const playingVersion = texture.version;
    decor.setPaused(true);
    for (let index = 0; index < 5; index += 1) texture.update();
    expect(texture.version).toBe(playingVersion);
    decor.setPaused(false);
    texture.update();
    expect(texture.version).toBeGreaterThan(playingVersion);

    const disposeTexture = vi.spyOn(texture, 'dispose');
    decor.dispose();
    decor.dispose();
    expect(parent.children).toHaveLength(0);
    expect(disposeTexture).toHaveBeenCalledTimes(1);
    expect(video.paused).toBe(true);
    expect(video.src).toBeUndefined();
    expect(video.load).toHaveBeenCalledTimes(1);
    const plays = video.play.mock.calls.length;
    documentRef.dispatchEvent(new Event('visibilitychange'));
    expect(video.play).toHaveBeenCalledTimes(plays);
    const lateImage = new THREE.Texture();
    const disposeLate = vi.spyOn(lateImage, 'dispose');
    requests.find(({ url }) => url === ROOM_DECOR_MEDIA.art).success(lateImage);
    expect(disposeLate).toHaveBeenCalledTimes(1);
  });

  it('does not replay or reset loading and settled status for repeated UI synchronization', async () => {
    const { decor, video, documentRef } = mediaFixture({ tvPlaying: false });
    let finishPlaying;
    video.play.mockImplementationOnce(() => {
      video.paused = false;
      return new Promise((resolve) => { finishPlaying = resolve; });
    });
    decor.setTVPlaying(true);
    const request = decor.playRequest;
    for (let index = 0; index < 4; index += 1) {
      decor.setTVPlaying(true);
      decor.setPaused(false);
      documentRef.dispatchEvent(new Event('visibilitychange'));
    }
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(video.load).not.toHaveBeenCalled();
    expect(decor.playRequest).toBe(request);
    expect(decor.getState().mediaStatus).toBe('loading');
    finishPlaying();
    await Promise.resolve();
    decor.setTVPlaying(true);
    decor.setPaused(false);
    expect(decor.getState().mediaStatus).toBe('playing');
    expect(video.play).toHaveBeenCalledTimes(1);
    decor.setPaused(true);
    const pauses = video.pause.mock.calls.length;
    decor.setPaused(true);
    expect(video.pause).toHaveBeenCalledTimes(pauses);
    decor.dispose();
  });

  it('darkens OFF even when late media arrives, and restores the frame when switched back on', async () => {
    const { decor, video, requests } = mediaFixture({ playlist: fixturePlaylist.slice(0, 1) });
    await Promise.resolve();
    video.readyState = 2;
    video.dispatchEvent(new Event('loadeddata'));
    const frame = decor.screen.material.map;
    const screenOn = decor.screen.material.color.clone();
    const ledOn = decor.ledMaterial.color.clone();
    decor.setPaused(true);
    expect(decor.screen.material.map).toBe(frame);
    expect(decor.screen.material.color.equals(screenOn)).toBe(true);
    decor.setTVPlaying(false);
    expect(decor.getState().mediaStatus).toBe('off');
    expect(decor.screen.material.map).toBeNull();
    expect(decor.screen.material.color.r).toBeLessThan(screenOn.r / 10);
    expect(decor.ledMaterial.color.r).toBeLessThan(ledOn.r / 10);
    requests.find(({ url }) => url === ROOM_DECOR_MEDIA.poster).success(new THREE.Texture());
    video.dispatchEvent(new Event('loadeddata'));
    expect(decor.screen.material.map).toBeNull();
    decor.setTVPlaying(true);
    expect(decor.screen.material.map).toBe(frame);
    expect(decor.screen.material.color.equals(screenOn)).toBe(true);
    expect(video.paused).toBe(true);
    decor.dispose();
  });

  it('keeps a still poster when media fails and permits a deliberate retry', async () => {
    const { decor, video, requests } = mediaFixture({ playlist: fixturePlaylist.slice(0, 1) });
    const poster = new THREE.Texture();
    requests.find(({ url }) => url === ROOM_DECOR_MEDIA.poster).success(poster);
    video.dispatchEvent(new Event('error'));
    expect(decor.getState().mediaStatus).toBe('unavailable');
    expect(decor.screen.material.map).toBe(poster);
    expect(video.paused).toBe(true);
    decor.setTVPlaying(true);
    expect(video.load).not.toHaveBeenCalled();
    expect(decor.getState().mediaStatus).toBe('unavailable');
    decor.setTVPlaying(false);
    decor.setTVPlaying(true);
    await Promise.resolve();
    expect(video.load).toHaveBeenCalledTimes(1);
    expect(decor.getState().mediaStatus).toBe('playing');
    decor.dispose();
  });

  it('advances excerpts, preserves sound settings, letterboxes 4:3 and wraps the playlist', async () => {
    const { decor, video } = mediaFixture();
    await Promise.resolve();
    decor.setVolume(0.42);
    decor.setMuted(false);
    video.currentTime = 90.1;
    video.dispatchEvent(new Event('timeupdate'));
    expect(decor.getState().clipIndex).toBe(1);
    expect(video.src).toBe(fixturePlaylist[1].src);
    video.videoWidth = 640;
    video.videoHeight = 480;
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(video.currentTime).toBe(8);
    expect(decor.screen.scale.x).toBeCloseTo(0.75);
    expect(decor.screen.scale.y).toBe(1);
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(0.42);
    video.dispatchEvent(new Event('ended'));
    expect(decor.getState().clipIndex).toBe(0);
    expect(video.src).toBe(fixturePlaylist[0].src);
    decor.dispose();
  });

  it('skips failed sources once, stops if every recording fails, and allows an explicit retry', async () => {
    const { decor, video } = mediaFixture();
    video.dispatchEvent(new Event('error'));
    expect(decor.getState().clipIndex).toBe(1);
    video.dispatchEvent(new Event('error'));
    expect(decor.getState().mediaStatus).toBe('unavailable');
    expect(video.paused).toBe(true);
    const plays = video.play.mock.calls.length;
    expect(decor.nextClip()).toBe(false);
    expect(video.play).toHaveBeenCalledTimes(plays);
    decor.nextClip({ retry: true });
    await Promise.resolve();
    expect(decor.getState().clipIndex).toBe(0);
    expect(decor.getState().mediaStatus).toBe('playing');
    decor.dispose();
  });

  it('does not fetch the next clip while television power or atmosphere motion is off', () => {
    const { decor, video, sourceAssignments } = mediaFixture({ tvPlaying: false });
    decor.nextClip();
    expect(decor.getState().clipIndex).toBe(1);
    expect(sourceAssignments).toEqual([]);
    decor.setPaused(true);
    decor.setTVPlaying(true);
    expect(video.play).not.toHaveBeenCalled();
    decor.setPaused(false);
    expect(sourceAssignments).toEqual([{ source: fixturePlaylist[1].src, crossOrigin: 'anonymous' }]);
    decor.dispose();
  });

  it('recovers from a source failing while hidden without fetching until the room returns', async () => {
    const { decor, video, documentRef, sourceAssignments } = mediaFixture();
    documentRef.hidden = true;
    documentRef.dispatchEvent(new Event('visibilitychange'));
    video.dispatchEvent(new Event('error'));
    expect(decor.getState().clipIndex).toBe(1);
    expect(sourceAssignments).toHaveLength(1);
    expect(video.paused).toBe(true);
    documentRef.hidden = false;
    documentRef.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(sourceAssignments).toHaveLength(2);
    expect(decor.getState().mediaStatus).toBe('playing');
    decor.dispose();
  });

  it('cancels old decoded-frame callbacks at each clip and on final disposal', () => {
    const { decor, video } = mediaFixture();
    const callbacks = new Map();
    let nextId = 0;
    video.requestVideoFrameCallback = (callback) => { callbacks.set(++nextId, callback); return nextId; };
    video.cancelVideoFrameCallback = (id) => callbacks.delete(id);
    video.readyState = 2;
    for (let index = 0; index < 6; index++) {
      video.dispatchEvent(new Event('loadeddata'));
      expect(callbacks.size).toBe(1);
      decor.nextClip();
      expect(callbacks.size).toBe(0);
    }
    video.dispatchEvent(new Event('loadeddata'));
    const pendingCallback = [...callbacks.values()][0];
    decor.dispose();
    expect(callbacks.size).toBe(0);
    pendingCallback();
    expect(callbacks.size).toBe(0);
  });
});
