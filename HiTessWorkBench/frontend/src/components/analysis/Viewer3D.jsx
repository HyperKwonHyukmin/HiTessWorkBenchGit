/**
 * @fileoverview Three.js 기반의 3D Beam 렌더링 및 변위(Displacement) 시각화 컴포넌트
 */
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { createThreeScene } from '../../hooks/useThreeScene';
import { loadToNewton } from '../../hooks/useBeamModeling';
import { RefreshCw } from 'lucide-react';

export default function Viewer3D({ beamType, params, loads, boundaries, dispData, hasCharts, isCapturing }) {
  const mountRef = useRef(null);
  const rendererRef = useRef(null);
  const [isLayoutReady, setIsLayoutReady] = useState(false);
  const [defScale, setDefScale] = useState(0.3);
  const defScaleRef = useRef(0.3);

  const handleScaleChange = (e) => {
    const val = parseFloat(e.target.value);
    setDefScale(val);
    defScaleRef.current = val;
  };

  const createTextSprite = (message, color = "rgba(255, 60, 60, 1.0)") => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.font = "Bold 36px Arial";
    const metrics = context.measureText(message);
    canvas.width = metrics.width + 40;
    canvas.height = 50;
    context.fillStyle = color;
    context.textAlign = "center";
    context.fillText(message, canvas.width / 2, 38);
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(canvas.width * 0.8, canvas.height * 0.8, 1);
    return sprite;
  };

  useEffect(() => {
    const timer = setTimeout(() => setIsLayoutReady(true), 400); 
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isLayoutReady || !mountRef.current) return;
    const { scene, camera, renderer, controls, startAnimate, cleanup } =
      createThreeScene(mountRef.current, { zUp: false, preserveDrawingBuffer: true });
    rendererRef.current = renderer;

    const modelGroup = new THREE.Group();
    scene.add(modelGroup);

    const { length, dim1, dim2, dim3, dim4 } = {
      length: Number(params.length)||1, dim1: Number(params.dim1)||1,
      dim2: Number(params.dim2)||1, dim3: Number(params.dim3)||1, dim4: Number(params.dim4)||1
    };

    const maxHeight = (beamType === 'ROD' || beamType === 'TUBE') ? dim1 / 2 : dim2 / 2;

    let geometry;
    const extrudeSettings = { depth: length, bevelEnabled: false, steps: 100 }; 

    if (beamType === 'BAR') geometry = new THREE.BoxGeometry(length, dim2, dim1, 100, 1, 1);
    else if (beamType === 'ROD') { geometry = new THREE.CylinderGeometry(dim1/2, dim1/2, length, 32, 100); geometry.rotateZ(Math.PI / 2); }
    else {
      const shape = new THREE.Shape();
      const w = dim1, h = dim2, tf = dim3, tw = dim4;
      if (beamType === 'I') { shape.moveTo(-w/2, -h/2); shape.lineTo(w/2, -h/2); shape.lineTo(w/2, -h/2 + tf); shape.lineTo(tw/2, -h/2 + tf); shape.lineTo(tw/2, h/2 - tf); shape.lineTo(w/2, h/2 - tf); shape.lineTo(w/2, h/2); shape.lineTo(-w/2, h/2); shape.lineTo(-w/2, h/2 - tf); shape.lineTo(-tw/2, h/2 - tf); shape.lineTo(-tw/2, -h/2 + tf); shape.lineTo(-w/2, -h/2 + tf); shape.lineTo(-w/2, -h/2); }
      else if (beamType === 'H') { shape.moveTo(-w/2, -h/2); shape.lineTo(-w/2 + tf, -h/2); shape.lineTo(-w/2 + tf, -tw/2); shape.lineTo(w/2 - tf, -tw/2); shape.lineTo(w/2 - tf, -h/2); shape.lineTo(w/2, -h/2); shape.lineTo(w/2, h/2); shape.lineTo(w/2 - tf, h/2); shape.lineTo(w/2 - tf, tw/2); shape.lineTo(-w/2 + tf, tw/2); shape.lineTo(-w/2 + tf, h/2); shape.lineTo(-w/2, h/2); shape.lineTo(-w/2, -h/2); }
      else if (beamType === 'L') { shape.moveTo(-w/2, -h/2); shape.lineTo(w/2, -h/2); shape.lineTo(w/2, -h/2 + tf); shape.lineTo(-w/2 + tw, -h/2 + tf); shape.lineTo(-w/2 + tw, h/2); shape.lineTo(-w/2, h/2); shape.lineTo(-w/2, -h/2); }
      else if (beamType === 'T') { shape.moveTo(-tw/2, -h/2); shape.lineTo(tw/2, -h/2); shape.lineTo(tw/2, h/2 - tf); shape.lineTo(w/2, h/2 - tf); shape.lineTo(w/2, h/2); shape.lineTo(-w/2, h/2); shape.lineTo(-w/2, h/2 - tf); shape.lineTo(-tw/2, h/2 - tf); shape.lineTo(-tw/2, -h/2); }
      else if (beamType === 'CHAN') { shape.moveTo(-w/2, -h/2); shape.lineTo(w/2, -h/2); shape.lineTo(w/2, -h/2 + tf); shape.lineTo(-w/2 + tw, -h/2 + tf); shape.lineTo(-w/2 + tw, h/2 - tf); shape.lineTo(w/2, h/2 - tf); shape.lineTo(w/2, h/2); shape.lineTo(-w/2, h/2); shape.lineTo(-w/2, -h/2); }
      else if (beamType === 'TUBE') { shape.absarc(0, 0, dim1/2, 0, Math.PI * 2, false); const inner = (dim1/2) - dim2; if (inner > 0) { const hole = new THREE.Path(); hole.absarc(0, 0, inner, 0, Math.PI * 2, true); shape.holes.push(hole); } }
      
      geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      geometry.center(); geometry.rotateY(Math.PI / 2);
    }

    const material = new THREE.MeshStandardMaterial({ color: 0x00E600, roughness: 0.3, metalness: 0.6, side: THREE.DoubleSide });
    
    if (dispData.length > 0) {
      const positions = geometry.attributes.position;
      geometry.setAttribute('basePosition', positions.clone());
      const targetDispZArray = new Float32Array(positions.count);
      const colors = [];
      const colorObj = new THREE.Color();
      const maxDisp = Math.max(...dispData.map(d => Math.abs(d['DispZ[mm]'] || 0)));
      const baseDispScale = maxDisp > 0 ? (length * 0.15) / maxDisp : 1; 

      for(let i=0; i < positions.count; i++) {
        const vx = positions.getX(i);
        const realX = vx + length / 2; 

        let dZ = 0;
        for(let j=0; j < dispData.length - 1; j++) {
           if (realX >= dispData[j]['X[mm]'] && realX <= dispData[j+1]['X[mm]']) {
              const x0 = dispData[j]['X[mm]']; const x1 = dispData[j+1]['X[mm]'];
              const y0 = dispData[j]['DispZ[mm]']; const y1 = dispData[j+1]['DispZ[mm]'];
              dZ = y0 + ((realX - x0) / (x1 - x0 || 1)) * (y1 - y0);
              break;
           }
        }
        targetDispZArray[i] = dZ * baseDispScale;
        const normalized = maxDisp > 0 ? Math.abs(dZ) / maxDisp : 0;
        colorObj.setHSL((1 - normalized) * 0.65, 1.0, 0.5); 
        colors.push(colorObj.r, colorObj.g, colorObj.b);
      }
      
      geometry.setAttribute('targetDispZ', new THREE.BufferAttribute(targetDispZArray, 1));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      material.vertexColors = true; 
      material.color.setHex(0xffffff); 
    }

    const mesh = new THREE.Mesh(geometry, material);
    const edges = new THREE.EdgesGeometry(geometry, 15);
    mesh.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff, opacity: dispData.length > 0 ? 0.1 : 0.3, transparent: true })));
    modelGroup.add(mesh);

    boundaries.forEach(bc => {
      let bColor = 0xf59e0b, bcGeo, yOffset;
      const sphereRadius = Math.max(dim1 * 0.3, 15);
      yOffset = -maxHeight - sphereRadius;

      if (bc.type === 'Fix') { bColor = 0xef4444; const ch = Math.max(dim1 * 0.8, 30); bcGeo = new THREE.ConeGeometry(dim1 * 0.4, ch, 16); yOffset = -maxHeight - ch/2; }
      else if (bc.type === 'Hinge') { bColor = 0x3b82f6; bcGeo = new THREE.SphereGeometry(sphereRadius, 32, 32); }
      else if (bc.type === 'Roller') { bColor = 0x10b981; bcGeo = new THREE.CylinderGeometry(sphereRadius, sphereRadius, dim1 * 1.5, 32); bcGeo.rotateX(Math.PI / 2); }
      else { bColor = 0x64748b; bcGeo = new THREE.BoxGeometry(sphereRadius*1.5, sphereRadius*1.5, sphereRadius*1.5); yOffset = -maxHeight - (sphereRadius*1.5)/2; }

      const emissiveColor = bColor === 0xef4444 ? 0x880000 : bColor === 0x3b82f6 ? 0x112266 : 0x115533;
      const bcMesh = new THREE.Mesh(bcGeo, new THREE.MeshStandardMaterial({ color: bColor, roughness: 0.3, metalness: 0.5, emissive: emissiveColor, emissiveIntensity: 0.7 }));
      bcMesh.position.set((Number(bc.pos) || 0) - length / 2, yOffset, 0);
      modelGroup.add(bcMesh);
    });

    loads.forEach(load => {
      // 화살표 크기/라벨 기준은 항상 N 단위 (ton 입력은 환산)
      const nf = loadToNewton(load);
      const vec = new THREE.Vector3(nf.fx, nf.fz, -nf.fy);
      const magVal = vec.length();
      if (magVal < 1e-5) return; 

      const dir = vec.clone().normalize();
      const arrowGroup = new THREE.Group();
      const baseLen = Math.max(80, Math.min(200, magVal * 0.015)); 
      const headLen = baseLen * 0.3, shaftLen = baseLen - headLen, radius = baseLen * 0.08; 
      const mat = new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0x440000 });
      
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, shaftLen, 16), mat);
      shaft.position.y = -headLen - shaftLen / 2;
      const head = new THREE.Mesh(new THREE.ConeGeometry(radius * 2.5, headLen, 16), mat);
      head.position.y = -headLen / 2;
      arrowGroup.add(shaft, head);
      arrowGroup.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
      arrowGroup.position.set((Number(load.pos) || 0) - length/2, (vec.y < 0 ? maxHeight : (vec.y > 0 ? -maxHeight : 0)), 0);

      const textLabel = createTextSprite(`${parseFloat(magVal.toFixed(2))} N`);
      textLabel.position.set(0, -baseLen - 40, 0); 
      arrowGroup.add(textLabel); 
      modelGroup.add(arrowGroup);
    });

    const viewDist = Math.max(length, 400); 
    camera.position.set(viewDist * 0.7, viewDist * 0.5, viewDist * 0.9);
    controls.update();

    const viewCenter = new THREE.Vector3(0, 0, 0);
    startAnimate(viewCenter, length, () => {
      if (dispData.length > 0 && geometry) {
        const pos     = geometry.attributes.position;
        const basePos = geometry.attributes.basePosition;
        const tDisp   = geometry.attributes.targetDispZ;
        if (basePos && tDisp) {
          for (let i = 0; i < pos.count; i++)
            pos.setY(i, basePos.getY(i) + tDisp.getX(i) * defScaleRef.current);
          pos.needsUpdate = true;
        }
      }
    });

    return () => { cleanup(); };
  }, [isLayoutReady, params, beamType, loads, boundaries, dispData]);

  if (!isLayoutReady && !isCapturing) {
    return (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/80 backdrop-blur-sm text-brand-accent">
        <RefreshCw className="animate-spin mb-4" size={48} />
        <p className="font-mono font-bold tracking-widest uppercase">Initializing Engine...</p>
      </div>
    );
  }

  return (
    <div className={`relative w-full bg-black transition-all duration-500 shrink-0 ${isCapturing ? 'h-[550px] border-b border-slate-800 rounded-xl overflow-hidden' : (hasCharts ? 'h-[45%] border-b border-slate-800' : 'h-full')}`}>
      <div ref={mountRef} className="absolute inset-0 w-full h-full cursor-move" />
      {hasCharts && (
        <>
          <div className="absolute top-4 left-4 bg-slate-900/80 backdrop-blur px-3 py-1.5 rounded-lg border border-slate-700 pointer-events-none">
             <span className="text-[10px] font-bold text-emerald-400">● 3D Deformation Mapped</span>
          </div>
          {!isCapturing && (
            <div className="absolute bottom-4 left-4 w-64 bg-slate-900/80 backdrop-blur px-4 py-3 rounded-xl border border-slate-700 flex flex-col gap-2 z-10 shadow-lg pointer-events-auto">
              <div className="flex justify-between items-center">
                  <span className="text-[11px] font-bold text-emerald-400">Deformation Scale</span>
                  <span className="text-xs font-mono text-white">{defScale.toFixed(1)}x</span>
              </div>
              <input type="range" min="0" max="5" step="0.1" value={defScale} onChange={handleScaleChange} className="w-full accent-emerald-500 cursor-pointer" />
            </div>
          )}
        </>
      )}
    </div>
  );
}