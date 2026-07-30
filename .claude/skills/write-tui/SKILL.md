---
name: write-tui
description: Load when writing or changing a TUI
---

# Writing a Fluid Ink TUI

This repo has no TUI yet; this skill captures the ink quirks and fluidity tricks to apply when a command grows one (a live request dashboard, a portal-messages viewer, …). Layout-level conventions and the dependency/tsconfig prerequisites live in **react-style-guide**; the first TUI built here becomes the reference implementation for the rest.

## Mount / unmount

**Use the alternate screen buffer for full-screen TUIs.** The command file (`command.tsx`, not the component) writes the escape, restores on exit, and only opts in for interactive mode. Otherwise scrollback fills with prior dashboard frames.

```ts
// commands/<command>/command.tsx
if (watch) {
  process.stdout.write(ANSI.enterAltScreen + ANSI.cursorHome);
  process.on('exit', () => process.stdout.write(ANSI.exitAltScreen));
}
const app = render(<Dashboard … />);
await app.waitUntilExit();
```

Put `ANSI` constants in a `utils/ansi.ts` (create it with the first TUI) — add new sequences there rather than sprinkling `\x1b[…]` literals.

**Quit fast, don't let pending work block shutdown.** `useApp().exit()` unmounts ink and starts to drain the event loop, but an in-flight fetch or a lingering Playwright browser context keeps the process alive. Pair `exit()` with a microtask-deferred `process.exit(0)`:

```ts
if (input === 'q' || key.escape) {
  exit();
  setImmediate(() => process.exit(0));
  return;
}
```

**One-shot mode**: skip the alt screen, render once, exit after the first fetches resolve. Wrap the `exit()` in `setTimeout(…, 0)` so the final frame flushes before unmount:

```ts
if (allLoaded || allErrored) setTimeout(() => exit(), 0);
```

## Polling without leaks

A section-polling hook should get three things right:

1. **`cancelled` flag** captured by the effect's closure — every `setState` is guarded by it, so a late response from a stale fetch never overwrites fresh state.
2. **`AbortController`** passed into the data layer (`fetchWithTimeout` and the `utils/portal` helpers take a signal, or should grow one when first needed) — the in-flight HTTP call is canceled on unmount or deps change, not just ignored.
3. **`refreshKey` in the deps array** — bumping a counter at the parent (`setRefreshKey(k => k + 1)`) re-runs the effect on demand without duplicating the fetch logic.

```ts
useEffect(() => {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;

  const run = async () => {
    setState(s => ({ ...s, fetching: true }));
    controller = new AbortController();
    try {
      const rows = await fetchSection(kind, opts, controller.signal);
      if (cancelled) return;
      setState({ rows, error: null, loadedAt: new Date(), fetching: false });
    } catch (err) {
      if (cancelled) return;
      setState(s => ({ ...s, error: msg(err), fetching: false }));
    }
    if (!cancelled && watch) timer = setTimeout(run, POLL_INTERVAL_MS);
  };

  run();
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    controller?.abort();
  };
}, [kind, …opts, watch, refreshKey]);
```

Mind the portal's session semantics when polling: `SessionExpiredError` from `utils/portal` should land in the section's `error` state with the "run atip login again" hint, not crash the TUI. Keep `loadedAt` in state so a separate `now` tick can compute "X seconds ago" without re-fetching (next section).

## Live relative time without re-rendering data

Ink only repaints when state changes. To keep "12s ago" / "5m ago" labels moving between polls, hold the current time in its own state and tick it on a short interval:

```ts
const [now, setNow] = useState(() => new Date());
useEffect(() => {
  const id = setInterval(() => setNow(new Date()), 30_000);
  return () => clearInterval(id);
}, []);
```

Then format with a `formatMinutesAgo(loadedAt, now)` helper. Pick the tick by how granular the label is — 5s for a second-level label, 30s for minute-level.

## Resize

