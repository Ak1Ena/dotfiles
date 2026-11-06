export type Qc = { repo: string; lines: number; reviewed: number; passed: boolean; blocks: number; needs_gate: boolean }
export type Mate = { agent: string; hit: number; blocked: boolean; title?: string }
export type Title = { text: string; byTask: boolean }
export type Me = { agent: string; lead: string } | 'lead'

declare module 'claude-code' {
  interface PluginState {
    'workflow-rail': { hit: number; qc: Shaped<Qc[]>; mates: Shaped<Mate[]>; me: Shaped<Me | null>; blocksSeen: number; title: Shaped<Title> }
  }
}
