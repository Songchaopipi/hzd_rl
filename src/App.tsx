import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { LocomotionDemo } from './phase2/locomotion/LocomotionDemo'
import { assetUrl } from './lib/assetUrl'
import { Hardware } from './research/Hardware'
import { Evidence } from './research/Evidence'
import { SectionHeading, useJson } from './research/shared'

export function App() {
  const { data: paper } = useJson<{ title: string; abstract: string }>('hzd/paper.json')
  return <>
    <header className="project-header">
      <a className="project-name" href="#top"><b>HZD</b><span>Humanoid Locomotion</span></a>
      <nav aria-label="Project"><a href="#hardware">Hardware</a><a href="#framework">Method</a><a href="#simulation">Simulation</a><a href="#evidence">Results</a></nav>
    </header>
    <main id="top">
      <section className="project-heading page-width">
        <p className="eyebrow">Research project / Robotics &amp; Learning</p>
        <h1>Revealing Hybrid Zero-Dynamics Structure in Reinforcement Learning Policies for Humanoid Locomotion</h1>
        <div className="project-intro"><p>From learned periodic orbits to whole-body locomotion.</p><a href="#framework">Explore the framework <ArrowDownRight size={18}/></a></div>
      </section>
      <Hardware />
      <section id="abstract" className="abstract-section page-width">
        <div><p className="eyebrow">The question</p><h2>What structure does a locomotion policy learn?</h2></div>
        <div><p className="abstract-lead">An HZD-inspired view of learned locomotion: periodic motion within an orbit family, and recovery toward its neighborhood.</p><details><summary>Abstract</summary><p>{paper?.abstract || 'Loading abstract...'}</p></details></div>
      </section>
      <section id="framework" className="page-width research-section framework-section">
        <SectionHeading number="01" eyebrow="Method" title="Learn the orbits. Reuse the structure."><p>Teacher trajectories provide a latent model. A frozen encoder, decoder and dynamics model then define an orbit-tube objective for policy learning.</p></SectionHeading>
        <a href={assetUrl('hzd/framework.png')} target="_blank" rel="noreferrer"><img src={assetUrl('hzd/framework.png')} loading="lazy" alt="HZD framework: teacher trajectories, learned latent dynamics, and orbit-tube reinforcement learning" /></a>
        <div className="method-stages"><div><span>01 / Identify</span><h3>Latent orbit family</h3><p>State reconstruction, control-rate evolution and same-foot returns.</p></div><div><span>02 / Shape</span><h3>Orbit-tube objective</h3><p>Local orbit alignment, distance outside the tube and progress toward it.</p></div><div><span>03 / Deploy</span><h3>A standalone policy</h3><p>The latent model guides training. The trained policy runs on the robot.</p></div></div>
      </section>
      <section id="simulation" className="simulation-band"><div className="page-width research-section">
        <SectionHeading number="02" eyebrow="Live simulation" title="Teacher and Orbit-Tube, side by side"><p>Independent MuJoCo worlds, identical commands and applied forces.</p></SectionHeading>
        <LocomotionDemo />
        <p className="cohort-note">WBO5 deployment policies. The paper experiments below use their separately documented historical checkpoints.</p>
      </div></section>
      <section id="evidence" className="page-width evidence-intro">
        <SectionHeading number="03" eyebrow="Experimental evidence" title="From orbit structure to physical recovery"><p>Model-space geometry, policy tracking and physical perturbation trials provide complementary empirical evidence.</p></SectionHeading>
        <nav aria-label="Experiments" className="evidence-index"><a href="#orbit-family">01 Orbit families</a><a href="#distance-evidence">02 Distance saturation</a><a href="#tracking-evidence">03 Command tracking</a><a href="#return-evidence">04 Same-foot returns</a><a href="#recovery-evidence">05 Perturbation recovery</a></nav>
      </section>
      <Evidence />
    </main>
    <footer className="project-footer page-width"><div><b>HZD</b><span>Humanoid locomotion through learned orbit structure.</span></div><a href="#top">Back to top <ArrowUpRight size={14}/></a></footer>
  </>
}
