/**
 * Build static GeoJSON for MTR stations/lines and TD traffic cameras.
 * Sources: MTR lines CSV, Next Train line list, Lands D CSDI venues, TD camera CSV.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(__dirname, '../public/data')
const UA = {
  'User-Agent':
    'HKSmartCityMap/1.0 (classroom; +https://github.com/; data build)',
  Accept: '*/*',
}

const LINE_META = {
  AEL: { nameZh: '機場快綫', color: '#00888A' },
  TCL: { nameZh: '東涌綫', color: '#F25F12' },
  TML: { nameZh: '屯馬綫', color: '#9A3B26' },
  TKL: { nameZh: '將軍澳綫', color: '#6B2080' },
  EAL: { nameZh: '東鐵綫', color: '#5EB7E8' },
  SIL: { nameZh: '南港島綫', color: '#B5BD00' },
  TWL: { nameZh: '荃灣綫', color: '#E2231A' },
  ISL: { nameZh: '港島綫', color: '#0071BB' },
  KTL: { nameZh: '觀塘綫', color: '#00A040' },
  DRL: { nameZh: '迪士尼綫', color: '#F59331' },
}

async function fetchText(url) {
  const res = await fetch(url, { headers: UA })
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return res.text()
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: UA })
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return res.json()
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/)
  const headers = splitCsvLine(lines[0])
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = splitCsvLine(line)
    const row = {}
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? ''
    })
    return row
  })
}

function splitCsvLine(line) {
  const out = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQ = !inQ
      }
    } else if (c === ',' && !inQ) {
      out.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  out.push(cur)
  return out
}

function parseTsv(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/)
  const headers = lines[0].split('\t')
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = line.split('\t')
    const row = {}
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? ''
    })
    return row
  })
}

function allCoords(geom) {
  const { type, coordinates } = geom
  if (type === 'Polygon') return coordinates[0]
  if (type === 'MultiPolygon') {
    const out = []
    for (const poly of coordinates) out.push(...poly[0])
    return out
  }
  throw new Error(`Unsupported geometry ${type}`)
}

function centroid(geom) {
  const coords = allCoords(geom)
  const xs = coords.map((c) => c[0])
  const ys = coords.map((c) => c[1])
  return [xs.reduce((a, b) => a + b, 0) / xs.length, ys.reduce((a, b) => a + b, 0) / ys.length]
}

function normZh(s) {
  return String(s || '').replace(/(鐵路站|港鐵站|站)$/u, '')
}

