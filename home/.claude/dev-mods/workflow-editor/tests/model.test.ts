import { expect, test } from 'claude-code/testing'
import { blocks, move, nudge, remove, section } from '../hooks/model'
import { layout, pick } from '../hooks/flow'

const S = (...t: string[]) => t.map(text => ({ on: true, text }))
const T = (l: { text: string }[]) => l.map(s => s.text)

test('if groups the yes/no steps right after it; stray yes is plain', async () => {
  expect(blocks(S('a', 'if: c', 'yes: b', 'no: d', 'e', 'yes: z'))).toEqual([
    { kind: 'step', i: 0 }, { kind: 'if', i: 1, yes: [2], no: [3], end: 4 }, { kind: 'step', i: 4 }, { kind: 'step', i: 5 }])
})

test('move: into a branch, out of it, a condition with its branches, invalid drops', async () => {
  const l = S('a', 'if: c', 'yes: b', 'e')
  expect(T(move(l, 0, { before: 3, kind: 'no' })!)).toEqual(['if: c', 'yes: b', 'no: a', 'e'])
  expect(T(move(l, 2, { before: 0, kind: 'step' })!)).toEqual(['b', 'a', 'if: c', 'e'])
  expect(T(move(l, 1, { before: 4, kind: 'step' })!)).toEqual(['a', 'e', 'if: c', 'yes: b'])
  expect(T(move(l, 1, { before: 0, kind: 'step' })!)).toEqual(['if: c', 'yes: b', 'a', 'e'])
  expect(move(l, 1, { before: 3, kind: 'yes' })).toBe(null) // no nested conditions
  expect(move(l, 1, { before: 2, kind: 'step' })).toBe(null) // into itself
  expect(move(l, 0, { before: -3, kind: 'step' })).toBe(null)
  expect(move(l, 0, { before: 1, kind: 'bogus' as never })).toBe(null)
  expect(T(move(S('if: c'), 0, { before: 1, kind: 'step' })!)).toEqual(['if: c']) // keeps its kind
})

test('nudge stays among siblings; remove keeps branch steps as plain', async () => {
  const l = S('a', 'if: c', 'yes: b', 'yes: f', 'e')
  expect(T(nudge(l, 3, -1)!)).toEqual(['a', 'if: c', 'yes: f', 'yes: b', 'e'])
  expect(T(nudge(l, 0, 1)!)).toEqual(['if: c', 'yes: b', 'yes: f', 'a', 'e'])
  expect(T(nudge(l, 4, -1)!)).toEqual(['a', 'e', 'if: c', 'yes: b', 'yes: f'])
  expect(T(remove(l, 1))).toEqual(['a', 'b', 'f', 'e'])
})

test('section nests branches, skips off steps and off conditions', async () => {
  const l = [...S('a', 'if: code changes', 'yes: run tests'), { on: false, text: 'no: x' }, { on: false, text: 'if: off' }, ...S('yes: hidden', 'end')]
  expect(section(l)).toBe([
    '# Workflow (the user edits these steps in the /workflow-edit pane; follow them in order)',
    '1. a', '2. If code changes:', '   - Yes:', '     - run tests', '   - Otherwise: nothing extra.', '3. end'].join('\n'))
})

test('layout: boxes are hit targets, the drop line nearest the pointer wins', async () => {
  const l = S('a', 'if: c', 'yes: b')
  const { hits, targets } = layout(l, 60)
  expect(hits.map(h => h.i)).toEqual([0, 1, 2])
  const no = targets.find(t => t.d.kind === 'no')!
  expect(pick(l, targets, 0, no.x + 2, no.y)?.d).toEqual({ before: 3, kind: 'no' })
  expect(pick(l, targets, 1, no.x + 2, no.y)?.d.kind).toBe('step') // a condition never lands in a branch
})
