import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { Editing, Step, Trash } from '../types'
import { body, kindOf, move, nudge, remove, section, spanOf, withKind, type Drop } from './model'

const PANE = 'workflow-editor'
const HEADER = '<!-- Workflow steps, edited by the workflow-editor mod (/workflow-edit). "- [x]" on, "- [ ]" off; indented lines belong to the step above; "if: cond" starts a condition, the "yes: …"/"no: …" steps right after it are its branches. -->'
const steps = atom({ plugin: 'workflow-editor', key: 'steps' } as const, [] as Step[], { shape: 'steps-1' })
const editing = atom({ plugin: 'workflow-editor', key: 'editing' } as const, null as Editing | null, { shape: 'edit-3' }) // null adds a new step
const adding = atom({ plugin: 'workflow-editor', key: 'adding' } as const, 'step' as 'step' | 'if')
const trash = atom({ plugin: 'workflow-editor', key: 'trash' } as const, [] as Trash[], { shape: 'trash-3' })

export const parse = (md: string): Step[] => {
  const out: Step[] = []
  for (const line of md.split(/\r?\n/)) {
    const m = /^- \[( |x|X)\] (.*)$/.exec(line)
    if (m) out.push({ on: m[1] !== ' ', text: m[2] ?? '' })
    // Only indented lines (or blank ones) continue a step; other top-level lines are ignored.
    else if (out.length && (/^[ \t]/.test(line) || !line.trim())) out[out.length - 1]!.text += '\n' + line.replace(/^ {1,2}/, '')
  }
  return out.map(s => ({ ...s, text: s.text.trimEnd() }))
}

export const serialize = (list: Step[]) =>
  [HEADER, '', ...list.map(s => `- [${s.on ? 'x' : ' '}] ${s.text.split('\n').join('\n  ')}`), ''].join('\n')

export { section }

export const SUBAGENT_NOTE = '(Context from the lead session: the user\'s workflow. Follow the steps that apply to your task; delegation and QC gates stay with the lead.)'

const file = async ($: any) => `${await $.env.get('HOME')}/.claude/workflow.md`
// The file is the source of truth, so hand edits in an editor count too.
// A read error other than a missing file throws, so save never overwrites steps it could not read.
const load = async ($: any) => {
  const f = await file($)
  return parse((await $.fs.exists(f)) ? await $.fs.read(f) : '')
}
// shortcut: writes are queued per session, not across sessions, and $.fs has no rename for an atomic write; fine for one person editing.
let queue: Promise<unknown> = Promise.resolve()
const serial = <T,>(job: () => Promise<T>) => {
  const run = queue.then(job)
  queue = run.catch(() => {})
  return run
}
// Reads, changes and writes in one queued job; `fn` answering null means the file no longer matches what the pane showed.
const save = ($: any, fn: (l: Step[]) => Step[] | null | Promise<Step[] | null>, done?: () => Promise<unknown>) =>
  serial(async () => {
    const before = await load($)
    const list = await fn(before)
    if (!list) {
      await update($, steps, () => before)
      return $.ui.toast('Workflow file changed; pane reloaded, try again.')
    }
    await $.fs.write(await file($), serialize(list))
    await update($, steps, () => list)
    await done?.()
  })
