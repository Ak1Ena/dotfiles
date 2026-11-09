import { expect, mock, test } from 'claude-code/testing'
import { pieces } from './register'

const MSG = (text: string, id = 'msg-1') => ({
  plugin: 'thai-translate',
  component: 'AssistantMessage',
  requestId: id,
  surface: 'terminal',
  props: { text, isFirstOfReply: true },
}) as never

const engine = (on: any, calls: string[], seed?: any) => {
  on('command.register', () => ({ value: { command: 'thai' } }))
  mock.store(on, seed)
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  // Google gtx: answers its JSON shape; 'Boom.' and 'Haiku.' fail with 429
  on('http.fetch', (_: unknown, e: any) => {
    const src = decodeURIComponent(e.init.body.slice(2))
    const tl = new URL(e.url).searchParams.get('tl')
    calls.push(tl === 'th' ? src : `${tl}:${src}`)
    const sl = new URL(e.url).searchParams.get('sl')
    // Thai mode must name its source: English replies, Thai prompts
    if (tl === 'th' && sl !== 'en' && sl !== 'auto') throw new Error(`reply sent with sl=${sl}`)
    if (tl === 'en' && !Object.hasOwn(THAI_OF, src) && !src.includes('สมุด')) return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify([[[`EN(${src})`, src]]]) } }
    if (tl === 'zh-CN' && src !== 'Haiku.') return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify([[[`中(${src})`, src]]]) } }
    if (src === 'Drop {0} here.') return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify([[['วาง ตรงนี้', src]]]) } } // Google lost the placeholder
    if (src === 'Boom.' || src === 'Haiku.' || src === 'Viet.' || src === 'Mixed.' || src === 'Wrapped.' || src.includes('สมุด')) return { value: { status: 429, ok: false, headers: {}, text: '' } }
    // like live gtx: trims the request, and drops the space after "#"
    const th = ((Object.hasOwn(THAI_OF, src) ? THAI_OF[src] : undefined) ?? src.trim().split("\n").map(l => `TH(${l})`).join("\n")).replace(/^TH\(# /gm, "TH(#")
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify([[[th, src]]]) } }
  })
  on('model.complete', (_: unknown, e: any) => {
    const src = e.prompt.replace(/^<text>\n|\n<\/text>$/g, '')
    calls.push(`haiku:${src}`)
    if (src === 'Boom.') return { value: { isAnswered: false, reason: 'api-error', usage: {} } }
    if (src === 'Viet.') return { value: { isAnswered: true, text: 'Đúng vậy.', usage: {} } }
    if (src.includes('สมุด')) return { value: { isAnswered: true, text: 'Please edit the file สมุด.md', usage: {} } }
    if (src === 'Mixed.') return { value: { isAnswered: true, text: '`ร 让它回答"做"，并且选择一下：`', usage: {} } }
    if (src === 'Wrapped.') return { value: { isAnswered: true, text: '`ห่อไว้`', usage: {} } }
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
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'thai', args: '' } as never)
  return { calls, clock, shown }
}

test('/thai on: reply shows in Thai once translated; /thai off shows English', async ($, on) => {
  const { calls, clock, shown } = await setup($, on)
  expect(await shown('Done.')).toBe('Done.')
  await clock.advance(3000)
  expect(await shown('Done.')).toBe('เสร็จแล้ว')
  await $.command.run({ command: 'thai', args: '' } as never)
  expect(await shown('Done.')).toBe('Done.')
  expect(calls).toEqual(['Done.'])
})

test('streaming: finished paragraphs show in Thai at once, the one being written waits to settle', async ($, on) => {
  const { calls, clock, shown } = await setup($, on)
  await shown('First.\n\nSec', 's')
  await clock.advance(300) // one tick: finished paragraph sent, tail not yet
  expect(calls).toEqual(['First.'])
  expect(await shown('First.\n\nSecond grows', 's')).toBe('TH(First.)\n\nSecond grows')
  await clock.advance(3000)
  expect(await shown('First.\n\nSecond grows', 's')).toBe('TH(First.)\n\nTH(Second grows)')
  expect(calls).toEqual(['First.', 'Second grows']) // each paragraph once; the cut-off 'Sec' never settled
})

