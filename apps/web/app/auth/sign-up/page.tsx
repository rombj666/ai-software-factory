import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionSafe, isAuthConfigured } from "@/lib/auth/server";
import { SignUpForm } from "@/components/sign-up-form";

export default async function SignUpPage() {
  const { data: session } = await getSessionSafe();
  if (session?.user) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-brand-700">AI Software Factory</h1>
          <p className="mt-1 text-sm text-slate-500">Create your account</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {isAuthConfigured() ? <SignUpForm /> : <p className="text-sm text-slate-500">Registration is currently unavailable. Please try again later.</p>}
        </div>
        <p className="mt-4 text-center text-sm text-slate-500">
          Already have an account? <Link href="/auth/sign-in" className="font-medium text-brand-700 hover:underline">Sign In</Link>
        </p>
      </div>
    </main>
  );
}
