# RoboPup — technical notes

A short write-up of the decisions behind the physics, camera, locomotion,
rendering, asset pipeline and loading strategy, the Phase A systems (emotes,
LED face, photo mode, saves, performance overlay), plus an explicit list of
deviations from the original brief and known limitations.

---

## 1. Physics and the character controller

**Engine.** Rapier (`@dimforge/rapier3d-compat` 0.21) runs in a fixed 60 Hz
step that is decoupled from rendering (`src/core/Loop.js`, "fix your
timestep"): the accumulator runs 0–5 steps per frame and the leftover
fraction (`alpha`) is used to interpolate everything that moves. The dog's
capsule and every awake toy keep a previous and current transform, so motion
is smooth at 30, 60, 120 or 144 Hz and never jitters.

**Kinematic character.** The dog is a kinematic capsule (radius 0.32 m)
driven by Rapier's `KinematicCharacterController` (`src/physics/CharacterController.js`):

- collide-and-slide with a 1.5 cm skin offset;
- slopes: climbs up to 46°, slides above 52° (ramps are 8°–33°);
- auto-step up to 0.26 m (decks, stairs, foam blocks, cushions);
- snap-to-ground (0.28 m), so walking down ramps and steps never "floats";
- a small constant downward velocity while grounded keeps ground detection
  stable, so standing still produces zero vertical jitter (verified: the
  root height stays constant to 0.1 mm while idle).

The capsule is vertical so that turning can never wedge it into geometry, but
the head sticks out in front of it. A **head probe** (a 12 cm sphere swept
forward at snout height) limits forward motion and gently backs the dog
off, so the snout never enters walls.

**Gameplay layer.** `src/player/DogController.js` turns input into velocity:
camera-relative movement, acceleration/deceleration curves, reduced air
control, real gravity (9.81 m/s²) with a 1.3× fall multiplier, variable jump
height, **coyote time (100 ms)** and **jump buffering (120 ms)**. All of these
values live in `src/config/config.js`.

**Toys.** Twenty dynamic bodies (balls, plushies, squeaky cubes, a torus built
from a compound of spheres, a duck with ballast for self-righting). The
character pushes toys with an explicit impulse in its direction of travel
(scaled by speed and toy mass, clamped), which feels better than the
controller's generic impulses. Contact-force events trigger positional
squeak/bonk sounds, using a per-toy force threshold above resting weight. The
bark sends a cone-shaped radial "boop" to nearby toys.

**Static world.** Every collider comes from one shared description
(`src/world/colliderSpecs.js`, built from `layout.js` + `propCatalog.js`). The
same specs feed the runtime physics world and the offline lightmap bake, so
baked shadows always match what the dog collides with. Window glass sits in
its own collision group, so light rays ignore it while movement and the
camera still collide with it.

## 2. Camera collision

`src/camera/ThirdPersonCamera.js` is an MMORPG-style orbit camera: drag (mouse,
right stick or touch) to orbit, wheel/triggers to zoom, damped yaw/pitch/zoom
and follow.

Obstacle avoidance sweeps a **sphere** (radius 0.22 m, larger than the near
plane's footprint) from the follow point to the desired camera position with
Rapier `castShape`, against everything except the dog itself:

- if something blocks the view, the camera moves in **instantly** (never a
  frame of clipping);
- when the obstruction clears, it **eases back out** at a configurable rate;
- if the sweep starts inside a dynamic body (a beach ball pressed against the
  dog), it re-sweeps against static geometry only, so a toy can't collapse
  the camera onto the dog;
- the floor, ceiling, beams, ducts and lamps are colliders too, so the camera
  can't go through them either;
- when the camera is pushed very close, the dog dithers out (alpha-hash) so
  the camera never shows its inside.

## 3. Procedural locomotion and IK

`src/player/DogAnimator.js` animates a 23-bone rigid-skinned skeleton (four
draw calls for the whole dog).

- **Gait clock synced to speed.** Stride length grows with speed, and the
  cycle frequency is `speed / stride`, so planted feet never slide. Per-leg
  phase offsets blend continuously from a lateral-sequence **walk** to a
  **trot** to a rotary **gallop**, and the duty factor blends with them.
- **World-space foot planting.** Each foot is planted in world space during
  stance. During swing it travels from its last plant to a target predicted
  from velocity (half a stance ahead) along a lifted arc, with extra lift
  when stepping up.
- **IK foot placement.** Swing targets are ray-cast down onto the physics
  world, so paws land on ramps, stairs, decks and the soft-play domes. When
  turning in place, feet that drift too far from their rest spots trigger
  re-steps.
- **Body adaptation.** Body height, pitch and roll follow the planted feet
  (terrain), plus gait bob, lean into acceleration and turns, idle breathing,
  a sit pose after idling, jump tuck/reach and a spring-damped landing crouch.
- **Two-bone IK** (`src/player/LegIK.js`): an analytic solution with a 2-DOF
  hip (abduction, then flexion) and a 1-DOF knee. Paws are counter-rotated to
  stay level with the ground.
- **Secondary motion.** Tail wag frequency, amplitude and lift depend on
  state and speed (whip delay down three segments). Ears and the antenna are
  damped springs driven by body acceleration, turning and the bark flick. The
  head looks into turns and glances around or at the camera when idle. The
  LED visor (an SDF shader) blinks, smiles, squints on hard landings and
  opens its mouth when barking.

Every blend weight is exponentially damped, so state changes never pop.
Footstep sounds are emitted on each swing-to-stance transition, so they are
exactly in sync with the gait.

## 4. Rendering pipeline

**Lighting strategy.** Static lighting is baked; real-time shadows are
reserved for dynamic objects.

- An offline **lightmap + AO bake** (`scripts/assetgen/lightmapBake.mjs`)
  ray-traces the Rapier colliders. Each texel samples the top walkable
  surface (floor, deck, ramp or dome) and stores:
  - soft area-sun visibility through the window openings, including mullion
    shadows;
  - soft area-light pools under the pendant lamps;
  - cosine-weighted hemisphere AO.

  The lightmap is 1024×768 and the AO 512×384, both as UASTC KTX2. They are
  applied to floors and floor coverings through a top-down UV1 projection.

- Props carry a baked **vertex AO** term towards the floor.
- One **key light** casts shadows, and only dynamic meshes (the dog and toys)
  are shadow casters. The shadow frustum follows the dog and is snapped to
  shadow-map texels, so it never shimmers. Shadow cost is a handful of draw
  calls.
- When the dog stands in a baked sun patch (one ray toward the sun, ignoring
  glass), a material patch adds matching warm sunlight to it. A fresnel rim
  light gives the stylised silhouette.
- **Environment reflections.** A reflection probe of the finished interior is
  rendered once into a cube map and prefiltered with PMREM. To avoid
  recompiling every shader when the probe arrives, a same-size placeholder
  CubeUV target is installed before compilation.
- **Window light shafts.** Crossed additive sheets inside each sunlit
  window's beam volume, with an analytic falloff, scrolling dust streaks and
  view/near fades. GPU-animated dust motes sit inside the beams.

**Post-processing** (`src/render/PostFX.js`, EffectComposer). The chain is
RenderPass (half-float HDR) → GTAO (High/Ultra) → UnrealBloom (subtle,
reduced resolution) → OutputPass (ACES Filmic + sRGB) → SMAA. GTAO reuses the
depth buffer that RenderPass already wrote (normals reconstructed from depth)
instead of re-rendering the scene, which halved the AO presets' draw calls
(304 → 164). Each preset change disposes the previous chain completely. Low
renders straight to the canvas, with ACES applied by the renderer.

**Quality presets.**

| Preset | Pixel ratio cap | Shadow map | AO            | Bloom    | SMAA | Dust |
| ------ | --------------- | ---------- | ------------- | -------- | ---- | ---- |
| Low    | 1.0             | 512        | —             | —        | —    | 0    |
| Medium | 1.25            | 1024       | —             | ½ res    | ✓    | 260  |
| High   | 1.5             | 2048       | GTAO ½ res    | ½ res    | ✓    | 650  |
| Ultra  | 2.0             | 4096       | GTAO full res | full res | ✓    | 1300 |

"Auto" picks a tier from GPU heuristics: software rasteriser or mobile →
Low, integrated → Medium, discrete → High. It then steps down if the measured
frame rate stays below target, and at Low it shrinks the render scale
(dynamic resolution).

**Draw calls and memory.**

- Static architecture is merged per material.
- Repeated props are `InstancedMesh`es (fences, gates, bowls, beds, plants,
  lamps, tunnel segments, trees), with per-instance pastel tints.
- Plants, dog houses and trees have two LOD levels, re-bucketed by camera
  distance a few times a second.
- All signage shares one canvas atlas (one draw call).
- Measured draw calls: about 137 (Low/Medium) and 164 (High/Ultra).
- GPU geometry and texture counts return to baseline after cycling every
  preset (automated check).

Hot loops reuse module-level vectors, matrices and quaternions. The only
per-frame allocations are inside Rapier's JS bindings (for example
`body.translation()`), which are limited to awake bodies.

## 5. Asset pipeline (`npm run assets`)

All content is generated procedurally, so there are no licensing questions:

- `src/player/robotDogGeometry.js` and `src/world/props/*` build meshes from
  rounded primitives, lathes and extrusions with vertex colours (palette).
  The results are exported with three's GLTFExporter, then optimised with
  glTF-Transform: accessor dedup, prune, and **Meshopt** compression with
  quantisation (skinned-mesh bind matrices are corrected automatically).
  - `props.glb`: 89k vertices, 1.2 MB.
  - `robodog.glb`: 179 KB.
- `scripts/assetgen/textures.mjs` synthesises tileable textures (wood planks,
  tiles, terrazzo, rubber, fabric, plaster) from periodic noise. They are
  encoded to **KTX2/Basis** (ETC1S with mipmaps); the bakes use UASTC + Zstd
  - RDO.
- `src/config/assetManifest.js` records content hashes. Assets are requested
  with `?v=<hash>`, so they can be cached immutably.

Total game data is about 2.1 MB. The whole first visit transfers about
4.2 MB: code and data gzipped, of which Rapier's JS bundle with inlined WASM
is 1.6 MB and the Basis transcoder 0.25 MB. All audio is synthesised in the
browser (see §8).

## 6. Loading strategy and Lighthouse

Initialising a full WebGL game during page load is expensive on the main
thread:

- Shader compilation on ANGLE/D3D11 blocks inside synchronous program-status
  queries (about 60 ms per program on an Iris Xe).
- Rapier's compat build decodes about 3 MB of inlined WASM.

So the boot is split in two:

1. **Page load.** Static HTML loading screen → every game file downloads with
   `fetch` (real byte progress, network only) → start menu over a
   pre-rendered backdrop of the shelter. The bulk download waits for first
   paint. Main entry chunk: 9.6 KB gzipped.
2. **Play.** The engine chunk boots behind the loading screen, with a
   LoadingManager tracking texture/model decoding, physics, world assembly,
   audio synthesis, shader pre-compilation and the probe. The game then
   starts directly. The AudioContext is created inside the Play click
   (Safari's autoplay rules).

Shaders are compiled for the render target actually used (post-processing
renders to a linear half-float target, which needs different program
variants), and a warm-up frame runs before the loading screen fades, so play
never hitches on first use.

Measured with Lighthouse 13.5 (desktop preset, local production build on a
plain static server, Iris Xe laptop), after Phase A:

| Category       | Score |
| -------------- | ----- |
| Performance    | 100   |
| Accessibility  | 100   |
| Best Practices | 100   |
| SEO            | 100   |

Metrics: FCP 0.4 s, LCP 0.4 s, TBT 0 ms, CLS 0, SI 0.7 s.

Under `vite preview`, Best Practices drops to 96 for one audit, "charset":
that server omits the charset from its `Content-Type`. The `<meta charset>` is
present, and Vercel serves `text/html; charset=UTF-8`.

## 7. Emotes, LED face, photo mode, saves and the F3 overlay

### Emotes as a pose layer

Emotes are procedural, like the locomotion, not animation clips. Each emote
in `player/emotePoses.js` is a function of time that writes a small **pose
layer**: body height/pitch/roll/wiggle offsets, a sit amount, forward
offsets for the planted paws, **body-space paw targets** (with a weight per
leg), head/neck/jaw offsets, ear offsets and a tail override. `DogAnimator`
evaluates it every frame and blends it over the gait with one damped weight
(in 6/s, out 7/s), so starting, switching and cancelling never pop:

- A paw with emote weight > 0.5 stops stepping; its planted spot is kept
  under the body, so on blend-out the foot lands there with no step or
  footstep sound. The IK target is lerped between the planted world
  position (in body space) and the emote's body-space target, so a paw can
  lift for Beg, paddle in the air for Roll Over or tuck under for Sleep.
- Roll Over turns the body a full 2π about its long axis. That roll is added
  after smoothing (not damped) so it stays exact, and the pose returns
  exactly 0 once the turn completes. The blend-out therefore never
  "unwinds" the roll.
- Head look-around is suppressed per emote, and the existing neck
  compensation keeps the face level when the body pitches (Beg pitches the
  body ~57° nose-up).

`EmoteSystem` owns the gameplay side. It holds the pup still (or, for
Zoomies, steers it: tangent to a 1.5 m circle with a radial correction,
sprinting, mirroring the circle when blocked). It ends one-shots after
their duration and cancels on movement above 0.25 stick/keys or on jump.
Requests made mid-air start on landing within 0.8 s. The pup lies down to
sleep by itself after 75 s idle. It emits `emote:start` / `emote:end`
for audio (voice chirps, a snore every ~3.6 s while asleep), stats, the
face and, later, NPC reactions.

### LED face

The visor is one fragment shader. Each expression is a signed distance
field for the eyes and mouth. Instead of switching shapes, the shader blends
the **distances** with normalised weights (neutral fills whatever the
others leave), so eyes morph, for example from rounded rectangles into
^ ^ arcs or stars. Extra glyphs (floating "z"s, the battery icon and its
blinking bar) fade in with their expression, and tint and flicker follow
the weights.

`FaceController` picks the target expression by priority:

1. forced (photo mode);
2. low battery;
3. the emote's face;
4. timed reactions (excited after a nearby toy impact ≥ 0.55 strength;
   curious on a new zone or when a toy comes into view in front; excited is
   never downgraded to curious);
5. sleepy after 25 s idle;
6. happy while barking or sitting;
7. otherwise neutral.

Blinking runs on its own timer, and the eyes follow the head's look
direction.

While building this, close-up captures showed that the visor geometry had
hidden about 69% of the screen since the core build. The screen plane was
curved (z = −2.2x²), so everything beyond ±3.4 cm of centre sat behind the
flat visor housing. The curve is now 0.08x² and the plane sits 1.5 mm
proud of the housing; `robodog.glb` was regenerated.

### Photo mode

- **Freeze.** The engine stops the fixed simulation and stops advancing the
  world's animation clock (dust, outdoor sway, light shafts and the face
  are drawn at the moment photo mode opened). Only the free camera and
  camera-dependent work (LOD selection, shadow frustum) run, so nothing
  moves while framing a shot. The quality auto-monitor is paused too.
- **Free camera.** Yaw/pitch/roll (Euler YXZ), WASD + E/Q, Shift for 3×
  speed. Movement is swept **one axis at a time** with a 16 cm sphere
  against static colliders and the pup, which gives wall sliding for free,
  then clamped inside the shelter's outer walls (0.35 m margin) and below
  the ceiling.
- **Depth of field.** A single-pass gather on the HDR scene colour (before
  bloom and tone mapping, so highlights become bokeh), reusing the depth
  texture the RenderPass already wrote. The circle of confusion is
  |1/focus − 1/depth| · 3.5/f-number, capped at 20 px at 1080p. Samples
  further away than the centre are clamped to twice the centre's blur, so a
  sharp subject never bleeds onto a blurred background. The pass renders
  into a private half-float target and copies back, because sampling a
  depth texture attached to the framebuffer being drawn is a WebGL
  feedback loop.
- **Grading.** Runs after the OutputPass (display-referred): Warm, Cool,
  Noir, Vintage and Vivid, each with its own vignette/grain, blended by a
  strength slider. Exposure is `toneMappingExposure × 2^EV`.
- **Cost.** Both passes are always part of the composer chain but disabled
  outside photo mode, so they cost nothing then. Their programs are compiled
  with the rest at boot. On Low (no composer) the chain is built when photo
  mode opens and removed when it closes; GPU memory returns to baseline,
  which the tests check.
- **Capture.** Renders a fresh frame, then copies the canvas into a 2D
  canvas in the same task (the WebGL drawing buffer is only guaranteed
  until the task ends). It draws the watermark with canvas primitives,
  encodes a PNG and downloads it as `robopup_<date>_<time>.png`.

### Saves

`SaveManager` keeps one document (`robopup.save`):
`{ version, savedAt, settings, progress }`.

- **Migrations.** `MIGRATIONS[n]` upgrades version n to n + 1. Version 0 is
  the pre-SaveManager `robopup.settings.v1` key, which is migrated and then
  deleted.
- **Validation.** `conform()` validates stored progress against the
  default shape. Mistyped, negative or non-finite values fall back to
  defaults, empty-object defaults act as id → counter maps, and unknown keys
  from newer builds are preserved. Settings keep their own validators in
  `SettingsStore`.
- **Writes.** Coalesced (at most one per 2 s) and flushed on pause, page
  hide and unload. If storage is blocked, everything stays in memory and the
  Progress section says so.
- **Reset Progress** replaces `progress` with the defaults, keeps settings
  and emits `save:progress-reset`.

### Measuring performance (F3 overlay and test numbers)

All numbers come from the running page itself, never from estimates:

- **FPS / frame time:** `requestAnimationFrame` timestamps, averaged over
  0.5 s windows, plus the worst frame of each window.
- **Draw calls / triangles:** `renderer.info.render` with `autoReset` off
  and one reset per frame, so they are summed over every pass of the frame
  (shadow map, scene, GTAO, bloom, output, SMAA).
- **CPU:** `performance.now()` around the fixed steps and update ("logic")
  and around the render call ("draw"). When the GPU is the bottleneck the
  browser blocks inside WebGL calls, so "draw" grows towards the GPU time.
  That is waiting, not JavaScript work; game logic itself is about 1–3 ms.
- **GPU:** `EXT_disjoint_timer_query_webgl2` around the whole frame, results
  read a few frames late, disjoint frames discarded. Chromium exposes it;
  Firefox and Safari do not (the overlay shows "n/a").
- **Physics bodies:** awake / total non-fixed Rapier bodies.
- **GPU name:** `WEBGL_debug_renderer_info` (not requested on Firefox,
  which warns about it). A software rasteriser (SwiftShader, llvmpipe,
  Microsoft Basic Render) is shown in red, so it is obvious when numbers
  are not from real hardware.

The automated tests run Edge/Chrome **headless but on the real GPU**: the
renderer string reports `ANGLE (Intel, Intel(R) Iris(R) Xe Graphics …
Direct3D11)`, not SwiftShader. Headless frames are not presented to the
desktop compositor, so headed numbers (a visible window, as a player sees
it) are measured separately and both are listed in the README. On CI
runners without a GPU, Chrome falls back to SwiftShader; those runs check
correctness, not speed.

## 8. Deviations from the brief and known limitations

Stated explicitly, as the brief requires.

- **Audio files.** There is no `public/assets/audio`. Every sound is
  synthesised at load time in `src/audio/SoundSynth.js` from oscillators,
  filtered noise and formant filters, then wrapped in `AudioBuffer`s after
  the first gesture. This avoids third-party licensing, adds zero download
  bytes and gives seamless loops. These sounds are original and released
  under CC0 (see CREDITS.md).
- **`.wasm` MIME type.** `rapier3d-compat` (required by the brief) inlines its
  WASM as base64, so it ships no `.wasm` file. The MIME and caching rules in
  `vercel.json` apply to the Basis transcoder's `.wasm` and to
  any future `.wasm` file.
- **Draco vs Meshopt.** Meshopt was chosen: better decode speed and no decoder
  download beyond the small module bundled with three.js.
- **"Ray-tracing-inspired" effects.** These are an offline ray-traced
  lightmap/AO bake, screen-space GTAO (High/Ultra), a baked reflection probe
  and volumetric-style light shafts. Screen-space reflections were not added:
  three's SSRPass re-renders the scene and is too expensive for the
  integrated-GPU budget.
- **First boot time.** After pressing Play, the first boot takes about 5–7 s
  on an Intel Iris Xe, dominated by D3D shader compilation (52 programs).
  Browsers cache compiled programs, so later boots are faster.
- **Cross-browser coverage.**
  - Chrome 155 and Edge 155 were tested on Windows with a GPU.
  - Firefox was tested with Playwright's Firefox 157 build.
  - "Safari" was tested with Playwright's WebKit 27.2 build on Windows, which
    has no Web Audio. The game detects this and runs silently. Real Safari on
    macOS/iOS has not been tested.
  - Mobile was verified with touch emulation only. The 30+ FPS mobile target
    has not been measured on a real phone.
- **Performance figures** come from one machine: an i7-1165G7 with Intel
  Iris Xe at 1280×720, measured both headless and headed (the numbers agree).
  - Medium runs at 58–60 FPS at most viewpoints and about 50 at the heaviest
    one (sunlit nook with light shafts). There it is GPU-bound at about
    19 ms per frame, so the Medium budget of 60 FPS on integrated GPUs is
    not met at that spot. Auto quality steps down to Low there.
  - High runs at about 33–36 FPS and Ultra at about 20. Ultra is intended
    for discrete GPUs.
- **Phase A limitations.**
  - The low-battery face exists and can be shown in photo mode, but no
    gameplay triggers it until the battery system arrives in Phase B.
    `FaceController.setLowBattery()` is the hook.
  - "Collecting an item makes the pup excited" is likewise ready through
    `FaceController.react('excited', …)` but needs collectibles (Phase B).
    Today the pup gets excited from Zoomies, Roll Over, Play Bow and big toy
    hits.
  - Photo mode has no time-of-day selector yet; it comes with the day–night
    cycle in Phase B.
  - Captures are saved at the current render resolution (the preset's
    pixel-ratio cap); there is no supersampled high-resolution capture.
  - iOS Safari may open the PNG in a new tab instead of downloading it,
    depending on version (the `download` attribute is honoured since
    iOS 13).
  - GPU time in the F3 overlay is only available where the browser exposes
    `EXT_disjoint_timer_query_webgl2` (Chromium); elsewhere it shows "n/a".
  - Emote wheel slots use text labels, not illustrated icons.
  - Gamepad menu navigation was verified with an injected standard gamepad,
    not physical hardware. Browsers do not treat gamepad presses as a user
    gesture for starting audio. A player who starts the game with only a
    gamepad hears sound after their first click, key press or tap
    (AudioManager retries on each of those).
- **Gamepad** was verified with an injected standard-mapping gamepad (Gamepad
  API), not physical hardware.
- **Deployment** needs the repository owner's Vercel account; see
  README › Deployment.
