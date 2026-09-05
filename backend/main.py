"""Altus API — one FastAPI app behind Next.js (see frontend/next.config.ts rewrites)."""
import io
import json
import os
import socket
from typing import Any, Iterator

import segno
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

import db  # noqa: E402  (needs env loaded for ALTUS_DB)
import llm  # noqa: E402
import pay  # noqa: E402

BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:3000")

# A QR encoding "localhost" is unscannable by definition — the phone resolves
# it to itself. Whenever a link is destined for another device we work out an
# address that device can actually reach, no matter how the browser got here.
_LOOPBACK = ("localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]")


def _is_loopback(host: str) -> bool:
    """True for a host[:port] or URL that only resolves on this machine."""
    name = host.split("//")[-1].split("/")[0]
    name = name.rsplit(":", 1)[0] if name.count(":") == 1 else name
    return name.strip("[]").lower() in {h.strip("[]") for h in _LOOPBACK}


def _lan_ip() -> str | None:
    """This machine's address on the network it routes through.

    Connecting a UDP socket sends nothing; it just asks the kernel which
    interface would carry the traffic, which is the address a phone on the
    same wifi can reach. Re-read per call so it survives changing networks.
    """
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("1.1.1.1", 80))
            ip = s.getsockname()[0]
        return None if ip.startswith("127.") else ip
    except OSError:
        return None


def public_base(request: Request) -> str:
    """The origin a link handed to another device should point at.

    Next rewrites /api/* to this server and forwards x-forwarded-host, so the
    address the merchant is browsing on reaches us intact. If they browsed
    localhost, that address is useless to a phone, so this machine's LAN
    address is substituted instead — a QR is worth nothing off-device.
    """
    configured = BASE_URL.rstrip("/")
    if not _is_loopback(configured):
        return configured

    host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
    proto = request.headers.get("x-forwarded-proto", "http")
    if host and not _is_loopback(host):
        return f"{proto}://{host}"

    lan = _lan_ip()
    if not lan:
        return configured  # offline: nothing better to offer
    # Keep the port the browser was using, falling back to the configured one.
    port = host.rsplit(":", 1)[-1] if ":" in host else ""
    if not port.isdigit():
        port = configured.rsplit(":", 1)[-1]
    return f"{proto}://{lan}:{port}" if port.isdigit() else f"{proto}://{lan}"

db.init()

app = FastAPI(title="Altus")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                   allow_headers=["*"])


# --- helpers ----------------------------------------------------------------

def merchant_or_404(mid: str) -> dict:
    m = db.row("SELECT * FROM merchants WHERE id=?", (mid,))
    if not m:
        raise HTTPException(404, f"No merchant {mid}")
    return m


def catalog(mid: str) -> list[dict]:
    return db.rows("SELECT * FROM products WHERE merchant_id=? ORDER BY price", (mid,))


def policy(m: dict) -> dict:
    return {"max_autonomous_spend": m["max_autonomous_spend"],
            "requires_confirmation_above": m["requires_confirmation_above"],
            "substitution_allowed": bool(m["substitution_allowed"]),
            "refund_authority": bool(m["refund_authority"])}


# --- onboarding -------------------------------------------------------------

class ProductIn(BaseModel):
    name: str
    description: str = ""
    price: int = Field(ge=0)
    stock: int = Field(default=0, ge=0)
    category: str = ""


class MerchantIn(BaseModel):
    name: str
    description: str = ""
    brand_color: str = "#4f46e5"
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    max_autonomous_spend: int = Field(default=2000, ge=0)
    requires_confirmation_above: int = Field(default=1500, ge=0)
    substitution_allowed: bool = False
    refund_authority: bool = False
    products: list[ProductIn] = []


def links(mid: str, request: Request) -> dict:
    base = public_base(request)
    return {"merchant_id": mid,
            "shop_url": f"{base}/shop/{mid}",
            "dashboard_url": f"{base}/dashboard/{mid}",
            "agent_endpoint": f"{base}/api/agent/{mid}",
            "qr_url": f"/api/qr/{mid}"}


@app.post("/api/merchants")
def create_merchant(m: MerchantIn, request: Request):
    if not m.name.strip():
        raise HTTPException(400, "Merchant name is required")
    mid = db.create_merchant(m.model_dump(exclude={"products"}),
                             [p.model_dump() for p in m.products])
    db.log(mid, "QUERY", "SUCCESS", reason=f"Merchant onboarded with "
           f"{len(m.products)} products")
    return links(mid, request)


