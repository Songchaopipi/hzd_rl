import { chromium } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const url = process.env.TEST_URL || 'http://localhost:5176/'
await mkdir('tests/artifacts', { recursive: true })
const browser = await chromium.launch({ args: ['--no-sandbox', '--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  page.on('console', msg => { if (msg.type() === 'error') console.error(msg.text()) })
  await page.goto(url)
  if (!process.env.CORE_ONLY) {
  await page.getByRole('button', { name: 'Launch', exact: true }).click()
  await page.getByRole('button', { name: 'Pause', exact: true }).waitFor({ timeout: 180000 })
  console.log('Launched')
  await page.waitForTimeout(3000)
  console.log('Initial:', await page.locator('.locomotion-toolbar').innerText())
  await page.waitForFunction(target => Number(document.querySelector('.locomotion-clock b')?.textContent?.split(' ')[0]) >= target, Number(process.env.SCENE_SMOKE_SECONDS || 5), { timeout: 120000 })
  console.log('Live:', await page.locator('.locomotion-readouts').allTextContents())
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await page.waitForTimeout(300)
  const paused = await page.locator('.locomotion-clock b').first().textContent()
  await page.waitForTimeout(400)
  assert.equal(await page.locator('.locomotion-clock b').first().textContent(), paused)
  const initialPixels = []
  for (const [i, canvas] of (await page.locator('canvas').all()).entries()) {
    initialPixels.push(await canvas.screenshot({path: `tests/artifacts/desktop-canvas-${i}.png`}))
  }
  // Full-page CDP capture temporarily resizes the viewport and changes OrbitControls.
  // Inspect live canvas framing first; the reset below restores both views afterward.
  await page.screenshot({ path: 'tests/artifacts/desktop.png', fullPage: true })
  await page.getByRole('button', { name: 'Reset both worlds' }).click()
  await page.waitForFunction(() => document.querySelector('.locomotion-clock b')?.textContent === '0.00 s')
  assert.equal(await page.locator('.locomotion-clock b').first().textContent(), '0.00 s')
  await page.getByRole('button', { name: 'Stop command' }).click()
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.locomotion-command input[type=number]')).slice(0, 3).every(x => Number(x.value) === 0))
  assert.deepEqual(await page.locator('.locomotion-command input[type=number]').evaluateAll(xs => xs.slice(0, 3).map(x => Number(x.value))), [0, 0, 0])
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await page.getByLabel('Direction', { exact: true }).selectOption('+Y')
  await page.getByRole('button', { name: 'Push Both' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(300)
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  for (const [i, canvas] of (await page.locator('canvas').all()).entries()) {
    const pixels = await canvas.screenshot({path: `tests/artifacts/mobile-canvas-${i}.png`})
    assert(!pixels.equals(initialPixels[i]))
  }
  await page.screenshot({ path: 'tests/artifacts/mobile.png', fullPage: true })
  assert.equal(errors.length, 0, errors.join('\n'))
  }

  if (!process.env.TEST_URL) {
    const reference = JSON.parse(await readFile('tests/reference.json', 'utf8'))
    const result = await page.evaluate(async reference => {
      const { loadPhysics, loadPolicy } = await import('/src/phase2/locomotion/assets.ts')
      const { buildObservation } = await import('/src/phase2/locomotion/math.ts')
      const { G1World } = await import('/src/phase2/locomotion/G1World.ts')
      const ort = await import('/node_modules/.vite/deps/onnxruntime-web_wasm.js')
      const { mj, model, manifest } = await loadPhysics()
      const stats = { version: mj.mj_versionString(), maxObservationError: 0, maxActionError: 0, worlds: [] }
      for (const asset of manifest.policies) {
        const session = await loadPolicy(asset)
        for (const ref of reference) {
          const obs = buildObservation(asset.config, ref.qpos, ref.qvel, ref.previous, ref.command, ref.step)
          stats.maxObservationError = Math.max(stats.maxObservationError, ...obs.map((x, i) => Math.abs(x - ref.obs[i])))
          const input = new ort.Tensor('float32', obs, [1, 102])
          const output = await session.run({ obs: input })
          stats.maxActionError = Math.max(stats.maxActionError, ...output.actions.data.map((x, i) => Math.abs(x - ref.actions[asset.id][i])))
          input.dispose(); output.actions.dispose()
        }
        await session.release()
        const world = new G1World(mj, model, manifest, asset)
        await world.init()
        const started = performance.now()
        for (let i = 0; i < 500; i++) await world.step([.4, 0, 0, .8, .75])
        console.log(asset.id, '500 policy steps ms', performance.now() - started)
        const frame = world.frame()
        world.push([0, 80, 0], .1)
        for (let i = 0; i < 5; i++) await world.step([.4, 0, 0, .8, .75])
        const forceAfter = world.frame().force
        world.reset()
        stats.worlds.push({ id: asset.id, frame: {base: frame.base, velocity: frame.velocity, height: frame.height, fallen: frame.fallen}, forceAfter, reset: Array.from(world.data.qpos) })
        await world.dispose()
      }
      model.delete()
      return stats
    }, reference)
    console.log(JSON.stringify(result, null, 2))
    await writeFile('tests/artifacts/browser-reference.json', JSON.stringify(result, null, 2))
    assert(result.maxObservationError < 1e-6)
    assert(result.maxActionError < 1e-4)
    for (const world of result.worlds) {
      assert.equal(world.frame.fallen, false)
      assert(world.frame.base[0] > 1)
      assert.deepEqual(world.forceAfter, [0, 0, 0])
      assert.equal(world.reset[2], .8)
    }
  }
  console.log('Browser checks passed')
} finally { await browser.close() }
