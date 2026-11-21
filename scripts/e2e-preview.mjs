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
await page.waitForFunction(() => {
  const m = window.__hkMap
  return m && m.getLayer && m.getLayer('mtr-stations-circle') && m.getLayer('cameras-circle')
}, null, { timeout: 90000 })
await page.waitForTimeout(5000)

const overview = await page.evaluate(() => {
  const m = window.__hkMap
  const canvas = m.getCanvas()
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
  return {
    hasMap: !!m,
    zoom: m.getZoom(),
    center: m.getCenter(),
    layers: ['mtr-lines-core', 'mtr-stations-circle', 'cameras-circle'].map((id) => !!m.getLayer(id)),
    webgl: !!gl,
  }
})
report.steps.push({
  step: 'map_loaded',
  pass: overview.hasMap && overview.layers.every(Boolean) && !report.workerError,
  overview,
})
await page.screenshot({ path: `${out}/01_map_overview.png` })

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

// Wait for rendered station results (not the loading marker).
await page.waitForFunction(
  () => document.querySelector('#panel')?.dataset.state === 'ready',
  null,
  { timeout: 25000 },
)

await page.waitForTimeout(500)
const stationText = await page.locator('#panel-body').innerText()
report.steps.push({
  step: 'station_panel',
  pass: /金鐘/.test(stationText) && !/正在查詢到站班次/.test(stationText),
  preview: stationText.slice(0, 400),
})
await page.screenshot({ path: `${out}/02_station_arrivals.png` })

await page.click('#panel-close')
await page.waitForTimeout(500)

const camClick = await page.evaluate(async () => {
  const [cams, stations] = await Promise.all([
    fetch('/data/cameras.geojson').then((r) => r.json()),
    fetch('/data/mtr-stations.geojson').then((r) => r.json()),
  ])
  const target = [114.166, 22.278]
  let best = null
  let bestScore = Infinity
  for (const f of cams.features) {
    const [lon, lat] = f.geometry.coordinates
    const dTarget = (lon - target[0]) ** 2 + (lat - target[1]) ** 2
    let minSta = Infinity
    for (const s of stations.features) {
      const [slon, slat] = s.geometry.coordinates
      const d = (lon - slon) ** 2 + (lat - slat) ** 2
      if (d < minSta) minSta = d
    }
    // Prefer cameras near Admiralty that are not stacked on a station.
    const score = dTarget + (minSta < 1e-8 ? 10 : 0)
    if (score < bestScore) {
      bestScore = score
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

const before = await page.evaluate(() => {
  const m = window.__hkMap
  const c = m.getCenter()
  return { lng: c.lng, lat: c.lat, zoom: m.getZoom() }
})
await page.mouse.move(700, 450)
await page.mouse.down()
await page.mouse.move(620, 400, { steps: 12 })
await page.mouse.up()
await page.waitForFunction((prev) => {
  const c = window.__hkMap.getCenter()
  return Math.abs(c.lng - prev.lng) > 1e-5 || Math.abs(c.lat - prev.lat) > 1e-5
}, before, { timeout: 5000 }).catch(() => {})
const afterPan = await page.evaluate(() => {
  const m = window.__hkMap
  const c = m.getCenter()
  return { lng: c.lng, lat: c.lat, zoom: m.getZoom() }
})
const panMoved =
  Math.abs(afterPan.lng - before.lng) > 1e-5 ||
  Math.abs(afterPan.lat - before.lat) > 1e-5

const zoomBefore = afterPan.zoom
await page.click('button.maplibregl-ctrl-zoom-in')
await page.waitForFunction((z) => window.__hkMap.getZoom() > z + 0.01, zoomBefore, {
  timeout: 5000,
}).catch(() => {})
const zoomAfter = await page.evaluate(() => window.__hkMap.getZoom())
const zoomed = zoomAfter > zoomBefore + 0.01

report.steps.push({
  step: 'pan_zoom',
  pass: panMoved && zoomed,
  before,
  afterPan,
  zoomBefore,
  zoomAfter,
})
await page.screenshot({ path: `${out}/04_after_pan_zoom.png` })

// Keyboard-accessible picker: open via control, filter, activate list option
await page.click('#panel-close').catch(() => {})
await page.click('#picker-open')
await page.waitForSelector('#picker:not([hidden])')
await page.fill('#picker-search', '金鐘')
const firstBtn = page.locator('#picker-list button').first()
await firstBtn.waitFor({ state: 'visible' })
await firstBtn.focus()
await firstBtn.press('Enter')
await page.locator('#picker').waitFor({ state: 'hidden', timeout: 5000 })
await page.waitForSelector('#panel:not([hidden])', { timeout: 15000 })
await page.waitForFunction(
  () =>
    document.querySelector('#panel')?.dataset.state === 'ready' &&
    (document.querySelector('#panel-body')?.textContent || '').includes('金鐘'),
  null,
  { timeout: 25000 },
)
const pickerText = await page.locator('#panel-body').innerText()
report.steps.push({
  step: 'keyboard_picker',
  pass: /金鐘/.test(pickerText) && !/正在查詢到站班次/.test(pickerText),
  preview: pickerText.slice(0, 200),
})

report.pass = report.steps.every((s) => s.pass) && !report.workerError
fs.writeFileSync(`${out}/e2e_report.json`, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
await browser.close()
process.exit(report.pass ? 0 : 1)
