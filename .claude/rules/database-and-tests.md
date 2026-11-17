---
paths:
  - "server/src/db/**/*.ts"
  - "server/test/**/*.ts"
  - "e2e/**/*.ts"
---

# Database and test rules

- SQLite schema changes are append-only migrations. Test upgrades from the previous schema and preserve existing data.
- Use the shared DB/test setup in `server/test/helpers.ts`; do not create a second fixture framework without a demonstrated need.
- Tests must be deterministic and offline by default. Live-provider tests remain explicitly opt-in.
- Use fixed timestamps, seeded synthetic data and isolated database state. Avoid tests whose result depends on network access or wall-clock timing.
- Test positive, negative, stale, missing-data and idempotency cases for safety-sensitive behavior.
- Prefer focused tests for domain logic, plus API/e2e tests for integration and visible user flows.
- Never weaken or delete a failing test simply to make CI green; diagnose the behavior and update expectations only when the intended contract changed.
