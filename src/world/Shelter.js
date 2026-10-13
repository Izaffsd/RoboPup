import {
  Color,
  CubeUVReflectionMapping,
  DepthFormat,
  DepthTexture,
  DirectionalLight,
  HalfFloatType,
  HemisphereLight,
  LessEqualCompare,
  LinearSRGBColorSpace,
  NearestFilter,
  Object3D,
  PMREMGenerator,
  RGBAFormat,
  UnsignedIntType,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import { RENDER } from '../config/config.js';
import { buildArchitecture, FLOOR_COVERINGS } from './Architecture.js';
import { buildColliderSpecs } from './colliderSpecs.js';
import { LAMPS, PROPS, TOYS, TUNNELS, zoneAt } from './layout.js';
import { LightShafts } from './LightShafts.js';
import { MaterialLibrary } from './MaterialLibrary.js';
import { Outdoor } from './Outdoor.js';
import { parsePropLibrary, PropInstancer } from './PropInstancer.js';
import { Signage } from './Signage.js';
import { Toys } from './Toys.js';

const _snap = new Vector3();
/** Cube face size of the reflection probe (placeholder and baked probe must match). */
const PROBE_SIZE = 256;
const PROBE_POSITION = new Vector3(-2, 1.7, 3);
const TUNNEL_STRIPES = [
  [0x4a90e2, 0xffcf4a, 0xff6b6b, 0x4a90e2, 0xffcf4a],
  [0x8f6bd8, 0x6cc070, 0x8f6bd8],
];

/**
 * The indoor dog shelter: assembles architecture, instanced props, dynamic
 * toys, outdoor surroundings, signage, god rays, lighting and the baked
 * reflection probe, and registers every static collider with physics.
 *
 * Lighting strategy:
 *  - static surfaces: baked lightmap/AO (floors) + vertex AO (props) +
 *    hemisphere/IBL ambient + an unshadowed-by-statics key light;
 *  - real-time shadows only for dynamic objects (dog, toys): the key light's
 *    shadow camera follows the dog with a tight frustum and only dynamic
 *    meshes are shadow casters, so the shadow pass costs a few draw calls.
 */
export class Shelter {
  /**
   * @param {object} deps
   * @param {import('three').Scene} deps.scene
   * @param {import('../physics/PhysicsWorld.js').PhysicsWorld} deps.physics
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   * @param {import('three').WebGLRenderer} deps.renderer
   */
  constructor({ scene, physics, bus, renderer }) {
    this.scene = scene;
    this.physics = physics;
    this.bus = bus;
    this.renderer = renderer;
    this.lodScale = 1;
    this.envRT = null;
  }

  /**
   * Build the world. `step` yields to the browser between heavy stages.
   * @param {{textures: Record<string, import('three').Texture>, propScene: import('three').Object3D}} assets
   * @param {() => Promise<void>} step
   */
  async build({ textures, propScene }, step) {
    const scene = this.scene;
    this.materials = new MaterialLibrary(textures, this.renderer.capabilities.getMaxAnisotropy());

    this.architecture = await buildArchitecture(this.materials, step);
    scene.add(this.architecture);

    this.staticColliders = this.physics.addStaticSpecs(buildColliderSpecs());
    this.physics.prime();
    await step();

    const lib = parsePropLibrary(propScene);
    this.outdoor = new Outdoor(this.materials);
    scene.add(this.outdoor.group);

    // Floor coverings are baked into the architecture (lightmapped), not instanced.
    const placements = PROPS.filter((p) => !(p.type in FLOOR_COVERINGS));
    for (const lamp of LAMPS)
      placements.push({ type: 'pendantLamp', x: lamp.x, y: lamp.y, z: lamp.z, rotY: 0 });
    TUNNELS.forEach((t, ti) => {
      const c = Math.cos(t.rotY);
      const s = Math.sin(t.rotY);
      for (let k = 0; k < t.segments; k++) {
        const lz = k - (t.segments - 1) / 2;
        placements.push({
          type: 'tunnelSegment',
          x: t.x + lz * s,
          y: 0,
          z: t.z + lz * c,
          rotY: t.rotY,
          tintColor:
            TUNNEL_STRIPES[ti % TUNNEL_STRIPES.length][
              k % TUNNEL_STRIPES[ti % TUNNEL_STRIPES.length].length
            ],
        });
      }
    });
    placements.push(...this.outdoor.placements);
    this.props = new PropInstancer(lib, this.materials, placements, { name: 'Props' });
    scene.add(this.props.group);
    await step();

    this.toys = new Toys({
      physics: this.physics,
      lib,
      materials: this.materials,
      bus: this.bus,
      spawns: TOYS,
    });
    scene.add(this.toys.group);

    this.shafts = new LightShafts();
    scene.add(this.shafts.group);
    this.signage = new Signage(this.materials);
    scene.add(this.signage.group);
    await step();

    this._buildLights();
  }

  _buildLights() {
    const hemi = new HemisphereLight(
      RENDER.hemiSkyColor,
      RENDER.hemiGroundColor,
      RENDER.hemiIntensity,
    );
    hemi.position.set(0, 5, 0);
    this.scene.add(hemi);
    this.hemi = hemi;

    const key = new DirectionalLight(RENDER.keyLightColor, RENDER.keyLightIntensity);
    key.castShadow = true;
    const half = RENDER.shadowFrustumHalfSize;
    const cam = key.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 1;
    cam.far = 50;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.025;
    key.shadow.mapSize.set(1024, 1024);
    this.keyDir = new Vector3(...RENDER.keyLightDirection).normalize();
    // Light-space basis used to snap the shadow frustum to texels (no shimmer).
    this._lightRight = new Vector3().crossVectors(this.keyDir, new Vector3(0, 1, 0)).normalize();
    this._lightUp = new Vector3().crossVectors(this._lightRight, this.keyDir).normalize();
    const target = new Object3D();
    this.scene.add(target);
    key.target = target;
    this.scene.add(key);
    this.key = key;
  }

  /**
   * Install a placeholder environment so every material is compiled with the
   * image-based-lighting variant from the start. It is a CubeUV render target
   * of exactly the size PMREM produces for the probe (same CUBEUV defines), so
   * swapping in the baked probe later never triggers shader recompilation.
   * Filled with a uniform warm grey that approximates the shelter's average
   * radiance, so the swap is visually subtle.
   */
  installPlaceholderEnvironment() {
    const rt = new WebGLRenderTarget(3 * Math.max(PROBE_SIZE, 112), 4 * PROBE_SIZE, {
      type: HalfFloatType,
      format: RGBAFormat,
      colorSpace: LinearSRGBColorSpace,
      depthBuffer: false,
    });
    rt.texture.mapping = CubeUVReflectionMapping;
    rt.texture.name = 'PlaceholderEnvironment';
    const r = this.renderer;
    const previousTarget = r.getRenderTarget();
    const previousColor = r.getClearColor(new Color());
    const previousAlpha = r.getClearAlpha();
    r.setRenderTarget(rt);
    r.setClearColor(new Color(0.42, 0.38, 0.33), 1);
    r.clear(true, false, false);
    r.setRenderTarget(previousTarget);
    r.setClearColor(previousColor, previousAlpha);
    this._setEnvironment(rt);
  }

  /**
   * Render the finished interior into a cube map once and prefilter it into
   * the scene's environment (a baked reflection probe — glossy floors, toys
   * and the dog's clear-coat shell reflect the actual shelter).
   * @param {import('three').Object3D[]} hide Objects to hide during capture.
   */
  bakeReflectionProbe(hide) {
    const states = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    const pmrem = new PMREMGenerator(this.renderer);
    const probe = pmrem.fromScene(this.scene, 0, 0.1, 200, {
      size: PROBE_SIZE,
      position: PROBE_POSITION,
    });
    pmrem.dispose();
    for (let i = 0; i < hide.length; i++) hide[i].visible = states[i];
    this._setEnvironment(probe);
  }

  _setEnvironment(renderTarget) {
    const previous = this.envRT;
    this.envRT = renderTarget;
    this.scene.environment = renderTarget.texture;
    if (previous) previous.dispose();
  }

  /**
   * Firefox logs a warning when a depth-comparison texture uses LINEAR
   * filtering (three's hardware-PCF shadow map). There we provide the shadow
   * render target ourselves with NEAREST filtering; the 5-tap rotated PCF in
   * the shader still softens the edges. Other browsers keep three's default.
   */
  _prepareShadowMap() {
    if (!/firefox/i.test(navigator.userAgent)) return;
    const shadow = this.key.shadow;
    const size = shadow.mapSize.x;
    if (shadow.map && shadow.map.width === size) return;
    if (shadow.map) shadow.map.dispose();
    const target = new WebGLRenderTarget(size, size);
    const depth = new DepthTexture(size, size, UnsignedIntType);
    depth.format = DepthFormat;
    depth.compareFunction = LessEqualCompare;
    depth.minFilter = NearestFilter;
    depth.magFilter = NearestFilter;
    depth.name = 'KeyLight.shadowMap';
    target.depthTexture = depth;
    shadow.map = target;
  }

  /**
   * Apply graphics preset values that live in the world.
   * @param {object} preset
   */
  applyQuality(preset) {
    const shadow = this.key.shadow;
    if (shadow.mapSize.x !== preset.shadowMapSize) {
      shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
      if (shadow.map) {
        shadow.map.dispose();
        shadow.map = null;
      }
    }
    this._prepareShadowMap();
    shadow.radius = preset.shadowRadius;
    this.shafts.setDustCount(preset.dustCount);
    this.lodScale = preset.lodDistanceScale;
    this.materials.setEnvIntensity(preset.envIntensity);
    this._forceLod = true;
  }

  /**
   * @param {number} x
   * @param {number} z
   */
  zoneAt(x, z) {
    return zoneAt(x, z);
  }

  /**
   * Per-frame world update.
   * @param {object} f
   * @param {number} f.dt
   * @param {number} f.time
   * @param {number} f.alpha Physics interpolation factor.
   * @param {import('three').Camera} f.camera
   * @param {Vector3} f.focus Point the shadow frustum follows (the dog).
   * @param {number} f.pixelRatio
   */
  update({ dt, time, alpha, camera, focus, pixelRatio }) {
    this.toys.update(alpha, dt);
    this.props.updateLOD(camera.position, this.lodScale, dt, this._forceLod === true);
    this._forceLod = false;
    this.shafts.update(time, pixelRatio);
    this.outdoor.update(time);
    this.signage.update(dt);
    this._followShadow(focus);
  }

  _followShadow(focus) {
    const key = this.key;
    const texel = (RENDER.shadowFrustumHalfSize * 2) / key.shadow.mapSize.x;
    const r = Math.round(focus.dot(this._lightRight) / texel) * texel;
    const u = Math.round(focus.dot(this._lightUp) / texel) * texel;
    const f = focus.dot(this.keyDir);
    _snap
      .copy(this._lightRight)
      .multiplyScalar(r)
      .addScaledVector(this._lightUp, u)
      .addScaledVector(this.keyDir, f);
    key.target.position.copy(_snap);
    key.position.copy(_snap).addScaledVector(this.keyDir, -25);
    key.target.updateMatrixWorld();
  }

  /** Put toys back (new session). */
  reset() {
    this.toys.resetAll();
  }

  dispose() {
    this.toys.dispose();
    this.props.dispose();
    this.shafts.dispose();
    this.signage.dispose();
    this.outdoor.dispose();
    this.architecture.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
    if (this.envRT) this.envRT.dispose();
    this.key.shadow.dispose();
    this.materials.dispose();
  }
}
