/**
 * @fileoverview Three.js 기반의 3D Beam 렌더링 및 변위(Displacement) 시각화 컴포넌트
 */
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { createThreeScene } from '../../hooks/useThreeScene';
import { loadToNewton } from '../../hooks/useBeamModeling';
import { RefreshCw } from 'lucide-react';

export default function Viewer3D({ beamType, params, loads, boundaries, dispData, hasCharts, isCapturing, lightMode = false }) {
  const mountRef = useRef(null);
  const gizmoRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const viewDistanceRef = useRef(1000);
  const bloomPassRef = useRef(null);
  const modelMaterialRef = useRef(null);
  const edgeMaterialRef = useRef(null);
  const ambientLightRef = useRef(null);
  const directionalLightsRef = useRef([]);
  const [isLayoutReady, setIsLayoutReady] = useState(false);
  const [defScale, setDefScale] = useState(0.3);
  const defScaleRef = useRef(0.3);

  const handleScaleChange = (e) => {
    const val = parseFloat(e.target.value);
    setDefScale(val);
    defScaleRef.current = val;
  };

  const setCameraView = (axis) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    const distance = viewDistanceRef.current;
    camera.up.set(0, 1, 0);
    if (axis === 'x') camera.position.set(distance, 0, 0);
    if (axis === 'y') {
      camera.position.set(0, distance, 0);
      camera.up.set(0, 0, 1);
    }
    if (axis === 'z') camera.position.set(0, 0, distance);
    if (axis === 'iso') camera.position.set(distance * 0.7, distance * 0.5, distance * 0.9);

    controls.target.set(0, 0, 0);
    camera.lookAt(controls.target);
    controls.update();
  };

  const createTextSprite = (message) => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const fontSize = 42; // 이전 47px 대비 약 10% 축소
    context.font = `800 ${fontSize}px Arial`;
    const metrics = context.measureText(message);
    canvas.width = Math.ceil(metrics.width + 56);
    canvas.height = 72;

    // canvas 크기 변경 후 drawing state가 초기화되므로 폰트를 다시 지정한다.
    context.font = `800 ${fontSize}px Arial`;
    context.textAlign = "center";
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.strokeStyle = '#ffffff';
    context.lineWidth = 7;
    context.strokeText(message, canvas.width / 2, canvas.height / 2);
    context.fillStyle = '#dc2626';
    context.fillText(message, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(canvas.width * 0.8, canvas.height * 0.8, 1);
    return sprite;
  };

  const createAxisLabel = (message, color) => {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    context.font = '800 54px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.strokeStyle = '#ffffff';
    context.lineWidth = 8;
    context.strokeText(message, 48, 48);
    context.fillStyle = color;
    context.fillText(message, 48, 48);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(1, 1, 1);
    return sprite;
  };

  const addAxisArrow = (group, direction, color, label, length, radius) => {
    const dir = direction.clone().normalize();
    const headLength = length * 0.22;
    const material = new THREE.MeshBasicMaterial({ color, depthTest: false });
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, length - headLength, 12),
      material,
    );
    shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    shaft.position.copy(dir.clone().multiplyScalar((length - headLength) / 2));
    shaft.renderOrder = 100;
    group.add(shaft);

    const head = new THREE.Mesh(
      new THREE.ConeGeometry(radius * 2.6, headLength, 16),
      material.clone(),
    );
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    head.position.copy(dir.clone().multiplyScalar(length - headLength / 2));
    head.renderOrder = 100;
    group.add(head);

    const labelSprite = createAxisLabel(label, `#${color.toString(16).padStart(6, '0')}`);
    labelSprite.position.copy(dir.clone().multiplyScalar(length * 1.14));
    labelSprite.scale.setScalar(length * 0.24);
    labelSprite.renderOrder = 101;
    group.add(labelSprite);
  };

  useEffect(() => {
    const timer = setTimeout(() => setIsLayoutReady(true), 400); 
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isLayoutReady || !mountRef.current) return;
    const { scene, camera, renderer, controls, bloomPass, startAnimate, cleanup } =
      createThreeScene(mountRef.current, {
        zUp: false,
        preserveDrawingBuffer: true,
        backgroundColor: lightMode ? 0xf8fafc : 0x060b14,
        theme: lightMode ? 'light' : 'dark',
        bloomStrength: lightMode ? 0.04 : 0.35,
        bloomRadius: lightMode ? 0.08 : 0.4,
      });
    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    bloomPassRef.current = bloomPass;
    ambientLightRef.current = scene.children.find(child => child.isAmbientLight) || null;
    directionalLightsRef.current = scene.children.filter(child => child.isDirectionalLight);
    renderer.toneMappingExposure = lightMode ? 0.92 : 1.15;

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

    const material = new THREE.MeshStandardMaterial({
      color: lightMode ? 0x047857 : 0x00E600,
      roughness: lightMode ? 0.52 : 0.3,
      metalness: lightMode ? 0.18 : 0.6,
      side: THREE.DoubleSide,
    });
    modelMaterialRef.current = material;
    
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
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: lightMode ? 0x334155 : 0xffffff,
      opacity: dispData.length > 0 ? (lightMode ? 0.72 : 0.1) : (lightMode ? 0.9 : 0.3),
      transparent: true,
      depthTest: true,
    });
    edgeMaterialRef.current = edgeMaterial;
    mesh.add(new THREE.LineSegments(edges, edgeMaterial));
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
      const baseLen = Math.max(106, Math.min(264, magVal * 0.0198)); // 현재 크기 대비 20% 추가 확대
      const headLen = baseLen * 0.3, shaftLen = baseLen - headLen, radius = baseLen * 0.08; 
      const mat = new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xdc2626,
        emissiveIntensity: 0.75,
        roughness: 0.35,
        metalness: 0.05,
      });
      
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
    viewDistanceRef.current = viewDist * 1.25;
    camera.position.set(viewDist * 0.7, viewDist * 0.5, viewDist * 0.9);
    controls.target.set(0, 0, 0);
    controls.update();

    let gizmoRenderer = null;
    let gizmoScene = null;
    let gizmoCamera = null;
    if (gizmoRef.current) {
      gizmoScene = new THREE.Scene();
      gizmoCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 20);
      gizmoRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      gizmoRenderer.setSize(96, 96);
      gizmoRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      gizmoRenderer.outputColorSpace = THREE.SRGBColorSpace;
      gizmoRef.current.innerHTML = '';
      gizmoRef.current.appendChild(gizmoRenderer.domElement);

      const gizmoAxes = new THREE.Group();
      addAxisArrow(gizmoAxes, new THREE.Vector3(1, 0, 0), 0xef4444, 'X', 1, 0.045);
      addAxisArrow(gizmoAxes, new THREE.Vector3(0, 1, 0), 0x22c55e, 'Y', 1, 0.045);
      addAxisArrow(gizmoAxes, new THREE.Vector3(0, 0, 1), 0x3b82f6, 'Z', 1, 0.045);
      gizmoScene.add(gizmoAxes);
    }

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
      if (gizmoRenderer && gizmoScene && gizmoCamera) {
        const direction = camera.position.clone().sub(controls.target).normalize();
        gizmoCamera.position.copy(direction.multiplyScalar(3.6));
        gizmoCamera.up.copy(camera.up);
        gizmoCamera.lookAt(0, 0, 0);
        gizmoRenderer.render(gizmoScene, gizmoCamera);
      }
    });

    return () => {
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      bloomPassRef.current = null;
      modelMaterialRef.current = null;
      edgeMaterialRef.current = null;
      ambientLightRef.current = null;
      directionalLightsRef.current = [];
      if (gizmoScene) {
        gizmoScene.traverse((object) => {
          object.geometry?.dispose();
          if (object.material) {
            (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => {
              material.map?.dispose();
              material.dispose();
            });
          }
        });
      }
      gizmoRenderer?.dispose();
      if (gizmoRef.current) gizmoRef.current.innerHTML = '';
      cleanup();
    };
  }, [isLayoutReady, params, beamType, loads, boundaries, dispData, lightMode]);

  useEffect(() => {
    if (!sceneRef.current) return;
    const useLightSurface = isCapturing || lightMode;
    sceneRef.current.background = new THREE.Color(isCapturing ? 0xffffff : (lightMode ? 0xf8fafc : 0x060b14));
    if (bloomPassRef.current) {
      bloomPassRef.current.strength = isCapturing ? 0 : (lightMode ? 0.04 : 0.35);
      bloomPassRef.current.radius = useLightSurface ? 0.08 : 0.4;
    }
    if (rendererRef.current) {
      rendererRef.current.toneMappingExposure = useLightSurface ? 0.92 : 1.15;
    }
    if (ambientLightRef.current) {
      ambientLightRef.current.color.setHex(useLightSurface ? 0xffffff : 0x1a2840);
      ambientLightRef.current.intensity = useLightSurface ? 1.8 : 2.0;
    }
    directionalLightsRef.current.forEach((light, index) => {
      if (index === 0) {
        light.color.setHex(0xffffff);
        light.intensity = useLightSurface ? 2.0 : 2.5;
      } else if (index === 1) {
        light.color.setHex(useLightSurface ? 0xdbeafe : 0x4466aa);
        light.intensity = useLightSurface ? 1.0 : 1.2;
      } else {
        light.color.setHex(useLightSurface ? 0x60a5fa : 0x00aaff);
        light.intensity = useLightSurface ? 0.45 : 0.8;
      }
    });
    if (edgeMaterialRef.current) {
      edgeMaterialRef.current.color.setHex(useLightSurface ? 0x1e293b : 0xffffff);
      edgeMaterialRef.current.opacity = dispData.length > 0
        ? (useLightSurface ? 0.72 : 0.1)
        : (useLightSurface ? 0.9 : 0.3);
      edgeMaterialRef.current.needsUpdate = true;
    }
    if (modelMaterialRef.current && !modelMaterialRef.current.vertexColors) {
      modelMaterialRef.current.color.setHex(useLightSurface ? 0x047857 : 0x00E600);
      modelMaterialRef.current.roughness = useLightSurface ? 0.52 : 0.3;
      modelMaterialRef.current.metalness = useLightSurface ? 0.18 : 0.6;
      modelMaterialRef.current.needsUpdate = true;
    }
  }, [isCapturing, lightMode, dispData.length]);

  if (!isLayoutReady && !isCapturing) {
    return (
      <div className={`absolute inset-0 z-50 flex flex-col items-center justify-center backdrop-blur-sm ${lightMode ? 'bg-white/80 text-blue-600' : 'bg-slate-900/80 text-brand-accent'}`}>
        <RefreshCw className="animate-spin mb-4" size={48} />
        <p className="font-mono font-bold tracking-widest uppercase">Initializing Engine...</p>
      </div>
    );
  }

  return (
    <div className={`relative w-full transition-all duration-500 shrink-0 ${isCapturing ? 'bg-white h-[550px] border-b border-slate-200 rounded-xl overflow-hidden' : `${lightMode ? 'bg-slate-50 border-slate-200' : 'bg-black border-slate-800'} ${hasCharts ? 'h-[45%] border-b' : 'h-full'}`}`}>
      <div ref={mountRef} className="absolute inset-0 w-full h-full cursor-move" />
      {hasCharts && (
        <>
          <div className={`absolute top-4 left-4 backdrop-blur px-3 py-1.5 rounded-lg border pointer-events-none ${lightMode || isCapturing ? 'bg-white/90 border-slate-200' : 'bg-slate-900/80 border-slate-700'}`}>
             <span className={`text-[10px] font-bold ${lightMode || isCapturing ? 'text-emerald-700' : 'text-emerald-400'}`}>● 3D Deformation Mapped</span>
          </div>
          {!isCapturing && (
            <div className={`absolute bottom-4 left-4 w-64 backdrop-blur px-4 py-3 rounded-xl border flex flex-col gap-2 z-10 shadow-lg pointer-events-auto ${lightMode ? 'bg-white/90 border-slate-200' : 'bg-slate-900/80 border-slate-700'}`}>
              <div className="flex justify-between items-center">
                  <span className={`text-[11px] font-bold ${lightMode ? 'text-emerald-700' : 'text-emerald-400'}`}>Deformation Scale</span>
                  <span className={`text-xs font-mono ${lightMode ? 'text-slate-800' : 'text-white'}`}>{defScale.toFixed(1)}x</span>
              </div>
              <input type="range" min="0" max="5" step="0.1" value={defScale} onChange={handleScaleChange} className="w-full accent-emerald-500 cursor-pointer" />
            </div>
          )}
        </>
      )}
      {/* 변위 컬러바 범례 — 컬러맵은 |DispZ| 크기 기반(0=파랑 ~ 최대=빨강) */}
      {hasCharts && dispData && dispData.length > 0 && !isCapturing && (() => {
        const maxDisp = Math.max(...dispData.map(d => Math.abs(d['DispZ[mm]'] || 0)));
        return (
          <div className={`absolute bottom-4 right-4 z-10 flex flex-col items-center gap-1 rounded-xl border px-3 py-3 shadow-lg backdrop-blur ${lightMode ? 'bg-white/90 border-slate-200' : 'bg-slate-900/80 border-slate-700'}`}>
            <span className={`text-[9px] font-bold uppercase tracking-wider mb-1 ${lightMode ? 'text-slate-500' : 'text-slate-400'}`}>|DispZ|</span>
            <span className={`text-[10px] font-mono font-bold ${lightMode ? 'text-red-600' : 'text-red-400'}`}>{maxDisp.toFixed(2)}</span>
            <div
              className="w-4 rounded overflow-hidden border border-slate-300/30"
              style={{
                height: '80px',
                background: 'linear-gradient(to bottom, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%))',
              }}
            />
            <span className={`text-[10px] font-mono font-bold ${lightMode ? 'text-blue-600' : 'text-blue-400'}`}>0.00</span>
            <span className={`text-[9px] font-mono ${lightMode ? 'text-slate-400' : 'text-slate-500'}`}>mm</span>
          </div>
        );
      })()}
      <div className="absolute top-4 right-4 z-20 flex flex-col items-end gap-2">
        {/* Gizmo */}
        <div className={`h-24 w-24 overflow-hidden rounded-xl border shadow-lg backdrop-blur pointer-events-none ${lightMode || isCapturing ? 'bg-white/85 border-slate-200' : 'bg-slate-900/75 border-slate-700'}`}>
          <div ref={gizmoRef} className="h-full w-full" />
        </div>
        {/* 뷰 버튼 */}
        {!isCapturing && (
          <div className={`flex items-center gap-1 rounded-xl border p-1 shadow-lg backdrop-blur ${lightMode ? 'bg-white/90 border-slate-200' : 'bg-slate-900/85 border-slate-700'}`}>
            {[
              { key: 'x', label: 'X', color: 'text-red-500' },
              { key: 'y', label: 'Y', color: 'text-green-500' },
              { key: 'z', label: 'Z', color: 'text-blue-500' },
              { key: 'iso', label: 'ISO', color: lightMode ? 'text-slate-700' : 'text-slate-200' },
            ].map(({ key, label, color }) => (
              <button
                key={key}
                type="button"
                onClick={() => setCameraView(key)}
                className={`min-w-9 rounded-lg px-2 py-1.5 text-[10px] font-black transition-colors ${color} ${lightMode ? 'hover:bg-slate-100' : 'hover:bg-slate-700'}`}
                title={`${label} 방향 뷰`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
