"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  api, inr, readSSE, time,
  type AuditEntry, type Merchant, type Product,
} from "../lib";
import Nav, { Frame } from "../components/Nav";
import Loader from "../components/Loader";

type Result = {
  decision: "PURCHASED" | "BLOCKED" | "ESCALATED" | "NO_MATCH" | "FAILED";
  product?: Product; amount?: number; reason?: string; reasoning?: string; model?: string;
  receipt?: { order_id: string; transaction_id: string; amount_inr: number; status: string; simulated: boolean };
};

const EXAMPLES = [
  "buy me a fitness product under ₹500",
  "get a nice wrist watch, budget ₹5000",
  "find a yoga mat under ₹1800",
];

/** Decision styling. Blue is never a verdict colour here — blue means
 *  "machine", and a verdict is about money, so it gets ink, red or amber. */
const VERDICT: Record<string, { bg: string; fg: string; mark: string; word: string }> = {
  PURCHASED: { bg: "bg-ink", fg: "text-chalk", mark: "#7fa0ff", word: "Cleared" },
  BLOCKED: { bg: "bg-halt-soft", fg: "text-ink", mark: "#d81e2c", word: "Stopped" },
  ESCALATED: { bg: "bg-hold-soft", fg: "text-ink", mark: "#b26a00", word: "Held" },
  NO_MATCH: { bg: "bg-chalk", fg: "text-ink", mark: "#8a8a8a", word: "No match" },
  FAILED: { bg: "bg-halt-soft", fg: "text-ink", mark: "#d81e2c", word: "Failed" },
};

const STEP_MARK: Record<string, string> = {
  SUCCESS: "var(--color-blue)",
  BLOCKED: "var(--color-halt)",
  ESCALATED: "var(--color-hold)",
};

