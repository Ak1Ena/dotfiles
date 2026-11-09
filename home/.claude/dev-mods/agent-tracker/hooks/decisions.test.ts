import { expect, test } from 'claude-code/testing'
import { decisionsText, judge, wrongNote } from './register'
import type { Decision } from '../types'

const a: Decision = { at: 0, who: 'Claude', decision: 'Picked A', why: 'faster', alternatives: 'B' }
const b: Decision = { at: 0, who: 'scout #ab12', decision: 'Skipped tests', why: '', alternatives: '' }

test('decisionsText lists decisions with verdict marks, why and alternatives', () => {
  expect(decisionsText([])).toBe('No assumptions recorded this session.')
  const t = decisionsText([{ ...a, verdict: 'right' }, b])
  expect(t).toContain('(2)')
  expect(t).toContain('1. ✓ [')
  expect(t).toContain('2. ? [')
  expect(t).toContain('   basis: faster')
  expect(t).toContain('   if wrong: B')
  expect(t.split('basis:').length).toBe(2) // empty why prints no line
  expect(t).toContain('/assumptions <number> false <what is true instead>')
})

test('judge marks one decision; wrongNote tells Claude only fresh wrong ones', () => {
  const list = judge(judge([a, b], 1, 'right'), 2, 'wrong')
  expect(list[0]?.verdict).toBe('right')
  expect(list[1]?.verdict).toBe('wrong')
  const note = wrongNote(list)
  expect(note).toContain('2. Skipped tests')
  expect(note).not.toContain('Picked A')
  expect(wrongNote(list.map((d) => ({ ...d, told: true as const })))).toBeUndefined()
  // Re-marking clears `told`, so a changed verdict is told again.
  expect(wrongNote(judge(list.map((d) => ({ ...d, told: true as const })), 2, 'wrong'))).toContain('Skipped tests')
})

test('false with a reason: shown in the list and passed to Claude', () => {
  const list = judge([a, b], 1, 'wrong', '  We already have a pane mod  ')
  expect(list[0]?.reason).toBe('We already have a pane mod')
  expect(decisionsText(list)).toContain('   ✗ false: We already have a pane mod')
  expect(wrongNote(list)).toContain('user says: We already have a pane mod')
  expect(judge(list, 1, 'right')[0]?.reason).toBeUndefined() // flipping to true drops the reason
})
