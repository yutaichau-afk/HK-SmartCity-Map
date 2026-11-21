import {
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  ScaleControl,
  setWorkerUrl,
} from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import './style.css'

setWorkerUrl(workerUrl)
import {
  destName,
  fetchSchedule,
  lineLabel,
  type TrainStop,
} from './mtr'

type LinesMeta = Record<string, { nameZh: string; color: string }>

type StationProps = {
  code: string
  nameZh: string
  nameEn: string
  lines: string
  primaryLine: string
  color: string
}

type CameraProps = {
  key: string
  region: string
  district: string
  description: string
  url: string
}

const panel = document.querySelector<HTMLElement>('#panel')!
const panelBody = document.querySelector<HTMLElement>('#panel-body')!
const panelClose = document.querySelector<HTMLButtonElement>('#panel-close')!
const picker = document.querySelector<HTMLElement>('#picker')!
const pickerOpen = document.querySelector<HTMLButtonElement>('#picker-open')!
const pickerClose = document.querySelector<HTMLButtonElement>('#picker-close')!
const pickerSearch = document.querySelector<HTMLInputElement>('#picker-search')!
const pickerList = document.querySelector<HTMLUListElement>('#picker-list')!
const tabStations = document.querySelector<HTMLButtonElement>('#tab-stations')!
const tabCameras = document.querySelector<HTMLButtonElement>('#tab-cameras')!

let abortCtrl: AbortController | null = null
let linesMeta: LinesMeta = {}
let pickerMode: 'stations' | 'cameras' = 'stations'
let stationCatalog: StationProps[] = []
let cameraCatalog: CameraProps[] = []

panelClose.addEventListener('click', () => closePanel())
pickerOpen.addEventListener('click', () => openPicker())
pickerClose.addEventListener('click', () => closePicker())
tabStations.addEventListener('click', () => setPickerMode('stations'))
tabCameras.addEventListener('click', () => setPickerMode('cameras'))
pickerSearch.addEventListener('input', () => renderPickerList())

function openPicker() {
  picker.hidden = false
  renderPickerList()
  pickerSearch.focus()
}

function closePicker() {
  picker.hidden = true
  pickerOpen.focus({ preventScroll: true })
}

function setPickerMode(mode: 'stations' | 'cameras') {
  pickerMode = mode
  tabStations.setAttribute('aria-selected', mode === 'stations' ? 'true' : 'false')
  tabCameras.setAttribute('aria-selected', mode === 'cameras' ? 'true' : 'false')
  pickerSearch.value = ''
  renderPickerList()
  pickerSearch.focus()
}

function renderPickerList() {
  const q = pickerSearch.value.trim().toLowerCase()
  pickerList.innerHTML = ''

  if (pickerMode === 'stations') {
    const items = stationCatalog.filter((s) => {
      if (!q) return true
      return (
        s.nameZh.includes(q) ||
        s.nameEn.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        s.lines.toLowerCase().includes(q)
      )
    })
    for (const s of items) {
      const li = document.createElement('li')
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.setAttribute(
        'aria-label',
        `港鐵車站 ${s.nameZh} ${s.nameEn} ${s.code}`,
      )
      btn.innerHTML = `<strong>${escapeHtml(s.nameZh)}</strong><span class="item-meta">${escapeHtml(s.nameEn)} · ${escapeHtml(s.code)} · ${escapeHtml(s.lines)}</span>`
      btn.addEventListener('click', () => {
        closePicker()
        void showStation(s)
        panel.focus({ preventScroll: true })
      })
      li.appendChild(btn)
      pickerList.appendChild(li)
    }
    if (!items.length) {
      pickerList.innerHTML = '<li class="meta">沒有符合的車站。</li>'
    }
    return
  }

  const items = cameraCatalog.filter((c) => {
    if (!q) return true
    return (
      c.description.toLowerCase().includes(q) ||
      c.key.toLowerCase().includes(q) ||
      c.district.includes(q) ||
      c.region.includes(q)
    )
  })
  for (const c of items) {
    const li = document.createElement('li')
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('aria-label', `交通快拍 ${c.description}`)
    btn.innerHTML = `<strong>${escapeHtml(c.description)}</strong><span class="item-meta">${escapeHtml(c.region)} · ${escapeHtml(c.district)} · ${escapeHtml(c.key)}</span>`
    btn.addEventListener('click', () => {
      closePicker()
      showCamera(c)
      panel.focus({ preventScroll: true })
    })
    li.appendChild(btn)
    pickerList.appendChild(li)
  }
  if (!items.length) {
    pickerList.innerHTML = '<li class="meta">沒有符合的快拍點。</li>'
  }
}

