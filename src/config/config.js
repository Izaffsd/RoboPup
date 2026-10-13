/**
 * Central tuning file. Every gameplay, camera, physics, rendering and audio
 * number that a designer might want to tweak lives here so balancing never
 * requires hunting through systems code.
 *
 * Units: metres, seconds, radians, kilograms.
 */

const DEG = Math.PI / 180;

export const PHYSICS = Object.freeze({
  /** Fixed simulation step (60 Hz). Rendering is decoupled and interpolated. */
  fixedTimeStep: 1 / 60,
  /** Upper bound on fixed steps per rendered frame (prevents a spiral of death). */
  maxStepsPerFrame: 5,
  /** Largest frame delta accepted (tab switches, debugger pauses). */
  maxFrameDelta: 0.25,
  /** Earth gravity. */
  gravity: -9.81,
  /** Dynamic toys below this height are respawned. */
  killPlaneY: -6,
  /** Contact-force threshold that triggers toy impact sounds (Newtons). */
  toyImpactForceThreshold: 6,
});

export const PLAYER = Object.freeze({
  /** Capsule collider (vertical). Total height = 2 * (halfHeight + radius). */
  capsuleRadius: 0.32,
  capsuleHalfHeight: 0.13,
  /** Gap Rapier keeps between the character and obstacles. */
  controllerOffset: 0.015,

  /** Default (WASD) locomotion speed — a brisk trot. */
  walkSpeed: 2.3,
  /** SHIFT / RT sprint speed — a gallop. */
  runSpeed: 5.4,
  /** Below this speed the dog is considered idle. */
  idleSpeedThreshold: 0.08,

  /** Horizontal acceleration on the ground (m/s²). */
  groundAcceleration: 16,
  /** Horizontal braking on the ground when there is no input (m/s²). */
  groundDeceleration: 20,
  /** Fraction of ground control available while airborne. */
  airControl: 0.38,
  /** How fast the body yaws towards the movement direction (rad/s smoothing rate). */
  turnRate: 11,

  /** Jump take-off speed: v = sqrt(2 g h) gives ~0.95 m apex at 9.81 m/s². */
  jumpVelocity: 4.3,
  /** Releasing jump early while rising multiplies vertical speed by this (variable jump height). */
  jumpCutMultiplier: 0.55,
  /** Real gravity while rising; a slightly heavier fall reads better on screen. */
  fallGravityMultiplier: 1.3,
  /** Terminal fall speed (m/s). */
  maxFallSpeed: 22,
  /** Constant downward velocity while grounded (keeps ground contact stable). */
  groundStickSpeed: 1.0,
  /** Grace period after walking off a ledge in which a jump is still accepted. */
  coyoteTime: 0.1,
  /** A jump pressed this long before landing is executed on touchdown. */
  jumpBufferTime: 0.12,

  /** Slope handling. */
  maxSlopeClimbAngle: 46 * DEG,
  minSlopeSlideAngle: 52 * DEG,
  /** Step-up for small ledges (kerbs, platform edges, cushions). */
  autostepMaxHeight: 0.26,
  autostepMinWidth: 0.12,
  /** Keeps the character glued to the ground when walking down ramps/steps. */
  snapToGroundDistance: 0.28,

  /**
   * The head sticks out in front of the vertical capsule. A forward probe keeps
   * the snout from entering walls by braking forward motion when it would.
   */
  headReach: 0.5,
  headProbeRadius: 0.12,
  headProbeHeight: 0.62,

  /** Toy pushing: impulse = direction * speed * toyMass * pushStrength (clamped). */
  pushStrength: 0.9,
  maxPushImpulse: 3.2,
  /** Sprinting into a ball pops it slightly upward. */
  pushLift: 0.18,

  /** Bark: cooldown and the sonic "boop" that nudges nearby toys. */
  barkCooldown: 0.55,
  barkRadius: 2.6,
  barkImpulse: 1.1,
  barkConeDot: 0.25,

  /** Landing speed (m/s) above which a "hard" landing animation and sound play. */
  hardLandingSpeed: 5.2,

  /** Spawn point (inside the reception, facing the hall). */
  spawn: Object.freeze({ x: -12.5, y: 0.2, z: 8.5, yaw: Math.PI * 0.85 }),
});

