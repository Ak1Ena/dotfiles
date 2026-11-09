/** '<target code>:<English paragraph>' -> its translation */
export type ThaiCache = Record<string, string>
/** mode: th = Thai⇄English, cn = Claude works in Chinese, replies shown in the prompt's language */
export type LangId = 'th' | 'cn'

declare module 'claude-code' {
  interface PluginState {
    'thai-translate': { isOn: boolean; thai: ThaiCache; lang: LangId; sent: ThaiCache }
  }
}
