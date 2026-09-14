import { useState } from 'react'
import { DataState, FigureLinks, Finding, useJson } from './shared'
import { Plot, type Series } from './Plot'

type Values = (number | null)[]
type Band = { median: Values; q25: Values; q75: Values; n: number[] }
type Rate = { numerator: number; denominator: number; fraction: number | null }
type Selection = number | 'all'
type Cell = {
  phase: Selection; command: Selection; group: string; n_trials: number; n_survivors: number
  physical: Band; transverse: Band; physical_control_p95: Values; transverse_control_median: Values
  returns: { left: Band; right: Band; control_p95_left: Values; control_p95_right: Values }
  strict_recovery: Rate; strict_recovery_all_trials: Rate; failed: Rate
}
type Policy = { id: 'teacher' | 'tube'; label: string; cells: Cell[] }
type RecoveryData = {
  schema_version: number; phases: number[]; commands: { id: number; label: string; values: number[] }[]
  push_groups: string[]; time_s: number[]; return_numbers: number[]; policies: Policy[]
}

const DATA = 'hzd/evidence/recovery.json'
const COLORS = { teacher: '#4676af', tube: '#087e8b' }
const AXES = ['Fx', 'Fy', 'Fz', 'Tx', 'Ty', 'Tz']
const selection = (value: string): Selection => value === 'all' ? 'all' : Number(value)
const percent = (rate?: Rate) => rate?.fraction == null ? 'N/A' : `${(rate.fraction * 100).toFixed(1)}%`
const exactCell = (policy: Policy, phase: Selection, command: Selection, group: string) =>
  policy.cells.find(cell => cell.phase === phase && cell.command === command && cell.group === group)

function curve(policy: Policy, id: string, label: string, x: number[], values: Values, band?: Band): Series {
  return {
    id: `${policy.id}-${id}`, label: `${policy.label} ${label}`, color: COLORS[policy.id], dashed: !band,
    points: x.flatMap((position, index) => {
      const value = values[index]
      if (value == null || !Number.isFinite(value)) return []
      return [{ x: position, y: value, lo: band?.q25[index] ?? undefined, hi: band?.q75[index] ?? undefined }]
    }),
  }
}

function RateBars({ policies, rows, phase, command, group }: {
  policies: Policy[]; rows: { id: string; label: string }[]; phase: Selection; command: Selection; group: string
}) {
  return <div style={{ display: 'grid', gap: 14 }}>
    {rows.map(row => <div key={row.id} style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, marginBottom: 5, overflowWrap: 'anywhere' }}>{row.label}</div>
      {policies.map(policy => {
        const cell = AXES.includes(row.id)
          ? exactCell(policy, phase, command, row.id)
          : exactCell(policy, phase, Number(row.id), group)
        const rate = cell?.strict_recovery
        const title = `${row.label}; ${policy.label}; strict recovery ${percent(rate)}; ${rate?.numerator ?? 0}/${rate?.denominator ?? 0} excited trials; phase ${phase}; command ${AXES.includes(row.id) ? command : row.id}; push ${AXES.includes(row.id) ? row.id : group}; physical failures ${cell?.failed.numerator ?? 'unknown'}/${cell?.failed.denominator ?? 'unknown'}`
        return <div key={policy.id} title={title} aria-label={title} tabIndex={0}
          style={{ display: 'grid', gridTemplateColumns: '76px minmax(24px, 1fr) 100px', alignItems: 'center', gap: 8, minHeight: 26, fontSize: 11 }}>
          <span style={{ color: COLORS[policy.id] }}>{policy.label}</span>
          <span aria-hidden="true" style={{ display: 'block', background: '#edf0ef', height: 10 }}>
            {rate?.fraction != null && <span style={{ display: 'block', background: COLORS[policy.id], width: `${rate.fraction * 100}%`, height: '100%' }} />}
          </span>
          <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {percent(rate)} {rate && <small>({rate.numerator}/{rate.denominator})</small>}
          </span>
        </div>
      })}
    </div>)}
  </div>
}

