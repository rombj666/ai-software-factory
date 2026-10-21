"use client";

import { useActionState } from "react";
import { signInWithEmail } from "@/app/actions/auth";

export function SignInForm() {
  const [state, formAction, pending] = useActionState(signInWithEmail, {
    error: null,
  });

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-700">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-slate-700">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? "Signing in..." : "Sign in"}
      </button>
      <p className="text-center text-xs text-slate-500">
        Managed by Neon Auth.
      </p>
    </form>
  );
}