test('after /clear (no session.start) and with the switch stored on, replies are still translated', async ($, on) => {
  const calls: string[] = []
  engine(on, calls, { isOn: true })
  const clock = mock.clock(on)
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  // no session.start: the ticker starts from the first hook that needs it
  const ui = await $.ui.mount(MSG('Done.'))
  await ui.unmount()
  await clock.advance(3000)
  const u2 = await $.ui.mount(MSG('Done.'))
  expect((await u2.find({ type: 'Text' } as never))?.text).toBe('เสร็จแล้ว')
})

test('pieces join back exactly; code fences are their own pieces', async () => {
  for (const t of ['\n\nA.\n\nB.\n', 'a\r\n\r\nb', 'Run:\n```sh\nls\n```\nDone.', 'x\n\n```sh\ncut off'])
    expect(pieces(t).join('')).toBe(t)
  expect(pieces('A.\n\n```sh\nls\n```\n\nB.')).toEqual(['A.\n\n', '```sh\nls\n```', '\n\n', 'B.'])
})

test('paragraph named like an Object property is translated, not read from the prototype', async ($, on) => {
  const { clock, shown } = await setup($, on)
  await shown('constructor\n\nTail', 'p')
  expect(await shown('constructor\n\nTail', 'p')).toBe('constructor\n\nTail')
  await clock.advance(3000)
  expect(await shown('constructor\n\nTail', 'p')).toBe('TH(constructor)\n\nTH(Tail)')
})

test('stale tail is dropped when the reply moves on into code', async ($, on) => {
  const { calls, clock, shown } = await setup($, on)
  await shown('Sec', 'c')
  await shown('Second.\n\n```sh\nls', 'c')
  await clock.advance(3000)
  expect(calls).toEqual(['Second.'])
})

test('failed paragraph not retried on redraw; one toast per outage', async ($, on) => {
  const { calls, clock, shown } = await setup($, on)
  await shown('Boom.', 'f')
  await clock.advance(3000)
  await shown('Boom.', 'f')
  await clock.advance(3000)
  expect(calls).toEqual(['Boom.', 'haiku:Boom.'])
  expect(await shown('Boom.', 'f')).toBe('Boom.')
})

test('Google fails: haiku fallback; fenced code is never sent to Google', async ($, on) => {
  const { calls, clock, shown } = await setup($, on)
  expect(((await $.prompt.submit({ text: 'สวัสดี ช่วยแก้บั๊ก' } as never)) as any).text).toBe('Hello, help fix the bug')
  expect(calls).toEqual(['en:สวัสดี ช่วยแก้บั๊ก'])
  await shown('Haiku.', 'a')
  await clock.advance(3000)
  expect(await shown('Haiku.', 'a')).toBe('จากไฮกุ')
  const md = '# Run it\n\n```sh\nls -la\n```\n\nDone.\n\n```sh\ncut off'
  await shown(md, 'b')
  await clock.advance(3000)
  expect(await shown(md, 'b')).toBe('# TH(Run it)\n\n```sh\nls -la\n```\n\nเสร็จแล้ว\n\n```sh\ncut off')
  expect(calls.slice(-2)).toEqual(['Run it', 'Done.'])
})

