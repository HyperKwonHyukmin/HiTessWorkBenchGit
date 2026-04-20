import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';

/**
 * Three.js 씬 설정 팩토리 함수.
 * Scene / Camera / Renderer(ACES) / OrbitControls / EffectComposer(Bloom) / 3-point lighting 일괄 생성.
 *
 * @param {HTMLElement} mountEl        canvas를 마운트할 DOM 요소
 * @param {object}      options
 * @param {boolean}     [options.zUp=true]                 카메라 up 축 (true: Z-up, false: Y-up)
 * @param {boolean}     [options.preserveDrawingBuffer=false] 캡처용 버퍼 보존
 * @param {boolean}     [options.fog=false]                FogExp2 사용 여부
 * @param {number}      [options.fov=45]                   카메라 FOV
 * @param {number}      [options.bloomStrength=0.5]
 * @param {number}      [options.bloomRadius=0.4]
 * @param {number}      [options.bloomThreshold=0.65]
 * @returns {{ scene, camera, renderer, controls, composer, startAnimate, cleanup }}
 */
export function createThreeScene(mountEl, options = {}) {
  const {
    fov = 45,
    zUp = true,
    preserveDrawingBuffer = false,
    fog = false,
    bloomStrength = 0.5,
    bloomRadius = 0.4,
    bloomThreshold = 0.65,
  } = options;

  const w = mountEl.clientWidth  || 800;
  const h = mountEl.clientHeight || 500;

  // ── Scene ──────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060b14);
  if (fog) scene.fog = new THREE.FogExp2(0x060b14, 0.0004);

  // ── Camera ─────────────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(fov, w / h, 0.1, 10_000_000);
  if (zUp) camera.up.set(0, 0, 1);

  // ── Renderer ───────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping      = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.width  = '100%';
  renderer.domElement.style.height = '100%';
  mountEl.appendChild(renderer.domElement);

  // ── OrbitControls ──────────────────────────────────────────────────
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping  = true;
  controls.dampingFactor  = 0.06;

  // ── Post-processing: Bloom ─────────────────────────────────────────
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(w, h),
    bloomStrength,
    bloomRadius,
    bloomThreshold
  );
  composer.addPass(bloomPass);

  // ── 3-point Lighting ───────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0x1a2840, 2.0));

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
  keyLight.position.set(500, 800, 600);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x4466aa, 1.2);
  fillLight.position.set(-400, 200, -300);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0x00aaff, 0.8);
  rimLight.position.set(0, -600, -500);
  scene.add(rimLight);

  // ── ResizeObserver ─────────────────────────────────────────────────
  const resizeObserver = new ResizeObserver(() => {
    const rw = mountEl.clientWidth;
    const rh = mountEl.clientHeight;
    if (!rw || !rh) return;
    camera.aspect = rw / rh;
    camera.updateProjectionMatrix();
    renderer.setSize(rw, rh);
    composer.setSize(rw, rh);
    renderer.domElement.style.width  = '100%';
    renderer.domElement.style.height = '100%';
  });
  resizeObserver.observe(mountEl);

  let animId;
  let t = 0;

  /**
   * 애니메이션 루프 시작.
   * rimLight 궤도 + controls.update() + composer.render() 처리.
   *
   * @param {THREE.Vector3} center  모델 중심 (rimLight 궤도 기준)
   * @param {number}        maxDim  모델 최대 치수 (rimLight 반경 계산)
   * @param {function|null} onFrame 매 프레임 추가 콜백 (선택)
   */
  function startAnimate(center = new THREE.Vector3(), maxDim = 1000, onFrame = null) {
    const radius = maxDim * 0.6;
    const loop = () => {
      animId = requestAnimationFrame(loop);
      t += 0.008;
      if (zUp) {
        rimLight.position.set(
          center.x + Math.sin(t * 0.6) * radius,
          center.y + Math.cos(t * 0.6) * radius,
          center.z + maxDim * 0.5
        );
      } else {
        rimLight.position.set(
          center.x + Math.sin(t * 0.6) * radius,
          center.y + maxDim * 0.5,
          center.z + Math.cos(t * 0.6) * radius
        );
      }
      controls.update();
      if (onFrame) onFrame(t);
      composer.render();
    };
    loop();
  }

  function cleanup() {
    cancelAnimationFrame(animId);
    resizeObserver.disconnect();
    scene.traverse(obj => {
      obj.geometry?.dispose();
      if (obj.material) {
        (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => m.dispose());
      }
    });
    controls.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    try { mountEl.removeChild(renderer.domElement); } catch (_) {}
  }

  return { scene, camera, renderer, controls, composer, startAnimate, cleanup };
}