Ink doesn't expose terminal size as state. Subscribe to `stdout.on('resize', …)` and stash `rows` in component state. Read `stdout.rows` once with a fallback for non-TTY runs (tests, pipes):

```ts
const { stdout } = useStdout();
const [terminalRows, setTerminalRows] = useState(() => stdout?.rows ?? 40);
useEffect(() => {
  if (!stdout) return;
  const handler = () => setTerminalRows(stdout.rows ?? 40);
  stdout.on('resize', handler);
  return () => {
    stdout.off('resize', handler);
  };
}, [stdout]);
```

**Always put `wrap="truncate-end"` on every `<Text>` in a fixed-height layout.** Ink's resize repaint is incremental; a previously-wrapped line leaves visual artifacts. Truncation also prevents a single long row from blowing out the row math.

## Fixed-height layout with internal scroll

Don't rely on flex alone — ink's flexbox doesn't know about scroll. Build a flat `items[]` array, slice it against a computed `middleHeight`, and render explicit "(N more above ↑)" / "(N more below ↓)" affordances.

```ts
const headerLines = 2;
const footerLines = (status ? 1 : 0) + 3; // status line + toolbar (can wrap)
const indicatorReserve = 2; // the two ↑↓ hint lines
const middleHeight = Math.max(
  1,
  terminalRows - headerLines - footerLines - indicatorReserve
);

const safeScroll = Math.min(
  scrollOffset,
  Math.max(0, items.length - middleHeight)
);
const visible = items.slice(safeScroll, safeScroll + middleHeight);
```

Outer container: `<Box flexDirection="column" height={terminalRows}>`. Header/footer get `flexShrink={0}`. Middle: `flexGrow={1} flexShrink={1}`. The middle's children also need `flexShrink={0}` so ink doesn't squeeze them when the math is slightly off.

### Auto-scroll selected row into view

Tag each row with its logical `dataIndex` when building items (`null` for separators/headers). When `selectedIndex` changes, find the row's physical position and adjust `scrollOffset` minimally.

**Quirk — anchoring on the selected row alone hides a section's non-selectable header lines.** The flat `items[]` interleaves non-data lines (section title, separator, column header, blank spacers) with data rows, and those lines carry `dataIndex === null` so they are never selectable. If the up-scroll branch parks the viewport top exactly on the selected row, then landing on the _first_ row of a section pushes that section's title, separator, and column header off the top, so the columns disappear with no way to bring them back because the header lines can't be selected. Incremental up-scrolling hides the effect entirely from a naive check, because it parks the selection at `selectedLine === prev`, so a `selectedLine < prev` condition never fires on that first row.

Fix it by scrolling to a _desired top_ that includes the header block, in which you walk back over the contiguous run of non-data items directly above the selected row (`lead`) and scroll up whenever `selectedLine - lead` sits above the current top, rather than keying off the row position alone:

```ts
const selectedLine = items.findIndex(item => item.dataIndex === selectedIndex);
// Count the header/spacer lines directly above the row so they scroll into
// view with it. `lead` is 0 for interior rows, so their behaviour is unchanged.
let lead = 0;
while (
  selectedLine - lead - 1 >= 0 &&
  items[selectedLine - lead - 1].dataIndex === null
) {
  lead++;
}
const desiredTop = Math.max(0, selectedLine - lead);
setScrollOffset(prev => {
  if (desiredTop < prev) return desiredTop; // scroll up, header block included
  if (selectedLine >= prev + middleHeight)
    return selectedLine - middleHeight + 1; // scroll down
  return prev; // already visible
});
```

This is cheap — rebuilding the items list has no side effects, so doing it twice (once in the effect, once in render) is fine. Don't try to memoize across that boundary.

### Selection highlight

`<Text inverse={idx === selectedIndex}>` swaps fg/bg without forcing you to pick a background color that works on every terminal theme. Combine with `color={rowColor(…)}` for state-based foreground.

### Stable keys

Use `row.id` (or a deterministic composite like the reference number) for every item key, not array index. Ink's diff is correct either way, but stable keys make stateful components like spinners inside cells survive reorder.