const refresh = ($: any) => serial(async () => { const l = await load($); await update($, steps, () => l) })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'workflow-edit', description: 'Edit, add, delete or toggle the workflow steps Claude follows', immediate: true })
    await refresh($)
    $.ui.open({ id: PANE, title: 'Workflow' }).catch(() => {}) // always shown, no focus; /workflow-edit focuses it
    return next(e)
  })

  on('command.run', { command: 'workflow-edit' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Workflow', focus: true })
    return { text: 'Workflow pane opened. Changes apply from the next turn.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    const text = section(await load($).catch(() => []))
    return text ? { sections: [...r.sections, { id: 'workflow-editor:steps', text, scope: 'session' }] } : r
  })

  // Subagents get their own system prompt, so the workflow rides on their task instead (forks already inherit it).
  on('agent.spawn', async ($, e, next) => {
    const text = e.subagentType === 'fork' ? null : section(await load($).catch(() => []))
    return next(text ? { ...e, prompt: `${e.prompt}\n\n${SUBAGENT_NOTE}\n${text}` } : e)
  })

  // The diagram posts what the person did; each message names the step it was drawn for.
  // The diagram posts what the person did with a snapshot of the list it drew; any other list means the file moved on.
  on('ui.message', async ($, e, next) => {
    if (e.element !== 'flow') return next(e)
    const m = (e.data ?? {}) as { type?: unknown; i?: unknown; snap?: unknown; d?: Drop; dir?: unknown }
    if (m.type === 'undo') { await undo($); return {} }
    const i = m.i
    if (typeof i !== 'number' || typeof m.snap !== 'string') return {}
    const same = (l: Step[]) => JSON.stringify(l) === m.snap
    await update($, editing, () => null)
    if (m.type === 'edit') { const l = await read($, steps); if (same(l) && l[i]) await update($, editing, () => ({ i, step: l[i]! })) }
    else if (m.type === 'toggle') await save($, l => (same(l) && l[i] ? l.map((x, j) => (j === i ? { ...x, on: !x.on } : x)) : null))
    else if (m.type === 'move' && m.d && typeof m.d === 'object') await save($, l => (same(l) ? move(l, i, m.d!) : null))
    else if (m.type === 'nudge' && (m.dir === 1 || m.dir === -1)) await save($, l => (same(l) ? nudge(l, i, m.dir as 1 | -1) : null))
    else if (m.type === 'delete') {
      let gone: Trash | null = null
      await save($, l => {
        if (!same(l) || !l[i]) return null
        const after = remove(l, i)
        const n = spanOf(l, i) // the condition plus its branches
        gone = { index: i, steps: l.slice(i, i + n), after: after.slice(i, i + n - 1) }
        return after
      }, () => update($, trash, t => [...t, gone!].slice(-20))) // only after the write landed
    }
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input, Client } = $.ui.resolve(e) as any
    const list = await read($, steps)
    const ed = await read($, editing)
    const mode = await read($, adding)
    const last = (await read($, trash)).at(-1)
    const first = (t: string) => { const l = t.split('\n')[0] ?? ''; return l.length > 60 ? l.slice(0, 59) + '…' : l }
    const edIndex = ed && list[ed.i]?.text === ed.step.text ? ed.i : -1
    const isIf = ed ? kindOf(ed.step) === 'if' : mode === 'if'

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Button key="add-step" variant={mode === 'step' && !ed ? 'primary' : undefined} onPress={async () => { await update($, editing, () => null); await update($, adding, () => 'step') }}>+ step</Button>
          <Button key="add-if" variant={mode === 'if' && !ed ? 'primary' : undefined} onPress={async () => { await update($, editing, () => null); await update($, adding, () => 'if') }}>+ if/else</Button>
          {last && <Button key="undo" onPress={() => undo($)}>undo delete</Button>}
          {last && <Text dimColor> {first(last.steps[0]?.text ?? '')}</Text>}
        </Box>
        {Client
          ? <Client key="flow" module="./flow.tsx" props={{ steps: list, editing: edIndex }} />
          : list.map((s, i) => <Text dimColor={!s.on}>{s.on ? '[x]' : '[ ]'} {i + 1}. {first(s.text)}</Text>)}
        <Input
          key={ed ? `edit-${ed.i}-${ed.step.text.length}` : `add-${mode}-${list.length}`}
          label={ed ? (isIf ? 'Edit condition: ' : 'Edit step: ') : isIf ? 'New condition: ' : 'New step: '}
          placeholder={isIf ? 'e.g. the task changes code' : 'e.g. Run the tests before saying done'}
          value={ed ? body(ed.step) : ''}
          rows={ed ? 4 : 1}
          submitLabel={ed ? 'save' : 'add'}
          onSubmit={async (v: string) => {
            const t = v.trim()
            if (ed) {
              const k = kindOf(ed.step) // the box keeps its kind
              await save($, l => (l[ed.i]?.text !== ed.step.text ? null : t ? l.map((x, j) => (j === ed.i ? withKind({ ...x, text: t }, k) : x)) : l))
              await update($, editing, () => null)
            } else if (t) await save($, l => [...l, { on: true, text: mode === 'if' ? `if: ${t}` : t }])
          }}
        />
        {ed && <Button key="cancel" onPress={() => update($, editing, () => null)}>cancel edit</Button>}
        <Text dimColor>Drag ⠿ to move (into yes/no to branch) · click text: edit · click [x]: on/off · right-click: delete · keys: ↑↓ select, shift+↑↓ move, space, enter, d, u</Text>
        <Text dimColor>File: ~/.claude/workflow.md (hand edits work too). Applies from the next turn.</Text>
      </Box>
    )
  })
}

// Puts a deleted step back where it was; a deleted condition gets its branch steps back too.
const undo = ($: any) => {
  let last: Trash | undefined
  return save($, async l => {
    last = (await read($, trash)).at(-1)
    if (!last) return l
    const at = Math.min(last.index, l.length)
    const isIntact = JSON.stringify(l.slice(at, at + last.after.length)) === JSON.stringify(last.after)
    if (!isIntact) return null
    return [...l.slice(0, at), ...last.steps, ...l.slice(at + last.after.length)]
  }, () => update($, trash, t => (JSON.stringify(t.at(-1)) === JSON.stringify(last) ? t.slice(0, -1) : t)))
}
