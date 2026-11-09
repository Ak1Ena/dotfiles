import { expect, test } from 'claude-code/testing'

test('subagent task gets the workflow appended; forks do not', async ($, on) => {
  on('env.get', () => ({ value: '/home/u' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: '- [x] run tests\n- [ ] off one\n' }))
  const seen: string[] = []
  on('agent.spawn', (_, e) => { seen.push(e.prompt); return { model: 'claude-haiku-5-5' } })
  const base = { tool_use_id: 't', description: 'd', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5' } as never
  await $.agent.spawn({ ...(base as object), prompt: 'do X', subagentType: 'reviewer' } as never)
  await $.agent.spawn({ ...(base as object), prompt: 'do Y', subagentType: 'fork' } as never)
  expect(seen[0]).toContain('do X\n\n(Context from the lead session')
  expect(seen[0]).toContain('1. run tests')
  expect(seen[0]).not.toContain('off one')
  expect(seen[1]).toBe('do Y')
})
