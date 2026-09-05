"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type Merchant } from "../lib";

/** Local time, the way the reference stamps its hero. Rendered only after
 *  mount so the server and client don't disagree about what time it is. */
function Clock() {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const t = () =>
      setNow(
        new Date().toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        }),
      );
    t();
    const i = setInterval(t, 30_000);
    return () => clearInterval(i);
  }, []);
  return <span className="tabular-nums">{now || "—"}</span>;
}

export function Frame() {
  return <div className="rule-frame" aria-hidden />;
}

export function Stamp() {
  return (
    <p className="label tick label-ink leading-tight">
      <Clock />
      <br />
      Bengaluru, IN
    </p>
  );
}

export default function Nav() {
  const path = usePathname();
  // Storefront and Audit point at whichever merchant is actually on the
  // ledger. Hard-coding a seed id means the nav dead-ends the moment the
  // ledger is cleared — which is exactly when someone is demoing.
  const [first, setFirst] = useState<Merchant | null>(null);
  useEffect(() => {
    api<Merchant[]>("/api/merchants")
      .then((m) => setFirst(m[0] ?? null))
      .catch(() => {});
  }, [path]);

  const links: [string, string][] = [
    ["Onboard", "/onboard"],
    ...(first
      ? ([
          ["Storefront", `/shop/${first.id}`],
          ["Audit", `/dashboard/${first.id}`],
        ] as [string, string][])
      : []),
  ];

  return (
    <header className="relative z-20 flex items-stretch border-b border-line">
      <Link
        href="/"
        className="flex items-center border-r border-line px-[clamp(1rem,2.4vw,2rem)] py-4 transition-colors hover:bg-ink hover:text-chalk"
      >
        <span className="display text-lg tracking-[-0.03em]">ALTUS</span>
      </Link>

      <nav className="hidden flex-1 items-center gap-8 px-8 md:flex">
        {links.map(([text, href]) => (
          <Link
            key={href}
            href={href}
            className={`label ul ${path === href ? "label-ink" : ""}`}
          >
            {text}
          </Link>
        ))}
      </nav>

      <div className="ml-auto flex items-stretch">
        {first && (
          <a
            href={`/api/agent/${first.id}`}
            className="hidden items-center border-l border-line px-6 sm:flex"
          >
            <span className="label ul">Passport ↗</span>
          </a>
        )}
        <Link href="/demo" className="btn flex items-center">
          Run an agent
        </Link>
      </div>
    </header>
  );
}
