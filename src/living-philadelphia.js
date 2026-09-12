import * as THREE from 'three';

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
  const facadeTexture=surfaceTexture(room,128,256,(x,y)=>{
    const vertical=x%16<2, horizontal=y%12<2;
    const cell=Math.floor(x/16)*73+Math.floor(y/12)*137;
    const reflection=Math.sin(x*0.09+y*0.035)*6;
    const level=vertical?80:horizontal?43:35+(cell%17)+reflection;
    return [level*0.85,level,level*1.13,255];
  });
  const stone = mat(0x849098,{map:facadeTexture}), metal = mat(0x8497a3, {map:facadeTexture, metalness: 0.28, roughness: 0.5 });
  const trim = mat(0x697781), bark = mat(0x493829), street = mat(0x343a3b);
  const pavement = mat(0x73706a), roof = mat(0x323638);
  const boxGeometry = room._geometry(new THREE.BoxGeometry(1, 1, 1));
  const sphereGeometry = room._geometry(new THREE.IcosahedronGeometry(1, 0));
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
  function tower(name,x,z,w,h,d, material=metal) {
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
  function liberty(name,x,z,h) {
    tower(name,x,z,1.45,h,1.45);
    for(let i=0;i<4;i++) {
      const tier=new THREE.Mesh(room._geometry(new THREE.CylinderGeometry(0.63-i*0.11,0.77-i*0.11,0.4,4)),metal);
      tier.rotation.y=Math.PI/4;tier.position.set(x,h+0.2+i*0.36,z);staticGroup.add(tier);
      box(name+'CrownLedge',x,h+i*0.36,z,1.12-i*0.16,0.035,1.12-i*0.16,trim,staticGroup);
    }
    const peak = new THREE.Mesh(room._geometry(new THREE.ConeGeometry(0.25,0.85,4)),metal);peak.position.set(x,h+1.83,z);peak.rotation.y=Math.PI/4;staticGroup.add(peak);
    box(name+'Spire',x,h+2.65,z,0.025,1.15,0.025,trim,staticGroup);
  }
  liberty('OneLibertyPlace',9.1,-35,7.3);liberty('TwoLibertyPlace',11,-34,6.5);
  tower('ComcastCenter',2.2,-37,1.95,9.3,1.55);
  box('ComcastCenterCrown',2.2,9.4,-37,2.02,0.7,1.6,trim,staticGroup);
  box('ComcastCenterNotch',2.2,9.55,-36.18,1.35,0.5,0.06,roof,staticGroup);
  tower('ComcastTechnologyCenter',-1,-38,1.8,9.8,1.65);
  box('ComcastTechnologyLantern',-0.37,10.35,-38,0.28,1.8,0.3,officeMaterials[2],staticGroup);
  tower('FMCInspiredRiverTower',14,-38,1.7,7.8,1.5);
  for(let i=0;i<13;i++) {
    const x=-12+i*2.6, h=1.9+rng()*1.1,z=-19-rng()*1.7;
    const brick=room.brickMaterials[i%room.brickMaterials.length];
    box('BrickRowhouse',x,h/2,z,2.3,h,2.2,brick,staticGroup);
    box('RowhouseCornice',x,h,z+0.04,2.42,0.16,2.35,roof,staticGroup);
    snowRoofs.push([x,h+0.11,z+0.04,2.42,2.35]);
    box('RowhouseChimney',x+0.55,h+0.32,z,0.3,0.65,0.32,brick,staticGroup);
    for(let r=0;r<2;r++)for(let c=0;c<3;c++){
      const wx=x-0.7+c*0.65,wy=0.55+r*0.8;
      box('WindowRecess',wx,wy,z+1.106,0.38,0.52,0.04,roof,staticGroup);
      box('WarmApartment',wx,wy,z+1.135,0.27,0.4,0.018,officeMaterials[(i+c)%5],staticGroup);
      box('StoneLintel',wx,wy+0.29,z+1.13,0.42,0.055,0.11,trim,staticGroup);
      box('StoneSill',wx,wy-0.27,z+1.15,0.42,0.045,0.14,trim,staticGroup);
      box('SashDivider',wx,wy,z+1.15,0.29,0.025,0.02,roof,staticGroup);
    }
  }
  const roofSnow = new THREE.InstancedMesh(boxGeometry,roofSnowMaterial,snowRoofs.length);
  roofSnow.name='SnowOnPhiladelphiaRoofs';
  snowRoofs.forEach(([x,y,z,w,d],i)=>{dummy.position.set(x,y,z);dummy.scale.set(w,0.035,d);dummy.rotation.set(0,0,0);dummy.updateMatrix();roofSnow.setMatrixAt(i,dummy.matrix);});root.add(roofSnow);
  for(let i=0;i<officeMaterials.length;i++) {
    const windows=new THREE.InstancedMesh(boxGeometry,officeMaterials[i],officeTransforms[i].length);
    windows.name='SlowlyChangingOfficeLights';officeTransforms[i].forEach((matrix,j)=>windows.setMatrixAt(j,matrix));root.add(windows);
  }
  const trees=[];
  const foliageTexture=surfaceTexture(room,32,32,(x,y)=>{
    const px=(x-15.5)/15,py=(y-15.5)/15;
    const angle=Math.atan2(py,px),radius=Math.hypot(px,py);
    const edge=0.68+0.18*Math.cos(angle*5+0.5);
    const inside=radius<edge;
    const vein=Math.abs(px)<0.025 || Math.abs(py-Math.abs(px)*0.7)<0.025;
    return [vein?210:245,vein?195:245,vein?164:235,inside?255:0];
  });
  const foliageGeometry=room._geometry(new THREE.PlaneGeometry(1,1));
  const leafMaterials=[0x69734c,0xa38645,0x976544,0x7e804f].map(color=>mat(color,{map:foliageTexture,alphaTest:0.45,side:THREE.DoubleSide,roughness:0.95}));
  for(const [x,z,h] of [[-0.6,-10.8,5.5],[9.3,-12.1,5.9],[-4,-16,4.7],[13,-17,4.5]]) {
    const tree=new THREE.Group();tree.name='WindDrivenStreetTree';tree.position.set(x,-0.12,z);root.add(tree);
    const trunk=new THREE.Mesh(room._geometry(new THREE.CylinderGeometry(0.045,0.13,h*0.76,9)),bark);trunk.position.y=h*0.38;trunk.rotation.z=0.025;tree.add(trunk);
    const branches=[];
    for(let b=0;b<5;b++) {
      const branch=new THREE.Group();branch.position.y=h*(0.42+b*0.07);tree.add(branch);branches.push(branch);
      const angle=b*2.4;
      const stem=new THREE.Mesh(room._geometry(new THREE.CylinderGeometry(0.02,0.055,h*0.33,5)),bark);stem.position.set(Math.sin(angle)*0.3,h*0.1,Math.cos(angle)*0.25);stem.rotation.z=Math.sin(angle)*0.65;branch.add(stem);
      for(let t=0;t<5;t++){
        const twig=new THREE.Mesh(room._geometry(new THREE.CylinderGeometry(0.006,0.017,0.8,4)),bark);
        twig.position.set(Math.sin(angle)*0.4+(t-2)*0.14,h*0.15+t*0.04,Math.cos(angle)*0.3);
        twig.rotation.set(Math.cos(t)*0.6,angle,Math.sin(t+angle)*0.8);branch.add(twig);
      }
      // Instancing gives a volumetric irregular crown without hundreds of draws.
      const foliage=new THREE.InstancedMesh(foliageGeometry,leafMaterials[b%4],160);
      foliage.name='DimensionalAutumnFoliage';
      for(let f=0;f<160;f++) {dummy.position.set(Math.sin(angle)*0.55+(rng()-0.5)*1.8,h*0.18+(rng()-0.5)*1.5,Math.cos(angle)*0.4+(rng()-0.5)*1.65);dummy.scale.set(0.16+rng()*0.15,0.19+rng()*0.17,1);dummy.rotation.set(rng()*3,rng()*3,rng()*3);dummy.updateMatrix();foliage.setMatrixAt(f,dummy.matrix);}
      branch.add(foliage);
      room._batchStaticMeshes(branch,'TreeTwigs');
    }
    trees.push({tree,branches});
  }
  const count=150, leafGeometry=room._geometry(new THREE.CircleGeometry(0.055,5));
  const leafMaterial=mat(0xc59346,{side:THREE.DoubleSide});
  const leaves=new THREE.InstancedMesh(leafGeometry,leafMaterial,count);leaves.name='FallingAndSettledAutumnLeaves';leaves.frustumCulled=false;root.add(leaves);
  const leafData=Array.from({length:count},(_,i)=>({x:-1+rng()*12,y:i<115?-0.12:2+rng()*4,z:-10.8-rng()*1.4,phase:rng()*6.28,rest:i<115?20+rng()*80:0,scale:0.7+rng()*0.9}));
  leafData.forEach((l,i)=>leaves.setColorAt(i,new THREE.Color([0xa25f2f,0xc89342,0x987044][i%3])));
  const actors=[];
  const tireMaterial=mat(0x242526);
  const wheelGeometry=room._geometry(new THREE.CylinderGeometry(0.115,0.115,0.08,10));
  for(let i=0;i<4;i++) {
    const car=new THREE.Group();car.name='PassingStreetCar';root.add(car);
    box('CarBody',0,0.25,0,0.95,0.35,0.48,mat([0x444e59,0x806047,0x5d6259,0xada595][i]),car);
    box('CarCabin',0,0.47,0,0.48,0.2,0.41,metal,car);
    for(const x of [-0.3,0.3]) for(const z of [-0.24,0.24]) {
      const wheel=new THREE.Mesh(wheelGeometry,tireMaterial);
      wheel.name='StreetCarWheel';wheel.rotation.x=Math.PI/2;wheel.position.set(x,0.115,z);car.add(wheel);
    }
    const lamp=room._material(new THREE.MeshBasicMaterial({color:0xffdf9b}));
    for(const z of [-0.16,0.16])box('MovingHeadlight',0.49,0.24,z,0.025,0.08,0.08,lamp,car);
    const beam=new THREE.Mesh(room._geometry(new THREE.PlaneGeometry(2,0.5)),room._material(new THREE.MeshBasicMaterial({color:0xeacb87,transparent:true,opacity:0.07,depthWrite:false})));
    beam.rotation.x=-Math.PI/2;beam.position.set(1.1,0.012,0);car.add(beam);
    room._batchStaticMeshes(car,'StreetCar');
    actors.push({object:car,phase:i*8,speed:0.45+i*0.05,z:-14-i%2*0.8,groundY:-0.32});
  }
  for(let i=0;i<5;i++) {
    const walker=new THREE.Group();walker.name='DistantPedestrian';root.add(walker);
    box('Coat',0,0.34,0,0.105,0.27,0.09,roof,walker);
    for(const side of [-1,1]) {
      const leg=box('TrouserLeg',side*0.035,0.115,0,0.036,0.23,0.045,roof,walker);
      leg.rotation.z=side*0.1;
      box('WalkingShoe',side*0.035,0.018,0.01,0.05,0.035,0.075,roof,walker);
    }
    const head=new THREE.Mesh(sphereGeometry,trim);head.scale.setScalar(0.065);head.position.y=0.53;walker.add(head);
    room._batchStaticMeshes(walker,'Pedestrian');
    actors.push({object:walker,phase:i*6,speed:0.065+i*0.012,z:-11.4,groundY:-0.18});
  }
  room._batchStaticMeshes(staticGroup,'LivingCity');
  let lastLightTick=-1;
  function update(time,delta,weather,reduced=false) {
    const wind=philadelphiaWind(time,weather.wind);
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
            if(l.visibility===0) {l.y=3+rng()*2.5;l.x=i%2===0?-0.4:9;l.z=-10.8-rng()*1.2;l.rest=30+rng()*65;}
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
    street.roughness=0.86-weather.rain*0.55;
    street.color.setHex(weather.snow>0.5?0x858c8e:weather.rain>0.3?0x242c30:0x343a3b);
    pavement.color.setHex(weather.snow>0.5?0xb4b6b0:0x73706a);
    roofSnowMaterial.opacity=weather.snow*0.82;
  }
  update(0,0,room.weatherState,true);
  return {root,crownFront,crownSide,leaves,leafData,trees,actors,update,applyWeather};
}
