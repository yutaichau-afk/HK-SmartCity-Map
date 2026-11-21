export type TrainStop = {
  seq?: string
  dest?: string
  plat?: string
  time?: string
  ttnt?: string
  valid?: string
  route?: string
  timetype?: string
}

export type ScheduleResult =
  | {
      kind: 'ok'
      line: string
      station: string
      currTime?: string
      isdelay?: string
      up: TrainStop[]
      down: TrainStop[]
    }
  | {
      kind: 'alert'
      message: string
      url?: string
      currTime?: string
    }
  | {
      kind: 'empty'
      line: string
      station: string
      message: string
      isdelay?: string
    }
  | {
      kind: 'error'
      message: string
    }

const DEST_NAMES: Record<string, string> = {
  HOK: '香港',
  KOW: '九龍',
  TSY: '青衣',
  AIR: '機場',
  AWE: '博覽館',
  OLY: '奧運',
  NAC: '南昌',
  LAK: '荔景',
  SUN: '欣澳',
  TUC: '東涌',
  WKS: '烏溪沙',
  MOS: '馬鞍山',
  HEO: '恆安',
  TSH: '大水坑',
  SHM: '石門',
  CIO: '第一城',
  STW: '沙田圍',
  CKT: '車公廟',
  TAW: '大圍',
  HIK: '顯徑',
  DIH: '鑽石山',
  KAT: '啟德',
  SUW: '宋皇臺',
  TKW: '土瓜灣',
  HOM: '何文田',
  HUH: '紅磡',
  ETS: '尖東',
  AUS: '柯士甸',
  MEF: '美孚',
  TWW: '荃灣西',
  KSR: '錦上路',
  YUL: '元朗',
  LOP: '朗屏',
  TIS: '天水圍',
  SIH: '兆康',
  TUM: '屯門',
  NOP: '北角',
  QUB: '鰂魚涌',
  YAT: '油塘',
  TIK: '調景嶺',
  TKO: '將軍澳',
  LHP: '康城',
  HAH: '坑口',
  POA: '寶琳',
  ADM: '金鐘',
  EXC: '會展',
  MKK: '旺角東',
  KOT: '九龍塘',
  SHT: '沙田',
  FOT: '火炭',
  RAC: '馬場',
  UNI: '大學',
  TAP: '大埔墟',
  TWO: '太和',
  FAN: '粉嶺',
  SHS: '上水',
  LOW: '羅湖',
  LMC: '落馬洲',
  OCP: '海洋公園',
  WCH: '黃竹坑',
  LET: '利東',
  SOH: '海怡半島',
  CEN: '中環',
  TST: '尖沙咀',
  JOR: '佐敦',
  YMT: '油麻地',
  MOK: '旺角',
  PRE: '太子',
  SSP: '深水埗',
  CSW: '長沙灣',
  LCK: '荔枝角',
  KWF: '葵芳',
  KWH: '葵興',
  TWH: '大窩口',
  TSW: '荃灣',
  KET: '堅尼地城',
  HKU: '香港大學',
  SYP: '西營盤',
  SHW: '上環',
  WAC: '灣仔',
  CAB: '銅鑼灣',
  TIH: '天后',
  FOH: '炮台山',
  TAK: '太古',
  SWH: '西灣河',
  SKW: '筲箕灣',
  HFC: '杏花邨',
  CHW: '柴灣',
  WHA: '黃埔',
  SKM: '石硤尾',
  LOF: '樂富',
  WTS: '黃大仙',
  CHH: '彩虹',
  KOB: '九龍灣',
  NTK: '牛頭角',
  KWT: '觀塘',
  LAT: '藍田',
  DIS: '迪士尼',
}

export function destName(code?: string): string {
  if (!code) return '未知目的地'
  return DEST_NAMES[code] || code
}

export function lineLabel(
  line: string,
  linesMeta: Record<string, { nameZh: string; color: string }>,
): string {
  return linesMeta[line]?.nameZh || line
}

export async function fetchSchedule(
  line: string,
  station: string,
  signal?: AbortSignal,
): Promise<ScheduleResult> {
  const url = `https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${encodeURIComponent(line)}&sta=${encodeURIComponent(station)}&lang=TC`
  try {
    const res = await fetch(url, { signal })
    if (res.status === 429) {
      return { kind: 'error', message: '查詢太頻繁，港鐵資料暫時限流。請稍後再試。' }
    }
    if (!res.ok) {
      return { kind: 'error', message: `無法取得班次資料（HTTP ${res.status}）。` }
    }
    const data = (await res.json()) as {
      status?: number | string
      message?: string
      url?: string
      curr_time?: string
      cur_time?: string
      isdelay?: string
      data?: Record<
        string,
        {
          UP?: TrainStop[]
          DOWN?: TrainStop[]
          curr_time?: string
        }
      >
    }

    const status = Number(data.status)
    if (status === 0) {
      return {
        kind: 'alert',
        message: data.message || '此綫／車站現有特別車務或服務暫停。',
        url: data.url,
        currTime: data.curr_time || data.cur_time,
      }
    }

    const key = `${line}-${station}`
    const block = data.data?.[key]
    const up = (block?.UP || []).filter((t) => t.valid !== 'N')
    const down = (block?.DOWN || []).filter((t) => t.valid !== 'N')

    if (!up.length && !down.length) {
      return {
        kind: 'empty',
        line,
        station,
        isdelay: data.isdelay,
        message:
          data.isdelay === 'V'
            ? '暫時沒有到站班次資料（資料缺席）。'
            : '暫時沒有即將到站的班次。',
      }
    }

    return {
      kind: 'ok',
      line,
      station,
      currTime: block?.curr_time || data.curr_time,
      isdelay: data.isdelay,
      up,
      down,
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return { kind: 'error', message: '已取消查詢。' }
    }
    return { kind: 'error', message: '網絡錯誤，未能讀取港鐵到站資料。' }
  }
}
