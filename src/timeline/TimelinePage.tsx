import { useLayoutEffect, useState } from 'react'
import { Container } from '../components/layout/Container'
import { Nav } from '../components/layout/Nav'
import { Section } from '../components/layout/Section'
import { Footer } from '../components/footer/Footer'
import { InteractiveBarChart } from '../components/charts/InteractiveBarChart'
import { AUTHORS, LAB } from '../data/authors'
import { SIM2REAL } from '../data/results'
import { assetUrl } from '../lib/assetUrl'
import { STORY_DIAGRAMS, type StoryDiagramId } from './storyDiagrams'
import './timeline.css'

const NAV = [
  { id: 'question', label: 'Question' },
  { id: 'fdm', label: 'Dynamics model' },
  { id: 'latent', label: 'Representation' },
  { id: 'reliance', label: 'Policy use' },
  { id: 'actions', label: 'Action model' },
  { id: 'fada', label: 'FADA' },
  { id: 'evidence', label: 'Results' },
  { id: 'limits', label: 'What is open' },
]

const chapters = [
  {
    id: 'fdm',
    date: 'Sep–Oct 2025',
    question: 'Can we adapt a dynamics model while keeping the policy fixed?',
    answer: 'No. Better prediction changed the features the policy knew how to use.',
    method: 'Forward dynamics model finetuning',
  },
  {
    id: 'latent',
    date: 'Oct–Dec 2025',
    question: 'Can we isolate dynamics from the policy that generated the data?',
    answer: 'Partly. The representation became cleaner, but control did not improve.',
    method: 'Dynamics-sensitive representation and joint training',
  },
  {
    id: 'reliance',
    date: 'Dec 2025–Feb 2026',
    question: 'What if the controller simply ignores that information?',
    answer: 'Forcing reliance exposed a deeper mismatch between prediction and action.',
    method: 'Same-policy data, FiLM, and privileged dynamics',
  },
  {
    id: 'actions',
    date: 'Feb–Mar 2026',
    question: 'Can target supervision act directly on action generation?',
    answer: 'A shared model connected the objectives, but control gains were not reliable.',
    method: 'Shared action and observation prediction',
  },
  {
    id: 'fada',
    date: 'Mar–May 2026',
    question: 'Which part of the controller should actually adapt?',
    answer: 'Keep motion intent fixed and adapt dynamics-dependent execution.',
    method: 'Planner–inverse dynamics model → FADA',
  },
]

const FIGURE_TITLES: Record<StoryDiagramId, string> = {
  'better-latent': 'Experiment 1 · Organize one feature by simulated dynamics',
  disentangle: 'Experiment 2 · Represent policy style explicitly, then push it out of the dynamics feature',
  'real-loop': 'Update the feature encoder with target data',
  'force-conditioning': 'Make the controller use dynamics information',
  coprediction: 'Predict motion and action with one shared model',
  'planner-idm': 'Freeze motion intent; adapt action execution',
  baseline: 'The baselines differ only in where adaptation acts',
}

const PUBLIC_SIM2REAL = {
  ...SIM2REAL,
  series: SIM2REAL.series.map((series) => ({
    ...series,
    label: series.id === 'fada_zs' ? 'FADA zero-shot' : series.label,
  })),
  groups: SIM2REAL.groups.map((group) => ({
    ...group,
    groupLabel: group.groupLabel
      .replace('G1 Loco. + Payload', 'G1 Locomotion + Payload')
      .replace('T1 Loco. + Payload', 'T1 Locomotion + Payload'),
  })),
}

function Lesson({ children }: { children: React.ReactNode }) {
  return <aside className="lesson"><span>What carried forward</span><p>{children}</p></aside>
}

function Interpretation({
  result,
  hypothesis,
  takeaway,
}: {
  result: React.ReactNode
  hypothesis: React.ReactNode
  takeaway: React.ReactNode
}) {
  return (
    <aside className="interpretation">
      <p>{result}</p>
      <p>{hypothesis}</p>
      <p>{takeaway}</p>
    </aside>
  )
}

function FrameworkFigure({ id }: { id: StoryDiagramId }) {
  const figure = STORY_DIAGRAMS[id]
  return (
    <figure className="framework-figure">
      {FIGURE_TITLES[id] && <h4>{FIGURE_TITLES[id]}</h4>}
      {figure.render()}
      <figcaption>{figure.caption}</figcaption>
    </figure>
  )
}

function EarlyPipeline() {
  return (
    <figure className="early-fdm">
      <header className="early-fdm__header">
        <span>The complete experiment</span>
        <b>Train the model, train the controller around its feature, then update only the model</b>
      </header>
      <div className="early-fdm__stages" role="img" aria-label="Three-stage forward dynamics model adaptation experiment">
        <section className="early-fdm__stage">
          <small>1 · Source model training</small>
          <h4>Learn to predict the next observation</h4>
          <div className="early-fdm__flow">
            <span><b>Recent execution</b><small>observations + actions</small></span>
            <i>→</i>
            <span><b>FDM encoder</b><small>history → latent feature</small></span>
            <i>→</i>
            <strong>z<sub>t</sub></strong>
            <i>→</i>
            <span><b>Prediction head</b><small>z<sub>t</sub> + executed action</small></span>
            <i>→</i>
            <em>next observation</em>
          </div>
        </section>
        <section className="early-fdm__stage">
          <small>2 · Policy training</small>
          <h4>Condition the RL policy on the source FDM feature</h4>
          <div className="early-fdm__flow early-fdm__flow--policy">
            <span><b>Policy inputs</b><small>current observation + source FDM feature z<sub>t</sub></small></span>
            <i>→</i>
            <span className="early-fdm__policy"><b>Learned RL policy</b><small>observation + z<sub>t</sub></small></span>
            <i>→</i>
            <em>action</em>
          </div>
        </section>
        <section className="early-fdm__stage early-fdm__stage--target">
          <small>3 · Target-domain adaptation</small>
          <h4>Finetune the FDM; keep the learned policy fixed</h4>
          <div className="early-fdm__flow">
            <span><b>Target transitions</b><small>history, action, observed next state</small></span>
            <i>→</i>
            <span className="early-fdm__updated"><b>Updated FDM</b><small>encoder + prediction head</small></span>
            <i>→</i>
            <strong>new z<sub>t</sub></strong>
            <i>→</i>
            <span className="early-fdm__policy"><b>Same RL policy</b><small>weights frozen</small></span>
          </div>
          <p>The update changes the feature presented to a policy that learned only the source feature distribution.</p>
        </section>
      </div>
      <figcaption>
        The experiment had three stages: pretrain the FDM, train the RL policy to use the source
        FDM latent, then finetune only the FDM on target transitions. The policy weights stayed fixed
        while the distribution of its latent input changed.
      </figcaption>
    </figure>
  )
}

