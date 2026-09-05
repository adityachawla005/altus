export type Product = {
  id: string; name: string; description: string;
  price: number; stock: number; category: string;
};
export type Merchant = {
  id: string; name: string; description: string; brand_color: string;
};
export type Rules = {
  max_autonomous_spend: number; requires_confirmation_above: number;
  substitution_allowed: boolean; refund_authority: boolean;
};
export type AuditEntry = {
  id: number; timestamp: string; merchant_id: string; agent_id: string;
  action: string; product_id: string; amount: number; reason: string;
  transaction_id: string; status: string;
};
export type Payment = {
  order_id: string; amount: number; product: Product;
  checkout_url: string; provider_id: string; simulated: boolean;
};

export const inr = (n: number) => "₹" + (n ?? 0).toLocaleString("en-IN");

export const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour12: false });

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(
    path,
    body === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  if (!res.ok) throw new Error((await res.text()).slice(0, 300) || res.statusText);
  return res.json();
}

/** Reads an SSE response body, calling onEvent for each `event:`/`data:` frame. */
export async function readSSE(
  res: Response,
  onEvent: (event: string, data: unknown) => void,
) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const frame of frames) {
      const event = /^event: (.*)$/m.exec(frame)?.[1] ?? "message";
      const data = /^data: (.*)$/m.exec(frame)?.[1];
      if (data) onEvent(event, JSON.parse(data));
    }
  }
}

export const STATUS_STYLE: Record<string, string> = {
  SUCCESS: "bg-emerald-50 text-emerald-700 border-emerald-200",
  BLOCKED: "bg-rose-50 text-rose-700 border-rose-200",
  ESCALATED: "bg-amber-50 text-amber-800 border-amber-200",
};
