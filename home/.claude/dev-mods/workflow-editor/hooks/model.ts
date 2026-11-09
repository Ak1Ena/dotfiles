import type { Step } from '../types'

// A step's kind lives in its text prefix, so workflow.md stays a flat, hand-editable list:
// "if: cond" opens a condition; the "yes: …" / "no: …" steps right after it are its branches.
export type Kind = 'step' | 'if' | 'yes' | 'no'
const PRE = /^(if|yes|no):[ \t]*/i
export const kindOf = (s: Step): Kind => (PRE.exec(s.text)?.[1]?.toLowerCase() as Kind | undefined) ?? 'step'
export const body = (s: Step) => s.text.replace(PRE, '')
export const withKind = (s: Step, k: Kind): Step => ({ ...s, text: k === 'step' ? body(s) : `${k}: ${body(s)}` })

export type Block = { kind: 'step'; i: number } | { kind: 'if'; i: number; yes: number[]; no: number[]; end: number }

export const blocks = (l: Step[]): Block[] => {
  const out: Block[] = []
  for (let i = 0; i < l.length; i++) {
    if (kindOf(l[i]!) !== 'if') { out.push({ kind: 'step', i }); continue } // a stray yes/no shows as a plain step
    const b = { kind: 'if' as const, i, yes: [] as number[], no: [] as number[], end: i + 1 }
    for (let k = kindOf(l[b.end] ?? { on: true, text: '' }); k === 'yes' || k === 'no'; k = kindOf(l[b.end] ?? { on: true, text: '' })) b[k].push(b.end++)
    out.push(b)
    i = b.end - 1
  }
  return out
}

export const spanOf = (l: Step[], i: number) => {
  const b = blocks(l).find(x => x.i === i)
  return b?.kind === 'if' ? b.end - i : 1 // a condition moves and deletes with its branches
}

// Where a dragged step lands: before flat index `before`, as a plain step or in a branch.
export type Drop = { before: number; kind: 'step' | 'yes' | 'no' }

export const move = (l: Step[], i: number, d: Drop): Step[] | null => {
  const s = l[i]
  if (!s || !['step', 'yes', 'no'].includes(d.kind) || !Number.isInteger(d.before) || d.before < 0 || d.before > l.length) return null
  const n = spanOf(l, i)
  const isIf = kindOf(s) === 'if'
  if (isIf && d.kind !== 'step') return null // no nested conditions
  if (d.before > i && d.before < i + n) return null // into its own branches
  const moving = l.slice(i, i + n)
  if (!isIf) moving[0] = withKind(s, d.kind)
  const rest = [...l.slice(0, i), ...l.slice(i + n)]
  const at = d.before > i ? d.before - n : d.before
  const out = [...rest.slice(0, at), ...moving, ...rest.slice(at)]
  return JSON.stringify(out) === JSON.stringify(l) ? l : out
}

// Shift+↑/↓: one place up or down among its siblings (top level, or within its branch).
export const nudge = (l: Step[], i: number, dir: -1 | 1): Step[] | null => {
  const s = l[i]
  if (!s) return null
  const k = kindOf(s)
  const owner = blocks(l).find(b => b.kind === 'if' && (b.yes.includes(i) || b.no.includes(i)))
  if (owner?.kind === 'if' && (k === 'yes' || k === 'no')) {
    const side = owner[k], p = side.indexOf(i) + dir
    if (p < 0 || p >= side.length) return l
    return move(l, i, { before: dir < 0 ? side[p]! : side[p]! + 1, kind: k })
  }
  const tops = blocks(l), p = tops.findIndex(b => b.i === i) + dir
  if (p < 0 || p >= tops.length) return l
  const t = tops[p]!
  return move(l, i, { before: dir < 0 ? t.i : t.kind === 'if' ? t.end : t.i + 1, kind: 'step' })
}

// Deleting a condition keeps its branch steps as plain steps; nothing else is lost.
export const remove = (l: Step[], i: number): Step[] => {
  const n = spanOf(l, i)
  return [...l.slice(0, i), ...l.slice(i + 1, i + n).map(s => withKind(s, 'step')), ...l.slice(i + n)]
}

const indent = (t: string, pad: string) => t.split('\n').join('\n' + pad)

export const section = (l: Step[]) => {
  const lines: string[] = []
  let n = 0
  for (const b of blocks(l)) {
    const s = l[b.i]!
    if (!s.on) continue
    if (b.kind === 'step') { lines.push(`${++n}. ${indent(body(s), '   ')}`); continue }
    lines.push(`${++n}. If ${indent(body(s), '   ')}:`)
    const arm = (ix: number[], name: string) => {
      const live = ix.map(j => l[j]!).filter(x => x.on)
      lines.push(`   - ${name}:${live.length ? '' : ' nothing extra.'}`)
      for (const x of live) lines.push(`     - ${indent(body(x), '       ')}`)
    }
    arm(b.yes, 'Yes')
    arm(b.no, 'Otherwise')
  }
  if (!lines.length) return null
  return ['# Workflow (the user edits these steps in the /workflow-edit pane; follow them in order)', ...lines].join('\n')
}
