---
name: atip-run-cli
description: How to invoke the atip CLI from this repo (entry point, sandbox, network, interactive prompts, local store).
---

# Run the ATIP CLI

Use this skill when you need to actually execute an `atip ...` command — to verify a new subcommand, inspect output, or smoke-test a change.

## Entry point

Entry file is `bin/cli.ts`.

There is no compiled binary — run it through `tsx`:

```sh
npx tsx bin/cli.ts <command> [args]
```

The user has `atip` on their PATH (via `bin/` in the repo `.zshrc`) so they invoke it as `atip ...`; from a Bash tool call use the explicit form so it doesn't depend on shell setup.

The package is ESM (`"type": "module"` in package.json). `tsx` handles ESM/CJS interop transparently.

**Sandbox gotcha:** the `tsx` CLI wrapper creates an IPC unix socket at startup, which the Claude Code sandbox denies (`listen EPERM ... .pipe`). When that happens, run through the loader API instead — same behavior, no socket:

```sh
node --import tsx bin/cli.ts <command> [args]
```

## Network access requires sandbox bypass

`search`, `orgs`, the lookup step of `informal`, and all authenticated portal calls (`login`, `login --check`, `request sync`) go over HTTPS. The sandbox blocks outbound network, and the symptom is a terse `fetch failed` (exit 1). Either run with `dangerouslyDisableSandbox: true`, or ask the user to run the command themselves with a `! atip ...` prompt.

Pure local subcommands (`--help`, `logout`, `request list/show/update/remove`, `portal`) work without network.

## Authenticated portal commands

`atip login` captures the user's ATIP Online session: the portal auth cookie is HttpOnly, so login opens the browser and reads a pasted `Cookie:` header via a hidden prompt, then stores it at `~/.atip-cli/session.json` (mode 0600). `request sync` calls the portal's `GetMyRequestsList` endpoint with that cookie and upserts the results into the tracker.

- Both need the real user session and network, so you cannot exercise them end-to-end from the sandbox — unit-test the parsing (`utils/portal.ts`) with a mocked `globalThis.fetch` instead (see `tests/portal.test.ts`).
- `SessionExpiredError` is thrown when a portal response redirects to sign-in; the CLI boundary prints "run atip login again". Don't swallow it lower down.
- The `GetMyRequestsList` JSON row shape was reverse-engineered from the rendered table; `parseRow` handles array and object rows and drops rows with no detail link. If the portal changes shape, `request sync --json` dumps the raw response for re-mapping.

## Interactive commands block from Bash

`informal`, `request new`, `request status`, and `request remove` open the browser and/or wait on readline prompts ("Press Enter when you are done in the browser"). Invoked from a non-interactive Bash call they hang until timeout. For scripted verification use the non-interactive surface instead:

- `atip request list --json` / `atip request show <ref>` — read the tracker
- `atip request update <ref> --status ... --note ...` — mutate the tracker
- `--help` on any command — check wiring and flags

## Local store isolation

Tracked requests live in `~/.atip-cli/requests.json`. When smoke-testing, point the store at a scratch directory so you don't pollute the user's real tracker:

```sh
ATIP_CLI_HOME="$TMPDIR/atip-smoke" node --import tsx bin/cli.ts request list
```

## Quick verification recipe

After wiring up a new subcommand:

```sh
# 1. Typecheck + lint + tests (no network needed; jest runs with watchman off)
npm run build
npx eslint .
npm test

# 2. Show help (no network needed)
node --import tsx bin/cli.ts <parent> <new-command> --help

# 3. Real run (network → sandbox bypass or hand to the user; use a scratch store)
ATIP_CLI_HOME="$TMPDIR/atip-smoke" node --import tsx bin/cli.ts <command> [args]
```
