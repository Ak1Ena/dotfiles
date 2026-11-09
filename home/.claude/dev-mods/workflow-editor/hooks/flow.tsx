import type { ClientModule, ClientSurface } from 'claude-code'
import type { Step } from '../types'
import { blocks, body, kindOf, move, nudge, type Drop } from './model'

// The diagram: a character grid the module paints, with hit boxes for the pointer.
type Style = { c?: string; dim?: boolean; bold?: boolean }
type Cell = Style & { ch: string }
export type Hit = { i: number; x: number; y: number; w: number; h: number }
export type Target = { d: Drop; x: number; y: number; w: number }
export type Props = { steps: Step[]; editing: number }
type Drag = { i: number; x0: number; y0: number; x: number; y: number; isMoved: boolean }
type State = { drag: Drag | null; sel: number }

const ROUND = '╭╮╰╯─│', SQUARE = '┌┐└┘─│', DIAMOND = '╱╲╲╱─◇', DASH = '┌┐└┘┄┆'

export const layout = (steps: Step[], cols: number, editing = -1, dragging = -1) => {
  const grid: Cell[][] = []
  const hits: Hit[] = []
  const targets: Target[] = []
  const put = (x: number, y: number, t: string, st: Style = {}) => {
    while (grid.length <= y) grid.push([])
    const row = grid[y]!
    ;[...t].forEach((ch, k) => {
      while (row.length <= x + k) row.push({ ch: ' ' })
      row[x + k] = { ch, ...st }
    })
  }
  const clip = (t: string, n: number) => ([...t].length > n ? [...t].slice(0, Math.max(0, n - 1)).join('') + '…' : t)
  const box = (x: number, y: number, w: number, label: string, chars: string, st: Style) => {
    const [tl, tr, bl, br, hz, vt] = [...chars]
    put(x, y, tl + hz!.repeat(w - 2) + tr, st)
    put(x, y + 1, vt!, st)
    put(x + 1, y + 1, ' ' + clip(label, w - 4).padEnd(w - 3), { ...st, c: st.c === 'green' ? undefined : st.c, bold: st.bold || st.c === 'cyan' })
    put(x + w - 1, y + 1, vt!, st)
    put(x, y + 2, bl + hz!.repeat(w - 2) + br, st)
  }
  const stepBox = (i: number, x: number, y: number, w: number, num: string) => {
    const s = steps[i]!
    const isIf = kindOf(s) === 'if'
    const st: Style = i === dragging ? { dim: true } : i === editing ? { c: 'cyan' } : !s.on ? { dim: true } : isIf ? { c: 'yellow' } : { c: 'green' }
    const first = body(s).split('\n')[0] ?? ''
    box(x, y, w, `⠿ ${s.on ? '[x]' : '[ ]'} ${num}${isIf ? 'If ' : ''}${first}${s.on ? '' : ' (off)'}`, isIf ? DIAMOND : s.on ? ROUND : SQUARE, st)
    hits.push({ i, x, y, w, h: 3 })
  }
  const arrow = (x: number, y: number) => { put(x, y, '│', { dim: true }); put(x, y + 1, '▼', { dim: true }) }

  const W = Math.max(24, Math.min(cols, 72))
  const CX = Math.floor(W / 2)
  const CW = Math.floor((W - 2) / 2)
  let y = 1 // row 0 is the drop line above the first step
  let n = 0
  const tops = blocks(steps)
  tops.forEach((b, bi) => {
    if (bi > 0) { arrow(CX, y); targets.push({ d: { before: b.i, kind: 'step' }, x: 0, y: y, w: W }); y += 2 }
    else targets.push({ d: { before: b.i, kind: 'step' }, x: 0, y: 0, w: W })
    stepBox(b.i, 0, y, W, `${++n}. `)
    y += 3
    if (b.kind === 'step') return
    const lx = Math.floor(CW / 2), rx = W - CW + Math.floor(CW / 2)
    put(lx - 1, y, '╱', { dim: true }); put(rx + 1, y, '╲', { dim: true })
    put(lx + 1, y, 'yes', { c: 'green' }); put(rx - 3, y, 'no', { c: 'red' })
    y += 1
    const column = (ix: number[], side: 'yes' | 'no', x0: number, cx: number) => {
      let yy = y
      put(cx, yy, '▼', { dim: true })
      yy += 1
      if (!ix.length) {
        box(x0, yy, CW, 'drop a step here', DASH, { dim: true })
        targets.push({ d: { before: b.end, kind: side }, x: x0, y: yy + 1, w: CW })
        return yy + 3
      }
      ix.forEach((j, k) => {
        if (k > 0) { arrow(cx, yy); yy += 2 }
        targets.push({ d: { before: j, kind: side }, x: x0, y: yy - 1, w: CW })
        stepBox(j, x0, yy, CW, '')
        yy += 3
      })
      targets.push({ d: { before: ix.at(-1)! + 1, kind: side }, x: x0, y: yy, w: CW })
      return yy
    }
    const hl = column(b.yes, 'yes', 0, lx)
    const hr = column(b.no, 'no', W - CW, rx)
    const bottom = Math.max(hl, hr)
    for (let r = hl; r < bottom; r++) put(lx, r, '│', { dim: true })
    for (let r = hr; r < bottom; r++) put(rx, r, '│', { dim: true })
    put(lx, bottom, '└' + '─'.repeat(rx - lx - 1) + '┘', { dim: true })
    put(CX, bottom, '┬', { dim: true })
    y = bottom + 1
  })
  targets.push({ d: { before: steps.length, kind: 'step' }, x: 0, y: y, w: W })
  if (!steps.length) put(0, 0, 'No steps yet. Add one below.', { dim: true })
  return { grid, hits, targets, rows: y + 1 }
}

