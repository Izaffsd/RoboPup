import { DepthTexture, HalfFloatType, UnsignedIntType, Vector2, WebGLRenderTarget } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { DofPass, GradePass } from './PhotoPasses.js';
import { ShelterGTAOPass } from './ShelterGTAOPass.js';

/** UnrealBloom evaluated at a fraction of the screen resolution. */
class ScaledBloomPass extends UnrealBloomPass {
  constructor(scale, resolution, strength, radius, threshold) {
    super(resolution, strength, radius, threshold);
    this.resolutionScale = scale;
  }

  setSize(width, height) {
    super.setSize(
      Math.max(1, Math.round(width * this.resolutionScale)),
      Math.max(1, Math.round(height * this.resolutionScale)),
    );
  }
}

/**
 * Post-processing pipeline built with EffectComposer:
 *
 *   RenderPass (HDR, half-float) → GTAO → [photo DOF] → UnrealBloom (subtle)
 *     → OutputPass (ACES Filmic tone mapping + sRGB) → [photo grade] → SMAA
 *
 * The photo-mode passes stay disabled (zero cost) outside photo mode. On the
 * Low preset there is no chain at all, except while photo mode is open.
 *
 * The chain is rebuilt from scratch on preset changes and every pass and
 * render target of the previous chain is disposed, so switching presets
 * never leaks GPU memory. With post-processing disabled (Low preset) the
 * scene renders straight to the canvas and the renderer applies tone mapping.
 */
export class PostFX {
  /**
   * @param {import('./Renderer.js').Renderer} renderer
   * @param {import('three').Scene} scene
   * @param {import('three').PerspectiveCamera} camera
   */
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.composer = null;
    this.passes = [];
    this.gtao = null;
    this.dof = null;
    this.grade = null;
    this.preset = null;
    this.photo = false;
    this.photoParams = { dof: false, focus: 3, fStop: 2.8, filter: 'none', strength: 1 };
  }

  /**
   * Rebuild the pipeline for a quality preset.
   * @param {object} preset Entry of QUALITY_PRESETS.
   */
  configure(preset) {
    this.disposeChain();
    this.preset = preset;
    if (!preset.postProcessing && !this.photo) return;

    const r = this.renderer.three;
    const w = this.renderer.width;
    const h = this.renderer.height;
    const pr = this.renderer.pixelRatio;
    const bw = Math.round(w * pr);
    const bh = Math.round(h * pr);
    // Both ping-pong targets carry a depth texture so GTAO can reuse scene depth.
    const depthTexture = new DepthTexture(bw, bh, UnsignedIntType);
    const target = new WebGLRenderTarget(bw, bh, { type: HalfFloatType, depthTexture });
    const composer = new EffectComposer(r, target);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);

    const add = (pass) => {
      composer.addPass(pass);
      this.passes.push(pass);
      return pass;
    };

    add(new RenderPass(this.scene, this.camera));

    if (preset.ao) {
      const ao = preset.ao;
      const gtao = add(
        new ShelterGTAOPass(this.scene, this.camera, bw, bh, ao.resolutionScale, depthTexture),
      );
      this.gtao = gtao;
      gtao.blendIntensity = ao.blend;
      gtao.updateGtaoMaterial({
        radius: ao.radius,
        distanceExponent: ao.distanceExponent,
        thickness: ao.thickness,
        scale: ao.scale,
        samples: ao.samples,
        distanceFallOff: 1,
        screenSpaceRadius: false,
      });
      gtao.updatePdMaterial({
        lumaPhi: 10,
        depthPhi: 2,
        normalPhi: 3,
        radius: 6,
        rings: 2,
        samples: 12,
      });
    }

    this.dof = add(new DofPass(this.camera));

    if (preset.bloom) {
      const b = preset.bloom;
      add(
        new ScaledBloomPass(
          b.resolutionScale,
          new Vector2(w * pr, h * pr),
          b.strength,
          b.radius,
          b.threshold,
        ),
      );
    }

    add(new OutputPass());
    this.grade = add(new GradePass());
    if (preset.smaa) add(new SMAAPass());

    composer.setSize(w, h);
    this.composer = composer;
    this._applyPhoto();
  }

  /**
   * Turn photo mode on or off. On the Low preset this builds (or removes) a
   * minimal chain so depth of field and filters work there too.
   * @param {boolean} active
   */
  setPhotoMode(active) {
    if (this.photo === active) return;
    this.photo = active;
    if (this.preset && !this.preset.postProcessing) this.configure(this.preset);
    this._applyPhoto();
  }

  /**
   * @param {Partial<{dof: boolean, focus: number, fStop: number, filter: string, strength: number}>} params
   */
  setPhotoParams(params) {
    Object.assign(this.photoParams, params);
    this._applyPhoto();
  }

  _applyPhoto() {
    const p = this.photoParams;
    if (this.dof) {
      this.dof.enabled = this.photo && p.dof;
      this.dof.setLens(p.focus, p.fStop);
    }
    if (this.grade) {
      this.grade.enabled = this.photo && p.filter !== 'none';
      this.grade.setFilter(p.filter, p.strength);
    }
  }

  /** Every pass of the active chain, including the composer's internal copy pass. */
  get allPasses() {
    return this.composer ? [...this.passes, this.composer.copyPass] : [];
  }

  /** Resize after the renderer changed size or pixel ratio. */
  setSize() {
    if (!this.composer) return;
    this.composer.setPixelRatio(this.renderer.pixelRatio);
    this.composer.setSize(this.renderer.width, this.renderer.height);
  }

  /**
   * Render one frame.
   * @param {number} dt
   */
  render(dt) {
    if (!this.composer) {
      this.renderer.three.render(this.scene, this.camera);
      return;
    }
    // RenderPass draws into the current read buffer; GTAO samples its depth.
    const depth = this.composer.readBuffer.depthTexture;
    if (this.gtao) this.gtao.useDepth(depth);
    if (this.dof) this.dof.depthTexture = depth;
    this.composer.render(dt);
  }

  /** Dispose the current chain (passes, composer targets). */
  disposeChain() {
    for (const pass of this.passes) pass.dispose();
    this.passes.length = 0;
    this.gtao = null;
    this.dof = null;
    this.grade = null;
    if (this.composer) {
      // Disposes both ping-pong render targets (and their depth textures)
      // plus the internal copy pass.
      this.composer.renderTarget1.depthTexture?.dispose();
      this.composer.renderTarget2.depthTexture?.dispose();
      this.composer.dispose();
      this.composer = null;
    }
  }

  dispose() {
    this.disposeChain();
  }
}
