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

let abortCtrl: AbortController | null = null
let linesMeta: LinesMeta = {}

panelClose.addEventListener('click', () => closePanel())

function closePanel() {
  panel.hidden = true
  panelBody.innerHTML = ''
  abortCtrl?.abort()
  abortCtrl = null
}

function openPanel(html: string) {
  panelBody.innerHTML = html
  panel.hidden = false
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function renderTrains(title: string, trains: TrainStop[]): string {
  if (!trains.length) {
    return `<div class="schedule-block"><h3>${escapeHtml(title)}</h3><p class="meta">此方向暫無班次。</p></div>`
  }
  const items = trains
    .slice(0, 4)
    .map((t) => {
      const mins = t.ttnt && t.ttnt !== '-' ? `${t.ttnt} 分鐘` : '—'
      const time = t.time && t.time !== '-' ? t.time : ''
      const plat = t.plat ? `月台 ${t.plat}` : ''
      const via = t.route === 'RAC' ? '經馬場' : ''
      const type =
        t.timetype === 'A' ? '到站' : t.timetype === 'D' ? '開出' : ''
      const sub = [plat, time, via, type].filter(Boolean).join(' · ')
      return `<li>
        <span class="dest">往 ${escapeHtml(destName(t.dest))}</span>
        <span class="ttnt">${escapeHtml(mins)}</span>
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

  openPanel(`
    <h2>${escapeHtml(props.nameZh)}</h2>
    <p class="meta">${escapeHtml(props.nameEn)} · ${escapeHtml(props.code)}</p>
    <div>${chips}</div>
    <div class="status-box info">正在查詢到站班次…</div>
  `)

  abortCtrl?.abort()
  abortCtrl = new AbortController()
  const signal = abortCtrl.signal

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
        ${renderTrains('上行', result.up)}
        ${renderTrains('下行', result.down)}
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

  openPanel(`
    <h2>${escapeHtml(props.nameZh)}</h2>
    <p class="meta">${escapeHtml(props.nameEn)} · ${escapeHtml(props.code)}</p>
    <div>${chips}</div>
    ${blocks.join('') || '<div class="status-box">暫無資料可顯示。</div>'}
  `)
}

function showCamera(props: CameraProps) {
  const src = `${props.url}${props.url.includes('?') ? '&' : '?'}_ts=${Date.now()}`
  openPanel(`
    <h2>交通快拍</h2>
    <p class="meta">${escapeHtml(props.description)}</p>
    <p class="meta">${escapeHtml(props.region)} · ${escapeHtml(props.district)} · ${escapeHtml(props.key)}</p>
    <img class="snapshot" id="snapshot-img" alt="交通快拍 ${escapeHtml(props.key)}" src="${escapeHtml(src)}" />
    <div class="status-box info" id="snapshot-status">正在載入最新照片…</div>
  `)

  const img = document.querySelector<HTMLImageElement>('#snapshot-img')
  const status = document.querySelector<HTMLElement>('#snapshot-status')
  if (!img || !status) return

  img.addEventListener('load', () => {
    status.className = 'status-box info'
    status.textContent = '已顯示最新快拍。若畫面為「暫時未能提供服務」，代表該鏡頭現時無圖。'
  })
  img.addEventListener('error', () => {
    status.className = 'status-box'
    status.textContent = '暫時未能載入此快拍點的照片。請稍後再試，或改選其他快拍點。'
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

    map.on('click', 'mtr-stations-circle', (e) => {
      const f = e.features?.[0]
      if (!f) return
      e.originalEvent.stopPropagation()
      void showStation(f.properties as StationProps)
    })

    map.on('click', 'cameras-circle', (e) => {
      const f = e.features?.[0]
      if (!f) return
      e.originalEvent.stopPropagation()
      showCamera(f.properties as CameraProps)
    })

    map.on('click', () => {
      // keep panel open until user closes; no auto-close on map click for mobile usability
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