@app.get("/api/merchants")
def list_merchants():
    return db.rows("SELECT id, name, description, brand_color FROM merchants "
                   "ORDER BY created_at")


@app.get("/api/merchants/{mid}")
def get_merchant(mid: str, request: Request):
    m = merchant_or_404(mid)
    return {"merchant": {k: m[k] for k in ("id", "name", "description", "brand_color")},
            "products": catalog(mid), "rules": policy(m), **links(mid, request)}


@app.get("/api/qr/{mid}")
def qr(mid: str, request: Request):
    merchant_or_404(mid)
    # save(kind="svg") emits a standalone document with the SVG namespace.
    # svg_inline() omits xmlns, which browsers silently refuse to render when
    # the file is fetched through <img src> rather than inlined into HTML.
    # error="q" survives ~25% damage — a QR on a shop counter gets scuffed.
    buf = io.BytesIO()
    segno.make(f"{public_base(request)}/shop/{mid}", error="q").save(
        buf, kind="svg", scale=6, border=2, dark="#111111")
    return Response(buf.getvalue(), media_type="image/svg+xml",
                    headers={"Cache-Control": "no-store"})


# --- agent passport ---------------------------------------------------------

@app.get("/api/agent/{mid}")
def passport(mid: str):
    m = merchant_or_404(mid)
    rules = policy(m)
    return {
        "merchant": {"name": m["name"], "id": m["id"], "description": m["description"]},
        "capabilities": ["browse", "purchase", "check_inventory"],
        "products": [{"id": p["id"], "name": p["name"], "description": p["description"],
                      "category": p["category"], "price": p["price"], "stock": p["stock"],
                      "currency": "INR",
                      "purchase_allowed": p["stock"] > 0
                      and p["price"] <= rules["max_autonomous_spend"]}
                     for p in catalog(mid)],
        "rules": rules,
        "endpoints": {"buy": f"{BASE_URL}/api/agent/{mid}/buy",
                      "audit": f"{BASE_URL}/api/audit/{mid}"},
    }


# --- autonomous purchase ----------------------------------------------------

class BuyIn(BaseModel):
    task: str
    agent_id: str = "demo_agent_001"
    budget: int = 0


def run_agent(m: dict, task: str, agent_id: str, budget: int = 0) -> Iterator[dict]:
    """Yields audit entries as they happen, then one {"result": ...} frame.

    Policy is enforced here, in code — the model only proposes a product.
    """
    mid, rules = m["id"], policy(m)
    products = catalog(mid)
    yield db.log(mid, "QUERY", "SUCCESS", agent_id=agent_id,
                 reason=f"Fetched agent passport for {m['name']}: {len(products)} "
                        f"products, max autonomous spend ₹{rules['max_autonomous_spend']}")

    decision = llm.pick(m, products, task, budget)
    cap = decision["budget"]
    in_stock = [p for p in products if p["stock"] > 0]
    yield db.log(mid, "FILTER", "SUCCESS", agent_id=agent_id,
                 reason=f"{len(in_stock)} of {len(products)} products in stock"
                        + (f"; task budget ₹{cap}" if cap else "; no task budget stated"))

    chosen = next((p for p in products if p["id"] == decision["product_id"]), None)
    if not chosen:
        e = db.log(mid, "BLOCKED", "BLOCKED", agent_id=agent_id,
                   reason=decision["reasoning"] or "No suitable product found")
        yield e
        yield {"result": {"decision": "NO_MATCH", "reasoning": decision["reasoning"],
                          "model": decision["source"]}}
        return

    yield db.log(mid, "SELECT", "SUCCESS", agent_id=agent_id, product_id=chosen["id"],
                 amount=chosen["price"], reason=decision["reasoning"])

    price = chosen["price"]
    if price > rules["max_autonomous_spend"]:
        why = (f"₹{price} {chosen['name']} exceeds max autonomous spend "
               f"(₹{rules['max_autonomous_spend']})")
        yield db.log(mid, "BLOCKED", "BLOCKED", agent_id=agent_id,
                     product_id=chosen["id"], amount=price,
                     reason=f"Purchase blocked — {why}")
        yield db.log(mid, "ESCALATED", "ESCALATED", agent_id=agent_id,
                     product_id=chosen["id"], amount=price,
                     reason=f"{why} → escalated to merchant for human approval")
        yield {"result": {"decision": "BLOCKED", "product": chosen, "amount": price,
                          "reason": why, "reasoning": decision["reasoning"],
                          "model": decision["source"]}}
        return

    if price > rules["requires_confirmation_above"]:
        why = (f"₹{price} is above the human confirmation threshold "
               f"(₹{rules['requires_confirmation_above']})")
        yield db.log(mid, "ESCALATED", "ESCALATED", agent_id=agent_id,
                     product_id=chosen["id"], amount=price,
                     reason=f"{why} → awaiting human confirmation")
        yield {"result": {"decision": "ESCALATED", "product": chosen, "amount": price,
                          "reason": why, "reasoning": decision["reasoning"],
                          "model": decision["source"]}}
        return

    order_id = db.new_id("ord")
    try:
        rp = pay.order(m, price, order_id)
    except RuntimeError as err:
        yield db.log(mid, "BLOCKED", "BLOCKED", agent_id=agent_id,
                     product_id=chosen["id"], amount=price,
                     reason=f"Payment provider error — {err}")
        yield {"result": {"decision": "FAILED", "product": chosen, "amount": price,
                          "reason": str(err)}}
        return

    with db.db() as c:
        c.execute("INSERT INTO orders (id,merchant_id,product_id,buyer,amount,"
                  "provider_id,payment_id,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                  (order_id, mid, chosen["id"], agent_id, price, rp["id"], rp["id"],
                   "PAID_TEST_MODE", db.now()))
        c.execute("UPDATE products SET stock=stock-1 WHERE id=? AND stock>0",
                  (chosen["id"],))
    yield db.log(mid, "PURCHASE", "SUCCESS", agent_id=agent_id, product_id=chosen["id"],
                 amount=price, transaction_id=rp["id"],
                 reason=f"Purchased {chosen['name']} for ₹{price} — within autonomous "
                        f"limit (₹{rules['max_autonomous_spend']})")
    yield {"result": {"decision": "PURCHASED", "product": chosen, "amount": price,
                      "reasoning": decision["reasoning"], "model": decision["source"],
                      "receipt": {"order_id": order_id, "transaction_id": rp["id"],
                                  "amount_inr": price, "status": "PAID_TEST_MODE",
                                  "simulated": rp.get("simulated", False)}}}


