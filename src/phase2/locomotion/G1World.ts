import * as ort from 'onnxruntime-web/wasm'
import type { MainModule } from '../reach/mujocoLoader'
import { buildObservation, inverseRotate, processAction, pdTorques } from './math'
import { loadPolicy } from './assets'
import type { Command, Manifest, PolicyAsset, RobotFrame, Vec3 } from './types'

type Model = ReturnType<MainModule['MjModel']['from_xml_string']>
export class G1World {
  readonly data: InstanceType<MainModule['MjData']>
  private session: ort.InferenceSession | null = null
  private previous: Float32Array
  private episodeStep = 0
  private force: Vec3 = [0, 0, 0]
  private forceSteps = 0
  private fallen = false

  constructor(private readonly mj: MainModule, readonly model: Model,
    private readonly manifest: Manifest, private readonly asset: PolicyAsset,
    private readonly scenario: string) {
    const actionDim = manifest.action_dim!
    this.previous = new Float32Array(actionDim)
    if (model.nq !== 7 + actionDim || model.nv !== 6 + actionDim || model.nu !== actionDim) {
      throw new Error('MuJoCo model dimensions differ from manifest action dimension')
    }
    for (let i = 0; i < actionDim; i++) {
      const joint = asset.config.joints[i]
      const id = mj.mj_name2id(model, mj.mjtObj.mjOBJ_JOINT.value, joint.name)
      if (id < 0 || model.jnt_qposadr[id] !== joint.qpos || model.jnt_dofadr[id] !== joint.dof ||
          model.actuator_trnid[2 * i] !== id) throw new Error('Native joint mapping mismatch')
    }
    this.data = new mj.MjData(model)
    this.reset()
  }

  async init(signal?: AbortSignal): Promise<void> { this.session = await loadPolicy(this.asset, this.scenario, signal) }

  reset(): void {
    this.mj.mj_resetData(this.model, this.data)
    this.data.qpos.set(this.asset.config.initial_qpos)
    this.data.qvel.fill(0)
    this.data.ctrl.fill(0)
    this.data.xfrc_applied.fill(0)
    this.previous.fill(0)
    this.episodeStep = 0
    this.forceSteps = 0
    this.force = [0, 0, 0]
    this.fallen = false
    this.mj.mj_forward(this.model, this.data)
  }

  push(force: Vec3, duration: number): void {
    this.force = [...force]
    this.forceSteps = Math.max(1, Math.round(duration / this.manifest.physics_dt))
  }

  async step(command: Command): Promise<void> {
    if (!this.session) throw new Error('Policy not loaded')
    const cfg = this.asset.config
    const obs = buildObservation(cfg, this.manifest, this.data.qpos, this.data.qvel, this.previous, command, this.episodeStep)
    const input = new ort.Tensor('float32', obs, [1, this.manifest.obs_dim!])
    let output: ort.InferenceSession.ReturnType | undefined
    let target: Float64Array
    try {
      output = await this.session.run({ obs: input })
      const action = output.actions.data as Float32Array
      target = processAction(cfg, action)
      this.previous.set(action)
    } finally {
      input.dispose()
      if (output) Object.values(output).forEach(tensor => tensor.dispose())
    }
    // No base/joint pinning. Fixed substep count comes from the manifest.
    for (let sub = 0; sub < this.manifest.decimation!; sub++) {
      this.data.ctrl.set(pdTorques(cfg, target, this.data.qpos, this.data.qvel))
      this.data.xfrc_applied.fill(0)
      if (this.forceSteps > 0) {
        this.data.xfrc_applied.set(this.force, this.manifest.force_body! * 6)
        this.forceSteps--
      }
      this.mj.mj_step(this.model, this.data)
    }
    if (this.forceSteps === 0) {
      this.force = [0, 0, 0]
      this.data.xfrc_applied.fill(0)
    }
    this.episodeStep++
    if (!Array.from(this.data.qpos as Float64Array).every(Number.isFinite)) throw new Error('Nonfinite simulation state')
    if (this.data.qpos[2] < this.manifest.fallen_height!) this.fallen = true
  }

  frame(): RobotFrame {
    // Refresh only kinematic caches for rendering, not dynamics/sensors used by inference.
    this.mj.mj_kinematics(this.model, this.data)
    const q = this.data.qpos, v = this.data.qvel
    const linear = inverseRotate([q[3], q[4], q[5], q[6]], [v[0], v[1], v[2]])
    return { bodyPos: Float64Array.from(this.data.xpos), bodyQuat: Float64Array.from(this.data.xquat),
      base: [q[0], q[1], q[2]], velocity: [linear[0], linear[1], v[5]],
      height: this.data.xpos[3 * this.manifest.force_body! + 2], fallen: this.fallen, force: [...this.force] }
  }

  async dispose(): Promise<void> {
    try { await this.session?.release() } finally {
      this.session = null
      this.data.delete()
    }
  }
}
