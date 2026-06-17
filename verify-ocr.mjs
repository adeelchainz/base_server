import { chromium } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Use a Windows system image with visible text
const TEST_IMAGE = 'C:/Windows/Web/Screen/img100.jpg'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

// Capture console errors
const consoleErrors = []
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
page.on('pageerror', err => consoleErrors.push(err.message))

console.log('=== Step 1: Navigate to http://localhost:3001 ===')
const res = await page.goto('http://localhost:3001', { waitUntil: 'networkidle' })
console.log('Final URL:', page.url())
console.log('Status:', res?.status())

await page.screenshot({ path: 'C:/Users/ASSIG/AppData/Local/Temp/ocr-01-landing.png' })
console.log('Screenshot: ocr-01-landing.png')

console.log('\n=== Step 2: Check OCR page loaded ===')
const heading = await page.textContent('span.font-bold').catch(() => null)
console.log('Heading text:', heading)

const uploaderVisible = await page.isVisible('text=Drop image here').catch(() => false)
console.log('Uploader visible:', uploaderVisible)

console.log('\n=== Step 3: Upload test image ===')
const fileInput = page.locator('input[type="file"]')
await fileInput.setInputFiles(TEST_IMAGE)
console.log('File set:', TEST_IMAGE)

// Wait for result or error (OCR can take a while)
console.log('Waiting for result (up to 60s)...')
try {
  await page.waitForSelector('text=Extracted Text, text=Extraction failed, text=File too large', {
    timeout: 60000
  })
} catch {
  // try alternate selectors
}

await page.screenshot({ path: 'C:/Users/ASSIG/AppData/Local/Temp/ocr-02-result.png' })
console.log('Screenshot: ocr-02-result.png')

const resultText = await page.textContent('.bg-\\[\\#16213e\\]').catch(() => null)
console.log('Result panel text:', resultText?.slice(0, 200))

// Check for confidence badge
const confidenceBadge = await page.locator('text=/Confidence: \\d+%/').textContent().catch(() => null)
console.log('Confidence badge:', confidenceBadge)

const pipelineBadge = await page.locator('text=/Pipeline:/').textContent().catch(() => null)
console.log('Pipeline badge:', pipelineBadge)

console.log('\n=== Step 4: Probe — upload unsupported file type ===')
await page.reload({ waitUntil: 'networkidle' })
// The file input only accepts image/* types — try changing accept via JS
await page.evaluate(() => {
  const input = document.querySelector('input[type="file"]')
  if (input) input.removeAttribute('accept')
})
// Upload a .txt file by creating a fake text blob
const [fileChooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null),
  page.locator('div.border-dashed').click()
])
console.log('File chooser opened:', !!fileChooser)

console.log('\n=== Step 5: Probe — CORS check ===')
const corsResult = await page.evaluate(async () => {
  try {
    const r = await fetch('http://localhost:3000/v1/ocr/extract', {
      method: 'POST',
      credentials: 'include',
      body: new FormData() // empty — will get 422
    })
    return { status: r.status, cors: 'OK' }
  } catch (e) {
    return { error: e.message, cors: 'BLOCKED' }
  }
})
console.log('CORS probe result:', corsResult)

console.log('\n=== Console errors captured ===')
console.log(consoleErrors.length ? consoleErrors.join('\n') : 'none')

await browser.close()
