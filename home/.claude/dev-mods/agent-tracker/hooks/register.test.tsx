import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'agent-tracker',
  component: 'Pane',
  requestId: 'agent-tracker',
  props: { title: 'Agents', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

// The test kit's `on`, loosely typed for a shared engine stub.
type On = (event: string, hook: (...a: any[]) => unknown) => void

function engine(on: On, roster: unknown[] = []) {
  on('command.register', () => ({ value: { command: 'tracker' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: roster }))
  on('clock.every', () => ({ value: undefined }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_: unknown, e: { answer: string }) => ({ text: e.answer }))
  on('agent.spawn', (_: unknown, e: { subagentType: string }) =>
    e.subagentType === 'teammate' ? { model: 'sonnet', agentId: 'tm1', teammateId: 'builder@team' } : { model: 'sonnet', agentId: 'sub1' })
}

const start = { cwd: '/', surface: 'terminal', isInteractive: true } as const

test('sections: Claude, a subagent and a teammate with their actions', async ($, on) => {
  engine(on as never)
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.agent.spawn({ prompt: 'p', description: 'review diff', subagentType: 'reviewer' } as never)
  await $.agent.spawn({ prompt: 'p', description: 'build it', subagentType: 'teammate' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/x/a.ts', agentId: 'sub1' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^Claude/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Bash · npm test/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Subagents/ })).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /reviewer/ }))?.text).toContain('running')
  expect(await ui.find({ type: 'Text', text: /Read · \/x\/a.ts/ })).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /builder/ }))?.text).toContain('running')
  await ui.unmount()
})

test('subagent done, teammate idle, main waits; late spawn keeps done', async ($, on) => {
  engine(on as never)
  await $.session.start(start)
  await $.agent.spawn({ prompt: 'p', description: 'find X', subagentType: 'scout' } as never)
  await $.turn.complete({ answer: 'found it', durationMs: 1, isAborted: false, turnId: 't', agentId: 'sub1', reason: 'answer' } as never)
  await $.agent.spawn({ prompt: 'p', description: 'find X', subagentType: 'scout' } as never) // same id lands late
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /scout/ }))?.text).toContain('done')
  expect(await ui.find({ type: 'Text', text: /waiting for you/ })).toBeTruthy()
  await ui.unmount()
})

test('roster at start shows a pane teammate and maps killed to failed', async ($, on) => {
  engine(on as never, [
    { id: 'a@t', teammateId: 'a@t', name: 'designer', description: 'mock the UI', type: 'teammate', status: 'idle' },
    { id: 'k1', description: 'long job', type: 'Explore', status: 'killed' },
  ])
  await $.session.start(start)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /designer/ }))?.text).toContain('idle')
  expect((await ui.find({ type: 'Text', text: /Explore/ }))?.text).toContain('failed')
  await ui.unmount()
})

test('events for an unknown id (engine fork) make no row', async ($, on) => {
  engine(on as never)
  await $.session.start(start)
  await $.tool.call({ tool: 'Grep', pattern: 'zzz', agentId: 'fork9' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /zzz/ })).toBeUndefined()
  await ui.unmount()
})

test('record_assumption is served by the mod, shown in the pane, and never reaches the engine', async ($, on) => {
  engine(on as never)
  on('tool.register', () => ({ value: { tool: 'mcp__agent-tracker__record_assumption' } }))
  on('clock.now', () => ({ value: Date.UTC(2026, 10, 9, 4, 30) }))
  await $.session.start(start)
  const r = await $.tool.call({ tool: 'mcp__agent-tracker__record_assumption', assumption: 'Used Haiku for the brief', basis: 'cheap and fast', if_wrong: 'Sonnet' } as never)
  expect((r as { result?: unknown }).result).toBe('Recorded.')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Assumptions/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Used Haiku for the brief/ })).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /cheap and fast/ }))?.text).toContain('Claude')
  await ui.unmount()
})

test('record_assumption without an assumption is an error and records nothing', async ($, on) => {
  engine(on as never)
  on('tool.register', () => ({ value: { tool: 'mcp__agent-tracker__record_assumption' } }))
  await $.session.start(start)
  const r = await $.tool.call({ tool: 'mcp__agent-tracker__record_assumption', basis: 'x' } as never)
  expect((r as { isError?: true }).isError).toBe(true)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /none yet/ })).toBeTruthy()
  await ui.unmount()
})

