import type { Pace, Reading, Snapshot, Trace } from '../types'

const DAY = 86_400_000
const WEEK = 7 * DAY
/** Marge, en points de % hebdo, autour du rythme idéal : dedans, on est "dans le rythme". */
const TOLERANCE = 3
/** Un relevé pris si près de la bascule du jour ferme la veille exactement. */
const BOUNDARY_SLACK = 5 * 60_000
/** Au-delà, la barre dit de quand date le relevé. */
const STALE_AFTER = 30 * 60_000
/** Toutes les 30 s : la carte d'usage du compte est relue, et la barre recalculée. */
export const TICK = 30_000
/** L'outil de l'app desktop qui lit la carte d'usage du compte, tous appareils confondus. */
export const USAGE_TOOL = 'mcp__ccd_session_mgmt__get_usage'
/** Largeur de la jauge en caractères (terminal) ; le SVG du desktop en prend autant. */
export const GAUGE = 14

const DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']
const MONTHS = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
]

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Un nombre lisible : entier à partir de 10, une décimale en dessous. */
export const amount = (n: number) => {
  const r = Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 10) / 10
  return String(r === 0 ? 0 : r).replace('.', ',')
}

export const pct = (n: number) => `${amount(n)} %`

const clock = (ms: number) => {
  const d = new Date(ms)
  const m = d.getMinutes()
  return m === 0 ? `${d.getHours()}h` : `${d.getHours()}h${m < 10 ? '0' : ''}${m}`
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate()

/** Un instant, aussi court que possible : "auj. 18h", "demain 7h33", "sam. 14 nov. 6h". */
export const when = (ms: number, now: number) => {
  const d = new Date(ms)
  if (sameDay(d, new Date(now))) return `auj. ${clock(ms)}`
  if (sameDay(d, new Date(now + DAY))) return `demain ${clock(ms)}`
  if (sameDay(d, new Date(now - DAY))) return `hier ${clock(ms)}`
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${clock(ms)}`
}

/** Pareil, plus court dans la semaine qui vient : "sam. 6h". */
export const soon = (ms: number, now: number) => {
  const d = new Date(ms)
  if (ms - now > 6 * DAY || ms < now - DAY) return when(ms, now)
  if (sameDay(d, new Date(now)) || sameDay(d, new Date(now + DAY)) || sameDay(d, new Date(now - DAY))) {
    return when(ms, now)
  }
  return `${DAYS[d.getDay()]} ${clock(ms)}`
}

/** Depuis combien de temps date un relevé, en clair. */
export const ageLabel = (ms: number) => {
  if (ms < 90_000) return "à l'instant"
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.round(ms / 3_600_000)
  if (hours < 24) return `il y a ${hours} h`
  return `il y a ${Math.round(ms / DAY)} j`
}

/** Le nom machine d'une fenêtre par modèle, rendu lisible. */
const labelOf = (kind: string) => {
  const tail = kind.replace(/^seven_day_?/, '').replace(/_/g, ' ').trim()
  if (tail.length === 0) return 'hebdo'
  return tail.charAt(0).toUpperCase() + tail.slice(1)
}

/**
 * Le relevé de la fenêtre de 7 jours du COMPTE, tel que l'API vient de le
 * rapporter : un pourcentage côté serveur, qui compte tous les appareils.
 */
export const readingOf = (
  limits: readonly { kind: string; percentUsed: number; resetsAt?: string }[],
  at: number,
): Reading | null => {
  const weeklies = limits.filter(one => one.kind.startsWith('seven_day'))
  const week = weeklies.find(one => one.kind === 'seven_day') ?? weeklies[0]
  if (!week) return null

  const hour = limits.find(one => one.kind === 'five_hour')
  const resetsAt = week.resetsAt ? Date.parse(week.resetsAt) : NaN

  // Une fenêtre par modèle peut bloquer avant la globale : on garde la plus pleine.
  let otherWeek: { label: string; used: number } | null = null
  for (const one of weeklies) {
    if (one.kind === week.kind) continue
    if (otherWeek === null || one.percentUsed > otherWeek.used) {
      otherWeek = { label: labelOf(one.kind), used: one.percentUsed }
    }
  }

  return {
    used: Math.max(0, week.percentUsed),
    resetsAt: Number.isFinite(resetsAt) ? resetsAt : null,
    fiveHour: hour ? hour.percentUsed : null,
    otherWeek,
    at,
  }
}

/** Le nom d'une fenêtre de la carte d'usage, ramené à ceux de l'API. */
const kindOfLabel = (label: string) => {
  if (/week/i.test(label)) {
    if (/all models/i.test(label)) return 'seven_day'
    const tail = label.split('·').pop()?.trim().toLowerCase().replace(/\s+/g, '_') ?? ''
    return tail.length > 0 ? `seven_day_${tail}` : 'seven_day'
  }
  if (/5.?h|five|hour/i.test(label)) return 'five_hour'
  return 'other'
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

/** Le texte d'un résultat d'outil, quelle que soit sa forme. */
export const textOf = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textOf).join('')
  if (isRecord(value) && typeof value.text === 'string') return value.text
  if (isRecord(value) && 'content' in value) return textOf(value.content)
  return value === undefined ? '' : JSON.stringify(value)
}

/**
 * Le relevé tiré de la carte d'usage de l'app (celle des réglages) : le quota
 * du compte lu côté serveur, à jour même quand cette machine ne fait rien.
 */
export const readingFromCard = (raw: string, at: number): Reading | null => {
  const start = raw.indexOf('{')
  if (start < 0) return null

  let data: unknown
  try {
    data = JSON.parse(raw.slice(start))
  } catch {
    return null
  }

  const plan = isRecord(data) ? data.plan : undefined
  if (!isRecord(plan) || plan.status !== 'ok' || !Array.isArray(plan.windows)) return null

  const limits: { kind: string; percentUsed: number; resetsAt?: string }[] = []
  for (const one of plan.windows as unknown[]) {
    if (!isRecord(one) || typeof one.percentUsed !== 'number') continue
    limits.push({
      kind: kindOfLabel(typeof one.label === 'string' ? one.label : ''),
      percentUsed: one.percentUsed,
      ...(typeof one.resetsAt === 'string' ? { resetsAt: one.resetsAt } : {}),
    })
  }

  return readingOf(limits, at)
}

const dayOf = (t: number, windowStart: number) =>
  clamp(Math.floor((t - windowStart) / DAY), 0, 6)

/**
 * Pose le repère de départ du jour où ce relevé a été pris.
 *
 * Le compte peut être utilisé ailleurs (un autre appareil, une autre
 * personne) pendant que cette machine ne relève rien. Quand la consommation
 * a bougé entre le dernier relevé et celui-ci, et que la bascule du jour
 * tombe entre les deux, on la répartit au prorata du temps : c'est une
 * estimation, et le jour est marqué comme tel.
 */
const advance = (trace: Trace | null, reading: Reading, windowStart: number): Trace => {
  const windowKey = String(reading.resetsAt)
  const kept: Trace =
    trace && trace.windowKey === windowKey
      ? trace
      : { windowKey, days: {}, partialDays: {}, lastSeen: null }

  // Un relevé plus ancien que le dernier vu n'apprend rien.
  if (kept.lastSeen && reading.at < kept.lastSeen.at) return kept

  const dayIndex = dayOf(reading.at, windowStart)
  const key = String(dayIndex)
  const days = { ...kept.days }
  const partialDays = { ...kept.partialDays }

  if (days[key] === undefined) {
    const dayStart = windowStart + dayIndex * DAY
    // Sans relevé antérieur, la fenêtre elle-même : 0 % à son ouverture.
    const from = kept.lastSeen ?? { dayIndex: 0, used: 0, at: windowStart }

    if (from.used === reading.used) {
      days[key] = reading.used // rien de consommé entre les deux
    } else if (from.at >= dayStart - BOUNDARY_SLACK) {
      days[key] = from.used // relevé pris juste avant la bascule
    } else {
      const span = reading.at - from.at
      const share = span > 0 ? clamp((dayStart - from.at) / span, 0, 1) : 0
      days[key] = from.used + (reading.used - from.used) * share
      partialDays[key] = true
    }
  }

  return {
    windowKey,
    days,
    partialDays,
    lastSeen: { dayIndex, used: reading.used, at: reading.at },
  }
}

const paceOf = (delta: number): Pace =>
  delta > TOLERANCE ? 'ahead' : delta < -TOLERANCE ? 'behind' : 'onTrack'

export const measure = (reading: Reading, trace: Trace | null, now: number) => {
  const isStale = now - reading.at > STALE_AFTER

  if (reading.resetsAt === null) {
    const bare: Snapshot = {
      hasWindow: false,
      isExpired: false,
      weekUsed: reading.used,
      weekExpected: 0,
      weekLeft: Math.max(0, 100 - reading.used),
      todayUsed: 0,
      todayBudget: 0,
      todayLeft: 0,
      dayNumber: 0,
      daysLeft: 0,
      pace: 'onTrack',
      delta: 0,
      zeroAt: null,
      resetsAt: 0,
      isTodayPartial: false,
      isStale,
      fiveHour: reading.fiveHour,
      otherWeek: reading.otherWeek,
      at: reading.at,
    }

    return { snapshot: bare, trace }
  }

  const windowStart = reading.resetsAt - WEEK
  const next = advance(trace, reading, windowStart)

  const elapsed = clamp(now - windowStart, 0, WEEK)
  const dayIndex = dayOf(now, windowStart)
  // Pas encore de relevé aujourd'hui : le jour part du dernier chiffre connu.
  const startOfDay = next.days[String(dayIndex)] ?? reading.used
  const daysLeft = 7 - dayIndex
  const todayBudget = Math.max(0, (100 - startOfDay) / daysLeft)
  const todayUsed = Math.max(0, reading.used - startOfDay)
  const weekExpected = (100 * elapsed) / WEEK
  const delta = weekExpected - reading.used

  // Au rythme moyen de la fenêtre, mesuré à l'instant du relevé.
  const spent = reading.at - windowStart
  const rate = spent > 0 ? reading.used / spent : 0
  const left = Math.max(0, 100 - reading.used)
  const zeroRaw = rate > 0 ? reading.at + left / rate : null
  const zeroAt =
    zeroRaw !== null && zeroRaw < reading.resetsAt ? Math.round(zeroRaw) : null

  const built: Snapshot = {
    hasWindow: true,
    isExpired: now >= reading.resetsAt,
    weekUsed: reading.used,
    weekExpected,
    weekLeft: left,
    todayUsed,
    todayBudget,
    todayLeft: todayBudget - todayUsed,
    dayNumber: dayIndex + 1,
    daysLeft,
    pace: paceOf(delta),
    delta,
    zeroAt,
    resetsAt: reading.resetsAt,
    isTodayPartial: next.partialDays[String(dayIndex)] === true,
    isStale,
    fiveHour: reading.fiveHour,
    otherWeek: reading.otherWeek,
    at: reading.at,
  }

  return { snapshot: built, trace: next }
}

export const COLORS: Record<Pace, string> = {
  ahead: 'success',
  onTrack: 'warning',
  behind: 'error',
}

/** Les mêmes, pour le SVG du desktop, lisibles sur fond clair comme sombre. */
const HEX: Record<Pace, string> = {
  ahead: '#2fb26b',
  onTrack: '#e0a100',
  behind: '#e5484d',
}

export const LABELS: Record<Pace, string> = {
  ahead: 'EN AVANCE',
  onTrack: 'DANS LE RYTHME',
  behind: 'TROP VITE',
}

export type Tone = 'pace' | 'strong' | 'dim' | 'alert'
export type Run = { text: string; tone: Tone }

/** La jauge du terminal : rempli à la couleur du rythme, un repère où l'on "devrait" être. */
export const gaugeRuns = (used: number, expected: number, width = GAUGE) => {
  const fill = clamp(Math.round((used / 100) * width), 0, width)
  const mark = clamp(Math.round((expected / 100) * width), 0, width - 1)
  const runs: { text: string; tone: 'fill' | 'empty' | 'marker' }[] = []

  for (let i = 0; i < width; i += 1) {
    const tone = i === mark ? 'marker' : i < fill ? 'fill' : 'empty'
    const glyph = tone === 'marker' ? '┃' : tone === 'fill' ? '━' : '─'
    const last = runs[runs.length - 1]
    if (last && last.tone === tone) last.text += glyph
    else runs.push({ text: glyph, tone })
  }

  return runs
}

/** La même jauge en SVG pour le desktop : une barre fine, un trait au rythme idéal. */
export const gaugeSvg = (used: number, expected: number, pace: Pace) => {
  const w = 128
  const h = 12
  const bar = 6
  const y = (h - bar) / 2
  const fill = Math.round(clamp(used, 0, 100) * w) / 100
  const mark = clamp(Math.round(clamp(expected, 0, 100) * w) / 100, 1, w - 1)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect x="0" y="${y}" width="${w}" height="${bar}" rx="3" fill="#8b8b8b" fill-opacity="0.25"/>` +
    `<rect x="0" y="${y}" width="${fill}" height="${bar}" rx="3" fill="${HEX[pace]}"/>` +
    `<rect x="${mark - 1}" y="0" width="2" height="${h}" rx="1" fill="#8b8b8b"/>` +
    `</svg>`
  )
}

