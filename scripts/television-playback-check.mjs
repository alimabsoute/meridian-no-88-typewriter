import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PhiladelphiaRoomDecor } from '../src/room-decor.js';

// Adapted from work/news-room-review.mjs: actual decor with an event-driven
// media double. This tests lifecycle contracts, not browser decoding/network.
function fixture(options = {}) {
  const attrs = new Map(), callbacks = new Map(), sources = [];
  const counts = { play:0, pause:0, load:0, crossOrigin:0, callback:0 };
  const video = new EventTarget();
  Object.assign(video, {
    readyState:0, paused:true, seeking:false, currentTime:0, duration:120,
    videoWidth:1280, videoHeight:720,
    setAttribute:(key,value)=>attrs.set(key,value), getAttribute:key=>attrs.get(key),
    removeAttribute:key=>attrs.delete(key),
    play:()=>{ counts.play++;video.paused=false;return Promise.resolve(); },
    pause:()=>{ counts.pause++;video.paused=true; },
    load:()=>{ counts.load++;video.readyState=0;video.currentTime=0; },
    requestVideoFrameCallback:callback=>{callbacks.set(++counts.callback,callback);return counts.callback;},
    cancelVideoFrameCallback:id=>callbacks.delete(id),
  });
  let crossOrigin;
  Object.defineProperty(video,'crossOrigin',{
    get:()=>crossOrigin,set:value=>{counts.crossOrigin++;crossOrigin=value;},
  });
  Object.defineProperty(video,'src',{
    get:()=>attrs.get('src'),set:value=>{sources.push(value);attrs.set('src',value);},
  });
  const doc=new EventTarget();
  Object.assign(doc,{hidden:false,location:{protocol:'https:'},createElement:()=>video});
  const parent=new THREE.Group();
  const playlist=[
    {id:'a',src:'/a.mp4',start:6,end:90},
    {id:'b',src:'/b.mp4',start:8,end:75},
    {id:'c',src:'/c.mp4',start:12,end:102},
  ];
  const decor=new PhiladelphiaRoomDecor({parent,documentRef:doc,textureLoader:{load(){}},
    playlist,nativeVideo:true,deferPlayback:true,...options});
  return {decor,video,doc,callbacks,sources,counts,parent,playlist,
    metadata(){video.dispatchEvent(new Event('loadedmetadata'));},
    data(){video.readyState=2;video.dispatchEvent(new Event('loadeddata'));},
    hidden(value){doc.hidden=value;doc.dispatchEvent(new Event('visibilitychange'));},
  };
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
let passed=0;
async function check(name, body) {
  await body();passed++;console.log(`PASS: ${name}`);
}

await check('native decoder never enables CORS, creates a VideoTexture, or schedules frame callbacks',async()=>{
  const f=fixture();
  try {
    assert.equal(f.counts.crossOrigin,0);
    f.decor.beginPlayback();await flush();f.data();
    f.video.dispatchEvent(new Event('playing'));
    assert.ok(!f.decor.videoTexture);
    assert.notEqual(f.decor.screenMaterial.map?.isVideoTexture,true);
    assert.equal([...f.decor.textures].some(texture=>texture.isVideoTexture),false);
    assert.equal(f.counts.callback,0);assert.equal(f.callbacks.size,0);
    assert.equal(f.counts.crossOrigin,0);
    f.video.videoWidth=640;f.video.videoHeight=480;f.metadata();
    assert.deepEqual(f.decor.screen.scale.toArray(),[1,1,1],'native CSS contains 4:3 inside full glass');
  } finally {f.decor.dispose();}
});

await check('entry defers all source/play work, starts at declared offset, and is idempotent',async()=>{
  const f=fixture();
  try {
    await flush();assert.equal(f.sources.length,0);assert.equal(f.counts.play,0);
    assert.equal(f.decor.getState().awaitingEntry,true);
    f.decor.setMuted(false);f.decor.setVolume(.36);
    assert.equal(f.sources.length,0);assert.equal(f.counts.play,0);
    assert.equal(f.decor.beginPlayback(),true);assert.equal(f.decor.beginPlayback(),false);
    await flush();assert.deepEqual(f.sources,['/a.mp4']);assert.equal(f.counts.play,1);
    assert.equal(f.decor.getState().awaitingEntry,false);
    f.metadata();assert.equal(f.video.currentTime,6);f.data();
    assert.equal(f.decor.beginPlayback(),false);await flush();
    assert.equal(f.video.currentTime,6);assert.equal(f.counts.play,1);
    assert.equal(f.video.muted,false);assert.equal(f.video.volume,.36);
  } finally {f.decor.dispose();}
});

for(const mode of ['paused','reduced-motion','hidden-document','hidden-room','off']) {
  await check(`entry respects ${mode} and resumes only after its gate opens`,async()=>{
    const f=fixture();
    const gate=value=>{
      if(mode==='paused')f.decor.setPaused(value);
      if(mode==='reduced-motion')f.decor.setReducedMotion(value);
      if(mode==='hidden-document')f.hidden(value);
      if(mode==='hidden-room')f.decor.setVisible(!value);
      if(mode==='off')f.decor.setTVPlaying(!value);
    };
    try {
      gate(true);assert.equal(f.decor.beginPlayback(),true);await flush();
      assert.equal(f.sources.length,0);assert.equal(f.counts.play,0);assert.equal(f.video.paused,true);
      assert.equal(f.decor.beginPlayback(),false);
      gate(false);await flush();
      assert.equal(f.counts.play,1);assert.deepEqual(f.sources,['/a.mp4']);
      f.metadata();assert.equal(f.video.currentTime,6);
    } finally {f.decor.dispose();}
  });
}

await check('excerpt bounds, explicit next, ended and playlist wrap retain native ownership',async()=>{
  const f=fixture();
  try {
    f.decor.beginPlayback();await flush();
    for(let turn=0;turn<9;turn++) {
      const index=f.decor.clipIndex,clip=f.playlist[index];
      f.metadata();f.data();assert.equal(f.video.currentTime,clip.start);
      f.video.currentTime=clip.end-.001;f.video.dispatchEvent(new Event('timeupdate'));
      assert.equal(f.decor.clipIndex,index);
      if(turn%3===0) {f.video.currentTime=clip.end;f.video.dispatchEvent(new Event('timeupdate'));}
      else if(turn%3===1) f.video.dispatchEvent(new Event('ended'));
      else f.decor.nextClip();
      assert.equal(f.decor.clipIndex,(index+1)%3);await flush();
    }
    assert.equal(f.decor.clipIndex,0);assert.equal(f.video.loop,false);
    assert.equal(f.sources.length,10);assert.equal(f.counts.play,10);
    assert.equal(f.counts.crossOrigin,0);assert.equal(f.counts.callback,0);
    f.video.seeking=true;f.video.currentTime=200;f.video.dispatchEvent(new Event('timeupdate'));
    assert.equal(f.decor.clipIndex,0);f.video.seeking=false;
    f.decor.setPaused(true);f.video.dispatchEvent(new Event('ended'));
    f.video.dispatchEvent(new Event('timeupdate'));assert.equal(f.decor.clipIndex,0);
  } finally {f.decor.dispose();}
});

await check('OFF/ON stops playback without replacing the decoded frame or resetting time',async()=>{
  const f=fixture();
  try {
    f.decor.beginPlayback();await flush();f.metadata();f.data();f.video.currentTime=31.75;
    const loads=f.counts.load,sources=f.sources.length;
    f.decor.setTVPlaying(false);await flush();
    assert.equal(f.video.paused,true);assert.equal(f.video.currentTime,31.75);
    assert.equal(f.video.readyState,2);assert.equal(f.counts.load,loads);
    assert.equal(f.decor.screenMaterial.map,null);
    f.video.dispatchEvent(new Event('ended'));assert.equal(f.decor.clipIndex,0);
    f.decor.setTVPlaying(true);await flush();
    assert.equal(f.video.paused,false);assert.equal(f.video.currentTime,31.75);
    assert.equal(f.video.readyState,2);assert.equal(f.sources.length,sources);assert.equal(f.counts.load,loads);
    f.decor.setPaused(true);assert.equal(f.decor.mediaStatus,'paused');
    assert.equal(f.video.currentTime,31.75);
  } finally {f.decor.dispose();}
});

await check('disposal is idempotent and late media events cannot restart playback',async()=>{
  const f=fixture();f.decor.beginPlayback();await flush();f.metadata();f.data();
  const materials=[...f.decor.materials],disposed=new Map();
  for(const material of materials) material.addEventListener('dispose',()=>disposed.set(material,(disposed.get(material)??0)+1));
  f.decor.dispose();const plays=f.counts.play,loads=f.counts.load,index=f.decor.clipIndex;
  f.decor.dispose();f.video.dispatchEvent(new Event('ended'));f.video.dispatchEvent(new Event('loadeddata'));
  f.video.dispatchEvent(new Event('error'));f.hidden(false);await flush();
  assert.equal(f.decor.beginPlayback(),false);
  assert.equal(f.video.paused,true);assert.equal(f.video.getAttribute('src'),undefined);
  assert.equal(f.counts.play,plays);assert.equal(f.counts.load,loads);assert.equal(f.decor.clipIndex,index);
  assert.equal(f.callbacks.size,0);assert.equal(f.counts.callback,0);
  assert.equal(f.decor.root.parent,null);
  assert.ok(materials.every(material=>disposed.get(material)===1));
});
console.log(`PASS: ${passed} native media lifecycle checks (Node event doubles; browser decoding/audio not tested).`);
