import { Mesh, PlaneGeometry, Scene } from 'three';

/**
 * Resolve once the GPU has executed every command issued so far (used to let
 * warm-up work finish before the loading screen fades out).
 *
 * Uses a WebGL2 fence whose status is polled from timers; fence status
 * updates asynchronously between tasks, so polling never stalls the page.
 * @param {WebGL2RenderingContext} gl
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
export function waitForGpu(gl, timeoutMs = 30000) {
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  const start = performance.now();
  return new Promise((resolve) => {
    const check = () => {
      const signaled = !sync || gl.getSyncParameter(sync, gl.SYNC_STATUS) === gl.SIGNALED;
      if (signaled || performance.now() - start > timeoutMs) {
        if (sync) gl.deleteSync(sync);
        resolve();
      } else {
        setTimeout(check, 20);
      }
    };
    setTimeout(check, 20);
  });
}

/**
 * Collect every material owned by post-processing passes (full-screen quad
 * materials are pass fields, sometimes in arrays).
 * @param {object[]} passes
 * @returns {import('three').Material[]}
 */
export function collectPassMaterials(passes) {
  const out = new Set();
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.isMaterial) out.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
  };
  for (const pass of passes) {
    for (const key of Object.keys(pass)) visit(pass[key]);
  }
  return [...out];
}

/**
 * Issue shader compilation for full-screen materials without drawing (and
 * therefore without waiting for the compile to finish).
 * @param {import('three').WebGLRenderer} renderer
 * @param {import('three').Material[]} materials
 * @param {import('three').Camera} camera
 */
export function compileMaterials(renderer, materials, camera) {
  if (materials.length === 0) return;
  const scene = new Scene();
  const geometry = new PlaneGeometry(2, 2);
  for (const m of materials) {
    const mesh = new Mesh(geometry, m);
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
  renderer.compile(scene, camera);
  geometry.dispose();
}
