---
paths:
  - "web/src/**/*.ts"
  - "web/src/**/*.tsx"
---

# Frontend conventions

- Use `web/src/api.ts` for REST calls, authorization/CSRF behavior, SSE, polling hooks and shared number/time formatting.
- Use `web/src/ui.tsx` for shared display primitives before adding a new reusable component.
- Keep route pages responsible for composition and page state; extract cohesive panels, tables and hooks when a page becomes difficult to navigate or test.
- Do not duplicate fetch/loading/error logic in individual screens when `useApi` fits.
- Keep API response types close to the client contract or in a shared contract module if multiple pages use them.
- Preserve accessible labels, keyboard behavior, loading/error states and responsive layouts.
- Do not move domain/risk decisions into client-side UI logic. The server remains authoritative.