export const ANIMATION = Object.freeze({
  /** Torso centre height above the ground when standing. */
  rideHeight: 0.44,
  upperLegLength: 0.2,
  lowerLegLength: 0.2,
  /** Foot (paw) radius — feet are placed this far above the ground contact. */
  footRadius: 0.045,
  /** Knee bend direction: +1 = knee points backwards (Spot style), -1 = forwards. */
  kneeDirectionFront: 1,
  kneeDirectionRear: 1,

  /** Distance travelled per gait cycle as a function of speed: base + speed * scale. */
  strideBase: 0.26,
  strideScale: 0.17,
  strideMax: 1.25,
  /** Duty factor (fraction of a cycle a foot is planted) for walk / trot / gallop. */
  dutyWalk: 0.62,
  dutyTrot: 0.5,
  dutyGallop: 0.4,
  /** Swing arc height (m) at walk and at gallop. */
  stepHeightWalk: 0.065,
  stepHeightRun: 0.11,
  /** Idle re-stepping: feet further than this from their rest spot take a step. */
  restStepThreshold: 0.07,
  idleStepFrequency: 2.2,
  /** Speeds at which the gait blends walk → trot → gallop. */
  gaitTrotSpeed: 1.6,
  gaitGallopSpeed: 4.2,
  /** Smoothing rates (1/s) for exponential damping of animation parameters. */
  blendRate: 9,
  bodyHeightRate: 14,
  bodyTiltRate: 8,
  gaitOffsetRate: 2.5,
  /** Body lean factors. */
  accelPitch: 0.035,
  turnRoll: 0.06,
  maxLean: 14 * DEG,
  /** Seconds of idling before the dog sits down. */
  sitDelay: 7,
  /** Tail wag (frequency Hz / amplitude rad) per state. */
  tailIdle: Object.freeze({ freq: 2.2, amp: 0.45, lift: 0.75 }),
  tailWalk: Object.freeze({ freq: 3.4, amp: 0.32, lift: 0.55 }),
  tailRun: Object.freeze({ freq: 4.5, amp: 0.12, lift: 0.18 }),
  tailAir: Object.freeze({ freq: 2.0, amp: 0.15, lift: 0.95 }),
  tailBark: Object.freeze({ freq: 7.5, amp: 0.65, lift: 0.85 }),
  /** Ear spring. */
  earStiffness: 90,
  earDamping: 7,
  /** Duration of the bark head animation. */
  barkDuration: 0.5,
  /** Duration of the landing crouch. */
  landDuration: 0.32,
});

export const CAMERA = Object.freeze({
  fovDefault: 62,
  fovMin: 50,
  fovMax: 95,
  near: 0.05,
  far: 220,
  /** Orbit target offset above the dog's root. */
  targetHeight: 0.62,
  distanceDefault: 4.2,
  distanceMin: 1.5,
  distanceMax: 9,
  zoomStep: 0.0018,
  zoomDamping: 10,
  /** Pitch limits (positive = looking down at the dog). */
  pitchMin: -0.42,
  pitchMax: 1.25,
  pitchDefault: 0.32,
  /** Mouse sensitivity at a settings value of 1.0 (radians per pixel). */
  mouseSensitivity: 0.0032,
  /** Right-stick speed at full deflection (rad/s). */
  gamepadLookSpeed: 2.8,
  /** Touch drag-orbit sensitivity (radians per CSS pixel). */
  touchSensitivity: 0.0062,
  /** Orientation damping rate (1/s). Higher = snappier. */
  rotationDamping: 18,
  /** Target follow damping (1/s). */
  followDamping: 14,
  /** Collision: sphere radius swept from the target to the desired camera spot. */
  collisionRadius: 0.22,
  collisionMargin: 0.06,
  /** Pull-in is instant, push-out eases back at this rate (1/s). */
  collisionRecoverRate: 3.5,
  /** Below this distance the dog fades out so the camera never sees inside it. */
  dogFadeDistance: 0.9,
  /** Cinematic orbit speed used behind menus (rad/s). */
  menuOrbitSpeed: 0.11,
});

export const INPUT = Object.freeze({
  gamepadDeadzone: 0.16,
  gamepadTriggerThreshold: 0.35,
  /** Touch joystick radius in CSS pixels; pushing past sprintThreshold sprints. */
  touchJoystickRadius: 56,
  touchSprintThreshold: 0.92,
});

export const AUDIO = Object.freeze({
  sampleRate: 44100,
  positionalPoolSize: 8,
  sfxPoolSize: 8,
  footstepVolume: 0.42,
  barkVolume: 0.9,
  jumpVolume: 0.5,
  landVolume: 0.65,
  toyVolume: 0.75,
  emoteVolume: 0.5,
  shutterVolume: 0.7,
  snoreVolume: 0.32,
  /** Seconds between snores while the pup sleeps. */
  snoreInterval: 3.6,
  /** Distant kennel barks: random interval range (s). */
  distantBarkInterval: Object.freeze([5, 13]),
  /** Default user volumes (0..1). */
  defaultMaster: 0.8,
  defaultSfx: 0.85,
  defaultAmbience: 0.6,
});

