"""Self-check for the money/policy path: python backend/test_altus.py

Runs fully offline — the LLM client and Razorpay credentials are stubbed out, so
what is under test is the policy gate and the audit trail, not the vendors.
"""
import os
import tempfile

os.environ["ALTUS_DB"] = tempfile.mkstemp(suffix=".db")[1]

import db  # noqa: E402
import main  # noqa: E402

main.llm._client = None                      # deterministic picker
main.pay.creds = lambda merchant=None: (None, None)   # simulated payments

MERCHANT = db.row("SELECT * FROM merchants WHERE id=?", (db.DEMO_ID,))


def run(task, budget=0):
    steps, result = [], {}
    for frame in main.run_agent(MERCHANT, task, "test_agent", budget):
        result.update(frame["result"]) if "result" in frame else steps.append(frame)
    return steps, result


def actions(steps):
    return [s["action"] for s in steps]


# within policy -> buys, logs a receipt, decrements stock
before = db.row("SELECT stock FROM products WHERE id=?", ("sharma_gifts_p2",))["stock"]
steps, out = run("a fitness product under 500")
assert out["decision"] == "PURCHASED", out
assert out["amount"] == 449 and isinstance(out["amount"], int), out
assert out["receipt"]["transaction_id"], out
assert actions(steps) == ["QUERY", "FILTER", "SELECT", "PURCHASE"], actions(steps)
after = db.row("SELECT stock FROM products WHERE id=?", ("sharma_gifts_p2",))["stock"]
assert after == before - 1, (before, after)

# above max_autonomous_spend -> blocked AND escalated, never paid
steps, out = run("a nice wrist watch, budget 5000")
assert out["decision"] == "BLOCKED", out
assert "exceeds max autonomous spend" in out["reason"], out
assert actions(steps)[-2:] == ["BLOCKED", "ESCALATED"], actions(steps)
assert not db.rows("SELECT 1 FROM orders WHERE product_id=?", ("sharma_gifts_p6",))

# between confirmation threshold and the hard cap -> escalated, not paid
steps, out = run("a yoga mat under 1800")
assert out["decision"] == "ESCALATED", out
assert actions(steps)[-1] == "ESCALATED", actions(steps)
assert not db.rows("SELECT 1 FROM orders WHERE product_id=?", ("sharma_gifts_p5",))

# nothing affordable -> no match, still logged
steps, out = run("a wrist watch under 100")
assert out["decision"] == "NO_MATCH", out

# every step above landed in the audit trail with a timestamp and a reason
trail = db.rows("SELECT * FROM audit WHERE merchant_id=?", (db.DEMO_ID,))
assert len(trail) > 10, len(trail)
assert all(e["timestamp"] and e["reason"] and e["status"] for e in trail), trail
assert {e["status"] for e in trail} == {"SUCCESS", "BLOCKED", "ESCALATED"}

# human path: payment link -> verify -> paid, with a purchase logged
p = db.row("SELECT * FROM products WHERE id=?", ("sharma_gifts_p1",))
pay_out = main._new_payment(MERCHANT, p, "human_buyer")
assert pay_out["amount"] == p["price"]
verified = main.payment_verify(main.VerifyIn(order_id=pay_out["order_id"]))
assert verified["status"] == "PAID" and verified["transaction_id"], verified
assert db.rows("SELECT 1 FROM audit WHERE transaction_id=?", (verified["transaction_id"],))

# QR/link base: a loopback config must yield to the origin the browser used,
# or the QR a merchant prints resolves to the scanning phone itself.
class _Req:
    def __init__(self, **h):
        self.headers = h


lan = _Req(**{"x-forwarded-host": "10.0.0.5:3000"})
assert main.public_base(lan) == "http://10.0.0.5:3000", main.public_base(lan)
assert main.public_base(_Req(host="10.0.0.5:3000")) == "http://10.0.0.5:3000"
assert main.public_base(_Req(**{"x-forwarded-host": "shop.example.com",
                               "x-forwarded-proto": "https"})) == "https://shop.example.com"
# a loopback origin can never be scanned off-device, so this machine's LAN
# address is substituted, keeping the port the browser was using
_lan = main._lan_ip()
if _lan:
    assert main.public_base(_Req(host="localhost:3000")) == f"http://{_lan}:3000"
    assert main.public_base(_Req(**{"x-forwarded-host": "127.0.0.1:3000"})) == f"http://{_lan}:3000"
    assert main.public_base(_Req()) == f"http://{_lan}:3000"  # port from config
else:
    assert main.public_base(_Req()) == main.BASE_URL.rstrip("/")
# an explicitly configured public domain always wins
_saved, main.BASE_URL = main.BASE_URL, "https://altus.example/"
assert main.public_base(lan) == "https://altus.example"
main.BASE_URL = _saved

# and the QR itself must be a standalone SVG document, not an inline fragment
qr_svg = main.qr(db.DEMO_ID, lan).body.decode()
assert 'xmlns="http://www.w3.org/2000/svg"' in qr_svg, qr_svg[:120]
assert "10.0.0.5:3000" not in qr_svg  # the URL is encoded, not written as text

os.unlink(os.environ["ALTUS_DB"])
print("ok — policy gate, audit trail, payment paths and QR links hold")
