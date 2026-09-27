# Repository Guidelines

## Project Structure & Module Organization

This repository contains Autumn Context Bridge, a VS Code extension that sends file and selection references to Claude Code and Codex CLI terminals.

- `src/extension.ts`: activation and command registration.
- `src/terminalDetector.ts`: terminal discovery and manual designation.
- `src/contextSender.ts`: path resolution and reference delivery.
- `src/statusBar.ts`: status bar integration.
- `src/matching.ts`: pure terminal-matching, path, and line-reference helpers.
- `src/__tests__/`: unit tests; `resources/`: extension icon and README screenshots.
- `package.json`: extension commands, menus, keybindings, settings, and scripts.
- `dist/`: generated bundles; do not commit build output or `.vsix` packages.

## Build, Test, and Development Commands

Use Node.js 24 (`.nvmrc`) and run `npm install` first.

- `npm run build`: bundle to `dist/extension.js` with source maps.
- `npm run watch`: rebuild automatically during development.
- `npm run launch`: build and open an Extension Development Host; requires the `code` CLI. VS Code's `F5` debug configuration also builds and launches it.
- `npm test`: run Vitest once.
- `npm run test:watch`: rerun tests interactively.
- `npm run build:prod`: create a minified production bundle.
- `npm run package`: build production output and create an installable `.vsix`.

## Coding Style & Naming Conventions

Follow existing TypeScript style: two-space indentation, single quotes, semicolons, and trailing commas in multiline lists. Use camelCase for files, functions, and variables; PascalCase for classes; and UPPER_SNAKE_CASE for constants. TypeScript strict mode is enabled. No formatter or linter is configured.

Keep pure helpers independent of `vscode`. Register new commands in both `package.json` and `src/extension.ts`, using the `autumnContextBridge.` prefix.

## Testing Guidelines

Use Vitest with `src/__tests__/**/*.test.ts`. Group cases with `describe` and give `it` blocks descriptive behavior names. Current tests cover pure helpers; no coverage threshold is configured. Add regression cases for matching, invalid regex, multi-root paths, and line ranges when relevant.

Before submitting, run `npm test` and `npm run build`. Manually verify changed terminal, selection, menu, and status bar behavior in the Extension Development Host. Preserve reference insertion without automatically pressing Enter.

## Commit & Pull Request Guidelines

History mixes imperative summaries with Conventional Commits, including `chore:` and `docs(readme):`. Prefer concise, imperative messages with a relevant type or scope. Keep changes focused.

PRs should explain the behavior change, link related issues, and report automated and manual validation. Include screenshots for visible UI changes and update `README.md` when commands, settings, or user-facing behavior change.
