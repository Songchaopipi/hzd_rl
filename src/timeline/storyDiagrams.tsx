type DiagramBoxProps = {
  title: string
  detail?: string
  tone?: boolean
}

function DiagramBox({ title, detail, tone }: DiagramBoxProps) {
  return (
    <span className={`story-diagram__box${tone ? ' story-diagram__box--tone' : ''}`}>
      <b>{title}</b>
      {detail && <small>{detail}</small>}
    </span>
  )
}

function Arrow() {
  return <span className="story-diagram__arrow" aria-hidden="true">→</span>
}

function BetterLatent() {
  return (
    <div
      className="story-diagram"
      role="img"
      aria-label="A forward dynamics model predicts future motion and uses simulation dynamics labels to group rollout features from the same physics condition."
    >
      <p className="story-diagram__context"><b>Training data:</b> rollout clips from one locomotion task under many simulated masses, frictions, and terrains.</p>
      <div className="story-diagram__flow">
        <DiagramBox title="Recent execution" detail="observations + actions" />
        <Arrow />
        <DiagramBox title="FDM encoder" detail="produces latent z" tone />
        <Arrow />
        <DiagramBox title="RL policy" detail="current observation + z" />
        <Arrow />
        <span className="story-diagram__output">Action</span>
      </div>
      <div className="story-diagram__objectives">
        <span>Two losses train the same encoder</span>
        <div>
          <b>Future prediction<small>z and the executed action predict the next observation.</small></b>
          <b>Dynamics grouping<small>Same simulated physics: pull together. Different physics: push apart.</small></b>
        </div>
      </div>
      <div className="story-diagram__findings">
        <span>Feature distance across physics: 5.0 → 50.7</span>
        <span className="story-diagram__finding--bad">Control did not improve reliably</span>
      </div>
    </div>
  )
}

function Disentangle() {
  return (
    <div
      className="story-diagram"
      role="img"
      aria-label="Two encoders split a rollout into a physical-dynamics feature and a data-collection-policy feature. A separation loss discourages the two features from encoding the same information."
    >
      <p className="story-diagram__context"><b>Why a second experiment?</b> Prediction can use the collecting policy’s motion style as a shortcut, even when the physics is unchanged.</p>
      <p className="story-diagram__input">Same observation and action history</p>
      <div className="story-diagram__split">
        <DiagramBox title="Dynamics encoder" detail="intended to retain mass, friction, and contact response" tone />
        <span className="story-diagram__separation">reduce overlap between the two features</span>
        <DiagramBox title="Policy-style encoder" detail="captures how the data-collection policy moves" />
      </div>
      <div className="story-diagram__flow story-diagram__flow--compact">
        <DiagramBox title="Both features" detail="kept available for prediction" />
        <Arrow />
        <DiagramBox title="Prediction head" detail="predicts the next observation" />
      </div>
      <div className="story-diagram__findings story-diagram__findings--single">
        <span>Prediction under a new collection policy improved modestly, but control still did not improve reliably</span>
      </div>
    </div>
  )
}

function RealLoop() {
  return (
    <div
      className="story-diagram"
      role="img"
      aria-label="Source data and a small set of target rollouts update only the feature encoder. The policy remains frozen."
    >
      <div className="story-diagram__data">
        <DiagramBox title="Source data" detail="simulation rollouts" />
        <span>+</span>
        <DiagramBox title="Target data" detail="short real-world rollouts" tone />
      </div>
      <div className="story-diagram__flow">
        <DiagramBox title="Feature encoder" detail="updated with both datasets" tone />
        <Arrow />
        <DiagramBox title="RL policy" detail="weights frozen" />
        <Arrow />
        <span className="story-diagram__output">Action</span>
      </div>
      <div className="story-diagram__findings story-diagram__findings--single">
        <span>Removing the learned feature barely changed control—the policy had learned to work around it</span>
      </div>
    </div>
  )
}

function ForceConditioning() {
  return (
    <div
      className="story-diagram"
      role="img"
      aria-label="A learned dynamics feature scales and shifts hidden policy features. A separate training-only diagnostic replaces it with true physical parameters."
    >
      <div className="story-diagram__comparison">
        <section>
          <small>Learned path</small>
          <DiagramBox title="Dynamics feature" detail="estimated from history" tone />
          <Arrow />
          <DiagramBox title="Feature modulation" detail="scale + shift inside the policy" />
          <Arrow />
          <DiagramBox title="Policy" />
        </section>
        <section>
          <small>Training-only diagnostic</small>
          <DiagramBox title="True physical parameters" detail="for example, payload mass" />
          <Arrow />
          <DiagramBox title="Policy" detail="measures the attainable upper bound" />
        </section>
      </div>
      <div className="story-diagram__findings story-diagram__findings--single">
        <span>Stronger feature dependence, but prediction-based adaptation still moved it toward the wrong control input</span>
      </div>
    </div>
  )
}

