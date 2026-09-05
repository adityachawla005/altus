"use client";
import Link from "next/link";
import { useState } from "react";
import { api, inr } from "../lib";
import Nav, { Frame } from "../components/Nav";

type Row = { name: string; description: string; price: string; stock: string; category: string };
type Created = {
  merchant_id: string; shop_url: string; dashboard_url: string;
  agent_endpoint: string; qr_url: string;
};

const BLANK: Row = { name: "", description: "", price: "", stock: "10", category: "" };

/** Section header: a numbered slash-label in the left column, content right.
 *  Three of these are the whole page, which is why it is worth a component. */
function Step({
  n,
  title,
  hint,
  children,
}: {
  n: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="relative grid gap-x-12 gap-y-8 border-b border-line px-[clamp(1rem,2.4vw,2rem)] py-14 lg:grid-cols-[1fr_1.6fr]">
      <div>
        <p className="slash label">
          {n} {title}
        </p>
        {hint && <p className="label mt-4 max-w-[30ch] leading-relaxed">{hint}</p>}
      </div>
      <div className="grid gap-8">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="label label-ink">{label}</span>
      {/* autoComplete off by default: these are catalog and policy fields, and
          a password manager offering to fill "Price ₹" helps nobody. */}
      <input
        className="field"
        autoComplete="off"
        inputMode={props.type === "number" ? "numeric" : undefined}
        {...props}
      />
      {hint && <span className="label mt-2 block normal-case tracking-normal">{hint}</span>}
    </label>
  );
}

