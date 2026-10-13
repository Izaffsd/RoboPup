import { BackSide, Color, ShaderMaterial, Vector3 } from 'three';

/**
 * Stylised daytime sky seen through the windows: warm horizon to blue zenith,
 * a soft HDR sun glow (feeds the bloom) and slowly drifting procedural
 * clouds. Rendered on a large back-faced sphere around the shelter.
 */
export function createSkyMaterial(sunDirection) {
  return new ShaderMaterial({
    name: 'SkyMaterial',
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: new Vector3().copy(sunDirection).negate().normalize() },
      uZenith: { value: new Color(0x5aa8f0) },
      uHorizon: { value: new Color(0xfdebc8) },
      uGround: { value: new Color(0x9cc77a) },
      uIntensity: { value: 1.35 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uGround;
      uniform float uIntensity;
      varying vec3 vDir;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0; float a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
        return v;
      }

      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 sky = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
        // Clouds on a virtual plane above the building.
        if (h > 0.02) {
          vec2 uv = d.xz / (h + 0.08) * 0.9 + vec2(uTime * 0.006, uTime * 0.002);
          float c = fbm(uv * 1.6);
          float cover = smoothstep(0.52, 0.78, c) * smoothstep(0.02, 0.25, h);
          vec3 cloud = mix(vec3(1.0), vec3(0.86, 0.9, 0.98), smoothstep(0.6, 0.95, c));
          sky = mix(sky, cloud, cover * 0.85);
        }
        float sunAmt = max(dot(d, uSunDir), 0.0);
        sky += vec3(1.0, 0.85, 0.6) * (pow(sunAmt, 48.0) * 1.6 + pow(sunAmt, 6.0) * 0.18);
        // Below the horizon blend into distant grass so gaps never look empty.
        sky = mix(uGround * 0.9, sky, smoothstep(-0.04, 0.02, h));
        gl_FragColor = vec4(sky * uIntensity, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
