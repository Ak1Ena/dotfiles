import { expect, test } from 'claude-code/testing'

import { isUserPrompt, promptTitle } from '../hooks/register'

const BAND = { plugin: 'workflow-rail', component: 'AbovePrompt', requestId: 'b', surface: 'terminal', props: { bodyColumns: 80 } } as const
const PANE = { plugin: 'workflow-rail', component: 'Pane', requestId: 'workflow', surface: 'terminal',
  props: { title: 'Workflow', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } } as const
const dirty = { repo: '/r/x', lines: 41, reviewed: 0, passed: false, blocks: 1, needs_gate: true }
const passed = { ...dirty, passed: true, needs_gate: false, blocks: 0 }

// Stands in for the engine; returns what the test can read back.
function setup(on: any, o: { rows: any; mates?: any[] }) {
  const seen = { status: [] as any[], opened: [] as string[], runs: [] as any[][], t: 10_000_000 }
  on('command.register', () => ({ value: { command: 'workflow' } }))
  on('ui.open', (_: any, e: any) => { seen.opened.push(e.id); return { value: { isPlaced: true } } })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/r/x' }))
  on('env.get', () => ({ value: '/h' }))
  on('clock.now', () => ({ value: (seen.t += 5000) }))
  on('process.run', (_: any, e: any) => (seen.runs.push(e.argv), { value: { exitCode: 0, stdout: e.argv?.[1] === 'status' ? JSON.stringify(o.rows) : '', stderr: '' } }))
  on('fs.list', () => ({ value: (o.mates ?? []).map(m => ({ name: m.name, kind: 'file', mtimeMs: m.mtimeMs ?? seen.t })) }))
  on('fs.read', (_: any, e: any) => ({ value: (o.mates ?? []).find(m => e.path.endsWith(m.name))?.body ?? '' }))
  on('fs.write', () => ({ value: {} }))
  on('ui.status', (_: any, e: any) => { seen.status.push(e.text); return { value: {} } })
  on('ui.render', ($: any, e: any) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  return seen
}
const start = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
const bandText = async ($: any) => {
  const ui = await $.ui.mount(BAND)
  const all = (await ui.findAll?.({ type: 'Text' })) ?? [await ui.find({ type: 'Text' })]
  await ui.unmount()
  return all.map((t: any) => t?.text)
}

test('idle band falls through; after an Edit it shows the rail; pane lists what is missing', async ($, on) => {
  setup(on, { rows: [dirty] })
  await start($)
  expect((await bandText($))[0]).toBe('engine')
  await $.tool.call({ tool: 'Edit', file_path: '/r/x/a.js' })
  expect((await bandText($))[0]).toBe('Plan ✓ · Build ● · Prove ○ · QC ○ · Report ○')
  const p = await $.ui.mount(PANE)
  expect((await p.find({ type: 'Text', text: /reviewer not run/ }))?.text).toContain('reviewer not run')
  expect((await p.find({ type: 'Text', text: /blocks 1\/3/ }))?.text).toContain('41 changed lines')
  await p.unmount()
})

test('a guardrail PASS moves the rail past QC and says QC: passed', async ($, on) => {
  const seen = setup(on, { rows: [passed] })
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/r/x/a.js' })
  expect((await bandText($))[0]).toBe('Plan ✓ · Build ✓ · Prove ✓ · QC ✓ · Report ●')
  expect(seen.status.at(-1)).toBe('QC: passed')
})

test('a block does not open the pane by itself; the status says blocked', async ($, on) => {
  const seen = setup(on, { rows: [dirty] })
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/r/x/a.js' })
  expect(seen.opened).toEqual([])
  expect(seen.status.at(-1)).toBe('QC: blocked 1/3')
  const ui = await $.ui.mount(BAND)
  const colored = ((await ui.findAll?.({ type: 'Text' })) ?? []).filter((t: any) => t?.props?.color)
  const red = colored.filter((t: any) => t.props.color === 'red').map((t: any) => t.text)
  await ui.unmount()
  expect(red).toEqual(['Build ●']) // blocked before QC: the current stage turns red
  expect(colored.filter((t: any) => t.props.color === 'green').map((t: any) => t.text)).toEqual(['Plan ✓'])
  expect(colored.filter((t: any) => t.props.color === 'cyan')).toEqual([]) // current is red, not cyan, while blocked
})

test('teammate files add no band rows; the tmux dots are still built; bad and stale files are skipped', async ($, on) => {
  const seen = setup(on, { rows: [dirty], mates: [
    { name: 'builder-1.json', body: JSON.stringify({ agent: 'builder-1', hit: 5, blocked: false }) },
    { name: 'builder-2.json', body: JSON.stringify({ agent: 'builder-2', hit: 3, blocked: false }) },
    { name: 'bad.json', body: '{"agent":5}' },
    { name: 'old.json', mtimeMs: 1, body: JSON.stringify({ agent: 'old', hit: 1 }) },
  ] })
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/r/x/a.js' })
  const rows = await bandText($)
  expect(rows[0]).toBe('Plan ✓ · Build ● · Prove ○ · QC ○ · Report ○') // the rail alone: no title
  expect(rows.some((t: string) => /builder|old/.test(t ?? ''))).toBe(false) // no teammate rows
  const tmux = seen.runs.filter(a => a[0] === 'bash' && String(a[2]).includes('@wf_team')).at(-1)
  expect(tmux?.at(-1)).toBe('● builder-1 ✓ ● builder-2 Q')
})

const wf = (seen: any) => seen.runs.filter((a: any[]) => a[0] === 'bash' && String(a[2]).includes('@wf_team'))
const edit = ($: any) => $.tool.call({ tool: 'Edit', file_path: '/r/x/a.js' })

test('an empty team writes nothing, and session end clears nothing', async ($, on) => {
  const seen = setup(on, { rows: [dirty] })
  on('session.end', (_: any, e: any) => ({ sessionId: 's1' }))
  await start($)
  await edit($)
  await $.session.end({} as any)
  expect(wf(seen).length).toBe(0)
})

test('a blocked teammate shows X; hostile names are made safe; unchanged dots write once; session end clears', async ($, on) => {
  const seen = setup(on, { rows: [dirty], mates: [
    { name: 'a.json', body: JSON.stringify({ agent: 'x#(rm)', hit: 3, blocked: true }) },
    { name: 'b.json', body: JSON.stringify({ agent: 'ok-1', hit: 5, blocked: false }) },
  ] })
  on('session.end', (_: any, e: any) => ({ sessionId: 's1' }))
  await start($)
  await edit($)
  await edit($)
  await $.tool.call({ tool: 'TodoWrite' })
  expect(wf(seen).length).toBe(1)
  expect(wf(seen)[0].at(-1)).toBe('● x__rm_ ✗ ● ok-1 ✓')
  await $.session.end({} as any)
  expect(seen.runs.some((a: any[]) => String(a[2]).includes('set -gu @wf_team'))).toBe(true)
})

test('which prompts start a task, and what title they give', () => {
  expect(isUserPrompt({ origin: { kind: 'composer' } })).toBe(true)
  expect(isUserPrompt({ origin: { kind: 'sdk' } })).toBe(true)
  for (const o of ['task-notification', 'peer', 'scheduled-trigger', 'plugin']) expect(isUserPrompt({ origin: { kind: o } })).toBe(false)
  expect(isUserPrompt({ origin: { kind: 'composer' }, isMeta: true })).toBe(false)
  expect(isUserPrompt({})).toBe(false)
  expect(promptTitle({ text: '\n  Add   a title\n more' })).toBe('Add a title')
  expect(promptTitle({ text: '/workflow', command: { name: 'workflow' } })).toBe('')
  expect(promptTitle({ text: 'x'.repeat(80) })).toBe('x'.repeat(59) + '…')
  expect([...promptTitle({ text: '😀'.repeat(80) })].length).toBe(60)
})

test('TaskCreate sets the title once; a plugin-origin prompt (the harness only sends that) keeps title and rail', async ($, on) => {
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
  setup(on, { rows: [dirty] })
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/r/x/a.js' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Real task', description: 'd' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Second task', description: 'd' })
  const before = await bandText($)
  expect(before[0]).toBe('▍ Real task')
  await $.prompt.submit({ text: 'subagent done' })
  expect(await bandText($)).toEqual(before)
  const p = await $.ui.mount(PANE)
  expect((await p.find({ type: 'Text', text: /Real task/ }))?.text).toBe('Real task')
  await p.unmount()
})

test('a subagent TaskCreate does not set the title', async ($, on) => {
  setup(on, { rows: [dirty] })
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/r/x/a.js' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Sub', description: 'd', agentId: 'a1' } as any)
  expect((await bandText($))[0]).toBe('Plan ✓ · Build ● · Prove ○ · QC ○ · Report ○')
})
