import { AdditiveBlending, Color, DoubleSide, ShaderMaterial } from 'three';

/**
 * Cheap volumetric god-rays for sunlight entering through window panes.
 *
 * Each window's beam is represented by three crossed sheets placed inside
 * the beam volume. Every vertex carries `aShaft` = (u, v across the pane, w along
 * the beam from the window (0) to the floor (1)); the fragment shader turns
 * that into a soft falloff towards the beam edges and its far end, adds
 * slowly scrolling dust streaks and fades sheets that are seen edge-on or are
 * very close to the camera. Additive blending accumulates overlapping sheets,
 * which approximates in-scattering along the view ray at a tiny cost.
 */
export function createLightShaftMaterial() {
  return new ShaderMaterial({
    name: 'LightShaftMaterial',
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new Color(1.0, 0.86, 0.62) },
      uIntensity: { value: 0.06 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aShaft;
      varying vec3 vShaft;
      varying float vDepth;
      varying float vFacing;
      varying vec3 vWorld;
      void main() {
        vShaft = aShaft;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mv = viewMatrix * world;
        vDepth = -mv.z;
        vec3 n = normalize(normalMatrix * normal);
        vFacing = abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec3 vShaft;
      varying float vDepth;
      varying float vFacing;
      varying vec3 vWorld;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }

      void main() {
        float u = vShaft.x;
        float v = vShaft.y;
        float w = vShaft.z;
        float edge = smoothstep(0.0, 0.3, u) * smoothstep(1.0, 0.7, u)
                   * smoothstep(0.0, 0.3, v) * smoothstep(1.0, 0.7, v);
        float along = smoothstep(0.0, 0.08, w) * pow(1.0 - w, 0.8);
        float streaks = 0.6 + 0.4 * noise(vec2(u * 7.0 + v * 3.0 + uTime * 0.04, w * 2.5 - uTime * 0.025));
        streaks *= 0.8 + 0.2 * noise(vWorld.xz * 1.3 + uTime * 0.06);
        float facing = smoothstep(0.05, 0.5, vFacing);
        float nearFade = smoothstep(0.35, 2.0, vDepth);
        float a = edge * along * streaks * facing * nearFade * uIntensity;
        gl_FragColor = vec4(uColor * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
