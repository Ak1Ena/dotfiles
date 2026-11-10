import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'workflow-editor', component: 'Pane', requestId: 'workflow-editor',
  props: { title: 'Workflow', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('diagram: add, if/else, drag into a branch, toggle, delete, undo, edit', async ($, on) => {
  let disk = '- [x] first step\n'
  on('env.get', () => ({ value: '/home/u' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: disk }))
  on('fs.write', (_, e: any) => { disk = e.content ?? e.data ?? e.text; return { value: undefined } })
  on('command.register', () => ({ value: { command: 'workflow-edit' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const body = () => disk.split('\n').filter(l => l.startsWith('- ['))

  await ui.input({ key: 'add-step-1', text: 'run tests' })
  await ui.press({ key: 'add-if' })
  await ui.input({ key: 'add-if-2', text: 'code changes' })
  expect(body()).toEqual(['- [x] first step', '- [x] run tests', '- [x] if: code changes'])
  // Layout at 72 cols: boxes at rows 1, 6, 11 (3 tall, 2-row arrows); yes/no columns open at row 15.
  await ui.resize({ columns: 72, rows: 40, in: 'flow' })
  const text = () => ui.drawn({ in: 'flow' }).then(d => JSON.stringify(d))
  expect(await text()).toContain('drop a step here')

  // Drag "run tests" (row 7) onto the empty yes slot (row 17, left half).
  await ui.pointer({ type: 'down', x: 20, y: 7, button: 'left', in: 'flow' })
  await ui.pointer({ type: 'move', x: 10, y: 17, button: 'left', in: 'flow' })
  await ui.pointer({ type: 'up', x: 10, y: 17, button: 'left', in: 'flow' })
  expect(body()).toEqual(['- [x] first step', '- [x] if: code changes', '- [x] yes: run tests'])

  await ui.pointer({ type: 'down', x: 5, y: 2, button: 'left', in: 'flow' }) // [x] of step 1
  await ui.pointer({ type: 'up', x: 5, y: 2, button: 'left', in: 'flow' })
  expect(body()[0]).toBe('- [ ] first step')

  await ui.pointer({ type: 'down', x: 20, y: 7, button: 'right', in: 'flow' }) // delete the condition
  expect(body()).toEqual(['- [ ] first step', '- [x] run tests'])
  await ui.press({ key: 'undo' }) // the condition comes back with its branch
  expect(body()).toEqual(['- [ ] first step', '- [x] if: code changes', '- [x] yes: run tests'])
  expect(await ui.find({ type: 'Button', key: 'undo' })).toBe(undefined) // nothing left to undo

  await ui.pointer({ type: 'down', x: 20, y: 7, button: 'left', in: 'flow' }) // click (no move) edits
  await ui.pointer({ type: 'up', x: 20, y: 7, button: 'left', in: 'flow' })
  await ui.input({ key: 'edit-1-16', text: 'the task edits code' })
  expect(body()[1]).toBe('- [x] if: the task edits code')

  disk = '- [x] first step\n- [x] added by hand\n- [x] if: the task edits code\n- [x] yes: run tests\n' // file grew behind the pane: same index, other list
  await ui.pointer({ type: 'down', x: 20, y: 7, button: 'right', in: 'flow' })
  expect(body()).toEqual(['- [x] first step', '- [x] added by hand', '- [x] if: the task edits code', '- [x] yes: run tests'])
  await ui.unmount()
})

test('session.start opens the Workflow pane without focus; the pane draws no custom tray', async ($, on) => {
  const opened: any[] = []
  on('env.get', () => ({ value: '/home/u' }))
  on('fs.exists', () => ({ value: false }))
  on('command.register', () => ({ value: { command: 'workflow-edit' } }))
  on('ui.open', (_, e: any) => { opened.push(e); return { value: { isPlaced: true } } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(opened.map((o) => [o.id, o.focus])).toEqual([['workflow-editor', undefined]])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', key: 'tab-nvim' } as never)).toBeUndefined()
  await ui.unmount()
})