const widthOf = (runs: Run[]) => runs.reduce((n, r) => n + r.text.length, 0)

/** Espace entre deux blocs de la ligne. */
export const SEP = '  '

/**
 * La ligne de la barre, réduite à ce qui tient dans `columns` : chaque bloc a
 * un rang d'importance, et les moins importants tombent en premier. Elle ne
 * passe donc jamais sur deux lignes.
 */
export const layout = (s: Snapshot, now: number, columns: number) => {
  if (!s.hasWindow) {
    return {
      status: 'QUOTA',
      showGauge: false,
      parts: [[{ text: `Semaine ${pct(s.weekUsed)} (date de reset inconnue)`, tone: 'dim' as Tone }]],
    }
  }

  if (s.isExpired) {
    return {
      status: 'NOUVELLE SEMAINE',
      showGauge: false,
      parts: [[{ text: `Reset ${soon(s.resetsAt, now)} · en attente du premier relevé`, tone: 'dim' as Tone }]],
    }
  }

  // [position à l'écran, rang d'importance (0 = gardé en dernier), contenu]
  const blocks: [number, number, Run[]][] = []

  blocks.push([1, 0, [
    { text: 'Semaine ', tone: 'dim' },
    { text: pct(s.weekUsed), tone: 'strong' },
    { text: ` · rythme ${pct(s.weekExpected)}`, tone: 'dim' },
  ]])

  blocks.push([2, 1, [
    { text: "Aujourd'hui ", tone: 'dim' },
    { text: `${s.isTodayPartial ? '≈' : ''}${amount(s.todayUsed)}`, tone: s.todayLeft < 0 ? 'alert' : 'strong' },
    { text: ` / ${pct(s.todayBudget)}`, tone: 'dim' },
  ]])

  blocks.push([3, 2, s.zeroAt === null
    ? [{ text: `Tient jusqu'au reset ${soon(s.resetsAt, now)}`, tone: 'dim' }]
    : [{ text: `À sec ${soon(s.zeroAt, now)}`, tone: 'alert' }]])

  if (s.otherWeek !== null && s.otherWeek.used > s.weekUsed) {
    blocks.push([4, 4, [{
      text: `${s.otherWeek.label} ${pct(s.otherWeek.used)}`,
      tone: s.otherWeek.used >= 80 ? 'alert' : 'dim',
    }]])
  }

  if (s.fiveHour !== null) {
    blocks.push([5, 5, [{ text: `5 h ${pct(s.fiveHour)}`, tone: s.fiveHour >= 80 ? 'alert' : 'dim' }]])
  }

  if (s.isStale) {
    blocks.push([6, 6, [{ text: `relevé ${ageLabel(now - s.at)}`, tone: 'dim' }]])
  }

  const status = LABELS[s.pace]
  let room = columns - (2 + status.length)
  let showGauge = false
  const kept: [number, Run[]][] = []

  // La jauge passe juste après les trois blocs essentiels.
  const ranked: [number, number, Run[] | null][] = [...blocks, [0, 3, null]]
  ranked.sort((a, b) => a[1] - b[1])

  for (const [at, , runs] of ranked) {
    const need = SEP.length + (runs === null ? GAUGE : widthOf(runs))
    if (need > room) continue
    room -= need
    if (runs === null) showGauge = true
    else kept.push([at, runs])
  }

  kept.sort((a, b) => a[0] - b[0])

  return { status, showGauge, parts: kept.map(([, runs]) => runs) }
}

