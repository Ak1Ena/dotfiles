import type { Register } from 'claude-code'

export const RULE = `# Where the user reads you
The user reads only your final message of each turn; text you write between tool calls scrolls past unread.
- Between tool calls: write nothing, or one short status line.
- Every finding, answer, result, question and decision goes in the final message, even if you already said it mid-turn.
- Keep the final message short: at most 3 lines for most turns, 6 at most even after big work. No headings, tables, recaps or repeated facts; one line per item. Long output (lists, plans, reports) goes in a file and the message gives its path.
- Never end a turn on a tool call when the user needs to know something: close with a final message.`

export const register: Register = (on) => {
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    return { sections: [...r.sections, { id: 'final-message:rule', text: RULE, scope: 'session' }] }
  })
}
