import {
  HalfFloatType,
  NoBlending,
  ShaderMaterial,
  UniformsUtils,
  Vector2,
  WebGLRenderTarget,
} from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';
import { PHOTO } from '../config/config.js';

const FULLSCREEN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Depth of field for photo mode: a single-pass "scatter-as-gather" bokeh
 * (golden-angle spiral, after Dennis Gustafsson) on the HDR scene colour, so
 * bright highlights bloom into round bokeh. The circle of confusion follows
 * a thin-lens style curve, |1/focus − 1/depth| · aperture, using the scene
 * depth the RenderPass already wrote (no extra scene render).
 *
 * The blur is written to a private target and copied back, so the pass never
 * samples a depth texture attached to the framebuffer it draws into.
 */
export class DofPass extends Pass {
  /** @param {import('three').PerspectiveCamera} camera */
  constructor(camera) {
    super();
    this.camera = camera;
    this.needsSwap = false;
    this.enabled = false;
    /** Scene depth of the current frame (set by PostFX before rendering). */
    this.depthTexture = null;
    this.material = new ShaderMaterial({
      name: 'PhotoDofMaterial',
      defines: { MAX_SAMPLES: 160, RAD_SCALE: '1.6' },
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uResolution: { value: new Vector2(1, 1) },
        uFocus: { value: 2 },
        uAperture: { value: 1 },
        uMaxBlur: { value: PHOTO.maxBlur },
        cameraNear: { value: 0.05 },
        cameraFar: { value: 200 },
      },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tColor;
        uniform sampler2D tDepth;
        uniform vec2 uResolution;
        uniform float uFocus;
        uniform float uAperture;
        uniform float uMaxBlur;
        uniform float cameraNear;
        uniform float cameraFar;
        varying vec2 vUv;
        const float GOLDEN_ANGLE = 2.39996323;

        float viewDepth(vec2 uv) {
          float d = texture2D(tDepth, uv).x;
          return -perspectiveDepthToViewZ(d, cameraNear, cameraFar);
        }

        float blurSize(float depth) {
          float coc = clamp((1.0 / uFocus - 1.0 / depth) * uAperture, -1.0, 1.0);
          return abs(coc) * uMaxBlur;
        }

        void main() {
          vec2 texel = 1.0 / uResolution;
          float centerDepth = viewDepth(vUv);
          float centerSize = blurSize(centerDepth);
          vec3 color = texture2D(tColor, vUv).rgb;
          float tot = 1.0;
          float radius = RAD_SCALE;
          float ang = 0.0;
          for (int i = 0; i < MAX_SAMPLES; i++) {
            if (radius >= uMaxBlur) break;
            ang += GOLDEN_ANGLE;
            vec2 tc = vUv + vec2(cos(ang), sin(ang)) * texel * radius;
            vec3 sampleColor = texture2D(tColor, tc).rgb;
            float sampleDepth = viewDepth(tc);
            float sampleSize = blurSize(sampleDepth);
            // Sharp foreground must not smear over a blurred background.
            if (sampleDepth > centerDepth) sampleSize = clamp(sampleSize, 0.0, centerSize * 2.0);
            float m = smoothstep(radius - 0.5, radius + 0.5, sampleSize);
            color += mix(color / tot, sampleColor, m);
            tot += 1.0;
            radius += RAD_SCALE / radius;
          }
          gl_FragColor = vec4(color / tot, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.copyMaterial = new ShaderMaterial({
      name: 'PhotoDofCopy',
      uniforms: UniformsUtils.clone(CopyShader.uniforms),
      vertexShader: CopyShader.vertexShader,
      fragmentShader: CopyShader.fragmentShader,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
    this.target.texture.name = 'PhotoDof.target';
    this.quad = new FullScreenQuad(null);
  }

  /**
   * @param {number} focus Focus distance (m).
   * @param {number} fStop Aperture f-number (smaller = blurrier).
   */
  setLens(focus, fStop) {
    const u = this.material.uniforms;
    u.uFocus.value = focus;
    u.uAperture.value = PHOTO.apertureScale / fStop;
  }

  setSize(width, height) {
    this.target.setSize(width, height);
    this.material.uniforms.uResolution.value.set(width, height);
    // Bokeh size is defined at 1080p and scales with the render height.
    this.material.uniforms.uMaxBlur.value = Math.max(4, (PHOTO.maxBlur * height) / 1080);
  }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.material.uniforms;
    u.tColor.value = readBuffer.texture;
    u.tDepth.value = this.depthTexture;
    u.cameraNear.value = this.camera.near;
    u.cameraFar.value = this.camera.far;
    this.quad.material = this.material;
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);

    this.copyMaterial.uniforms.tDiffuse.value = this.target.texture;
    this.quad.material = this.copyMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.copyMaterial.dispose();
    this.target.dispose();
    this.quad.dispose();
  }
}

/** Filter ids in shader order. */
const FILTER_INDEX = Object.freeze(Object.fromEntries(PHOTO.filters.map((f, i) => [f.id, i])));

/**
 * Photo-mode colour grading on the display-referred image (after tone
 * mapping): Warm, Cool, Noir, Vintage and Vivid looks with vignette and fine
 * film grain, blended by a strength value.
 */
export class GradePass extends Pass {
  constructor() {
    super();
    this.enabled = false;
    this.material = new ShaderMaterial({
      name: 'PhotoGradeMaterial',
      uniforms: {
        tDiffuse: { value: null },
        uFilter: { value: 0 },
        uStrength: { value: 1 },
        uResolution: { value: new Vector2(1, 1) },
      },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform int uFilter;
        uniform float uStrength;
        uniform vec2 uResolution;
        varying vec2 vUv;
        const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

        vec3 saturate3(vec3 c, float s) {
          return mix(vec3(dot(c, LUMA)), c, s);
        }

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          vec3 g = c;
          float vig = 0.0;
          float grain = 0.0;
          if (uFilter == 1) {
            g = saturate3(c * vec3(1.08, 1.0, 0.86) + vec3(0.02, 0.01, 0.0), 1.08);
            vig = 0.2;
          } else if (uFilter == 2) {
            g = saturate3(c * vec3(0.9, 1.0, 1.1) + vec3(0.0, 0.01, 0.035), 0.92);
            vig = 0.18;
          } else if (uFilter == 3) {
            float l = smoothstep(0.04, 0.96, dot(c, LUMA));
            g = vec3(pow(l, 1.12));
            vig = 0.5;
            grain = 0.06;
          } else if (uFilter == 4) {
            float l = dot(c, LUMA);
            vec3 sepia = vec3(l) * vec3(1.08, 0.94, 0.76);
            g = mix(c, sepia, 0.6) * 0.86 + vec3(0.08, 0.06, 0.035);
            vig = 0.4;
            grain = 0.04;
          } else if (uFilter == 5) {
            g = saturate3(c, 1.38);
            g = (g - 0.5) * 1.1 + 0.5;
            vig = 0.12;
          }
          float d = length((vUv - 0.5) * vec2(1.0, 0.82));
          g *= 1.0 - vig * smoothstep(0.32, 0.85, d);
          g += (hash(vUv * uResolution) - 0.5) * grain;
          gl_FragColor = vec4(clamp(mix(c, g, uStrength), 0.0, 1.0), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  /** @param {string} id Filter id from PHOTO.filters. */
  setFilter(id, strength = 1) {
    this.material.uniforms.uFilter.value = FILTER_INDEX[id] ?? 0;
    this.material.uniforms.uStrength.value = strength;
  }

  setSize(width, height) {
    this.material.uniforms.uResolution.value.set(width, height);
  }

  render(renderer, writeBuffer, readBuffer) {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}
