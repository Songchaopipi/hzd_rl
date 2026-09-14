import { useEffect, useRef, useState } from 'react'
import { Plot, type Point, type Series } from './Plot'
import { Finding } from './shared'

type Spectrum = { eigenvalues: [number | null, number | null][]; spectral_radius: number | null }
type Section = { id: string; samples: { command: (number | null)[]; fixed: Spectrum; measured: Spectrum }[] }

export type OfflineSpectraData = {
  available: boolean
  sections?: Section[]
  scope?: string
}

const COLORS = { fixed: '#BD4254', measured: '#2464AA', outside: '#C026D3', circle: '#78857F' }
const CIRCLE: Point[] = Array.from({ length: 129 }, (_, index) => {
  const angle = index * 2 * Math.PI / 128
  return { x: Math.cos(angle), y: Math.sin(angle) }
})

function FootSpectrum({ section }: { section: Section }) {
  const panel = useRef<HTMLDivElement>(null)
  const [, setWidth] = useState(0)
  useEffect(() => {
    if (!panel.current) return
    // Plot equalizes domains in place; renew its input tuples on resize.
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(panel.current)
    return () => observer.disconnect()
  }, [])
  const fixed: Point[] = [], measured: Point[] = [], outside: Point[] = []
  for (const sample of section.samples) {
    for (const name of ['fixed', 'measured'] as const) {
      for (const [x, y] of sample[name].eigenvalues) {
        if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) continue
        const point = { x, y }
        if (Math.hypot(x, y) > 1) outside.push(point)
        else (name === 'fixed' ? fixed : measured).push(point)
      }
    }
  }
  const series: Series[] = [
    { id: 'unit-circle', label: 'Unit circle', color: COLORS.circle, points: CIRCLE, mode: 'line', dashed: true },
    { id: 'fixed', label: 'Refined fixed point', color: COLORS.fixed, points: fixed, mode: 'scatter' },
    { id: 'measured', label: 'Measured latent', color: COLORS.measured, points: measured, mode: 'scatter' },
    { id: 'outside', label: 'Outside unit circle', color: COLORS.outside, points: outside, mode: 'scatter' },
  ]
  const radii = (name: 'fixed' | 'measured') => section.samples.map(sample => sample[name].spectral_radius)
    .filter((value): value is number => value !== null && Number.isFinite(value))
  const fixedRadii = radii('fixed'), measuredRadii = radii('measured')
  const foot = section.id.startsWith('left') ? 'Left foot' : section.id.startsWith('right') ? 'Right foot' : section.id

  return <div className="plot-panel" ref={panel}>
    <h4>{foot}<span>Learned pre-impact map</span></h4>
    {fixed.length + measured.length + outside.length > 0 ? <Plot series={series.filter(item => item.points.length > 0)}
      xLabel="Real part" yLabel="Imaginary part" equal={true}
      xDomain={[-1.2, 1.2]} yDomain={[-1.2, 1.2]} height={280} />
      : <p className="plot-caption" role="status">No finite eigenvalues in this section.</p>}
    <p className="plot-caption">
      Spectral radius &lt; 1: {fixedRadii.filter(value => value < 1).length}/{fixedRadii.length} refined fixed points;
      {' '}{measuredRadii.filter(value => value < 1).length}/{measuredRadii.length} measured latent states.
      {measuredRadii.length > 0 && <> Largest measured radius: {Math.max(...measuredRadii).toFixed(3)}.</>}
    </p>
  </div>
}

export function OfflineSpectra({ data }: { data: OfflineSpectraData | null | undefined }) {
  const [expanded, setExpanded] = useState(false)
  return <details onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>Learned 24D Poincare spectra</summary>
    {expanded && (data?.available && data.sections?.length ? <>
      <Finding caveat="Measured latent states and refined fixed points are different evaluation points. Fixed-point contraction does not establish contact invariance or contraction along every measured state.">
        Offline learned-map spectra do not establish physical closed-loop stability.
      </Finding>
      <div className="charts-two">{data.sections.map(section => <FootSpectrum key={section.id} section={section} />)}</div>
    </> : <p className="plot-caption" role="status">Saved offline spectra are unavailable.</p>)}
  </details>
}