function FdmEvidence() {
  return (
    <figure className="fdm-evidence">
      <header>
        <div>
          <span>Representative Booster T1 experiment</span>
          <b>Velocity tracking while walking on a smooth slope</b>
          <p>The target domain changed the terrain to a smooth incline. The locomotion policy and command sequence stayed fixed; only the FDM was finetuned on slope transitions.</p>
        </div>
        <small>Lower is better</small>
      </header>
      <div className="fdm-evidence__metrics">
        <article>
          <span>Next-state prediction loss</span>
          <p>
            <b>0.4698</b>
            <i>→</i>
            <strong>0.4641</strong>
          </p>
          <small>1.2% lower</small>
        </article>
        <article>
          <span>Frozen-policy linear tracking error</span>
          <p>
            <b>0.1460</b>
            <i>→</i>
            <strong>0.1614</strong>
          </p>
          <small>10.5% higher</small>
        </article>
      </div>
      <figcaption>
        On the same slope task, next-state prediction improved slightly while the frozen controller’s
        linear-velocity tracking became worse.
      </figcaption>
    </figure>
  )
}

const rankData = {
  prediction: [['Target-prediction finetune', 1], ['Unchanged source FDM', 2], ['Policy-objective diagnostic', 3]],
  policy: [['Policy-objective diagnostic', 1], ['Unchanged source FDM', 2], ['Target-prediction finetune', 3]],
} as const

function RankFigure() {
  const [mode, setMode] = useState<keyof typeof rankData>('prediction')
  return (
    <figure className="rank figure-card">
      <div className="switch" role="group" aria-label="Choose ranking">
        <button className={mode === 'prediction' ? 'active' : ''} onClick={() => setMode('prediction')}>Prediction quality</button>
        <button className={mode === 'policy' ? 'active' : ''} onClick={() => setMode('policy')}>Policy performance</button>
      </div>
      <div className="rank__rows">
        {rankData[mode].map(([label, rank]) => (
          <div className="rank__row" key={label}>
            <span>{label}</span><div><i style={{ width: `${100 - Number(rank) * 22}%` }} /></div><b>#{rank}</b>
          </div>
        ))}
      </div>
      <figcaption>The ranking reverses with the evaluation metric: the best predictor is not the best controller pairing.</figcaption>
    </figure>
  )
}

const latent = {
  dynamics: { title: 'When the physics changes', note: 'Larger distance is desirable', values: [2.1, 5, 50.7], max: 55 },
  policy: { title: 'When only the collecting policy changes', note: 'Smaller distance is desirable', values: [45.5, 31.1, 7.1], max: 50 },
}

function LatentChart() {
  const [mode, setMode] = useState<keyof typeof latent>('dynamics')
  const data = latent[mode]
  return (
    <figure className="latent figure-card">
      <div className="figure-card__head"><div><b>{data.title}</b><small>{data.note}<br />Maximum mean discrepancy (MMD)</small></div>
        <div className="switch"><button className={mode === 'dynamics' ? 'active' : ''} onClick={() => setMode('dynamics')}>Physics change</button><button className={mode === 'policy' ? 'active' : ''} onClick={() => setMode('policy')}>Policy change</button></div>
      </div>
      {['Raw rollout histories', 'Future prediction only', 'Prediction + contrastive grouping'].map((label, i) => (
        <div className="latent__row" key={label}><span>{label}</span><div><i style={{ width: `${data.values[i]! / data.max * 100}%` }} /></div><b>{data.values[i]}</b></div>
      ))}
      <figcaption>Maximum mean discrepancy (MMD) measures distance between two groups of features. Contrastive training moved the metric in the desired direction for both tests, but that representation result did not translate into reliable control gains.</figcaption>
    </figure>
  )
}

function RepresentationEvidence() {
  return (
    <figure className="tsne-figure">
      <header>
        <div>
          <span>Feature-space evidence</span>
          <b>The feature separated collection policies more clearly than physical environments</b>
        </div>
      </header>
      <div className="tsne-panels">
        <article>
          <span>Change the terrain</span>
          <b>Rough terrain lands on top of flat ground</b>
          <img
            src={assetUrl('timeline/latent-environment-overlap.png')}
            alt="Two-dimensional t-SNE plot in which rough-terrain features overlap two separate collections from flat ground"
          />
          <p>
            Three sets are plotted: flat ground, a second collection on that same flat ground, and rough
            terrain. The repeat collection is the control — it shows how far apart two runs of an
            identical condition already sit. Rough terrain is no further away than that.
          </p>
        </article>
        <article>
          <span>Change the collecting policy</span>
          <b>Policy checkpoints form distinct regions</b>
          <img
            src={assetUrl('timeline/latent-policy-clusters.png')}
            alt="Two-dimensional t-SNE plot in which features from different policy checkpoints form distinct regions"
          />
          <p>The same encoder exposed a strong signature of which policy had generated the rollout.</p>
        </article>
      </div>
      <figcaption>t-SNE projects high-dimensional features into two dimensions for qualitative inspection; distances are not a control metric. This diagnostic motivated the attempts to separate physical dynamics from data-collection style.</figcaption>
    </figure>
  )
}

const masses = [
  { label: 'Nominal', truth: 11.7, linear: 11.13, angular: 12.01, tuned: 12.737 },
  { label: '+3 kg', truth: 14.7, linear: 12.055, angular: 14.096, tuned: 15.947 },
  { label: '+7 kg', truth: 18.7, linear: 13.646, angular: 16.289, tuned: 19.113 },
]

function MassFigure() {
  const [index, setIndex] = useState(0)
  const d = masses[index]!
  const points = [['Mass input with best linear tracking', d.linear], ['Mass input with best angular tracking', d.angular], ['True physical mass', d.truth], ['Prediction-derived mass estimate', d.tuned]] as const
  return (
    <figure className="mass figure-card">
      <div className="switch">{masses.map((m, i) => <button key={m.label} className={i === index ? 'active' : ''} onClick={() => setIndex(i)}>{m.label}</button>)}</div>
      <div className="mass__axis"><span>10 kg</span><span>20 kg</span></div>
      {points.map(([label, value], i) => <div className="mass__row" key={label}><span>{label}</span><div><i className={`p${i}`} style={{ left: `${(value - 10) * 10}%` }} /></div><b>{value.toFixed(2)}</b></div>)}
      <figcaption>The true mass, the mass estimate preferred by the prediction objective, and the mass inputs that produced the best control were different points.</figcaption>
    </figure>
  )
}

