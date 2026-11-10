import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register, Timer } from 'claude-code'

import type { AgentChip, ArtifactRef, Viewing } from '../types'

const PANE = 'artifact-view'
const SERVER = 'claude-artifacts'
const SHOWN = 5
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOT_W = 1280
const SHOT_H = 2400
const TMP = '/tmp/header-tray'
const agents = atom({ plugin: 'header-tray', key: 'agents' } as const, [] as AgentChip[], { shape: 'agents-1' })
const artifacts = atom({ plugin: 'header-tray', key: 'artifacts' } as const, [] as ArtifactRef[], { shape: 'artifacts-1' })
const viewing = atom({ plugin: 'header-tray', key: 'viewing' } as const, null as Viewing, { shape: 'viewing-2' })
const isHidden = atom({ plugin: 'header-tray', key: 'isHidden' } as const, false)

const LIVE = new Set(['pending', 'running', 'waiting', 'idle'])
const DOT: Record<string, string> = { running: '●', pending: '◌', waiting: '◐', idle: '○' }

// Untrusted text (titles from the server) must not carry terminal escape sequences.
const clean = (s: unknown) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function mcpText(r: { content: readonly unknown[] }): string {
  return r.content
    .map((b) => (b && typeof b === 'object' && (b as { type?: string }).type === 'text' ? (b as { text: string }).text : ''))
    .join('\n')
}

export function chips(list: readonly AgentInfo[]): AgentChip[] {
  return list
    .filter((a) => LIVE.has(a.status))
    .map((a) => ({ id: a.id, label: clip(clean(a.teammateId?.split('@')[0] ?? a.type), 16), status: a.status }))
}

