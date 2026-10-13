import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

/**
 * three.js GLTFExporter expects a browser FileReader for binary output;
 * Node has Blob but not FileReader, so provide the two methods it uses.
 */
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        if (this.onloadend) this.onloadend();
      });
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`;
        if (this.onloadend) this.onloadend();
      });
    }
  };
}

/**
 * Export a three.js object hierarchy to a binary glTF.
 * @param {import('three').Object3D} object
 * @returns {Promise<Uint8Array>}
 */
export async function exportGLB(object) {
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(object, { binary: true, onlyVisible: false });
  return new Uint8Array(result);
}

/**
 * Compress a GLB with EXT_meshopt_compression (+ KHR_mesh_quantization).
 * Materials are NOT deduplicated: their names are runtime slot identifiers.
 * @param {Uint8Array} glb
 * @returns {Promise<Uint8Array>}
 */
export async function compressGLB(glb) {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
  const doc = await io.readBinary(glb);
  await doc.transform(
    dedup({ propertyTypes: [PropertyType.ACCESSOR] }),
    prune({ keepLeaves: true, keepAttributes: true }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  return io.writeBinary(doc);
}
