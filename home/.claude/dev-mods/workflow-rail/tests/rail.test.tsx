import { expect, test } from 'claude-code/testing'

const BAND = { plugin: 'workflow-rail', component: 'AbovePrompt', requestId: 'b', surface: 'terminal', props: { bodyColumns: 80 } } as const
const PANE = { plugin: 'workflow-rail', component: 'Pane', requestId: 'workflow', surface: 'terminal',
  props: { title: 'Workflow', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } } as const
const dirty = { repo: '/r/x', lines: 41, reviewed: 0, passed: false, blocks: 1, needs_gate: true }
const passed = { ...dirty, passed: true, needs_gate: false, blocks: 0 }

// Stands in for the engine; returns what the test can read back.
function setup(on: any, o: { rows: any; mates?: any[] }) {
  const seen = { status: [] as any[], opened: [] as string[], t: 10_000_000 }
  on('command.register', () => ({ value: { command: 'workflow' } }))
  on('ui.open', (_: any, e: any) => { seen.opened.push(e.id); return { value: { isPlaced: true } } })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/r/x' }))
  on('env.get', () => ({ value: '/h' }))
  on('clock.now', () => ({ value: (seen.t += 5000) }))
  on('process.run', (_: any, e: any) => ({ value: { exitCode: 0, stdout: e.argv?.[1] === 'status' ? JSON.stringify(o.rows) : '', stderr: '' } }))
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

test('a rising block count opens the pane by itself, once', async ($, on) => {
  const seen = setup(on, { rows: [dirty] })
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/r/x/a.js' })
  expect(seen.opened).toEqual(['workflow'])
  expect(seen.status.at(-1)).toBe('QC: blocked 1/3')
})

test('a teammate file adds a row; a malformed or stale one is ignored', async ($, on) => {
  setup(on, { rows: [dirty], mates: [
    { name: 'builder-1.json', body: JSON.stringify({ agent: 'builder-1', hit: 1, blocked: false }) },
    { name: 'bad.json', body: '{"agent":5}' },
    { name: 'old.json', mtimeMs: 1, body: JSON.stringify({ agent: 'old', hit: 1 }) },
  ] })
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/r/x/a.js' })
  const rows = await bandText($)
  expect(rows.some((r: string) => r.startsWith('builder-1') && r.includes('Build ●'))).toBe(true)
  expect(rows.some((r: string) => r.includes('old'))).toBe(false)
})
