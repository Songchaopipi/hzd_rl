import { chromium, expect } from '@playwright/test'
const browser = await chromium.launch({args: ['--no-sandbox', '--enable-unsafe-swiftshader']})
try {
  const page = await browser.newPage({viewport: {width: 900, height: 900}})
  let first = true
  await page.route('**/tube.onnx', async route => {
    if (first) { first = false; await route.fulfill({status: 503, body: 'Test failure'}) }
    else await route.continue()
  })
  await page.goto(process.env.TEST_URL || 'http://localhost:4176/')
  await page.getByRole('button', {name: 'Launch', exact: true}).click()
  await expect(page.getByRole('button', {name: 'Retry', exact: true})).toBeEnabled({timeout: 180000})
  const old = await page.locator('canvas').first().elementHandle()
  await page.getByRole('button', {name: 'Retry', exact: true}).click()
  await expect(page.getByRole('button', {name: 'Pause', exact: true})).toBeEnabled({timeout: 180000})
  await page.getByRole('button', {name: 'Pause', exact: true}).click()
  if (await old.evaluate(canvas => canvas.isConnected)) throw new Error('Retry reused lost context')
  await page.locator('canvas').first().screenshot({path: 'tests/artifacts/retry-canvas-0.png'})
  const t = page.getByRole('spinbutton', {name: 'T s', exact: true})
  await t.fill('.7'); await t.press('Enter')
  await expect(t).toHaveValue('0.7')
  await page.getByRole('spinbutton', {name: 'Torso height m', exact: true}).fill('.7')
  await page.getByRole('spinbutton', {name: 'Torso height m', exact: true}).press('Enter')
  console.log('Retry and command edit checks passed')
} finally { await browser.close() }