const realWorldReliance = [
  {
    method: 'Concatenation',
    detail: 'Append z to the policy input',
    metrics: [
      { label: 'Prediction loss', before: '0.1112', after: '0.0759', ratio: 68, good: true },
      { label: 'Linear-velocity RMSE', before: '0.1351', after: '0.1238', ratio: 92, good: true },
      { label: 'Angular-velocity RMSE', before: '0.4364', after: '0.4053', ratio: 93, good: true },
    ],
  },
  {
    method: 'FiLM conditioning',
    detail: 'Use z to scale and shift policy features',
    metrics: [
      { label: 'Prediction loss', before: '0.0998', after: '0.0665', ratio: 67, good: true },
      { label: 'Linear-velocity RMSE', before: '0.1174', after: '0.1346', ratio: 115, good: false },
      { label: 'Angular-velocity RMSE', before: '0.2576', after: '0.2689', ratio: 104, good: false },
    ],
  },
] as const

function RelianceEvidence() {
  return (
    <figure className="reliance-evidence">
      <header>
        <span>Real-world Booster T1</span>
        <b>Encoder finetuning reduced prediction loss, but the control result depended on how the policy used the feature</b>
        <p>Before and after encoder-only finetuning with 5,000 target-domain transitions. Values are averages over three commanded walking sequences; lower is better.</p>
      </header>
      <div className="reliance-evidence__axis"><span>0</span><b>Before adaptation = 100%</b><span>120%</span></div>
      <div className="reliance-evidence__methods">
        {realWorldReliance.map((experiment) => (
          <article key={experiment.method}>
            <h4>{experiment.method}</h4>
            <p>{experiment.detail}</p>
            {experiment.metrics.map((metric) => (
              <div className="reliance-evidence__row" key={metric.label}>
                <span>{metric.label}<small>{metric.before} → {metric.after}</small></span>
                <div><i className={metric.good ? 'good' : 'bad'} style={{ width: `${metric.ratio / 1.2}%` }} /><em /></div>
                <b className={metric.good ? 'good' : 'bad'}>{metric.ratio}%</b>
              </div>
            ))}
          </article>
        ))}
      </div>
      <figcaption>Concatenation showed a modest improvement in this setting. FiLM made the controller depend more strongly on the feature, yet the same prediction-based update worsened both tracking errors. Angular-velocity measurements were noisier because the tracking markers were mounted on the hip.</figcaption>
    </figure>
  )
}

function PpoShift() {
  return (
    <figure className="ppo-explainer figure-card">
      <header>
        <span>Why naïve joint training was unstable</span>
        <b>PPO expects a stored rollout to keep the same policy inputs during optimization</b>
      </header>
      <div className="ppo-explainer__flow">
        <article>
          <small>1 · Collect the rollout</small>
          <div className="ppo-explainer__pipeline">
            <span>Stored observation</span><i>→</i><span>Dynamics model</span><i>→</i><strong>Feature during rollout</strong><i>→</i><span>Policy</span>
          </div>
          <p>The action and its probability are stored in the PPO batch.</p>
        </article>
        <div className="ppo-explainer__update"><b>Update the dynamics model</b><span>The encoder changes before PPO reuses the batch.</span></div>
        <article className="ppo-explainer__problem">
          <small>2 · Optimize PPO on the stored rollout</small>
          <div className="ppo-explainer__pipeline">
            <span>Same observation</span><i>→</i><span>Updated model</span><i>→</i><strong>Different feature</strong><i>→</i><span>Same policy</span>
          </div>
          <p>PPO now recomputes the action probability from a different input, not merely different policy weights.</p>
        </article>
      </div>
      <div className="ppo-explainer__conclusion">The representation must stay fixed during a PPO update, or be trained in a separate stage.</div>
      <figcaption>Proximal Policy Optimization (PPO) compares action probabilities before and after an update on the same rollout. Updating the feature encoder in between adds an unaccounted input change to that comparison.</figcaption>
    </figure>
  )
}

