import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

/**
 * GTAOPass tuned for the shelter:
 *  - reads the depth buffer written by the main RenderPass (normals are
 *    reconstructed from depth) instead of re-rendering the whole scene into
 *    its own G-buffer, which halves the draw calls of the AO presets;
 *  - computes AO at a configurable fraction of the screen resolution (the
 *    blend back onto the full-resolution image stays sharp).
 */
export class ShelterGTAOPass extends GTAOPass {
  /**
   * @param {import('three').Scene} scene
   * @param {import('three').Camera} camera
   * @param {number} width Full-resolution drawing-buffer width.
   * @param {number} height Full-resolution drawing-buffer height.
   * @param {number} resolutionScale
   * @param {import('three').DepthTexture} depthTexture Initial scene depth.
   */
  constructor(scene, camera, width, height, resolutionScale, depthTexture) {
    super(
      scene,
      camera,
      Math.max(1, Math.round(width * resolutionScale)),
      Math.max(1, Math.round(height * resolutionScale)),
    );
    this.resolutionScale = resolutionScale;
    this.setGBuffer(depthTexture);
  }

  /**
   * Point the AO and denoise shaders at this frame's scene depth (the
   * composer ping-pongs between two targets, each with its own depth).
   * @param {import('three').DepthTexture} depthTexture
   */
  useDepth(depthTexture) {
    if (this.depthTexture === depthTexture) return;
    this.depthTexture = depthTexture;
    this.gtaoMaterial.uniforms.tDepth.value = depthTexture;
    this.pdMaterial.uniforms.tDepth.value = depthTexture;
  }

  setSize(width, height) {
    super.setSize(
      Math.max(1, Math.round(width * this.resolutionScale)),
      Math.max(1, Math.round(height * this.resolutionScale)),
    );
  }
}
