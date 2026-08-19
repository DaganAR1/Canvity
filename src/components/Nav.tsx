import Link from "next/link";
import { signOut } from "@/auth";

export default function Nav() {
  return (
    <header className="border-b border-[var(--border)] bg-[var(--card)]">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5">
        <Link href="/" className="text-lg font-bold">Canvity</Link>
        <nav className="flex items-center gap-5 text-sm">
          <Link href="/" className="hover:text-blue-600">Timeline</Link>
          <Link href="/settings" className="hover:text-blue-600">Settings</Link>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button type="submit" className="text-[var(--muted)] hover:text-blue-600">Sign out</button>
          </form>
        </nav>
      </div>
    </header>
  );
}
