"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, inr, time, type AuditEntry, type Merchant, type Rules } from "../../lib";
import Nav, { Frame } from "../../components/Nav";
import Loader from "../../components/Loader";

const MARK: Record<string, string> = {
  SUCCESS: "var(--color-blue)",
  BLOCKED: "var(--color-halt)",
  ESCALATED: "var(--color-hold)",
};
const ROW: Record<string, string> = {
  BLOCKED: "bg-halt-soft",
  ESCALATED: "bg-hold-soft",
};

export default function Dashboard() {
  const merchant_id = String(useParams().merchant_id);
  const [shop, setShop] = useState<{ merchant: Merchant; rules: Rules } | null>(null);
  const [log, setLog] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState("ALL");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api<{ merchant: Merchant; rules: Rules }>(`/api/merchants/${merchant_id}`)
      .then(setShop)
      .catch(() => {});
  }, [merchant_id]);

  useEffect(() => {
    // ponytail: 3s poll. Swap for SSE if a merchant ever watches more than one screen.
    const pull = () =>
      api<AuditEntry[]>(`/api/audit/${merchant_id}`)
        .then(setLog)
        .catch(() => {})
        .finally(() => setReady(true));
    pull();
    const t = setInterval(pull, 3000);
    return () => clearInterval(t);
  }, [merchant_id]);

  const shown = filter === "ALL" ? log : log.filter((e) => e.status === filter);
  const counts = {
    ALL: log.length,
    SUCCESS: log.filter((e) => e.status === "SUCCESS").length,
    BLOCKED: log.filter((e) => e.status === "BLOCKED").length,
    ESCALATED: log.filter((e) => e.status === "ESCALATED").length,
  };
  const moved = log
    .filter((e) => e.action === "PURCHASE" && e.status === "SUCCESS")
    .reduce((n, e) => n + (e.amount || 0), 0);
  const stopped = log
    .filter((e) => e.status === "BLOCKED" || e.status === "ESCALATED")
    .reduce((n, e) => n + (e.amount || 0), 0);

  return (
    <>
      <Loader
        done={ready}
        label="Audit trail"
        steps={["Opening the ledger", "Replaying decisions", "Ready"]}
      />
      <Frame />
      <Nav />

      <section className="relative border-b border-line px-[clamp(1rem,2.4vw,2rem)] pb-12 pt-12">
        <p className="slash label mb-6">Audit trail</p>
        <h1 className="display display-lg">{shop?.merchant.name ?? merchant_id}</h1>
        {shop && (
          <p className="label tick mt-8 max-w-[56ch] leading-relaxed">
            Autonomous up to {inr(shop.rules.max_autonomous_spend)} · human confirmation
            above {inr(shop.rules.requires_confirmation_above)} · substitution{" "}
            {shop.rules.substitution_allowed ? "allowed" : "off"}
          </p>
        )}
      </section>

      {/* Two numbers, set as headlines. Money moved, money stopped — that is
          what a merchant opens this page to find out. */}
      <section className="relative grid gap-px border-b border-line bg-line sm:grid-cols-3">
        {[
          ["Money moved", inr(moved), "var(--color-ink)"],
          ["Held or blocked", inr(stopped), "var(--color-halt)"],
          ["Entries", String(log.length), "var(--color-blue)"],
        ].map(([k, val, color]) => (
          <div key={k} className="bg-paper px-[clamp(1rem,2.4vw,2rem)] py-10">
            <p className="label">{k}</p>
            <p className="display display-md mt-3 tabular-nums" style={{ color }}>
              {val}
            </p>
          </div>
        ))}
      </section>

      <div className="relative flex flex-wrap gap-x-8 gap-y-3 border-b border-line px-[clamp(1rem,2.4vw,2rem)] py-5">
        {(Object.keys(counts) as (keyof typeof counts)[]).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`label ul ${filter === k ? "label-ink" : ""}`}
          >
            {k === "ALL" ? "All" : k[0] + k.slice(1).toLowerCase()} · {counts[k]}
          </button>
        ))}
      </div>

      <section className="relative px-[clamp(1rem,2.4vw,2rem)] pb-24">
        {shown.map((e) => (
          <div
            key={e.id}
            className={`grid gap-x-6 gap-y-1.5 border-b border-line py-5 md:grid-cols-[7rem_9rem_1fr_auto] md:items-baseline ${
              ROW[e.status] ?? ""
            }`}
          >
            <div className="label flex items-baseline gap-3">
              <span
                className="inline-block size-[5px] translate-y-[-1px] shrink-0"
                style={{ background: MARK[e.status] ?? "var(--color-muted)" }}
              />
              {time(e.timestamp)}
            </div>
            <p className="label label-ink">{e.action}</p>
            <div>
              <p className="text-sm leading-relaxed text-graphite">{e.reason}</p>
              {(!!e.agent_id || !!e.transaction_id) && (
                <p className="label mt-1.5 break-all">
                  {e.agent_id}
                  {!!e.transaction_id && ` · ${e.transaction_id}`}
                </p>
              )}
            </div>
            <p className="font-mono text-sm tabular-nums">{e.amount ? inr(e.amount) : ""}</p>
          </div>
        ))}

        {ready && !shown.length && (
          <p className="label border-b border-line py-10 leading-relaxed">
            Nothing logged under this filter. Run the{" "}
            <Link href="/demo" className="ul label-ink">
              agent bench
            </Link>{" "}
            or chat in the{" "}
            <Link href={`/shop/${merchant_id}`} className="ul label-ink">
              storefront
            </Link>
            .
          </p>
        )}
      </section>
    </>
  );
}
