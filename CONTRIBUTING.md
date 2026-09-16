# Contributing

Thanks for helping improve typefully-cli. Issues and pull requests are welcome.

## Setup

```bash
git clone https://github.com/BrainGridAI/typefully-cli
cd typefully-cli
pnpm install
pnpm dev -- --help          # run from source
```

Requires Node.js 18+ and pnpm 10.

## Before you open a PR

```bash
pnpm check                  # typecheck + tests + build
```

- Keep the client (`src/api/client.ts`) free of CLI concerns; commands live in `src/commands/`.
- Every command should work in `-o json` mode for scripting, and print something readable on a TTY.
- Never send a request the user did not ask for: mutating commands must be explicit, and
  publishing (`--schedule now`, `drafts publish`) must never be a default.
- Add or update a test in `test/` for behavior changes. Tests never hit the network; inject `fetch`
  as in `test/client.test.ts`.
- Do not commit API keys. `.env` files are git-ignored; `.env.example` holds placeholders only.

## Reporting bugs

Include the command you ran, the output with `--debug` (redact your key), and the CLI version
(`typefully --version`).

## Releasing (maintainers)

1. Update `CHANGELOG.md` and bump `version` in `package.json`.
2. `pnpm check`
3. Commit, tag `vX.Y.Z`, push with tags.
4. `pnpm publish` (scoped package, public access).
5. Create the GitHub release from the tag with the changelog entry.
