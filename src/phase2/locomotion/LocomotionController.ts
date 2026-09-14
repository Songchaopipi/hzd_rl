import { ASSET_BASE, loadPhysics } from './assets'
import { G1World } from './G1World'
import { G1Scene } from './G1Scene'
import type { Command, LiveState, Vec3 } from './types'

interface Options {
  canvases: [HTMLCanvasElement, HTMLCanvasElement]
  onState: (state: LiveState) => void
}

export class LocomotionController {
  private physics: Awaited<ReturnType<typeof loadPhysics>> | null = null
  private worlds: G1World[] = []
  private scenes: G1Scene[] = []
  private command: Command = [.4, 0, 0, .8, .75]
  private playing = false
  private disposed = false
  private resetting = false
  private raf = 0
  private time = 0
  private lastWall = 0
  private acc = 0
  private reportWall = 0
  private reportTime = 0
  private realTimeFactor = 0
  private status: LiveState['status'] = 'loading'
  private initTask: Promise<void> | null = null
  private stepTask: Promise<void> | null = null
  private pendingPush: { force: Vec3; duration: number } | null = null
  private errorMessage = ''
  private readonly abort = new AbortController()
  private publishedForce = '0,0,0'

  constructor(private readonly options: Options) {
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  init(): Promise<void> {
    if (!this.initTask) this.initTask = this.setup().catch(async error => {
      this.status = 'error'
      this.errorMessage = error instanceof Error ? error.message : String(error)
      this.publish()
      await this.release()
      throw error
    })
    return this.initTask
  }

  private async setup(): Promise<void> {
    this.publish()
    this.physics = await loadPhysics(this.abort.signal)
    if (this.disposed) return
    const { mj, model, manifest } = this.physics
    for (let i = 0; i < 2; i++) {
      const world = new G1World(mj, model, manifest, manifest.policies[i])
      this.worlds.push(world)
      await world.init(this.abort.signal)
      if (this.disposed) return
      const scene = new G1Scene(this.options.canvases[i], i === 0 ? '#c65044' : '#197d84')
      this.scenes.push(scene)
      await scene.load(manifest.visuals, ASSET_BASE)
      if (this.disposed) return
    }
    this.status = 'ready'
    this.draw()
    this.publish()
  }

  setCommand(command: Command): void {
    if (command.some(x => !Number.isFinite(x))) throw new Error('Command must be finite')
    const ranges = this.physics?.manifest.command_ranges ?? [[-1, 2], [-1, 1], [-1, 1], [.5, 1], [.6, .85]]
    this.command = command.map((x, i) => Math.max(ranges[i][0], Math.min(ranges[i][1], x))) as Command
  }

  setPlaying(on: boolean): void {
    if (this.disposed || this.resetting || this.worlds.length !== 2 || this.status === 'loading' || this.status === 'error') return
    this.playing = on
    this.status = on ? 'playing' : 'paused'
    this.lastWall = performance.now()
    this.reportWall = this.lastWall
    this.reportTime = this.time
    this.acc = 0
    if (on && !this.raf && !this.stepTask) this.raf = requestAnimationFrame(this.tick)
    if (!on && this.raf) { cancelAnimationFrame(this.raf); this.raf = 0 }
    this.publish()
  }

  async reset(): Promise<void> {
    if (this.disposed || this.resetting || this.status === 'loading' || this.worlds.length !== 2) return
    this.setPlaying(false)
    this.resetting = true
    try {
      await this.stepTask
      if (this.disposed) return
      for (const world of this.worlds) world.reset()
      for (const scene of this.scenes) scene.resetView()
      this.time = 0
      this.acc = 0
      this.pendingPush = null
      this.realTimeFactor = 0
      this.errorMessage = ''
      this.status = 'ready'
      this.draw()
      this.publish()
    } finally { this.resetting = false }
  }

  push(force: Vec3, duration: number): void {
    if (force.some(x => !Number.isFinite(x)) || Math.hypot(...force) > 200 ||
        !Number.isFinite(duration) || duration < .05 || duration > .5) throw new Error('Invalid force pulse')
    if (!this.playing || this.resetting) return
    // Queue for a common policy boundary, never halfway through one world's inference.
    this.pendingPush = { force: [...force], duration }
  }

  private tick = async (now: number): Promise<void> => {
    this.raf = 0
    if (this.disposed || !this.playing || this.resetting) return
    this.acc = Math.min(.08, this.acc + Math.min(.1, (now - this.lastWall) / 1000))
    this.lastWall = now
    if (this.acc >= .02) {
      const count = Math.min(2, Math.floor(this.acc / .02))
      this.acc -= count * .02
      this.stepTask = this.advance(count)
      try { await this.stepTask } catch (error) {
        this.playing = false
        this.status = 'error'
        this.errorMessage = error instanceof Error ? error.message : String(error)
      } finally { this.stepTask = null }
    }
    if (this.disposed) return
    this.draw()
    const wall = performance.now()
    if (wall - this.reportWall > 200 || !this.playing) {
      this.realTimeFactor = (this.time - this.reportTime) / Math.max(.001, (wall - this.reportWall) / 1000)
      this.reportWall = wall
      this.reportTime = this.time
      this.publish()
    }
    if (this.playing && !this.resetting && !this.raf) this.raf = requestAnimationFrame(this.tick)
  }

  private async advance(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      if (!this.playing || this.disposed || this.resetting) break
      const command: Command = [...this.command]
      if (this.pendingPush) {
        for (const world of this.worlds) world.push(this.pendingPush.force, this.pendingPush.duration)
        this.pendingPush = null
        this.publish()
      }
      for (const world of this.worlds) await world.step(command)
      this.time += .02
      if (this.worlds[0].frame().force.join() !== this.publishedForce) this.publish()
    }
  }

  private draw(): void {
    if (this.worlds.length !== 2 || this.scenes.length !== 2) return
    this.worlds.forEach((world, i) => { this.scenes[i].update(world.frame()); this.scenes[i].render() })
  }

  private publish(): void {
    if (this.disposed) return
    const frames = this.worlds.length === 2 ? this.worlds.map(world => world.frame()) : []
    this.publishedForce = (frames[0]?.force ?? [0, 0, 0]).join()
    this.options.onState({ status: this.status, time: this.time, speed: this.realTimeFactor,
      robots: frames.length === 2 ? frames.map(({ velocity, height, fallen }) => ({ velocity, height, fallen })) as LiveState['robots'] : null,
      force: frames[0]?.force ?? [0, 0, 0], message: this.errorMessage || undefined })
  }

  dispose(): void {
    this.disposed = true
    this.playing = false
    this.abort.abort()
    for (const scene of this.scenes.splice(0)) scene.dispose()
    if (this.raf) cancelAnimationFrame(this.raf)
    document.removeEventListener('visibilitychange', this.onVisibility)
    void Promise.allSettled([this.initTask, this.stepTask]).then(() => this.release())
  }

  private onVisibility = (): void => { if (document.hidden) this.setPlaying(false) }

  private async release(): Promise<void> {
    const worlds = this.worlds.splice(0)
    const scenes = this.scenes.splice(0)
    const physics = this.physics
    this.physics = null
    scenes.forEach(scene => scene.dispose())
    await Promise.allSettled(worlds.map(world => world.dispose()))
    physics?.model.delete()
  }
}
