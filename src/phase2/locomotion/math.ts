import type { Command, DeployConfig, Vec3 } from './types'

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

export function buildObservation(cfg: DeployConfig, q: ArrayLike<number>, v: ArrayLike<number>,
  previous: ArrayLike<number>, command: Command, step: number): Float32Array {
  finite(q, 36); finite(v, 35); finite(previous, 29); finite(command, 5)
  if (command[3] <= 0 || !Number.isSafeInteger(step) || step < 0) throw new Error('Invalid phase clock')
  const obs = new Float32Array(102)
  obs.set([v[3], v[4], v[5]], 0)
  obs.set(inverseRotate([q[3], q[4], q[5], q[6]], [0, 0, -1]), 3)
  obs.set([command[0], command[1], 0, 0, command[2], command[3], command[4]], 6)
  if (Math.hypot(command[0], command[1]) + Math.abs(command[2]) >= .1) {
    const angle = 2 * Math.PI * step * cfg.step_dt / command[3]
    obs.set([Math.sin(angle), Math.cos(angle)], 13)
  }
  cfg.joints.forEach((joint, i) => {
    obs[15 + i] = q[joint.qpos] - cfg.default_joint_pos[i]
    obs[44 + i] = v[joint.dof]
  })
  obs.set(previous, 73)
  return obs
}

export function processAction(cfg: DeployConfig, action: ArrayLike<number>): Float64Array {
  finite(action, 29)
  const target = Float64Array.from(action, (a, i) => a * cfg.action_scale[i] + cfg.action_offset[i])
  finite(target, 29)
  return target
}

export function pdTorques(cfg: DeployConfig, target: ArrayLike<number>, q: ArrayLike<number>, v: ArrayLike<number>): Float64Array {
  finite(target, 29); finite(q, 36); finite(v, 35)
  return Float64Array.from(cfg.joints, (joint, i) => {
    const tau = cfg.stiffness[i] * (target[i] - q[joint.qpos]) - cfg.damping[i] * v[joint.dof]
    return Math.max(-cfg.effort_limit[i], Math.min(cfg.effort_limit[i], tau))
  })
}
