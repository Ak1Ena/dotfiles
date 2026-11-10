export type AgentChip = { id: string; label: string; status: string }
export type ArtifactRef = { slug: string; title: string; url: string }
export type Viewing = { title: string; url: string; png: string | null; message: string; generation?: number } | null

declare module 'claude-code' {
  interface PluginState {
    'header-tray': {
      agents: AgentChip[]
      artifacts: ArtifactRef[]
      viewing: Viewing
      isHidden: boolean
    }
  }
}
