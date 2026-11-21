import { chromium } from 'playwright-core'
import fs from 'node:fs'

const out = '/opt/cursor/artifacts'
fs.mkdirSync(out, { recursive: true })
const report = { steps: [], consoleErrors: [], workerError: false }

const browser = await chromium.launch({
  headless: true,
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    const t = msg.text()
    report.consoleErrors.push(t)
    if (/Worker failed to load/i.test(t)) report.workerError = true
  }
})
page.on('pageerror', (err) => {
  report.consoleErrors.push(String(err))
  if (/Worker failed to load/i.test(String(err))) report.workerError = true
})

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 })
await page.waitForFunction(() => !!window.__hkMap && window.__hkMap.isStyleLoaded?.(), null, { timeout: 60000 }).catch(() => {})
// wait for our layers
await page.waitForFunction(() => {
  const m = window.__hkMap
  return m && m.getLayer && m.getLayer('mtr-stations-circle') && m.getLayer('cameras-circle')
}, null, { timeout: 90000 })
await page.waitForTimeout(5000)

const overview = await page.evaluate(() => {
  const m = window.__hkMap
  const canvas = m.getCanvas()
  // sample a few pixels to ensure not blank
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
  return {
    hasMap: !!m,
    zoom: m.getZoom(),
    center: m.getCenter(),
    layers: ['mtr-lines-core','mtr-stations-circle','cameras-circle'].map((id) => !!m.getLayer(id)),
    webgl: !!gl,
  }
})
report.steps.push({ step: 'map_loaded', pass: overview.hasMap && overview.layers.every(Boolean) && !report.workerError, overview })
await page.screenshot({ path: `${out}/01_map_overview.png` })

// Click Admiralty via map project + mouse click
const admClick = await page.evaluate(async () => {
  const m = window.__hkMap
  const stations = await fetch('/data/mtr-stations.geojson').then((r) => r.json())
  const adm = stations.features.find((f) => f.properties.code === 'ADM')
  const p = m.project(adm.geometry.coordinates)
  const rect = m.getCanvas().getBoundingClientRect()
  return { x: rect.left + p.x, y: rect.top + p.y, name: adm.properties.nameZh }
})
await page.mouse.click(admClick.x, admClick.y)
await page.waitForSelector('#panel:not([hidden])', { timeout: 15000 })
await page.waitForFunction(() => {
  const t = document.querySelector('#panel-body')?.textContent || ''
  return t.includes('分鐘') || t.includes('暫無') || t.includes('特別') || t.includes('無法') || t.includes('暫停') || t.includes('資料')
}, null, { timeout: 20000 })
await page.waitForTimeout(1500)
const stationText = await page.locator('#panel-body').innerText()
report.steps.push({
  step: 'station_panel',
  pass: /金鐘/.test(stationText) && (/\d+\s*分鐘/.test(stationText) || /暫無|特別|無法|暫停|缺席/.test(stationText)),
  preview: stationText.slice(0, 400),
})
await page.screenshot({ path: `${out}/02_station_arrivals.png` })

await page.click('#panel-close')
await page.waitForTimeout(500)

// Click a camera near Admiralty
const camClick = await page.evaluate(async () => {
  const cams = await fetch('/data/cameras.geojson').then((r) => r.json())
  const target = [114.166, 22.278]
  let best = null
  let bestD = Infinity
  for (const f of cams.features) {
    const [lon, lat] = f.geometry.coordinates
    const d = (lon - target[0]) ** 2 + (lat - target[1]) ** 2
    if (d < bestD) {
      bestD = d
      best = f
    }
  }
  return {
    key: best.properties.key,
    desc: best.properties.description,
    coords: best.geometry.coordinates,
  }
})
await page.evaluate((coords) => {
  window.__hkMap.easeTo({ center: coords, zoom: 14, duration: 0 })
}, camClick.coords)
await page.waitForTimeout(1000)
const camClick2 = await page.evaluate(async (key) => {
  const m = window.__hkMap
  const cams = await fetch('/data/cameras.geojson').then((r) => r.json())
  const best = cams.features.find((f) => f.properties.key === key)
  const p = m.project(best.geometry.coordinates)
  const rect = m.getCanvas().getBoundingClientRect()
  return { x: rect.left + p.x, y: rect.top + p.y }
}, camClick.key)
await page.mouse.click(camClick2.x, camClick2.y)
await page.waitForSelector('#panel:not([hidden])', { timeout: 15000 })
await page.waitForSelector('#snapshot-img', { timeout: 10000 })
// wait load or error status
await page.waitForFunction(() => {
  const s = document.querySelector('#snapshot-status')?.textContent || ''
  return s.includes('已顯示') || s.includes('未能載入') || s.includes('未能提供')
}, null, { timeout: 20000 })
const camText = await page.locator('#panel-body').innerText()
const imgOk = await page.evaluate(() => {
  const img = document.querySelector('#snapshot-img')
  return !!(img && img.complete && img.naturalWidth > 0)
})
report.steps.push({
  step: 'camera_panel',
  pass: /交通快拍/.test(camText) && (imgOk || /未能/.test(camText)),
  imgOk,
  preview: camText.slice(0, 300),
  camera: camClick.key,
})
await page.screenshot({ path: `${out}/03_camera_snapshot.png` })

// pan/zoom
await page.mouse.move(700, 450)
await page.mouse.down()
await page.mouse.move(650, 420, { steps: 8 })
await page.mouse.up()
await page.click('button.maplibregl-ctrl-zoom-in')
await page.waitForTimeout(800)
report.steps.push({ step: 'pan_zoom', pass: true })
await page.screenshot({ path: `${out}/04_after_pan_zoom.png` })

report.pass = report.steps.every((s) => s.pass) && !report.workerError
fs.writeFileSync(`${out}/e2e_report.json`, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
await browser.close()
process.exit(report.pass ? 0 : 1)
