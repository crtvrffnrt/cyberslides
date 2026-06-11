# Repository Guidelines

This repository is a minimalist local presentation tool for technical live demos. Agents should keep changes deterministic, direct, and easy to debug. Do not add visual noise, speculative abstractions, or unnecessary dependencies.

## Current Architecture

- `server.js` is the Node.js entrypoint.
- `server.js` renders markdown slides, normalizes slide config, enforces slide limits, serves files, exposes JSON APIs, and bridges terminal WebSocket sessions to `node-pty`.
- `client.js` controls Presenter Mode, Edit Mode, progress dots, keyboard navigation, image input, save flow, and terminal focus/connect logic.
- `index.template.html` contains the HTML shell and CSS for slides, terminals, editor controls, and progress UI.
- `presentation.config.json` contains deck metadata, cover data, slide content, slide template types, image state, theme defaults, and terminal settings.
- `package.json` defines the local commands.

## Commands

- `npm install`: install dependencies.
- `npm start`: run the local server normally.
- `npm run dev`: run with `NODE_ENV=development`, `PRESENTATION_DEBUG=1`, and `node --watch`.
- `npm run debug`: run once with verbose uncaught traces.
- `npm run check`: syntax-check `server.js` and `client.js`.

There is no build step and no formal automated test suite.

## Debug Workflow

Use these checks when editing save behavior, server behavior, or APIs:

```bash
npm run check
curl http://127.0.0.1:8080/api/health
curl http://127.0.0.1:8080/api/presentation
```

If Edit Mode shows a save failure:

- `HTTP 404` usually means the browser is connected to a stale server process.
- `HTTP 400` means invalid payload or slide count outside `1-100`.
- `HTTP 413` means the save payload is too large, often because of embedded images.
- `HTTP 500` means file read/write failed.

When changing `server.js`, restart the active server or use `npm run dev`.

## Slide Constraints

- Presentations must contain between `1` and `100` slides.
- Slide 1 is always the cover slide.
- Slide 1 must stay `type: "cover"`.
- The cover slide must not embed a terminal.
- `presentation.config.json.contentSlides` and `presentation.config.json.slides` must remain aligned by index.
- If `cover.agenda` is empty, the agenda is generated from headings in later slides.
- Do not bypass `normalizePresentation` or `normalizeSlideConfig` for save/render paths.

## Template Types

Use only these slide template types unless the user explicitly asks for a new template.

`cover`

- First slide only.
- Uses `title`, `presenter`, `metadata`, and `cover` from `presentation.config.json`.
- Agenda can be manual or auto-generated.

`terminalText`

- Primary terminal demo slide.
- Real terminal on the right, minimal text on the left.
- Use 1-2 short text lines and at most 1-2 bullets.
- Terminal geometry is fixed by code:
  `leftVw: 52`, `topVh: 12`, `widthVw: 42`, `heightVh: 72`.
- Do not allow terminal content to overlap the text region.

`text`

- Centered minimal text.
- No terminal.
- Use for one focused idea, transition, or conclusion.

`image`

- Single image as the main subject.
- Supported image state: `src`, `alt`, `x`, `y`, `scale`.
- No cropping feature.
- Avoid multiple images on one slide.

`terminalFocused`

- Large terminal-dominant slide.
- Minimal or no additional text.
- Terminal geometry is fixed by code:
  `leftVw: 7`, `topVh: 9`, `widthVw: 86`, `heightVh: 78`.

`dense`

- Structured technical detail.
- Use sparingly for short lists, evidence, constraints, or comparisons.
- Keep the slide readable during screen sharing.

## Terminal Rules

- Preserve the real terminal architecture: browser xterm, WebSocket `/terminal`, and `node-pty`.
- Do not replace terminal sessions with simulated text.
- Keep terminal-specific styling isolated from general slide styling.
- Test at least one terminal-enabled slide and one non-terminal slide after terminal changes.
- For `terminalText` and `terminalFocused`, preserve fixed geometry unless the user explicitly changes the template standard.
- Keep terminal cards inside safe presentation bounds for Teams, Slack, Zoom, and browser screen sharing.

## Edit Mode Rules

- Edit Mode works on a browser-side draft.
- Save goes through `PUT /api/presentation`.
- Save should return structured JSON errors.
- After successful save, the page reloads so rendered slides, terminal indexes, and progress dots match disk state.
- If adding slide types, update `templateDefaults` in `client.js`, normalization in `server.js`, CSS in `index.template.html`, and documentation.
- Keep add/delete behavior consistent with the `1-100` slide constraint.

## Presenter UI Rules

- Keep UI minimal.
- Preserve the lower-right numeric slide counter.
- Preserve the bottom dot progress indicator.
- Do not reintroduce the old text-size HUD or bottom help text.
- Progress dots must map one-to-one with slides.
- Progress dots must remain clickable and expose slide numbers through hover title text.
- Avoid decorative elements, complex animations, or controls that distract from the slide.

## Content Rules

- Write slides for clarity under live screen sharing conditions.
- Prefer short headings, direct claims, and evidence-first bullets.
- Remove filler words before adding slide count.
- Keep `terminalText` content short enough to fit the reserved left text region.
- Keep `dense` slides structured, not crowded.
- Do not use slide text to explain the UI itself unless the user asks for a training deck.

## Coding Style

- Use plain JavaScript.
- Use semicolons.
- Use double quotes.
- Use 2-space indentation.
- Prefer small helper functions and direct DOM access.
- Keep the project framework-free.
- Avoid adding dependencies unless the current stack cannot solve the problem cleanly.
- Use `apply_patch` for manual edits.
- Do not hard-code machine-specific paths.

## Testing Checklist

Run after JavaScript edits:

```bash
npm run check
```

Run after API/save edits:

```bash
curl http://127.0.0.1:8080/api/health
curl http://127.0.0.1:8080/api/presentation
```

Manual checks:

- Presenter Mode loads.
- Edit Mode opens.
- A text edit saves and reloads.
- Adding a slide saves and reloads.
- The cover remains slide 1.
- A terminal slide starts an interactive shell.
- A non-terminal slide navigates normally.
- Progress dots update and jump to slides.

## Commit and PR Notes

- This checkout currently has no established commit history.
- Use short imperative commit subjects if commits are requested.
- PR descriptions should mention affected files, user-visible behavior, and any manual browser checks.
