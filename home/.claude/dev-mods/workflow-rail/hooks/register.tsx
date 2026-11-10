import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Mate, Me, Qc, Title } from './state'

// hit: -1 idle, 0 Plan, 1 Build, 2 Prove, 3 QC running, 4 QC passed, 5 Report done.
const hit = atom({ plugin: 'workflow-rail', key: 'hit' } as const, -1)
const qc = atom({ plugin: 'workflow-rail', key: 'qc' } as const, [] as Qc[], { shape: 'qc-1' })
const me = atom({ plugin: 'workflow-rail', key: 'me' } as const, null as Me | null, { shape: 'me-1' })

const raise = (to: number) => (h: number) => Math.max(h, to)
let lastDots = '' // what this session last wrote to @wf_team
let lastRefresh = 0 // debounce only; a hot reload resetting it is harmless
const detail = atom({ plugin: 'workflow-rail', key: 'detail' } as const, false) // /workflow toggles repo rows in the band
const title = atom({ plugin: 'workflow-rail', key: 'title' } as const, { text: '', byTask: false } as Title, { shape: 'title-1' })
const clip = (t: string, n: number) => ([...t].length > n ? [...t].slice(0, n - 1).join('') + '…' : t)
export const isUserPrompt = (e: any) => !e.isMeta && ['composer', 'bridge', 'sdk'].includes(e.origin?.kind)
export const promptTitle = (e: any) =>
  clip(e.command ? '' : (String(e.text).split('\n').map(l => l.trim()).find(Boolean) ?? '').replace(/\s+/g, ' '), 60)
const STAGES = ['Plan', 'Build', 'Prove', 'QC', 'Report']
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
      // names come from files and land in tmux status-right: no `#(` or `#[` may survive
      const safe = (n: string) => n.replace(/[^\w.-]/g, '_').replace(/#/g, '##')
      const dots = found.map(m => `● ${safe(m.agent)} ${letter(m)}`).join(' ')
      // tmux only when running; a user option the status line can show as #{@wf_team}
      // an empty team never overwrites another session's dots unless this session wrote some
      if (dots !== lastDots && (dots !== '' || lastDots !== '')) {
        lastDots = dots
        await $.process.run(['bash', '-c', '[ -n "$TMUX" ] && command -v tmux >/dev/null && tmux set -g @wf_team "$1"; true', 'x', dots])
      }
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
    // Only the person's own prompt starts a task; a subagent report or peer message must not wipe the band.
    if (!isUserPrompt(e)) return next(e)
    await update($, hit, () => -1)
    await update($, title, () => ({ text: promptTitle(e), byTask: false }))
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
    if (ran.deny === undefined && tool === 'TaskCreate' && !x.agentId && typeof x.subject === 'string' && x.subject.trim() && !(await read($, title)).byTask)
      await update($, title, () => ({ text: clip(x.subject.trim().replace(/\s+/g, ' '), 60), byTask: true }))
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

  on('session.end', async ($, e, next) => {
    if (lastDots !== '') {
      lastDots = ''
      await $.process.run(['bash', '-c', '[ -n "$TMUX" ] && command -v tmux >/dev/null && tmux set -gu @wf_team; true']).catch(() => {})
    }
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'workflow', description: 'Show or hide QC details in the workflow band' })
    return next(e)
  })

  on('command.run', { command: 'workflow' }, async $ => {
    const isOn = await update($, detail, d => !d)
    if (isOn) await refresh($, true) // idle sessions have not measured yet
    return { text: isOn ? 'Workflow details shown above the prompt.' : 'Workflow details hidden.' }
  })

  // No pane: panes share one tabbed panel with every other plugin, so details live in the band.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const lvl = await read($, hit)
    const isDetail = await read($, detail)
    if (lvl < 0 && !isDetail) return next(e)
    // Compose with other mods' bands (header-tray) instead of hiding them.
    const below = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const q = await read($, qc)
    const bad = isBlocked(q)
    const name = (await read($, title)).text
    // Color rail (band-styles artifact): done green, current bold cyan, pending dim, blocked red.
    const seg = (i: number) => {
      const m = mark(i, lvl, bad)
      const label = `${STAGES[i]} ${m}`
      return m === '✓' ? <Text color="green">{label}</Text>
        : m === '✗' || (bad && m === '●' && lvl < 3) ? <Text color="red" bold>{label}</Text> // a block before QC still shows red
        : m === '●' ? <Text color="cyan" bold>{label}</Text>
        : <Text dimColor>{label}</Text>
    }
    return (
      <Box flexDirection="column">
        {name !== '' && <Text><Text dimColor>▍ </Text><Text bold>{name}</Text></Text>}
        {lvl < 0 ? <Text dimColor>No task started</Text>
          : <Text>{STAGES.flatMap((_, i) => (i > 0 ? [<Text dimColor> · </Text>, seg(i)] : [seg(i)]))}</Text>}
        {isDetail && q.length === 0 && <Text dimColor>No repo tracked yet.</Text>}
        {isDetail && q.map(r => (
          <Text dimColor>
            {`  ${clip(r.repo.split('/').pop() || r.repo, 30)} · ${r.lines} lines · `}
            <Text color={r.reviewed > 0 ? undefined : 'yellow'}>{r.reviewed > 0 ? `reviewed ${r.reviewed}` : 'reviewer not run'}</Text>
            {' · '}
            <Text color={r.passed ? undefined : 'yellow'}>{r.passed ? 'guardrail PASS' : 'no guardrail PASS'}</Text>
            {` · blocks ${r.blocks}/${MAX_BLOCKS}`}
          </Text>
        ))}
        {below}
      </Box>
    )
  })
}
