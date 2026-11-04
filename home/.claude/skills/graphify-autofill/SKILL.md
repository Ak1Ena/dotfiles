---
name: graphify-autofill
description: "Answer a codebase or corpus question through the graphify knowledge graph, and when the graph cannot answer it, close the gap by sourcing the missing fact yourself — from source files, vendored dependencies, git history, or the web — then write it back into the graph. Use when a graphify query returns nothing, returns only AMBIGUOUS/INFERRED edges, or names something outside the indexed corpus; when the user asks for an answer that must not dead-end at \"the graph does not know\"; or when the user wants the graph enriched rather than just queried."
---

# /graphify-autofill

`/graphify` answers from the graph and stops honestly at its edge. This skill takes the same question and refuses to stop there: every **gap** it hits gets **sourced** from outside the graph, then **written back** so the gap is closed for good.

## Usage

```
/graphify-autofill "<question>"                # query current project's graph, autofill gaps
/graphify-autofill <path> "<question>"         # target a specific corpus
/graphify-autofill "<question>" --no-writeback # answer only, leave the graph untouched
/graphify-autofill "<question>" --offline      # sourcing ladder stops before the web rung
/graphify-autofill "<question>" --budget 3     # cap at N gaps sourced (default 5)
```

## Non-negotiables

- **Never** close a gap from training memory. A fact enters the answer only after you read it in a file, a command's output, or a fetched page — cited.
- **Never** invent a graph edge. Write-back records only what you sourced, tagged with where it came from.
- Every claim in the final answer carries a provenance tag: `[graph]`, `[source]`, `[history]`, `[web]`. Untaggable claim = dropped claim.
- An unresolved gap is reported as unresolved, with the ladder rungs you tried. That is a valid outcome, not a failure to hide.

---

## Step 1 — Ground the graph

Check `graphify-out/graph.json` relative to the target path.

- Missing → run the `graphify` skill's full build on the target path, then continue.
- Present → check staleness before trusting it:

```bash
$(cat graphify-out/.graphify_python) -c "
import json, os
from pathlib import Path
root = Path('graphify-out/.graphify_root').read_text(encoding='utf-8').strip()
built = os.path.getmtime('graphify-out/graph.json')
newer = [str(p) for p in Path(root).rglob('*')
         if p.is_file() and 'graphify-out' not in p.parts and '.git' not in p.parts
         and p.stat().st_mtime > built]
print(f'{len(newer)} file(s) changed since build')
print('\n'.join(newer[:20]))
"
```

Any changed files → run graphify `--update` on the target path first. A gap caused by staleness must never reach Step 3; that would send you sourcing a fact the graph could already answer.

**Done when:** `graph.json` exists and no corpus file is newer than it.

## Step 2 — Query

Run the `graphify` skill's query flow for the user's question — including its constrained vocabulary expansion, which you must not skip. Capture three things from it verbatim:

1. the expanded token list (empty or not),
2. the returned subgraph — nodes, edges, `confidence` tags, `source_location` values,
3. graphify's own answer.

**Done when:** you hold the subgraph and can state which parts of the question it does and does not cover.

## Step 3 — Gap audit

Split the question into its atomic claims. Judge each against the subgraph and label it:

| Label | Signal |
|---|---|
| **Answered** | Backed by `EXTRACTED` edges with a `source_location` |
| **Gap-vocab** | Query expansion found no vocab token for this concept — the corpus may not contain it at all |
| **Gap-thin** | Nodes matched, but the supporting edges are only `INFERRED` or `AMBIGUOUS` |
| **Gap-external** | The answer depends on a symbol, package, or file the corpus does not index |
| **Gap-conflict** | Two edges or two sources disagree |

List the gaps to the user in one line each before sourcing anything. Stop at `--budget` (default 5), most-load-bearing first, and say plainly which gaps you left untouched.

**Done when:** every atomic claim carries exactly one label, and no gap is silently dropped.

## Step 4 — Source the gap

For each gap, climb the ladder from the top. Stop at the first rung that yields the fact — every rung below is more expensive and less trustworthy than the one above.

1. **Widen the corpus.** For **Gap-external** where the file is inside the project but was never indexed (excluded subfolder, sibling package, monorepo neighbour): run graphify on that path and merge, then re-query. A gap the corpus can answer is not a gap.
2. **Read the source.** Glob and Grep for the symbol, then Read the definition and its call sites. This rung resolves most **Gap-thin** and **Gap-vocab** cases — the graph's AST pass reports structure, not intent, and intent is in the code and its comments.
3. **Read the dependency.** For third-party symbols, read the installed copy before anything published: `node_modules/`, `site-packages/`, `vendor/`, `~/.cargo/registry/`, `.venv/`. The installed version is the one that actually runs; documentation on the web may describe a different one.
4. **Read the history.** `git log -S'<symbol>'`, `git log --follow <file>`, `git blame`, and `gh pr view` on the commit that introduced it. This is the rung that resolves **Gap-conflict** and every "why is it like this" question — rationale lives in commits and PRs, never in the AST.
5. **Read the web.** Only for genuinely external knowledge: an upstream library's semantics, a spec, an API contract. WebFetch the official docs for the exact installed version first; WebSearch only when you lack the URL. Skip this rung under `--offline`.

Record for every resolved gap: the fact, the rung, and the citation — `file:line`, commit SHA, or URL.

**Done when:** each in-budget gap is either resolved with a citation or marked unresolved with the rungs tried.

## Step 5 — Write back

Skip under `--no-writeback`. Otherwise persist what you sourced, so the next question hits `[graph]` instead of repeating this work.

- **Web sources:** `graphify add <url>` ingests the page into `./raw` and updates the graph. Use it for every URL from rung 5.
- **Everything else:** append one section per resolved gap to `graphify-notes/autofill.md` at the corpus root, then run graphify `--update` on that path.

```markdown
## <the gap, as a question>

**Answer:** <the sourced fact, one or two sentences>
**Rung:** source | dependency | history | web
**Citation:** <path:line | SHA | URL>
**Sourced:** <YYYY-MM-DD>
```

Never edit `graph.json` by hand — graphify's extraction pass owns it, and a hand-written node loses the audit trail that makes the graph worth querying.

**Done when:** every resolved gap has a note or an ingested URL, and `--update` has folded them in.

## Step 6 — Answer

Give the user the answer to their actual question — prose, not a report of your process. Then, below it:

- **Provenance:** each claim tagged `[graph]` / `[source]` / `[history]` / `[web]` with its citation.
- **Still unknown:** each unresolved gap with the rungs tried, and what would resolve it (a path to index, a repo you lack access to, a doc behind auth).
- **Graph updated:** the gaps now folded into the graph, or "none" under `--no-writeback`.

**Done when:** no sentence in the answer lacks a tag, and unresolved gaps are stated rather than smoothed over.
