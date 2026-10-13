# Credits & licenses

RoboPup: Shelter Day contains **no third-party art, models, textures or audio**.
Every asset is generated procedurally by code in this repository and is
released under **CC0 1.0** (public domain dedication) together with the project.

## Original assets (CC0 1.0)

| Asset                                                                                                                                                   | Where it comes from                                                          | License |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------- |
| Robot dog "Bolt" (mesh, rig, materials)                                                                                                                 | `src/player/robotDogGeometry.js` → `public/assets/models/robodog.glb`        | CC0 1.0 |
| All furniture, play equipment, plants, trees, toys                                                                                                      | `src/world/props/*.js` → `public/assets/models/props.glb`                    | CC0 1.0 |
| Architecture (walls, floors, windows, murals, bunting, signage boards)                                                                                  | `src/world/Architecture.js`, `src/world/Signage.js` (built at runtime)       | CC0 1.0 |
| Floor / fabric / wood / plaster textures                                                                                                                | `scripts/assetgen/textures.mjs` → `public/assets/textures/*.ktx2`            | CC0 1.0 |
| Baked lightmap & ambient occlusion                                                                                                                      | `scripts/assetgen/lightmapBake.mjs` → `public/assets/textures/bake_*.ktx2`   | CC0 1.0 |
| Sky, god rays, dust, LED face (six SDF expressions) shaders                                                                                             | `src/render/shaders/*.js`                                                    | CC0 1.0 |
| Photo-mode depth of field and colour-grading filters (Warm, Cool, Noir, Vintage, Vivid)                                                                 | `src/render/PhotoPasses.js`                                                  | CC0 1.0 |
| Emote poses (Sit, Beg, Tail Wag, Zoomies, Roll Over, Play Bow, Sleep)                                                                                   | `src/player/emotePoses.js` (procedural, no animation clips)                  | CC0 1.0 |
| Photo watermark (paw badge + wordmark) and UI icons (emote, camera)                                                                                     | Drawn with canvas / inline SVG in `src/camera/PhotoMode.js`, `src/ui/dom.js` | CC0 1.0 |
| All sound effects and ambience (footsteps, bark, jump, landing, toy squeaks/bonks, ventilation hum, room tone, water dispenser, distant dogs, UI blips) | Synthesised at load time by `src/audio/SoundSynth.js`                        | CC0 1.0 |
| Emote voice chirps (happy, excited, sleepy), robot snore, camera shutter                                                                                | Synthesised at load time by `src/audio/SoundSynth.js`                        | CC0 1.0 |
| Sign text, posters, kennel name plaques, clock face                                                                                                     | Drawn at runtime by `src/world/Signage.js` using the visitor's system fonts  | CC0 1.0 |

No web fonts are downloaded; the UI uses the operating system's font stack.

Techniques adapted from published work (credited here):

- The photo-mode depth of field is adapted from Dennis Gustafsson's "Bokeh
  depth of field in a single pass" (golden-angle gather with a
  circle-of-confusion test), blog.voxagon.se, 2018.
- The LED face's star eyes use Inigo Quilez's 2D star signed-distance
  function (iquilezles.org, MIT License).

## Third-party software shipped in the game

| Library                                                                                                                                                                                                 | Version | Used for                                     | License    | Source                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------- | ---------- | ------------------------------------------------------------------------------ |
| three.js (core + addons: GLTFLoader, KTX2Loader, EffectComposer, Pass/FullScreenQuad, RenderPass, GTAOPass, UnrealBloomPass, OutputPass, SMAAPass, CopyShader, RoundedBoxGeometry, BufferGeometryUtils) | 0.186.1 | Rendering                                    | MIT        | https://github.com/mrdoob/three.js                                             |
| meshoptimizer decoder (bundled with three.js)                                                                                                                                                           | 1.1     | Decoding `EXT_meshopt_compression` geometry  | MIT        | https://github.com/zeux/meshoptimizer                                          |
| Basis Universal transcoder (bundled with three.js)                                                                                                                                                      | —       | Transcoding KTX2 / Basis textures            | Apache-2.0 | https://github.com/BinomialLLC/basis_universal                                 |
| zstddec, ktx-parse (bundled with three.js)                                                                                                                                                              | —       | KTX2 supercompression / container parsing    | MIT        | https://github.com/donmccurdy/zstddec, https://github.com/donmccurdy/KTX-Parse |
| Rapier (`@dimforge/rapier3d-compat`)                                                                                                                                                                    | 0.21.0  | Physics, character controller, scene queries | Apache-2.0 | https://github.com/dimforge/rapier.js                                          |

## Build & test tooling (not shipped)

| Tool                                                | Version     | License                   | Source                                  |
| --------------------------------------------------- | ----------- | ------------------------- | --------------------------------------- |
| Vite (+ Rolldown)                                   | 8.3.4       | MIT                       | https://vitejs.dev                      |
| glTF Transform                                      | 4.5.1       | MIT                       | https://gltf-transform.dev              |
| meshoptimizer (encoder)                             | 1.3.0       | MIT                       | https://github.com/zeux/meshoptimizer   |
| ktx2-encoder (wraps the Basis Universal encoder)    | 0.6.0       | MIT (encoder: Apache-2.0) | https://github.com/gz65555/ktx2-encoder |
| ESLint, @eslint/js, globals, eslint-config-prettier | 10.x / 17.x | MIT                       | https://eslint.org                      |
| Prettier                                            | 3.9.10      | MIT                       | https://prettier.io                     |
| Playwright (playwright-core)                        | 1.64.0      | Apache-2.0                | https://playwright.dev                  |

Apache-2.0 and MIT license texts are included in the respective packages under
`node_modules/` and in the upstream repositories linked above.
