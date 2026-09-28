"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClinicProvider, useClinic } from "@/lib/clinicContext";
import { UndoProvider } from "@/lib/undoContext";
import { ConnectionBadge } from "@/components/ConnectionBadge";

function TopNav({ slug }: { slug: string }) {
  const { clinic } = useClinic();
  const pathname = usePathname();
  const tabs = [
    { href: `/c/${slug}/room/1`, label: "Room view", match: "/room/" },
    { href: `/c/${slug}/board`, label: "Fishbowl board", match: "/board" },
    { href: `/c/${slug}/frontdesk`, label: "Front desk", match: "/frontdesk" },
    { href: `/c/${slug}/waiting`, label: "Waiting room", match: "/waiting" },
    { href: `/c/${slug}/huddle`, label: "Huddle", match: "/huddle" },
    { href: `/c/${slug}/admin`, label: "Admin", match: "/admin" }
  ];
  return (
    <header className="sticky top-0 z-10 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-5 py-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-baseline gap-2">
        <span className="font-bold text-lg">ClinicFlow</span>
        <span className="text-sm text-slate-500">{clinic?.name ?? slug}</span>
        <ConnectionBadge />
      </div>
      <nav className="flex bg-slate-100 dark:bg-slate-900 rounded-lg p-1 gap-0.5 flex-wrap">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`px-3 py-2 rounded-md text-sm font-semibold ${
              pathname?.includes(t.match)
                ? "bg-white dark:bg-slate-700 shadow-sm"
                : "text-slate-500"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

function ClinicShell({ slug, children }: { slug: string; children: React.ReactNode }) {
  const { loading, error } = useClinic();
  if (loading) return <div className="p-10 text-slate-500">Loading clinic…</div>;
  if (error) return <div className="p-10 text-red-600">{error}</div>;
  return (
    <div className="min-h-full flex flex-col">
      <TopNav slug={slug} />
      <main className="flex-1 p-5 max-w-6xl w-full mx-auto">{children}</main>
    </div>
  );
}

export default function ClinicLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: { slug: string };
}) {
  return (
    <ClinicProvider slug={params.slug}>
      <UndoProvider>
        <ClinicShell slug={params.slug}>{children}</ClinicShell>
      </UndoProvider>
    </ClinicProvider>
  );
}