function normEn(s) {
  return String(s || '')
    .replace(/\s+Station$/i, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

async function buildMtr() {
  const csvText = await fetchText(
    'https://opendata.mtr.com.hk/data/mtr_lines_and_stations.csv',
  )
  const rows = parseCsv(csvText).filter((r) => r['Line Code'])

  const stations = new Map()
  for (const r of rows) {
    const code = r['Station Code']
    if (!stations.has(code)) {
      stations.set(code, {
        code,
        nameZh: r['Chinese Name'],
        nameEn: r['English Name'],
        stationId: r['Station ID'],
        lines: new Set(),
      })
    }
    stations.get(code).lines.add(r['Line Code'])
  }

  const venue = await fetchJson(
    'https://mapapi.hkmapservice.gov.hk/ogc/wfs/indoor/mtr_venue_polygon?service=WFS&version=1.1.0&request=GetFeature&outputFormat=application%2Fjson',
  )

  const byZh = new Map()
  const byEn = new Map()
  for (const [code, s] of stations) {
    byZh.set(normZh(s.nameZh), code)
    byEn.set(normEn(s.nameEn), code)
    byEn.set(normEn(s.nameEn).replace(/\s+/g, ''), code)
  }

  const coords = new Map()
  for (const f of venue.features) {
    const p = f.properties
    const code =
      byZh.get(normZh(p.venue_name_zh)) ||
      byEn.get(normEn(p.venue_name_en)) ||
      byEn.get(normEn(p.venue_name_en).replace(/\s+/g, ''))
    if (!code || coords.has(code)) continue
    const [lon, lat] = centroid(f.geometry)
    coords.set(code, [lon, lat])
  }

  const missing = [...stations.keys()].filter((c) => !coords.has(c))
  if (missing.length) {
    throw new Error(`Missing coordinates for stations: ${missing.join(', ')}`)
  }

  const stationFeatures = [...stations.values()].map((s) => {
    const lines = [...s.lines].sort()
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords.get(s.code) },
      properties: {
        code: s.code,
        nameZh: s.nameZh,
        nameEn: s.nameEn,
        lines: lines.join(','),
        linesArr: lines,
        primaryLine: lines[0],
        color: LINE_META[lines[0]]?.color || '#1a5f7a',
      },
    }
  })

  // Build line polylines from all directions, unique consecutive edges
  const lineFeatures = []
  const byLineDir = new Map()
  for (const r of rows) {
    const key = `${r['Line Code']}::${r['Direction']}`
    if (!byLineDir.has(key)) byLineDir.set(key, [])
    byLineDir.get(key).push(r)
  }

  const edgesByLine = new Map()
  for (const [key, list] of byLineDir) {
    const line = key.split('::')[0]
    const ordered = [...list].sort(
      (a, b) => Number(a.Sequence) - Number(b.Sequence),
    )
    if (!edgesByLine.has(line)) edgesByLine.set(line, new Set())
    const edgeSet = edgesByLine.get(line)
    for (let i = 0; i < ordered.length - 1; i++) {
      const a = ordered[i]['Station Code']
      const b = ordered[i + 1]['Station Code']
      const edge = a < b ? `${a}|${b}` : `${b}|${a}`
      edgeSet.add(edge)
    }
  }

  for (const [line, edgeSet] of edgesByLine) {
    // Greedy chains for display: walk unused edges into polylines
    const adj = new Map()
    for (const edge of edgeSet) {
      const [a, b] = edge.split('|')
      if (!adj.has(a)) adj.set(a, new Set())
      if (!adj.has(b)) adj.set(b, new Set())
      adj.get(a).add(b)
      adj.get(b).add(a)
    }
    const used = new Set()
    const chains = []
    for (const start of adj.keys()) {
      for (const next of adj.get(start)) {
        const e0 = start < next ? `${start}|${next}` : `${next}|${start}`
        if (used.has(e0)) continue
        const chain = [start, next]
        used.add(e0)
        let cur = next
        let prev = start
        while (true) {
          const neigh = [...adj.get(cur)].filter((n) => {
            const e = cur < n ? `${cur}|${n}` : `${n}|${cur}`
            return n !== prev && !used.has(e)
          })
          if (!neigh.length) break
          const n = neigh[0]
          const e = cur < n ? `${cur}|${n}` : `${n}|${cur}`
          used.add(e)
          chain.push(n)
          prev = cur
          cur = n
        }
        chains.push(chain)
      }
    }

    chains.forEach((chain, idx) => {
      const coordinates = chain.map((code) => coords.get(code))
      if (coordinates.some((c) => !c)) return
      lineFeatures.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates },
        properties: {
          line,
          nameZh: LINE_META[line]?.nameZh || line,
          color: LINE_META[line]?.color || '#1a5f7a',
          segment: idx,
        },
      })
    })
  }

  const stationsFc = {
    type: 'FeatureCollection',
    features: stationFeatures,
  }
  const linesFc = { type: 'FeatureCollection', features: lineFeatures }

  fs.writeFileSync(
    path.join(outDir, 'mtr-stations.geojson'),
    JSON.stringify(stationsFc),
  )
  fs.writeFileSync(
    path.join(outDir, 'mtr-lines.geojson'),
    JSON.stringify(linesFc),
  )

  const lineStationIndex = {}
  for (const r of rows) {
    const line = r['Line Code']
    const code = r['Station Code']
    if (!lineStationIndex[code]) lineStationIndex[code] = []
    if (!lineStationIndex[code].includes(line)) lineStationIndex[code].push(line)
  }
  fs.writeFileSync(
    path.join(outDir, 'mtr-index.json'),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      stationCount: stationFeatures.length,
      lineCount: Object.keys(LINE_META).length,
      lines: LINE_META,
      stationLines: lineStationIndex,
      attribution:
        'Station names/codes: MTR open data. Coordinates derived from Lands Department CSDI indoor MTR venue polygons.',
    }),
  )

  return { stationCount: stationFeatures.length, lineSegments: lineFeatures.length }
}

async function buildCameras() {
  const buf = await fetch(
    'https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_Tc.csv',
    { headers: UA },
  ).then((r) => {
    if (!r.ok) throw new Error(`camera csv ${r.status}`)
    return r.arrayBuffer()
  })
  // File is UTF-16 LE with BOM
  const text = new TextDecoder('utf-16le').decode(buf)
  const rows = parseTsv(text)
  const features = rows
    .map((r) => {
      const key = (r.key || r['\ufeffkey'] || '').trim()
      const latRaw = String(r.latitude ?? '').trim()
      const lonRaw = String(r.longitude ?? '').trim()
      if (!key || !latRaw || !lonRaw) return null
      const lat = Number(latRaw)
      const lon = Number(lonRaw)
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          key,
          region: r.region,
          district: r.district,
          description: r.description,
          url: r.url || `https://tdcctv.data.one.gov.hk/${key}.JPG`,
        },
      }
    })
    .filter(Boolean)

  const fc = { type: 'FeatureCollection', features }
  fs.writeFileSync(path.join(outDir, 'cameras.geojson'), JSON.stringify(fc))
  return { cameraCount: features.length }
}

fs.mkdirSync(outDir, { recursive: true })
const mtr = await buildMtr()
const cams = await buildCameras()
console.log(
  JSON.stringify({ ok: true, ...mtr, ...cams, outDir }, null, 2),
)