export function RecoveryEvidence() {
  const request = useJson<RecoveryData>(DATA)
  const [commandValue, setCommand] = useState('all')
  const [phaseValue, setPhase] = useState('all')
  const [group, setGroup] = useState('all')
  const data = request.data
  const phase = selection(phaseValue), command = selection(commandValue)
  const selected = data?.policies.flatMap(policy => {
    const cell = exactCell(policy, phase, command, group)
    return cell ? [{ policy, cell }] : []
  }) ?? []
  const returns = (foot: 'left' | 'right') => selected.flatMap(({ policy, cell }) => [
    curve(policy, `${foot}-return`, 'median / IQR', data!.return_numbers, cell.returns[foot].median, cell.returns[foot]),
    curve(policy, `${foot}-control`, 'control p95', data!.return_numbers, cell.returns[`control_p95_${foot}`]),
  ]).filter(series => series.points.length > 0)
  const recovery = (metric: 'physical' | 'transverse') => selected.flatMap(({ policy, cell }) => [
    curve(policy, metric, 'median / IQR', data!.time_s, cell[metric].median, cell[metric]),
    curve(policy, `${metric}-control`, metric === 'physical' ? 'control p95' : 'control median', data!.time_s,
      metric === 'physical' ? cell.physical_control_p95 : cell.transverse_control_median),
  ]).filter(series => series.points.length > 0)
  const cohort = `${command === 'all' ? 'All commands' : data?.commands.find(item => item.id === command)?.label ?? commandValue}; ${phase === 'all' ? 'all push phases' : `push phase ${phase}`}; ${group === 'all' ? 'all forced pushes' : group}`

  return <>
    <section className="experiment" id="return-evidence" aria-labelledby="return-heading">
      <div className="experiment-top"><div><p className="eyebrow">Same-foot sections</p>
        <h3 id="return-heading">Deviation across six returns</h3>
        <p>Physical section-state error against each policy's unforced reference at the same foot and return number.</p>
      </div><FigureLinks data={DATA} figure="hzd/evidence/actual_same_foot_returns.pdf" /></div>
      <div className="experiment-controls"><div className="control-group">
        <label style={{ flexWrap: 'wrap', minWidth: 0 }}>Command <select aria-label="Recovery command" value={commandValue} onChange={event => setCommand(event.target.value)}>
          <option value="all">All commands</option>
          {(data?.commands ?? [{ id: 0, label: 'Straight 0.4' }, { id: 1, label: 'Straight 0.8' }, { id: 2, label: 'Turn +0.5' }, { id: 3, label: 'Turn -0.5' }]).map(item => <option key={item.id} value={String(item.id)}>{item.label}</option>)}
        </select></label>
        <label style={{ flexWrap: 'wrap' }}>Phase <select aria-label="Push phase" value={phaseValue} onChange={event => setPhase(event.target.value)}>
          <option value="all">All phases</option>{[0, 0.25, 0.5, 0.75].map(value => <option key={value} value={String(value)}>{value}</option>)}
        </select></label>
        <label style={{ flexWrap: 'wrap' }}>Push <select aria-label="Recovery push group" value={group} onChange={event => setGroup(event.target.value)}>
          <option value="all">All forced pushes</option>{(data?.push_groups ?? [...AXES, 'random_6d', 'control']).map(value => <option key={value} value={value}>{value === 'control' ? 'Unforced control' : value === 'random_6d' ? 'Random 6D' : value}</option>)}
        </select></label>
      </div></div>
      {!data ? <DataState {...request} /> : <>
        <div className="charts-two">{(['left', 'right'] as const).map(foot => <div className="plot-panel" key={foot}>
          <h4>{foot === 'left' ? 'Left foot' : 'Right foot'}</h4>
          <Plot series={returns(foot)} xLabel="Same-foot return number" yLabel="Normalized section-state RMSE" xDomain={[1, 6]} />
        </div>)}</div>
        <p className="plot-caption">{cohort}. Medians and IQRs use complete, nonfailed sequences separately per foot; dashed lines are matched control p95. Missing samples are not zero.</p>
      </>}
      <Finding caveat="Feet are not independent training seeds. Sample IQRs are descriptive, not confidence intervals; one historical checkpoint per policy.">
        Across all forced trials, median section error falls from 0.493 to 0.0156 for Teacher and from 0.424 to 0.0127 for HZD-Tube over six returns. Both recover, although Tube retains a heavier high-error tail.
      </Finding>
    </section>

    <section className="experiment" id="recovery-evidence" aria-labelledby="recovery-heading">
      <div className="experiment-top"><div><p className="eyebrow">Matched push trials</p>
        <h3 id="recovery-heading">Physical recovery and tube return</h3><p>{cohort}</p>
      </div><FigureLinks data={DATA} figure="hzd/evidence/six_axis_multiphase_recovery.pdf" /></div>
      {!data ? <DataState {...request} /> : <>
        <div className="charts-two">
          <div className="plot-panel"><h4>Matched-time physical deviation</h4>
            <Plot series={recovery('physical')} xLabel="Seconds from push onset" yLabel="Normalized physical-state RMSE" />
            <p className="plot-caption">Nonfailed trials: median and IQR; dashed matched control p95. Error includes phase offset, not only posture change.</p>
          </div>
          <div className="plot-panel"><h4>Decoded transverse distance</h4>
            <Plot series={recovery('transverse')} xLabel="Seconds from push onset" yLabel="Weighted transverse distance" reference={{ y: 1, label: 'Broad tube radius = 1' }} />
            <p className="plot-caption">Nonfailed trials: median and IQR; dashed control median. Broad membership requires at least 95% of the final second within radius 1, with no failure or missing samples.</p>
          </div>
        </div>
        <p className="plot-caption" aria-live="polite">Selected cohort: {selected.map(({ policy, cell }) => `${policy.label}: ${percent(cell.strict_recovery)} strict recovery (${cell.strict_recovery.numerator}/${cell.strict_recovery.denominator} excited); ${cell.failed.numerator}/${cell.failed.denominator} physical failures; ${cell.n_survivors}/${cell.n_trials} nonfailed`).join(' | ') || 'No matching cell.'}</p>
        <div className="charts-two">
          <div className="plot-panel"><h4>Strict recovery by push axis</h4>
            <RateBars policies={data.policies} rows={AXES.map(id => ({ id, label: `${id} (${id.startsWith('F') ? 'force' : 'torque'})` }))} phase={phase} command={command} group={group} />
            <p className="plot-caption">Six body-frame axes, each its own exact cell at the selected command and phase. The push-group filter does not replace these axis cohorts.</p>
          </div>
          <div className="plot-panel"><h4>Strict recovery by command</h4>
            <RateBars policies={data.policies} rows={data.commands.filter(item => command === 'all' || item.id === command).map(item => ({ id: String(item.id), label: item.label }))} phase={phase} command={command} group={group} />
            <p className="plot-caption">Exact command cells at the selected phase and push group; counts are recovered / excited trials. N/A denotes an empty denominator.</p>
          </div>
        </div>
        <p className="plot-caption">Strict recovery: final-one-second physical-error p95 at most max(0.05, 10% of the initial [0, 1 s] peak), among excited trials (peak &gt; 0.05). Failures and missing tails count as unsuccessful. Rates use the full saved time grid; curves are decimated for display.</p>
      </>}
      <Finding caveat="Failure of the strict recovery criterion is not proof of physical failure. Matched-time deviation can include timing changes; these saved simulated trials do not establish hardware robustness.">
        Across all saved forced trials, strict recovery is 83.72% for Teacher and 74.74% for HZD-Tube. At straight 0.8 m/s, HZD-Tube achieves only about 3.8% versus Teacher's 79.0% (all phases and push groups). Both policies return to the broad tube, but broad membership is not precise motion recovery.
      </Finding>
    </section>
  </>
}
