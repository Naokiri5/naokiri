---
paths:
  - "server/src/**/*.ts"
---

# Backend conventions

- Keep Fastify handlers focused on HTTP concerns. Put reusable business logic in the owning domain module.
- Validate every external request body, query and path value at runtime with Zod (or an existing shared schema).
- Avoid duplicating parsing, validation, error mapping, provider retry logic and database helpers.
- Preserve ESM imports with `.js` suffixes and NodeNext-compatible types.
- Use the existing DB helpers and parameterized SQL. Group multi-table writes in transactions.
- Return explicit typed results and predictable errors; do not catch and silently suppress unexpected failures.
- Keep provider adapters responsible for parsing provider-specific payloads. Do not leak vendor response shapes across domain boundaries.
- Add tests at the closest domain boundary. Do not make route tests the only coverage for core business rules.
