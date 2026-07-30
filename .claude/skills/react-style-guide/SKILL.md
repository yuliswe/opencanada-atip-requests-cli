---
name: react-style-guide
description: Conventions for ink-based React TUI code under commands/**/tui/ and utils/tui/. Apply when adding or editing TSX components, hooks, or input handlers in a TUI.
---

# TUI React Style Guide

This repo has no TUI yet; when a command grows one (e.g. a live `request sync --watch` dashboard or a portal-messages viewer), build it with ink + react and follow these conventions. Shared TUI primitives (Spinner, Toolbar, format helpers, useChord) go under `utils/tui/`; command-specific TUI code lives next to the command (e.g. `commands/request/sync/tui/`). Once TUI code exists, match what's already there before inventing.

Prerequisites the first TUI must set up: add `ink`, `react`, and (for text entry) `ink-text-input` as dependencies. `tsconfig.json` already has `"jsx": "preserve"` and eslint already loads the react/react-hooks plugins, so `.tsx` files work without config changes; the command's registration file becomes `command.tsx`.

## Hooks

**Prefer hooks for state and effects** — keep the component bodies clean and focused on rendering. The main component in each view (e.g. a `SyncDashboard`) can have some local state, but if you find yourself writing `useEffect`s to manage timers, polling, or boolean state-machines, extract a custom hook instead.

**`useEffect` is for side effects only** — data fetching, polling, subscriptions, terminal IO. Not for state-machine bookkeeping. If you find yourself writing a `useEffect` that just watches a boolean to flip another boolean, extract a custom hook backed by `useState` + `useRef` instead.

**Custom hooks live in `commands/<command>/tui/hooks/`** (or `utils/tui/hooks/` when shared). One hook per file, named export.

**Component-specific fetch hooks are top-level functions in the same file**, taking setters as arguments — they're not exported, but they keep the `useEffect` out of the component body. Pattern:

```tsx
function useRequestListFetch(
  session: Session,
  refreshKey: number,
  setRequests: (r: PortalRequestSummary[] | null) => void,
  setError: (e: string | null) => void
) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchRequestList(session);
        if (!cancelled) setRequests(result);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, refreshKey, setRequests, setError]);
}
```

Always use a `cancelled` flag in async `useEffect`s — never `setState` after unmount or after the effect re-fires.

## Keyboard input

Single `useInput` per component. Chord shortcuts (two-key sequences like `c i`, `o s`) use a `useChord` hook (see the **write-tui** skill for its behavior):

```tsx
const [copyChord, setCopyChord] = useChord(); // 1.5s default timeout

useInput((input, key) => {
  if (copyChord) {
    setCopyChord(false);
    if (input === 'i') void copyField('id');
    else if (input === 'r') void copyField('ref');
    return; // chord branch ALWAYS returns
  }
  if (input === 'c') {
    setCopyChord(true);
    return;
  }
  // ...bare keys after
});
```

Chord branches run first and return early — that's how `c r` (copy reference number) coexists with bare `r` (refresh).

## Status messages

Transient feedback uses a uniform shape:

```ts
type Status = { kind: 'info' | 'error'; text: string } | null;
```

Render dimmed for info, red for error. One status state per UI region (e.g. one near the toolbar, one in a detail-view footer). It's fine to reuse a status channel across different actions if they share a render slot.

## Component composition

Split big views into header/body/footer subcomponents. The parent owns state and passes setters down — don't lift status/refresh state into the children.

The `Toolbar` component takes `{ keys, label }[]`. Put it inside the footer or directly under the main content. Keep labels short; group related chord keys (`o s`, `o v`, `o r`).

## What not to do

- Don't add `useEffect`s that only manage timers or boolean state-machines — write a hook.
- Don't `try/catch` inside helpers just to swallow and return `null`/`false`. Let errors propagate to the boundary that has a status state to update (typically the component or the top-level fetch hook).
- Don't create new status shapes — reuse `{ kind, text } | null`.
- Don't read `process.stdin` directly; use ink's `useInput` and respect `isRawModeSupported`.
