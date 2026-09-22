import type { Command, DeployConfig, Manifest, Vec3 } from './types'

export function inverseRotate(q: ArrayLike<number>, v: ArrayLike<number>): Vec3 {
  const w = q[0], x = -q[1], y = -q[2], z = -q[3]
  const tx = 2 * (y * v[2] - z * v[1])
  const ty = 2 * (z * v[0] - x * v[2])
  const tz = 2 * (x * v[1] - y * v[0])
  return [v[0] + w * tx + y * tz - z * ty,
    v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx]
}

function finite(values: ArrayLike<number>, length: number): void {
  if (values.length !== length || Array.from(values).some(x => !Number.isFinite(x))) {
    throw new Error(`Expected ${length} finite values`)
  }
}

export function buildObservation(
  cfg: DeployConfig,
  manifest: Manifest,
  q: ArrayLike<number>,
  v: ArrayLike<number>,
  previous: ArrayLike<number>,
  command: Command,
  step: number,
): Float32Array {
  const nq = 7 + manifest.action_dim!
  const nv = 6 + manifest.action_dim!
  const nu = manifest.action_dim!
  finite(q, nq)
  finite(v, nv)
  finite(previous, nu)
  finite(command, manifest.command_kind === '3cmd' ? 3 : 5)
  if (!Number.isSafeInteger(step) || step < 0) throw new Error('Invalid phase clock')

  const gravity = inverseRotate([q[3], q[4], q[5], q[6]], [0, 0, -1])
  const baseAngularVelocity = [v[3], v[4], v[5]]
  const obs = new Float32Array(manifest.obs_dim!)

  if (manifest.contract === 'wbo5_raw_102_v1') {
    const period = command[3]
    if (period <= 0) throw new Error('Invalid phase clock')
    obs.set(baseAngularVelocity, 0)
    obs.set(gravity, 3)
    obs.set([command[0], command[1], 0, 0, command[2], command[3], command[4]], 6)
    if (Math.hypot(command[0], command[1]) + Math.abs(command[2]) >= .1) {
      const angle = 2 * Math.PI * step * cfg.step_dt / period
      obs.set([Math.sin(angle), Math.cos(angle)], 13)
    }
    cfg.joints.forEach((joint, i) => {
      obs[15 + i] = q[joint.qpos] - cfg.default_joint_pos[i]
      obs[44 + i] = v[joint.dof]
    })
    obs.set(previous, 73)
    return obs
  }

  if (manifest.contract === 'h1_2_gait_5cmd_v1') {
    const period = command[3]
    if (period <= 0) throw new Error('Invalid phase clock')
    obs.set(baseAngularVelocity, 0)
    obs.set(gravity, 3)
    obs.set([command[0], command[1], command[2]], 6)
    const phaseOffset = 9
    if (Math.hypot(command[0], command[1]) + Math.abs(command[2]) >= .1) {
      const angle = 2 * Math.PI * step * cfg.step_dt / period
      obs.set([Math.sin(angle), Math.cos(angle)], phaseOffset)
    }
    const qOffset = 11
    const vOffset = 11 + nu
    cfg.joints.forEach((joint, i) => {
      obs[qOffset + i] = q[joint.qpos] - cfg.default_joint_pos[i]
      obs[vOffset + i] = v[joint.dof]
    })
    obs.set(previous, vOffset + nu)
    obs.set([command[3], command[4]], vOffset + 2 * nu)
    return obs
  }

  if (manifest.contract === 'booster_t1_gym_3cmd_v1') {
    obs.set(gravity, 0)
    obs.set(baseAngularVelocity, 3)
    obs.set(command, 6)
    const phaseOffset = 9
    if (Math.hypot(command[0], command[1], command[2]) >= .1) {
      const angle = 2 * Math.PI * step * cfg.step_dt / 0.6
      obs.set([Math.sin(angle), Math.cos(angle)], phaseOffset)
    }
    const qOffset = 11
    const vOffset = 11 + nu
    cfg.joints.forEach((joint, i) => {
      obs[qOffset + i] = q[joint.qpos] - cfg.default_joint_pos[i]
      obs[vOffset + i] = 0.1 * v[joint.dof]
    })
    obs.set(previous, vOffset + nu)
    return obs
  }

  throw new Error(`Unsupported observation contract: ${manifest.contract}`)
}

export function processAction(cfg: DeployConfig, action: ArrayLike<number>): Float64Array {
  finite(action, cfg.action_scale.length)
  const target = Float64Array.from(action, (a, i) => a * cfg.action_scale[i] + cfg.action_offset[i])
  finite(target, cfg.action_scale.length)
  return target
}

export function pdTorques(cfg: DeployConfig, target: ArrayLike<number>, q: ArrayLike<number>, v: ArrayLike<number>): Float64Array {
  finite(target, cfg.joints.length)
  finite(q, 7 + cfg.joints.length)
  finite(v, 6 + cfg.joints.length)
  return Float64Array.from(cfg.joints, (joint, i) => {
    const tau = cfg.stiffness[i] * (target[i] - q[joint.qpos]) - cfg.damping[i] * v[joint.dof]
    return Math.max(-cfg.effort_limit[i], Math.min(cfg.effort_limit[i], tau))
  })
}