export function parseArtifacts(text: string): ArtifactRef[] {
  const list = (JSON.parse(text.slice(text.indexOf('{'))) as { artifacts?: Partial<ArtifactRef>[] }).artifacts ?? []
  return list
    .filter((a) => typeof a.slug === 'string' && /^[\w-]+$/.test(a.slug) && typeof a.url === 'string' && /^https:\/\/claude\.ai\//.test(a.url))
    .map((a) => ({ slug: a.slug!, title: clean(a.title) || a.slug!, url: a.url! }))
}

// read_artifact wraps the page in a JSON summary and notice tags: keep only the document itself.
export function extractHtml(text: string): string | null {
  const start = text.search(/<!doctype html|<html\b/i)
  if (start < 0) return null
  const rest = text.slice(start)
  const wrapEnd = rest.search(/<\/untrusted-document-/)
  const doc = wrapEnd >= 0 ? rest.slice(0, wrapEnd) : rest
  const end = doc.toLowerCase().lastIndexOf('</html>')
  return end >= 0 ? doc.slice(0, end + 7) : doc
}

async function loadArtifacts($: EngineInterface): Promise<void> {
  try {
    const r = await $.mcp.call(SERVER, 'list_artifacts', { limit: SHOWN })
    if (r.isError) return
    const list = parseArtifacts(mcpText(r))
    await update($, artifacts, () => list)
  } catch {
    // Server not connected or odd reply: keep last list, next refresh retries.
  }
}

// Renders the artifact's HTML with headless Chrome and shows the screenshot as an Image in the pane.
// shortcut: renders the page's own HTML offline (file://); pages that fetch claude.ai runtime data show without it.
async function openArtifact($: EngineInterface, a: ArtifactRef): Promise<void> {
  await update($, viewing, () => ({ title: a.title, url: a.url, png: null, message: 'Rendering…' }))
  const placed = await $.ui.open({ id: PANE, title: clip(a.title, 40), focus: true, closeOnEscape: true }).catch(() => null)
  if (!placed?.isPlaced) $.ui.toast('No room for the artifact pane: widen the terminal.')
  let done: { png: string | null; message: string; generation?: number }
  try {
    const r = await $.mcp.call(SERVER, 'read_artifact', { slug: a.slug })
    const html = r.isError ? null : extractHtml(mcpText(r))
    if (!html) throw new Error(r.isError ? clip(clean(mcpText(r)), 200) : 'no HTML page in this artifact')
    const page = `${TMP}/${a.slug}.html`
    const png = `${TMP}/${a.slug}.png` // one file per artifact, overwritten; generation forces a redraw
    await $.fs.write(page, html)
    const run = await $.process.run(
      [CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${SHOT_W},${SHOT_H}`, `--screenshot=${png}`, `file://${page}`],
      { timeoutMs: 30_000 },
    )
    if (run.exitCode !== 0 || !(await $.fs.exists(png))) throw new Error(`Chrome failed: ${clip(clean(run.stderr), 200)}`)
    done = { png, message: '', generation: Date.now() }
  } catch (err) {
    done = { png: null, message: `Could not render: ${clean(err instanceof Error ? err.message : err)}` }
  }
  // Only fill the pane if the person has not opened another artifact meanwhile.
  await update($, viewing, (v) => (v?.url === a.url ? { ...v, ...done } : v))
}

export const register: Register = (on) => {
  let agentSync: Timer | undefined
  let artifactSync: Timer | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tray', description: 'Show or hide the agents/artifacts tray above the prompt' }).catch(() => {})
    agentSync?.cancel()
    artifactSync?.cancel()
    const syncAgents = async () => {
      try {
        const list = chips(await $.agent.list())
        await update($, agents, (cur) => (JSON.stringify(cur) === JSON.stringify(list) ? cur : list))
      } catch {
        // Missed tick: next one retries.
      }
    }
    agentSync = $.clock.every(2000, syncAgents)
    artifactSync = $.clock.every(60_000, () => loadArtifacts($))
    await syncAgents() // local roster, fast
    // First artifacts fetch: soon, but never stalls session start on a slow MCP server.
    const first: Timer = $.clock.every(500, async () => {
      first?.cancel()
      await loadArtifacts($)
    })
    return next(e)
  })

  on('command.run', { command: 'tray' }, async ($) => {
    const hidden = await update($, isHidden, (h) => !h)
    return { text: hidden ? 'Tray hidden. /tray shows it.' : 'Tray shown.' }
  })

  // A publish or edit through the artifacts server changes the list: refresh after it.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (/artifact/i.test(e.tool) && !/(list|read|get)_/i.test(e.tool)) void loadArtifacts($)
    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)
    // Compose with other mods' bands (workflow-rail): theirs first, the tray under it.
    const below = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const live = await read($, agents)
    const arts = await read($, artifacts)
    // No hotkeys: a bare key in an empty composer would press them instead of typing.
    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" flexWrap="wrap">
          <Text bold>Agents </Text>
          {live.length === 0 && <Text dimColor>none running</Text>}
          {live.map((a) => (
            <Text dimColor={a.status !== 'running'}>{`${DOT[a.status] ?? '·'} ${a.label}  `}</Text>
          ))}
        </Box>
        <Box flexDirection="row" flexWrap="wrap">
          <Text bold>Artifacts </Text>
          {arts.length === 0 && <Text dimColor>none </Text>}
          {arts.map((a, i) => (
            <Button key={`art-${i}`} label={clip(a.title, 24)} onPress={() => openArtifact($, a)} />
          ))}
          <Button key="refresh" label="↻" onPress={() => loadArtifacts($)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    const v = await read($, viewing)
    if (!v) return <Text dimColor>Pick an artifact in the tray above the prompt.</Text>
    const columns = Math.max(1, Math.min(255, e.props.bodyColumns))
    // Terminal cells are about twice as tall as wide.
    const rows = Math.max(1, Math.min(255, Math.round((columns * SHOT_H) / SHOT_W / 2)))
    const Image = 'Image' in els ? els.Image : undefined
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Button
            key="browser"
            hotkey="o"
            label="Open in browser"
            onPress={() =>
              $.process.run(['open', '--', v.url]).then(
                () => {},
                () => $.ui.toast('Could not open the browser.'),
              )
            }
          />
          <Button key="close" hotkey="q" label="Close" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        <Text dimColor>{v.url}</Text>
        {v.message !== '' && <Text>{v.message}</Text>}
        {v.png && Image && <Image key="page" source={{ file: v.png, format: 'png', generation: v.generation }} columns={columns} rows={rows} alt={`${v.title} (this terminal cannot show images)`} />}
        {v.png && !Image && <Text dimColor>This surface cannot show images: open in browser.</Text>}
      </Box>
    )
  })
}