/**
 * Graphics presets. `auto` picks one of these from GPU heuristics and then
 * steps down if the measured frame rate falls below target.
 */
export const QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({
    label: 'Low',
    pixelRatioCap: 1,
    shadowMapSize: 512,
    shadowRadius: 2,
    postProcessing: false,
    ao: null,
    bloom: null,
    smaa: false,
    dustCount: 0,
    lodDistanceScale: 0.6,
    envIntensity: 0.32,
  }),
  medium: Object.freeze({
    label: 'Medium',
    pixelRatioCap: 1.25,
    shadowMapSize: 1024,
    shadowRadius: 3,
    postProcessing: true,
    ao: null,
    bloom: Object.freeze({ strength: 0.22, radius: 0.45, threshold: 0.92, resolutionScale: 0.5 }),
    smaa: true,
    dustCount: 260,
    lodDistanceScale: 0.85,
    envIntensity: 0.34,
  }),
  high: Object.freeze({
    label: 'High',
    pixelRatioCap: 1.5,
    shadowMapSize: 2048,
    shadowRadius: 4,
    postProcessing: true,
    ao: Object.freeze({
      resolutionScale: 0.5,
      samples: 12,
      radius: 0.45,
      distanceExponent: 1.6,
      thickness: 1.2,
      scale: 1.0,
      blend: 0.85,
    }),
    bloom: Object.freeze({ strength: 0.24, radius: 0.5, threshold: 0.9, resolutionScale: 0.5 }),
    smaa: true,
    dustCount: 650,
    lodDistanceScale: 1,
    envIntensity: 0.36,
  }),
  ultra: Object.freeze({
    label: 'Ultra',
    pixelRatioCap: 2,
    shadowMapSize: 4096,
    shadowRadius: 5,
    postProcessing: true,
    ao: Object.freeze({
      resolutionScale: 1,
      samples: 16,
      radius: 0.5,
      distanceExponent: 1.6,
      thickness: 1.2,
      scale: 1.0,
      blend: 0.9,
    }),
    bloom: Object.freeze({ strength: 0.26, radius: 0.55, threshold: 0.88, resolutionScale: 1 }),
    smaa: true,
    dustCount: 1300,
    lodDistanceScale: 1.35,
    envIntensity: 0.38,
  }),
});

export const QUALITY_ORDER = Object.freeze(['low', 'medium', 'high', 'ultra']);

export const QUALITY_AUTO = Object.freeze({
  /** Seconds ignored after start / preset change (shader warm-up hitches). */
  warmup: 4,
  /** Rolling window used to judge performance. */
  window: 4,
  /** Desktop and mobile frame-rate targets. */
  targetFpsDesktop: 55,
  targetFpsMobile: 28,
  /** At the lowest preset, render scale can shrink down to this. */
  minRenderScale: 0.6,
});

export const RENDER = Object.freeze({
  toneMappingExposure: 1.0,
  /** Key light: soft skylight-from-above that casts the dynamic shadows. */
  keyLightColor: 0xfff1dc,
  keyLightIntensity: 1.35,
  keyLightDirection: Object.freeze([0.28, -0.86, -0.42]),
  /** Half-size (m) of the shadow frustum that follows the dog. */
  shadowFrustumHalfSize: 7,
  hemiSkyColor: 0xfff4e6,
  hemiGroundColor: 0xb08f6a,
  hemiIntensity: 0.5,
  /** Multiplier on the baked lightmap (sun patches + lamp pools) on floors. */
  lightMapIntensity: 2.2,
  aoMapIntensity: 1.0,
  /** Sunlight warmth added to the dog when it stands in a sun patch. */
  sunColor: 0xffd9a0,
  sunBoost: 1.9,
});

/** Sun direction used by both the lightmap bake and the god-ray volumes. Points FROM the sun. */
export const SUN_DIRECTION = Object.freeze([0.22, -0.58, -0.78]);

