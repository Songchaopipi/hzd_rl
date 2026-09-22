import { useState } from 'react'
import { LocomotionDemo, type LocomotionDemoProps } from './LocomotionDemo'

type GalleryScenario = LocomotionDemoProps & { id: string; short: string }

const SCENARIOS: GalleryScenario[] = [
  {
    id: 'g1',
    short: 'G1',
    scenario: 'locomotion',
    label: 'Unitree G1',
    policyLabels: ['G1 Teacher', 'G1 HZD-Tube'],
    initialCommand: [0.4, 0, 0, 0.8, 0.75],
    commandFields: [
      { label: 'vx', unit: 'm/s', min: -1, max: 2, step: 0.1 },
      { label: 'vy', unit: 'm/s', min: -1, max: 1, step: 0.1 },
      { label: 'wz', unit: 'rad/s', min: -1, max: 1, step: 0.1 },
      { label: 'T', unit: 's', min: 0.5, max: 1, step: 0.05 },
      { label: 'Torso height', unit: 'm', min: 0.6, max: 0.85, step: 0.01 },
    ],
  },
  {
    id: 'h1',
    short: 'H1-2',
    scenario: 'h1',
    label: 'Unitree H1-2',
    policyLabels: ['H1-2 Teacher', 'H1-2 HZD-Tube'],
    initialCommand: [0.4, 0, 0, 0.8, 1.0],
    commandFields: [
      { label: 'vx', unit: 'm/s', min: -1, max: 2, step: 0.1 },
      { label: 'vy', unit: 'm/s', min: -1, max: 1, step: 0.1 },
      { label: 'wz', unit: 'rad/s', min: -1, max: 1, step: 0.1 },
      { label: 'T', unit: 's', min: 0.5, max: 1, step: 0.05 },
      { label: 'Torso height', unit: 'm', min: 0.85, max: 1.05, step: 0.01 },
    ],
  },
  {
    id: 't1',
    short: 'T1',
    scenario: 't1',
    label: 'Booster T1',
    policyLabels: ['T1 Teacher', 'T1 HZD-Tube'],
    initialCommand: [0.5, 0, 0],
    commandFields: [
      { label: 'vx', unit: 'm/s', min: -1, max: 1, step: 0.1 },
      { label: 'vy', unit: 'm/s', min: -1, max: 1, step: 0.1 },
      { label: 'wz', unit: 'rad/s', min: -1, max: 1, step: 0.1 },
    ],
  },
]

export default function LocomotionGallery() {
  const [activeId, setActiveId] = useState(SCENARIOS[0].id)
  const active = SCENARIOS.find(item => item.id === activeId) ?? SCENARIOS[0]

  return (
    <section className="locomotion-gallery" aria-label="Selectable humanoid locomotion simulation">
      <div className="locomotion-scenarios" role="tablist" aria-label="Robot scenarios">
        {SCENARIOS.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === active.id}
            className={`locomotion-scenario${item.id === active.id ? ' is-active' : ''}`}
            onClick={() => setActiveId(item.id)}
          >
            {item.short}
          </button>
        ))}
      </div>
      <LocomotionDemo key={active.id} {...active} />
    </section>
  )
}
