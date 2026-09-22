import { useEffect, useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { LoaderCircle, Pause, Play, RotateCcw, Square, Wind } from 'lucide-react'
import type { LocomotionController } from './LocomotionController'
import type { Command, CommandField, LiveState, Vec3 } from './types'
import './locomotion.css'

const DIRECTIONS: Record<string, Vec3> = {
  '+X': [1, 0, 0], '-X': [-1, 0, 0], '+Y': [0, 1, 0], '-Y': [0, -1, 0],
}
type Phase = 'idle' | 'loading' | 'ready' | 'resetting' | 'failed'

export interface LocomotionDemoProps {
  scenario: string
  label: string
  policyLabels: [string, string]
  initialCommand: Command
  commandFields: CommandField[]
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function measured(value: number | undefined, digits = 2): string {
  return value !== undefined && Number.isFinite(value) ? value.toFixed(digits) : '--'
}

function NumericControl({ label, unit, min, max, step, value, disabled, onChange }: {
  label: string; unit: string; min: number; max: number; step: number
  value: number; disabled: boolean; onChange: (value: number) => void
}) {
  const id = useId()
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const number = Number(draft)
    if (!draft.trim() || !Number.isFinite(number)) {
      setDraft(String(value))
      return
    }
    const bounded = Math.min(max, Math.max(min, number))
    const next = Number((min + Math.round((bounded - min) / step) * step).toFixed(3))
    setDraft(String(next))
    if (!disabled) onChange(next)
  }
  return (
    <div className="locomotion-control">
      <label htmlFor={id}>{label} <span>{unit}</span></label>
      <input id={id} type="number" min={min} max={max} step={step} value={draft}
        disabled={disabled} onChange={event => setDraft(event.target.value)} onBlur={commit}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} />
      <input type="range" aria-label={`${label} (${unit})`} min={min} max={max} step={step}
        value={value} disabled={disabled} onChange={event => {
          const next = Number(event.target.value)
          setDraft(String(next))
          onChange(next)
        }} />
    </div>
  )
}

