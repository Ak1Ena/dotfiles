import { expect, test } from 'claude-code/testing'

test('rule section is added last, engine sections kept', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'hi', scope: 'shared' }] }))
  const r = await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as never)
  expect(r.sections[0]?.id).toBe('intro')
  expect(r.sections.at(-1)?.id).toBe('final-message:rule')
  expect(r.sections.at(-1)?.scope).toBe('session')
})
