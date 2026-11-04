# Capture hygiene

Rule: a capture is evidence only if you opened it and it shows the state its filename claims.

## Before a flow
- Dismiss blocking dialogs (pickup-condition popups, age gates, cookie banners) by their button text, then re-check the page.
- Take selectors from the live DOM, not the design. A guessed selector such as an unscoped header input times out. Read every FAIL line; never report "no failures" after a rerun unless you say what changed.
- Form submits need hydration first. Before filling and clicking a submit, wait until its React props exist (a node key starting `__reactProps$`, as the spec helpers' hydration check looks for). A click before hydration submits the form as a native GET: the URL gains query params and nothing saves. If a save click changes the URL with no effect, check the URL before blaming the server.
- A click that does nothing may be held: `aria-disabled="true"` while a cart write lands. Assert the attribute cleared (`expect(locator).not.toHaveAttribute("aria-disabled", "true", { timeout: 60_000 })`), then click and wait for the URL. Check the DOM attribute before blaming the route or the server.
- A headless UI dialog wrapper has zero size and its panel is fixed. Wait for and click the panel's button by its text, never the wrapper.
- `page.goto(url, { waitUntil: "networkidle" })` can time out on a dev server, because the dev connection keeps the network busy. Use `waitUntil: "load"`, then wait for a visible element. Re-run the whole page list after a change, since one timeout aborts the script and skips the rest.
- A freshly started backend can take over 30 s to serve the admin login. Wait for the email input with a 120 s timeout before filling; a 30 s fill timeout on the first pass was slow loading, not a broken login.
- Admin login may land on the orders page, not the dashboard. Reach a board through its sidebar link by its href attribute, not a role-based link lookup.
- Admin login for a capture script: POST the auth provider's emailpass endpoint to get a token, POST the session endpoint with that bearer token, then copy the `set-cookie` name and value into the browser context for the base URL. Production sessions set a Secure cookie, which a plain-http local port drops. Serve through a proxy that adds `x-forwarded-proto: https`, or the login step fails. Before each shot, wait until the page no longer shows a Loading state.
- Copy whose length depends on data (hours, lists, prices) is shot at the worst case the admin can produce, at the narrowest width (390). A seeded-state shot that fits says nothing about an edited value that wraps and clips. Name the data state in the filename and the report.
- If a shoot needs a shared flag or promotion switched on, restore it and read the value back before reporting.
- Seed real rows through the API when the source can be created. If it cannot, say so and keep the empty state.

## Shot quality
- A cart shot must show the line item or count before you save it. An empty cart after add-to-cart means the add failed: report that, do not save the shot as evidence.
- Use viewport shots for open overlays (mini cart, drawer). fullPage repeats sticky headers. Lazy overlays can fill after about 1.5 s: wait for a content selector inside the overlay and scroll it to top first.
- Toasts and dialogs fade. Wait until the element is gone or fully opaque, not a fixed sleep. A shot caught mid-fade is a failed capture; re-shoot the same state.
- Element crops: a selector can match a sibling. Open each crop and confirm it holds the intended element.
- Admin shells scroll inside their own container, so fullPage captures only the outer frame. Before reporting a full-page shot, confirm its last section and footnote are in the frame. If not, shoot a taller viewport or scroll the inner container, and re-shoot into the same new run folder.
- Mobile element shots: a fixed header or bottom bar overlays the element. Set those fixed elements to `position: static`, shoot, then restore them. Full-page mobile shots keep the fixed bars.
- A full-length mobile shot with a black band at the bottom means the viewport is shorter than the scrolled page. Set the viewport height to the page's scroll height, then re-shoot.
- A Next.js dev server shows an error badge ("1 Issue") over the page. Inject `nextjs-portal{display:none!important}` before every screenshot, and confirm the badge is gone in the shot.
- A toggle chip's state is read from `aria-pressed` or the DOM attribute, never from innerText: a check glyph stays in the text whether the chip is on or off. Claim a visible untick only after a frame shows it.
- A flaky flow: run the same flow against the base build on another port. If it fails there too, it is pre-existing: note it, let the page settle (a visible total, or the network going idle), and rerun.

## Runs, output and PR media
- Each new round goes to a new run folder (`run-02`, `run-03`, ...) that does not exist yet. Name the current run in the report. Name each shot from its route with `/` turned into `_`, so nested routes do not create nested folders.
- Playwright clears its output directory at the start of each run and deletes earlier videos. Give each run its own output directory named for its run folder.
- Shoot from one integration tip where every part is merged, never from a part's own branch. Confirm the backend on the capture port runs that tip's code (commit hash, or a route check on the new endpoints). A header or montage names the head SHA it shot.
- Re-shoot only what the diff can change. New seed data is the exception: it changes every data-driven page.
- E2E specs run from a git worktree fail at once if the spec package lacks its node_modules. Symlink that node_modules from the main checkout at the same relative path (untracked, never committed). Set the base URL env var explicitly on every run; an unset var can default to a live host.
- Run `gh` with `-R OWNER/REPO` when the cwd is a scratch directory outside the checkout.
- Put media in the PR body. Write refs as `![alt](./file.png)` and pass `--attach ./file.png` with the same name, so gh swaps in the uploaded URL. Then fetch the body: no local `](./` refs should remain, and the user-attachments count should match the media count. Every image URL must return 200 and render.
- Replace the whole media set each run. Drop captions that name an older run, grep the body for older user-attachments URLs, and delete superseded media comments with the comments API instead of marking them superseded.
- Never upload a localhost, static-path or local file reference as PR media.
- Labelled before/after strips: if ffmpeg lacks drawtext, build the labelled montage as an HTML page and screenshot it with Playwright. Put each capture's own label (state, SHA, run) in the page, not only the filename.

## GIF under a size cap
- Lower fps and palette colours before width. Two-pass palette, starting at fps 6 and 96 colours. On a 1280-wide recording this gave 7.8 MB, where fps 10 with 128 colours gave 13.6 MB:

      ffmpeg -loglevel error -y -i in.webm -vf "fps=6,scale=1280:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" out.gif

- Frame-sequence GIF (one PNG per step, no recording): `ffmpeg -framerate 1.2 -i f%02d.png` with the same two-pass palette at `scale=800:-1`. Open the frames you report on, and name them in the report.
- Check the size with `ls -la`; step fps down again if still over. Keep an oversize file renamed `*.oversize.gif` instead of deleting it, unless told to.
- Check the last frame: `ffmpeg -loglevel error -y -sseof -1 -i in.webm -frames:v 1 last.png`, then view it. A blank or loading final frame means the recording stopped too early.
- Never speed playback to fit the cap. A 0.4x GIF reads as fast-forward. If it stays over after fps and colour steps, check machine load and re-record once it falls.

## Background runs
- Run screenshot, GIF and probe scripts as background tasks. Wait with a bounded loop on the run's output or the new run folder, such as `until grep -qE "passed|failed" LOG; do sleep 5; done`. Do not chain long foreground sleeps, and do not poll the output file unless progress is asked.