/**
 * La barre telle que l'overlay du bureau la dessine (Windows, Linux) : la même
 * ligne que dans Claude Code, déjà calculée, écrite dans le fichier du mod.
 */
export type Display = {
  /** Quand le mod l'a calculée, en ms epoch : l'overlay sait ainsi si le mod tourne encore. */
  at: number
  /** Quand le compte a été relevé, en ms epoch. */
  readingAt: number
  status: string
  /** null : pas de couleur (semaine en attente, ou pas de date de reset). */
  pace: Pace | null
  gauge: { used: number; expected: number } | null
  parts: Run[][]
}

/** Largeur donnée à la ligne de l'overlay : elle a la place, il ne tronque rien d'utile. */
const OVERLAY_COLUMNS = 150

export const exportLine = (s: Snapshot, now: number): Display => {
  const line = layout(s, now, OVERLAY_COLUMNS)

  return {
    at: now,
    readingAt: s.at,
    status: line.status,
    pace: s.hasWindow && !s.isExpired ? s.pace : null,
    gauge: line.showGauge ? { used: s.weekUsed, expected: s.weekExpected } : null,
    parts: line.parts,
  }
}

/** Le détail en texte, pour la commande /budget-tokens. */
export const report = (s: Snapshot, now: number) => {
  if (!s.hasWindow) {
    return `Quota hebdomadaire du compte : ${pct(s.weekUsed)} consommés. L'API ne donne pas de date de reset, donc pas de budget par jour.`
  }
  if (s.isExpired) {
    return `La semaine s'est réinitialisée ${when(s.resetsAt, now)}. Les chiffres reviendront à la prochaine réponse de l'API.`
  }

  const lines = [
    `${LABELS[s.pace]} — semaine : ${pct(s.weekUsed)} consommés, ${pct(s.weekExpected)} attendus à ce stade (${s.delta >= 0 ? `${amount(s.delta)} pts d'avance` : `${amount(-s.delta)} pts de retard`}).`,
    `Jour ${s.dayNumber}/7 : ${s.isTodayPartial ? 'environ ' : ''}${pct(s.todayUsed)} consommés sur un budget de ${pct(s.todayBudget)} (${s.todayLeft >= 0 ? `reste ${pct(s.todayLeft)}` : `dépassé de ${pct(-s.todayLeft)}`}).`,
    `Budget du jour : ce qui restait au début de la journée (${pct(s.todayBudget * s.daysLeft)}) divisé par les ${s.daysLeft} jours restants.`,
    `Reste sur la semaine : ${pct(s.weekLeft)}. Reset ${when(s.resetsAt, now)}.`,
    s.zeroAt === null
      ? `À ce rythme, le quota tient jusqu'au reset.`
      : `À ce rythme, quota à zéro ${when(s.zeroAt, now)}, avant le reset.`,
  ]

  if (s.otherWeek !== null) {
    lines.push(`Quota hebdo ${s.otherWeek.label} : ${pct(s.otherWeek.used)} — il peut bloquer avant le quota global.`)
  }
  if (s.fiveHour !== null) {
    lines.push(`Fenêtre de 5 h : ${pct(s.fiveHour)}.`)
  }
  if (s.isTodayPartial) {
    lines.push(`Le total du jour est une estimation : du quota a été consommé (ici ou sur un autre appareil du compte) pendant que cette machine ne relevait rien, à cheval sur le début de la journée.`)
  }
  lines.push(`Chiffres du compte, tous appareils confondus. Dernier relevé ${ageLabel(now - s.at)}.`)

  return lines.join('\n')
}
