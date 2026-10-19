import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionSafe } from "@/lib/auth/server";
import { signOutAction } from "@/app/actions/auth";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session } = await getSessionSafe();
  if (!session?.user) {
    redirect("/auth/sign-in");
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-8">
            <Link href="/dashboard" className="text-lg font-bold text-brand-700">
              AI Software Factory
            </Link>
            <nav className="hidden gap-6 text-sm font-medium text-slate-600 sm:flex">
              <Link href="/dashboard" className="hover:text-brand-700">
                Dashboard
              </Link>
              <Link href="/dashboard/projects" className="hover:text-brand-700">
                Projects
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-slate-500 md:inline">
              {session.user.email ?? session.user.name ?? "Account"}
            </span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
