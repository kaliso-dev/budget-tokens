import { expect, test } from 'claude-code/testing'

import type { Reading, Trace } from '../types'
import { GAUGE, SEP, exportLine, layout, measure, readingFromCard, readingOf } from './compute'

const H = 3_600_000
const DAY = 24 * H
const RESET = Date.parse('2026-11-14T05:00:00Z')
const START = RESET - 7 * DAY // ouverture de la fenêtre
const DAY4 = START + 3 * DAY // début du jour 4 : 2026-11-10 05:00Z
const NOW = Date.parse('2026-11-10T13:00:00Z') // jour 4, 80 h écoulées

const one = (n: number) => Math.round(n * 10) / 10

const reading = (used: number, at = NOW): Reading => ({
  used,
  resetsAt: RESET,
  fiveHour: null,
  otherWeek: null,
  at,
})

const trace = (lastSeen: Trace['lastSeen'], days: Record<string, number> = {}): Trace => ({
  windowKey: String(RESET),
  days,
  partialDays: {},
  lastSeen,
})

test("lit la fenêtre hebdo de l'API et garde la fenêtre par modèle la plus pleine", () => {
  const got = readingOf(
    [
      { kind: 'five_hour', percentUsed: 12, resetsAt: '2026-11-10T16:00:00Z' },
      { kind: 'seven_day', percentUsed: 24, resetsAt: '2026-11-14T05:00:00Z' },
      { kind: 'seven_day_fable', percentUsed: 61, resetsAt: '2026-11-14T05:00:00Z' },
    ],
    NOW,
  )

  expect(got?.used).toBe(24)
  expect(got?.resetsAt).toBe(RESET)
  expect(got?.fiveHour).toBe(12)
  expect(got?.otherWeek).toEqual({ label: 'Fable', used: 61 })
})

test("lit la carte d'usage du compte telle que l'app desktop la renvoie", () => {
  const card = JSON.stringify({
    plan: {
      status: 'ok',
      plan: 'exemple',
      windows: [
        { label: 'Weekly · all models', percentUsed: 24, resetsAt: '2026-11-14T05:00:00Z', resetsIn: '3d 16h' },
        { label: 'Weekly · Fable', percentUsed: 0, resetsAt: '2026-11-14T05:00:00Z', resetsIn: '3d 16h' },
      ],
      extraUsage: { enabled: false, currency: 'USD' },
    },
    context: { session: 'self', status: 'ok' },
  })
  const got = readingFromCard(card, NOW)

  expect(got?.used).toBe(24)
  expect(got?.resetsAt).toBe(Date.parse('2026-11-14T05:00:00Z'))
  expect(got?.otherWeek).toEqual({ label: 'Fable', used: 0 })
  expect(got?.at).toBe(NOW)
})

test("une carte illisible ou hors abonnement ne donne aucun relevé", () => {
  expect(readingFromCard('pas du JSON', NOW)).toBe(null)
  expect(readingFromCard(JSON.stringify({ plan: { status: 'not_applicable' } }), NOW)).toBe(null)
  expect(readingOf([{ kind: 'five_hour', percentUsed: 9 }], NOW)).toBe(null)
})

test('place la semaine : jour, attendu, et budget du jour sur ce qui reste', () => {
  const { snapshot: s } = measure(reading(24), null, NOW)

  expect(s.dayNumber).toBe(4)
  expect(s.daysLeft).toBe(4)
  expect(one(s.weekExpected)).toBe(47.6) // 80 h sur 168 h
  expect(s.weekLeft).toBe(76)
  // Premier relevé de la semaine : le début du jour est estimé au prorata (24 % × 72/80).
  expect(one(s.todayUsed)).toBe(2.4)
  expect(one(s.todayBudget)).toBe(19.6)
  expect(s.isTodayPartial).toBe(true)
})

test('vert quand on est en avance sur le budget', () => {
  const { snapshot: s } = measure(reading(24), null, NOW)

  expect(s.pace).toBe('ahead')
  expect(s.delta).toBeGreaterThan(0)
  expect(s.zeroAt).toBe(null)
})

test('orange quand on est pile dans le rythme', () => {
  expect(measure(reading(48), null, NOW).snapshot.pace).toBe('onTrack')
  expect(measure(reading(46), null, NOW).snapshot.pace).toBe('onTrack')
})

test('rouge, avec la date où le quota tombe à zéro avant le reset', () => {
  const { snapshot: s } = measure(reading(70), null, NOW)

  expect(s.pace).toBe('behind')
  expect(s.zeroAt).not.toBe(null)
  expect(s.zeroAt!).toBeLessThan(RESET)
  expect(one((s.zeroAt! - NOW) / DAY)).toBe(1.4) // 30 % restants à 70 % / 80 h
})

test("relevé pris juste avant la bascule : aujourd'hui part exactement de là", () => {
  const { snapshot: s, trace: next } = measure(
    reading(30),
    trace({ dayIndex: 2, used: 20, at: DAY4 - 60_000 }, { '2': 15 }),
    NOW,
  )

  expect(next?.days['3']).toBe(20)
  expect(s.todayUsed).toBe(10)
  expect(s.todayBudget).toBe(20) // 80 % restants ce matin / 4 jours
  expect(s.todayLeft).toBe(10)
  expect(s.isTodayPartial).toBe(false)
})

test("conso pendant la nuit sur un autre appareil : répartie au prorata, marquée estimée", () => {
  // Dernier relevé ici à 17h la veille (20 %), le compte est à 28 % à 13h : 8 points en 20 h,
  // dont 12 h avant le début du jour → 4,8 pour la veille, 3,2 pour aujourd'hui.
  const { snapshot: s } = measure(
    reading(28),
    trace({ dayIndex: 2, used: 20, at: DAY4 - 12 * H }),
    NOW,
  )

  expect(one(s.todayUsed)).toBe(3.2)
  expect(s.isTodayPartial).toBe(true)
})

