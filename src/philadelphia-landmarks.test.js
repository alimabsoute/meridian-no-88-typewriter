import * as THREE from 'three';
import {describe,it,expect} from 'vitest';
import {createPhiladelphiaLandmarks} from './philadelphia-landmarks.js';

describe('Philadelphia landmark roof surfaces',()=>{
  it('faces horizontal and inclined roofs upward and preserves those profiles in a shared snow mesh',()=>{
    const resources=[];
    const register=x=>(resources.push(x),x);
    const room={_geometry:register,_material:register,_texture:register,_batchStaticMeshes:()=>{},snowMaterial:new THREE.MeshStandardMaterial({color:0xffffff,transparent:true,opacity:0}),snowCapMaterials:[]};
    const parent=new THREE.Group();
    try{
      const result=createPhiladelphiaLandmarks(room,parent);
      for(const name of ['ComcastCenter','CiraCentre']){
        const mesh=parent.getObjectByName(name),position=mesh.geometry.getAttribute('position'),normal=mesh.geometry.getAttribute('normal');
        let roofTriangles=0;
        for(let i=0;i<position.count;i+=3){
          const a=new THREE.Vector3().fromBufferAttribute(position,i),b=new THREE.Vector3().fromBufferAttribute(position,i+1),c=new THREE.Vector3().fromBufferAttribute(position,i+2);
          const geometricNormal=b.clone().sub(a).cross(c.clone().sub(a)).normalize();
          // Distinguish roofs by geometry: entirely near the summit with a
          // predominantly horizontal plane, independent of vertex normals.
          const summit=name==='CiraCentre'?6.85:9.09;
          if(Math.min(a.y,b.y,c.y)>summit && Math.abs(geometricNormal.y)>.8){
            roofTriangles++;
            expect(geometricNormal.y).toBeGreaterThan(.8);
            expect(normal.getY(i)).toBeGreaterThan(.8);
            const ray=new THREE.Raycaster(a.clone().add(b).add(c).multiplyScalar(1/3).add(new THREE.Vector3(0,2,0)),new THREE.Vector3(0,-1,0));
            expect(ray.intersectObject(mesh).length).toBeGreaterThan(0);
          }
        }
        expect(roofTriangles).toBeGreaterThan(0);
      }
      const snow=result.snowCaps.geometry;
      const normals=snow.getAttribute('normal'),vertices=snow.getAttribute('position');
      for(let i=0;i<normals.count;i++)expect(normals.getY(i)).toBeGreaterThan(.8);
      // Cira's snow follows its non-horizontal roof, including both high and low
      // edges. This fails if it regresses to a flat bounding-box cap.
      const ciraRoofY=[];
      for(let i=0;i<vertices.count;i++)if(vertices.getX(i)>.09&&vertices.getX(i)<2.7&&vertices.getZ(i)>-24.4&&vertices.getZ(i)<-22.6)ciraRoofY.push(vertices.getY(i));
      expect(Math.max(...ciraRoofY)-Math.min(...ciraRoofY)).toBeGreaterThan(.5);
      expect(room.snowCapMaterials).toContain(result.snowCaps.material);
      expect(result.snowCaps.material).not.toBe(room.snowMaterial);
    }finally{resources.forEach(r=>r.dispose());room.snowMaterial.dispose();}
  });
});
