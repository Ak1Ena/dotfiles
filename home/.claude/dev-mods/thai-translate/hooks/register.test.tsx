import { expect, mock, test } from 'claude-code/testing'

const MSG = (text: string, id = 'msg-1') => ({
  plugin: 'thai-translate',
  component: 'AssistantMessage',
  requestId: id,
  surface: 'terminal',
  props: { text, isFirstOfReply: true },
}) as never

const engine = (on: any, calls: string[]) => {
  on('command.register', () => ({ value: { command: 'thai' } }))
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  // Google gtx: answers its JSON shape; 'Boom.' and 'Haiku.' fail with 429
  on('http.fetch', (_: unknown, e: any) => {
    const src = decodeURIComponent(e.init.body.slice(2))
    calls.push(src)
    if (src === 'Boom.' || src === 'Haiku.' || src === 'Viet.' || src.includes('สมุด')) return { value: { status: 429, ok: false, headers: {}, text: '' } }
    // like live gtx: trims the request, and drops the space after "#"
    const th = (THAI_OF[src] ?? src.trim().split("\n").map(l => `TH(${l})`).join("\n")).replace(/^TH\(# /gm, "TH(#")
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify([[[th, src]]]) } }
  })
  on('model.complete', (_: unknown, e: any) => {
    const src = e.prompt.replace(/^<text>\n|\n<\/text>$/g, '')
    calls.push(`haiku:${src}`)
    if (src === 'Boom.') return { value: { isAnswered: false, reason: 'api-error', usage: {} } }
    if (src === 'Viet.') return { value: { isAnswered: true, text: 'Đúng vậy.', usage: {} } }
    if (src.includes('สมุด')) return { value: { isAnswered: true, text: 'Please edit the file สมุด.md', usage: {} } }
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

const setup = async ($: any, on: any) => {
  const calls: string[] = []
  engine(on, calls)
  const clock = mock.clock(on)
  // stands for the engine's own drawing of the message
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  const shown = async (text: string, id = 'msg-1') => {
    const ui = await $.ui.mount(MSG(text, id))
    const t = (await ui.find({ type: 'Text' } as never))?.text
    await ui.unmount()
    return t
  }
  const end = (answer: string) => $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'thai', args: '' } as never)
  return { calls, clock, shown, end }
}

test('/thai on: final reply shows in Thai once translated; /thai off shows English', async ($, on) => {
  const { calls, clock, shown, end } = await setup($, on)
  expect(await shown('Done.')).toBe('Done.')
  await end('Done.')
  await clock.advance(3000)
  expect(await shown('Done.')).toBe('เสร็จแล้ว')
  await $.command.run({ command: 'thai', args: '' } as never)
  expect(await shown('Done.')).toBe('Done.')
  expect(calls.length).toBe(1)
})

test('text between tool calls stays English; only the final message is translated, once', async ($, on) => {
  const { calls, clock, shown, end } = await setup($, on)
  await shown('Let me check the file.', 'mid')
  await clock.advance(3000)
  expect(calls).toEqual([])
  await shown('Do', 'final')
  await end('Done.')
  await shown('Done.', 'final') // last words land after the turn ends: queued once they match the answer
  await clock.advance(3000)
  expect(calls).toEqual(['Done.'])
  expect(await shown('Let me check the file.', 'mid')).toBe('Let me check the file.')
  await $.prompt.submit({ text: 'next' } as never)
  await shown('Boom.', 'f2')
  await end('Boom.')
  await clock.advance(3000)
  await end('Boom.')
  await clock.advance(3000)
  expect(calls).toEqual(['Done.', 'Boom.', 'haiku:Boom.'])
})

test('Google fails: haiku fallback; fenced code is never sent to Google', async ($, on) => {
  const { calls, clock, shown, end } = await setup($, on)
  expect(((await $.prompt.submit({ text: 'สวัสดี ช่วยแก้บั๊ก' } as never)) as any).text).toBe('Hello, help fix the bug')
  expect(calls).toEqual(['สวัสดี ช่วยแก้บั๊ก'])
  await shown('Haiku.', 'a')
  await end('Haiku.')
  await clock.advance(3000)
  expect(await shown('Haiku.', 'a')).toBe('จากไฮกุ')
  const md = '# Run it\n\n```sh\nls -la\n```\n\nDone.\n\n```sh\ncut off'
  await shown(md, 'b')
  await end(md)
  await clock.advance(3000)
  expect(await shown(md, 'b')).toBe('# TH(Run it)\n\n```sh\nls -la\n```\n\nเสร็จแล้ว\n\n```sh\ncut off')
  expect(calls.slice(-2)).toEqual(['Run it', 'Done.'])
})

test('haiku answering in the wrong language (not Thai script) keeps the English', async ($, on) => {
  const { calls, clock, shown, end } = await setup($, on)
  await shown('Viet.', 'v')
  await end('Viet.')
  await clock.advance(3000)
  expect(calls).toEqual(['Viet.', 'haiku:Viet.'])
  expect(await shown('Viet.', 'v')).toBe('Viet.')
})

test('Google fails on a Thai prompt: haiku English that quotes a Thai name is still used', async ($, on) => {
  const calls: string[] = []
  engine(on, calls)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'thai', args: '' } as never)
  const r: any = await $.prompt.submit({ text: 'แก้ไฟล์ สมุด.md หน่อย' } as never)
  expect(r.text).toBe('Please edit the file สมุด.md')
})