export default function Onboard() {
  const [form, setForm] = useState({
    name: "", description: "", brand_color: "#0031f5",
    razorpay_key_id: "", razorpay_key_secret: "",
    max_autonomous_spend: "2000", requires_confirmation_above: "1500",
    substitution_allowed: false,
  });
  const [rows, setRows] = useState<Row[]>([{ ...BLANK }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Created | null>(null);

  const set = (k: string, v: string | boolean) => setForm({ ...form, [k]: v });
  const setRow = (i: number, k: keyof Row, v: string) =>
    setRows(rows.map((r, j) => (i === j ? { ...r, [k]: v } : r)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setCreated(
        await api<Created>("/api/merchants", {
          ...form,
          max_autonomous_spend: Number(form.max_autonomous_spend || 0),
          requires_confirmation_above: Number(form.requires_confirmation_above || 0),
          products: rows
            .filter((r) => r.name.trim() && r.price !== "")
            .map((r) => ({
              name: r.name, description: r.description, category: r.category,
              price: Math.round(Number(r.price)), stock: Math.round(Number(r.stock || 0)),
            })),
        }),
      );
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  if (created)
    return (
      <>
        <Frame />
        <Nav />
        <section className="relative border-b border-line px-[clamp(1rem,2.4vw,2rem)] pb-16 pt-14">
          <p className="slash label mb-8">Live</p>
          <h1 className="display display-xl wipe">{form.name}</h1>
          <p className="label tick mt-8">Merchant id — {created.merchant_id}</p>
        </section>

        <section className="relative grid gap-x-12 gap-y-10 border-b border-line px-[clamp(1rem,2.4vw,2rem)] py-14 lg:grid-cols-[1fr_1.6fr]">
          <div>
            <p className="slash label mb-6">Scan to shop</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={created.qr_url}
              alt={`QR code linking to the ${form.name} storefront`}
              width={192}
              height={192}
              className="size-48 border border-line bg-chalk p-3"
            />
            <p className="label mt-4 max-w-[30ch] break-all normal-case tracking-normal">
              {created.shop_url}
            </p>
          </div>

          <dl>
            {[
              ["Storefront", created.shop_url, `/shop/${created.merchant_id}`],
              ["Audit trail", created.dashboard_url, `/dashboard/${created.merchant_id}`],
              ["Agent passport", created.agent_endpoint, `/api/agent/${created.merchant_id}`],
            ].map(([k, url, href]) => (
              <div key={k} className="border-t border-line py-6">
                <dt className="display display-md">{k}</dt>
                <dd className="mt-3">
                  <Link href={href} className="label ul label-ink break-all normal-case tracking-normal">
                    {url} →
                  </Link>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </>
    );

  return (
    <>
      <Frame />
      <Nav />

      <section className="relative border-b border-line px-[clamp(1rem,2.4vw,2rem)] pb-14 pt-12">
        <p className="slash label mb-8">Onboarding</p>
        <h1 className="display display-lg">
          One catalog.
          <br />
          Two front doors.
          <br />
          <span className="text-blue">About a minute.</span>
        </h1>
      </section>

      <form onSubmit={submit}>
        <Step n="01" title="The shop" hint="Name, description, and the colour a buyer sees on the storefront.">
          <Field
            label="Merchant name"
            required
            name="merchant_name"
            autoComplete="organization"
            value={form.name}
            placeholder="Sharma Gifts, Bengaluru"
            onChange={(e) => set("name", e.target.value)}
          />
          <label className="block">
            <span className="label label-ink">Description</span>
            <textarea
              rows={2}
              name="description"
              className="field resize-none"
              value={form.description}
              placeholder="What you sell, and to whom."
              onChange={(e) => set("description", e.target.value)}
            />
          </label>
          <label className="flex items-center gap-4">
            <span className="label label-ink">Brand colour</span>
            <input
              type="color"
              value={form.brand_color}
              className="size-8 cursor-pointer border border-line bg-transparent"
              onChange={(e) => set("brand_color", e.target.value)}
            />
            <span className="label">{form.brand_color}</span>
          </label>

          <div className="grid gap-8 sm:grid-cols-2">
            <Field
              label="Razorpay test key id"
              name="razorpay_key_id"
              spellCheck={false}
              value={form.razorpay_key_id}
              placeholder="rzp_test_…"
              onChange={(e) => set("razorpay_key_id", e.target.value)}
            />
            <Field
              label="Razorpay test key secret"
              name="razorpay_key_secret"
              spellCheck={false}
              type="password"
              value={form.razorpay_key_secret}
              onChange={(e) => set("razorpay_key_secret", e.target.value)}
            />
          </div>
          <p className="label leading-relaxed">
            Leave blank to use the server&apos;s keys, or none at all — payments are then
            simulated and labelled as such.
          </p>
        </Step>

        <Step n="02" title="The catalog" hint="Whole rupees. Stock is decremented on a completed sale.">
          {rows.map((r, i) => (
            <div key={i} className="grid gap-6 border-t border-line pt-8 sm:grid-cols-2">
              <Field label={`Product ${String(i + 1).padStart(2, "0")}`} placeholder="Product name"
                value={r.name} onChange={(e) => setRow(i, "name", e.target.value)} />
              <Field label="Category" placeholder="gifting"
                value={r.category} onChange={(e) => setRow(i, "category", e.target.value)} />
              <Field label="Description" placeholder="One line a buyer would read"
                value={r.description} onChange={(e) => setRow(i, "description", e.target.value)} />
              <div className="grid grid-cols-2 gap-6">
                <Field label="Price ₹" type="number" min={0} placeholder="249"
                  value={r.price} onChange={(e) => setRow(i, "price", e.target.value)} />
                <Field label="Stock" type="number" min={0}
                  value={r.stock} onChange={(e) => setRow(i, "stock", e.target.value)} />
              </div>
              {rows.length > 1 && (
                <button type="button" className="label ul justify-self-start text-halt"
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  Remove
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={() => setRows([...rows, { ...BLANK }])}
            className="btn btn-ghost justify-self-start">
            + Add product
          </button>
        </Step>

        <Step n="03" title="Agent policy" hint="The rules an AI buyer is handed before it may spend anything here. Enforced in code, not by the model.">
          <div className="grid gap-8 sm:grid-cols-2">
            <Field
              label="Max autonomous spend ₹"
              type="number"
              min={0}
              value={form.max_autonomous_spend}
              hint={`Above ${inr(Number(form.max_autonomous_spend || 0))} the purchase is blocked, then escalated.`}
              onChange={(e) => set("max_autonomous_spend", e.target.value)}
            />
            <Field
              label="Requires confirmation above ₹"
              type="number"
              min={0}
              value={form.requires_confirmation_above}
              hint="Escalated, not blocked — it waits for a human."
              onChange={(e) => set("requires_confirmation_above", e.target.value)}
            />
          </div>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={form.substitution_allowed}
              className="size-4 accent-blue"
              onChange={(e) => set("substitution_allowed", e.target.checked)}
            />
            <span className="label label-ink">Agent may substitute a similar product</span>
          </label>
        </Step>

        <div className="relative px-[clamp(1rem,2.4vw,2rem)] py-14">
          <p aria-live="polite" className="sr-only">
            {busy ? "Creating the merchant…" : ""}
          </p>
          {error && (
            <p role="alert" className="label mb-6 bg-halt-soft p-4 text-halt">
              {error}
            </p>
          )}
          <button disabled={busy} className="btn">
            {busy ? "Creating…" : "Create merchant →"}
          </button>
        </div>
      </form>
    </>
  );
}