test('plusieurs jours sans conso : le total du jour reste exact', () => {
  const { snapshot: s } = measure(reading(24), trace({ dayIndex: 0, used: 24, at: NOW - 3 * DAY }), NOW)

  expect(s.todayUsed).toBe(0)
  expect(s.isTodayPartial).toBe(false)
})

test('plusieurs jours sans relevé ici, mais de la conso ailleurs : estimée au prorata', () => {
  const { snapshot: s } = measure(reading(40), trace({ dayIndex: 0, used: 10, at: NOW - 3 * DAY }), NOW)

  // 30 points en 72 h, dont 64 h avant le début du jour.
  expect(one(s.todayUsed)).toBe(3.3)
  expect(one(s.todayBudget)).toBe(15.8)
  expect(s.isTodayPartial).toBe(true)
})

test('une journée économe agrandit le budget des jours suivants', () => {
  const frugal = trace({ dayIndex: 2, used: 8, at: NOW - DAY })
  const greedy = trace({ dayIndex: 2, used: 60, at: NOW - DAY })

  expect(measure(reading(8), frugal, NOW).snapshot.todayBudget).toBe(23)
  expect(measure(reading(60), greedy, NOW).snapshot.todayBudget).toBe(10)
})

test('un vieux relevé ne pose pas le repère du jour suivant', () => {
  const old = DAY4 - 2 * H
  const { snapshot: s, trace: next } = measure(
    reading(20, old),
    trace({ dayIndex: 2, used: 20, at: old }, { '2': 15 }),
    NOW,
  )

  expect(next?.days['3']).toBe(undefined)
  expect(s.todayUsed).toBe(0)
  expect(s.todayBudget).toBe(20)
  expect(s.isStale).toBe(true)
})

test('le premier jour de la semaine part exactement de zéro', () => {
  const at = START + 5 * H
  const { snapshot: s } = measure(reading(3, at), null, at)

  expect(s.dayNumber).toBe(1)
  expect(s.todayUsed).toBe(3)
  expect(s.isTodayPartial).toBe(false)
})

test('une nouvelle fenêtre repart de zéro', () => {
  const stale: Trace = {
    windowKey: 'une-autre-semaine',
    days: { '3': 90 },
    partialDays: {},
    lastSeen: { dayIndex: 3, used: 95, at: NOW - 7 * DAY },
  }
  const { trace: next } = measure(reading(24), stale, NOW)

  expect(next?.windowKey).toBe(String(RESET))
  expect(one(next?.days['3'] ?? -1)).toBe(21.6)
})

test('reset passé sans nouveau relevé : la barre attend au lieu de mentir', () => {
  const { snapshot: s } = measure(reading(90), null, RESET + H)
  const line = layout(s, RESET + H, 120)

  expect(s.isExpired).toBe(true)
  expect(line.status).toBe('NOUVELLE SEMAINE')
  expect(line.showGauge).toBe(false)
})

test('sans date de reset : ni budget du jour ni date de zéro', () => {
  const bare: Reading = { used: 24, resetsAt: null, fiveHour: null, otherWeek: null, at: NOW }
  const { snapshot: s } = measure(bare, null, NOW)

  expect(s.hasWindow).toBe(false)
  expect(s.weekUsed).toBe(24)
  expect(s.zeroAt).toBe(null)
})

test('la ligne tient toujours sur une seule ligne, quelle que soit la largeur', () => {
  const { snapshot: s } = measure({ ...reading(24), fiveHour: 12 }, null, NOW)

  for (const columns of [40, 60, 80, 100, 140, 200]) {
    const line = layout(s, NOW, columns)
    const used =
      2 + line.status.length +
      (line.showGauge ? SEP.length + GAUGE : 0) +
      line.parts.reduce((n, runs) => n + SEP.length + runs.reduce((m, r) => m + r.text.length, 0), 0)

    expect(used).toBeLessThanOrEqual(columns)
  }

  const wide = layout(s, NOW, 200)
  const text = wide.parts.map(runs => runs.map(r => r.text).join('')).join(' | ')
  expect(wide.showGauge).toBe(true)
  expect(text).toContain('Semaine 24')
  expect(text).toContain("Aujourd'hui")
  expect(text).toContain("Tient jusqu'au reset")
  expect(text).toContain('5 h 12')

  // 110 colonnes : semaine, jour, projection et jauge tiennent ensemble.
  const usual = layout(s, NOW, 110)
  expect(usual.showGauge).toBe(true)
  expect(usual.parts.length).toBeGreaterThanOrEqual(3)

  // Étroit : la semaine reste, le reste s'efface.
  expect(layout(s, NOW, 50).parts[0]?.[0]?.text).toBe('Semaine ')
})

test("l'overlay reçoit exactement la ligne de la barre, déjà calculée", () => {
  const { snapshot: s } = measure({ ...reading(70), fiveHour: 12 }, null, NOW)
  const shown = exportLine(s, NOW)

  expect(shown.status).toBe('TROP VITE')
  expect(shown.pace).toBe('behind')
  expect(shown.gauge?.used).toBe(70)
  expect(shown.at).toBe(NOW)
  expect(shown.readingAt).toBe(NOW)
  const text = shown.parts.map(runs => runs.map(r => r.text).join('')).join(' | ')
  expect(text).toContain('Semaine 70')
  expect(text).toContain('À sec')
  expect(text).toContain('5 h 12')
})
