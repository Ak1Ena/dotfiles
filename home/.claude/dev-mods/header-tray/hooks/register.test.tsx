import { expect, test } from 'claude-code/testing'

import { extractHtml, parseArtifacts } from './register'

const BAND = {
  plugin: 'header-tray',
  component: 'AbovePrompt',
  props: { hasSurvey: false },
} as const

const PANE = {
  plugin: 'header-tray',
  component: 'Pane',
  requestId: 'artifact-view',
  props: { title: 'x', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const LIST = {
  artifacts: [
    { slug: 's1', title: 'Health OCR JSON changes', url: 'https://claude.ai/artifact/A1' },
    { slug: 's2', title: 'Filter bar', url: 'https://claude.ai/artifact/B2' },
  ],
}

const PAGE = '<!DOCTYPE html><html><body><h1>Report</h1></body></html>'

type Calls = { reads: string[]; runs: string[][]; written: string[] }

function engine(on: any, chromeExit = 0): Calls {
  const calls: Calls = { reads: [], runs: [], written: [] }
  on('command.register', () => ({ value: { command: 'tray' } }))
  on('clock.every', () => ({ value: undefined }))
  on('agent.list', () => ({
    value: [
      { id: 'a1', type: 'reviewer', description: 'review', status: 'running' },
      { id: 'a2', type: 'scout', description: 'find', status: 'completed' },
      { id: 'a3', teammateId: 'builder@team', type: 'teammate', description: 'b', status: 'idle' },
    ],
  }))
  on('mcp.call', (_: unknown, e: { tool: string; args?: { slug?: string } }) => {
    if (e.tool === 'read_artifact') {
      calls.reads.push(e.args?.slug ?? '')
      return { value: { isError: false, content: [{ type: 'text', text: `{"slug":"s1"}\n<untrusted-document-x>${PAGE}</untrusted-document-x>\nreminder` }] } }
    }
    return { value: { isError: false, content: [{ type: 'text', text: JSON.stringify(LIST) }] } }
  })
  on('fs.write', (_: unknown, e: { path: string }) => (calls.written.push(e.path), { value: undefined }))
  on('fs.exists', () => ({ value: chromeExit === 0 }))
  on('process.run', (_: unknown, e: { argv: string[] }) => (calls.runs.push(e.argv), { value: { exitCode: chromeExit, stdout: '', stderr: 'boom' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: {} }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  // Stands for the engine's own band below the plugin.
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return calls
}

// session.start no longer awaits the list; a publish through the server loads it.
async function start($: any) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__claude-artifacts__publish_version', content: '' })
}

test('parseArtifacts keeps only claude.ai URLs and strips control chars from titles', () => {
  const text = JSON.stringify({
    artifacts: [
      ...LIST.artifacts,
      { slug: 'x', title: 'evil', url: 'file:///Applications/Calc.app' },
      { slug: 's3', title: 'a\u001b]0;pwn\u0007b', url: 'https://claude.ai/artifact/C' },
    ],
  })
  expect(parseArtifacts(`notice\n${text}`).map((a) => a.title)).toEqual(['Health OCR JSON changes', 'Filter bar', 'a]0;pwnb'])
})

test('extractHtml takes the document out of the read_artifact wrapper', () => {
  expect(extractHtml(`{"a":1}\n<untrusted-document-x>${PAGE}</untrusted-document-x>\nreminder`)).toBe(PAGE)
  expect(extractHtml('no page')).toBeNull()
})

test('pressing an artifact renders its HTML with Chrome and shows it as an Image', async ($, on) => {
  const calls = engine(on)
  await start($)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Button', key: 'art-0' }))?.props.label).toBe('Health OCR JSON changes')
  await band.press({ key: 'art-0' })
  await band.unmount()

  expect(calls.reads).toEqual(['s1'])
  expect(calls.written).toEqual(['/tmp/header-tray/s1.html'])
  expect(calls.runs[0].some((x) => /^--screenshot=\/tmp\/header-tray\/s1\.png$/.test(x))).toBe(true)
  expect(calls.runs[0].at(-1)).toBe('file:///tmp/header-tray/s1.html')

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const img = await pane.find({ type: 'Image', key: 'page' })
  expect((img?.props.source as { file: string }).file).toBe('/tmp/header-tray/s1.png')
  expect(img?.props.columns).toBe(80)
  await pane.unmount()
})

test('a Chrome failure shows a message instead of an image', async ($, on) => {
  engine(on, 1)
  await start($)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'art-0' })
  await band.unmount()
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await pane.find({ type: 'Text', text: /Could not render/ }))?.text).toBe('Could not render: Chrome failed: boom')
  expect(await pane.find({ type: 'Image' })).toBeUndefined()
  await pane.unmount()
})

test('band lists live agents only, teammates by name', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Text', text: /reviewer/ }))?.text).toBe('● reviewer  ')
  expect((await band.find({ type: 'Text', text: /builder/ }))?.text).toBe('○ builder  ')
  expect(await band.find({ type: 'Text', text: /scout/ })).toBeUndefined()
  await band.unmount()
})

test('/tray hides the band and shows it again', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'tray', args: '' } as never)
  let band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /Agents/ })).toBeUndefined()
  await band.unmount()
  await $.command.run({ command: 'tray', args: '' } as never)
  band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /Agents/ })).toBeDefined()
  await band.unmount()
})

test('the tray draws under another band instead of hiding it', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  expect((await band.find({ type: 'Text', text: /Agents/ }))?.text).toBe('Agents ')
  await band.unmount()
})
