import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const browser = await chromium.launch({ args: ['--no-sandbox', '--enable-unsafe-swiftshader'] })
const errors = []
await mkdir('tests/artifacts/research', { recursive: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(process.env.TEST_URL || 'http://localhost:5177/')
  await page.locator('#hardware video').first().waitFor({ timeout: 10000 })
  assert.equal(await page.getByRole('tablist', { name: 'Hardware experiments' }).getByRole('tab').count(), 4)
  await page.getByRole('tab', { name: 'Turning', exact: true }).click()
  assert.match(await page.locator('#hardware').innerText(), /0.8/)
  assert.match(await page.locator('#recordings-pending').innerText(), /Torso height/)
  assert.match(await page.locator('#recordings-pending').innerText(), /Teacher/)
  await page.locator('#orbit-family').scrollIntoViewIfNeeded()
  await page.getByRole('tab', { name: '8D', exact: true }).click()
  await page.locator('#orbit-family svg[data-chart]').first().waitFor()
  assert.equal(await page.getByRole('tab', { name: '8D', exact: true }).getAttribute('aria-selected'), 'true')
  const before = await page.locator('#orbit-family svg[data-chart]').first().innerHTML()
  await page.getByRole('tab', { name: '24D', exact: true }).click()
  assert.notEqual(await page.locator('#orbit-family svg[data-chart]').first().innerHTML(), before)
  await page.getByLabel('Orbit phase', { exact: true }).fill('0.5')
  for (const id of ['distance-evidence', 'tracking-evidence', 'return-evidence', 'recovery-evidence']) {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded()
    await page.locator(`#${id} svg[data-chart]`).first().waitFor()
  }
  await page.locator('#tracking-evidence select').selectOption('wz')
  await page.locator('#tracking-evidence svg[data-chart]').first().hover({ position: { x: 200, y: 140 } })
  await page.locator('#tracking-evidence [role=status]').last().waitFor()
  await page.getByLabel('Recovery command', { exact: true }).selectOption('1')
  await page.getByLabel('Push phase', { exact: true }).selectOption('0.25')
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
    await page.waitForTimeout(400)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`)
    await page.screenshot({ path: `tests/artifacts/research/page-${width}.png`, fullPage: true })
  }
  assert.deepEqual(errors, [])
  console.log('Research page: media, placeholders, dimension/phase/command interaction and responsive layout passed.')
} finally { await browser.close() }
