import { Group } from 'three';

const LEGS = ['FL', 'FR', 'RL', 'RR'];

/**
 * The robo-pup's visual: the skinned model loaded from robodog.glb with
 * runtime materials applied, plus typed access to every animated bone.
 * Animation logic lives in DogAnimator; this class only owns the scene graph.
 */
export class RobotDog {
  /**
   * @param {import('three').Object3D} gltfScene Scene from robodog.glb.
   * @param {import('../world/MaterialLibrary.js').MaterialLibrary} materials
   */
  constructor(gltfScene, materials) {
    this.object = new Group();
    this.object.name = 'RobotDog';
    this.object.add(gltfScene);

    /** @type {import('three').SkinnedMesh[]} */
    this.meshes = [];
    const loaderMaterials = new Set();
    gltfScene.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      loaderMaterials.add(o.material);
      o.material = materials.get(o.material.name);
      o.castShadow = o.material.name !== 'dog_face';
      o.receiveShadow = true;
      // The dog is always near the camera and its legs stretch beyond the
      // bind-pose bounds, so culling would only risk popping.
      o.frustumCulled = false;
      this.meshes.push(o);
    });
    for (const m of loaderMaterials) m.dispose();

    const bone = (name) => {
      const b = gltfScene.getObjectByName(name);
      if (!b) throw new Error(`RobotDog: bone "${name}" missing`);
      return b;
    };
    this.bones = {
      root: bone('root'),
      body: bone('body'),
      neck: bone('neck'),
      head: bone('head'),
      jaw: bone('jaw'),
      earL: bone('ear_L'),
      earR: bone('ear_R'),
      antenna: bone('antenna'),
      tail: [bone('tail_0'), bone('tail_1'), bone('tail_2')],
      legs: LEGS.map((leg) => ({
        name: leg,
        front: leg[0] === 'F',
        left: leg[1] === 'L',
        hip: bone(`hip_${leg}`),
        knee: bone(`knee_${leg}`),
        foot: bone(`foot_${leg}`),
      })),
    };
    for (const leg of this.bones.legs) leg.hip.rotation.order = 'ZXY';
    this.bones.neck.rotation.order = 'YXZ';
    this.bones.head.rotation.order = 'YXZ';

    this.faceMaterial = materials.get('dog_face');
    this._fadeMaterials = ['dog_shell', 'dog_mech', 'dog_glow'].map((n) => materials.get(n));
    this.opacity = 1;
  }

  /**
   * Fade the dog (dithered alpha-hash, no sorting issues) when the camera
   * gets very close.
   * @param {number} value 0..1
   */
  setOpacity(value) {
    if (Math.abs(value - this.opacity) < 0.005) return;
    this.opacity = value;
    for (const m of this._fadeMaterials) m.opacity = value;
    this.faceMaterial.uniforms.uOpacity.value = value;
    this.object.visible = value > 0.02;
  }
}
