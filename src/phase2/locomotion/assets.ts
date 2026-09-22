import * as ort from 'onnxruntime-web/wasm'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import { assetUrl } from '../../lib/assetUrl'
import { loadMujocoModule } from '../reach/mujocoLoader'
import type { Manifest, PolicyAsset } from './types'

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

export function scenarioBase(scenario: string): string {
  return assetUrl(`models/${scenario}`)
}

export async function loadPolicy(policy: PolicyAsset, scenario: string, signal?: AbortSignal): Promise<ort.InferenceSession> {
  if (!configured) {
    ort.env.wasm.numThreads = 1
    ort.env.wasm.wasmPaths = { wasm: ortWasmUrl }
    configured = true
  }
  const bytes = await (await fetchChecked(`${scenarioBase(scenario)}/${policy.onnx}`, signal)).arrayBuffer()
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

function normalizeManifest(raw: Manifest, scenario: string): Manifest {
  const isG1 = raw.contract === 'wbo5_raw_102_v1'
  const isH1 = raw.contract === 'h1_2_gait_5cmd_v1'
  const isT1 = raw.contract === 'booster_t1_gym_3cmd_v1'
  const policies = raw.policies.map(policy => policy)
  const actionDim = raw.action_dim ?? policies[0]?.config.action_scale.length
  const commandKind = raw.command_kind ?? (raw.command_ranges.length === 3 ? '3cmd' : '5cmd')
  const stepDt = raw.step_dt ?? .02
  const decimation = raw.decimation ?? Math.max(1, Math.round(stepDt / raw.physics_dt))
  const defaults = raw.command_defaults ?? (
    isG1 ? [.4, 0, 0, .8, .75] :
    isH1 ? [.4, 0, 0, .8, 1.0] :
    isT1 ? [.5, 0, 0] :
    raw.command_ranges.map(range => (range[0] + range[1]) / 2)
  )
  return {
    ...raw,
    id: raw.id ?? scenario,
    label: raw.label ?? (isG1 ? 'Unitree G1' : scenario.toUpperCase()),
    obs_dim: raw.obs_dim ?? (isG1 ? 102 : isH1 ? 94 : isT1 ? 47 : 0),
    action_dim: actionDim,
    step_dt: stepDt,
    decimation,
    command_kind: commandKind,
    action_kind: raw.action_kind ?? 'position',
    command_defaults: defaults,
    force_body: raw.force_body ?? raw.torso_body,
    fallen_height: raw.fallen_height ?? (isT1 ? .45 : isG1 ? .35 : .7),
    policies,
  }
}

export async function loadPhysics(signal: AbortSignal | undefined, scenario = 'locomotion'): Promise<{
  mj: Awaited<ReturnType<typeof loadMujocoModule>>
  model: ReturnType<Awaited<ReturnType<typeof loadMujocoModule>>['MjModel']['from_xml_string']>
  manifest: Manifest
}> {
  const base = scenarioBase(scenario)
  const raw: Manifest = await (await fetchChecked(`${base}/manifest.json`, signal)).json()
  const manifest = normalizeManifest(raw, scenario)
  if (!manifest.contract || manifest.policies.length !== 2 ||
      !manifest.obs_dim || !manifest.action_dim || !manifest.step_dt || !manifest.decimation) {
    throw new Error('Unsupported locomotion bundle')
  }
  const mj = await loadMujocoModule()
  signal?.throwIfAborted()
  const vfs = new mj.MjVFS()
  try {
    const modelBytes = await (await fetchChecked(`${base}/${manifest.model}`, signal)).arrayBuffer()
    await verifyHash(modelBytes, manifest.model_sha256)
    const xml = new TextDecoder().decode(modelBytes)
    // VFS keeps the original visual meshes and collision/inertial model intact.
    for (const mesh of manifest.meshes) {
      const bytes = new Uint8Array(await (await fetchChecked(`${base}/meshes/${mesh}`, signal)).arrayBuffer())
      vfs.addBuffer(`meshes/${mesh}`, bytes)
    }
    const model = mj.MjModel.from_xml_string(xml, vfs)
    const expectedNq = 7 + manifest.action_dim!
    const expectedNv = 6 + manifest.action_dim!
    if (model.nq !== expectedNq || model.nv !== expectedNv || model.nu !== manifest.action_dim ||
        Math.abs(model.opt.timestep - manifest.physics_dt) > 1e-10) {
      model.delete()
      throw new Error('MuJoCo model dimensions/timestep differ from native deployment')
    }
    return { mj, model, manifest }
  } finally {
    vfs.delete()
  }
}
