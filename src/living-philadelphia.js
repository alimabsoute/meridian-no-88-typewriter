import * as THREE from 'three';
import { createPhiladelphiaLandmarks } from './philadelphia-landmarks.js';
import { createPhiladelphiaStreetscape } from './philadelphia-streetscape.js';

// Small deterministic surface maps, generated without a canvas or image assets.
function surfaceTexture(room, width, height, pixel) {
  const bytes = new Uint8Array(width * height * 4);
  for (let y=0;y<height;y++) for(let x=0;x<width;x++) bytes.set(pixel(x,y), (y*width+x)*4);
  const texture = room._texture(new THREE.DataTexture(bytes,width,height,THREE.RGBAFormat));
  texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipmapLinearFilter;
  return texture;
}

// All movement shares this slow gust field, so branches and loose foliage agree.
export function philadelphiaWind(time, strength = 0.3) {
  return strength * (0.55 + Math.sin(time * 0.47) * 0.25 + Math.sin(time * 0.19 + 1.2) * 0.2);
}

export function createLivingPhiladelphia(room) {
  const root = new THREE.Group();
  root.name = 'LivingPhiladelphia3D';
  room.root.add(root);
  const rng = room.rng;
  const mat = (color, extra = {}) => room._material(new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra }));
  const facadeTexture=surfaceTexture(room,512,1024,(x,y)=>{
    const vertical=x%24<2, horizontal=y%32<3;
    const cell=Math.floor(x/24)*73+Math.floor(y/32)*137;
    const sky=35+Math.pow(y/1024,1.5)*45;
    const reflection=Math.sin(x*.018+y*.004)*15+Math.sin(x*.061)*7;
    const level=vertical?82:horizontal?27:sky+(cell%13)+reflection;
    return [level*.83,level*.96,level*1.08,255];
  });
  const stone = mat(0x8296a0,{map:facadeTexture,metalness:.58,roughness:.24,emissive:0x687b8b,emissiveMap:facadeTexture,emissiveIntensity:.23});
  const trim = mat(0x697781,{metalness:.65,roughness:.32}), street = mat(0x343a3b);
  const barkTexture=surfaceTexture(room,128,512,(x,y)=>{const grain=125+Math.sin(x*.4+Math.sin(y*.037)*1.8)*27+Math.sin(x*1.6+y*.007)*13;return [grain,grain*.89,grain*.74,255];});
  const bark = mat(0x695747,{map:barkTexture,bumpMap:barkTexture,bumpScale:.012});
  const pavement = mat(0x73706a), roof = mat(0x323638);
  const boxGeometry = room._geometry(new THREE.BoxGeometry(1, 1, 1));
  function box(name, x,y,z,w,h,d, material = stone, parent = root) {
    const mesh = new THREE.Mesh(boxGeometry, material);
    mesh.name = name; mesh.position.set(x,y,z); mesh.scale.set(w,h,d); parent.add(mesh); return mesh;
  }
  const staticGroup = new THREE.Group(); root.add(staticGroup);
  box('PhiladelphiaStreet',4,-0.42,-17,36,0.2,24,street,staticGroup);
  box('NearSidewalk',4,-0.27,-10.5,36,0.18,2.4,pavement,staticGroup);
  box('LeafCatchingCurb',4,-0.12,-11.8,36,0.2,0.12,trim,staticGroup);
  const roofSnowMaterial = room._material(room.snowMaterial.clone());
  room.snowCapMaterials.push(roofSnowMaterial);
  const snowRoofs = [];
  const officeMaterials = Array.from({length: 5},(_,i)=>mat(0x857254,{emissive:0xd4a86b,emissiveIntensity:0.15+i*0.08}));
  const officeTransforms = officeMaterials.map(()=>[]);
  const dummy = new THREE.Object3D();
  function tower(name,x,z,w,h,d, material=stone) {
    const group = new THREE.Group(); group.name=name; root.add(group);
    box(name+'Structure',x,h/2,z,w,h,d,material,staticGroup);
    for(let column=0;column<=8;column++) box(name+'FacadeMullion',x-w/2+column*w/8,h/2,z+d/2+0.009,0.014,h,0.018,trim,staticGroup);
    for(let floor=1;floor<h/0.32;floor++) box(name+'Spandrel',x,floor*0.32,z+d/2+0.008,w,0.022,0.018,stone,staticGroup);
    snowRoofs.push([x,h+0.025,z,w+0.02,d+0.02]);
    for(let row=0;row<Math.floor(h/0.32)-1;row++) for(let col=0;col<Math.floor(w/0.22)-1;col++) {
      if(rng()<0.76) continue;
      const band=Math.floor(rng()*officeMaterials.length);
      dummy.position.set(x-w/2+0.18+col*0.22,0.35+row*0.32,z+d/2+0.008);
      dummy.scale.set(0.078,0.11,0.015);dummy.rotation.set(0,0,0);dummy.updateMatrix();officeTransforms[band].push(dummy.matrix.clone());
      if(col===0 && rng()>0.4) {dummy.position.set(x+w/2+0.008,0.35+row*0.32,z);dummy.scale.set(0.025,0.14,0.12);dummy.updateMatrix();officeTransforms[band].push(dummy.matrix.clone());}
    }
    return group;
  }
  // An intentionally composed view of the western Center City skyline.
  tower('PECOTower',6.0,-25,3.15,6.25,1.5,stone);
  box('PECOCrownHousing',6.0,6.3,-25,3.23,0.66,1.58,roof,staticGroup);
  const crownFront = new THREE.Mesh(room._geometry(new THREE.PlaneGeometry(3.18,0.61)), room._material(new THREE.MeshBasicMaterial({color:0xf5e6c7})));
  crownFront.name='PECORealScrollingBroadFace';crownFront.position.set(6.0,6.3,-24.2);root.add(crownFront);
  const crownSide = new THREE.Mesh(room._geometry(new THREE.PlaneGeometry(1.55,0.61)),room._material(new THREE.MeshBasicMaterial({color:0xffffff})));
  crownSide.name='PECORealScrollingSideFace';crownSide.position.set(7.62,6.3,-25);crownSide.rotation.y=Math.PI/2;root.add(crownSide);
  const landmarks = createPhiladelphiaLandmarks(room,root);
  const streetscape = createPhiladelphiaStreetscape(room,root);
  const districtMaterials=[0x87929a,0x9c8d7c,0x867877,0x687d8b].map(color=>mat(color,{map:facadeTexture,roughness:.46,metalness:.24,emissive:color,emissiveMap:facadeTexture,emissiveIntensity:.19}));
  // Mid-rise roofs at three separate distances knit the landmark silhouettes
  // into a city. Setbacks and returns remain geometry when the camera moves.
  for(let i=0;i<27;i++) {
    const x=-19+i*1.7,z=-43-(i%3)*2.1,w=1.12+rng()*.8,h=3.6+rng()*2.9,d=1.25+rng()*.7,m= districtMaterials[i%4];
    box('PhiladelphiaMidrise',x,h/2,z,w,h,d,m,staticGroup);
    box('MidriseRecessedPenthouse',x+.08,h+.2,z-.05,w*.62,.4,d*.68,m,staticGroup);
    box('MidriseStoneCornice',x,h,z,w+.05,.065,d+.06,trim,staticGroup);
    snowRoofs.push([x,h+.04,z,w,d],[x+.08,h+.42,z-.05,w*.62,d*.68]);
    for(let f=1;f<h/.32;f++)box('MidriseFloorDepth',x,f*.32,z+d/2+.01,w,.014,.025,trim,staticGroup);
    for(let c=1;c<6;c++)box('MidriseVerticalPier',x-w/2+c*w/6,h/2,z+d/2+.015,.018,h,.034,trim,staticGroup);
    for(let f=1;f<h/.32;f++)for(let c=0;c<6;c++)if(rng()>.76){
      dummy.position.set(x-w/2+(c+.5)*w/6,f*.32-.11,z+d/2+.027);
      dummy.scale.set(w/6*.6,.11,.008);dummy.rotation.set(0,0,0);dummy.updateMatrix();
      officeTransforms[(i+f+c)%5].push(dummy.matrix.clone());
    }
  }
  // Preserve the PECO slab and the crown coordinates exactly; refine the returns.
  for (const x of [4.44,7.56]) box('PECOCornerCap',x,3.12,-24.226,.032,6.24,.034,trim,staticGroup);
  for(let f=1;f<29;f++) {
    box('PECOSideFloorReveal',7.581,f*.216,-25,.025,.018,1.5,trim,staticGroup);
    box('PECOFrontFloorReveal',6,f*.216,-24.237,3.12,.013,.026,trim,staticGroup);
  }
  for(let c=1;c<22;c++) box('PECONarrowCurtainwallRib',4.425+c*3.15/22,3.1,-24.232,.013,6.2,.036,trim,staticGroup);
  for(let c=1;c<10;c++) box('PECORecessedSideRib',7.582,3.1,-25.75+c*.15,.031,6.2,.013,trim,staticGroup);
  for(const y of [5.93,6.64]) {
    box('PECOCrownMetalLip',6,y,-24.19,3.23,.018,.026,trim,staticGroup);
    box('PECOCrownReturnLip',7.626,y,-25,.02,.018,1.57,trim,staticGroup);
  }
  const roofSnow = new THREE.InstancedMesh(boxGeometry,roofSnowMaterial,snowRoofs.length);
  roofSnow.name='SnowOnPhiladelphiaRoofs';
  snowRoofs.forEach(([x,y,z,w,d],i)=>{dummy.position.set(x,y,z);dummy.scale.set(w,0.035,d);dummy.rotation.set(0,0,0);dummy.updateMatrix();roofSnow.setMatrixAt(i,dummy.matrix);});root.add(roofSnow);
  for(let i=0;i<officeMaterials.length;i++) {
    const windows=new THREE.InstancedMesh(boxGeometry,officeMaterials[i],officeTransforms[i].length);
    windows.name='SlowlyChangingOfficeLights';officeTransforms[i].forEach((matrix,j)=>windows.setMatrixAt(j,matrix));root.add(windows);
  }
  const trees=[];
  const foliageTexture=surfaceTexture(room,128,128,(x,y)=>{
    const px=(x-63.5)/62,py=(y-63.5)/62;
    const angle=Math.atan2(py,px),radius=Math.hypot(px,py);
    const edge=0.67+0.22*Math.cos(angle*5+0.5)+.025*Math.cos(angle*39);
    const inside=radius<edge;
    const vein=Math.abs(px)<0.014 || Math.abs(py-Math.abs(px)*0.7)<0.014 || Math.abs(py+.3-Math.abs(px)*.55)<.012;
    const grain=(Math.sin(x*8.2+y*3.1)*7+Math.sin(x*.21+y*.17)*10);
    return [vein?203:235+grain,vein?174:228+grain,vein?137:203+grain,inside?255:0];
  });
  const foliageGeometry=room._geometry(new THREE.PlaneGeometry(1,1,2,2));
  const leafPositions=foliageGeometry.attributes.position;
  for(let i=0;i<leafPositions.count;i++)leafPositions.setZ(i,Math.pow(leafPositions.getX(i),2)*.23+Math.sin(leafPositions.getY(i)*3)*.04);
  foliageGeometry.computeVertexNormals();
  const foliageTime={value:0},foliageWind={value:.2};
  const leafMaterials=[0x9b833c,0xc98d36,0xae592c,0x747549].map(color=>{
    const material=mat(color,{map:foliageTexture,alphaTest:0.45,side:THREE.DoubleSide,roughness:0.87,emissive:color,emissiveIntensity:.12});
    material.onBeforeCompile=shader=>{
      shader.uniforms.foliageTime=foliageTime;shader.uniforms.foliageWind=foliageWind;
      shader.vertexShader='uniform float foliageTime; uniform float foliageWind;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
        float leafPhase=instanceMatrix[3].x*7.1+instanceMatrix[3].y*4.3+instanceMatrix[3].z*3.9;
        transformed.z+=sin(foliageTime*2.1+leafPhase)*foliageWind*.16*(position.y+.5);
        transformed.x+=sin(foliageTime*1.6+leafPhase*.7)*foliageWind*.06*(position.y+.5);`);
    };
    material.customProgramCacheKey=()=> 'octoberline-leaf-flutter-v2';
    return material;
  });
  for(const [x,z,h] of [[-3.2,-10.8,5.5],[10.7,-12.1,5.9],[-5.4,-16,4.7],[14,-17,4.5]]) {
    const tree=new THREE.Group();tree.name='WindDrivenStreetTree';tree.position.set(x,-0.12,z);root.add(tree);
    const trunk=new THREE.Mesh(room._geometry(new THREE.CylinderGeometry(0.045,0.13,h*0.76,16,5)),bark);trunk.position.y=h*0.38;trunk.rotation.z=0.025;tree.add(trunk);
    const branches=[];
    for(let b=0;b<5;b++) {
      const branch=new THREE.Group();branch.position.y=h*(0.42+b*0.07);tree.add(branch);branches.push(branch);
      const angle=b*2.4;
      const stem=new THREE.Mesh(room._geometry(new THREE.CylinderGeometry(0.02,0.055,h*0.33,10)),bark);stem.position.set(Math.sin(angle)*0.3,h*0.1,Math.cos(angle)*0.25);stem.rotation.z=Math.sin(angle)*0.65;branch.add(stem);
      for(let t=0;t<5;t++){
        const twig=new THREE.Mesh(room._geometry(new THREE.CylinderGeometry(0.006,0.017,0.8,4)),bark);
        twig.position.set(Math.sin(angle)*0.4+(t-2)*0.14,h*0.15+t*0.04,Math.cos(angle)*0.3);
        twig.rotation.set(Math.cos(t)*0.6,angle,Math.sin(t+angle)*0.8);branch.add(twig);
      }
      // Instancing gives a volumetric irregular crown without hundreds of draws.
      const foliage=new THREE.InstancedMesh(foliageGeometry,leafMaterials[(b+trees.length)%4],360);
      foliage.name='DimensionalAutumnFoliage';
      for(let f=0;f<360;f++) {
        const theta=rng()*Math.PI*2,v=rng()*2-1,radius=Math.cbrt(rng()),ring=Math.sqrt(1-v*v)*radius;
        dummy.position.set(Math.sin(angle)*.64+Math.cos(theta)*ring*1.04,h*.18+v*radius*.95,Math.cos(angle)*.58+Math.sin(theta)*ring*.95);
        dummy.scale.set(.13+rng()*.16,.17+rng()*.19,1);dummy.rotation.set(rng()*3,rng()*3,rng()*3);dummy.updateMatrix();foliage.setMatrixAt(f,dummy.matrix);
        foliage.setColorAt(f,new THREE.Color().setHSL(.07+rng()*.05,.32+rng()*.3,.66+rng()*.22));
      }
      branch.add(foliage);
      room._batchStaticMeshes(branch,'TreeTwigs');
    }
    trees.push({tree,branches});
  }
  const count=150, leafGeometry=room._geometry(foliageGeometry.clone());
  leafGeometry.scale(.12,.12,.12);
  const leafMaterial=mat(0xc59346,{map:foliageTexture,alphaTest:.45,side:THREE.DoubleSide,emissive:0x9c6326,emissiveIntensity:.15});
  const leaves=new THREE.InstancedMesh(leafGeometry,leafMaterial,count);leaves.name='FallingAndSettledAutumnLeaves';leaves.frustumCulled=false;root.add(leaves);
  const leafData=Array.from({length:count},(_,i)=>({x:-1+rng()*12,y:i<115?-0.12:2+rng()*4,z:-10.8-rng()*1.4,phase:rng()*6.28,rest:i<115?20+rng()*80:0,scale:0.7+rng()*0.9}));
  leafData.forEach((l,i)=>leaves.setColorAt(i,new THREE.Color([0xa25f2f,0xc89342,0x987044][i%3])));
  const actors=[];
  room._batchStaticMeshes(staticGroup,'LivingCity');
  const reflectedSky=surfaceTexture(room,512,256,(x,y)=>{
    const elevation=1-y/256,azimuth=x/512*Math.PI*2;
    const sun=Math.pow(Math.max(0,Math.cos(azimuth-1.1)),18)*Math.exp(-Math.pow((elevation-.55)*9,2));
    const height=Math.max(0,Math.min(1,(elevation-.46)*2));
    const skyline=elevation<.48+.03*Math.sin(x*.11)+.015*Math.sin(x*.4);
    const r=skyline?28:105+50*(1-height)+sun*95;
    const g=skyline?32:127+15*(1-height)+sun*55;
    const b=skyline?35:163-35*(1-height)+sun*18;
    return [Math.min(255,r),Math.min(255,g),Math.min(255,b),255];
  });
  reflectedSky.mapping=THREE.EquirectangularReflectionMapping;
  root.traverse(object=>{if(object.isMesh && object.material?.isMeshStandardMaterial){object.material.envMap=reflectedSky;object.material.envMapIntensity=.65;}});
  let lastLightTick=-1;
  function update(time,delta,weather,reduced=false) {
    const wind=philadelphiaWind(time,weather.wind);
    landmarks.update(time,reduced);
    foliageTime.value=reduced?foliageTime.value:time;
    foliageWind.value=wind;
    trees.forEach(({tree,branches},i)=>{tree.rotation.z=wind*0.013*Math.sin(time*0.7+i);branches.forEach((branch,b)=>{branch.rotation.z=wind*0.045*Math.sin(time*1.1+i+b);branch.rotation.x=wind*0.028*Math.sin(time*1.8+b);});});
    leafData.forEach((l,i)=>{
      if(!reduced && delta>0) {
        if(l.y<=-0.1) {
          l.rest-=delta*(0.3+weather.leaves);
          // Gusts skid leaves along the pavement. Recycle only at zero scale:
          // the old leaf disappears into the pile before a new leaf emerges
          // among canopy foliage, avoiding a visible ground-to-tree teleport.
          if(wind>0.16 && Math.sin(time*1.4+l.phase)>0.5) {
            l.x=Math.min(14,l.x+delta*wind*0.6);l.phase+=delta*wind;
          }
          if(l.rest<0 && wind>0.12) {
            l.visibility=Math.max(0,(l.visibility??1)-delta*0.65);
            if(l.visibility===0) {l.y=3+rng()*2.5;l.x=i%2===0?-3.2:10.7;l.z=-10.8-rng()*1.2;l.rest=30+rng()*65;}
          }
        }
        else {
          l.visibility=Math.min(1,(l.visibility??1)+delta*1.5);
          l.y=Math.max(-0.12,l.y-delta*(0.35+0.2*Math.sin(l.phase+time)));
          l.x=Math.max(-8,Math.min(14,l.x+delta*(wind*0.8+0.14*Math.sin(time+l.phase))));
        }
      }
      dummy.position.set(l.x,l.y,l.z);dummy.rotation.set(l.y<=-0.1?-Math.PI/2:time*1.8+l.phase,l.y<=-0.1?0:Math.sin(time+l.phase),l.phase+(l.y<=-0.1?0:time*0.65));dummy.scale.set(l.scale*1.6*(l.visibility??1),l.scale*(l.visibility??1),1);dummy.updateMatrix();leaves.setMatrixAt(i,dummy.matrix);
    });leaves.instanceMatrix.needsUpdate=true;
    actors.forEach(({object,phase,speed,z,groundY})=>{object.position.set(((time*speed+phase)%34)-12,groundY,z);});
    const tick=Math.floor(time/3);
    if(tick!==lastLightTick){officeMaterials.forEach((m,i)=>{m.emissiveIntensity=0.4+0.18*Math.sin(time*0.028+i*1.7);});lastLightTick=tick;}
    applyWeather(weather);
  }
  function applyWeather(weather) {
    streetscape.applyWeather?.(weather);
    street.roughness=0.86-weather.rain*0.55;
    street.color.setHex(weather.snow>0.5?0x858c8e:weather.rain>0.3?0x242c30:0x343a3b);
    pavement.color.setHex(weather.snow>0.5?0xb4b6b0:0x73706a);
    roofSnowMaterial.opacity=weather.snow*0.82;
  }
  update(0,0,room.weatherState,true);
  return {root,crownFront,crownSide,landmarks,streetscape,leaves,leafData,trees,actors,update,applyWeather};
}
