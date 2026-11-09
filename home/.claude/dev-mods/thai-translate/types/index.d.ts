/** English reply text -> its Thai translation */
export type ThaiCache = Record<string, string>

declare module 'claude-code' {
  interface PluginState {
    'thai-translate': { isOn: boolean; thai: ThaiCache }
  }
}
