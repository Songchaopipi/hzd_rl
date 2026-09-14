import * as ort from 'onnxruntime-web/wasm'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import { assetUrl } from '../../lib/assetUrl'
import { loadMujocoModule } from '../reach/mujocoLoader'
import type { Manifest, PolicyAsset } from './types'

export const ASSET_BASE = assetUrl('models/locomotion')
let configured = false
export async function fetchChecked(url: string, signal?: AbortSignal): Promise<Response> {
  const result = await fetch(url, { signal })
  if (!result.ok) throw new Error(`Asset load failed: ${url} (${result.status})`)
  return result
}

export async function verifyHash(buffer: ArrayBuffer, expected: string): Promise<void> {
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  const actual = Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('')
  if (actual !== expected) throw new Error('Policy asset checksum mismatch. Reload the complete bundle.')
}

export async function loadPolicy(policy: PolicyAsset, signal?: AbortSignal): Promise<ort.InferenceSession> {
  if (!configured) {
    ort.env.wasm.numThreads = 1
    ort.env.wasm.wasmPaths = { wasm: ortWasmUrl }
    configured = true
  }
  const bytes = await (await fetchChecked(`${ASSET_BASE}/${policy.onnx}`, signal)).arrayBuffer()
  await verifyHash(bytes, policy.sha256)
  signal?.throwIfAborted()
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
  if (signal?.aborted) { await session.release(); signal.throwIfAborted() }
  if (session.inputNames.join() !== 'obs' || session.outputNames.join() !== 'actions') {
    await session.release()
    throw new Error('Unexpected policy input/output contract')
  }
  return session
}

export async function loadPhysics(signal?: AbortSignal) {
  const manifest: Manifest = await (await fetchChecked(`${ASSET_BASE}/manifest.json`, signal)).json()
  if (manifest.contract !== 'wbo5_raw_102_v1' || manifest.physics_dt !== .005 || manifest.policies.length !== 2) {
    throw new Error('Unsupported locomotion bundle')
  }
  const mj = await loadMujocoModule()
  signal?.throwIfAborted()
  const vfs = new mj.MjVFS()
  try {
    const modelBytes = await (await fetchChecked(`${ASSET_BASE}/${manifest.model}`, signal)).arrayBuffer()
    await verifyHash(modelBytes, manifest.model_sha256)
    const xml = new TextDecoder().decode(modelBytes)
    // VFS keeps the original visual meshes and collision/inertial model intact.
    for (const mesh of manifest.meshes) {
      const bytes = new Uint8Array(await (await fetchChecked(`${ASSET_BASE}/meshes/${mesh}`, signal)).arrayBuffer())
      vfs.addBuffer(`meshes/${mesh}`, bytes)
    }
    const model = mj.MjModel.from_xml_string(xml, vfs)
    if (model.nq !== 36 || model.nv !== 35 || model.nu !== 29 || Math.abs(model.opt.timestep - .005) > 1e-10) {
      model.delete()
      throw new Error('MuJoCo model dimensions/timestep differ from native deployment')
    }
    return { mj, model, manifest }
  } finally {
    vfs.delete()
  }
}