function CoTrainingPlot() {
  return (
    <figure className="co-training-plot">
      <header>
        <span>Representative T1 training run</span>
        <b>PPO-only still ended highest — but among the co-training schedules, the update order decided everything</b>
      </header>
      <svg viewBox="0 0 1000 390" role="img" aria-labelledby="co-training-title co-training-desc">
        <title id="co-training-title">Tracking reward during PPO and FDM co-training</title>
        <desc id="co-training-desc">Two line charts compare PPO-only training with four ways of interleaving forward-dynamics-model and PPO updates. PPO-only reaches substantially higher linear and angular tracking reward.</desc>
        <g className="co-training-plot__panel">
          <text x="60" y="34">Linear-velocity tracking reward</text>
          <path d="M60 52V305H480M60 242H480M60 179H480M60 116H480M165 52V305M270 52V305M375 52V305M480 52V305" />
          <polyline className="curve curve--ppo" points="60,300 80,272 98,180 116,74 132,60 148,118 170,84 210,72 270,66 340,62 410,59 480,58" />
          <polyline className="curve curve--fdm-ppo" points="60,300 100,286 150,269 200,250 250,216 300,178 350,150 400,130 440,116 480,126" />
          <polyline className="curve curve--ppo-fdm" points="60,300 100,270 145,246 190,252 235,226 280,202 325,186 370,164 420,148 480,132" />
          <polyline className="curve curve--combined" points="60,300 82,258 105,174 128,220 158,176 190,232 220,286 250,224 280,176 312,166 340,214 372,176 405,248 435,292 465,244 480,232" />
          <polyline className="curve curve--freeze" points="60,300 100,280 145,260 190,246 235,206 280,160 325,136 370,122 420,142 480,154" />
          <polyline className="curve curve--full-ppo-fdm" points="60,301 67,290 75,220 84,113 91,81 99,105 107,98 115,83 122,79 130,74 137,72 146,67 153,66" />
          <polyline className="curve curve--full-ppo-fdm curve--extrapolated" points="153,66 185,65 216,65 248,64 279,64 311,64 342,63 374,63 405,63 437,63 468,63 480,62" />
          <polyline className="curve curve--full-fdm-ppo" points="60,300 67,297 75,292 84,290 91,289 99,288 107,285 115,283 122,281 130,277 137,272 146,263 153,260" />
          <polyline className="curve curve--full-fdm-ppo curve--extrapolated" points="153,260 185,249 216,241 248,234 279,229 311,225 342,222 374,219 405,217 437,216 468,215 480,210" />
          <text x="60" y="327">0</text><text x="156" y="327">50k</text><text x="258" y="327">100k</text><text x="362" y="327">150k</text><text x="462" y="327">200k</text>
        </g>
        <g className="co-training-plot__panel">
          <text x="540" y="34">Angular-velocity tracking reward</text>
          <path d="M540 52V305H960M540 242H960M540 179H960M540 116H960M645 52V305M750 52V305M855 52V305M960 52V305" />
          <polyline className="curve curve--ppo" points="540,300 565,258 585,174 602,210 625,175 655,158 700,132 750,108 805,92 860,76 910,62 960,54" />
          <polyline className="curve curve--fdm-ppo" points="540,300 590,286 635,279 680,268 725,239 770,215 815,203 860,196 910,190 960,194" />
          <polyline className="curve curve--ppo-fdm" points="540,300 580,272 620,252 665,276 710,255 755,226 800,205 845,188 900,181 960,178" />
          <polyline className="curve curve--combined" points="540,300 568,244 592,218 620,246 652,221 680,268 710,284 738,232 770,206 802,214 835,251 866,205 900,258 930,302 960,266" />
          <polyline className="curve curve--freeze" points="540,300 585,286 630,276 675,262 720,236 765,207 810,186 855,174 905,170 960,186" />
          <polyline className="curve curve--full-ppo-fdm" points="540,299 547,295 555,259 564,211 571,183 578,184 587,174 595,158 602,142 610,126 617,111 626,94 633,84" />
          <polyline className="curve curve--full-ppo-fdm curve--extrapolated" points="633,84 665,82 696,80 728,79 759,78 791,78 822,77 854,77 885,76 917,76 948,76 960,75" />
          <polyline className="curve curve--full-fdm-ppo" points="540,301 547,299 555,295 564,294 571,293 579,292 587,291 595,290 602,289 610,287 617,284 626,281 633,279" />
          <polyline className="curve curve--full-fdm-ppo curve--extrapolated" points="633,279 665,270 696,263 728,257 759,252 791,249 822,246 854,244 885,243 917,241 948,240 960,237" />
          <text x="540" y="327">0</text><text x="636" y="327">50k</text><text x="738" y="327">100k</text><text x="842" y="327">150k</text><text x="942" y="327">200k</text>
        </g>
        <text x="500" y="365" className="co-training-plot__axis">training steps →</text>
      </svg>
      <div className="co-training-key" aria-label="Training-curve legend">
        <span className="key--ppo"><i /><b>PPO only</b><small>Update the controller with the PPO objective; do not train an FDM.</small></span>
        <span className="key--fdm-ppo"><i /><b>FDM → PPO</b><small>Update the FDM first, then run PPO on the same rollout.</small></span>
        <span className="key--ppo-fdm"><i /><b>PPO → FDM</b><small>Run PPO first, then update the FDM.</small></span>
        <span className="key--combined"><i /><b>Combined loss</b><small>Backpropagate prediction and PPO losses together.</small></span>
        <span className="key--freeze"><i /><b>Freeze during PPO</b><small>Hold the FDM fixed for PPO, then update it separately.</small></span>
        <span className="key--full-ppo-fdm"><i /><b>PPO → FDM, whole buffer</b><small>Finish the entire PPO update before touching the FDM.</small></span>
        <span className="key--full-fdm-ppo"><i /><b>FDM → PPO, whole buffer</b><small>Update the FDM over the entire buffer first, then run PPO.</small></span>
      </div>
      <figcaption>A smoothed redraw of the recorded curves so the update schedules are legible; higher reward is better, and the ordering and instability match the original runs. The last two schedules push the same ordering question to its extreme by doing each update over the whole rollout buffer instead of per minibatch. Both hold the feature fixed during the PPO step, so the only difference between them is which update comes first. They were run later and stopped near 44k steps: the solid segment is measured and the faded continuation is indicative, so compare those two against each other rather than against the levels of the earlier runs.</figcaption>
    </figure>
  )
}

function CoPrediction() {
  return (
    <figure className="copred figure-card">
      <div className="metrics">
        <div><span>Supervised target</span><b>Future-observation prediction</b></div>
        <div className="bad"><span>Across robots and settings</span><b>No reliable control gain</b></div>
        <div className="bad"><span>Longer-horizon finetuning</span><b>Tracking worsened; some policies fell</b></div>
      </div>
      <figcaption>The shared model could reduce prediction error without improving action quality. The apparent gain from one T1 run did not reproduce on G1, so we do not treat it as evidence that co-prediction worked on hardware.</figcaption>
    </figure>
  )
}

function FadaOverview() {
  return (
    <figure className="fada-overview">
      <header>
        <span>FADA at a glance</span>
        <b>Keep the motion plan fixed; adapt the module that turns motion into action</b>
      </header>
      <div className="fada-overview__steps">
        <article><small>Source training</small><b>Teacher policy supplies action labels</b><p>Simulation provides commands, realized motion, and the actions that produced it.</p></article>
        <article><small>Factorize control</small><b>Planner → inverse dynamics model</b><p>The planner proposes intended motion. The inverse dynamics model converts that motion into the next action.</p></article>
        <article><small>Collect target rollouts</small><b>Observe motion and executed actions</b><p>A short hardware rollout provides supervised pairs without rewards or exploration.</p></article>
        <article className="fada-overview__adapt"><small>Adaptation</small><b>Freeze the planner; update execution</b><p>A low-rank update changes only the inverse dynamics model.</p></article>
      </div>
      <figcaption>Inverse dynamics model (IDM): the component that maps intended motion and recent execution history to an action. Low-rank adaptation (LoRA) updates a small set of IDM parameters.</figcaption>
    </figure>
  )
}

function PlannerEvidence() {
  const rows = [
    { label: 'Linear-velocity error', short: '0.744', long: '0.302', note: '59% lower' },
    { label: 'Angular-velocity error', short: '0.729', long: '0.223', note: '69% lower' },
    { label: 'Execution-model loss', short: '0.0010', long: '0.0033', note: '3.2× higher' },
  ]
  return (
    <figure className="planner-evidence">
      <header>
        <span>Planner–execution diagnostic</span>
        <b>More motion context improved control even though the supervised loss increased</b>
      </header>
      <div className="planner-evidence__head">
        <span>Metric</span><span>1 future step</span><span>10 future steps</span><span>Change</span>
      </div>
      {rows.map((row, index) => (
        <div className={`planner-evidence__row${index === 2 ? ' planner-evidence__row--mismatch' : ''}`} key={row.label}>
          <b>{row.label}</b><span>{row.short}</span><strong>{row.long}</strong><em>{row.note}</em>
        </div>
      ))}
      <figcaption>Lower tracking error is better; lower execution-model loss is also better. The ten-step motion window controlled much better despite having a higher supervised loss, another sign that model loss alone was not the deployment objective.</figcaption>
    </figure>
  )
}

