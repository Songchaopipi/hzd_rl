import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const path = new URL('../src/phase2/locomotion/math.ts', import.meta.url)
const manifest = JSON.parse(fs.readFileSync(new URL('../public/models/locomotion/manifest.json', import.meta.url)))
const reference = JSON.parse(fs.readFileSync(new URL('./reference.json', import.meta.url)))

test('native observation builder exists', () => assert.ok(fs.existsSync(path)))
test('matches native 102D order, standing phase and current-T episode clock', async () => {
  const { buildObservation } = await import(path.href)
  for (const sample of reference) {
    const obs = buildObservation(manifest.policies[0].config, sample.qpos, sample.qvel, sample.previous, sample.command, sample.step)
    assert.equal(obs.length, 102)
    obs.forEach((x, i) => assert.ok(Math.abs(x - sample.obs[i]) < 1e-6, `obs[${i}]`))
  }
})
test('PD applies action scaling and torque clipping, wrists stay at offsets', async () => {
  const { processAction, pdTorques } = await import(path.href)
  const cfg = manifest.policies[0].config
  const target = processAction(cfg, Array(29).fill(100))
  for (const i of [19, 20, 21, 26, 27, 28]) assert.equal(target[i], cfg.action_offset[i])
  const tau = pdTorques(cfg, target, cfg.initial_qpos, Array(35).fill(0))
  tau.forEach((x, i) => assert.ok(Math.abs(x) <= cfg.effort_limit[i]))
})
test('rejects nonfinite state and invalid T rather than running broken inference', async () => {
  const { buildObservation } = await import(path.href)
  const cfg = manifest.policies[0].config
  assert.throws(() => buildObservation(cfg, cfg.initial_qpos, Array(35).fill(NaN), Array(29).fill(0), [.4, 0, 0, .8, .75], 0))
  assert.throws(() => buildObservation(cfg, cfg.initial_qpos, Array(35).fill(0), Array(29).fill(0), [.4, 0, 0, 0, .75], 0))
})
test('inverse rotation preserves physical gravity for non-upright base', async () => {
  const { inverseRotate } = await import(path.href)
  const out = inverseRotate([Math.SQRT1_2, Math.SQRT1_2, 0, 0], [0, 0, -1])
  out.forEach((x, i) => assert.ok(Math.abs(x - [0, -1, 0][i]) < 1e-10))
})
