"use client";

import { useActionState } from "react";
import { signUpWithEmail, verifyRegistrationEmail } from "@/app/actions/auth";

const inputClass = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
const buttonClass = "w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow hover:bg-brand-700 disabled:opacity-60";

export function SignUpForm() {
  const [state, formAction, pending] = useActionState(signUpWithEmail, {
    error: null, message: null, verificationEmail: null,
  });
  const [verification, verifyAction, verifying] = useActionState(verifyRegistrationEmail, { error: null });

  if (state.message) {
    return (
      <div className="space-y-4">
        <p role="status" className="text-sm text-slate-700">{state.message}</p>
        {state.verificationEmail && (
          <form action={verifyAction} className="space-y-4" aria-busy={verifying}>
            <p className="text-sm text-slate-500">If your email contains a verification link, open it. If it contains a code, enter it below.</p>
            {verification.error && <p role="alert" className="text-sm text-red-700">{verification.error}</p>}
            <input type="hidden" name="email" value={state.verificationEmail} />
            <div>
              <label htmlFor="otp" className="block text-sm font-medium text-slate-700">Verification code</label>
              <input id="otp" name="otp" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} className={inputClass} />
            </div>
            <button type="submit" disabled={verifying} className={buttonClass}>{verifying ? "Verifying..." : "Verify email"}</button>
          </form>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4" aria-busy={pending}>
      {state.error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{state.error}</div>}
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-slate-700">Full Name</label>
        <input id="name" name="name" required maxLength={200} autoComplete="name" className={inputClass} />
      </div>
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-700">Email Address</label>
        <input id="email" name="email" type="email" required maxLength={254} autoComplete="email" className={inputClass} />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-slate-700">Password</label>
        <input id="password" name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" aria-describedby="password-requirements" className={inputClass} />
        <p id="password-requirements" className="mt-1 text-xs text-slate-500">Use 8–128 characters.</p>
      </div>
      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-700">Confirm Password</label>
        <input id="confirmPassword" name="confirmPassword" type="password" required minLength={8} maxLength={128} autoComplete="new-password" className={inputClass} />
      </div>
      <button type="submit" disabled={pending} className={buttonClass}>{pending ? "Creating account..." : "Sign Up"}</button>
    </form>
  );
}
