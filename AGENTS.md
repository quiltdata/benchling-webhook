# Repository Guidelines

## Project Structure & Module Organization
- `bin/` contains the CDK entry point and helper scripts; start from `bin/benchling-webhook.ts` when adding new stacks or app wiring.
- `lib/` holds the CDK constructs, Step Function definitions, and Lambda handlers (`lib/lambda/*.ts`); keep shared constants in `lib/constants.ts` and types in `lib/types.ts`.
- `lib/lambda/verify-webhook.ts` enforces Benchling's signature and timestamp checks before the Step Function runs; update this when the verification contract changes.
- `lib/templates/` stores JSON/Lambda templates and `lib/README.md` expands on the architecture.
- `test/` includes Jest specs (`*.test.ts`) and sample Benchling payloads used as fixtures; prefer adding new fixtures beside related tests.

## Build, Test, and Development Commands
- `npm install` sets up dependencies; run after cloning or updating lockfiles.
- `npm run lint` applies the ESLint ruleset (TypeScript + Node); use before committing to catch style regressions.
- `npm run test` executes the Jest suite with `ts-jest`; include its output in pull requests when relevant.
- `npm run clean` clears generated JS and `cdk.out`; use when switching branches to avoid stale artifacts.
- `npm run cdk` runs tests then deploys via `cdk deploy --require-approval never`; prefer `npx cdk synth` or `npx cdk diff` locally before invoking full deploys.

## Coding Style & Naming Conventions
- TypeScript code uses 4-space indentation, double quotes, trailing commas, and required semicolons per `eslint.config.js`.
- Avoid `any` in production code; tests may use it where helpful. Always spell out explicit return types on exported functions.
- Name Lambda handlers `<action>-<context>.ts` (e.g., `process-export.ts`); keep shared utilities in `lib/` root rather than duplicating in handlers.

## Testing Guidelines
- Write focused Jest tests in `test/` mirroring the module under test (e.g., `api-gateway.test.ts`).
- Reuse payload fixtures in `test/*.json` to simulate webhook flows; document new fixtures inline.
- Aim for meaningful coverage on new Step Function branches and Lambda logic; justify gaps in the PR description.
- Run `npm run test` before requesting review; add `--watch` locally when iterating.

## Commit & Pull Request Guidelines
- Follow the existing Conventional Commit style (`type(scope): summary`), as seen in recent `chore(deps)` and `fix(deps)` commits; capitalize only when necessary.
- Keep commits focused on one logical change and update `package-lock.json` when dependencies shift.
- Pull requests should include: a concise summary, testing notes (`npm run test` output or reasoning), any deployment considerations, and linked issues or tickets.
- Add screenshots or CLI output when touching user-visible behavior or infrastructure diagrams.

## Security & Configuration Tips
- Store AWS and Benchling secrets only in local `.env`; never commit credentials or generated artifacts from deployments.
- Verify environment variables match the values expected by `README.md` before running CDK commands to avoid provisioning into the wrong account.
