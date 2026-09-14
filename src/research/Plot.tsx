import { useEffect, useRef, useState } from 'react'
import { linearScale } from '../components/charts/chartScales'

export type Point = { x: number; y: number; lo?: number; hi?: number; label?: string }
export type Series = { id: string; label: string; color: string; points: Point[]; mode?: 'line' | 'scatter'; dashed?: boolean; faint?: boolean }
const format = (value: number) => Math.abs(value) >= 100 ? value.toFixed(0) : Number(value.toPrecision(3)).toString()

export function Legend({ series, hidden, onToggle }: { series: Series[]; hidden: string[]; onToggle: (id: string) => void }) {
  return <div className="chart-legend">{series.filter(item => !item.faint).map(item => <button key={item.id} type="button" aria-pressed={!hidden.includes(item.id)} onClick={() => onToggle(item.id)}><span style={{ background: item.color }}/>{item.label}</button>)}</div>
}

export function Plot({ series, xLabel, yLabel, xDomain, yDomain, height = 310, equal = false, reference, phase, legend = true }: {
  series: Series[]; xLabel: string; yLabel: string; xDomain?: [number, number]; yDomain?: [number, number]; height?: number;
  equal?: boolean; reference?: { x?: number; y?: number; diagonal?: boolean; label: string }; phase?: number; legend?: boolean
}) {
  const container = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(520)
  const [hidden, setHidden] = useState<string[]>([])
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!container.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)))
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  const m = { left: 54, right: 17, top: 24, bottom: 42 }
  const points = series.flatMap(item => item.points).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
  if (!points.length) return <div className="plot-empty" role="status">No valid samples in this condition.</div>
  const extent = (values: number[]): [number, number] => {
    const low = Math.min(...values), high = Math.max(...values), span = high - low || 1
    return [low - span * .07, high + span * .07]
  }
  const xd = xDomain || extent(points.map(point => point.x))
  const yd = yDomain || extent(points.flatMap(point => [point.lo ?? point.y, point.hi ?? point.y]))
  if (equal) {
    const unit = Math.max((xd[1] - xd[0]) / (width - m.left - m.right), (yd[1] - yd[0]) / (height - m.top - m.bottom))
    const xc = (xd[0] + xd[1]) / 2, yc = (yd[0] + yd[1]) / 2
    xd[0] = xc - unit * (width - m.left - m.right) / 2; xd[1] = xc + unit * (width - m.left - m.right) / 2
    yd[0] = yc - unit * (height - m.top - m.bottom) / 2; yd[1] = yc + unit * (height - m.top - m.bottom) / 2
  }
  const sx = linearScale(xd, [m.left, width - m.right]), sy = linearScale(yd, [height - m.bottom, m.top])
  const ticks = (domain: [number, number]) => Array.from({ length: 5 }, (_, i) => domain[0] + (domain[1] - domain[0]) * i / 4)
  const visible = series.filter(item => !hidden.includes(item.id))
  const nearest = hover ? visible.filter(item => !item.faint).map(item => {
    const point = item.points.reduce((best, p) => {
      const distance = (q: Point) => (sx(q.x) - hover.x) ** 2 + (item.mode === 'scatter' || equal ? (sy(q.y) - hover.y) ** 2 : 0)
      return distance(p) < distance(best) ? p : best
    }, item.points[0])
    return { item, point }
  }).filter(hit => hit.point) : []
  const path = (values: Point[]) => values.map((point, index) => `${index ? 'L' : 'M'}${sx(point.x).toFixed(2)},${sy(point.y).toFixed(2)}`).join(' ')
  return <div className="plot-wrap" ref={container}>
    {legend && <Legend series={series} hidden={hidden} onToggle={id => setHidden(old => old.includes(id) ? old.filter(value => value !== id) : [...old, id])}/>}
    <svg data-chart="true" viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" tabIndex={0} aria-label={`${yLabel} against ${xLabel}`}
      onPointerMove={event => { const rect = event.currentTarget.getBoundingClientRect(); setHover({ x: (event.clientX - rect.left) * width / rect.width, y: (event.clientY - rect.top) * height / rect.height }) }} onPointerLeave={() => setHover(null)}
      onFocus={() => setHover({ x: width / 2, y: height / 2 })} onBlur={() => setHover(null)} onKeyDown={event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setHover(old => ({ x: Math.max(m.left, Math.min(width - m.right, (old?.x ?? width / 2) + (event.key === 'ArrowRight' ? 12 : -12))), y: old?.y ?? height / 2 })) }
      }}>
      <title>{yLabel} against {xLabel}</title>
      {ticks(yd).map((tick, i) => <g key={i}><line className="chart-grid" x1={m.left} x2={width - m.right} y1={sy(tick)} y2={sy(tick)}/><text className="chart-tick" x={m.left - 8} y={sy(tick) + 4} textAnchor="end">{format(tick)}</text></g>)}
      {ticks(xd).map((tick, i) => <g key={i}><text className="chart-tick" x={sx(tick)} y={height - m.bottom + 20} textAnchor="middle">{format(tick)}</text></g>)}
      <text className="chart-axis" x={m.left} y={13}>{yLabel}</text><text className="chart-axis" x={(m.left + width - m.right) / 2} y={height - 5} textAnchor="middle">{xLabel}</text>
      {reference?.diagonal && <line className="chart-reference" x1={sx(Math.max(xd[0], yd[0]))} y1={sy(Math.max(xd[0], yd[0]))} x2={sx(Math.min(xd[1], yd[1]))} y2={sy(Math.min(xd[1], yd[1]))}/>}
      {reference?.y !== undefined && reference.y >= yd[0] && reference.y <= yd[1] && <g><line className="chart-reference" x1={m.left} x2={width - m.right} y1={sy(reference.y)} y2={sy(reference.y)}/><text className="chart-tick" x={width - m.right} y={sy(reference.y) - 6} textAnchor="end">{reference.label}</text></g>}
      {visible.map(item => <g key={item.id} opacity={item.faint ? .20 : 1}>
        {item.points.every(p => p.lo !== undefined && p.hi !== undefined) && <path d={`${path(item.points.map(p => ({ x: p.x, y: p.hi! })))} ${path([...item.points].reverse().map(p => ({ x: p.x, y: p.lo! }))).replace(/^M/, 'L')} Z`} fill={item.color} opacity=".13"/>}
        {item.mode === 'scatter' ? item.points.map((point, i) => <circle key={i} cx={sx(point.x)} cy={sy(point.y)} r={2.8} fill={item.color} opacity=".5"/>) : <path d={path(item.points)} fill="none" stroke={item.color} strokeWidth={item.faint ? 1 : 2.3} strokeDasharray={item.dashed ? '6 4' : undefined} strokeLinejoin="round"/>}
        {phase !== undefined && !item.faint && item.points.length > 0 && (() => { const p = item.points[Math.min(item.points.length - 1, Math.round(phase * (item.points.length - 1)))]; return <circle cx={sx(p.x)} cy={sy(p.y)} r="4.5" fill={item.color} stroke="white" strokeWidth="1.5"/> })()}
      </g>)}
      {nearest.map(({ item, point }) => <circle key={item.id} cx={sx(point.x)} cy={sy(point.y)} r="4.5" fill={item.color} stroke="white" strokeWidth="1.4"/>)}
    </svg>
    {hover && nearest.length > 0 && <div className="chart-tooltip" role="status"><span>{xLabel} / {yLabel}</span>{nearest.map(({ item, point }) => <div key={item.id}><i style={{ background: item.color }}/><b>{item.label}</b><code>{format(point.x)}, {format(point.y)}</code></div>)}</div>}
  </div>
}
