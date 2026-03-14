# Development and maintenance

This file is for maintainers and is **not** shipped in the npm package (only `dist` is published via the `files` array in `package.json`).

## Prerequisites
- Node 18+ (for built-in `fetch`).
- npm CLI; log in with an account that has publish rights if you plan to release.

## Local setup
```bash
npm install
npm run build
npm test
```
- `npm run build` compiles TypeScript to `dist`.
- `npm test` rebuilds and runs the Node test suite under `dist/__tests__`.

## Release (recommended: automated)
1. Configure npm trusted publishing for `@edwardcoventry/json-stream-lib` and the GitHub repository workflow `.github/workflows/release.yml`.
2. Bump and tag: `npm version patch|minor|major` to update the package version and create `vX.Y.Z`.
3. Push the tag: `git push origin main --follow-tags` (or `git push origin vX.Y.Z`).
4. The `Release` workflow installs dependencies, runs `npm test`, and publishes with npm trusted publishing via GitHub OIDC. No long-lived `NPM_TOKEN` secret is required.

## Release (manual fallback)
1. Ensure you are authenticated locally: `npm whoami` / `npm login`.
2. Bump version: `npm version patch|minor|major`.
3. `npm test`.
4. Optional sanity check: `npm pack --dry-run` (only `dist` should ship).
5. Publish: `npm publish --access public`.
6. `git push && git push --tags` to align tags.

## Notes
- Examples and docs live under `examples/` and `docs/`; they are not published to npm because the package only includes `dist`.
- If you add new entry points, remember to export them from `src/index.ts` and update `package.json#exports` as needed.
- Standard GitHub-hosted Actions runners are free on public repositories. If the repo is private, Actions usage falls back to the account's private-repo billing/quota.