function Coprediction() {
  return (
    <div
      className="story-diagram"
      role="img"
      aria-label="A shared Transformer consumes recent history and a command, then predicts both future motion and the next action."
    >
      <div className="story-diagram__flow story-diagram__flow--centered">
        <DiagramBox title="History + command" />
        <Arrow />
        <DiagramBox title="Shared Transformer" detail="one set of features for two jobs" tone />
        <Arrow />
        <span className="story-diagram__outputs">
          <DiagramBox title="Predicted motion" />
          <DiagramBox title="Predicted action" />
        </span>
      </div>
      <p className="story-diagram__update">Target motion prediction updates the shared model—and therefore also changes action generation.</p>
      <div className="story-diagram__findings">
        <span>Prediction loss could decrease</span>
        <span className="story-diagram__finding--bad">Control did not improve reliably</span>
      </div>
    </div>
  )
}

function PlannerIdm() {
  return (
    <div
      className="story-diagram story-diagram--fada"
      role="img"
      aria-label="A frozen motion planner turns the command into intended motion. An adaptable execution model converts that intent into the next action. Target rollouts update only the execution model."
    >
      <div className="story-diagram__flow story-diagram__flow--centered">
        <DiagramBox title="Command + recent execution" />
        <Arrow />
        <DiagramBox title="Motion planner" detail="intent · frozen" />
        <Arrow />
        <DiagramBox title="Execution model" detail="dynamics-sensitive · adapted" tone />
        <Arrow />
        <span className="story-diagram__output">Action</span>
      </div>
      <div className="story-diagram__adapt">
        <span><b>Target rollouts</b><small>realized motion + executed actions</small></span>
        <Arrow />
        <span><b>Supervised low-rank update</b><small>execution model only</small></span>
      </div>
    </div>
  )
}

const baselines = [
  ['TF-DAgger', 'One imitation policy', 'No target update'],
  ['Co-prediction zero-shot', 'Shared motion/action model', 'No target update'],
  ['Co-prediction adapted', 'Shared motion/action model', 'Future-prediction update'],
  ['FADA', 'Frozen planner + execution model', 'Execution model only'],
] as const

function Baselines() {
  return (
    <div
      className="story-diagram story-diagram--baselines"
      role="img"
      aria-label="Four baselines use the same source teacher, source data, and target rollout budget. They differ in architecture and where the target update is applied."
    >
      <div className="story-diagram__baseline-head">
        <span>Method</span><span>Controller interface</span><span>Target-data update</span>
      </div>
      {baselines.map(([method, controller, update]) => (
        <div className={`story-diagram__baseline${method === 'FADA' ? ' story-diagram__baseline--fada' : ''}`} key={method}>
          <b>{method}</b><span>{controller}</span><strong>{update}</strong>
        </div>
      ))}
      <p className="story-diagram__baseline-note">
        <b>TF-DAgger</b> is a single distilled policy. <b>Co-prediction</b> is the shared
        motion/action Transformer from the previous section. <b>FADA</b> splits motion planning
        from action execution. “Zero-shot” means evaluated before any target update.
      </p>
    </div>
  )
}

export const STORY_DIAGRAMS = {
  'better-latent': {
    render: BetterLatent,
    caption:
      'Experiment 1 kept one latent. Source-simulator dynamics labels added a contrastive loss to the usual next-state prediction loss, then a policy was trained to use that latent.',
  },
  disentangle: {
    render: Disentangle,
    caption:
      'Experiment 2 gave the two confounds separate encoders. The second feature was not the goal in itself \u2014 it existed so that policy style became something explicit a loss could push out of the dynamics feature.',
  },
  'real-loop': {
    render: RealLoop,
    caption:
      'A small target dataset was mixed with source data to update only the encoder. The frozen policy remained largely insensitive to its output.',
  },
  'force-conditioning': {
    render: ForceConditioning,
    caption:
      'Feature-wise linear modulation made the policy read the learned dynamics feature throughout its network. True physical parameters were used only as a diagnostic during training.',
  },
  coprediction: {
    render: Coprediction,
    caption:
      'One shared model predicted future motion and the next action. This tied target supervision more directly to control, but the two objectives could still interfere.',
  },
  'planner-idm': {
    render: PlannerIdm,
    caption:
      'FADA freezes motion intent and adapts only the dynamics-dependent mapping from intended motion to action.',
  },
  baseline: {
    render: Baselines,
    caption:
      'The source teacher, source data, and target rollout budget are held fixed. The important difference is where target supervision is allowed to change the controller.',
  },
} as const

export type StoryDiagramId = keyof typeof STORY_DIAGRAMS
