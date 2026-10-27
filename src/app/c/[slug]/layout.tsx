"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClinicProvider, useClinic } from "@/lib/clinicContext";
import { WhoAmI } from "@/components/WhoAmI";

function TopNav({ slug }: { slug: string }) {
  const { clinic, followups } = useClinic();
  const pathname = usePathname();
  const tabs = [
    { href: `/c/${slug}/room/1`, label: "Room view", match: "/room/" },
    { href: `/c/${slug}/board`, label: "Fishbowl board", match: "/board" },
    { href: `/c/${slug}/frontdesk`, label: "Front desk", match: "/frontdesk" },
    { href: `/c/${slug}/lab`, label: "Lab and calls", match: "/lab", badge: followups.attentionCount },
    { href: `/c/${slug}/waiting`, label: "Waiting room", match: "/waiting" },
    { href: `/c/${slug}/admin`, label: "Admin", match: "/admin" }
  ];
  return (
    <header className="sticky top-0 z-10 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-5 py-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-baseline gap-2">
        <span className="font-bold text-lg">ClinicFlow</span>
        <span className="text-sm text-slate-500">{clinic?.name ?? slug}</span>
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
            {t.badge ? (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-red-600 text-white text-xs font-bold">
                {t.badge}
              </span>
            ) : null}
          </Link>
        ))}
      </nav>
      <WhoAmI />
    </header>
  );
}

function ClinicShell({ slug, children }: { slug: string; children: React.ReactNode }) {
  const { loading, error } = useClinic();
  const pathname = usePathname();
  // The Fishbowl board uses the whole screen so every room fits on one screen.
  const wide = pathname?.includes("/board");
  if (loading) return <div className="p-10 text-slate-500">Loading clinic…</div>;
  if (error) return <div className="p-10 text-red-600">{error}</div>;
  return (
    <div className="min-h-full flex flex-col">
      <TopNav slug={slug} />
      <main className={`flex-1 p-5 w-full mx-auto ${wide ? "max-w-none" : "max-w-6xl"}`}>{children}</main>
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
      <ClinicShell slug={params.slug}>{children}</ClinicShell>
    </ClinicProvider>
  );
}
