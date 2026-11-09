export type AgentRow = {
  id: string
  label: string
  kind: 'main' | 'subagent' | 'teammate'
  status: 'running' | 'idle' | 'done' | 'failed'
  doing: string
}

export type Decision = {
  at: number
  who: string
  decision: string
  why: string
  alternatives: string
  verdict?: 'right' | 'wrong'
  reason?: string // why the user marked it false
  skipped?: true // user chose Skip on its card; /assumptions shows it again
  told?: true // a 'wrong' verdict already passed to Claude
}

declare module 'claude-code' {
  interface PluginState {
    'agent-tracker': { rows: Shaped<AgentRow[]>; decisions: Shaped<Decision[]> }
  }
}
