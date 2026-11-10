import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { Reading, Trace } from '../types'
import {
  COLORS,
  SEP,
  TICK,
  USAGE_TOOL,
  gaugeRuns,
  gaugeSvg,
  layout,
  measure,
  pct,
  readingFromCard,
  readingOf,
  report,
  textOf,
} from './compute'
import type { Run, Tone } from './compute'

const snapshot = atom(
  { plugin: 'budget-tokens', key: 'snapshot' } as const,
  null,
  { shape: 'snap-2' },
)

/** Recalcule tout à partir du relevé le plus récent : celui qu'on reçoit, sinon celui du disque. */
async function refresh($: EngineInterface, fresh: Reading | null) {
  const now = await $.clock.now()
  const stored = (await $.store.get('reading')) as Reading | undefined
  const isNewer = fresh !== null && (stored === undefined || fresh.at >= stored.at)
  const reading = isNewer ? fresh : stored ?? null
  if (reading === null) return

  const trace = ((await $.store.get('trace')) as Trace | null) ?? null
  const built = measure(reading, trace, now)

  if (isNewer) await $.store.set('reading', reading)
  if (built.trace) await $.store.set('trace', built.trace)
  await update($, snapshot, () => built.snapshot)
}

/** Un appel d'outil par son nom seul : le typage de tous les outils MCP est trop profond pour tsc. */
type CallByName = (input: { tool: string }) => Promise<ToolCallResult>

/**
 * Relit la carte d'usage du compte (l'outil de l'app desktop), puis recalcule.
 *
 * C'est elle qui rend la barre vivante : elle voit ce que consomment les
 * autres appareils du compte, même quand cette machine ne fait rien. Là où
 * l'outil n'existe pas (le terminal seul), la barre suit les réponses de l'API.
 */
async function poll($: EngineInterface) {
  let reading: Reading | null = null

  try {
    const answer = await ($.tool.call as unknown as CallByName)({ tool: USAGE_TOOL })
    if (answer.deny === undefined && !answer.isError) {
      reading = readingFromCard(answer.text ?? textOf(answer.result), await $.clock.now())
    }
  } catch {
    // Pas d'app desktop ici, ou l'outil n'est pas encore connecté : réessayé au prochain tour.
  }

  await refresh($, reading)
}

const toneProps = (tone: Tone) =>
  tone === 'strong'
    ? { weight: 'semibold' as const }
    : tone === 'alert'
      ? { color: 'error', weight: 'semibold' as const }
      : tone === 'pace'
        ? {}
        : { dimColor: true }

export const register: Register = on => {
  let timer: { cancel: () => void } | null = null

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'budget-tokens',
      description: 'Détail du budget de tokens du compte (semaine, jour, rythme)',
    })

    await refresh($, null)
    timer?.cancel()
    timer = $.clock.every(TICK, () => void poll($).catch(() => {}))
    void poll($).catch(() => {})

    return next(e)
  })

  on('session.end', ($, e, next) => {
    timer?.cancel()
    timer = null

    return next(e)
  })

  // Pendant un tour : à chaque point gagné, et à la fin de chaque réponse.
  on('session.measure', async ($, e, next) => {
    const reading = readingOf(e.rateLimits, await $.clock.now())
    if (reading) await refresh($, reading)

    return next(e)
  })

  on('command.run', { command: 'budget-tokens' }, async $ => {
    await poll($)
    const s = await read($, snapshot)
    const now = await $.clock.now()

    return { text: s === null ? "Aucun relevé de quota pour l'instant." : report(s, now) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snapshot)
    if (s === null || e.props.hasSurvey) {
      return next(e)
    }

    const now = await $.clock.now()
    const table = $.ui.resolve(e)
    const { Box, Text } = table
    const Svg = 'Svg' in table ? table.Svg : undefined
    // Le desktop écrit en petit et en chasse variable : un peu plus y tient.
    const columns = Math.floor(e.props.bodyColumns * (Svg === undefined ? 1 : 1.2))
    const { status, showGauge, parts } = layout(s, now, columns)
    const paceColor = s.hasWindow && !s.isExpired ? COLORS[s.pace] : undefined

    const piece = (runs: Run[]) =>
      runs.map(run => <Text {...toneProps(run.tone)}>{run.text}</Text>)
    const joined = parts.flatMap((runs, i) => (i === 0 ? piece(runs) : [SEP, ...piece(runs)]))

    if (Svg !== undefined) {
      return (
        <Box flexDirection="row" alignItems="center" gap={2}>
          <Text size="footnote" color={paceColor} weight="semibold" wrap="truncate-end">
            ● {status}
          </Text>
          {showGauge && (
            <Svg
              source={gaugeSvg(s.weekUsed, s.weekExpected, s.pace)}
              alt={`Semaine : ${pct(s.weekUsed)} consommés, ${pct(s.weekExpected)} attendus à ce stade`}
              width={128}
              height={12}
            />
          )}
          <Text size="footnote" wrap="truncate-end">
            {joined}
          </Text>
        </Box>
      )
    }

    const gauge = showGauge
      ? [
          SEP,
          ...gaugeRuns(s.weekUsed, s.weekExpected).map(run => (
            <Text
              {...(run.tone === 'fill'
                ? { color: paceColor }
                : run.tone === 'marker'
                  ? { weight: 'semibold' as const }
                  : { dimColor: true })}
            >
              {run.text}
            </Text>
          )),
        ]
      : []

    return (
      <Box>
        <Text wrap="truncate-end">
          <Text color={paceColor} weight="semibold">
            ● {status}
          </Text>
          {gauge}
          {joined.length > 0 ? [SEP, ...joined] : []}
        </Text>
      </Box>
    )
  })
}
