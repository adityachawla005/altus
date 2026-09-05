# Altus

Makes a small merchant transactable twice over: a chat storefront for people, and
a machine endpoint with a spending passport for AI buyers. One catalog, one audit
trail, Razorpay test mode underneath.

```
frontend/   Next.js 15 App Router + Tailwind — all the UI
backend/    FastAPI + SQLite — every /api/* route
```

Next.js owns no API routes. `frontend/next.config.ts` rewrites `/api/*` to
FastAPI on :8000, so the browser, a phone on the LAN, and a third-party agent all
hit the same origin and the same code.

## Run it

```bash
cp .env.example .env      # keys optional, see below
./dev.sh                  # http://localhost:3000
```

First boot seeds **Sharma Gifts, Bengaluru** with six products (₹249 – ₹4500) and
the policy `max_autonomous_spend=2000`, `requires_confirmation_above=1500`.

Self-check for the policy and money paths, offline:

```bash
backend/.venv/bin/python backend/test_altus.py
```

## The five surfaces

| Page | What it does |
|---|---|
| `/onboard` | Shop details, catalog builder, agent policy → merchant id, QR code, agent endpoint |
| `/shop/[merchant_id]` | Mobile-first chat storefront; Claude reads the catalog, then a Razorpay link closes the sale in-chat |
| `/dashboard/[merchant_id]` | Live audit trail, filterable by completed / blocked / escalated |
| `/demo` | Give an agent a task and a budget, watch each step stream in, see the receipt or the block |
| `/api/agent/[merchant_id]` | The Agent Passport — catalog plus the rules a machine buyer must obey |

## API

```
GET  /api/agent/{merchant_id}            Agent Passport + catalog
POST /api/agent/{merchant_id}/buy        Autonomous purchase  (?stream=1 for SSE)
POST /api/chat/{merchant_id}             Human chat with the shop
POST /api/payment/create                 Razorpay payment link
POST /api/payment/verify                 Confirm a payment (signature or link status)
GET  /api/audit/{merchant_id}            Full audit trail
POST /api/merchants                      Onboard a merchant
GET  /api/qr/{merchant_id}               Storefront QR as SVG
```

## Policy is enforced in code, not by the model

`llm.pick()` only proposes a product. `run_agent()` in `backend/main.py` decides
what happens to it, in this order:

1. over `max_autonomous_spend` → **BLOCKED**, then **ESCALATED** to the merchant
2. over `requires_confirmation_above` → **ESCALATED**, awaiting a human
3. otherwise → Razorpay order, stock decremented, receipt returned

Every branch writes an audit row with a timestamp, the amount, and the reason —
so a blocked ₹4500 watch reads back as
`❌ Purchase blocked — ₹4500 Titan Analog Wrist Watch exceeds max autonomous spend (₹2000)`.

## Keys

Both are optional; Altus degrades to something you can still demo.

- `ANTHROPIC_API_KEY` — without it, chat and the agent fall back to a
  deterministic keyword/price matcher. Responses report `"model": "fallback"`.
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — test mode. Without them, checkout is
  simulated: ids are prefixed `sim_`, and every receipt carries `simulated: true`.
  A merchant may also supply its own keys at onboarding, which take precedence.
- `PUBLIC_BASE_URL` — set this to your LAN IP (`http://192.168.x.x:3000`) before
  generating QR codes, or a phone will scan a link to its own localhost.

## Notes

Money is whole rupees in `INTEGER` columns everywhere; paise conversion happens
only at the Razorpay boundary. The autonomous path creates a real test-mode order
and books it as `PAID_TEST_MODE` — Razorpay has no server-side API to actually
pay an order without a checkout, so nothing here claims a captured payment it
didn't get. The human path is a genuine end-to-end test-mode payment.

Not built, as scoped: auth (merchant_id is the identifier), live payments,
multi-currency.
