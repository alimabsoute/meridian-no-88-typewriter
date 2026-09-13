import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {launchBrowser} from './browser-test-helpers.mjs';
const current=await readFile('src/audio-engine.js','utf8');
const previous=execFileSync('git',['show','52f68ec:src/audio-engine.js'],{encoding:'utf8'});
const browser=await launchBrowser();
try {
 const page=await browser.newPage();
 const results=await page.evaluate(async({current,previous})=>{
  async function render(source,kind='strike',volume=.78,enabled=true,burst=false){
   const AudioClass=new Function(source.replace('export class','class')+';return TypewriterAudio;')();
   const context=new OfflineAudioContext(1,48000,48000),a=new AudioClass();
   a.context=context;a.volume=volume;a.enabled=enabled;
   if(a.connectOutputs)a.connectOutputs();else{a.master=context.createGain();a.master.gain.value=enabled?.72*volume:0;a.master.connect(context.destination);a.paperMaster=context.createGain();a.paperMaster.gain.value=enabled?.72*a.paperVolume:0;a.paperMaster.connect(context.destination);}
   const random=Math.random;let seed=211;Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
   try {a.noiseBuffer=a.makeNoiseBuffer(2);for(let i=0;i<(burst?8:1);i++){if(kind==='strike'){a.keyDown();a.strike(burst?1:.72);a.escapement();}else a.paper();}}finally{Math.random=random;}
   const data=(await context.startRendering()).getChannelData(0);let sum=0,peak=0;for(const v of data){sum+=v*v;peak=Math.max(peak,Math.abs(v));}
   return {rms:Math.sqrt(sum/data.length),peak,samples:Array.from(data.slice(0,12000))};
  }
  const old=await render(previous),next=await render(current),mute=await render(current,'strike',.78,false),zero=await render(current,'strike',0),burst=await render(current,'strike',1,true,true),paperOld=await render(previous,'paper'),paperNew=await render(current,'paper');
  const samples=next.samples;for(const r of [old,next,mute,zero,burst,paperOld,paperNew])delete r.samples;
  return {old,next,mute,zero,burst,paperOld,paperNew,gainDb:20*Math.log10(next.rms/old.rms),samples};
 },{current,previous});
 console.log('Audio measurements',JSON.stringify({...results,samples:undefined}));
 assert(results.gainDb>7,'strikes must be substantially louder');assert(results.next.peak<.98);assert(results.burst.peak<.98,'overlapping strikes must retain headroom');assert.equal(results.mute.peak,0);assert.equal(results.zero.peak,0);assert.equal(results.paperOld.rms,results.paperNew.rms);
 const samples=results.samples;delete results.samples;
 const wav=Buffer.alloc(44+samples.length*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples.length*2,40);samples.forEach((v,i)=>wav.writeInt16LE(Math.round(Math.max(-1,Math.min(1,v))*32767),44+i*2));
 await mkdir('visual-checks/audio',{recursive:true});await writeFile('visual-checks/audio/key-strike.wav',wav);await writeFile('visual-checks/audio/impact.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
