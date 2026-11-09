import { expect, test } from 'claude-code/testing'
import { parse, section, serialize } from '../hooks/register'

test('round trip keeps on/off and multi-line steps', async () => {
  const list = [{ on: true, text: '**Plan.** small steps\n- sub a\n  - nested' }, { on: false, text: 'off step' }]
  expect(parse(serialize(list))).toEqual(list)
})

test('section lists only enabled steps, null when none', async () => {
  expect(section([{ on: false, text: 'x' }])).toBe(null)
  expect(section([{ on: false, text: 'x' }, { on: true, text: 'y' }])).toContain('1. y')
})

test('CRLF, blank lines inside a step, stray top-level lines', async () => {
  expect(parse('- [x] q\n x\n\ty\n')).toEqual([{ on: true, text: 'q\nx\n\ty' }])
  expect(parse('- [x] a\r\n  b\r\n\r\n  c\r\n## junk\r\n- [ ] d\r\n')).toEqual([{ on: true, text: 'a\nb\n\nc' }, { on: false, text: 'd' }])
  const list = [{ on: true, text: 'a\n\nb' }]
  expect(parse(serialize(list))).toEqual(list)
})

test('section indents continuation lines under the number', async () => {
  expect(section([{ on: true, text: 'a\n- sub' }])).toContain('1. a\n   - sub')
})