## Input modes & chord keys

`useInput` is global — there's no per-component capture. Manage modes with state and bail early at the top of the handler.

**Modal disable.** When a sub-view takes over (e.g. a request-detail view over the list), gate the parent's `useInput` with `isActive`:

```ts
useInput(handler, {
  isActive: isRawModeSupported === true && watch && detailTarget === null,
});
```

`isRawModeSupported` (from `useStdin()`) is false in CI / piped runs — checking it avoids crashing when ink can't grab raw mode.

**Chord keys (`c+i`, `o+s`).** A small `useChord` hook (put it in `utils/tui/hooks/`) flips a flag for ~1.5s, and the handler checks it before the normal keymap:

```ts
const [copyChord, setCopyChord] = useChord();
…
if (copyChord) {
  setCopyChord(false);
  if (input === 'i') void copyId();
  else if (input === 'r') void copyRef();
  return;                                         // important — don't fall through
}
if (input === 'c') { setCopyChord(true); return; }
```

The hook clears its timer in the setter so a second chord-start doesn't double-fire.

**F-keys.** Ink's `Key` type doesn't include them. Match the raw escape sequence — and accept both forms because some terminals strip the leading `ESC`:

```ts
const F5_SEQUENCES = ['\x1b[15~', '[15~'];
if (F5_SEQUENCES.includes(input)) {
  refresh();
  return;
}
```

## Menus / action sheets

**Always render a menu as a bottom-anchored dropdown, never a full-screen overlay.** A menu leaves the screen it was invoked from visible above it, so the user keeps their context (the selected request, the detail they were reading). Do not replace the whole view with the menu, and do not early-return a standalone menu screen.

Build a shared **`ActionSheet`** component (`utils/tui/components/ActionSheet.tsx`) for the list itself — an optional bold title, a numbered row per option, and a `>`-prefixed green highlight on the selected row. Pass `index = -1` to draw no highlight (useful to grey the menu out while a text input has focus). The component is presentation only; the caller owns the state and the keys.

Drive selection with the same key set every menu uses, so they stay muscle-memory compatible: `↑↓` to move, `1-9` to jump, `↵` to confirm, `q` / `Esc` to cancel. Keep that state in the component (or a small hook) and gate it at the top of `useInput`, returning early so the normal keymap doesn't also fire:

```ts
// menu active? consume the key and bail before the browse keymap runs
if (menu.handleInput(input, key)) return;
```

Render the `ActionSheet` in the footer region, directly above the `Toolbar`, and swap the `Toolbar` to the menu's own key hints while it is open:

```tsx
{
  menu.options ? (
    <ActionSheet options={menu.options} index={menu.index} />
  ) : null;
}
<Toolbar items={menu.options ? MENU_TOOLBAR : BROWSE_TOOLBAR} />;
```

**Account for the menu's height in a fixed-height layout.** In the manual `middleHeight` math, the menu adds its own lines to the footer — one per option plus a title and the `marginTop`. Add those to `footerLines` while the menu is open so the scrolling middle shrinks to make room instead of overflowing:

```ts
const menuLines = menu.options ? menu.options.length + 2 : 0; // options + title + margin
const footerLines = (status ? 1 : 0) + 3 + menuLines;
```

A flex-based layout needs no such math — the `ActionSheet`'s `flexShrink={0}` and the list's `flexGrow`/`flexShrink` sort it out. When the action requires data you don't have yet (fetch a request's messages, list sessions), do the async work first, then open the menu only if there is more than one choice — a single result should act immediately without a one-item menu.

## Text input quirks (ink-text-input)

**Shift+Enter is unreliable.** Most terminals don't transmit Shift+Enter distinctly, so don't rely on it for "insert newline." Use two paths:

