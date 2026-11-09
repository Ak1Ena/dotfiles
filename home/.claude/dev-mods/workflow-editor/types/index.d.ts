export type Step = { on: boolean; text: string }
// steps: what was deleted (a condition with its branches); after: what the delete left in their place.
export type Trash = { index: number; steps: Step[]; after: Step[] }
export type Editing = { i: number; step: Step }

declare module 'claude-code' {
  interface PluginState {
    'workflow-editor': { steps: Shaped<Step[]>; editing: Shaped<Editing | null>; trash: Shaped<Trash[]>; adding: 'step' | 'if' }
  }
}
