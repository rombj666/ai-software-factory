import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionSafe, isAuthConfigured } from "@/lib/auth/server";
import { SignInForm } from "@/components/sign-in-form";

export default async function SignInPage() {
  const { data: session } = await getSessionSafe();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-brand-700">AI Software Factory</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to your workspace</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {isAuthConfigured() ? (
            <SignInForm />
          ) : (
            <p className="text-sm text-slate-500">
              Neon Auth is not configured. Set{" "}
              <code className="rounded bg-slate-100 px-1">NEON_AUTH_BASE_URL</code> and{" "}
              <code className="rounded bg-slate-100 px-1">NEON_AUTH_COOKIE_SECRET</code> in
              your environment, then restart the app.
            </p>
          )}
        </div>
        <p className="mt-4 text-center text-sm text-slate-500">
          <Link href="/auth/sign-up" className="font-medium text-brand-700 hover:underline">
            Create Account
          </Link>
        </p>
        <p className="mt-4 text-center text-xs text-slate-400">
          <Link href="/" className="hover:text-slate-600">
            Back to home
          </Link>
        </p>
      </div>
    </main>
  );
}