function closePanel() {
  panel.hidden = true
  panelBody.innerHTML = ''
  delete panel.dataset.state
  abortCtrl?.abort()
  abortCtrl = null
  pickerOpen.focus({ preventScroll: true })
}

function openPanel(html: string, state: 'loading' | 'ready' = 'ready') {
  panelBody.innerHTML = html
  panel.dataset.state = state
  panel.hidden = false
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** Parse MTR local timestamps as Asia/Hong_Kong (+08:00), never as the browser zone. */
function parseMtrTime(value: string): number {
  // API values look like "2026-11-21 16:31:09" with no offset.
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const withOffset = /[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)
    ? normalized
    : `${normalized}+08:00`
  return Date.parse(withOffset)
}

/** Derive minutes from documented time fields; never treat ttnt as a countdown. */
function minutesUntil(arrival?: string, curr?: string): string {
  if (!arrival || arrival === '-') return '—'
  if (!curr || curr === '-') return arrival
  const a = parseMtrTime(arrival)
  const c = parseMtrTime(curr)
  if (!Number.isFinite(a) || !Number.isFinite(c)) return arrival
  const mins = Math.max(0, Math.round((a - c) / 60000))
  return `${mins} 分鐘`
}

function renderTrains(
  title: string,
  trains: TrainStop[],
  currTime?: string,
): string {
  if (!trains.length) {
    return `<div class="schedule-block"><h3>${escapeHtml(title)}</h3><p class="meta">此方向暫無班次。</p></div>`
  }
  const items = trains
    .slice(0, 4)
    .map((t) => {
      const eta = minutesUntil(t.time, currTime)
      const time = t.time && t.time !== '-' ? t.time : ''
      const plat = t.plat ? `月台 ${t.plat}` : ''
      const via = t.route === 'RAC' ? '經馬場' : ''
      const type =
        t.timetype === 'A' ? '到站' : t.timetype === 'D' ? '開出' : ''
      const sub = [plat, time, via, type].filter(Boolean).join(' · ')
      // Minutes are relative to the API update time, not wall-clock refresh.
      const etaLabel = eta.endsWith('分鐘') ? `約 ${eta}（按更新時間）` : eta
      return `<li>
        <span class="dest">往 ${escapeHtml(destName(t.dest))}</span>
        <span class="ttnt">${escapeHtml(etaLabel)}</span>
        ${sub ? `<span class="sub">${escapeHtml(sub)}</span>` : ''}
      </li>`
    })
    .join('')
  return `<div class="schedule-block"><h3>${escapeHtml(title)}</h3><ul class="train-list">${items}</ul></div>`
}

async function showStation(props: StationProps) {
  const lines = props.lines.split(',').filter(Boolean)
  const chips = lines
    .map((line) => {
      const color = linesMeta[line]?.color || props.color
      return `<span class="line-chip"><i style="background:${color}"></i>${escapeHtml(lineLabel(line, linesMeta))}</span>`
    })
    .join('')

  // Abort any in-flight request before painting loading UI, so a superseded
  // fetch cannot leave the panel stuck on "正在查詢…".
  abortCtrl?.abort()
  abortCtrl = new AbortController()
  const signal = abortCtrl.signal

  openPanel(
    `
    <h2>${escapeHtml(props.nameZh)}</h2>
    <p class="meta">${escapeHtml(props.nameEn)} · ${escapeHtml(props.code)}</p>
    <div>${chips}</div>
    <div class="status-box info">正在查詢到站班次…</div>
  `,
    'loading',
  )

  const results = await Promise.all(
    lines.map(async (line) => ({ line, result: await fetchSchedule(line, props.code, signal) })),
  )
  if (signal.aborted) return

  const blocks: string[] = []
  for (const { line, result } of results) {
    const title = lineLabel(line, linesMeta)
    if (result.kind === 'ok') {
      const delay =
        result.isdelay === 'Y'
          ? `<div class="status-box">此綫可能出現延誤。</div>`
          : ''
      blocks.push(`
        <div class="schedule-block">
          <h3>${escapeHtml(title)}</h3>
          ${result.currTime ? `<p class="meta">更新時間：${escapeHtml(result.currTime)}</p>` : ''}
          ${delay}
        </div>
        ${renderTrains('上行', result.up, result.currTime)}
        ${renderTrains('下行', result.down, result.currTime)}
      `)
    } else if (result.kind === 'alert') {
      const link = result.url
        ? `<p><a href="${escapeHtml(result.url)}" target="_blank" rel="noreferrer">查看港鐵特別車務安排</a></p>`
        : ''
      blocks.push(`
        <div class="status-box">
          <strong>${escapeHtml(title)}</strong><br/>
          ${escapeHtml(result.message)}
          ${link}
        </div>
      `)
    } else if (result.kind === 'empty') {
      blocks.push(`
        <div class="status-box info">
          <strong>${escapeHtml(title)}</strong><br/>
          ${escapeHtml(result.message)}
        </div>
      `)
    } else {
      blocks.push(`
        <div class="status-box">
          <strong>${escapeHtml(title)}</strong><br/>
          ${escapeHtml(result.message)}
        </div>
      `)
    }
  }

  openPanel(
    `
    <h2>${escapeHtml(props.nameZh)}</h2>
    <p class="meta">${escapeHtml(props.nameEn)} · ${escapeHtml(props.code)}</p>
    <div>${chips}</div>
    ${blocks.join('') || '<div class="status-box">暫無資料可顯示。</div>'}
  `,
    'ready',
  )
}

function showCamera(props: CameraProps) {
  // Cancel any in-flight station schedule requests so they cannot replace this panel.
  abortCtrl?.abort()
  abortCtrl = null

  const src = `${props.url}${props.url.includes('?') ? '&' : '?'}_ts=${Date.now()}`
  openPanel(
    `
    <h2>交通快拍</h2>
    <p class="meta">${escapeHtml(props.description)}</p>
    <p class="meta">${escapeHtml(props.region)} · ${escapeHtml(props.district)} · ${escapeHtml(props.key)}</p>
    <img class="snapshot" id="snapshot-img" alt="交通快拍 ${escapeHtml(props.key)}" src="${escapeHtml(src)}" />
    <div class="status-box info" id="snapshot-status">正在載入最新照片…</div>
  `,
    'loading',
  )

  const img = document.querySelector<HTMLImageElement>('#snapshot-img')
  const status = document.querySelector<HTMLElement>('#snapshot-status')
  if (!img || !status) return

  img.addEventListener('load', () => {
    status.className = 'status-box info'
    status.textContent = '已顯示最新快拍。若畫面為「暫時未能提供服務」，代表該鏡頭現時無圖。'
    panel.dataset.state = 'ready'
  })
  img.addEventListener('error', () => {
    status.className = 'status-box'
    status.textContent = '暫時未能載入此快拍點的照片。請稍後再試，或改選其他快拍點。'
    panel.dataset.state = 'ready'
  })
}

async function bootstrap() {
  const [stations, lines, cameras, index] = await Promise.all([
    fetch('/data/mtr-stations.geojson').then((r) => r.json()),
    fetch('/data/mtr-lines.geojson').then((r) => r.json()),
    fetch('/data/cameras.geojson').then((r) => r.json()),
    fetch('/data/mtr-index.json').then((r) => r.json()),
  ])

  linesMeta = index.lines as LinesMeta
  stationCatalog = (stations.features as Array<{ properties: StationProps }>).map(
    (f) => f.properties,
  )
  cameraCatalog = (cameras.features as Array<{ properties: CameraProps }>).map(
    (f) => f.properties,
  )
  // Catalogs may finish after the user already opened the picker.
  if (!picker.hidden) renderPickerList()

  const map = new MapLibreMap({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: [114.17, 22.32],
    zoom: 11,
    maxBounds: [
      [113.75, 22.05],
      [114.55, 22.65],
    ],
  })

  // Used by local verification scripts in the Cursor VM.
  ;(window as unknown as { __hkMap?: MapLibreMap }).__hkMap = map

  map.addControl(new NavigationControl({ visualizePitch: false }), 'bottom-right')
  map.addControl(new ScaleControl({ maxWidth: 120 }), 'bottom-left')

  map.on('load', () => {
    map.addSource('mtr-lines', { type: 'geojson', data: lines })
    map.addSource('mtr-stations', { type: 'geojson', data: stations })
    map.addSource('cameras', { type: 'geojson', data: cameras })

    map.addLayer({
      id: 'mtr-lines-casing',
      type: 'line',
      source: 'mtr-lines',
      paint: {
        'line-color': '#ffffff',
        'line-width': 6,
        'line-opacity': 0.9,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    })

    map.addLayer({
      id: 'mtr-lines-core',
      type: 'line',
      source: 'mtr-lines',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 3.5,
        'line-opacity': 0.95,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    })

    map.addLayer({
      id: 'cameras-circle',
      type: 'circle',
      source: 'cameras',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 14, 5],
        'circle-color': '#1f6f8b',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1,
        'circle-opacity': 0.85,
      },
    })

    map.addLayer({
      id: 'mtr-stations-circle',
      type: 'circle',
      source: 'mtr-stations',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 14, 8],
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    })

    map.addLayer({
      id: 'mtr-stations-label',
      type: 'symbol',
      source: 'mtr-stations',
      minzoom: 12,
      layout: {
        'text-field': ['get', 'nameZh'],
        'text-size': 11,
        'text-offset': [0, 1.2],
        'text-font': ['Noto Sans Regular'],
        'text-optional': true,
      },
      paint: {
        'text-color': '#0f2430',
        'text-halo-color': '#f7f3ea',
        'text-halo-width': 1.5,
      },
    })

    const hover = new Popup({ closeButton: false, closeOnClick: false, offset: 12 })

    const setCursor = (on: boolean) => {
      map.getCanvas().style.cursor = on ? 'pointer' : ''
    }

    map.on('mouseenter', 'mtr-stations-circle', (e) => {
      setCursor(true)
      const f = e.features?.[0]
      if (!f || f.geometry.type !== 'Point') return
      const p = f.properties as StationProps
      hover
        .setLngLat(f.geometry.coordinates as [number, number])
        .setHTML(`<strong>${escapeHtml(p.nameZh)}</strong><br/>點選查看班次`)
        .addTo(map)
    })
    map.on('mouseleave', 'mtr-stations-circle', () => {
      setCursor(false)
      hover.remove()
    })

    map.on('mouseenter', 'cameras-circle', (e) => {
      setCursor(true)
      const f = e.features?.[0]
      if (!f || f.geometry.type !== 'Point') return
      const p = f.properties as CameraProps
      hover
        .setLngLat(f.geometry.coordinates as [number, number])
        .setHTML(`<strong>快拍</strong><br/>${escapeHtml(p.description)}`)
        .addTo(map)
    })
    map.on('mouseleave', 'cameras-circle', () => {
      setCursor(false)
      hover.remove()
    })

    // Prefer the topmost rendered feature so overlapping station/camera
    // points do not fire both handlers (which races the detail panel).
    map.on('click', (e) => {
      const feats = map.queryRenderedFeatures(e.point, {
        layers: ['mtr-stations-circle', 'cameras-circle'],
      })
      const f = feats[0]
      if (!f) return
      if (f.layer.id === 'mtr-stations-circle') {
        void showStation(f.properties as StationProps)
        return
      }
      if (f.layer.id === 'cameras-circle') {
        showCamera(f.properties as CameraProps)
      }
    })
  })

  map.on('error', (e) => {
    console.warn('map error', e.error)
  })
}

bootstrap().catch((err) => {
  openPanel(`
    <h2>地圖未能啟動</h2>
    <div class="status-box">${escapeHtml(String(err))}</div>
  `)
})
