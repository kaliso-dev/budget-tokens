import type { CommandRunInput } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 12,
    bodyColumns: 110,
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
}

const NOW = Date.parse('2026-11-10T13:00:00Z')

/** `/budget-tokens` : il relit la carte d'usage du compte, comme le minuteur toutes les 30 s. */
const RELOAD = { command: 'budget-tokens', args: '' } as unknown as CommandRunInput

/** Une réponse d'outil posée sous le mod (le typage de tous les outils MCP est trop profond pour tsc). */
type Answer = (event: string, match: { tool: string }, hook: () => unknown) => void

const CARD = (percent: number) =>
  JSON.stringify({
    plan: {
      status: 'ok',
      plan: 'exemple',
      windows: [{ label: 'Weekly · all models', percentUsed: percent, resetsAt: '2026-11-14T05:00:00Z' }],
    },
  })

test('une seule ligne, sans bouton, sur chaque surface', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: { window: 1_000_000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 12, resetsAt: '2026-11-10T16:00:00Z' },
      { kind: 'seven_day', percentUsed: 24, resetsAt: '2026-11-14T05:00:00Z' },
    ],
    changed: ['rateLimits'],
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'budget-tokens', surface, ...BAND })
    const drawn = (await ui.findAll({ type: 'Text' })).map(one => one.text).join('|')

    expect(drawn).toContain('EN AVANCE')
    expect(drawn).toContain('Semaine 24')
    expect(drawn).toContain("Aujourd'hui")
    expect(drawn).toContain("Tient jusqu'au reset")
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
    await ui.unmount()
  }

  const desktop = await $.ui.mount({ plugin: 'budget-tokens', surface: 'desktop', ...BAND })
  expect(await desktop.find({ type: 'Svg' })).toBeDefined()
  await desktop.unmount()
})

test('rouge, avec la date où le quota tombe à zéro', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: { window: 1_000_000 },
    rateLimits: [{ kind: 'seven_day', percentUsed: 82, resetsAt: '2026-11-14T05:00:00Z' }],
    changed: ['rateLimits'],
  })

  const ui = await $.ui.mount({ plugin: 'budget-tokens', surface: 'terminal', ...BAND })
  const drawn = (await ui.findAll({ type: 'Text' })).map(one => one.text).join('|')

  expect(drawn).toContain('TROP VITE')
  expect(drawn).toContain('À sec')
  await ui.unmount()
})

test("temps réel : la carte d'usage du compte met la barre à jour sans réponse d'API ici", async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  let percent = 24
  ;(on as unknown as Answer)('tool.call', { tool: 'mcp__ccd_session_mgmt__get_usage' }, () => ({
    result: CARD(percent),
    text: CARD(percent),
  }))

  await $.command.run(RELOAD)
  const ui = await $.ui.mount({ plugin: 'budget-tokens', surface: 'desktop', ...BAND })
  expect((await ui.findAll({ type: 'Text' })).map(one => one.text).join('|')).toContain('Semaine 24')

  // Un autre appareil du compte consomme : la carte monte, la barre suit à la relecture suivante.
  percent = 61
  await $.command.run(RELOAD)
  await ui.redraw()
  const after = (await ui.findAll({ type: 'Text' })).map(one => one.text).join('|')
  expect(after).toContain('Semaine 61')
  expect(after).toContain('TROP VITE')
  await ui.unmount()
})