export const hitAt = (hits: Hit[], x: number, y: number) => hits.find(h => x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h)

// The drop line nearest the pointer that the move would accept.
export const pick = (steps: Step[], targets: Target[], i: number, x: number, y: number) => {
  let best: Target | undefined
  let bestCost = Infinity
  for (const t of targets) {
    if (!move(steps, i, t.d)) continue
    const cost = Math.abs(t.y - y) * 2 + (x < t.x ? t.x - x : x >= t.x + t.w ? x - t.x - t.w + 1 : 0)
    if (cost < bestCost) { best = t; bestCost = cost }
  }
  return best
}

const Flow: ClientModule<Props, State> = (p, s: ClientSurface<State>) => {
  const { Box, Text } = s.elements
  const st: State = s.state ?? { drag: null, sel: -1 }
  const drag = st.drag
  const { grid, hits, targets } = layout(p.steps, s.columns || 72, p.editing, drag?.isMoved ? drag.i : -1)
  const snap = JSON.stringify(p.steps)
  const at = (i: number) => ({ i, snap })
  // Where a step ends up after a change, so the selection follows it.
  const follow = (next: typeof p.steps | null, i: number) => (next ? next.findIndex(x => x === p.steps[i] || (x.on === p.steps[i]?.on && body(x) === body(p.steps[i]!))) : -1)

  s.onPointer(e => {
    const h = hitAt(hits, e.x, e.y)
    if (e.type === 'down' && h && e.button === 'right') { s.setState({ drag: null, sel: -1 }); return s.post({ type: 'delete', ...at(h.i) }) }
    if (e.type === 'down' && h && e.button === 'left') {
      if (e.x >= h.x + 4 && e.x <= h.x + 6 && e.y === h.y + 1) return s.post({ type: 'toggle', ...at(h.i) })
      return s.setState({ sel: h.i, drag: { i: h.i, x0: e.x, y0: e.y, x: e.x, y: e.y, isMoved: false } })
    }
    if (!drag) return
    if (e.type === 'move' && e.button) return s.setState({ ...st, drag: { ...drag, x: e.x, y: e.y, isMoved: drag.isMoved || e.x !== drag.x0 || e.y !== drag.y0 } })
    if (e.type === 'up') {
      // a move and the up can land in one frame, so the up's own position counts too
      if (!drag.isMoved && e.x === drag.x0 && e.y === drag.y0) { s.setState({ ...st, drag: null }); return s.post({ type: 'edit', ...at(drag.i) }) }
      const t = pick(p.steps, targets, drag.i, e.x, e.y)
      s.setState({ drag: null, sel: t ? follow(move(p.steps, drag.i, t.d), drag.i) : st.sel })
      if (t) s.post({ type: 'move', ...at(drag.i), d: t.d })
    }
  })

  s.onKey(e => {
    const order = hits.map(h => h.i) // layout order: top to bottom, a yes branch before its no branch
    const cur = order.indexOf(st.sel)
    if (e.shift && (e.key === 'up' || e.key === 'down') && st.sel >= 0) {
      const dir = e.key === 'up' ? -1 : 1
      s.setState({ ...st, sel: follow(nudge(p.steps, st.sel, dir), st.sel) })
      return s.post({ type: 'nudge', ...at(st.sel), dir })
    }
    if (e.key === 'up' || e.key === 'down' || e.key === 'tab') {
      const next = order[Math.max(0, Math.min(order.length - 1, cur + (e.key === 'up' ? -1 : 1)))]
      return next === undefined ? undefined : s.setState({ ...st, sel: next })
    }
    if (st.sel < 0) return
    if (e.key === ' ') return s.post({ type: 'toggle', ...at(st.sel) })
    if (e.key === 'return') return s.post({ type: 'edit', ...at(st.sel) })
    if (e.key === 'd') { s.setState({ ...st, sel: -1 }); return s.post({ type: 'delete', ...at(st.sel) }) }
    if (e.key === 'u') return s.post({ type: 'undo' })
  })

  // Overlays: selection marker, drop line and the dragged step following the pointer.
  const sel = hits.find(h => h.i === st.sel)
  if (sel) grid[sel.y + 1]![sel.x + 2] = { ch: '▶', c: 'cyan', bold: true }
  if (drag?.isMoved) {
    const t = pick(p.steps, targets, drag.i, drag.x, drag.y)
    if (t) {
      while (grid.length <= t.y) grid.push([])
      const row = grid[t.y]!
      for (let k = t.x; k < t.x + t.w; k++) { while (row.length <= k) row.push({ ch: ' ' }); row[k] = { ch: '═', c: 'cyan' } }
    }
    const label = `⠿ ${body(p.steps[drag.i] ?? { on: true, text: '' }).split('\n')[0] ?? ''}`.slice(0, 40)
    const gy = Math.max(0, Math.min(drag.y, grid.length - 1))
    const row = grid[gy]!
    ;[...label].forEach((ch, k) => { while (row.length <= drag.x + k) row.push({ ch: ' ' }); row[drag.x + k] = { ch, c: 'cyan', bold: true } })
  }

  return (
    <Box flexDirection="column">
      {grid.map(row => {
        const runs: Cell[] = []
        for (const c of row) {
          const last = runs.at(-1)
          if (last && last.c === c.c && last.dim === c.dim && last.bold === c.bold) last.ch += c.ch
          else runs.push({ ...c })
        }
        return <Text>{runs.length ? runs.map(r => <Text color={r.c} dimColor={r.dim} bold={r.bold}>{r.ch}</Text>) : ' '}</Text>
      })}
    </Box>
  )
}

export default Flow
