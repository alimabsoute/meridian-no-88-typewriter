import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTelevisionSurface, quadToCssMatrix3d } from '../src/television-surface.js';

const sourceCorners = [[0, 0], [960, 0], [960, 540], [0, 540]];
function transformPoint(css, x, y) {
  const m = css.slice(9, -1).split(',').map(Number);
  assert.equal(m.length, 16);
  const divisor = m[3] * x + m[7] * y + m[15];
  return { x: (m[0] * x + m[4] * y + m[12]) / divisor,
    y: (m[1] * x + m[5] * y + m[13]) / divisor };
}
function verifyCorners(css, expected, tolerance = 0.002) {
  sourceCorners.forEach(([x, y], i) => {
    const actual = transformPoint(css, x, y);
    assert.ok(Math.abs(actual.x - expected[i].x) < tolerance, `corner ${i} x`);
    assert.ok(Math.abs(actual.y - expected[i].y) < tolerance, `corner ${i} y`);
  });
}
for (const quad of [
  [{x:20,y:30},{x:400,y:30},{x:400,y:250},{x:20,y:250}],
  [{x:10,y:55},{x:370,y:15},{x:450,y:260},{x:45,y:230}],
  [{x:-120,y:20},{x:500,y:150},{x:430,y:400},{x:-80,y:300}],
]) verifyCorners(quadToCssMatrix3d(quad), quad);
assert.equal(quadToCssMatrix3d([{x:0,y:0},{x:0,y:0},{x:2,y:1},{x:0,y:1}]), null);
assert.equal(quadToCssMatrix3d([{x:0,y:0},{x:2,y:2},{x:2,y:0},{x:0,y:2}]), null);
assert.equal(quadToCssMatrix3d([{x:NaN,y:0},{x:2,y:0},{x:2,y:2},{x:0,y:2}]), null);

// Lightweight DOM doubles, actual Three cameras/matrices. No browser/media
// decoding claim: these checks validate projection, visibility and ownership.
let writes = 0;
const attributes = new Map([['src', 'https://example.invalid/existing.mp4'], ['crossorigin', 'anonymous']]);
const video = {
  readyState: 4, paused: false, error: null,
  classList: { add(name) { assert.equal(name, 'television-video-surface'); } },
  style: new Proxy({}, { set(target, name, value) { if (name === 'transform') writes++; target[name] = value; return true; } }),
  removeAttribute(name) { attributes.delete(name); },
  setAttribute(name, value) { attributes.set(name, value); },
  pause() { throw new Error('Surface must not own playback'); },
  play() { throw new Error('Surface must not own playback'); },
  load() { throw new Error('Surface must not reload the decoder'); },
  remove() { parent.children = parent.children.filter(child => child !== this); },
};
let parentRect = {left:40,top:30,width:1200,height:800};
let canvasRect = {left:52,top:42,width:1150,height:750};
const canvas = {getBoundingClientRect: () => canvasRect};
const parent = {
  children: [], clientLeft:2, clientTop:2, scrollLeft:0, scrollTop:0,
  appendChild(child) { this.children.push(child); },
  querySelector() { return canvas; },
  getBoundingClientRect: () => parentRect,
};
const scene = new THREE.Scene();
const group = new THREE.Group(); group.position.set(0.3,0.4,-0.6); group.rotation.set(0.1,0.23,0.025);scene.add(group);
const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.18,5.18*9/16));
screen.position.set(0,0.015,0.509);group.add(screen);
const camera = new THREE.PerspectiveCamera(43,1150/750,0.1,100);
camera.position.set(3,2,9);camera.lookAt(0,0,0);
const decor = {video,screen,root:group,tvEnabled:true,visible:true,mediaError:false,disposed:false};
const surface = createTelevisionSurface({parent,decor,camera});
assert.deepEqual(parent.children, [video], 'reuses the sole existing decoder');
assert.equal(attributes.has('crossorigin'), false);
assert.equal(attributes.get('src'), 'https://example.invalid/existing.mp4');
assert.equal(surface.update(), true);
const firstWrites = writes;
assert.equal(surface.update(), true);
assert.equal(writes, firstWrites, 'stationary transform must not rewrite styles');

for (const [width,height,position] of [[1150,750,[3,2,9]], [420,860,[0.2,1,10]], [1800,900,[-3,2,9]]]) {
  canvasRect = {...canvasRect,width,height};
  parentRect = {...parentRect,width:width+50,height:height+50};
  camera.aspect=width/height;camera.position.fromArray(position);camera.lookAt(0,0,0);camera.updateProjectionMatrix();
  assert.equal(surface.update(), true);
  const expected = [[-2.59,2.59*9/16],[2.59,2.59*9/16],[2.59,-2.59*9/16],[-2.59,-2.59*9/16]].map(([x,y])=>{
    const projected=new THREE.Vector3(x,y,0).applyMatrix4(screen.matrixWorld).project(camera);
    return {x:canvasRect.left-parentRect.left-parent.clientLeft+(projected.x+1)*width/2,
      y:canvasRect.top-parentRect.top-parent.clientTop+(1-projected.y)*height/2};
  });
  verifyCorners(video.style.transform,expected);
}
video.paused=true;decor.paused=true;decor.reducedMotion=true;
assert.equal(surface.update(),true,'powered paused frame remains visible');
decor.tvEnabled=false;assert.equal(surface.update(),false);assert.equal(video.style.visibility,'hidden');decor.tvEnabled=true;
decor.visible=false;assert.equal(surface.update(),false);decor.visible=true;
group.visible=false;assert.equal(surface.update(),false);group.visible=true;
video.readyState=1;assert.equal(surface.update(),false);video.readyState=2;
decor.mediaError=true;assert.equal(surface.update(),false);decor.mediaError=false;
video.error={code:4};assert.equal(surface.update(),false);video.error=null;
camera.position.set(0,0,-10);camera.lookAt(0,0,0);assert.equal(surface.update(),false,'backface hidden');
camera.position.set(0,0,10);camera.lookAt(0,0,20);assert.equal(surface.update(),false,'behind camera hidden');
camera.lookAt(0,0,0);assert.equal(surface.update(),true);
decor.disposed=true;assert.equal(surface.update(),false);decor.disposed=false;
surface.dispose();surface.dispose();
assert.equal(surface.update(),false);
assert.equal(parent.children.length,0);
assert.equal(attributes.get('src'),'https://example.invalid/existing.mp4','disposal leaves media ownership with decor');
screen.geometry.dispose();screen.material.dispose();
console.log('PASS: TV homography, responsive camera alignment, visibility, retained paused frame, decoder ownership, cached transforms and disposal (Node/Three; no browser decoding test).');
