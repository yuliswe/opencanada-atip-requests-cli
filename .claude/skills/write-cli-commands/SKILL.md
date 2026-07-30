---
name: write-cli-commands
description: Load when writing or changing a CLI command / subcommand / options.
---

# Writing CLI Commands

The CLI is built with [commander](https://github.com/tj/commander.js). Entry point: `bin/cli.ts`. Commands live under `commands/`.

## Command syntax (what users type)

Supported invocations:

- `atip <command> [opts] [args]` — top-level command (`search`, `login`, `informal`, …)
- `atip <group> <command> [opts] [args]` — grouped command, two levels deep (`request sync`, `session refresh`)

Discouraged:

- `atip <group> <subgroup> <command>` — three levels is too many. Promote the subgroup to its own top-level group, or fold its commands back into the parent group.

## Folder layout

Every group and every command is its own directory under `commands/`. Each directory contains exactly one registration file — `group.ts` for a group, `command.ts` for a command — alongside any helpers private to it:

- `atip <command>` (top-level) → `commands/<command>/command.ts`
- `atip <group> <command>` → `commands/<group>/<command>/command.ts`
- Group registration (wires up a group's commands) → `commands/<group>/group.ts`
- Support files private to a command → siblings of `command.ts` inside the command's own directory
- Common support files shared across commands → `utils/<helper>.ts`

Example tree:

```
commands/
  search/
    command.ts                # atip search
  request/
    group.ts                  # atip request (group registration)
    sync/
      command.ts              # atip request sync
    show/
      command.ts              # atip request show
  session/
    group.ts                  # atip session
    refresh/
      command.ts              # atip session refresh
bin/cli.ts                    # imports each top-level group/command
utils/                        # shared across commands (portal, store, session, render, …)
```

## The factory pattern

Each registration file exports a factory function. The convention distinguishes the two roles at a glance:

| File         | Factory name                            | Commander import                                      |
| ------------ | --------------------------------------- | ----------------------------------------------------- |
| `command.ts` | `createXxxCommand(): Command`           | `import { Command } from 'commander'`                 |
| `group.ts`   | `createXxxCommandGroup(): CommandGroup` | `import { Command as CommandGroup } from 'commander'` |

`CommandGroup` is just commander's `Command` aliased — same type at runtime, but the alias makes group-registration code self-documenting (you can tell a group from a leaf without reading the body).

**Group registration** (`commands/request/group.ts`):

```ts
import { Command as CommandGroup } from 'commander';
import { createListCommand } from '@/commands/request/list/command';
import { createSyncCommand } from '@/commands/request/sync/command';

export function createRequestCommandGroup(): CommandGroup {
  const requestCommand = new CommandGroup('request').description(
    'Track your own ATIP requests (formal and informal)'
  );
  requestCommand.addCommand(createListCommand());
  requestCommand.addCommand(createSyncCommand());
  return requestCommand;
}
```

**Leaf command** (`commands/request/show/command.ts`):

```ts
import { Command } from 'commander';
import { print } from '@/utils/render';
import { loadStore, requireRequest } from '@/utils/store';

export function createShowCommand(): Command {
  return new Command('show')
    .description('Show one tracked request, including notes')
    .argument('<ref>', 'Tracker ID or request number')
    .action((ref: string) => {
      const request = requireRequest(loadStore(), ref);
      print(`#${request.id} (${request.kind})`);
      // …
    });
}
```

Register a new top-level group or command in `bin/cli.ts` (sorted alphabetically among the `program.addCommand(...)` calls, imports likewise). `bin/cli.ts` imports each factory directly — e.g. `import { createRequestCommandGroup } from '@/commands/request/group'`. Inside a `group.ts`, keep the `addCommand` calls alphabetical too.

## Argument & option conventions

- Use `.argument('<required>')` / `.argument('[optional]')` for positionals; variadic keywords as `.argument('[keywords...]')` joined with a space in the action.
- `--json` prints machine-readable output (`JSON.stringify(..., null, 2)`) and returns before any human-oriented rendering. Add it to any command whose output someone might script against.
- Number-valued options arrive as strings — parse with the `parsePositiveInt(value, label)` helper pattern (see `commands/search/command.ts`): `Number.parseInt(..., 10)`, validate `Number.isFinite(n) && n > 0`, then `printErr` + `process.exit(1)` on bad input.
- Common short flags in use: `-o, --org <orgSlug>` (institution slug, pairs with `atip orgs`), `-l, --limit <n>`, `-y, --year`, `-m, --month`. Reuse them for the same concepts rather than inventing new spellings.
- Action signature: `(positional1, …, options) => …`. Type `options` inline or as a local `type XxxOptions`.

## Inside the action

- **Output**: `print` / `printErr` from `@/utils/render` — never bare `console.log`. For output that can exceed a screenful, build a `lines: string[]` array and hand it to `printLongOutput(lines)`, which pages through `$PAGER`/`less -R` when on a TTY and past the threshold.
- **Errors**: validation failures the user can fix get `printErr(...)` + `process.exit(1)` with a hint of the correct usage. Everything else throws and propagates — `bin/cli.ts` has the single catch that prints the message (plus `cause` for fetch failures) and exits 1. Don't add try/catch inside commands or helpers.
- **Local tracker**: read/write through `@/utils/store` (`loadStore`, `requireRequest`, `upsertPortalRequest`, …). The store location honors `ATIP_CLI_HOME`; never hardcode `~/.atip-cli`.
- **Portal (authenticated) calls**: `loadSession()` from `@/utils/session` first; if it returns nothing, `printErr('No ATIP Online session. Run "atip login" first.')` + exit 1. Then call helpers in `@/utils/portal` — HTML parsing and `SessionExpiredError` live there, not in command files.
- **Open-data (CKAN) calls**: helpers in `@/utils/ckan`; raw HTTP goes through `@/utils/fetchWithTimeout`.
- **Interactive steps**: readline prompts via `@/utils/prompt`, browser handoff via `@/utils/browser`. Keep commands non-interactive unless the flow genuinely needs the user in a browser, and note interactive commands in the **run-cli** skill's "interactive commands" list.
- Use `chalk` for color when it aids scanning (`chalk.bold` for identifiers, `chalk.dim` for metadata/legends, `chalk.green`/`chalk.yellow` for new/changed markers); don't over-decorate.

## TUIs

No command has an interactive dashboard yet. If one grows one (ink + react):

- `command.tsx` (in the command's directory) handles flag parsing + `render(<Dashboard …/>)`, nothing else.
- Components, hooks, constants, formatters live as siblings of `command.tsx` inside the same directory (e.g. `commands/<group>/<command>/tui/components/Dashboard.tsx`), imported with relative paths like `./tui/components/Dashboard`.
- Reusable ink primitives (Spinner, Toolbar, format helpers, useChord) go in `utils/tui/`, not next to any specific command.
- Switch to the alternate screen buffer for full-screen TUIs.
- See the **react-style-guide** and **write-tui** skills for component conventions and setup prerequisites.

## Checklist when modifying a command

- [ ] Create `commands/<group>/<command>/command.ts` (or `commands/<command>/command.ts` for top-level), exporting `createXxxCommand(): Command`.
- [ ] Register it in `commands/<group>/group.ts`, or in `bin/cli.ts` for a new top-level command/group — alphabetically.
- [ ] If it's a new group, create `commands/<group>/group.ts` exporting `createXxxCommandGroup(): CommandGroup` (alias commander's `Command` as `CommandGroup`), and register the group in `bin/cli.ts`.
- [ ] Factor shared logic into `utils/` rather than copy-pasting between commands; unit-test parsing/logic in `tests/<util>.test.ts` with `globalThis.fetch` mocked (see `tests/portal.test.ts`).
- [ ] Run `npm run build` (tsc), `npx eslint .`, and `npm test`.
- [ ] Update `README.md` with a usage example under the relevant `## Commands` subsection.
- [ ] Verify with the **run-cli** skill's recipe (`node --import tsx bin/cli.ts <command> --help`, scratch `ATIP_CLI_HOME` for real runs).