/** Emotes (hold Q / gamepad Y for the wheel, or press 1–7). */
export const EMOTES = Object.freeze({
  /** Wheel order (clockwise from the top) and labels. */
  list: Object.freeze([
    Object.freeze({ id: 'sit', label: 'Sit' }),
    Object.freeze({ id: 'beg', label: 'Beg' }),
    Object.freeze({ id: 'wag', label: 'Tail Wag' }),
    Object.freeze({ id: 'zoomies', label: 'Zoomies' }),
    Object.freeze({ id: 'rollOver', label: 'Roll Over' }),
    Object.freeze({ id: 'playBow', label: 'Play Bow' }),
    Object.freeze({ id: 'sleep', label: 'Sleep' }),
  ]),
  /** Releasing the wheel key sooner than this without a selection keeps the wheel open. */
  wheelTapTime: 0.28,
  /** Mouse travel (CSS px) / stick deflection that highlights a slice. */
  wheelMouseThreshold: 26,
  wheelStickThreshold: 0.45,
  /** Movement input above this magnitude cancels the current emote. */
  cancelThreshold: 0.25,
  /** An emote requested mid-air starts on landing if it lands within this time. */
  airborneGrace: 0.8,
  /** Pose blend rates (1/s). */
  blendIn: 6,
  blendOut: 7,
  /** One-shot durations (s); the other emotes hold until cancelled. */
  wagDuration: 4,
  rollOverDuration: 2.6,
  zoomiesDuration: 4.4,
  /** Zoomies: circle radius (m); the run uses sprint speed. */
  zoomiesRadius: 1.5,
  /** Zoomies stop if the pup is blocked (below this speed, m/s) for longer than blockedTime. */
  zoomiesMinSpeed: 1.2,
  zoomiesBlockedTime: 0.5,
  /** Idle seconds before the pup lies down to sleep by itself. */
  autoSleepAfter: 75,
});

/** LED face expressions. */
export const FACE = Object.freeze({
  /** Expression weights blend at this rate (1/s). */
  blendRate: 6,
  /** Idle seconds before the face turns sleepy. */
  sleepyAfter: 25,
  /** Reaction lengths (s). */
  excitedDuration: 2.6,
  curiousDuration: 1.8,
  /** A toy this close in front of an idle pup makes it curious. */
  curiousToyDistance: 1.5,
  /** Toy impacts at least this strong (0..1) within excitedImpactRadius excite the pup. */
  excitedImpactStrength: 0.55,
  excitedImpactRadius: 2.5,
  /** Blink interval range (s). */
  blinkInterval: Object.freeze([2, 5.5]),
});

/** Photo mode (P). */
export const PHOTO = Object.freeze({
  moveSpeed: 2.4,
  fastMultiplier: 3,
  verticalSpeed: 1.8,
  /** Free camera collision sphere and distance kept from the shelter's outer walls. */
  collisionRadius: 0.16,
  boundsMargin: 0.35,
  minHeight: 0.12,
  ceilingMargin: 0.25,
  pitchLimit: 1.5,
  fovMin: 20,
  fovMax: 100,
  /** FOV change per wheel pixel (degrees). */
  wheelFovStep: 0.02,
  rollMax: 45,
  focusMin: 0.3,
  focusMax: 30,
  fStops: Object.freeze([1.4, 2, 2.8, 4, 5.6, 8, 11, 16]),
  defaultFStop: 2.8,
  /** Circle-of-confusion scale: blur ∝ |1/focus − 1/depth| · apertureScale / fStop. */
  apertureScale: 3.5,
  /** Largest bokeh radius in pixels at 1080p (scaled with the render height). */
  maxBlur: 20,
  exposureMin: -2,
  exposureMax: 2,
  filters: Object.freeze([
    Object.freeze({ id: 'none', label: 'None' }),
    Object.freeze({ id: 'warm', label: 'Warm' }),
    Object.freeze({ id: 'cool', label: 'Cool' }),
    Object.freeze({ id: 'noir', label: 'Noir' }),
    Object.freeze({ id: 'vintage', label: 'Vintage' }),
    Object.freeze({ id: 'vivid', label: 'Vivid' }),
  ]),
  watermarkText: 'RoboPup',
  watermarkSubtitle: 'Shelter Day',
  filePrefix: 'robopup',
});

/** Versioned save document (settings + progress) in localStorage. */
export const SAVE = Object.freeze({
  key: 'robopup.save',
  /** Current schema version; SaveManager migrates older documents up to it. */
  version: 1,
  /** Settings-only key used before the SaveManager existed (migrated, then removed). */
  legacySettingsKey: 'robopup.settings.v1',
  /** Changes are written at most this often (s); pause and page hide flush immediately. */
  flushDelay: 2,
});

/** F3 performance overlay. */
export const DEBUG = Object.freeze({
  /** Overlay refresh interval (s). */
  overlayInterval: 0.5,
});

export const DEFAULT_SETTINGS = Object.freeze({
  quality: 'auto',
  fov: CAMERA.fovDefault,
  mouseSensitivity: 1,
  invertY: false,
  masterVolume: AUDIO.defaultMaster,
  sfxVolume: AUDIO.defaultSfx,
  ambienceVolume: AUDIO.defaultAmbience,
  showFps: false,
  pointerLockOnDrag: true,
  photoWatermark: true,
});
