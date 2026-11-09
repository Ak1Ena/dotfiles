import { expect, mock, test } from 'claude-code/testing'

const MSG = (text: string) => ({
  plugin: 'thai-translate',
  component: 'AssistantMessage',
  requestId: 'msg-1',
  surface: 'terminal',
  props: { text, isFirstOfReply: true },
}) as never

const engine = (on: any, calls: string[]) => {
  on('command.register', () => ({ value: { command: 'thai' } }))
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  // Google gtx: answers its JSON shape; 'Boom.' and 'Haiku.' fail with 429
  on('http.fetch', (_: unknown, e: any) => {
    const src = decodeURIComponent(e.init.body.slice(2))
    calls.push(src)
    if (src === 'Boom.' || src === 'Haiku.') return { value: { status: 429, ok: false, headers: {}, text: '' } }
    // like live gtx: trims the request, and drops the space after "#"
    const th = (THAI_OF[src] ?? src.trim().split("\n").map(l => `TH(${l})`).join("\n")).replace(/^TH\(# /gm, "TH(#")
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify([[[th, src]]]) } }
  })
  on('model.complete', (_: unknown, e: any) => {
    const src = e.prompt.replace(/^<text>\n|\n<\/text>$/g, '')
    calls.push(`haiku:${src}`)
    if (src === 'Boom.') return { value: { isAnswered: false, reason: 'api-error', usage: {} } }
    return { value: { isAnswered: true, text: 'จากไฮกุ', usage: {} } }
  })
}
const THAI_OF: Record<string, string> = { 'สวัสดี ช่วยแก้บั๊ก': 'Hello, help fix the bug', 'Done.': 'เสร็จแล้ว' }

test('off by default: Thai prompt reaches Claude untouched', async ($, on) => {
  const calls: string[] = []
  engine(on, calls)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r: any = await $.prompt.submit({ text: 'สวัสดี ช่วยแก้บั๊ก' } as never)
  expect(r.text).toBe('สวัสดี ช่วยแก้บั๊ก')
  expect(calls.length).toBe(0)
})

test('/thai on: Thai prompt is sent in English, English prompt untouched', async ($, on) => {
  const calls: string[] = []
  engine(on, calls)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const t: any = await $.command.run({ command: 'thai', args: '' } as never)
  expect(t.text).toMatch(/on/)
  expect(((await $.prompt.submit({ text: 'สวัสดี ช่วยแก้บั๊ก' } as never)) as any).text).toBe('Hello, help fix the bug')
  expect(((await $.prompt.submit({ text: 'fix the bug' } as never)) as any).text).toBe('fix the bug')
  expect(calls.length).toBe(1)
})

test('/thai on: reply shows in Thai once translated; /thai off shows English', async ($, on) => {
  const calls: string[] = []
  engine(on, calls)
  const clock = mock.clock(on)
  // stands for the engine's own drawing of the message
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  const shown = async (text: string) => {
    const ui = await $.ui.mount(MSG(text))
    const t = (await ui.find({ type: 'Text' } as never))?.text
    await ui.unmount()
    return t
  }
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'thai', args: '' } as never)
  expect(await shown('Done.')).toBe('Done.')
  await clock.advance(2000)
  expect(await shown('Done.')).toBe('เสร็จแล้ว')
  await $.command.run({ command: 'thai', args: '' } as never)
  expect(await shown('Done.')).toBe('Done.')
  expect(calls.length).toBe(1)
})

test('streaming block: only the settled text is translated; a failure is not retried on redraw', async ($, on) => {
  const calls: string[] = []
  engine(on, calls)
  const clock = mock.clock(on)
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  const draw = async (text: string) => (await $.ui.mount(MSG(text))).unmount()
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'thai', args: '' } as never)
  await draw('Do')
  await clock.advance(500)
  await draw('Done.')
  await clock.advance(2000)
  expect(calls).toEqual(['Done.'])
  await draw('Boom.')
  await clock.advance(2000)
  await draw('Boom.')
  await clock.advance(2000)
  expect(calls).toEqual(['Done.', 'Boom.', 'haiku:Boom.'])
})

test('Google fails: haiku fallback; fenced code is never sent to Google', async ($, on) => {
  const calls: string[] = []
  engine(on, calls)
  const clock = mock.clock(on)
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'thai', args: '' } as never)
  expect(((await $.prompt.submit({ text: 'สวัสดี ช่วยแก้บั๊ก' } as never)) as any).text).toBe('Hello, help fix the bug')
  expect(calls).toEqual(['สวัสดี ช่วยแก้บั๊ก'])
  const shown = async (text: string) => {
    const ui = await $.ui.mount(MSG(text))
    const t = (await ui.find({ type: 'Text' } as never))?.text
    await ui.unmount()
    return t
  }
  await shown('Haiku.')
  await clock.advance(2000)
  expect(await shown('Haiku.')).toBe('จากไฮกุ')
  const md = '# Run it\n\n```sh\nls -la\n```\n\nDone.\n\n```sh\ncut off'
  await shown(md)
  await clock.advance(2000)
  expect(await shown(md)).toBe('# TH(Run it)\n\n```sh\nls -la\n```\n\nเสร็จแล้ว\n\n```sh\ncut off')
  expect(calls.slice(-2)).toEqual(['Run it', 'Done.'])
})
