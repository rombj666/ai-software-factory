# Neon Auth registration fix (M1)

The application now exposes `/auth/sign-up` and links it from Sign In. This is
an authentication fix; it does not introduce M3 work.

## Behavior and security

- Full name, email address, password, password confirmation, and Sign Up button.
- Browser constraints and server-side validation enforce required fields, valid
  email syntax, a name of at most 200 characters, an email of at most 254
  characters, passwords of 8–128 characters, and matching confirmation.
- Identity fields are trimmed; passwords are sent unchanged to Neon.
- Registration uses the installed `@neondatabase/auth/next/server` SDK through
  `getAuth().signUp.email`. Confirmation is never sent to Neon.
- The SDK persists provider-issued session cookies. An issued token redirects
  to Dashboard; no token produces verification/sign-in instructions. The app
  never automatically calls sign-in to work around required verification.
- Verification links return to `/auth/sign-in`. Six-digit verification codes
  are submitted using `emailOtp.verifyEmail`, followed by Sign In. If Neon
  issued a session during verification, the existing Sign In page detects it
  and redirects to Dashboard.
- Known duplicate-email errors offer Sign In. Unknown provider errors and
  exceptions use generic messages without returning secrets or raw errors.
  Providers that hide duplicate accounts behind a generic success response
  retain that behavior.
- Buttons disable during registration/verification to prevent duplicate UI
  submissions. React action state returns no password or session token.
- Existing session helpers, Dashboard protection, project ownership, M2
  consultation, worker code and database schemas are unchanged. No migrations.

## Files

- `apps/web/app/actions/auth.ts`: registration and code verification actions.
- `apps/web/app/auth/sign-up/page.tsx`: new page and Sign In link.
- `apps/web/components/sign-up-form.tsx`: registration and verification UI.
- `apps/web/app/auth/sign-in/page.tsx`: Create Account link.
- `apps/web/components/sign-in-form.tsx`: remove obsolete Console-only guidance.
- `apps/web/test/auth.test.ts`: mocked SDK tests, including existing sign-in/out.
- `apps/web/test/sign-up-form.test.tsx`: mocked action UI tests.
- `eslint.config.mjs`: exclude generated `temp/` artifacts, already Git-ignored
  and excluded by Vitest. A pre-existing M2 preview bundle otherwise failed lint.
- `docs/architecture.md`: update authentication capabilities.
- `docs/auth-registration-fix.md`: this report and deployment guidance.

## Verification

Required commands: `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build:web`, `npm run build:worker`.

All five commands passed. Vitest reported 76 passed and 18 skipped tests (the
existing opt-in database/integration tests). The web build completed with Neon
SDK diagnostics during Next.js static-render detection; auth routes were
correctly emitted as dynamic routes. A local production-server smoke check
returned HTTP 200 for both auth pages with the expected fields/links and HTTP
307 to Sign In for an unauthenticated Dashboard request. This smoke check did
not register a user.

The 23 new authentication tests mock Neon SDK methods or server actions. They
cover validation, duplicates, provider failures, session/no-session outcomes,
verification codes, pending submission prevention, and sign-in/out redirects.
They do **not** prove real Neon registration or email delivery.

Real Neon registration and the complete email round trip have not been run.
No controlled test mailbox or verification code was provided. Before treating
production registration as verified, use a mailbox you control to register,
complete configured verification, sign in, create/open a project, sign out,
and try registering the same email again. Also verify an unauthenticated
Dashboard request redirects to Sign In and another user's project remains
inaccessible.

## Deployment and configuration

Deploy only the Vercel web application from `main`. If Vercel's Git integration
is enabled for `main`, the requested push should trigger that deployment;
production deployment status must be checked in Vercel.

Retain the existing `NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET` values.
In Neon Auth, confirm email/password sign-up is enabled and the Vercel domain
is trusted. Keep the existing email verification policy enabled when required.
The UI supports links and codes; links require a custom email provider per
[Neon's verification guide](https://neon.com/docs/auth/guides/email-verification).
Confirm the configured email provider delivers verification messages. No new
environment variables, Neon tables, migrations, or Railway deployment are
required by this change.
