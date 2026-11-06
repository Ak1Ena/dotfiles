import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Mate, Me, Qc } from './state'

// hit: -1 idle, 0 Plan, 1 Build, 2 Prove, 3 QC running, 4 QC passed, 5 Report done.
const hit = atom({ plugin: 'workflow-rail', key: 'hit' } as const, -1)
const qc = atom({ plugin: 'workflow-rail', key: 'qc' } as const, [] as Qc[], { shape: 'qc-1' })
const mates = atom({ plugin: 'workflow-rail', key: 'mates' } as const, [] as Mate[], { shape: 'mates-1' })
const me = atom({ plugin: 'workflow-rail', key: 'me' } as const, null as Me | null, { shape: 'me-1' })
const blocksSeen = atom({ plugin: 'workflow-rail', key: 'blocksSeen' } as const, 0)

const raise = (to: number) => (h: number) => Math.max(h, to)
let lastRefresh = 0 // debounce only; a hot reload resetting it is harmless
const STAGES = ['Plan', 'Build', 'Prove', 'QC', 'Report']
const PANE = 'workflow'
const MAX_BLOCKS = 3 // qc-gate.sh QC_MAX_BLOCKS default
const PROVE = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build|lint|typecheck)|\btsc\b|\bpytest\b|\bjest\b|\bvitest\b|\bgo\s+test|\bcargo\s+(test|build)|\bbash\s+\S*test\S*\.sh|\bmake\s+test/
const PLAN_TOOLS = ['TaskCreate', 'TodoWrite']
const BUILD_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

const isBlocked = (q: Qc[]) => q.some(r => r.needs_gate && r.blocks > 0)
const isPending = (q: Qc[]) => q.some(r => r.needs_gate)
const letter = (m: { hit: number; blocked: boolean }) =>
  m.hit >= 5 ? '✓' : m.blocked ? '✗' : 'PBVQR'[m.hit] ?? '·'
const mark = (i: number, h: number, blocked: boolean) =>
  i === 3 && blocked && h >= 3 ? '✗' : i < h ? '✓' : i === h ? '●' : '○'
const rail = (h: number, blocked: boolean) =>
  STAGES.map((s, i) => `${s} ${mark(i, h, blocked)}`).join(' · ')

// Who am I: teammate (agent + lead's session dir) or lead/solo. Read once per load.
async function whoami($: any): Promise<Me> {
  const have = await read($, me)
  if (have) return have
  const script = `pid=$PPID; for _ in 1 2 3 4 5 6; do [ -z "$pid" ] || [ "$pid" -le 1 ] && break
a=$(ps -o args= -p $pid 2>/dev/null); case "$a" in *--agent-id*) printf '%s\\t%s' "$(printf %s "$a" | sed -nE 's/.*--agent-name[ =]([^ ]+).*/\\1/p')" "$(printf %s "$a" | sed -nE 's/.*--team-name[ =]([^ ]+).*/\\1/p')"; exit;; esac
pid=$(ps -o ppid= -p $pid 2>/dev/null | tr -d ' '); done`
  let who: Me = 'lead'
  let isSettled = true // a failed team-config read must not pin 'lead' forever
  try {
    const r = await $.process.run(['bash', '-c', script])
    const [agent, team] = r.stdout.split('\t')
    if (agent && team) {
      isSettled = false
      const c = await $.process.run(['jq', '-r', '.leadSessionId // empty', `${await $.env.get('HOME')}/.claude/teams/${team}/config.json`])
      if (c.stdout.trim()) { who = { agent, lead: c.stdout.trim() }; isSettled = true }
    }
  } catch { isSettled = false }
  if (isSettled) await update($, me, () => who)
  return who
}

async function wfDir($: any) {
  const who = await whoami($)
  return `${await $.env.get('HOME')}/.claude/work/${who === 'lead' ? await $.session.id() : who.lead}/wf`
}

// One git-measuring call per refresh, via the gate's read-only status mode.
async function refresh($: any, isForced = false) {
  const now = await $.clock.now()
  if (!isForced && now - lastRefresh < 2000) return
  lastRefresh = now
  try {
    const sid = await $.session.id()
    const cwd = await $.session.cwd()
    const r = await $.process.run([`${await $.env.get('HOME')}/.claude/hooks/qc-gate.sh`, 'status'], { stdin: JSON.stringify({ session_id: sid, cwd }) })
    const rows: Qc[] = JSON.parse(r.stdout || '[]')
    await update($, qc, () => rows)
    const h = await read($, hit)
    if (h >= 1 && h < 5 && rows.some(x => x.lines > 0) && !isPending(rows) && rows.some(x => x.passed))
      await update($, hit, raise(4))
    const total = rows.reduce((n, x) => n + (x.needs_gate ? x.blocks : 0), 0)
    if (total > (await read($, blocksSeen))) void $.ui.open({ id: PANE, title: 'Workflow' })
    await update($, blocksSeen, () => total)
  } catch {}
  await publish($)
}

