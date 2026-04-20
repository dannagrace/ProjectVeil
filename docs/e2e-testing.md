# E2E Testing

Project Veil now keeps every Playwright slice in a single [`/Users/grace/Documents/project/codex/ProjectVeil/playwright.config.ts`](/Users/grace/Documents/project/codex/ProjectVeil/playwright.config.ts) and switches execution shape with `--project=...`.

## Projects

- `full`: default H5 end-to-end suite
- `smoke`: lobby, onboarding, campaign, daily quest, and seasonal smoke coverage
- `h5-connectivity`: HTTP + websocket connectivity probes
- `multiplayer`: multiplayer, reconnect, replay, and ranked coverage
- `multiplayer-smoke`: compact multiplayer smoke slice
- `release-candidate-artifact-smoke`: packaged H5 artifact smoke against `vite preview`

Running raw `playwright test` now resolves to the `full` project. Every other slice should be called with `--project=...`.

## Common Commands

```bash
# Default end-to-end suite
npm test -- e2e

# H5 smoke gate
npm test -- e2e:smoke

# Golden path smoke only
npm test -- e2e:golden-path

# Multiplayer full suite
npm test -- e2e:multiplayer

# Multiplayer smoke slice
npm test -- e2e:multiplayer:smoke

# H5 connectivity probe
npm test -- e2e:h5:connectivity

# Packaged release candidate artifact smoke
VEIL_PLAYWRIGHT_CLIENT_MODE=preview npx playwright test --project=release-candidate-artifact-smoke --reporter=json
```

## Direct Playwright Usage

Use direct Playwright invocations when you need a one-off spec or CLI flag:

```bash
npm run validate -- e2e:fixtures
npx playwright test --project=smoke tests/e2e/golden-path-player-journey.spec.ts
npx playwright test --project=multiplayer --grep "PVP matchmaking lifecycle"
```

## CI Guidance

CI should call Playwright with explicit project names instead of legacy config files. Current workflows use:

- `npx playwright test --project=smoke`
- `npx playwright test --project=multiplayer-smoke`
- `npx playwright test --project=multiplayer`
- `npx playwright test --project=h5-connectivity`

If you add another end-to-end slice, extend `projects` in the shared config and wire the caller to `--project=<name>` instead of creating a new config file.

The release-candidate artifact slice is the only project that swaps the client webServer to `vite preview`. Use `VEIL_PLAYWRIGHT_CLIENT_MODE=preview` for that path, or call the higher-level packaged smoke script.
