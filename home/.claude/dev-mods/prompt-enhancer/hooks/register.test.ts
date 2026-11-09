import { expect, test } from 'claude-code/testing'
import type { ModelCompleteResult } from 'claude-code'

const origin = { kind: 'composer' } as const
const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const answered: ModelCompleteResult = { isAnswered: true, text: 'Goal: fix login\nDone when: login works', usage }
const aborted: ModelCompleteResult = { isAnswered: false, reason: 'empty-reply', usage }

test('auto mode: ++ prompt gets brief as context, prefix stripped', async ($, on) => {
  on('store.get', () => ({ value: 'auto' }))
  on('model.complete', () => ({ value: answered }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  const r = await $.prompt.submit({ text: '++ fix login bug', wait: false, origin })
  expect(r.text).toBe('fix login bug')
  expect(r.context?.[0]).toContain('Goal: fix login')
})

test('plain prompt untouched', async ($, on) => {
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  const r = await $.prompt.submit({ text: 'fix login bug', wait: false, origin })
  expect(r.text).toBe('fix login bug')
  expect(r.context).toBeUndefined()
})

test('model failure sends prompt as typed', async ($, on) => {
  on('model.complete', () => ({ value: aborted }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  const r = await $.prompt.submit({ text: '++ fix login bug', wait: false, origin })
  expect(r.text).toBe('fix login bug')
  expect(r.context).toBeUndefined()
})

test('model throw sends prompt as typed', async ($, on) => {
  on('model.complete', () => { throw new Error('blocked') })
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  const r = await $.prompt.submit({ text: '++ fix login bug', wait: false, origin })
  expect(r.text).toBe('fix login bug')
  expect(r.context).toBeUndefined()
})

const bad = () => { throw new Error('model must not be called') }

test('non-typed origin, ++i and bare ++ skip the model', async ($, on) => {
  on('model.complete', bad)
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  const peer = await $.prompt.submit({ text: '++ do x', wait: false, origin: { kind: 'scheduled-trigger' } as never })
  expect(peer.text).toBe('++ do x')
  expect((await $.prompt.submit({ text: '++i overflow', wait: false, origin })).text).toBe('++i overflow')
  expect((await $.prompt.submit({ text: '++   ', wait: false, origin })).text).toBe('++   ')
})

test('cut-off brief (no Done when) fails open', async ($, on) => {
  on('model.complete', () => ({ value: { ...answered, text: 'Goal: fix login' } as ModelCompleteResult }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  const r = await $.prompt.submit({ text: '++ fix login bug', wait: false, origin })
  expect(r.text).toBe('fix login bug')
  expect(r.context).toBeUndefined()
})

// Answers the ask dialog (AskUserQuestion) with `label`.
const pick = (label: string) => (_: unknown, e: { questions: readonly { question: string }[] }) =>
  ({ result: { questions: e.questions, answers: { [e.questions[0]!.question]: label } } }) as never

test('ask mode (default): Send with brief attaches brief', async ($, on) => {
  on('model.complete', () => ({ value: answered }))
  on('store.get', () => ({ value: undefined }))
  on('tool.call', { tool: 'AskUserQuestion' }, pick('Send with brief'))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  const r = await $.prompt.submit({ text: '++ fix login bug', wait: false, origin })
  expect(r.text).toBe('fix login bug')
  expect(r.context?.[0]).toContain('Done when')
})

test('ask mode: Send as typed drops brief', async ($, on) => {
  on('model.complete', () => ({ value: answered }))
  on('store.get', () => ({ value: undefined }))
  on('tool.call', { tool: 'AskUserQuestion' }, pick('Send as typed'))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  const r = await $.prompt.submit({ text: '++ fix login bug', wait: false, origin })
  expect(r.text).toBe('fix login bug')
  expect(r.context).toBeUndefined()
})

test('ask mode: Edit puts brief in prompt box and sends nothing', async ($, on) => {
  let filled = ''
  on('model.complete', () => ({ value: answered }))
  on('store.get', () => ({ value: undefined }))
  on('tool.call', { tool: 'AskUserQuestion' }, pick('Edit in prompt box'))
  on('prompt.fill', (_, e) => { filled = e.text; return { isFilled: true, text: e.text, cursor: e.text.length } as never })
  on('prompt.submit', () => { throw new Error('must not reach engine') })
  const r = await $.prompt.submit({ text: '++ fix login bug', wait: false, origin })
  expect('drop' in r).toBe(true)
  expect(filled).toContain('Done when')
})

test('ask mode: mid-turn prompt skips the dialog and sends with brief', async ($, on) => {
  on('store.get', () => ({ value: undefined }))
  on('model.complete', () => ({ value: answered }))
  on('tool.call', { tool: 'AskUserQuestion' }, () => { throw new Error('must not ask') })
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  const r = await $.prompt.submit({ text: '++ fix login bug', wait: false, origin, turnId: 't1' } as never)
  expect(r.context?.[0]).toContain('Done when')
})

test('ask mode: dismissed dialog drops and restores text', async ($, on) => {
  let filled = ''
  on('store.get', () => ({ value: undefined }))
  on('model.complete', () => ({ value: answered }))
  on('tool.call', { tool: 'AskUserQuestion' }, () => ({ deny: 'dismissed' }))
  on('prompt.fill', (_, e) => { filled = e.text; return { isFilled: true, text: e.text, cursor: 0 } as never })
  on('prompt.submit', () => { throw new Error('must not reach engine') })
  const r = await $.prompt.submit({ text: '++ fix login bug', wait: false, origin })
  expect('drop' in r).toBe(true)
  expect(filled).toBe('fix login bug')
})
