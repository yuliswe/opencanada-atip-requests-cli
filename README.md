# ATIP CLI

Manage your Canadian access-to-information (ATIP) requests from the terminal.
Stop losing track of request numbers in email threads and re-navigating the
portal every time.

- 🔎 **Search completed ATI requests** on open.canada.ca straight from the
  terminal — by keyword, institution, year, or month.
- 🆓 **Get records for free** — if someone already obtained the records you
  want, an informal request costs nothing; the CLI finds the record and opens
  the request form for you.
- 📝 **File formal requests** — the CLI walks you through ATIP Online and
  records the request number when you are done.
- 🔁 **Sync live status from ATIP Online** — after a one-time browser sign-in,
  the CLI reads your open requests and their status straight from the portal.
- 📋 **Track every request locally** — status, notes, and dates live in a
  local JSON file, which matters because ATIP Online deletes responses two
  years after completion.
- 🌐 **Browser hand-off for the rest** — anything without a public API
  (the $5 fee, web forms, new-request wizard) opens in your browser, and
  the CLI continues once you confirm the step is done.

## Requirements

- **MacOS** (browser hand-off also has Linux/Windows openers, but only MacOS
  is tested)
- **zsh** with the repo `.zshrc` sourcing set up (see
  [Start development](#start-development)) so `atip` is on your `PATH`
- No accounts or API keys for searching — the open.canada.ca CKAN API is
  public and read-only. Formal requests need an ATIP Online account
  (Sign-In Canada / CanadaLogin), created in the browser.

## What the CLI can and cannot automate

**Automated via API** — searching completed request summaries, listing
institutions, and looking up records (read-only CKAN datastore on
open.canada.ca).

**Authenticated via captured session** — reading your own requests and their
live status. ATIP Online has no public API and a browser-only Sign-In Canada /
CanadaLogin flow, so `atip login` has you sign in once and paste the session
cookie; the CLI then calls the portal's own endpoints with it (see
[Managing your own requests](#managing-your-own-requests-authenticated)).

**Browser hand-off** — submitting requests (formal or informal) and paying the
$5 application fee (Moneris). The CLI prints the steps, opens the page, waits
for you to finish, then records the outcome locally.

## Setup

```sh
# 1. One-time repo setup (provisions Node into .nodevenv — see
#    "Start development" below)
./initenv.bash

# 2. Start a new terminal session in the repo. The repo .zshrc activates the
#    toolchain and puts bin/atip on your PATH.
atip --help
```

## Usage

```sh
atip <command> [options]
```

Tracked requests are stored in `~/.atip-cli/requests.json` (override the
directory with `ATIP_CLI_HOME`).

## Commands

### search

Search summaries of completed ATI requests published on open.canada.ca
(January 2020 onward). Anything you find can be re-requested for free with
`atip informal`.

```sh
atip search immigration processing times   # Full-text search
atip search backlog -o cic                 # Only one institution (slug from `atip orgs`)
atip search -o ircc-cisr -y 2025 -m 6      # Everything an institution published in a month
atip search housing -l 50                  # More results (default 25)
atip search housing --offset 25            # Next page
atip search santé --fr                     # Show French summaries
atip search housing --json                 # Raw records for scripting
```

### orgs

List the institution slugs that `search -o` and `informal -o` accept.

```sh
atip orgs               # All institutions on the open government portal
atip orgs immigration   # Filter by slug or title
```

### informal

Request a free copy of the records of a completed ATI request. The CLI looks
the record up via the API, opens the "Request a copy of records" form in the
browser, and tracks the request locally after you confirm you submitted it.

```sh
atip informal A-2023-02215           # Request number from `atip search`
atip informal A-2023-02215 -o cic    # Disambiguate when several institutions share the number
atip informal A-2023-02215 --no-track  # Don't record it in the local tracker
```

### request

Track your own requests (formal and informal). `<ref>` is the tracker ID
shown by `list`, or the portal request number.

```sh
atip request new                            # Submit a formal request via the browser, then track it
atip request new -i "Health Canada" -s "…"  # Pre-fill institution and summary

atip request list                           # All tracked requests
atip request list --status records-ready    # Filter by status
atip request list --json                    # Raw records for scripting
atip request show 1                         # Full detail, including notes

atip request status 1                       # Re-check on the portal, record what you see
atip request sync                           # Pull live status for all requests (needs `atip login`)
atip request update 1 --status acknowledged --note "Email received"
atip request update 1 --number A-2026-00123 # Fill in the number once assigned
atip request remove 1
```

Statuses: `submitted`, `acknowledged`, `in-progress`, `extended`,
`records-ready`, `completed`, `abandoned`.

`request new` is a browser hand-off: submission needs Sign-In Canada /
CanadaLogin and (for formal ATI requests) the $5 Moneris payment, neither of
which has an API. `request status` is the manual, no-login way to record a
status you read yourself; `request sync` is the automated version once you have
run `atip login`. Download released records promptly — ATIP Online retains them
for only two years after completion, so the local tracker plus your downloads
are the durable copy.

## Managing your own requests (authenticated)

`atip request sync` reads your open requests and their live status directly
from ATIP Online. Because the portal has no public API and its Sign-In Canada /
CanadaLogin flow (with MFA) cannot be automated, you sign in once in the
browser and hand the CLI your session:

```sh
atip login          # Opens the portal; paste your session cookie once (hidden input)
atip login --check  # Verify the stored session still works
atip request sync   # List live requests, updating the local tracker in place
atip request sync --json   # Raw portal response, if you want to script against it
atip logout         # Delete the stored session
```

How `atip login` works and why:

- The portal authenticates with an **HttpOnly `.AspNetCore.Cookies` session
  cookie**, which by design no script can read. So you copy it once: after
  signing in, open your browser's DevTools → Network tab, click any request to
  `atip-aiprp.tbs-sct.gc.ca`, and copy the whole `Cookie:` request header.
- The cookie is stored at `~/.atip-cli/session.json` with `0600` permissions
  (owner read/write only). It is never sent anywhere except back to
  `atip-aiprp.tbs-sct.gc.ca`.
- Portal sessions are short-lived. When yours lapses, `sync` tells you to run
  `atip login` again. (Automatic renewal via a managed browser profile is
  planned; see the code comments in `utils/portal.ts`.)

`request sync` keys on the portal's internal request id, so re-running it
updates existing tracked requests in place and appends a note whenever a
status changes, rather than creating duplicates.

### portal

Open ATIP Online (atip-aiprp.tbs-sct.gc.ca) in the browser.

```sh
atip portal
```

## Data sources and portals

- Search: `datastore_search` on the [Completed Access to Information Request
  Summaries dataset](https://open.canada.ca/data/en/dataset/0797e893-751e-4695-8229-a5066e4fe43c)
  (resource `19383ca2-b01a-487d-88f7-e1ffbc7d39c2`).
- Informal requests: the form embedded on each record page of the
  [ATI search](https://open.canada.ca/en/search/ati).
- Formal requests: [ATIP Online](https://atip-aiprp.tbs-sct.gc.ca/en), whose
  submission flow is browser-only.
- Live request status: ATIP Online's own `GetMyRequestsList` and
  `YourRequestDetails` endpoints, called with your captured session cookie by
  `atip request sync`.
- Note that IRCC (immigration) requests are filed on IRCC's own portal, not
  ATIP Online; you can still track them here with `atip request new`.

# Start development

## MacOS

If you are setting up the repo for the first time, following these steps:

1. Make sure your ~/.zshrc file has the following lines:

```
   # Source .zshrc from current directory if it exists
   [ "$PWD" != "$HOME" ] && [ -f "$PWD/.zshrc" ] && source "$PWD/.zshrc"
```

2. Run the following commands: (You only need to do this once.)

```
   ./initenv.bash
```

3. Start a new terminal session.

# Toolchain

The template provisions its own toolchain, so that nothing needs to be installed
globally except Python, Poetry, and Homebrew. The versions below are what the
template currently pins in `package.json` and `pyproject.toml`.

| Tool          | Version    | Role                                                       |
| ------------- | ---------- | ---------------------------------------------------------- |
| Node.js       | latest LTS | Runtime, provisioned into `.nodevenv` by nodeenv           |
| npm           | bundled    | Package manager that ships with the provisioned Node       |
| nodeenv       | ^1.10.0    | Creates the local Node environment, installed via Poetry   |
| Python        | >=3.10     | Required by Poetry to run nodeenv                          |
| TypeScript    | ^6.0.3     | Type checking (`tsc --noEmit`)                             |
| tsx           | ^4.23.1    | Runs TypeScript directly during development                |
| ESLint        | ^9.39.5    | Linting, configured through the flat `eslint.config.js`    |
| Jest          | ^30.4.2    | Test runner, transforming sources with `esbuild-jest`      |
| Prettier      | ^3.9.6     | Code formatting, checked by the pre-commit hook            |
| nodemon       | ^3.1.14    | Restarts the app on file changes (`npm start`)             |
| dotenv-linter | latest     | Lints `.env` files, installed with Homebrew at postinstall |

ESLint stays on the 9.x line because eslint-plugin-import, eslint-plugin-react,
and eslint-plugin-react-native do not yet support ESLint 10. TypeScript stays on
the 6.0.x line because typescript-eslint does not yet support a newer compiler.
