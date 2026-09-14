import { useState, type ReactNode } from 'react'
import { Plot, type Series } from './Plot'
import { DataState, FigureLinks, Finding, Tabs, useJson } from './shared'
import { RecoveryEvidence } from './Recovery'
import { OfflineSpectra } from './Spectra'

type Band = { median: number[]; q25: number[]; q75: number[] }
type OrbitCondition = { value: number; lines: { seed: number; group: number; representative: boolean; converged: boolean; xy: number[][] }[]; phase_distance: Band }
type Sweep = { id: string; label: string; unit: string; conditions: OrbitCondition[] }
type OrbitData = { dimensions: { latent_dim: number; phase: number[]; sweeps: Sweep[] }[]; offline_poincare: Parameters<typeof OfflineSpectra>[0]['data'] }
type SaturationData = { models: { id: string; label: string; curve: Band & { physical_median: number[] }; radial_gain: { interval: number[]; values: number[] }[]; calibration: { points: number[][]; spearman: number } }[] }
type TrackingData = { commands: number[][]; policies: { id: string; label: string; actual_mean: number[][]; full_time_rmse: number[][] }[] }
const COLORS = ['#3e658c', '#368b9b', '#568d68', '#ad9137', '#cf753f', '#b74e5d', '#805996', '#564458']
const POLICIES: Record<string, string> = { teacher: '#4b6ea8', orbit_only: '#b64d64', orbit_tube: '#14857b' }
const PREFIX = 'hzd/evidence/'

