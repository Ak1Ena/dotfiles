---
name: lyric-video
description: Use when making a lyric video or music video (MV) in Remotion from a song, SRT subtitles and artwork, or when generating story artwork for one with GPT image generation.
---

# Lyric video in Remotion

Lessons from building two MVs for Aki's cover of "In Hell We Live, Lament" (`~/mv/in-the-hell-we-live/lyric-video`). The user rejected the first passes as "AI slop"; the rules below are what fixed it.

## Before building, ask or check
- Which language is sung? Lead with that one. Drop a translation unless asked.
- `(...)` in a subtitle line is usually a backing vocal or second singer. Render it as a quieter echo under the main line, not as main text.
- Who is the credited artist? For a cover, credit the cover artist first and the original artist after ("Cover by Aki. Original by ...").
- Is it a duet? Give each voice one consistent treatment, a different weight or style of the same type system.

## Typography
- One font family for everything (lyrics, titles, credits). Separate voices with italic vs upright and weight, never a second family.
- One position for every lyric line: lower centre, `padding: 0 160px 120px`. Only a one-word shout (like "Lament") may sit centre screen. Never scatter lines to corners, rings, boxes, or rotated paths.
- Lay out the full line from frame 0 and reveal words in place (opacity plus a few px of rise), so nothing reflows as words arrive.
- Accent colour on at most a handful of keywords per song.

## Effects that read as AI slop (do not use)
RGB split and chromatic ghosts, screen shake on every word, scanlines, glitch noise decoding, VHS "REWIND" labels, HUD counters ("LOOP 01"), terminal or typewriter boxes, letters orbiting a circle, falling or exploding letters, full-screen flat colour washes (`mix-blend-mode: color`), blurred screen-copy "bloom" over the whole image. Keep motion small and timed to the voice.

## Story: subtext, not captions
- Do not write the message on screen: no act titles ("I. We take"), no closing thesis lines. The user called that "too straight".
- Carry the arc with images, light and colour: each section gets its own painting or grade, the light changes meaning (for example warm "heaven" light turning into fire), and the ending resolves visually.

## Lighting a still image
Do not lay colour gradients over the picture. Relight it (`src/Light.tsx`, `LitImage`):
1. Base copy dimmed to about `brightness(0.45-0.5)`.
2. For each light source that is painted in the image (a glowing eye, lamp, fire, ember), reveal a `brightness(1.2)` copy through a `radial-gradient` mask at that point. Put the lights inside the camera-transform container so they move with the image.
3. Light colour as a radial gradient with `mix-blend-mode: overlay`, falling off with distance.
4. God rays: about 6 copies of the image at `contrast(2.4)` (highlights only), `transform-origin` at the source, scaled 1.04 to 1.25, `screen` blend, opacity falling per copy.
5. Fire flicker from layered sines, and the power driven by bass (`visualizeAudio`, low bins). One shared `BassProvider` context computes it once per frame.
6. Light wrap on the text: the text-shadow glow uses the current scene light colour.
Use image coordinates measured from the real file: crop with an ffmpeg grid (`drawgrid`) and read the positions.

## Generating art with GPT (Codex CLI)
Codex has a built-in image tool. One call per image, and they run fine in parallel (`&` then `wait`):
```bash
codex exec --skip-git-repo-check -s workspace-write -C <dir> \
  "Use your image generation tool to create ONE image, then save it as ./NAME.png in the current directory and verify it exists. Image: <scene>. Style: <shared style line>. 16:9, no text, no watermark." < /dev/null
```
Repeat one identical style line in every prompt so the plates look like one series, and ask for a calm, dark lower third for the lyrics. The output is about 1672x941.

## Pipeline and gotchas
- Parse SRT once into a typed `lyricData.ts` (`startMs`, `endMs`, `text`, `echo`, `voice`, `mode`). Generate it with a script and fail loudly when counts or timings mismatch.
- Extract audio from the supplied video with `ffmpeg -vn -c:a copy`. Do not show a video that has burned-in subtitles.
- No word timestamps: spread words across a line by syllable count (`wordTimes` in `kit.tsx`).
- Check frames by bundling once (`npx remotion bundle --out-dir X`), then `npx remotion still X <Comp> f.jpg --frame=N --scale=0.35`, and stitch into a contact sheet with ffmpeg `hstack`/`vstack`. Look at every sheet before reporting.
- zsh: a frame list needs an array, `FR=(1 2 3); for f in $FR`. A plain string does not split.
- macOS is case-insensitive: `lyrics.ts` and `Lyrics.tsx` collide. Name data files differently.
- Spreading `{ color: undefined }` over a style overrides the inherited colour and renders black. Use `...(color ? { color } : {})`.
- Japanese Google Fonts load hundreds of subset files per render: raise `Config.setDelayRenderTimeoutInMilliseconds`.
- Keep Studio running and give the user `http://localhost:3000/<CompositionId>`. Render an MP4 only when asked.