export default function Demo() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [merchant_id, setMerchantId] = useState("");
  const [task, setTask] = useState(EXAMPLES[0]);
  const [budget, setBudget] = useState("");
  const [agentId, setAgentId] = useState("demo_agent_001");
  const [steps, setSteps] = useState<AuditEntry[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const tape = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<Merchant[]>("/api/merchants")
      .then((m) => {
        setMerchants(m);
        setMerchantId((id) => id || m[0]?.id || "");
      })
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    // Only follow the tape once it exists — otherwise this fires on mount and
    // scrolls the visitor straight past the hero to an empty page bottom.
    if (!steps.length && !result) return;
    tape.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [steps.length, result]);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setRunning(true);
    setSteps([]);
    setResult(null);
    setError("");
    try {
      const res = await fetch(`/api/agent/${merchant_id}/buy?stream=1`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task, agent_id: agentId, budget: Number(budget || 0) }),
      });
      if (!res.ok) throw new Error((await res.text()).slice(0, 300));
      await readSSE(res, (event, data) => {
        if (event === "step") setSteps((s) => [...s, data as AuditEntry]);
        if (event === "result") setResult(data as Result);
      });
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setRunning(false);
    }
  }

  const v = result ? VERDICT[result.decision] : null;

  return (
    <>
      <Loader
        done={ready}
        label="Agent bench"
        steps={["Opening the bench", "Listing merchants", "Ready"]}
      />
      <Frame />
      <Nav />

      <section className="relative border-b border-line px-[clamp(1rem,2.4vw,2rem)] pb-14 pt-12">
        <p className="slash label mb-8">Agent bench</p>
        <h1 className="display display-lg">
          Give it a task.
          <br />
          Watch policy
          <br />
          <span className="text-blue">answer.</span>
        </h1>
        <p className="label tick mt-8 max-w-[46ch] leading-relaxed">
          The agent reads the passport, proposes one product, and the merchant&apos;s
          rules decide what happens next. Every step below arrives over SSE, live,
          in the order the server wrote it.
        </p>
      </section>

      {/* ── Brief ─────────────────────────────────────────────────────── */}
      <form
        onSubmit={run}
        className="relative grid gap-x-12 gap-y-8 border-b border-line px-[clamp(1rem,2.4vw,2rem)] py-12 lg:grid-cols-[1fr_1.6fr]"
      >
        <p className="slash label">The brief</p>

        {ready && !merchants.length ? (
          <div>
            <p className="display display-md">No merchant to buy from.</p>
            <p className="label mt-5 max-w-[44ch] leading-relaxed">
              The bench needs a catalog and a policy before an agent has anything
              to be stopped by.
            </p>
            <Link href="/onboard" className="btn mt-8 inline-block">
              Onboard a merchant →
            </Link>
          </div>
        ) : (
        <div className="grid gap-8">
          <div className="grid gap-8 sm:grid-cols-2">
            <label className="block">
              <span className="label label-ink">Merchant</span>
              <select
                className="field"
                name="merchant_id"
                value={merchant_id}
                onChange={(e) => setMerchantId(e.target.value)}
              >
                {merchants.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label label-ink">Agent id</span>
              <input
                className="field"
                name="agent_id"
                autoComplete="off"
                spellCheck={false}
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
              />
            </label>
          </div>

          <label className="block">
            <span className="label label-ink">Task</span>
            <input
              className="field"
              name="task"
              autoComplete="off"
              value={task}
              onChange={(e) => setTask(e.target.value)}
            />
          </label>

          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((x) => (
              <button
                key={x}
                type="button"
                onClick={() => setTask(x)}
                className={`label border px-3 py-1.5 transition-colors ${
                  task === x
                    ? "border-blue bg-blue-soft label-ink"
                    : "border-line hover:border-ink hover:text-ink"
                }`}
              >
                {x}
              </button>
            ))}
          </div>

          <label className="block max-w-xs">
            <span className="label label-ink">Budget cap ₹ — optional</span>
            <input
              className="field"
              type="number"
              inputMode="numeric"
              name="budget"
              min={0}
              value={budget}
              placeholder="read from the task if blank…"
              onChange={(e) => setBudget(e.target.value)}
            />
          </label>

          <button disabled={running || !merchant_id} className="btn justify-self-start">
            {running ? "Agent working…" : "Run the agent →"}
          </button>
        </div>
        )}
      </form>

      {error && (
        <p role="alert" className="label border-b border-halt bg-halt-soft px-[clamp(1rem,2.4vw,2rem)] py-4 text-halt">
          {error}
        </p>
      )}

      {/* ── Tape ──────────────────────────────────────────────────────── */}
      {(!!steps.length || running) && (
        <section className="relative grid gap-x-12 gap-y-8 border-b border-line px-[clamp(1rem,2.4vw,2rem)] py-12 lg:grid-cols-[1fr_1.6fr]">
          <div>
            <p className="slash label">The tape</p>
            <p className="label mt-3">{steps.length} steps</p>
          </div>

          <ol aria-live="polite" aria-busy={running}>
            {steps.map((s, i) => (
              <li
                key={s.id}
                className="rise grid gap-x-6 gap-y-1 border-t border-line py-5 sm:grid-cols-[8rem_1fr]"
                style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
              >
                <div className="label flex items-baseline gap-3">
                  <span
                    className="inline-block size-[5px] translate-y-[-1px]"
                    style={{ background: STEP_MARK[s.status] ?? "var(--color-muted)" }}
                  />
                  {time(s.timestamp)}
                </div>
                <div>
                  <p className="label label-ink">
                    {s.action}
                    {!!s.amount && <span className="ml-3 text-ink">{inr(s.amount)}</span>}
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-graphite">{s.reason}</p>
                </div>
              </li>
            ))}
            {running && (
              <li className="label border-t border-line py-5">
                waiting for the next frame<span className="blink">_</span>
              </li>
            )}
          </ol>
        </section>
      )}

      {/* ── Verdict ───────────────────────────────────────────────────── */}
      {result && v && (
        <section className={`wipe relative px-[clamp(1rem,2.4vw,2rem)] py-16 ${v.bg} ${v.fg}`}>
          <p className="label" style={{ color: v.mark }}>
            <span
              className="mr-2 inline-block size-[5px] translate-y-[-1px]"
              style={{ background: v.mark }}
            />
            {result.decision}
          </p>

          <h2 className="display display-lg mt-6 max-w-[18ch]">{v.word}</h2>

          {result.product && (
            <p className="display display-md mt-8">
              {result.product.name} — {inr(result.amount ?? 0)}
            </p>
          )}
          {result.reason && (
            <p className="mt-4 max-w-[52ch] text-base leading-relaxed">{result.reason}</p>
          )}
          {result.reasoning && (
            <p className="label mt-3 max-w-[60ch] leading-relaxed opacity-70">
              {result.reasoning}
            </p>
          )}

          {result.receipt && (
            <dl className="mt-10 grid max-w-3xl gap-px border border-current/20 bg-current/20 sm:grid-cols-2">
              {[
                ["Order", result.receipt.order_id],
                ["Transaction", result.receipt.transaction_id],
                ["Amount", inr(result.receipt.amount_inr)],
                [
                  "Status",
                  result.receipt.status + (result.receipt.simulated ? " · simulated" : ""),
                ],
              ].map(([k, val]) => (
                <div key={k} className={`${v.bg} p-6`}>
                  <dt className="label">{k}</dt>
                  <dd className="mt-2 break-all font-mono text-sm">{val}</dd>
                </div>
              ))}
            </dl>
          )}

          <p className="label mt-10 opacity-70">
            Reasoned by {result.model} ·{" "}
            <Link href={`/dashboard/${merchant_id}`} className="ul underline-offset-4">
              open the full audit trail →
            </Link>
          </p>
        </section>
      )}

      <div ref={tape} />
    </>
  );
}