function Heading({ number, title, description, data, figure }: { number: string; title: string; description: string; data: string; figure?: string }) {
  return <div className="experiment-top"><div><p className="eyebrow">Evidence / {number}</p><h3>{title}</h3><p>{description}</p></div><FigureLinks data={PREFIX + data} figure={figure ? PREFIX + figure : undefined}/></div>
}
function Panel({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return <div className="plot-panel"><h4>{title}</h4>{children}{note && <p className="plot-caption">{note}</p>}</div>
}
function quantile(sorted: number[], p: number) {
  const index = (sorted.length - 1) * p, lo = Math.floor(index)
  return sorted[lo] + (sorted[Math.min(sorted.length - 1, lo + 1)] - sorted[lo]) * (index - lo)
}
function DistributionPlot({ rows, unit, label, reference }: { rows: { label: string; color: string; values: number[] }[]; unit: string; label: string; reference?: number }) {
  const [selected, setSelected] = useState<string | null>(null)
  const validRows = rows.map(row => ({ ...row, values: row.values.filter(Number.isFinite).sort((a, b) => a - b) }))
  const all = validRows.flatMap(row => row.values)
  const lo = Math.min(0, ...all), hi = Math.max(...all, reference ?? 0) * 1.02 || 1
  const x = (value: number) => 115 + (value - lo) / (hi - lo) * 380
  return <div className="distribution-plot"><svg data-chart="true" viewBox="0 0 530 300" role="img" aria-label={label}>
    <title>{label}</title>
    {Array.from({ length: 5 }, (_, i) => { const value = lo + (hi - lo) * i / 4; return <g key={i}><line x1={x(value)} x2={x(value)} y1={22} y2={245} className="chart-grid"/><text x={x(value)} y={266} textAnchor="middle" className="chart-tick">{Number(value.toPrecision(2))}</text></g> })}
    {reference !== undefined && <line x1={x(reference)} x2={x(reference)} y1={22} y2={245} className="chart-reference"/>}
    {validRows.map((row, index) => {
      if (!row.values.length) return null
      const y = 50 + index * (175 / Math.max(1, rows.length - 1)), q1 = quantile(row.values, .25), q2 = quantile(row.values, .5), q3 = quantile(row.values, .75)
      return <g key={row.label} tabIndex={0} role="button" aria-label={`${row.label}, median ${q2.toPrecision(3)} ${unit}`} onFocus={() => setSelected(row.label)} onBlur={() => setSelected(null)} onPointerEnter={() => setSelected(row.label)} onPointerLeave={() => setSelected(null)}>
        <text x={105} y={y + 4} textAnchor="end" className="distribution-label">{row.label}</text>
        {row.values.map((value, i) => <circle key={i} cx={x(value)} cy={y - 10 + ((i * 137) % 31 - 15) * .55} r={1.7} fill={row.color} opacity={.25}/>)}
        <line x1={x(quantile(row.values, .05))} x2={x(quantile(row.values, .95))} y1={y + 16} y2={y + 16} stroke={row.color}/>
        <rect x={x(q1)} width={Math.max(1, x(q3) - x(q1))} y={y + 10} height={12} fill={row.color} opacity={.65}/>
        <line x1={x(q2)} x2={x(q2)} y1={y + 8} y2={y + 24} stroke={row.color} strokeWidth={3}/>
        {selected === row.label && <text x={115} y={y - 29} className="distribution-label" fill={row.color}>median {q2.toPrecision(3)} | IQR {q1.toPrecision(2)} - {q3.toPrecision(2)}</text>}
      </g>
    })}
    <text x={305} y={292} textAnchor="middle" className="chart-axis">{label}{unit ? ` (${unit})` : ''}</text>
  </svg><p className="plot-caption">Samples, interquartile boxes and 5th-95th percentile whiskers.</p></div>
}

function OrbitEvidence() {
  const request = useJson<OrbitData>(PREFIX + 'orbits.json')
  const [dimension, setDimension] = useState('24')
  const [phase, setPhase] = useState(0)
  const [distanceSweep, setDistanceSweep] = useState('vx')
  const model = request.data?.dimensions.find(item => item.latent_dim === Number(dimension))
  const distanceModel = request.data?.dimensions.find(item => item.latent_dim === 24)
  const selected = distanceModel?.sweeps.find(item => item.id === distanceSweep)
  return <section id="orbit-family" className="experiment">
    <Heading number="01" title="A family of motion, not a single trajectory" description="Frozen latent dynamics, six command sweeps, eight initial states and 100 burn-in cycles. Curves retain the saved representative outcomes rather than averaging different orbits." data="orbits.json" figure={`latent${dimension}_orbit_family.pdf`}/>
    <div className="experiment-controls"><Tabs label="Latent dimension" options={['8', '16', '20', '24'].map(value => ({ value, label: `${value}D` }))} value={dimension} onChange={setDimension}/><div className="control-group"><label>Phase <input aria-label="Orbit phase" type="range" min="0" max="1" step="0.01" value={phase} onChange={event => setPhase(Number(event.target.value))}/><output>{phase.toFixed(2)}</output></label></div></div>
    {!model ? <DataState {...request}/> : <div className="charts-three">{model.sweeps.map((sweep, index) => {
      const series: Series[] = sweep.conditions.flatMap((condition, c) => condition.lines.map((line, lineIndex) => ({
        id: `${condition.value}-${lineIndex}`, label: `${condition.value} ${sweep.unit}${condition.lines.length > 1 ? ` / ${line.group + 1}` : ''}`,
        color: COLORS[c % COLORS.length], faint: !line.representative && line.converged, dashed: !line.converged,
        points: line.xy.map(point => ({ x: point[0], y: point[1] })),
      })))
      return <Panel key={sweep.id} title={`${String(index + 1).padStart(2, '0')} / ${sweep.label}`}><Plot series={series} xLabel="PC 1" yLabel="PC 2" height={245} equal phase={phase}/></Panel>
    })}</div>}
    <Finding caveat="PCA is fitted separately in each panel. A 2D crossing does not imply that the full latent orbit intersects or fails to converge.">Commands change the orbit geometry. The 8D projection has a distinct crossed shape, while some higher-dimensional conditions retain multiple initial-state outcomes.</Finding>
    {selected && distanceModel && <div className="phase-distance-detail"><div className="experiment-controls"><h4>24D / Phase-resolved orbit distance</h4><div className="control-group"><label>Sweep<select value={distanceSweep} onChange={event => setDistanceSweep(event.target.value)} aria-label="Distance command">{distanceModel.sweeps.map(sweep => <option key={sweep.id} value={sweep.id}>{sweep.label}</option>)}</select></label></div></div><Plot xLabel="Gait phase" yLabel="Latent RMS to center command" height={285} xDomain={[0, 1]} series={selected.conditions.map((condition, index) => ({ id: `${condition.value}`, label: `${condition.value} ${selected.unit}`, color: COLORS[index % COLORS.length], points: distanceModel.phase.map((p, i) => ({ x: p, y: condition.phase_distance.median[i], lo: condition.phase_distance.q25[i], hi: condition.phase_distance.q75[i] })) }))}/><p className="plot-caption">Each seed is compared with the same seed and phase at the center command. Shading is the interquartile range across eight initial states. Distance is not constant around the cycle.</p></div>}
    {request.data && <OfflineSpectra data={request.data.offline_poincare}/>}
  </section>
}

function SaturationEvidence() {
  const request = useJson<SaturationData>(PREFIX + 'saturation.json')
  const [view, setView] = useState('gain')
  const models = request.data?.models
  const colors = ['#b57725', '#a54c76']
  return <section id="distance-evidence" className="experiment">
    <Heading number="02" title="Why latent tracking alone is not enough" description="Controlled offsets and stochastic rollouts expose how a large physical deviation can be compressed into a narrow range of latent distances." data="saturation.json" figure="why_latent_tracking_fails.pdf"/>
    {!models ? <DataState {...request}/> : <>
      <div className="charts-two"><Panel title="Physical deviation vs. latent distance" note="Median and IQR across controlled perturbations. Historical 12-joint/16D and 23-joint/24D models."><Plot xLabel="Normalized physical distance" yLabel="Latent RMS" xDomain={[0, 4.05]} series={models.map((model, index) => ({ id: model.id, label: model.label, color: colors[index], points: model.curve.physical_median.map((x, i) => ({ x, y: model.curve.median[i], lo: model.curve.q25[i], hi: model.curve.q75[i] })) }))}/></Panel>
      <div className="plot-panel"><Tabs label="Distance diagnostic" value={view} onChange={setView} options={[{ value: 'gain', label: 'Far-field sensitivity' }, { value: 'rollout', label: 'Real rollout calibration' }]}/>
        {view === 'gain' ? <DistributionPlot label="Sensitivity relative to local reference" unit="" reference={1} rows={models.map((model, i) => ({ label: i === 0 ? '12 joints' : '23 joints', color: colors[i], values: model.radial_gain.find(gain => gain.interval[0] === 3)!.values }))}/> : <Plot xLabel="Physical distance in rollout" yLabel="Latent RMS in rollout" series={models.map((model, index) => ({ id: model.id, label: model.label, color: colors[index], mode: 'scatter', points: model.calibration.points.map(p => ({ x: p[0], y: p[1] })) }))}/>}
      </div></div>
      <div className="metric-strip"><div><b>8.4%</b><span>12-joint far-field sensitivity</span></div><div><b>8.8%</b><span>23-joint far-field sensitivity</span></div><div><b>3 → 4</b><span>Physical offset interval</span></div></div>
      <Finding caveat="Both historical models saturate. Their joint sets and training stages differ, so this is not an isolated latent-width ablation.">Far from the data, increasing physical error barely changes the latent distance. Decoded physical distance supplies an additional error signal that a narrower latent reward cannot recover.</Finding>
    </>}
  </section>
}

function TrackingEvidence() {
  const request = useJson<TrackingData>(PREFIX + 'tracking.json')
  const [axis, setAxis] = useState('vx')
  const index = ['vx', 'vy', 'wz'].indexOf(axis)
  const data = request.data, unit = axis === 'wz' ? 'rad/s' : 'm/s'
  return <section id="tracking-evidence" className="experiment">
    <Heading number="03" title="Does the learned objective recover command tracking?" description="Teacher, orbit-only and orbit-tube policies evaluated on the same 512 command settings. Deterministic actions and nominal physics." data="tracking.json" figure="teacher_orbit_only_tube_tracking.pdf"/>
    <div className="experiment-controls"><span className="plot-caption">Paired commands / 18 s evaluation windows</span><div className="control-group"><label>Measured axis<select value={axis} onChange={event => setAxis(event.target.value)}>{[{ id: 'vx', label: 'Forward velocity' }, { id: 'vy', label: 'Lateral velocity' }, { id: 'wz', label: 'Yaw rate' }].map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div></div>
    {!data ? <DataState {...request}/> : <div className="charts-two"><Panel title="Command response" note="Each point is the temporal mean for one commanded condition. Dashed line: ideal tracking."><Plot xLabel={`Command (${unit})`} yLabel={`Mean measured ${axis} (${unit})`} reference={{ diagonal: true, label: 'Ideal tracking' }} series={data.policies.map(policy => ({ id: policy.id, label: policy.label, color: POLICIES[policy.id], mode: 'scatter', points: data.commands.map((command, i) => ({ x: command[index], y: policy.actual_mean[i][index] })) }))}/></Panel><Panel title="Full time-domain tracking error"><DistributionPlot label="Temporal RMSE" unit={unit} rows={data.policies.map(policy => ({ label: policy.label, color: POLICIES[policy.id], values: policy.full_time_rmse.map(row => row[index]) }))}/></Panel></div>}
    <Finding caveat="Yaw remains under-tracked. Median yaw RMSE is 0.316 rad/s for teacher and 0.368 rad/s for tube, so the improvement is not universal.">Orbit-only responds weakly to translation commands. The tube objective restores forward and lateral tracking to approximately the teacher level.</Finding>
  </section>
}

export function Evidence() {
  return <div className="page-width"><OrbitEvidence/><SaturationEvidence/><TrackingEvidence/><RecoveryEvidence/></div>
}
