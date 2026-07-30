# opencanada-atip-requests-cli

A CLI (`atip`) for managing Canadian access-to-information (ATIP) requests.
Everything that has a public API is automated through the read-only CKAN API of
open.canada.ca, which requires no key. Every step that has no API — signing in
to ATIP Online, paying the $5 application fee, submitting web forms, reading
request status — is handed to you in the browser, and the CLI continues once
you confirm the step is done.

## Usage

Run commands with `atip` (added to `PATH` by `.zshrc`) or `npm run cli --`.

```
# Find completed ATI requests published on open.canada.ca
atip search immigration processing times
atip search backlog -o cic -y 2025 -l 5
atip orgs immigration            # look up institution slugs for -o

# Ask for a free copy of records someone else already obtained. The CLI finds
# the record, opens the "Request a copy of records" form in the browser, and
# tracks the request locally after you submit it.
atip informal A-2023-02215 -o cic

# File a new formal request. The portal part (sign-in, institution, $5 fee)
# happens in the browser; the CLI then records the request number you got.
atip request new

# Track your requests locally. ATIP Online only retains responses for two
# years after completion, so the local tracker is the durable copy.
atip request list
atip request show 1
atip request status 1            # re-check on the portal, record what you see
atip request update 1 --status records-ready --note "Email received"
atip request remove 1

# Open ATIP Online directly
atip portal
```

Tracked requests are stored in `~/.atip-cli/requests.json` (override the
directory with `ATIP_CLI_HOME`).

### Data sources and portals

- Search: `datastore_search` on the [Completed Access to Information Request
  Summaries dataset](https://open.canada.ca/data/en/dataset/0797e893-751e-4695-8229-a5066e4fe43c)
  (resource `19383ca2-b01a-487d-88f7-e1ffbc7d39c2`).
- Informal requests: the form embedded on each record page of the
  [ATI search](https://open.canada.ca/en/search/ati).
- Formal requests and status: [ATIP Online](https://atip-aiprp.tbs-sct.gc.ca/en),
  which is browser-only.
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
