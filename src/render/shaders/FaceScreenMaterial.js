import { Color, ShaderMaterial, Vector2 } from 'three';

/**
 * The robo-pup's LED visor: signed-distance-field eyes, mouth and glyphs
 * drawn on a curved screen (no textures). Expressions are weights that
 * morph the eye and mouth shapes into each other:
 *
 *   neutral  rounded-rectangle eyes, small smile
 *   happy    ^ ^ arcs, wide smile
 *   curious  one big round eye, one narrowed eye under a raised brow, "o" mouth
 *   sleepy   drooping half-lidded eyes, flat mouth, floating "z" glyphs
 *   excited  pulsing star eyes, open "D" grin, warm tint
 *   lowBat   dim flickering slit eyes, wavy mouth, blinking battery icon, amber tint
 *
 * plus blink, squint (hard landings), look direction and an open mouth for
 * barks. Values are driven by FaceController. Supports skinning (the visor
 * is part of the dog's SkinnedMesh) and the dithered close-camera fade.
 */
export function createFaceScreenMaterial() {
  return new ShaderMaterial({
    name: 'FaceScreenMaterial',
    uniforms: {
      uTime: { value: 0 },
      uBlink: { value: 0 },
      uSquint: { value: 0 },
      uMouth: { value: 0 },
      uLook: { value: new Vector2() },
      uHappy: { value: 0 },
      uCurious: { value: 0 },
      uSleepy: { value: 0 },
      uExcited: { value: 0 },
      uLowBat: { value: 0 },
      uEyeColor: { value: new Color(0.35, 2.4, 2.2) },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <skinning_pars_vertex>
      varying vec2 vUv;
      void main() {
        vUv = uv;
        #include <skinbase_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        #include <project_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uBlink;
      uniform float uSquint;
      uniform float uMouth;
      uniform vec2 uLook;
      uniform float uHappy;
      uniform float uCurious;
      uniform float uSleepy;
      uniform float uExcited;
      uniform float uLowBat;
      uniform vec3 uEyeColor;
      uniform float uOpacity;
      varying vec2 vUv;

      float sdRoundRect(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - b + r;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }

      float sdSegment(vec2 p, vec2 a, vec2 b) {
        vec2 pa = p - a;
        vec2 ba = b - a;
        float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        return length(pa - ba * h);
      }

      // Five-pointed star (Inigo Quilez).
      float sdStar5(vec2 p, float r, float rf) {
        const vec2 k1 = vec2(0.809016994375, -0.587785252292);
        const vec2 k2 = vec2(-k1.x, k1.y);
        p.x = abs(p.x);
        p -= 2.0 * max(dot(k1, p), 0.0) * k1;
        p -= 2.0 * max(dot(k2, p), 0.0) * k2;
        p.x = abs(p.x);
        p.y -= r;
        vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
        float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
        return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
      }

      float sdZ(vec2 p, float s) {
        float d = sdSegment(p, vec2(-s, s), vec2(s, s));
        d = min(d, sdSegment(p, vec2(s, s), vec2(-s, -s)));
        return min(d, sdSegment(p, vec2(-s, -s), vec2(s, -s)));
      }

      float eye(vec2 p, vec2 c, float side, float open) {
        vec2 q = p - c;
        // Neutral: rounded rectangle.
        vec2 size = vec2(0.12, 0.17 * open + 0.012);
        float dN = sdRoundRect(q, size, min(size.x, size.y) * 0.95);
        // Happy "^" arc.
        vec2 a = q - vec2(0.0, -0.07);
        float dH = max(abs(length(a) - 0.12) - 0.032, -a.y + 0.01);
        // Curious: left eye big and round, right eye narrowed under a raised brow.
        float dC;
        if (side < 0.0) {
          dC = length(q * vec2(1.0, 1.0 / max(open, 0.08))) - 0.15;
        } else {
          vec2 sz = vec2(0.11, 0.075 * open + 0.012);
          dC = sdRoundRect(q + vec2(0.0, 0.03), sz, min(sz.x, sz.y) * 0.9);
          dC = min(dC, sdSegment(q, vec2(-0.12, 0.17), vec2(0.11, 0.23)) - 0.022);
        }
        // Sleepy: half-lidded, the lid slanting down towards the outside.
        vec2 ls = vec2(0.12, 0.1 * open + 0.012);
        float dS = sdRoundRect(q + vec2(0.0, 0.05), ls, min(ls.x, ls.y) * 0.95);
        dS = max(dS, q.y + 0.01 + q.x * side * 0.35);
        // Excited: pulsing star.
        float pulse = 1.0 + 0.08 * sin(uTime * 11.0);
        float dE = sdStar5(q / pulse, 0.16, 0.48) * pulse;
        // Low battery: dim slit.
        float dL = sdRoundRect(q + vec2(0.0, 0.04), vec2(0.11, 0.03 * open + 0.008), 0.02);

        float wN = max(0.0, 1.0 - uHappy - uCurious - uSleepy - uExcited - uLowBat);
        float total = wN + uHappy + uCurious + uSleepy + uExcited + uLowBat;
        float d = (dN * wN + dH * uHappy + dC * uCurious + dS * uSleepy + dE * uExcited + dL * uLowBat) / total;
        // Squint ">" "<" chevrons after a hard landing.
        vec2 s = vec2(q.x * side, q.y);
        float chev = max(abs(abs(s.y) * 1.2 + s.x * 0.9) - 0.03, abs(s.y) - 0.1);
        return mix(d, chev, uSquint * (1.0 - uHappy));
      }

      float mouth(vec2 p) {
        vec2 m = p - vec2(0.0, -0.27);
        float smile = max(abs(length(m - vec2(0.0, 0.07)) - 0.08) - 0.016, m.y - 0.02);
        float wide = max(abs(length(m - vec2(0.0, 0.1)) - 0.13) - 0.02, m.y - 0.0);
        float oh = abs(length(m * vec2(1.0, 1.2)) - 0.045) - 0.016;
        float flat_ = sdSegment(m, vec2(-0.06, 0.0), vec2(0.06, 0.0)) - 0.015;
        // "D" grin: lower half-disc.
        float grin = max(length(m - vec2(0.0, 0.03)) - 0.11, m.y - 0.03);
        float wave = abs(m.y - 0.018 * sin(m.x * 60.0)) - 0.013;
        wave = max(wave, abs(m.x) - 0.1);

        float wN = max(0.0, 1.0 - uHappy - uCurious - uSleepy - uExcited - uLowBat);
        float total = wN + uHappy + uCurious + uSleepy + uExcited + uLowBat;
        float d = (smile * wN + wide * uHappy + oh * uCurious + flat_ * uSleepy + grin * uExcited + wave * uLowBat) / total;
        // Bark: open round mouth.
        float open = length(m * vec2(1.0, 1.4)) - 0.085 * uMouth;
        return mix(d, open, smoothstep(0.05, 0.4, uMouth));
      }

      void main() {
        if (uOpacity < 0.999) {
          float h = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          if (h > uOpacity) discard;
        }
        vec2 p = (vUv - 0.5) * vec2(1.85, 1.0);
        vec2 look = uLook * vec2(0.09, 0.05);
        float open = clamp(1.0 - uBlink, 0.06, 1.0) * (1.0 - uSquint * 0.6);
        float dl = eye(p, vec2(-0.4, 0.07) + look, -1.0, open);
        float dr = eye(p, vec2(0.4, 0.07) + look, 1.0, open);
        float d = min(dl, dr);
        float dm = mouth(p);

        vec3 bg = mix(vec3(0.015, 0.03, 0.06), vec3(0.03, 0.06, 0.1), vUv.y);
        bg *= 0.85 + 0.15 * sin(vUv.y * 160.0 + uTime * 3.0);
        float vign = smoothstep(0.75, 0.3, length((vUv - 0.5) * vec2(1.3, 1.6)));
        bg *= 0.6 + 0.4 * vign;

        // Expression tint and low-battery flicker.
        vec3 eyeCol = uEyeColor;
        eyeCol = mix(eyeCol, vec3(2.6, 1.9, 0.45), uExcited * 0.65);
        eyeCol = mix(eyeCol, uEyeColor * vec3(0.7, 0.55, 0.85), uSleepy * 0.5);
        eyeCol = mix(eyeCol, vec3(2.6, 0.75, 0.2), uLowBat);
        float flicker = 1.0 - uLowBat * (0.35 + 0.25 * step(0.82, fract(uTime * 1.7)));
        eyeCol *= flicker;

        float fill = smoothstep(0.008, -0.008, d);
        float glow = exp(-max(d, 0.0) * 30.0) * 0.35;
        float expressive = max(max(uHappy, uExcited), smoothstep(0.05, 0.3, uMouth));
        float mFill = smoothstep(0.008, -0.008, dm) * (0.35 + 0.65 * max(expressive, uCurious * 0.8));
        // Specular highlight in each open eye.
        vec2 hl = p - (vec2(0.4 * sign(p.x), 0.07) + look + vec2(-0.04, 0.07));
        float plain = 1.0 - min(1.0, uHappy + uSleepy + uExcited + uLowBat);
        float spark = smoothstep(0.03, 0.0, length(hl)) * plain * (1.0 - uBlink);

        // Floating "z z z" while sleepy.
        float zz = 1e3;
        for (int i = 0; i < 3; i++) {
          float fi = float(i);
          float t = fract(uTime * 0.35 + fi / 3.0);
          vec2 c = vec2(0.62 + 0.1 * fi + 0.03 * sin(uTime * 2.0 + fi), 0.12 + t * 0.3);
          zz = min(zz, sdZ(p - c, 0.025 + 0.012 * fi) - 0.007 + (1.0 - sin(t * 3.14159)) * 0.02);
        }
        float zFill = smoothstep(0.006, -0.006, zz) * smoothstep(0.4, 0.8, uSleepy);

        // Battery icon with a blinking last bar.
        vec2 bp = p - vec2(0.0, 0.34);
        float shell = abs(sdRoundRect(bp, vec2(0.085, 0.045), 0.012)) - 0.009;
        float nub = sdRoundRect(bp - vec2(0.1, 0.0), vec2(0.012, 0.02), 0.004);
        float bar = sdRoundRect(bp + vec2(0.055, 0.0), vec2(0.018, 0.026), 0.004);
        float on = step(0.5, fract(uTime * 1.6));
        float battery = smoothstep(0.006, -0.006, min(shell, nub)) * uLowBat;
        float batteryBar = smoothstep(0.006, -0.006, bar) * uLowBat * on;

        vec3 col = bg + eyeCol * (fill + glow + mFill * 0.8) + vec3(1.2) * spark * fill;
        col += uEyeColor * 0.8 * zFill;
        col += vec3(2.2, 2.0, 1.8) * battery * 0.6 + vec3(2.8, 0.25, 0.15) * batteryBar;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