test('haiku answering in the wrong language (not Thai script) keeps the English', async ($, on) => {
  const { calls, clock, shown } = await setup($, on)
  await shown('Viet.', 'v')
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

test('/thai cn: Thai prompt goes to Claude in Chinese, Chinese reply shows in Thai', async ($, on) => {
  const { calls, clock, shown } = await setup($, on)
  expect(((await $.command.run({ command: 'thai', args: 'cn' } as never)) as any).text).toMatch(/Chinese pivot on/)
  const r: any = await $.prompt.submit({ text: 'สวัสดี ช่วยแก้บั๊ก' } as never)
  expect(r.text).toBe('中(สวัสดี ช่วยแก้บั๊ก)\n\n（请用简体中文回答。）')
  await shown('修好了。\n\n```sh\nls\n```', 'r')
  await clock.advance(3000)
  expect(await shown('修好了。\n\n```sh\nls\n```', 'r')).toBe('TH(修好了。)\n\n```sh\nls\n```')
  expect(calls).toEqual(['zh-CN:สวัสดี ช่วยแก้บั๊ก', '修好了。'])
})

test('/thai cn: English prompt goes in Chinese, reply shows in English; English paragraphs stay', async ($, on) => {
  const { calls, clock, shown } = await setup($, on)
  await $.command.run({ command: 'thai', args: 'cn' } as never)
  expect(((await $.prompt.submit({ text: 'fix the bug' } as never)) as any).text).toBe('中(fix the bug)\n\n（请用简体中文回答。）')
  await shown('修好了。\n\nAll good.', 'e')
  await clock.advance(3000)
  expect(await shown('修好了。\n\nAll good.', 'e')).toBe('EN(修好了。)\n\nAll good.')
  expect(calls).toEqual(['zh-CN:fix the bug', 'en:修好了。'])
  expect(((await $.command.run({ command: 'thai', args: 'off' } as never)) as any).text).toBe('Translation off.')
  expect(await shown('修好了。\n\nAll good.', 'e')).toBe('修好了。\n\nAll good.')
  expect(((await $.command.run({ command: 'thai', args: 'xx' } as never)) as any).text).toMatch(/Usage/)
})

test('/thai cn: Google down on the prompt and haiku answers in Thai script: prompt goes as typed', async ($, on) => {
  const { calls } = await setup($, on)
  await $.command.run({ command: 'thai', args: 'cn' } as never)
  expect(((await $.prompt.submit({ text: 'Haiku.' } as never)) as any).text).toBe('Haiku.')
  expect(calls).toEqual(['zh-CN:Haiku.', 'haiku:Haiku.'])
})

test('switching mode mid-stream: a pending Thai-target tail is not sent after /thai cn with an English prompt', async ($, on) => {
  const { calls, clock, shown } = await setup($, on)
  await shown('Done.', 'm')
  await $.command.run({ command: 'thai', args: 'cn' } as never)
  await $.prompt.submit({ text: 'go' } as never)
  await shown('Done.', 'm') // English paragraph, English reply language: nothing to translate
  await clock.advance(3000)
  expect(calls).toEqual(['zh-CN:go'])
})

test('/thai cn: a Chinese prompt goes as typed and keeps the reply language', async ($, on) => {
  const { calls, clock, shown } = await setup($, on)
  await $.command.run({ command: 'thai', args: 'cn' } as never)
  await $.prompt.submit({ text: 'สวัสดี' } as never)
  expect(((await $.prompt.submit({ text: '修复这个错误' } as never)) as any).text).toBe('修复这个错误\n\n（请用简体中文回答。）')
  await shown('好。', 'z')
  await clock.advance(3000)
  expect(await shown('好。', 'z')).toBe('TH(好。)')
  expect(calls).toEqual(['zh-CN:สวัสดี', '好。'])
})
test('restart with cn stored: replies show in the stored reply language; bare toggles keep cn; /thai th returns', async ($, on) => {
  const calls: string[] = []
  engine(on, calls, { isOn: true, lang: 'cn', replyLang: 'en' })
  const clock = mock.clock(on)
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const u = await $.ui.mount(MSG('完成。'))
  await u.unmount()
  await clock.advance(3000)
  const u2 = await $.ui.mount(MSG('完成。'))
  expect((await u2.find({ type: 'Text' } as never))?.text).toBe('EN(完成。)')
  await u2.unmount()
  await $.command.run({ command: 'thai', args: '' } as never) // off
  expect(((await $.command.run({ command: 'thai', args: ' ON ' } as never)) as any).text).toMatch(/Chinese pivot/)
  expect(((await $.command.run({ command: 'thai', args: 'en' } as never)) as any).text).toMatch(/Thai translation on/)
  expect(((await $.command.run({ command: 'thai', args: 'th' } as never)) as any).text).toMatch(/Thai translation on/)
})

test('inline code goes to Google as a placeholder and comes back unchanged', async ($, on) => {
  const { calls, clock, shown } = await setup($, on)
  await shown('Run `npm test` and `ls`.', 'i')
  await clock.advance(3000)
  expect(calls).toEqual(['Run {0} and {1}.'])
  expect(await shown('Run `npm test` and `ls`.', 'i')).toBe('TH(Run `npm test` and `ls`.)')
})

test('Google losing a placeholder falls back to haiku', async ($, on) => {
  const { calls, clock, shown } = await setup($, on)
  await shown('Drop `x` here.', 'd')
  await clock.advance(3000)
  expect(calls).toEqual(['Drop {0} here.', 'haiku:Drop `x` here.'])
})

test('haiku answer half in Chinese is dropped; one wrapped in backticks is unwrapped', async ($, on) => {
  const { clock, shown } = await setup($, on)
  await shown('Mixed.', 'm')
  await shown('Wrapped.', 'w')
  await clock.advance(3000)
  expect(await shown('Mixed.', 'm')).toBe('Mixed.')
  expect(await shown('Wrapped.', 'w')).toBe('ห่อไว้')
})

test('prompt row shows what was typed with what Claude received under it', async ($, on) => {
  await setup($, on)
  await $.command.run({ command: 'thai', args: 'cn' } as never)
  const r: any = await $.prompt.submit({ text: 'สวัสดี' } as never)
  const ui = await $.ui.mount({ plugin: 'thai-translate', component: 'UserMessage', requestId: 'u', surface: 'terminal', props: { text: r.text, origin: { kind: 'composer' }, isExpanded: true } } as never)
  expect((await ui.find({ type: 'Text' } as never))?.text).toBe('สวัสดี\n-> 中(สวัสดี)')
  await ui.unmount()
  const other = await $.ui.mount({ plugin: 'thai-translate', component: 'UserMessage', requestId: 'v', surface: 'terminal', props: { text: 'hello', origin: { kind: 'composer' }, isExpanded: true } } as never)
  expect((await other.find({ type: 'Text' } as never))?.text).toBe('hello')
})

test('summary rows between tool calls are translated too', async ($, on) => {
  const { clock } = await setup($, on)
  const draw = async () => {
    const ui = await $.ui.mount({ ...(MSG('Done.', 's') as any), props: { text: 'Done.', isFirstOfReply: false, isSummary: true } } as never)
    const t = (await ui.find({ type: 'Text' } as never))?.text
    await ui.unmount()
    return t
  }
  await draw()
  await clock.advance(3000)
  expect(await draw()).toBe('เสร็จแล้ว')
})

test('question dialog: question, labels and descriptions translated; header and preview kept', async ($, on) => {
  let seen: any
  const calls: string[] = []
  engine(on, calls)
  const clock = mock.clock(on)
  on('ui.render', ($: any, e: any) => {
    seen = e.props.questions
    return { type: 'engine', ref: 0 }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'thai', args: '' } as never)
  const q = [{ question: 'Pick one?', header: 'Pick', multiSelect: false, options: [{ label: 'Yes', description: 'Do it.', preview: 'ls -la' }, { label: 'No', description: 'Skip.' }] }]
  const mount = async () => { const ui = await $.ui.mount({ plugin: 'thai-translate', component: 'AskUserQuestion', requestId: 'q', surface: 'terminal', props: { tool: 'AskUserQuestion', questions: q } } as never); await ui.unmount() }
  await mount()
  await clock.advance(3000)
  await mount()
  expect(seen[0].question).toBe('TH(Pick one?)')
  expect(seen[0].header).toBe('Pick')
  expect(seen[0].options[0]).toEqual({ label: 'TH(Yes)', description: 'TH(Do it.)', preview: 'ls -la' })
  expect(calls).toContain('No')
})

test('mixed prompts are translated: Thai+Chinese in cn mode, Chinese in Thai mode', async ($, on) => {
  const { calls } = await setup($, on)
  expect(((await $.prompt.submit({ text: '你好 ครับ' } as never)) as any).text).toBe('EN(你好 ครับ)')
  await $.command.run({ command: 'thai', args: 'cn' } as never)
  expect(((await $.prompt.submit({ text: '修复 bug 一下' } as never)) as any).text).toBe('中(修复 bug 一下)\n\n（请用简体中文回答。）')
  expect(calls).toEqual(['en:你好 ครับ', 'zh-CN:修复 bug 一下'])
})
