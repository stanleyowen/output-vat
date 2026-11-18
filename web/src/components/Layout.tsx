import { useState } from "react";
import { NavLink, Outlet } from "react-router";
import { useAuth } from "../lib/auth";

const NAV = [
  { to: "/", label: "Convert", end: true },
  { to: "/history", label: "History" },
  { to: "/templates", label: "Templates" },
];

export function Layout() {
  const { me, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-2 text-sm font-medium transition ${
      isActive
        ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
    }`;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
          <NavLink to="/" className="flex items-center gap-2 font-semibold">
            <img src="/logo.svg" alt="" className="h-7 w-7" />
            <span>VAT</span>
          </NavLink>
          <nav className="ml-4 hidden gap-1 md:flex">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={link}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-3 md:flex">
            <span className="muted max-w-[16rem] truncate text-sm" title="Signed in with Cloudflare">{me?.user.email}</span>
            <button type="button" className="btn-ghost text-sm" onClick={signOut}>
              Sign out
            </button>
          </div>
          <button
            type="button"
            className="btn-ghost ml-auto md:hidden"
            aria-expanded={open}
            aria-label="Menu"
            onClick={() => setOpen(!open)}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d={open ? "M6 6l12 12M18 6 6 18" : "M4 7h16M4 12h16M4 17h16"} strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {open && (
          <nav className="flex flex-col gap-1 border-t border-slate-200 px-4 py-2 md:hidden dark:border-slate-800" onClick={() => setOpen(false)}>
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={link}>
                {n.label}
              </NavLink>
            ))}
            <button type="button" className="btn-ghost justify-start" onClick={signOut}>
              Sign out ({me?.user.email})
            </button>
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
