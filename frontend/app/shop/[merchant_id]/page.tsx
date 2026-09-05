"use client";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api, inr, type Merchant, type Payment, type Product } from "../../lib";
import Loader from "../../components/Loader";

type Msg = { role: "user" | "assistant"; content: string; products?: Product[] };
type ChatOut = { reply: string; products: Product[]; payment: Payment | null };
type Verified = { status: string; transaction_id?: string; amount?: number; reason?: string };

/**
 * The storefront is the one surface a stranger meets on a phone, so it keeps
 * the design language but drops the theatrics: no 3D behind the thread, no
 * parallax, nothing that costs battery while someone is trying to buy soap.
 */
export default function Shop() {
  const merchant_id = String(useParams().merchant_id);
  const [shop, setShop] = useState<{ merchant: Merchant; products: Product[] } | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [receipt, setReceipt] = useState<Verified | null>(null);
  const [note, setNote] = useState("");
  const [ready, setReady] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ merchant: Merchant; products: Product[] }>(`/api/merchants/${merchant_id}`)
      .then((s) => {
        setShop(s);
        setMsgs([
          {
            role: "assistant",
            content: `Welcome to ${s.merchant.name}. Tell me what you're after — a budget and an occasion is plenty to go on.`,
          },
        ]);
      })
      .catch((e) => setNote(String(e.message ?? e)))
      .finally(() => setReady(true));
  }, [merchant_id]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, payment, receipt]);

  const brand = shop?.merchant.brand_color ?? "#0031f5";

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    const history: Msg[] = [...msgs, { role: "user", content: text }];
    setMsgs(history);
    setInput("");
    setBusy(true);
    setNote("");
    try {
      const out = await api<ChatOut>(`/api/chat/${merchant_id}`, {
        messages: history.map(({ role, content }) => ({ role, content })),
      });
      setMsgs([...history, { role: "assistant", content: out.reply, products: out.products }]);
      if (out.payment) {
        setPayment(out.payment);
        setReceipt(null);
      }
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!payment) return;
    setBusy(true);
    try {
      const out = await api<Verified>("/api/payment/verify", { order_id: payment.order_id });
      if (out.status === "PAID") {
        setReceipt(out);
        setPayment(null);
      } else {
        setNote("Payment hasn't landed yet — finish checkout, then try again.");
      }
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Loader
        done={ready}
        label={shop?.merchant.name ?? "Storefront"}
        steps={["Opening the shop", "Reading the catalog", "Ready"]}
      />

      <main className="mx-auto flex min-h-screen max-w-md flex-col border-x border-line bg-chalk">
        <header className="sticky top-0 z-10 border-b border-line bg-chalk px-5 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="display min-w-0 text-xl tracking-[-0.035em]">
              {shop?.merchant.name ?? merchant_id}
            </h1>
            <span className="inline-block size-[7px] shrink-0" style={{ background: brand }} aria-hidden />
          </div>
          <p className="label mt-1.5 leading-snug">{shop?.merchant.description}</p>
        </header>

        <div className="flex-1 space-y-6 px-5 py-6" aria-live="polite" aria-busy={busy}>
          {msgs.map((m, i) => (
            <div key={i} className="rise">
              {/* Speaker is marked by a mono label, not a coloured bubble —
                  bubbles are the thing that makes every AI chat look alike. */}
              <p className="label mb-1.5">{m.role === "user" ? "You" : "Shop"}</p>
              <p
                className={`text-[0.9375rem] leading-relaxed ${
                  m.role === "user"
                    ? "border-l-2 pl-3 text-graphite"
                    : "text-ink"
                }`}
                style={m.role === "user" ? { borderColor: brand } : undefined}
              >
                {m.content}
              </p>

              {!!m.products?.length && (
                <div className="mt-4">
                  {m.products.map((p) => (
                    <div key={p.id} className="border-t border-line py-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold">{p.name}</span>
                        <span className="font-mono text-sm">{inr(p.price)}</span>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-muted">{p.description}</p>
                      <button
                        className="label ul mt-3 label-ink"
                        onClick={() => setInput(`Yes, I'll buy the ${p.name}`)}
                      >
                        Buy this →
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {payment && (
            <div className="wipe border-y-2 border-ink py-5">
              <p className="label tick label-ink">Checkout</p>
              <p className="display display-md mt-3">{inr(payment.amount)}</p>
              <p className="mt-2 text-sm text-graphite">{payment.product.name}</p>
              <p className="label mt-3 leading-relaxed">
                Order {payment.order_id}
                {payment.simulated && " · simulated, no Razorpay keys set"}
              </p>
              <a
                href={payment.checkout_url}
                target="_blank"
                rel="noreferrer"
                className="btn mt-5 block text-center"
              >
                Pay {inr(payment.amount)}
              </a>
              <button onClick={verify} disabled={busy} className="btn btn-ghost mt-2 w-full">
                I&apos;ve paid — confirm
              </button>
            </div>
          )}

          {receipt && (
            <div className="wipe bg-ink p-5 text-chalk">
              <p className="label" style={{ color: "#7fa0ff" }}>
                <span className="mr-2 inline-block size-[5px] translate-y-[-1px] bg-[#7fa0ff]" />
                Confirmed
              </p>
              <p className="display display-md mt-3">{inr(receipt.amount ?? 0)}</p>
              <p className="mt-3 break-all font-mono text-xs opacity-70">
                {receipt.transaction_id}
              </p>
            </div>
          )}

          {note && <p role="alert" className="label text-halt">{note}</p>}
          {busy && (
            <p className="label">
              thinking<span className="blink">_</span>
            </p>
          )}
          <div ref={bottom} />
        </div>

        <form onSubmit={send} className="sticky bottom-0 flex gap-4 border-t border-line bg-chalk px-5 py-3">
          <label htmlFor="ask" className="sr-only">
            Message the shop
          </label>
          <input
            id="ask"
            name="message"
            autoComplete="off"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="something under ₹500 for fitness…"
            className="field min-w-0 flex-1"
          />
          <button disabled={busy} className="label label-ink ul disabled:opacity-35">
            Send →
          </button>
        </form>
      </main>
    </>
  );
}