@app.post("/api/agent/{mid}/buy")
def agent_buy(mid: str, body: BuyIn, stream: bool = False):
    m = merchant_or_404(mid)
    steps: list[dict[str, Any]] = []

    if not stream:
        result: dict = {}
        for frame in run_agent(m, body.task, body.agent_id, body.budget):
            (result.update(frame["result"]) if "result" in frame else steps.append(frame))
        return {"task": body.task, "agent_id": body.agent_id, **result, "audit": steps}

    def sse():
        for frame in run_agent(m, body.task, body.agent_id, body.budget):
            kind = "result" if "result" in frame else "step"
            yield f"event: {kind}\ndata: {json.dumps(frame.get('result', frame))}\n\n"
        yield "event: done\ndata: {}\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store",
                                      "X-Accel-Buffering": "no"})


# --- human chat -------------------------------------------------------------

class Msg(BaseModel):
    role: str
    content: str


class ChatIn(BaseModel):
    messages: list[Msg]
    buyer: str = "human_buyer"


@app.post("/api/chat/{mid}")
def chat(mid: str, body: ChatIn):
    m = merchant_or_404(mid)
    products = catalog(mid)
    history = [x.model_dump() for x in body.messages if x.role in ("user", "assistant")]
    if not history or history[-1]["role"] != "user":
        raise HTTPException(400, "Last message must be from the user")

    out = llm.chat(m, products, history)
    db.log(mid, "QUERY", "SUCCESS", agent_id=body.buyer,
           reason=f'Buyer asked: "{history[-1]["content"][:120]}"')

    recommended = [p for p in products if p["id"] in (out.get("product_ids") or [])]
    payment = None
    buy = next((p for p in products if p["id"] == out.get("purchase_product_id")), None)
    if buy and buy["stock"] > 0:
        payment = _new_payment(m, buy, body.buyer)

    return {"reply": out["reply"], "products": recommended, "payment": payment,
            "model": out["source"]}


# --- payments ---------------------------------------------------------------

class PaymentIn(BaseModel):
    merchant_id: str
    product_id: str
    buyer: str = "human_buyer"


class VerifyIn(BaseModel):
    order_id: str
    razorpay_payment_id: str = ""
    razorpay_order_id: str = ""
    razorpay_signature: str = ""


