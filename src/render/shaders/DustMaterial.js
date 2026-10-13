import { AdditiveBlending, Color, ShaderMaterial } from 'three';

/**
 * Sun-lit dust motes drifting inside the window light shafts. Each point has
 * a random seed; motion is a smooth, time-based wander evaluated entirely on
 * the GPU (no per-frame CPU work or buffer uploads).
 */
export function createDustMaterial() {
  return new ShaderMaterial({
    name: 'DustMaterial',
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: 20 },
      uPixelRatio: { value: 1 },
      uColor: { value: new Color(1.0, 0.9, 0.7) },
      uOpacity: { value: 0.55 },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      uniform float uSize;
      uniform float uPixelRatio;
      varying float vTwinkle;
      void main() {
        vec3 p = position;
        float t = uTime * (0.08 + aSeed * 0.05);
        p.x += sin(t * 1.3 + aSeed * 31.0) * 0.18;
        p.y += sin(t * 0.9 + aSeed * 17.0) * 0.12 + cos(t * 0.37 + aSeed * 7.0) * 0.08;
        p.z += cos(t * 1.1 + aSeed * 23.0) * 0.18;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * uPixelRatio * (0.4 + aSeed * 0.8) / max(0.5, -mv.z);
        vTwinkle = 0.55 + 0.45 * sin(uTime * (1.5 + aSeed * 2.0) + aSeed * 40.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vTwinkle;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c, c);
        if (d > 0.25) discard;
        float a = smoothstep(0.25, 0.0, d) * vTwinkle * uOpacity;
        gl_FragColor = vec4(uColor * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
