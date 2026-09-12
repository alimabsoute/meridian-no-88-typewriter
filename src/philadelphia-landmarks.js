import * as THREE from 'three';

// Architectural studies: Foster + Partners / RAMSA / KPF / Pelli Clarke &
// Partners / Enclos. Locations are composed for this room, not a surveyed vista.
// Every resource belongs to the writing room and follows its disposal lifecycle.
export function createPhiladelphiaLandmarks(room, parent) {
  const root = new THREE.Group(); root.name = 'PhiladelphiaArchitecturalSkyline'; parent.add(root);
  const structure = new THREE.Group(); root.add(structure);
  const unit = room._geometry(new THREE.BoxGeometry(1,1,1));
  // A repeatable architectural reflection field supplies visual depth even when
  // the room has no environment map. Fine window-sized changes avoid flat slabs;
  // broad vertical reflected silhouettes stay soft, never painted fake windows.
  const reflectionBytes=new Uint8Array(512*1024*4);
  for(let y=0;y<1024;y++)for(let x=0;x<512;x++){
    const u=x/511,v=y/1023;
    const sky=.42+.44*v;
    const cloud=Math.sin(u*9+v*4)*.065+Math.sin(u*21-v*8)*.023;
    const reflectedCity=Math.pow(.5+.5*Math.sin(u*31+Math.sin(u*11)*2),7)*(.13*(1-v));
    const pane=(Math.sin(Math.floor(x/22)*127.1+Math.floor(y/19)*311.7)*43758.54)%1;
    const bronze=Math.max(0,Math.sin(u*4.1+.8))*.065*(1-v*.5);
    const light=sky+cloud-reflectedCity+pane*.018;
    const k=(y*512+x)*4;reflectionBytes[k]=Math.min(255,(light*.83+bronze)*255);reflectionBytes[k+1]=Math.min(255,(light*.95+bronze*.42)*255);reflectionBytes[k+2]=Math.min(255,light*1.035*255);reflectionBytes[k+3]=255;
  }
  const reflectionMap=room._texture(new THREE.DataTexture(reflectionBytes,512,1024,THREE.RGBAFormat));
  reflectionMap.colorSpace=THREE.SRGBColorSpace;reflectionMap.generateMipmaps=true;reflectionMap.minFilter=THREE.LinearMipmapLinearFilter;reflectionMap.magFilter=THREE.LinearFilter;reflectionMap.needsUpdate=true;
  const material = (color, roughness=.35, metalness=.45) => room._material(new THREE.MeshStandardMaterial({color,roughness,metalness}));
  const glass = material(0x759da9,.22,.65), blue = material(0x527d9c,.25,.57);
  for(const m of [glass,blue]){m.map=reflectionMap;m.emissive=new THREE.Color(0x4a5965);m.emissiveMap=reflectionMap;m.emissiveIntensity=.14;m.envMapIntensity=.65;}
  const silver = material(0xb8c6ca,.33,.7), dark = material(0x263e49,.35,.5);
  const rose = material(0x98746c,.66,.12), limestone = material(0xa7a8a0,.57,.18);
  const roof = material(0x526b79,.35,.6);
  const bladeMat=room._material(new THREE.MeshStandardMaterial({color:0xdbe3df,emissive:0xd6e9ec,emissiveIntensity:.7,roughness:.36,metalness:.25}));
  function box(name,x,y,z,w,h,d,mat=silver) { const m=new THREE.Mesh(unit,mat);m.name=name;m.position.set(x,y,z);m.scale.set(w,h,d);structure.add(m);return m; }
  function line(a,b,width,mat=silver,name='FacadeMetalwork') {const middle=a.clone().add(b).multiplyScalar(.5);const m=box(name,middle.x,middle.y,middle.z,width,a.distanceTo(b),width,mat);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize());return m;}
  const windows=[];const ledWindows=[];const architecture=[];
  const snowPositions=[],snowNormals=[];
  // Clockwise perimeter viewed from above, with bevels large enough to read.
  function octagon(w,d,c=.16) {return [[-w/2+c,d/2],[w/2-c,d/2],[w/2,d/2-c],[w/2,-d/2+c],[w/2-c,-d/2],[-w/2+c,-d/2],[-w/2,-d/2+c],[-w/2,d/2-c]];}
  function prism(name,x,z,bottom,top,y0,y1,mat,{floors=0,columns=8,lights=true,led=false,metalwork=true}={}) {
    const pos=[], normals=[],uv=[];const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
    const put=(p,n,u,v)=>{pos.push(...p);normals.push(n.x,n.y,n.z);uv.push(u,v);};
    for(let i=0;i<bottom.length;i++) {
      const j=(i+1)%bottom.length;
      const p=[new THREE.Vector3(x+bottom[i][0],y0,z+bottom[i][1]),new THREE.Vector3(x+bottom[j][0],y0,z+bottom[j][1]),new THREE.Vector3(x+top[j][0],y1+(top[j][2]||0),z+top[j][1]),new THREE.Vector3(x+top[i][0],y1+(top[i][2]||0),z+top[i][1])];
      const n=b.subVectors(p[1],p[0]).cross(c.subVectors(p[3],p[0])).normalize();
      for(const k of [0,1,2,0,2,3])put(p[k].toArray(),n,[0,1,1,0][k],[0,0,1,1][k]);
      const edgeLength=p[0].distanceTo(p[1]);const cols=Math.max(1,Math.round(columns*edgeLength/Math.max(1,...bottom.map(q=>Math.abs(q[0])*2))));
      const at=(u,v,offset=.008)=>p[0].clone().lerp(p[1],u).lerp(p[3].clone().lerp(p[2],u),v).addScaledVector(n,offset);
      if(metalwork) {
        for(let column=0;column<=cols;column++)line(at(column/cols,0),at(column/cols,1),.012,silver,name+'VerticalMullion');
        for(let row=0;row<=floors;row++){if(!floors)break;line(at(0,row/floors),at(1,row/floors),.015,mat===rose?limestone:dark,name+'FloorSpandrel');}
      }
      if(floors && lights)for(let row=0;row<floors;row++)for(let col=0;col<cols;col++) {
        const seed=Math.sin((row+1)*73.13+(col+1)*17.17+i*119.3+x*3.3)*43758.5453;const random=seed-Math.floor(seed);
        if(random>.55)windows.push({p:at((col+.5)/cols,(row+.52)/floors,.012),n:n.clone(),w:edgeLength/cols*.69,h:(y1-y0)/floors*.64,seed:random});
        if(led && i!==3 && i!==4)ledWindows.push({p:at((col+.5)/cols,(row+.5)/floors,.03),n:n.clone(),w:.04,h:.079,seed:random});
      }
    }
    // Fully closed roof; important when the user moves the room camera.
    const center=top.reduce((v,p)=>v.add(new THREE.Vector3(x+p[0],y1+(p[2]||0),z+p[1])),new THREE.Vector3()).divideScalar(top.length);
    for(let i=0;i<top.length;i++){const next=top[(i+1)%top.length];const current=top[i];const q=new THREE.Vector3(x+next[0],y1+(next[2]||0),z+next[1]);const r=new THREE.Vector3(x+current[0],y1+(current[2]||0),z+current[1]);const n=r.clone().sub(center).cross(q.clone().sub(center)).normalize();for(const p of [center,r,q]){
      put(p.toArray(),n,0,0);
      // Preserve the real inclined roof profile rather than covering a faceted
      // landmark with an axis-aligned snow box. One shared draw for all roofs.
      if(n.y>.001){snowPositions.push(p.x,p.y+.018,p.z);snowNormals.push(n.x,n.y,n.z);}
    }}
    const g=room._geometry(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    const mesh=new THREE.Mesh(g,mat);mesh.name=name;structure.add(mesh);return mesh;
  }
  function body(name,x,z,w,d,h,mat=glass,topScale=1){const ring=octagon(w,d,Math.min(w,d)*.12);prism(name,x,z,ring,ring.map(([a,b])=>[a*topScale,b*topScale]),0,h,mat,{floors:Math.round(h/.19),columns:9});return ring.map(([a,b])=>[a*topScale,b*topScale]);}
  function record(name,x,z,height,identity){architecture.push({name,x,z,height,identity});}
  function liberty(name,x,z,w,h,compact=false){
    const ring=body(name,x,z,w,w*.9,h,blue);
    // Sloped octagonal crown with multiple unequal shoulders and external ribs.
    let previous=ring;let y=h;const levels=compact?[.25,.29,.35,.39]:[.3,.34,.37,.4,.49];
    levels.forEach((rise,i)=>{const s=1-(i+1)/(levels.length+1)*.88;const next=ring.map(([a,b])=>[a*s,b*s]);prism(name+'FacetedCrown'+i,x,z,previous,next,y,y+rise,blue,{metalwork:true,lights:false});for(let k=0;k<previous.length;k++){
      const j=(k+1)%previous.length;
      line(new THREE.Vector3(x+previous[k][0],y,z+previous[k][1]),new THREE.Vector3(x+next[k][0],y+rise,z+next[k][1]),.025,silver,name+'CrownRib');
      line(new THREE.Vector3(x+previous[k][0],y+.008,z+previous[k][1]),new THREE.Vector3(x+previous[j][0],y+.008,z+previous[j][1]),.035,silver,name+'CrownSetbackLedge');
    }previous=next;y+=rise;});
    // Jahn's crossed gable shoulders are independent of the central needle.
    // Four pitched, glass-faced roof wings interrupt the concentric silhouette.
    const gableWidth=w*(compact?.72:.62), shoulderHeight=compact?.72:1.02;
    for(let wing=0;wing<4;wing++){
      const wingGroup=new THREE.Group();wingGroup.position.set(x,h-.06,z);wingGroup.rotation.y=wing*Math.PI/2;structure.add(wingGroup);
      const p=[-gableWidth/2,0,w*.445,gableWidth/2,0,w*.445,0,shoulderHeight,w*.30,-gableWidth/2,0,w*.12,gableWidth/2,0,w*.12,0,shoulderHeight,w*.30];
      const indices=[0,1,2,3,5,4,0,2,5,0,5,3,1,4,5,1,5,2];
      const g=room._geometry(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,.5,1,0,0,1,0,.5,1],2));g.setIndex(indices);g.computeVertexNormals();
      const mesh=new THREE.Mesh(g,blue);mesh.name=name+'CrossGableShoulder';wingGroup.add(mesh);
      for(const side of [-1,1]){
        const start=new THREE.Vector3(side*gableWidth/2,0,w*.452).applyAxisAngle(new THREE.Vector3(0,1,0),wing*Math.PI/2).add(new THREE.Vector3(x,h-.06,z));
        const end=new THREE.Vector3(0,shoulderHeight,w*.307).applyAxisAngle(new THREE.Vector3(0,1,0),wing*Math.PI/2).add(new THREE.Vector3(x,h-.06,z));
        line(start,end,.027,silver,name+'GableSilverRake');
      }
    }
    prism(name+'NeedleBase',x,z,previous,previous.map(()=>[0,0]),y,y+.45,silver,{metalwork:false,lights:false});
    const needle=compact?.72:1.08;box(name+'SilverNeedle',x,y+.45+needle/2,z,.021,needle,.021,silver);
    for(let k=0;k<3;k++)box(name+'NeedleCollar',x,y+.49+k*.12,z,.045-k*.008,.025,.045-k*.008,silver);
    record(name,x,z,y+.45+needle,compact?'broad unequal stepped crown':'slender blue faceted crown and silver spire');
  }
  liberty('OneLibertyPlace',9.1,-35,1.55,7.0);liberty('TwoLibertyPlace',11.1,-34,1.68,6.3,true);
  // Comcast Center: tapering faceted obelisk, transparent-looking recessed crown.
  const cc=body('ComcastCenter',3.0,-37,1.95,1.65,9.1,glass,.88);
  prism('ComcastCrownRecess',3,-37,cc.map(([a,b])=>[a*.77,b*.77]),cc.map(([a,b])=>[a*.77,b*.77]),9.1,9.76,dark,{floors:3,columns:7});
  box('ComcastCrownLeftPier',2.20,9.43,-36.38,.15,.72,.22,silver);box('ComcastCrownRightPier',3.80,9.43,-36.38,.15,.72,.22,silver);
  box('ComcastCrownTopBridge',3,9.8,-36.38,1.73,.1,.22,silver);
  box('ComcastDeepTransparentCrown',3,9.41,-36.64,1.46,.64,.04,glass);
  record('ComcastCenter',3,-37,9.85,'faceted obelisk and recessed notched crown');
  // Technology Center has an asymmetric spine/blade, terraces, and sky gardens.
  body('ComcastTechnologyCenter',-.1,-38,2.05,1.85,8.15,glass);
  const hotel=octagon(1.65,1.48,.16);
  prism('ComcastTechnologyUpperHotel',-.25,-38,hotel,hotel,8.15,9.15,glass,{floors:5,columns:8});
  const topHotel=octagon(1.21,1.18,.14);
  prism('ComcastTechnologySteppedPenthouse',-.42,-38,topHotel,topHotel,9.15,9.85,glass,{floors:4,columns:6});
  box('CTCSkyTerraceLedge',-.25,8.18,-38,1.78,.065,1.58,silver);
  box('CTCUpperTerraceLedge',-.42,9.18,-38,1.35,.055,1.3,silver);
  box('CTCArticulatedCore',-.91,5.05,-37.16,.29,10.1,.31,dark);
  box('CTCIlluminatedBlade',-.91,10.62,-37.16,.25,1.18,.29,bladeMat);
  for(let band=0;band<13;band++)box('CTCBladeFineHorizontalBands',-.91,10.09+band*.085,-36.999,.27,.009,.018,silver);
  for(const side of [-1,1])box('CTCBladeGlowingVerticalEdge',-.91+side*.137,10.62,-37.15,.013,1.2,.32,bladeMat);
  for(let f=1;f<14;f++){const y=.6+f*.58;box('CTCRecessedSkyGarden',.47,y,-37.056,.7,.2,.045,dark);box('CTCGardenFloor',.47,y-.11,-37.01,.76,.025,.12,silver);}
  for(let y=1.2;y<8.5;y+=1.3){line(new THREE.Vector3(-.75,y,-37.04),new THREE.Vector3(.83,y+1,-37.04),.02,silver,'CTCDiagonalStructure');}
  record('ComcastTechnologyCenter',-.1,-38,11.21,'stepped hotel tower, asymmetric spine and illuminated blade');
  const mellon=body('BNYMellonCenter',7.95,-39,1.85,1.7,7.3,glass,.85);
  box('MellonSweepingCornice',7.95,7.36,-39,1.82,.16,1.68,limestone);
  prism('MellonMetalPyramid',7.95,-39,mellon.map(([a,b])=>[a*1.1,b*1.1]),mellon.map(()=>[0,0]),7.44,8.55,roof,{metalwork:true,lights:false});
  for(const s of [-1,1])box('MellonCornerStrap',7.95+s*.68,3.65,-38.24,.065,7.3,.055,limestone);
  record('BNYMellonCenter',7.95,-39,8.55,'broad metal pyramid and projecting cornice');
  body('ThreeLoganSquare',5.35,-41,1.7,1.7,6.65,rose);
  for(let i=0;i<4;i++){const w=1.6-i*.22;const r=octagon(w,w,.12);prism('ThreeLoganTier'+i,5.35,-41,r,r,6.65+i*.32,6.97+i*.32,rose,{floors:2,columns:6});}
  record('ThreeLoganSquare',5.35,-41,7.93,'rose granite tiered crown');
  const fmc=[[-.8,.75],[.55,.75],[.94,.26],[.74,-.7],[-.67,-.76],[-.94,-.2]];
  prism('FMCTower',14,-37,fmc,fmc.map(([a,b])=>[a*.83+.15,b*.83]),0,8.0,glass,{floors:43,columns:9});
  prism('FMCAngledCrown',14,-37,fmc.map(([a,b])=>[a*.83+.15,b*.83]),fmc.map(([a,b])=>[a*.55+.15,b*.55]),8,8.48,glass,{floors:2,columns:9});
  record('FMCTower',14,-37,8.48,'chamfered asymmetric crystalline glass');
  // Cira is deliberately near enough for its angled SIDE, not just its outline,
  // to read. The western skyline is compositionally brought into this vista.
  const ciraBottom=[[-1.26,.86],[.62,.86],[1.28,.2],[.93,-.84],[-.7,-.84],[-1.3,-.25]];
  const ciraTop=[[-.97,.65,.40],[.39,.65,.08],[.94,.1,-.20],[.69,-.66,-.08],[-.53,-.66,.36],[-1.03,-.18,.47]];
  prism('CiraCentre',1.4,-23.5,ciraBottom,ciraTop,0,7.1,glass,{floors:29,columns:12,led:true});
  record('CiraCentre',1.4,-23.5,7.57,'irregular inclined glass facets, angled roof and animated side LEDs');
  // Batched room windows and Cira LEDs: shader animation only, no per-window lights
  // or CPU matrix changes. Uneven occupancy varies slowly, never synchronized.
  const uniforms={uTime:{value:0}};
  const makeLights=(records,isLED)=>{
    const g=room._geometry(new THREE.PlaneGeometry(1,1));
    const m=room._material(new THREE.ShaderMaterial({uniforms:{uTime:uniforms.uTime,uLED:{value:isLED?1:0}},transparent:true,depthWrite:false,side:THREE.DoubleSide,vertexShader:`attribute float aSeed; varying vec3 vPlace; varying float vSeed; void main(){vSeed=aSeed; vec4 p=instanceMatrix*vec4(position,1.);vPlace=p.xyz;gl_Position=projectionMatrix*modelViewMatrix*p;}`,fragmentShader:`uniform float uTime;uniform float uLED;varying vec3 vPlace;varying float vSeed;void main(){float slow=smoothstep(-.5,.7,sin(uTime*.045+vSeed*39.));vec3 warm=mix(vec3(.52,.57,.63),vec3(1.,.73,.38),vSeed);float alpha=.13+slow*.29;if(uLED>.5){float wave=.5+.5*sin(vPlace.y*1.85+vPlace.x*1.1-uTime*.24);float second=.5+.5*sin(vPlace.y*.7-vPlace.z*.9+uTime*.17);warm=mix(vec3(.06,.48,.78),vec3(.53,.22,.7),second);warm=mix(warm,vec3(.4,.86,.82),wave*.58);alpha=.4+.55*wave;}gl_FragColor=vec4(warm,alpha);}` }));
    const mesh=new THREE.InstancedMesh(g,m,records.length);mesh.name=isLED?'CiraAnimatedFacadeLEDs':'PhiladelphiaUnevenRoomLights';const dummy=new THREE.Object3D();const seeds=new Float32Array(records.length);
    records.forEach((r,i)=>{dummy.position.copy(r.p);dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),r.n);dummy.scale.set(r.w,r.h,1);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);seeds[i]=r.seed;});g.setAttribute('aSeed',new THREE.InstancedBufferAttribute(seeds,1));mesh.computeBoundingSphere();root.add(mesh);return mesh;
  };
  const officeLights=makeLights(windows,false), ciraLEDs=makeLights(ledWindows,true);
  const snowGeometry=room._geometry(new THREE.BufferGeometry());
  snowGeometry.setAttribute('position',new THREE.Float32BufferAttribute(snowPositions,3));
  snowGeometry.setAttribute('normal',new THREE.Float32BufferAttribute(snowNormals,3));
  const snowMaterial=room._material(room.snowMaterial.clone());room.snowCapMaterials.push(snowMaterial);
  const snowCaps=new THREE.Mesh(snowGeometry,snowMaterial);snowCaps.name='PhiladelphiaLandmarkRoofSnow';root.add(snowCaps);
  room._batchStaticMeshes(structure,'PhiladelphiaLandmarks');
  root.userData.architecture=architecture;
  return {root,architecture,ciraLEDs,officeLights,snowCaps,update(time,reduced=false){if(!reduced)uniforms.uTime.value=time;},get animationTime(){return uniforms.uTime.value;}};
}
