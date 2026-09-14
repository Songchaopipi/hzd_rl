import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import type { RobotFrame, Visual } from './types'

interface ModelResources {
  group: THREE.Group
  bodies: Map<number, THREE.Group>
  geometries: Map<string, THREE.BufferGeometry>
  materials: Map<string, THREE.MeshStandardMaterial>
  torso: THREE.Mesh | null
}

interface PendingLoad {
  controller: AbortController
  model: ModelResources
}

export class G1Scene {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200)
  private readonly renderer: THREE.WebGLRenderer
  private readonly controls: OrbitControls
  private readonly observer: ResizeObserver
  private readonly ground: THREE.Mesh
  private readonly keyLight: THREE.DirectionalLight
  private readonly grid: THREE.GridHelper
  private readonly forceArrow: THREE.ArrowHelper
  private readonly bounds = new THREE.Box3()
  private readonly base = new THREE.Vector3()
  private readonly offset = new THREE.Vector3()
  private readonly direction = new THREE.Vector3()
  private readonly right = new THREE.Vector3()
  private readonly up = new THREE.Vector3()
  private readonly corner = new THREE.Vector3()
  private readonly force = new THREE.Vector3()
  private model: ModelResources | null = null
  private pending: PendingLoad | null = null
  private latestFrame: RobotFrame | null = null
  private framed = false
  private disposed = false
  private width = 0
  private height = 0
  private dpr = 0
  private interacting = false

  constructor(private readonly canvas: HTMLCanvasElement, accent: string) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.scene.background = new THREE.Color(0xf1f3f4)
    this.camera.up.set(0, 0, 1)
    this.camera.position.set(2.6, -3.4, 2.1)
    this.controls = new OrbitControls(this.camera, canvas)
    if (matchMedia('(pointer: coarse)').matches) {
      this.controls.enabled = false
      canvas.style.touchAction = 'pan-y'
    }
    this.controls.target.set(0, 0, 0.7)
    this.controls.enableDamping = false
    this.controls.enablePan = false
    this.controls.minPolarAngle = 0.15
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04
    this.controls.minDistance = 1.5
    this.controls.maxDistance = 12
    this.controls.update()

    const ambient = new THREE.HemisphereLight(0xffffff, 0xb9bec2, 1.2)
    ambient.position.set(0, 0, 10)
    const key = this.keyLight = new THREE.DirectionalLight(0xffffff, 2.5)
    key.castShadow = true
    key.shadow.mapSize.set(512, 512)
    Object.assign(key.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: .1, far: 20 })
    key.shadow.normalBias = .015
    key.position.set(4, -5, 8)
    const fill = new THREE.DirectionalLight(0xdde8f1, 1)
    fill.position.set(-4, 3, 5)
    // Lights have world-fixed directions even as the robot travels.
    this.scene.add(ambient, key, key.target, fill, fill.target)
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0xe4e8ea, roughness: 1 }),
    )
    this.ground.position.z = -0.008
    this.ground.receiveShadow = true
    this.grid = new THREE.GridHelper(200, 400, 0xb9c1c5, 0xd0d7da)
    this.grid.rotation.x = Math.PI / 2
    this.grid.position.z = 0.002
    this.forceArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, accent,
    )
    // ArrowHelper shares geometry globally; each compare viewport owns its copies.
    this.forceArrow.line.geometry = this.forceArrow.line.geometry.clone()
    this.forceArrow.cone.geometry = this.forceArrow.cone.geometry.clone()
    this.forceArrow.visible = false
    this.scene.add(this.ground, this.grid, this.forceArrow)
    this.observer = new ResizeObserver(this.onResize)
    this.observer.observe(canvas.parentElement ?? canvas)
    window.addEventListener('resize', this.onResize)
    this.resize()
    this.controls.addEventListener('start', this.onControlStart)
    this.controls.addEventListener('end', this.onControlEnd)
    this.controls.addEventListener('change', this.onControlChange)
  }

  async load(visuals: Visual[], assetBase: string): Promise<void> {
    if (this.disposed) throw new DOMException('Scene disposed', 'AbortError')
    this.cancelPending()
    const model: ModelResources = {
      group: new THREE.Group(), bodies: new Map(), geometries: new Map(),
      materials: new Map(), torso: null,
    }
    const pending: PendingLoad = { controller: new AbortController(), model }
    this.pending = pending
    const { signal } = pending.controller
    const loader = new STLLoader()
    const base = assetBase.replace(/\/+$/, '')
    try {
      await Promise.all([...new Set(visuals.map(visual => visual.mesh))].map(async name => {
        const url = `${base}/meshes/${name}`
        const response = await fetch(url, { signal })
        if (!response.ok) throw new Error(`STL fetch failed (${response.status}): ${url}`)
        const buffer = await response.arrayBuffer()
        signal.throwIfAborted()
        const geometry = loader.parse(buffer)
        model.geometries.set(name, geometry)
        geometry.computeBoundingBox()
        geometry.computeBoundingSphere()
      }))
      signal.throwIfAborted()
      for (const visual of visuals) {
        let body = model.bodies.get(visual.body)
        if (!body) {
          body = new THREE.Group()
          model.bodies.set(visual.body, body)
          model.group.add(body)
        }
        const materialKey = visual.rgba.join(',')
        let material = model.materials.get(materialKey)
        if (!material) {
          const [r, g, b, opacity] = visual.rgba
          material = new THREE.MeshStandardMaterial({
            color: new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace),
            opacity, transparent: opacity < 1, depthWrite: opacity >= 1,
            metalness: 0.12, roughness: 0.65,
          })
          model.materials.set(materialKey, material)
        }
        const mesh = new THREE.Mesh(model.geometries.get(visual.mesh)!, material)
        mesh.position.set(...visual.pos)
        mesh.quaternion.set(visual.quat[1], visual.quat[2], visual.quat[3], visual.quat[0])
        mesh.visible = visual.rgba[3] > 0
        body.add(mesh)
        mesh.castShadow = true
        if (!model.torso && /torso/i.test(visual.mesh)) model.torso = mesh
      }
      if (this.model) this.releaseModel(this.model)
      this.model = model
      this.pending = null
      this.framed = false
      // No bind pose is guessed: wait for actual MuJoCo body transforms.
      model.group.visible = false
      this.scene.add(model.group)
      if (this.latestFrame) this.update(this.latestFrame)
    } catch (error) {
      pending.controller.abort()
      this.releaseModel(model)
      if (this.pending === pending) this.pending = null
      throw error
    }
  }

  update(frame: RobotFrame): void {
    if (this.disposed) return
    this.latestFrame = frame
    this.offset.set(frame.base[0] - this.base.x, frame.base[1] - this.base.y, 0)
    this.camera.position.add(this.offset)
    this.controls.target.add(this.offset)
    this.base.set(...frame.base)
    this.keyLight.position.set(this.base.x + 4, this.base.y - 5, 8)
    this.keyLight.target.position.set(this.base.x, this.base.y, 0)
    this.ground.position.set(this.base.x, this.base.y, -0.008)
    // Snap the finite grid by whole cells so its lines remain world-anchored.
    this.grid.position.set(Math.round(this.base.x * 2) / 2, Math.round(this.base.y * 2) / 2, 0.002)
    if (this.model) {
      for (const [index, body] of this.model.bodies) {
        const p = index * 3
        const q = index * 4
        body.visible = index >= 0 && p + 2 < frame.bodyPos.length && q + 3 < frame.bodyQuat.length
        if (!body.visible) continue
        body.position.fromArray(frame.bodyPos, p)
        body.quaternion.set(frame.bodyQuat[q + 1], frame.bodyQuat[q + 2], frame.bodyQuat[q + 3], frame.bodyQuat[q])
      }
      this.model.group.visible = true
      this.model.group.updateMatrixWorld(true)
      this.bounds.makeEmpty()
      this.model.group.traverseVisible(object => {
        if (object instanceof THREE.Mesh && object.geometry.boundingBox) {
          this.bounds.union(this.scratchBounds.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld))
        }
      })
      if (!this.framed && !this.bounds.isEmpty()) {
        this.framed = true
        this.resetView()
      }
    }

    this.force.set(...frame.force)
    const magnitude = this.force.length()
    this.forceArrow.visible = Number.isFinite(magnitude) && magnitude > 0
    if (this.forceArrow.visible) {
      if (this.model?.torso?.parent?.visible) {
        const torso = this.model.torso
        torso.geometry.boundingBox!.getCenter(this.forceArrow.position)
        this.forceArrow.position.applyMatrix4(torso.matrixWorld)
      } else {
        this.forceArrow.position.copy(this.base)
        this.forceArrow.position.z += 0.25
      }
      this.forceArrow.setDirection(this.force.divideScalar(magnitude))
      const length = THREE.MathUtils.clamp(magnitude * 0.004, 0.12, 0.85)
      this.forceArrow.setLength(length, Math.min(0.12, length * 0.3), Math.min(0.06, length * 0.15))
    }
    this.fitView()
  }

  private readonly scratchBounds = new THREE.Box3()

  private fitView(reset = false): void {
    this.controls.update()
    if (this.bounds.isEmpty()) return
    this.direction.subVectors(this.camera.position, this.controls.target).normalize()
    this.right.crossVectors(this.camera.up, this.direction).normalize()
    this.up.crossVectors(this.direction, this.right).normalize()
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    const tanH = tanV * this.camera.aspect
    let distance = 0.3
    // Fit every world-space bounding-box corner, including perspective depth.
    // Only retreat when necessary; never track height or filter the robot pose.
    for (let i = 0; i < 8; i++) {
      this.corner.set(
        i & 1 ? this.bounds.max.x : this.bounds.min.x,
        i & 2 ? this.bounds.max.y : this.bounds.min.y,
        i & 4 ? this.bounds.max.z : this.bounds.min.z,
      ).sub(this.controls.target)
      const depth = this.corner.dot(this.direction)
      distance = Math.max(distance, depth + 1.12 * Math.max(
        Math.abs(this.corner.dot(this.right)) / tanH,
        Math.abs(this.corner.dot(this.up)) / tanV,
      ), depth + this.camera.near * 2)
    }
    this.controls.minDistance = distance
    this.controls.maxDistance = Math.max(12, distance * 4)
    const current = this.camera.position.distanceTo(this.controls.target)
    if (reset || current < distance) {
      this.camera.position.copy(this.controls.target).addScaledVector(this.direction, distance * (reset ? 1.04 : 1))
    }
    this.camera.far = Math.max(200, this.controls.maxDistance + this.bounds.getSize(this.corner).length() * 2)
    this.camera.updateProjectionMatrix()
    this.controls.update()
  }

  render(): void {
    if (this.disposed) return
    this.resize()
    this.fitView()
    this.renderer.render(this.scene, this.camera)
  }

  resize(): void {
    if (this.disposed) return
    const parent = this.canvas.parentElement
    const width = Math.max(1, parent?.clientWidth ?? this.canvas.clientWidth)
    const height = Math.max(1, parent?.clientHeight ?? this.canvas.clientHeight)
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    if (width === this.width && height === this.height && dpr === this.dpr) return
    this.width = width
    this.height = height
    this.dpr = dpr
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.fitView()
  }

  resetView(): void {
    if (this.disposed) return
    const z = this.bounds.isEmpty() ? 0.7 : (this.bounds.min.z + this.bounds.max.z) / 2
    this.controls.target.set(this.base.x, this.base.y, z)
    this.camera.position.copy(this.controls.target).add(this.offset.set(2.6, -3.4, 1.4))
    this.fitView(true)
  }

  private readonly onControlStart = (): void => { this.interacting = true }
  private readonly onControlEnd = (): void => { this.interacting = false }
  private readonly onControlChange = (): void => {
    if (this.interacting && !this.disposed) this.renderer.render(this.scene, this.camera)
  }
  private readonly onResize = (): void => {
    this.resize()
    if (!this.disposed) this.renderer.render(this.scene, this.camera)
  }

  private releaseModel(model: ModelResources): void {
    model.group.removeFromParent()
    model.group.clear()
    model.bodies.clear()
    model.geometries.forEach(geometry => geometry.dispose())
    model.materials.forEach(material => material.dispose())
    model.geometries.clear()
    model.materials.clear()
    model.torso = null
  }

  private cancelPending(): void {
    if (!this.pending) return
    this.pending.controller.abort()
    this.releaseModel(this.pending.model)
    this.pending = null
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.observer.disconnect()
    window.removeEventListener('resize', this.onResize)
    this.controls.removeEventListener('start', this.onControlStart)
    this.controls.removeEventListener('end', this.onControlEnd)
    this.controls.removeEventListener('change', this.onControlChange)
    this.controls.dispose()
    this.cancelPending()
    if (this.model) this.releaseModel(this.model)
    this.model = null
    this.latestFrame = null
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        geometries.add(object.geometry)
        const list = Array.isArray(object.material) ? object.material : [object.material]
        list.forEach(material => materials.add(material))
      }
    })
    geometries.forEach(geometry => geometry.dispose())
    materials.forEach(material => material.dispose())
    this.keyLight.shadow.dispose()
    this.scene.clear()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }
}
