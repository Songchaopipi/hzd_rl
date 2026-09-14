export type Command = [number, number, number, number, number]
export type Vec3 = [number, number, number]
export interface Visual {
  body: number
  mesh: string
  pos: Vec3
  quat: [number, number, number, number]
  rgba: [number, number, number, number]
}
export interface DeployConfig {
  default_joint_pos: number[]
  stiffness: number[]
  damping: number[]
  effort_limit: number[]
  action_scale: number[]
  action_offset: number[]
  step_dt: number
  initial_qpos: number[]
  joints: { name: string; qpos: number; dof: number }[]
}
export interface PolicyAsset {
  id: 'teacher' | 'tube'
  label: string
  onnx: string
  sha256: string
  config: DeployConfig
  source: string
}
export interface Manifest {
  model_sha256: string
  contract: string
  physics_dt: number
  native_version: string
  command_ranges: [number, number][]
  model: string
  meshes: string[]
  visuals: Visual[]
  torso_body: number
  policies: PolicyAsset[]
}
export interface RobotFrame {
  bodyPos: Float64Array
  bodyQuat: Float64Array
  base: Vec3
  velocity: Vec3
  height: number
  fallen: boolean
  force: Vec3
}
export interface Readout {
  velocity: Vec3
  height: number
  fallen: boolean
}
export interface LiveState {
  status: 'loading' | 'ready' | 'playing' | 'paused' | 'error'
  time: number
  speed: number
  robots: [Readout, Readout] | null
  force: Vec3
  message?: string
}