test('a decision marked wrong rides the next prompt as context, once', async ($, on) => {
  on('tool.call', { tool: 'AskUserQuestion' }, (_: unknown, e: { questions: { question: string }[] }) => ({ result: { questions: e.questions, answers: { [e.questions[0]!.question]: 'Not what I asked' } } }) as never)
  engine(on as never)
  on('tool.register', () => ({ value: { tool: 'mcp__agent-tracker__record_assumption' } }))
  on('clock.now', () => ({ value: 0 }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  await $.session.start(start)
  await $.tool.call({ tool: 'mcp__agent-tracker__record_assumption', assumption: 'Deleted old logs', basis: 'took clean up literally' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ type: 'Button', key: 'no1' } as never)
  await ui.unmount()

  const origin = { kind: 'composer' } as const
  const first = await $.prompt.submit({ text: 'next', wait: false, origin })
  expect(first.context?.[0]).toContain('assumptions of yours FALSE')
  expect(first.context?.[0]).toContain('Deleted old logs')
  expect(first.context?.[0]).toContain('user says: Not what I asked')
  const second = await $.prompt.submit({ text: 'again', wait: false, origin })
  expect(second.context).toBeUndefined()
})

test('main turn end pops a card per new decision: True, then False with a reason', async ($, on) => {
  const answers = ['True', 'False', 'Not what I asked']
  const asked: string[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_: unknown, e: { questions: { question: string }[] }) => {
    asked.push(e.questions[0]!.question)
    return { result: { questions: e.questions, answers: { [e.questions[0]!.question]: answers.shift() } } } as never
  })
  engine(on as never)
  on('tool.register', () => ({ value: { tool: 'mcp__agent-tracker__record_assumption' } }))
  on('clock.now', () => ({ value: 0 }))
  await $.session.start(start)
  await $.tool.call({ tool: 'mcp__agent-tracker__record_assumption', assumption: 'Used Haiku', basis: 'cheap' } as never)
  await $.tool.call({ tool: 'mcp__agent-tracker__record_assumption', assumption: 'Skipped tests', basis: 'docs only' } as never)
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  const wait = (ms: number) => new Promise((r) => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(() => r(null), ms))
  for (let i = 0; i < 40 && asked.length < 3; i++) await wait(10) // cards run after the turn settles

  expect(asked[0]).toContain('Assumption 1 by Claude')
  expect(asked[0]).toContain('Used Haiku')
  expect(asked[1]).toContain('Skipped tests')
  expect(asked[2]).toContain('why is assumption 2 false?')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^✓$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^✗$/ })).toBeTruthy()
  await ui.unmount()
})

test('after the cards, a FALSE mark is sent to Claude straight away as its own prompt, once', async ($, on) => {
  const answers = ['False', 'Not what I meant']
  const sent: string[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_: unknown, e: { questions: { question: string }[] }) =>
    ({ result: { questions: e.questions, answers: { [e.questions[0]!.question]: answers.shift() } } }) as never)
  engine(on as never)
  on('tool.register', () => ({ value: { tool: 'mcp__agent-tracker__record_assumption' } }))
  on('clock.now', () => ({ value: 0 }))
  on('prompt.submit', (_, e) => { sent.push(e.text); return { text: e.text, context: e.context } })
  await $.session.start(start)
  await $.tool.call({ tool: 'mcp__agent-tracker__record_assumption', assumption: 'Subagents log too', basis: 'tracker covers them' } as never)
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  const wait = (ms: number) => new Promise((r) => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(() => r(null), ms))
  for (let i = 0; i < 40 && sent.length < 1; i++) await wait(10)

  expect(sent[0]).toContain('assumptions of yours FALSE')
  expect(sent[0]).toContain('user says: Not what I meant')
  const next = await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  expect(next.context).toBeUndefined() // already told, not repeated
})

test('session.start opens the Agents pane unfocused; the pane draws no tab tray', async ($, on) => {
  const opened: any[] = []
  on('command.register', () => ({ value: { command: 'tracker' } }))
  on('ui.open', (_: unknown, e: any) => { opened.push(e); return { value: { isPlaced: true } } })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: [] }))
  on('clock.every', () => ({ value: undefined }))
  await $.session.start(start)
  expect(opened.map((p) => [p.id, p.title, p.focus])).toEqual([['agent-tracker', '✻ Agents', undefined]])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', key: 'tab-agents' } as never)).toBeUndefined()
  await ui.unmount()
})