async function publish($: any) {
  try {
    const h = await read($, hit)
    const q = await read($, qc)
    const dir = await wfDir($)
    const who = await whoami($)
    if (who !== 'lead') {
      await $.fs.write(`${dir}/${who.agent}.json`, JSON.stringify({ agent: who.agent, hit: h, blocked: isBlocked(q) }))
    } else {
      const found: Mate[] = []
      for (const f of await $.fs.list(dir).catch(() => [])) {
        if (!f.name.endsWith('.json')) continue
        if (f.mtimeMs && (await $.clock.now()) - f.mtimeMs > 30 * 60_000) continue // stale teammate
        try {
          const o = JSON.parse(await $.fs.read(`${dir}/${f.name}`))
          if (o && typeof o.agent === 'string' && typeof o.hit === 'number') found.push({ agent: o.agent, hit: o.hit, blocked: o.blocked === true })
        } catch {}
      }
      await update($, mates, () => found)
      const dots = found.map(m => `● ${m.agent} ${letter(m)}`).join(' ')
      // tmux only when running; a user option the status line can show as #{@wf_team}
      await $.process.run(['bash', '-c', '[ -n "$TMUX" ] && command -v tmux >/dev/null && tmux set -g @wf_team "$1"; true', 'x', dots])
    }
    const bad = isBlocked(q)
    const pend = q.filter(r => r.needs_gate)
    $.ui.status(
      h < 1 || !q.some(r => r.lines > 0) ? undefined
        : bad ? `QC: blocked ${Math.max(...q.map(r => r.blocks))}/${MAX_BLOCKS}`
        : pend.length ? (pend.every(r => r.reviewed === 0) ? `QC: ${pend.reduce((n, r) => n + r.lines, 0)} lines unreviewed` : 'QC: awaiting guardrail PASS')
        : q.some(r => r.passed) ? 'QC: passed' : undefined,
    )
  } catch {}
}


export const register: Register = on => {

  on('prompt.submit', async ($, e, next) => {
    await update($, hit, () => -1)
    await update($, blocksSeen, () => 0)
    await publish($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const x = e as any
    const tool = String(x.tool)
    let to = -1
    if (PLAN_TOOLS.includes(tool) || (tool === 'Skill' && /^(goal|pstack)/.test(String(x.skill ?? '')))) to = 0
    else if (BUILD_TOOLS.includes(tool)) to = 1
    else if (tool === 'Bash' && PROVE.test(String(x.command ?? ''))) to = 2
    else if (tool === 'Agent' && /^(.*:)?(reviewer|guardrail)$/.test(String(x.subagent_type ?? ''))) to = 3
    if (to >= 0 && !x.agentId) await update($, hit, raise(to))
    const ran = await next(e)
    if (to === 1 || to === 3) await refresh($)
    else if (to >= 0) await publish($)
    return ran
  })

  on('turn.start', async ($, e, next) => {
    if (!(e as any).agentId) await refresh($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if ((e as any).agentId) return next(e)
    await refresh($, true)
    if ((await read($, hit)) >= 1 && !isPending(await read($, qc))) await update($, hit, raise(5))
    await publish($)
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'workflow', description: 'Show the QC workflow pane' })
    return next(e)
  })

  on('command.run', { command: 'workflow' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Workflow' })
    return { text: 'Workflow pane opened.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const lvl = await read($, hit)
    if (lvl < 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const bad = isBlocked(await read($, qc))
    const team = await read($, mates)
    return (
      <Box flexDirection="column">
        <Text color={bad ? 'red' : undefined}>{rail(lvl, bad)}</Text>
        {team.map(m => (
          <Text dimColor>{m.agent.padEnd(12)} {rail(m.hit, m.blocked)}</Text>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const q = await read($, qc)
    const lvl = await read($, hit)
    return (
      <Box flexDirection="column">
        <Text bold>{lvl < 0 ? 'No task started' : rail(lvl, isBlocked(q))}</Text>
        {q.length === 0 && <Text dimColor>No repo tracked yet.</Text>}
        {q.map(r => (
          <Box flexDirection="column">
            <Text>{r.repo}</Text>
            <Text dimColor>  {r.lines} changed lines · blocks {r.blocks}/{MAX_BLOCKS}</Text>
            <Text color={r.reviewed > 0 ? undefined : 'yellow'}>  {r.reviewed > 0 ? `reviewer ran on ${r.reviewed} lines` : 'reviewer not run'}</Text>
            <Text color={r.passed ? undefined : 'yellow'}>  {r.passed ? 'guardrail PASS' : 'no guardrail PASS'}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