export function LocomotionDemo({ scenario, label, policyLabels, initialCommand, commandFields }: LocomotionDemoProps) {
  const teacherCanvas = useRef<HTMLCanvasElement>(null)
  const tubeCanvas = useRef<HTMLCanvasElement>(null)
  const controller = useRef<LocomotionController | null>(null)
  const generation = useRef(0)
  const mounted = useRef(false)
  const busy = useRef(false)
  const playingRef = useRef(false)
  const commandRef = useRef<Command>([...initialCommand])
  const [command, setCommand] = useState<Command>([...initialCommand])
  const [phase, setPhase] = useState<Phase>('idle')
  const [live, setLive] = useState<LiveState | null>(null)
  const [error, setError] = useState('')
  const [canvasKey, setCanvasKey] = useState(0)
  const [direction, setDirection] = useState('+X')
  const [magnitude, setMagnitude] = useState(80)
  const [duration, setDuration] = useState(0.2)
  const directionId = useId()

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      generation.current += 1
      const current = controller.current
      controller.current = null
      current?.dispose()
    }
  }, [])

  const launch = async () => {
    if (busy.current || !mounted.current) return
    busy.current = true
    const token = ++generation.current
    const isCurrent = () => mounted.current && token === generation.current
    setPhase('loading')
    setError('')
    setLive(null)
    playingRef.current = false
    const previous = controller.current
    controller.current = null
    try {
      previous?.dispose()
      flushSync(() => setCanvasKey(token))
      const { LocomotionController: Controller } = await import('./LocomotionController')
      if (!isCurrent()) return
      const first = teacherCanvas.current
      const second = tubeCanvas.current
      if (!first || !second) throw new Error('Simulation canvases are unavailable.')
      let instance: LocomotionController | null = null
      instance = new Controller({ scenario, initialCommand: [...commandRef.current], canvases: [first, second], onState: (state: LiveState) => {
        if (!isCurrent() || !instance || controller.current !== instance) return
        playingRef.current = state.status === 'playing'
        setLive(state)
      } })
      controller.current = instance
      await instance.init()
      if (!isCurrent() || controller.current !== instance) return
      instance.setCommand([...commandRef.current])
      instance.setPlaying(true)
      playingRef.current = true
      setLive(state => state ? { ...state, status: 'playing' } : state)
      setPhase('ready')
    } catch (cause) {
      if (!isCurrent()) return
      const failed = controller.current
      controller.current = null
      try { failed?.dispose() } catch { /* Preserve the initialization error. */ }
      setError(message(cause))
      setPhase('failed')
    } finally {
      if (isCurrent()) busy.current = false
    }
  }

  const ready = phase === 'ready' && live?.status !== 'error'
  const playing = ready && live?.status === 'playing'
  const locked = phase === 'loading' || phase === 'resetting' || phase === 'failed' || live?.status === 'error'
  const applyCommand = (next: Command) => {
    if (busy.current || locked) return
    try {
      controller.current?.setCommand([...next])
      commandRef.current = next
      setCommand(next)
      setError('')
    } catch (cause) { setError(message(cause)) }
  }
  const togglePlaying = () => {
    if (busy.current || !ready || !controller.current) return
    try {
      const next = !playingRef.current
      controller.current.setPlaying(next)
      playingRef.current = next
      setLive(state => state ? { ...state, status: next ? 'playing' : 'paused' } : state)
      setError('')
    } catch (cause) { setError(message(cause)) }
  }
  const reset = async () => {
    const instance = controller.current
    if (busy.current || !ready || !instance) return
    busy.current = true
    const token = generation.current
    const isCurrent = () => mounted.current && token === generation.current && controller.current === instance
    const resume = playingRef.current
    setPhase('resetting')
    setError('')
    try {
      instance.setPlaying(false)
      playingRef.current = false
      await instance.reset()
      if (!isCurrent()) return
      instance.setCommand([...commandRef.current])
      instance.setPlaying(resume)
      playingRef.current = resume
      setLive(state => state ? { ...state, status: resume ? 'playing' : 'paused' } : state)
      setPhase('ready')
    } catch (cause) {
      if (!isCurrent()) return
      setError(message(cause))
      setPhase('failed')
    } finally {
      if (isCurrent()) busy.current = false
    }
  }
  const push = () => {
    if (busy.current || !ready || !playingRef.current || !controller.current) return
    try {
      const axis = DIRECTIONS[direction]
      controller.current.push([axis[0] * magnitude, axis[1] * magnitude, axis[2] * magnitude], duration)
      setError('')
    } catch (cause) { setError(message(cause)) }
  }
  const failed = phase === 'failed' || live?.status === 'error'
  const status = failed ? 'Error' : phase === 'idle' ? 'Not launched' : phase === 'loading' ? 'Loading'
    : phase === 'resetting' ? 'Resetting' : playing ? 'Playing' : 'Paused'

  return (
    <section className="locomotion-demo" aria-label="HZD locomotion comparison" aria-busy={busy.current}>
      <header className="locomotion-toolbar">
        <div className="locomotion-title"><h2>{label}</h2><span role="status">{status}</span></div>
        <div className="locomotion-clock">
          <span>Sim time <b>{measured(live?.time)} s</b></span>
          <span>Speed <b>{measured(live?.speed)} x</b></span>
        </div>
        <div className="locomotion-actions">
          {(phase === 'idle' || phase === 'loading' || failed) && (
            <button type="button" className="locomotion-launch" onClick={() => void launch()} disabled={busy.current}>
              {phase === 'loading' ? <LoaderCircle className="locomotion-spinner" size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}
              {phase === 'loading' ? 'Loading' : failed ? 'Retry' : 'Launch'}
            </button>
          )}
          <button type="button" title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause' : 'Play'}
            disabled={!ready} onClick={togglePlaying}>
            {playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
          </button>
          <button type="button" title="Reset both worlds" aria-label="Reset both worlds" disabled={!ready} onClick={() => void reset()}>
            <RotateCcw size={18} aria-hidden="true" />
          </button>
          <button type="button" title="Stop command" aria-label="Stop command" disabled={!ready}
            onClick={() => applyCommand(commandRef.current.map((_, index) => index < 3 ? 0 : commandRef.current[index]))}>
            <Square size={17} aria-hidden="true" />
          </button>
        </div>
      </header>

      {(error || live?.message) && <div className="locomotion-message" role={error || failed ? 'alert' : 'status'}>{error || live?.message}</div>}

      <div className="locomotion-worlds">
        {policyLabels.map((label, index) => {
          const robot = live?.robots?.[index]
          return (
            <section key={label} className={`locomotion-world locomotion-world--${index === 0 ? 'teacher' : 'tube'}`} aria-label={label}>
              <div className="locomotion-world-heading">
                <div className="locomotion-world-identity">
                  <span className="locomotion-policy-role">{index === 0 ? 'TEACHER / BASELINE' : 'HZD-TUBE / OURS'}</span>
                  <h3>{label}</h3>
                </div>
                <span className={robot?.fallen ? 'locomotion-fallen' : 'locomotion-world-state'} role="status">
                  {robot ? robot.fallen ? 'Fallen' : 'Upright' : 'No measurement'}
                </span>
              </div>
              <div className="locomotion-viewport">
                <canvas key={canvasKey} ref={index === 0 ? teacherCanvas : tubeCanvas} aria-label={`${label} simulation`} />
                {!live?.robots && <span className="locomotion-placeholder">{phase === 'loading' ? 'Loading simulation' : failed ? 'Unavailable' : 'Not launched'}</span>}
              </div>
              <dl className="locomotion-readouts">
                <div><dt>vx <span>m/s</span></dt><dd>{measured(robot?.velocity[0])}</dd></div>
                <div><dt>vy <span>m/s</span></dt><dd>{measured(robot?.velocity[1])}</dd></div>
                <div><dt>wz <span>rad/s</span></dt><dd>{measured(robot?.velocity[2])}</dd></div>
                <div><dt>Torso height <span>m</span></dt><dd>{measured(robot?.height)}</dd></div>
              </dl>
            </section>
          )
        })}
      </div>

      <section className="locomotion-command" aria-label="Shared command">
        <h3>Shared Command</h3>
        <div className={`locomotion-command-grid locomotion-command-grid--${commandFields.length}`}>
          {commandFields.map((field, index) => <NumericControl key={field.label} {...field} value={command[index]}
            disabled={locked} onChange={value => {
              const next: Command = [...commandRef.current]
              next[index] = value
              applyCommand(next)
            }} />)}
        </div>
      </section>

      <section className="locomotion-push" aria-label="Shared perturbation">
        <div className="locomotion-push-heading">
          <h3>Shared Perturbation</h3>
          <span>Force [X, Y, Z] <b>{live ? live.force.map(value => measured(value, 0)).join(', ') : '--, --, --'} N</b></span>
        </div>
        <div className="locomotion-push-grid">
          <div className="locomotion-direction">
            <label htmlFor={directionId}>Direction</label>
            <select id={directionId} value={direction} disabled={locked} onChange={event => setDirection(event.target.value)}>
              {Object.keys(DIRECTIONS).map(axis => <option key={axis} value={axis}>{axis}</option>)}
            </select>
          </div>
          <NumericControl label="Magnitude" unit="N" min={0} max={200} step={1} value={magnitude} disabled={locked} onChange={setMagnitude} />
          <NumericControl label="Duration" unit="s" min={0.05} max={0.5} step={0.01} value={duration} disabled={locked} onChange={setDuration} />
          <button type="button" className="locomotion-push-button" title="Apply the same force to both worlds" disabled={!playing} onClick={push}>
            <Wind size={18} aria-hidden="true" /> Push Both
          </button>
        </div>
      </section>
    </section>
  )
}

export default LocomotionDemo
