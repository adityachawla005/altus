"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { api, type Merchant } from "./lib";
import Nav, { Frame, Stamp } from "./components/Nav";
import Loader from "./components/Loader";

const Amphitheatre = dynamic(() => import("./components/Amphitheatre"), { ssr: false });

const USES = [
  ["[₹]", "Human buyers", "A chat storefront that reads the catalog, answers in plain language, and closes with a checkout link — no app, no account, just a QR code."],
  ["[◎]", "Machine buyers", "An Agent Passport: the catalog plus the rules a machine must obey. Published at one URL, versioned with the merchant's policy."],
  ["[§]", "The merchant", "One audit trail for both. Every query, selection, block and escalation, timestamped with the amount and the reason."],
];

const RULES = [
  ["01", "Over the autonomous cap", "Blocked, then escalated to the merchant."],
  ["02", "Over the confirmation line", "Escalated. Waits for a human."],
  ["03", "Within policy", "Order created, stock decremented, receipt returned."],
];

/** Scroll-linked focus: the row nearest the middle of the viewport goes to
 *  full ink, the rest fade back. Straight IntersectionObserver — no library
 *  needed for a three-row list. */
function useFocus(count: number) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [count]);
  return { active, refs };
}

export default function Home() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [ready, setReady] = useState(false);
  const [shell, setShell] = useState(false);
  const { active, refs } = useFocus(USES.length);

  useEffect(() => {
    api<Merchant[]>("/api/merchants")
      .then(setMerchants)
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  return (
    <>
      <Loader
        done={ready}
        label="Altus"
        steps={["Raising the structure", "Loading merchants", "Ready"]}
        onGone={() => setShell(true)}
      />
      <a href="#main" className="skip label">
        Skip to content
      </a>
      <Frame />
      <Nav />

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section id="main" className="relative overflow-hidden border-b border-line">
        {/* The structure sits off to the right and bleeds past the edge, the
            way the reference crops it — so the display type keeps clear
            ground on the left instead of fighting the linework. */}
        <Amphitheatre
          parallax
          spin={0.06}
          className="pointer-events-none absolute -right-[14%] top-0 h-full w-[88%] opacity-90"
        />
        <div className="graph pointer-events-none absolute inset-0 opacity-40" />
        {/* Legibility wash: paper fading out to the right, under the type. */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-2/3"
          style={{
            background:
              "linear-gradient(90deg, var(--color-paper) 22%, color-mix(in srgb, var(--color-paper) 55%, transparent) 62%, transparent 100%)",
          }}
        />

        <div
          className={`relative px-[clamp(1rem,2.4vw,2rem)] pb-24 pt-16 ${shell ? "stair" : "opacity-0"}`}
        >
          <div className="mb-8 max-w-[14rem]">
            <Stamp />
          </div>

          {/* Staircase: each line indents further than the one above it. */}
          <h1 className="display display-xl">
            <span className="block">Two</span>
            <span className="ml-[6vw] block">Front</span>
            <span className="ml-[16vw] block">
              Doors<span className="text-blue">*</span>
            </span>
          </h1>

          <div className="mt-14 flex flex-wrap items-end justify-between gap-8">
            <p className="label tick max-w-[24rem] leading-relaxed">
              One small merchant, made transactable twice over — once for people,
              once for the agents buying on their behalf.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/demo" className="btn">
                Watch an agent buy
              </Link>
              <Link href="/onboard" className="btn btn-ghost">
                Onboard a merchant
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Use cases ────────────────────────────────────────────────── */}
      <section className="relative z-10 border-b border-line px-[clamp(1rem,2.4vw,2rem)] py-24">
        <p className="slash label mb-16">Use cases</p>
        <div className="grid gap-x-16 lg:grid-cols-[1fr_1.15fr]">
          <h2 className="display display-lg mb-12 lg:mb-0">
            Built for
            <br />
            both kinds
            <br />
            of buyer
          </h2>

          <div>
            {USES.map(([icon, title, body], i) => (
              <div
                key={title}
                data-i={i}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                className={`grid gap-4 border-t border-line py-8 transition-opacity duration-500 sm:grid-cols-[1fr_1.4fr] ${
                  active === i ? "opacity-100" : "opacity-40"
                }`}
              >
                <h3 className="flex items-baseline gap-3 text-lg font-semibold">
                  <span className="font-mono text-xs text-blue">{icon}</span>
                  {title}
                </h3>
                <p className="text-sm leading-relaxed text-graphite">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Policy, on black ─────────────────────────────────────────── */}
      <section className="relative z-10 bg-ink px-[clamp(1rem,2.4vw,2rem)] py-24 text-chalk">
        <p className="slash label mb-16">Policy</p>
        <h2 className="display display-lg max-w-[16ch]">
          Enforced in code, not by the model
        </h2>
        <p className="label mt-8 max-w-[42ch] leading-relaxed">
          The model only proposes a product. <code className="text-blue">run_agent()</code>{" "}
          decides what happens to it, in this order.
        </p>

        <div className="mt-16 grid gap-px border border-white/15 bg-white/15 md:grid-cols-3">
          {RULES.map(([n, title, body]) => (
            <div key={n} className="bg-ink p-8">
              <p className="label" style={{ color: "#8a8a8a" }}>
                {n}
              </p>
              <h3 className="mt-6 text-lg font-semibold text-chalk">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/65">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Live merchants ───────────────────────────────────────────── */}
      <section className="relative z-10 px-[clamp(1rem,2.4vw,2rem)] py-24">
        <div className="mb-12 flex items-baseline justify-between gap-6">
          <p className="slash label">Live merchants</p>
          <p className="label">{merchants.length} on the ledger</p>
        </div>

        {merchants.map((m) => (
          <div
            key={m.id}
            className="group grid gap-4 border-t border-line py-10 md:grid-cols-[1.2fr_1.6fr_auto] md:items-baseline"
          >
            <h3 className="display display-md">{m.name}</h3>
            <p className="max-w-[46ch] text-sm leading-relaxed text-graphite">
              {m.description}
              <span className="label mt-3 block">{m.id}</span>
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Link href={`/shop/${m.id}`} className="label ul label-ink">
                Shop →
              </Link>
              <Link href={`/dashboard/${m.id}`} className="label ul label-ink">
                Audit →
              </Link>
              <a href={`/api/agent/${m.id}`} className="label ul label-ink">
                Passport ↗
              </a>
            </div>
          </div>
        ))}

        {ready && !merchants.length && (
          <div className="border-t border-line py-14">
            <p className="display display-md">The ledger is empty.</p>
            <p className="label mt-5 max-w-[44ch] leading-relaxed">
              No merchant has been onboarded yet. Add a catalog and an agent policy,
              and this list fills in.
            </p>
            <Link href="/onboard" className="btn mt-8 inline-block">
              Onboard the first merchant →
            </Link>
          </div>
        )}
      </section>

      <footer className="relative z-10 flex flex-wrap items-baseline justify-between gap-4 border-t border-line px-[clamp(1rem,2.4vw,2rem)] py-10">
        <p className="label tick label-ink">Altus</p>
        <p className="label">Simulated checkout · money in whole rupees · INR</p>
      </footer>
    </>
  );
}
