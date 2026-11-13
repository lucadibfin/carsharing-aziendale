# AGENTS.md — API (NestJS 12)

## NestJS

This app's version of NestJS is likely newer than what you know. https://docs.nestjs.com/llms.txt indexes its documentation.

- Nest's packages are ESM only, and this project is ESM too: relative imports end in `.js`, `__dirname` doesn't exist (use `import.meta.dirname`), and tests run on Vitest (`vi.fn()`, not `jest.fn()`).
- Validation uses Zod schemas from `@fcs/shared` via `StandardSchemaValidationPipe` (`@Body({ schema })`, `@Param('id', { schema })`, `@Query({ schema })`).
- Prisma 7: client generated into `src/generated/prisma` (`npm run prisma:generate`), driver adapter `@prisma/adapter-pg`, config in `prisma.config.ts`.
- Dev DB: `npm run db:start` (PostgreSQL embedded, no Docker). Tests start their own throwaway embedded PostgreSQL (`test/global-setup.ts`).

## Privacy constraints (GDPR) — mandatory

- **Do NOT add any third-party telemetry, APM, error tracking or analytics** (e.g. NestJS Observe, Sentry SaaS, Datadog). Data and logs must stay on the company infrastructure in the EU. Every external service must be listed in `PRIVACY.md` and approved by the DPO.
- Never log request bodies, cookies, credentials, personal names, phone numbers or chat text. Users appear in logs only as HMAC pseudonyms.
- Passwords are used only inside `AuthService.login` → `IdentityProvider.authenticate`; never store, log, cache or include them in errors.
- Visibility/permission rules for trips live only in `src/trips/trip-access.policy.ts`. Private trips return 404 to outsiders.
- Push notification payloads must stay generic (no message text, no names).
