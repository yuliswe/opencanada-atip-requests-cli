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