def _new_payment(m: dict, product: dict, buyer: str) -> dict:
    order_id = db.new_id("ord")
    link = pay.payment_link(m, product["price"], f"{product['name']} — {m['name']}",
                            order_id, f"{BASE_URL}/shop/{m['id']}?paid={order_id}")
    with db.db() as c:
        c.execute("INSERT INTO orders (id,merchant_id,product_id,buyer,amount,"
                  "provider_id,status,created_at) VALUES (?,?,?,?,?,?,?,?)",
                  (order_id, m["id"], product["id"], buyer, product["price"],
                   link["id"], "PENDING", db.now()))
    db.log(m["id"], "SELECT", "SUCCESS", agent_id=buyer, product_id=product["id"],
           amount=product["price"], transaction_id=link["id"],
           reason=f"Payment link created for {product['name']} (₹{product['price']})")
    return {"order_id": order_id, "amount": product["price"], "product": product,
            "checkout_url": link["short_url"], "provider_id": link["id"],
            "simulated": link.get("simulated", False)}


@app.post("/api/payment/create")
def payment_create(body: PaymentIn):
    m = merchant_or_404(body.merchant_id)
    p = db.row("SELECT * FROM products WHERE id=? AND merchant_id=?",
               (body.product_id, body.merchant_id))
    if not p:
        raise HTTPException(404, "No such product for this merchant")
    if p["stock"] <= 0:
        raise HTTPException(409, f"{p['name']} is out of stock")
    return _new_payment(m, p, body.buyer)


@app.post("/api/payment/verify")
def payment_verify(body: VerifyIn):
    o = db.row("SELECT * FROM orders WHERE id=?", (body.order_id,))
    if not o:
        raise HTTPException(404, "Unknown order")
    m = merchant_or_404(o["merchant_id"])
    if o["status"] == "PAID":
        return {"status": "PAID", "order_id": o["id"], "transaction_id": o["payment_id"],
                "amount": o["amount"]}

    if body.razorpay_signature:
        ok = pay.verify_signature(m, body.razorpay_order_id or o["provider_id"],
                                  body.razorpay_payment_id, body.razorpay_signature)
        payment_id = body.razorpay_payment_id
    else:
        try:
            link = pay.fetch_payment_link(m, o["provider_id"])
        except RuntimeError as err:
            raise HTTPException(502, str(err)) from None
        ok = link.get("status") == "paid"
        payment_id = link.get("payment_id") or o["provider_id"]

    if not ok:
        db.log(m["id"], "BLOCKED", "BLOCKED", agent_id=o["buyer"],
               product_id=o["product_id"], amount=o["amount"],
               reason="Payment not completed or signature mismatch")
        return {"status": "PENDING", "order_id": o["id"],
                "reason": "Payment not completed yet"}

    with db.db() as c:
        c.execute("UPDATE orders SET status='PAID', payment_id=? WHERE id=?",
                  (payment_id, o["id"]))
        c.execute("UPDATE products SET stock=stock-1 WHERE id=? AND stock>0",
                  (o["product_id"],))
    p = db.row("SELECT name FROM products WHERE id=?", (o["product_id"],))
    db.log(m["id"], "PURCHASE", "SUCCESS", agent_id=o["buyer"],
           product_id=o["product_id"], amount=o["amount"], transaction_id=payment_id,
           reason=f"Payment confirmed for {p['name'] if p else o['product_id']} "
                  f"(₹{o['amount']})")
    return {"status": "PAID", "order_id": o["id"], "transaction_id": payment_id,
            "amount": o["amount"], "product": p["name"] if p else ""}


@app.get("/api/payment/simulate/{plink_id}", response_class=HTMLResponse)
def simulate_checkout(plink_id: str):
    """Stand-in for the Razorpay checkout page when no API keys are configured."""
    return (f"<!doctype html><meta name=viewport content='width=device-width'>"
            f"<body style='font:16px system-ui;padding:3rem;max-width:32rem;margin:auto'>"
            f"<h2>Simulated Razorpay checkout</h2>"
            f"<p>No <code>RAZORPAY_KEY_ID</code> configured, so this stands in for the "
            f"real test-mode checkout. Reference <code>{plink_id}</code> is marked paid."
            f"</p><p>Close this tab and press <b>I've paid</b> in the chat.</p></body>")


# --- audit ------------------------------------------------------------------

@app.get("/api/audit/{mid}")
def audit(mid: str, limit: int = 200, since: int = 0):
    merchant_or_404(mid)
    return db.rows("SELECT * FROM audit WHERE merchant_id=? AND id>? "
                   "ORDER BY id DESC LIMIT ?", (mid, since, limit))
