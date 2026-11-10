import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register, Timer } from 'claude-code'

import type { AgentRow, Decision } from '../types'

const DECIDE = 'record_assumption'
const DECIDE_TOOL = `mcp__agent-tracker__${DECIDE}`
const DECISIONS_KEPT = 200
const DECISIONS_SHOWN = 5 // newest in the pane; /assumptions lists all
const decisions = atom({ plugin: 'agent-tracker', key: 'decisions' } as const, [] as Decision[], { shape: 'assumptions-1' })

export const DECIDE_RULE = `# Tracking your assumptions
When you act on something you believe is true but have not verified and were not told, call ${DECIDE_TOOL} once for it.
Track: what the user meant by an ambiguous ask ("assumed 'the app' means ~/code/shop"), facts about their setup you did not check ("assumed Node 20", "assumed staging is safe to restart"), expected behaviour of code or an API you did not read, and what is in or out of scope.
Do not track: facts you verified with a tool, things the user or your instructions stated, or trivial ones (naming, formatting). Usually 0-3 per task.
One short sentence per field. Do not repeat it in chat. The user marks each assumption true or false afterwards; a false one comes back to you with their reason.`

function hhmm(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const MARK = { right: '✓', wrong: '✗', open: '?' } as const

export function decisionsText(list: readonly Decision[]): string {
  if (!list.length) return 'No assumptions recorded this session.'
  return [
    `Assumptions Claude made (${list.length}):`,
    ...list.map((d, i) =>
      [`${i + 1}. ${MARK[d.verdict ?? 'open']} [${hhmm(d.at)} · ${d.who}] ${d.decision}`, d.why ? `   basis: ${d.why}` : '', d.alternatives ? `   if wrong: ${d.alternatives}` : '', d.verdict === 'wrong' ? `   ✗ false: ${d.reason || '(no reason given)'}` : '']
        .filter(Boolean)
        .join('\n'),
    ),
    '',
    'Mark one: /assumptions <number> true   or   /assumptions <number> false <what is true instead>   (or ✓ / ✗ in the Agents pane).',
  ].join('\n')
}

// Sets decision n (1-based) to a verdict; a new 'wrong' is told to Claude with the next prompt.
export function judge(list: readonly Decision[], n: number, verdict: 'right' | 'wrong', reason = ''): Decision[] {
  return list.map((d, i) => (i === n - 1 ? { ...d, verdict, reason: verdict === 'wrong' ? reason.trim() : undefined, told: undefined } : d))
}

const WHY = ['Not what I meant', 'Not true for my setup', 'Out of scope']

// ✗ in the pane: mark false, then ask why (a free-text answer goes under Other).
async function askWhy($: EngineInterface, n: number): Promise<void> {
  try {
    await update($, decisions, (cur) => judge(cur, n, 'wrong'))
    const why = await $.ui.ask(`Pick one, or type what is actually true under Other: why is assumption ${n} false?`, { options: WHY, header: 'Why false' })
    await update($, decisions, (cur) => judge(cur, n, 'wrong', why))
  } catch {
    // Dialog dismissed: stays false with no reason.
  }
}

let reviewing = false

// One card per unreviewed decision: True / False / Skip; False asks why. Dismissing a card stops the review.
async function reviewCards($: EngineInterface, onlyNew: boolean): Promise<number> {
  if (reviewing) return 0
  reviewing = true
  let done = 0
  try {
    const list = await read($, decisions)
    for (const [i, d] of list.entries()) {
      if (d.verdict || (onlyNew && d.skipped)) continue
      const n = i + 1
      const body = [`${d.decision}`, d.why ? `Basis: ${d.why}` : '', d.alternatives ? `If wrong: ${d.alternatives}` : ''].filter(Boolean).join('\n')
      let pick: string
      try {
        pick = await $.ui.ask(`Assumption ${n} by ${d.who}:\n${body}\n\nIs this assumption true?`, {
          options: ['True', 'False', 'Skip'],
          header: `Assume ${n}`,
        })
      } catch {
        // Closed card: count it as Skip so it does not come back every turn; stop the review.
        await update($, decisions, (cur) => cur.map((x, j) => (j === i ? { ...x, skipped: true as const } : x)))
        break
      }
      if (pick === 'True') await update($, decisions, (cur) => judge(cur, n, 'right'))
      else if (pick === 'Skip') await update($, decisions, (cur) => cur.map((x, j) => (j === i ? { ...x, skipped: true as const } : x)))
      else if (pick === 'False') {
        await update($, decisions, (cur) => judge(cur, n, 'wrong'))
        let why = ''
        try {
          why = await $.ui.ask(`Pick one, or type what is actually true under Other: why is assumption ${n} false?`, { options: WHY, header: 'Why false' })
        } catch {
          // No reason given; stays false.
        }
        if (why) await update($, decisions, (cur) => judge(cur, n, 'wrong', why))
      } else {
        // Free text under Other on the first card: treat it as False with that reason.
        await update($, decisions, (cur) => judge(cur, n, 'wrong', pick))
      }
      done++
    }
  } finally {
    reviewing = false
  }
  // Review over: send any fresh FALSE marks to Claude now, as its own turn once idle.
  const note = wrongNote(await read($, decisions))
  if (note) {
    await update($, decisions, (cur) => cur.map((d) => (d.verdict === 'wrong' ? { ...d, told: true as const } : d)))
    // If the send fails, un-mark so the note rides the user's next typed prompt instead.
    void $.prompt.submit({ text: note }).catch(() =>
      update($, decisions, (cur) => cur.map((d) => (d.verdict === 'wrong' ? { ...d, told: undefined } : d))).catch(() => {}),
    )
  }
  return done
}

export function wrongNote(list: readonly Decision[]): string | undefined {
  const fresh = list.map((d, i) => ({ d, n: i + 1 })).filter(({ d }) => d.verdict === 'wrong' && !d.told)
  if (!fresh.length) return undefined
  return [
    'The user marked these assumptions of yours FALSE. Redo or fix any work that relied on them, and say what you changed:',
    ...fresh.map(({ d, n }) => `${n}. ${d.decision} (your basis: ${d.why})${d.reason ? `\n   user says: ${d.reason}` : ''}`),
  ].join('\n')
}

const PANE = 'agent-tracker'
const MAIN = 'main'
const KEEP = 30 // agent rows kept besides main; finished ones go first
const SYNC_MS = 2000
// Change the tag when AgentRow's fields change: it declines what an earlier version stored.
const rows = atom({ plugin: 'agent-tracker', key: 'rows' } as const, [] as AgentRow[], { shape: 'rows-2' })
// Claude Code's welcome-screen figure, drawn in block characters.
const CLAWD = [' ▐▛███▜▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  ']

const MAIN_ROW: AgentRow = { id: MAIN, label: 'Claude', kind: 'main', status: 'idle', doing: 'waiting for you' }

function clip(s: string, n = 70): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, Math.max(1, n - 1))}…` : one
}

// The tool's most telling argument, e.g. Bash description or Read path.
function summary(input: Record<string, unknown>): string {
  for (const k of ['description', 'command', 'file_path', 'pattern', 'url', 'query', 'skill', 'subject', 'prompt']) {
    const v = input[k]
    if (typeof v === 'string' && v.trim()) return clip(v)
  }
  return ''
}

const STATUS: Record<AgentInfo['status'], AgentRow['status']> = {
  pending: 'running', running: 'running', waiting: 'idle', idle: 'idle', completed: 'done', failed: 'failed', killed: 'failed',
}

function fromRoster(a: AgentInfo, old?: AgentRow): AgentRow {
  return {
    id: a.id,
    label: a.name ?? a.teammateId ?? a.type,
    kind: a.teammateId ? 'teammate' : 'subagent',
    // The roster's status is the truth, also for teammates in their own pane, which send no events here.
    status: STATUS[a.status],
    doing: old?.doing ?? clip(a.description),
  }
}

// Main first, then the newest rows; finished rows are evicted before live ones.
function trim(list: AgentRow[]): AgentRow[] {
  const others = list.filter((r) => r.id !== MAIN)
  let drop = Math.max(0, others.length - KEEP)
  const kept = others.filter((r) => !(drop > 0 && (r.status === 'done' || r.status === 'failed') && drop--))
  return [list.find((r) => r.id === MAIN) ?? MAIN_ROW, ...kept.slice(-KEEP)]
}

// Patch a row that exists; events for unknown ids (engine forks) make no row.
async function patch($: Parameters<typeof update>[0], id: string, fn: (r: AgentRow) => Partial<AgentRow>): Promise<void> {
  await update($, rows, (list) => list.map((r) => (r.id === id ? { ...r, ...fn(r) } : r)))
}

export const register: Register = (on) => {
  let sync: Timer | undefined
  on('session.start', async ($, e, next) => {
    const roster = await $.agent.list()
    await update($, rows, () => trim([MAIN_ROW, ...roster.map((a) => fromRoster(a))]))
    await $.command.register({ name: 'tracker', description: 'agent-tracker: open the pane of what Claude, subagents and teammates are doing', immediate: true })
    await $.command.register({ name: 'assumptions', description: 'agent-tracker: review the assumptions Claude made (cards: true / false)', immediate: true })
    await $.tool.register({
      name: DECIDE,
      description: 'Log an assumption you are acting on that you did not verify and were not told (intent, setup, scope, behaviour). Not verified facts or trivia. Usually 0-3 per task.',
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          assumption: { type: 'string', description: 'What you assume is true, one sentence.' },
          basis: { type: 'string', description: 'Why you believe it, one sentence.' },
          if_wrong: { type: 'string', description: 'What breaks or changes if it is false.' },
        },
        required: ['assumption', 'basis'],
      },
    }).catch(() => {}) // A failed register must not cost the pane or the sync below.
    $.ui.open({ id: PANE, title: '✻ Agents' }).catch(() => {})
    // Sync with the engine's roster: catches pane teammates, kills and missed events.
    // A re-fired session.start must not stack a second timer.
    sync?.cancel()
    sync = $.clock.every(SYNC_MS, async () => {
      try {
        const list = await $.agent.list()
        await update($, rows, (cur) => {
          const known = new Map(cur.map((r) => [r.id, r]))
          const merged = cur.map((r) => {
            const a = list.find((x) => x.id === r.id)
            return a ? fromRoster(a, r) : r
          })
          return trim([...merged, ...list.filter((a) => !known.has(a.id)).map((a) => fromRoster(a))])
        })
      } catch {
        // Missed tick: the next one retries.
      }
    })
    return next(e)
  })

  on('command.run', { command: 'tracker' }, async ($) => {
    const r = await $.ui.open({ id: PANE, title: '✻ Agents' })
    return { text: r.isPlaced ? 'Agents pane opened.' : 'Agents pane is not shown on this surface.' }
  })

  on('command.run', { command: 'assumptions' }, async ($, e) => {
    const m = /^\s*(\d+)\s+(right|wrong|true|false|ok|no)\b\s*(.*)$/is.exec(e.args)
    if (!e.args.trim()) {
      const n = await reviewCards($, false)
      const list = await read($, decisions)
      return { text: `${n ? `Reviewed ${n}. ` : ''}${decisionsText(list)}` }
    }
    if (!m) return { text: 'Usage: /assumptions  (review cards + list)  ·  /assumptions <number> true  ·  /assumptions <number> false <what is true>' }
    const n = Number(m[1])
    const verdict = /^(right|true|ok)$/i.test(m[2]!) ? 'right' : 'wrong'
    const list = await read($, decisions)
    if (n < 1 || n > list.length) return { text: `No assumption ${n}; there are ${list.length}.` }
    await update($, decisions, (cur) => judge(cur, n, verdict, m[3] ?? ''))
    return { text: `Assumption ${n} marked ${verdict === 'right' ? 'true' : 'false'}.${verdict === 'wrong' ? ' Claude will be told with your next prompt.' : ''}` }
  })

  on('prompt.submit', async ($, e, next) => {
    // Only prompts a person typed carry the note, not peer or notification ones.
    if (e.command || e.isMeta || !['composer', 'bridge', 'sdk'].includes(e.origin.kind)) return next(e)
    const note = wrongNote(await read($, decisions))
    if (!note) return next(e)
    const r = await next({ ...e, context: [...(e.context ?? []), note] })
    if (!('drop' in r && r.drop)) await update($, decisions, (cur) => cur.map((d) => (d.verdict === 'wrong' ? { ...d, told: true } : d)))
    return r
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if (!e.tools.includes(DECIDE_TOOL) || ['bare', 'analysis', 'teammate'].some((t) => e.traits.includes(t as never))) return r
    return { sections: [...r.sections, { id: 'agent-tracker:assumptions', text: DECIDE_RULE, scope: 'session' }] }
  })

  on('agent.spawn', async ($, e, next) => {
    // Assumptions are tracked for the main Claude only (user's call): subagents get no rule.
    const r = await next(e)
    const id = r.agentId
    if (id) {
      const row: AgentRow = { id, label: r.teammateId?.split('@')[0] ?? e.subagentType, kind: r.teammateId ? 'teammate' : 'subagent', status: 'running', doing: clip(e.description) }
      // Its own events may already have landed: never reset an existing row's status.
      await update($, rows, (list) => (list.some((x) => x.id === id) ? list.map((x) => (x.id === id ? { ...x, label: row.label, kind: row.kind } : x)) : trim([...list, row])))
    }
    return r
  })

  on('turn.start', async ($, e, next) => {
    const ran = next(e)
    await patch($, e.agentId ?? MAIN, () => ({ status: 'running', doing: 'thinking…' })).catch(() => {})
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const ran = next(e)
    // Main turn over: pop a card for each new decision, after the engine finished the turn.
    if (!e.agentId && !e.isAborted) void ran.then(() => reviewCards($, true)).catch(() => {})
    const bad = e.reason === 'error' || e.reason === 'refusal' || e.isAborted
    await patch($, e.agentId ?? MAIN, (r) => {
      if (r.kind === 'main') return { status: 'idle', doing: e.isAborted ? 'interrupted · waiting for you' : 'waiting for you' }
      if (bad) return { status: r.kind === 'subagent' ? 'failed' : 'idle', doing: e.isAborted ? 'interrupted' : `ended: ${e.reason}` }
      // A subagent's turn ending ends it; a teammate waits for more.
      return { status: r.kind === 'subagent' ? 'done' : 'idle', doing: clip(e.answer || 'finished') }
    }).catch(() => {})
    return ran
  })

  // shortcut: shows the last tool started (no tool-end or permission-wait signal); hook tool.check if that matters.
  on('tool.call', async ($, e, next) => {
    if ((e.tool as string) === DECIDE_TOOL) {
      const input = e as unknown as Record<string, unknown>
      const str = (k: string) => (typeof input[k] === 'string' ? clip(input[k] as string, 300) : '')
      if (!str('assumption')) return { result: 'Not recorded: `assumption` is required.', isError: true }
      const id = e.agentId ?? MAIN
      const row = (await read($, rows)).find((r) => r.id === id)
      const who = id === MAIN ? 'Claude' : row ? (row.kind === 'subagent' ? `${row.label} #${id.slice(0, 4)}` : row.label) : `agent ${id.slice(0, 6)}`
      const d: Decision = { at: await $.clock.now(), who, decision: str('assumption'), why: str('basis'), alternatives: str('if_wrong') }
      await update($, decisions, (list) => [...list, d].slice(-DECISIONS_KEPT))
      return { result: 'Recorded.' }
    }
    const ran = next(e)
    const what = summary(e as unknown as Record<string, unknown>)
    await patch($, e.agentId ?? MAIN, () => ({ status: 'running', doing: what ? `${e.tool} · ${what}` : e.tool })).catch(() => {})
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, rows)
    const width = Math.max(20, e.props.bodyColumns - 4)
    const main = list.find((r) => r.id === MAIN) ?? MAIN_ROW
    const subs = list.filter((r) => r.kind === 'subagent')
    const team = list.filter((r) => r.kind === 'teammate')
    const made = await read($, decisions)
    const dot = { running: '●', idle: '○', done: '✓', failed: '✗' } as const
    const tint = { running: 'success', idle: 'warning', done: 'inactive', failed: 'error' } as const
    const live = (rs: AgentRow[]) => rs.filter((r) => r.status === 'running').length

    const row = (r: AgentRow) => (
      <Box key={r.id} flexDirection="column" paddingLeft={1}>
        <Text wrap="truncate-end">
          <Text color={tint[r.status]}>{dot[r.status]} </Text>
          <Text bold={r.status === 'running'} dimColor={r.status === 'done'}>{clip(r.label, width - 14)}</Text>
          <Text color={tint[r.status]} dimColor> {r.status}</Text>
        </Text>
        <Text dimColor wrap="truncate-end">  └ {clip(r.doing, width - 4)}</Text>
      </Box>
    )

    const section = (title: string, rs: AgentRow[], empty: string) => (
      <Box key={title} flexDirection="column" marginTop={1}>
        <Text wrap="truncate-end">
          <Text bold color="claude">{title}</Text>
          <Text dimColor>  {rs.length ? `${live(rs)} running · ${rs.length} total` : ''}</Text>
        </Text>
        {rs.length === 0 ? <Text dimColor>  {empty}</Text> : rs.slice().reverse().map(row)}
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor="claude" flexDirection="row" paddingX={1} gap={2}>
          <Box flexDirection="column">
            {CLAWD.map((line, i) => <Text key={String(i)} color="claude">{line}</Text>)}
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            <Text wrap="truncate-end">
              <Text color="claude" bold>Claude </Text>
              <Text color={tint[main.status]}>{dot[main.status]} {main.status}</Text>
            </Text>
            <Text dimColor wrap="truncate-end">{clip(main.doing, width - 14)}</Text>
          </Box>
        </Box>
        {section("Subagents", subs, "none yet")}
        {section("Teammates", team, "none")}
        <Box key="decisions" flexDirection="column" marginTop={1}>
          <Text wrap="truncate-end">
            <Text bold color="claude">Assumptions</Text>
            <Text dimColor>  {made.length ? `${made.length} · ${made.filter((d) => !d.verdict).length} to review · /assumptions` : ''}</Text>
          </Text>
          {made.length === 0 ? <Text dimColor>  none yet</Text> : made.slice(-DECISIONS_SHOWN).reverse().map((d, i) => { const n = made.length - i; return (
            <Box key={`d${d.at}-${n}`} flexDirection="column" paddingLeft={1}>
              <Box flexDirection="row" gap={1}>
                <Text color={d.verdict === 'right' ? 'success' : d.verdict === 'wrong' ? 'error' : 'claude'}>{d.verdict ? MARK[d.verdict] : '◆'}</Text>
                <Box flexGrow={1}><Text wrap="truncate-end" dimColor={d.verdict === 'right'}>{clip(d.decision, width - 16)}</Text></Box>
                <Button key={`ok${n}`} label="✓" onPress={() => update($, decisions, (cur) => judge(cur, n, 'right')).catch(() => {})} />
                <Button key={`no${n}`} label="✗" onPress={() => askWhy($, n)} />
              </Box>
              <Text dimColor wrap="truncate-end">  └ {clip(`${hhmm(d.at)} · ${d.who} · ${d.why}`, width - 4)}</Text>
            </Box>
          )})}
        </Box>
      </Box>
    )
  })
}
