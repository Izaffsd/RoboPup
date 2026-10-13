import { Color, Vector3 } from 'three';

/**
 * Shared uniforms for the dog's material patch, updated once per frame.
 * - uSunDirView: direction towards the sun in view space.
 * - uSunBoost:   how much the dog currently stands in a baked sun patch
 *                (sampled with a ray towards the sun), so dynamic objects
 *                match the precomputed lighting of the floor beneath them.
 * - uRim:        stylised fresnel rim light strength.
 */
export const dogLightingUniforms = {
  uSunDirView: { value: new Vector3(0, 1, 0) },
  uSunColor: { value: new Color(1, 0.85, 0.62) },
  uSunBoost: { value: 0 },
  uRimColor: { value: new Color(0.55, 0.75, 1.0) },
  uRim: { value: 0.35 },
};

/**
 * Inject sunlight + rim lighting into a MeshStandard/MeshPhysical material.
 * Lighting is added to the emissive term after the standard PBR lighting, so
 * it costs a handful of ALU instructions and no extra light in the scene.
 * @param {import('three').MeshStandardMaterial} material
 */
export function patchDogMaterial(material) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, dogLightingUniforms);
    shader.fragmentShader =
      /* glsl */ `
      uniform vec3 uSunDirView;
      uniform vec3 uSunColor;
      uniform float uSunBoost;
      uniform vec3 uRimColor;
      uniform float uRim;
      ` +
      shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        {
          vec3 nView = normalize(normal);
          vec3 toEye = normalize(vViewPosition);
          float rim = pow(1.0 - clamp(dot(nView, toEye), 0.0, 1.0), 3.0);
          totalEmissiveRadiance += uRimColor * rim * uRim * (0.35 + 0.65 * diffuseColor.rgb);
          float sunNdl = max(dot(nView, uSunDirView), 0.0);
          totalEmissiveRadiance += diffuseColor.rgb * uSunColor * sunNdl * uSunBoost;
        }`,
      );
  };
  material.customProgramCacheKey = () => 'dog-sun-rim-v1';
  return material;
}