1. Detect modifier+Enter via `useInput`'s `key.shift/meta/ctrl` and set a `ref` flag that the submit handler consumes before treating Enter as send. The hook fires before `TextInput`'s `onSubmit`.
2. A `\` + Enter sentinel — strip the trailing `\`, append `\n`, write back to the draft. Pure character matching, works in every terminal. (Claude Code uses the same trick.)

```ts
async function submitDraft(text: string) {
  const sentinel = text.endsWith('\\');
  if (newlineReturnRef.current || sentinel) {
    newlineReturnRef.current = false;
    setDraft((sentinel ? text.slice(0, -1) : text) + '\n');
    return;
  }
  …
}
```

**Cancel in-flight submits without an abort.** Some requests aren't easily cancelable, but you can suppress the _side effects_ of a stale submit. Track a ref; flip it on Esc; check it after every await in the submit path:

```ts
const submitCanceledRef = useRef(false);
…
if (key.escape && sending) { submitCanceledRef.current = true; setSending(false); }
…
await submit(…);
if (submitCanceledRef.current) return;
```

**`focus={inputMode && !sending}`** on `<TextInput>` so the cursor disappears while a submit is in flight and reappears if it fails.

## Initial scroll position estimation

For a message-list view that should land on "latest" on first load, estimate the visible message count before the user has interacted, then offset from the end. Use a `didInitialScrollRef` to apply this once:

```ts
const didInitialScrollRef = useRef(false);
useEffect(() => {
  if (!messages) return;
  setScrollOffset(curr => {
    if (!didInitialScrollRef.current) {
      didInitialScrollRef.current = true;
      const visibleHeight = Math.max(1, terminalRows - CHROME_LINES);
      const fitCount = Math.max(
        1,
        Math.floor(visibleHeight / ESTIMATED_LINES_PER_MESSAGE)
      );
      return Math.max(0, messages.length - fitCount);
    }
    return Math.min(curr, Math.max(0, messages.length - 1)); // clamp on refresh
  });
}, [messages]);
```

`ESTIMATED_LINES_PER_MESSAGE` and `CHROME_LINES` are deliberate over-estimates — better to show one extra older message than to clip the latest.

## Spinner

A 10-frame braille sequence on an 80ms interval reads as "working." Co-locate it with the action it represents (poll header, inline next to status text, beside the text-input while posting) — a single global spinner doesn't tell the user _what_ is busy.

```ts
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
```

## Toolbar / status conventions

- Toolbar items are `{ keys, label }[]` with `keys` in cyan, label dim. `flexWrap="wrap"` so narrow terminals get a second row.
- Status messages: `{ kind: 'info' | 'error', text }`. Errors in red, info dim. One line, above the toolbar.
- Swap the toolbar set per mode (browse vs input vs menu) instead of trying to disable items.

## Checklist when building a new TUI

- [ ] Once a first TUI exists in this repo, follow its patterns before this skill's generic ones — keep the TUIs consistent with each other.
- [ ] Alt screen + `setImmediate(process.exit)` on quit (watch mode only).
- [ ] Polling hook uses `cancelled` + `AbortController` + `refreshKey`; `SessionExpiredError` renders as a status, not a crash.
- [ ] Live `now` tick for relative time labels.
- [ ] `stdout.on('resize')` → state, every Text has `wrap="truncate-end"`.
- [ ] Fixed-height container if you want internal scroll; manual `middleHeight` math.
- [ ] Tag scrollable items with `dataIndex`; auto-scroll selection, pulling a section's header block into view with its first row.
- [ ] `useInput` gated by `isRawModeSupported` and any modal flag.
- [ ] Chords via `useChord`; F-keys via raw sequence match.
- [ ] Menus are bottom-anchored `ActionSheet`s (not full-screen), driven by `↑↓`/`1-9`/`↵`/`q`/`Esc`, with the menu's lines added to `footerLines` in fixed-height layouts.
- [ ] TextInput: `\` + Enter sentinel for newline; cancel ref for in-flight submits; `focus={mode && !sending}`.
- [ ] Co-locate spinners with the action; don't share one globally.
