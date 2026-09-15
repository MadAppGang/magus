---
name: ui-playwright
description: Writes Playwright UI tests — role locators, page objects, fixtures, network stubs, snapshot policy, one test per Storybook story state. Use when testing a screen, component, or user flow in a browser.
---

# UI tests with Playwright

Objective: a UI test suite that fails when a user-visible behaviour breaks and stays green
across runs. The contract is the Storybook story set and the spec; the implementation is
not an input.

## Inputs and outputs

| Input | Where it comes from |
|---|---|
| Story files (`*.stories.tsx`) | `CONTRACT_PATHS` — every exported story is a state to test |
| Spec | `SPEC_PATH` — flows, error text, limits |
| Test dir and config | `TEST_DIR`, `playwright.config.*` if present |

Output: `*.spec.ts` files under `TEST_DIR`, a `playwright.config.ts` if none exists, page
objects under `TEST_DIR/pages/`, fixtures under `TEST_DIR/fixtures/`.

## Workflow

1. **Map stories to tests.** For each story export write one test named
   `<Component> · <story> · <expected outcome>`. A story with no test is a gap; a test
   with no story or spec line is an implementation test — delete it.
2. **Locate by role, then label, then test id.** `getByRole('button', { name: 'Save' })`
   first; `getByLabel`, `getByText` next; `getByTestId` only when the element has no
   accessible name, and then record the id as a contract the component must keep. Never
   locate by CSS class or DOM position.
3. **Page objects for flows, not for single components.** A page object exposes actions
   (`login(user)`, `openOrder(id)`) and readable state (`errorText()`); it holds locators,
   nothing else. Component tests call the component directly through `@playwright/experimental-ct-react`
   (or the framework's CT package) with props from the story.
4. **Fixtures own setup and teardown.** Auth, seeded data, and viewport live in
   `test.extend` fixtures; a test body is arrange-act-assert only.
5. **Stub the network at the boundary.** `page.route()` for third-party and backend
   calls in component and flow tests; assert the request shape when the spec defines it.
   E2E tests against a real backend run in a separate project with its own tag.
6. **Assert observable outcomes.** Rendered text, `toBeVisible`, `toHaveValue`,
   `toHaveAttribute('aria-invalid', 'true')`, URL, emitted network request. Never assert
   on internal state, store shape, or that a handler was called.
7. **Snapshots are for layout regressions only.** One `toHaveScreenshot()` per story
   state, `maxDiffPixelRatio` set explicitly, masks for dates and avatars, stored per
   platform. A snapshot never replaces a behavioural assertion.
8. **Every state from the guardrails is a test.** Default, hover, focus, disabled,
   loading, invalid, empty — if the story exists, the test exists; if the story is
   missing, report it as a contract gap rather than skipping the state.

## Flake control

- Web-first assertions only (`expect(locator).toBeVisible()`); no `waitForTimeout`.
- `test.describe.configure({ mode: 'serial' })` only for flows that share a server-side
  state, and say why in a comment.
- `retries: 0` locally, `retries: 1` in CI with `trace: 'on-first-retry'`; a test that
  needs the retry is filed as a bug, not left green.
- Fixed viewport, fixed locale and timezone in the config; freeze `Date` through the
  fixture when the UI renders time.

## Config for CI

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'on-first-retry', locale: 'en-US', timezoneId: 'UTC', viewport: { width: 1280, height: 800 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'bun run dev', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI },
});
```

Run headless with `bunx playwright test`; `bunx playwright install --with-deps chromium`
once per CI image.

## Verification before done

- Every story export appears in a test name (grep the stories dir against `TEST_DIR`).
- `bunx playwright test` passes twice in a row locally.
- Negative control: change one expected string in one test, watch it fail, restore it.