export function TimelinePage() {
  useLayoutEffect(() => {
    if (window.location.hash) {
      document.querySelector(window.location.hash)?.scrollIntoView()
    }
  }, [])

  return (
    <>
      <Nav items={NAV} brandHref="./" brandLabel="FADA" />
      <header className="story-hero dark" id="top"><div className="story-hero__grid" /><Container width="wide">
        <div className="story-hero__layout">
          <div className="story-hero__copy">
            <p className="story-hero__date">September 2025—May 2026</p>
            <h1>Timeline: The story behind FADA</h1>
            <p className="story-hero__dek">How a sequence of adaptation ideas moved us from finetuning a dynamics representation to finetuning the part of a humanoid controller that actually realizes motion.</p>
            <p className="story-byline">{AUTHORS.map((a, i) => <span key={a.name}>{i > 0 && ', '}<a href={a.url}>{a.name}</a></span>)}<small>{LAB.name}, {LAB.institution}</small></p>
          </div>
          <figure className="story-hero__machine">
            <p>The interface we eventually kept</p>
            {STORY_DIAGRAMS['planner-idm'].render()}
            <figcaption>Task intent stays fixed. Target data changes only how that intent becomes action.</figcaption>
          </figure>
        </div>
      </Container></header>

      <main>
        <Section id="question" eyebrow="The question" title="Can we adapt part of a humanoid whole-body controller from real-world rollouts using only supervised learning?" width="text" className="prose story-intro">
          <p>Real-world dynamics never match simulation exactly. Payload, contact, terrain, and actuator response can all change how the same command is realized. Real-world reinforcement learning (RL) can specialize a policy, but on a humanoid it also brings reward design, resets, safe exploration, and a costly hardware optimization loop.</p>
          <p>We wanted to explore a narrower alternative: adapt part of a neural controller from ordinary target-domain rollouts, make it account for the real dynamics better, and use supervised learning alone. This blog follows the research directions we tried, how each result changed the next method, and the lessons that led to FADA.</p>
        </Section>

        <Container width="wide"><div className="compare"><table>
          <caption>
            <b>Five ways to handle dynamics mismatch</b>
            <span>Ordered by how much target-domain work each one asks for, starting from none. The first column changes no weights at all, which makes it the default every other column has to improve on.</span>
          </caption>
          <thead><tr><th></th>
            <th><b>In-context adaptation</b><small>Infer the dynamics from recent history at runtime; train for robustness in simulation.</small></th>
            <th><b>System identification</b><small>Estimate physical parameters, then use them for control.</small></th>
            <th><b>Model-based control</b><small>Use a dynamics model to repeatedly plan actions online.</small></th>
            <th><b>Real-world RL</b><small>Update the full policy using task rewards collected on hardware.</small></th>
            <th><b>FADA</b><small>Freeze motion intent and supervise only action execution.</small></th>
          </tr></thead><tbody>
          <tr><th>What changes</th><td>Nothing; only the inferred context</td><td>Dynamics parameters</td><td>Model or online plan</td><td>Whole policy</td><td>Execution module</td></tr>
          <tr><th>Hardware signal</th><td>None beyond the policy’s own history</td><td>Measured transitions</td><td>Transitions, cost</td><td>Task reward</td><td>Actions + observed motion</td></tr>
          <tr><th>Adaptation loop</th><td>None; inference within the episode</td><td>Identify, then control</td><td>Repeated online solve</td><td>Collect, optimize, evaluate</td><td>Roll out, then supervised finetune</td></tr>
          <tr><th>Main constraint</th><td>Cannot exceed the behaviours randomization already covered</td><td>Model identifiability</td><td>Model and online optimization</td><td>Rewards, safety, resets, samples</td><td>Loss must match the module’s role</td></tr>
        </tbody></table></div></Container>

        <Container width="wide">
          <section className="chapter-index" aria-labelledby="chapter-index-title">
            <header>
              <p>Research map</p>
              <h2 id="chapter-index-title">Five questions that changed the controller</h2>
              <span>Each phase begins with the limitation exposed by the one before it.</span>
            </header>
            <nav className="chapter-map" aria-label="Research directions">
              {chapters.map((chapter, i) => (
                <a href={`#${chapter.id}`} key={chapter.id}>
                  <span>0{i + 1}</span>
                  <small>{chapter.date}</small>
                  <b>{chapter.question}</b>
                  <em>{chapter.answer}</em>
                  <i>{chapter.method}</i>
                </a>
              ))}
            </nav>
          </section>
        </Container>

        <Section id="fdm" eyebrow="Sep–Oct 2025 · Direction 01" title="First, adapt the forward dynamics model and keep the policy fixed" intro="The initial idea was modular: learn a forward dynamics model, condition an RL policy using its latent features, then update the dynamics model with target-domain transitions while keeping the policy fixed." width="wide" className="story-section">
          <aside className="prior-work">
            <p>
              <b>Connection to prior work.</b>{' '}
              Latent-conditioned locomotion policies were already well established.{' '}
              <a href="https://arxiv.org/abs/2107.04034" target="_blank" rel="noopener noreferrer">
                RMA
              </a>{' '}
              trains a policy to consume a privileged environment encoding, then trains a history-based
              adaptation module to estimate that encoding at deployment.{' '}
              <a href="https://arxiv.org/abs/2301.10602" target="_blank" rel="noopener noreferrer">
                DreamWaQ
              </a>{' '}
              is closer to our starting point: its context-aided estimator learns a latent from recent
              proprioception using next-observation reconstruction, and the RL policy consumes that latent.
              Both methods train their adaptation machinery in simulation and deploy without target-domain
              finetuning. Our question was whether the dynamics-producing module itself could instead be
              updated from target rollouts while the learned policy stayed fixed.
            </p>
            <ol>
              <li>
                A. Kumar, Z. Fu, D. Pathak, and J. Malik, “RMA: Rapid Motor Adaptation for Legged Robots,”
                RSS 2021.
              </li>
              <li>
                I. M. A. Nahrendra, B. Yu, and H. Myung, “DreamWaQ: Learning Robust Quadrupedal Locomotion
                With Implicit Terrain Imagination via Deep Reinforcement Learning,” 2023.
              </li>
            </ol>
          </aside>
          <div className="two-col two-col--fdm"><div className="prose"><p>We pretrained a forward dynamics model (FDM) to predict the next observation from observation and action history. Its learned internal feature—often called a latent—conditioned the RL policy alongside the current observation. In the target domain, we finetuned the FDM and reconnected it to the frozen policy.</p><p>We then evaluated that same frozen policy with the original source FDM, a fully target-finetuned FDM, regularized variants, and FDMs trained on target data from scratch. The recurring result was simple: prediction improved while control became worse.</p></div><EarlyPipeline /></div>
          <FdmEvidence />
          <div className="two-col"><div className="prose"><h3>Was prediction quality actually the problem?</h3><p>Evaluating the same frozen policy with different FDM versions left two possible explanations. The target-finetuned FDM might still be too inaccurate, or it might be a better predictor whose feature had moved away from the distribution understood by the policy.</p><p>To distinguish them, we froze the policy and value networks and updated only the FDM encoder using the policy objective. If prediction quality were the main issue, the encoder with the lowest prediction loss should also have controlled best. Instead, the ordering reversed.</p></div><RankFigure /></div>
          <Interpretation
            result={<>The FDM comparisons and this diagnostic pointed in the same direction. Full offline finetuning gave the best dynamics predictions and the weakest controller pairing; updating the encoder with the policy objective predicted worse, but stayed closer to the unchanged source encoder in control.</>}
            hypothesis={<>The policy had not learned to read an abstract, interchangeable description of dynamics. It had learned the activation pattern produced by one particular FDM. Finetuning added target information, but delivered it through features the frozen policy no longer knew how to interpret.</>}
            takeaway={<>That changed the next question. Instead of asking only how to improve the dynamics model, we needed to ask whether its representation could be made stable, dynamics-sensitive, and useful to the policy.</>}
          />
          <Lesson>Distribution mismatch. The policy had learned to use one particular FDM’s activations—not an interchangeable description of physics.</Lesson>
        </Section>

        <Section id="latent" eyebrow="Oct–Dec 2025 · Directions 02–03" title="We made the representation more dynamics-relevant—but not more useful for control" intro="The first phase showed that target finetuning could move the FDM feature away from what the policy understood. We next asked what that feature actually encoded, tried to remove policy-specific information, and then trained the FDM and controller together." tone="dark" width="wide" className="story-section">
          <div className="prose prose--wide">
            <h3>First, diagnose what the feature was encoding</h3>
            <p>The FDM encoder received recent observations and actions. Those histories change for two reasons: the physics can change, or a different policy can generate a different motion pattern under the same physics. We therefore built two controlled comparisons. Along the <i>dynamics axis</i>, the collection policy stayed fixed while mass, friction, or terrain changed. Along the <i>policy axis</i>, the physics stayed fixed while the policy checkpoint or training seed changed.</p>
            <p>In the original feature space, rollouts separated more clearly by policy checkpoint than by terrain. The encoder had learned a strong signature of who generated the trajectory—the wrong shortcut for target-domain dynamics adaptation.</p>
          </div>
          <RepresentationEvidence />
          <div className="two-col">
            <div className="prose">
              <h3>Then run two representation experiments</h3>
              <p>Both experiments kept next-state prediction as the base task, but changed how the feature was trained and what information the prediction model could store:</p>
              <ol className="representation-steps">
                <li><b>One latent with dynamics grouping.</b> Simulation tells us which mass, friction, and terrain produced each rollout. We used those labels to pull features from the same dynamics together and push different dynamics apart, while the FDM still predicted the next observation.</li>
                <li><b>Give policy style its own feature, then subtract it.</b> Experiment 1 could say which rollouts belonged <i>together</i>, but it had no way to say what the dynamics feature should <i>not</i> contain. “Ignore the collecting policy” is not something a loss can express directly, because there is nothing concrete to point at. So we built something to point at: a second encoder trained to represent the collecting policy’s motion style, and a separation loss that pushed the dynamics feature away from it. One variant made that anchor especially clean by computing it from a single timestep — a snapshot shows posture and style but cannot reveal dynamics, which only becomes visible across a transition. A related variant skipped the second encoder and handed the action sequence straight to the prediction head, so the dynamics encoder had no reason to store it in the first place.</li>
                <li><b>Test representation and control separately.</b> We measured feature distance on the two controlled axes, then trained policies with the resulting dynamics feature and evaluated them under held-out mass and terrain shifts.</li>
              </ol>
              <p>We also tested normalization, longer prediction horizons, a compact prior, noisier actions, and more varied collection policies. These changed individual diagnostics, but not the central result below.</p>
            </div>
            <LatentChart />
          </div>
          <div className="framework-grid">
            <FrameworkFigure id="better-latent" />
            <FrameworkFigure id="disentangle" />
          </div>
          <Interpretation
            result={<>The contrastive objective moved both representation diagnostics in the intended direction: feature distance increased when physics changed and decreased when only the collection policy changed. The disentangled model also predicted better under a new collection policy. Neither change produced a reliable control gain.</>}
            hypothesis={<>These tests showed that dynamics information was present, not that it was control-relevant. A policy trained with domain randomization could still ignore the feature, and target prediction finetuning could move it in a direction that reduced prediction error without improving actions.</>}
            takeaway={<>A control-useful adaptation feature needs three properties at once: it must contain dynamics information, the controller must rely on it, and the target update must move it in a direction that improves actions. The representation diagnostics verified only the first.</>}
          />
          <div className="prose prose--wide">
            <h3>Next, train the FDM and policy in the same run</h3>
            <p>The separate-training experiments left a straightforward possibility: train the FDM and policy together so the policy learns the feature the FDM actually produces. We compared five schedules on the same locomotion task: PPO alone; FDM then PPO; PPO then FDM; one combined loss; and a schedule that froze the FDM during PPO before updating it separately.</p>
            <p>The order mattered. In the FDM-then-PPO schedule, a rollout was collected with one feature, the FDM was updated, and PPO then reused the stored rollout with a different feature. The observation in the buffer had not changed, but the policy input had.</p>
          </div>
          <PpoShift />
          <CoTrainingPlot />
          <Interpretation
            result={<>Every schedule trained below PPO-only, and updating the encoder through PPO was worse still. The two whole-buffer runs isolate why: they share the same rollout data and both freeze the feature during the PPO step, so the <em>only</em> difference is which update runs first. Doing PPO first reaches a linear tracking reward near <b>3.8</b>; doing the dynamics model first never leaves <b>0.7</b>. The per-minibatch versions of those same two orders both land in between, which is what a smaller dose of the same problem should look like.</>}
            hypothesis={<>A rollout was collected with <i>z</i><sub>old</sub>, then the FDM changed before PPO recomputed the action probabilities. PPO’s ratio divides the probability computed now by the one stored during collection, and those are only comparable when the policy input is identical in both. With the encoder inside that input, the denominator is a probability under <i>z</i><sub>old</sub> and the numerator one under <i>z</i><sub>new</sub> — a ratio across two different inputs rather than two sets of weights. The clipped range is then centred on the wrong reference, and the advantages and value targets were computed from features that no longer exist. Updating the model over the whole buffer maximises that gap, which is why it is the worst run of the set.</>}
            takeaway={<>The update schedule is part of the method. This pushed us to keep the policy-facing feature fixed during PPO, collect target data with the same co-trained policy, and ask a more basic question: did the controller use the feature at all?</>}
          />
          <Lesson>Training harmony. A learned representation cannot move freely inside an on-policy update; the controller needs a stable interface.</Lesson>
        </Section>

        <Section id="reliance" eyebrow="Dec 2025–Feb 2026 · Directions 04–05" title="Matching the data and making the policy listen still did not align the update" intro="The co-training study suggested two practical changes: collect target rollouts with the same FDM-conditioned policy, and keep the policy fixed during encoder finetuning. That removed an avoidable mismatch—but first we had to check whether the policy used the feature at all." width="wide" className="story-section">
          <div className="prose prose--wide">
            <h3>Use matched target data, then test feature dependence</h3>
            <p>We used the co-trained FDM–policy pair itself to collect target-domain rollouts, then finetuned only the FDM encoder. This avoided asking an FDM trained around one policy to interpret trajectories from an unrelated policy.</p>
            <p>Under strong domain randomization, however, replacing the latent with zeros barely changed control. The policy had learned a robust shortcut through raw proprioception. We therefore added observation noise and compared simple concatenation with feature-wise linear modulation (FiLM), which uses the latent to scale and shift hidden policy features throughout the network.</p>
          </div>
          <div className="framework-grid">
            <FrameworkFigure id="real-loop" />
            <FrameworkFigure id="force-conditioning" />
          </div>
          <RelianceEvidence />
          <div className="two-col"><div className="prose"><h3>Could the remaining problem simply be a bad learned feature?</h3><p>To remove that explanation, we trained a policy with ground-truth link masses and trained a history encoder to recover those masses. At evaluation time, we swept the mass value given to the policy and compared three points: the physical value, the value produced after prediction-based finetuning, and the value that gave the best tracking.</p><p>Even in this simplified diagnostic, those points did not coincide. Moving the estimate toward the physical mass could reduce next-state prediction loss while moving the policy away from its best control input.</p></div><MassFigure /></div>
          <Interpretation
            result={<>The real-world T1 comparison made the split visible: encoder finetuning lowered prediction loss for both concatenation and FiLM. Concatenation improved modestly in that run, while the more feature-dependent FiLM policy became worse on both tracking metrics. With privileged mass, the physically correct value, the prediction-derived value, and the best control input were also different.</>}
            hypothesis={<>Domain randomization encouraged a conservative shortcut: trust the raw observations and treat the latent as optional. Forcing dependence removed that shortcut but did not align the update. At larger shifts, a correct latent could also describe a regime for which the policy had never learned a useful response.</>}
            takeaway={<>Reliance is necessary, not sufficient. Correct dynamics information, minimum prediction loss, and the best input for a particular learned controller are not automatically the same point.</>}
          />
          <Lesson>Objective mismatch. Lower next-state prediction loss—even with privileged supervision—was not a reliable proxy for better actions.</Lesson>
        </Section>

        <Section id="actions" eyebrow="Feb–Mar 2026 · Direction 06" title="Moving supervision closer to actions was still not enough" intro="The privileged-mass diagnostic weakened the premise that a better latent plus a frozen policy would be enough. We therefore removed the separate latent interface and trained one Transformer to predict both actions and future observations." tone="dark" width="wide" className="story-section">
          <div className="two-col"><div className="prose"><p>This was a structural test of the previous lesson: if future-motion prediction and action generation shared a model, supervised target adaptation would directly change the action pathway.</p><p>It did—but not reliably for the better. Prediction loss could decrease while tracking stayed flat or worsened. One T1 run appeared to improve after adaptation, but the result did not reproduce on G1, so we do not use it as evidence that co-prediction improved hardware control. Longer-horizon finetuning made the mismatch clearer: some policies became worse or fell.</p></div><CoPrediction /></div>
          <Interpretation
            result={<>Across robots and settings, co-prediction did not produce a reliable control improvement even when future-observation prediction improved. The isolated positive T1 run did not reproduce on G1, and longer-horizon finetuning could degrade tracking enough for the robot to fall.</>}
            hypothesis={<>One parameter set still performed two jobs: representing task intent and producing dynamics-dependent actions. Optimizing it for future-observation prediction therefore changed action generation, but the prediction gradient did not specify which action changes would improve control.</>}
            takeaway={<>Moving supervision into the action pathway was not sufficient. The next architecture needed to preserve task intent while isolating a dynamics-sensitive execution module whose supervised target directly described action generation.</>}
          />
          <div className="framework-grid framework-grid--single">
            <FrameworkFigure id="coprediction" />
          </div>
          <Lesson>A shared backbone connected prediction to action, but still mixed two jobs: deciding the intended motion and executing it under the current dynamics.</Lesson>
        </Section>

        <Section id="fada" eyebrow="Mar–May 2026 · Directions 07–08" title="The final pivot: preserve intent, adapt execution" intro="Co-prediction moved target supervision into the action pathway, but one shared model still mixed task intent with dynamics-dependent execution. The next design split those jobs into a motion planner and an inverse dynamics model." width="wide" className="story-section">
          <div className="two-col"><div className="prose"><p>The first Planner–IDM versions were not enough. The inverse dynamics model (IDM) could reduce its supervised loss while tracking stayed flat or worsened, because it could copy easy future-state signals instead of learning how recent execution and intended motion determine the next action.</p><p>The source-training interface changed: teacher forcing used motion the robot actually realized; masking and noise removed shortcuts; only the first action—the one deployment executes before replanning—was supervised; and the planner was trained through the IDM so that its proposed motion produced the teacher policy’s action.</p><p>At deployment, the planner stays fixed. Ordinary target rollouts provide paired actions and observed motion, and low-rank adaptation (LoRA) updates only the IDM.</p></div><FadaOverview /></div>
          <Interpretation
            result={<>Early Planner–IDM had weaker absolute zero-shot numbers, but unlike the shared co-prediction model it did not become unsafe after adaptation. Its central failure was more revealing: IDM loss could fall substantially while angular tracking became worse.</>}
            hypothesis={<>The planner and IDM were trained separately and then expected to compose. Without masking, the IDM could also copy predicted joint positions and largely ignore the observation/action history that carried evidence about the actual dynamics.</>}
            takeaway={<>Choosing the right module to adapt was not enough. Source training had to prevent shortcuts and make the target supervised objective describe the same inverse-dynamics relation used at deployment.</>}
          />
          <PlannerEvidence />
          <div className="changes"><div><b>Masking + noise</b><span>More robust zero-shot transfer</span></div><div><b>First-action supervision</b><span>Large zero-shot improvement</span></div><div><b>Action-based planner loss</b><span>Large zero-shot improvement</span></div><div><b>LoRA on the IDM</b><span>Small, targeted deployment update</span></div></div>
          <Interpretation
            result={<>Masking, first-action supervision, and the action-based planner loss produced the largest gains in our ablations. Delta prediction and additional data collected from weaker policies showed no obvious effect.</>}
            hypothesis={<>The successful changes all removed a way to cheat. Teacher forcing taught pure inverse dynamics; masking forced the IDM to use execution history; first-action supervision matched the receding-horizon controller; and the planner loss rewarded futures for producing the right action rather than merely resembling an oracle trajectory.</>}
            takeaway={<>This was the first interface where the quantity optimized during adaptation and the quantity deployment depended on were the same: the target-domain relation between realized motion and the action that produced it.</>}
          />
          <Lesson>The adaptable component and its supervised target must describe the same job: translating intended motion into actions under the target dynamics.</Lesson>
        </Section>

        <Section id="evidence" eyebrow="Where the path landed" title="The interface survived contact with hardware" intro="The final method improved both success-based and tracking-error tasks after a short target rollout budget." tone="dark" width="wide" className="story-section">
          <div className="method-key" aria-label="Methods shown in the hardware results">
            <article><b>TF-DAgger</b><p>A single student policy distilled from the source teacher, with no target-domain update.</p></article>
            <article><b>FADA zero-shot</b><p>The split planner–execution controller before seeing any target rollout data.</p></article>
            <article><b>FADA adapted</b><p>The same controller after supervised target finetuning of only the execution model.</p></article>
          </div>
          <div className="result-grid"><div><h3>Success tasks</h3><InteractiveBarChart dataset={PUBLIC_SIM2REAL} metricFilter="success" /></div><div><h3>Tracking tasks</h3><InteractiveBarChart dataset={PUBLIC_SIM2REAL} metricFilter="normErr" /></div></div>
          <Interpretation
            result={<>FADA improved performance across the evaluated hardware tasks after adaptation. The most informative comparison was the adapted shared-prediction model: it used the same target data but applied the update to future prediction rather than action execution.</>}
            hypothesis={<>When the domain shift changes how intended motion is realized, the update belongs where actions are generated. The teacher policy, source data, target-data budget, and deployment observations were held fixed, isolating the interface that received the update.</>}
            takeaway={<>A supervised adaptation objective helps when it trains the role deployment actually needs. Adapting a quantity the controller may ignore, or optimizing a proxy only loosely connected to action quality, is not enough.</>}
          />
          <div className="framework-grid framework-grid--single">
            <FrameworkFigure id="baseline" />
          </div>
        </Section>

        <Section id="limits" eyebrow="What is still open" title="Where the framework stops" intro="Execution-only adaptation works when the shift changes how intended motion is realized and the deployed policy can still collect usable data. Both of those are assumptions, and each one marks out the work we think comes next." width="wide" className="story-section">
          <div className="limits">
            <div className="limits__col">
              <h3>Limitations</h3>
              <ol>
                <li>
                  <b>Adaptation needs rollouts worth learning from.</b>
                  <p>The execution model is supervised with pairs of realized motion and executed action, taken from the deployed policy’s own rollouts. That assumes the zero-shot controller still produces coherent, on-task motion in the target domain. If it falls, freezes, or thrashes, those windows no longer show how intent becomes action and there is nothing to align. Much of the final recipe exists for this reason — masking, noise, supervising only the first action, and the action-based planner loss all serve to keep zero-shot transfer good enough to collect its own training data. A catastrophic zero-shot failure is still outside what the method handles by itself.</p>
                </li>
                <li>
                  <b>The execution model still carries task structure.</b>
                  <p>Turning intended motion into action should be a property of the body and its dynamics rather than of the task. In practice the module is trained inside one task distribution and may still encode task-specific structure, so an execution model earned on one task is not yet known to transfer to another. A more task-agnostic version would make adaptation both cheaper and reusable.</p>
                </li>
                <li>
                  <b>How much simulation to keep in the mix is an open question.</b>
                  <p>Adapting alongside source data, rather than on target rollouts alone, consistently reduced the distribution mismatch the update had to absorb. We do not yet understand what sets the right balance, or how it should shift with the size of the domain gap. That is an analysis question rather than a tuning trick, and answering it properly would also tell us when co-training helps and when it simply dilutes the target signal.</p>
                </li>
                <li>
                  <b>Real-world evaluation needs cleaner benchmarks.</b>
                  <p>Hardware measurements are noisy in ways that make small differences hard to trust. Tracking error can improve for the wrong reason — a robot that stands still scores well on angular-velocity error — and we saw qualitative gains the metrics denied, as well as the reverse. Simulation did not reliably predict hardware behaviour either. Comparing modest improvements across papers will need low-variance, noise-free real-world evaluation benchmarks for whole-body control.</p>
                </li>
              </ol>
            </div>
            <div className="limits__col limits__col--next">
              <h3>What comes next</h3>
              <ol>
                <li>
                  <b>A recovery controller for data collection.</b>
                  <p>The direct answer to the first limitation. A fall-aware controller running alongside collection would let the method gather usable rollouts in domains where the zero-shot policy is not yet safe on its own — which is exactly where adaptation has the most to offer.</p>
                </li>
                <li>
                  <b>Exteroceptive inputs.</b>
                  <p>Adaptation currently reads proprioception and executed actions. When the mismatch is about the world rather than the body — terrain geometry, an obstacle, where a payload actually sits — the signal the execution model needs is not in proprioception alone. Extending the same interface to perceptual input, without going back to reconstructing the environment, is the natural step.</p>
                </li>
                <li>
                  <b>Contact-rich loco-manipulation.</b>
                  <p>Every shift studied here changes how the robot’s own motion is realized. Manipulation adds a second system to reason about: the object’s dynamics, and the interaction between it and the robot. Whether motion intent can still be frozen while only execution adapts, or whether the object’s state has to enter the planner itself, is the question we most want to answer next.</p>
                </li>
              </ol>
            </div>
          </div>
          <div className="closing-copy"><p>The path to FADA was not a search for a more accurate latent. It was a search for an interface where the data available on hardware teaches exactly the part of the policy that needs to change.</p><a href="./">Read the FADA paper and full results →</a></div>
        </Section>
      </main>
      <Footer />
    </>
  )
}
