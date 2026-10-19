import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionSafe } from "@/lib/auth/server";

export default async function HomePage() {
  const { data: session } = await getSessionSafe();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-2xl text-center">
        <h1 className="text-4xl font-bold tracking-tight text-brand-700 sm:text-5xl">
          AI Software Factory
        </h1>
        <p className="mt-4 text-lg text-slate-600">
          Describe a product idea. Get a real, tested, exportable software
          application.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Milestone 1 foundation: monorepo, Neon database, Neon Auth,
          workflow engine and Worker. AI generation arrives in later
          milestones.
        </p>
        <div className="mt-8 flex justify-center gap-4">
          <Link
            href="/auth/sign-in"
            className="rounded-lg bg-brand-600 px-6 py-3 text-sm font-medium text-white shadow hover:bg-brand-700"
          >
            Sign in
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
