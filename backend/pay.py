"""Razorpay test-mode calls over the raw REST API.

stdlib urllib — the SDK would be one more dependency for four HTTP calls.
Amounts cross this boundary in paise; everywhere else in Altus they are rupees.

Without RAZORPAY_KEY_ID/SECRET the module runs in simulated mode so the demo
works before keys are pasted in. Simulated objects carry `"simulated": True`
and their ids are prefixed `sim_` — they are never presented as real receipts.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import urllib.error
import urllib.request

API = "https://api.razorpay.com/v1"
BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:3000")


def creds(merchant: dict | None = None):
    """Altus currently runs checkout entirely in simulated mode.

    Keep this decision at the payment boundary so credentials left over from an
    earlier onboarding cannot turn a chat reply into a failed network payment.
    """
    return (None, None)


def _call(method, path, cred, body=None):
    auth = base64.b64encode(f"{cred[0]}:{cred[1]}".encode()).decode()
    req = urllib.request.Request(
        API + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", "Authorization": "Basic " + auth})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:400]
        raise RuntimeError(f"Razorpay {e.code}: {detail}") from None
    except urllib.error.URLError as e:
        raise RuntimeError(f"Razorpay unreachable: {e.reason}") from None


def payment_link(merchant, amount, description, reference_id, callback_url=None):
    """Checkout link for a human buyer. `amount` is rupees."""
    cred = creds(merchant)
    if not cred[0]:
        pid = "sim_plink_" + secrets.token_hex(6)
        return {"id": pid, "short_url": f"{BASE_URL}/api/payment/simulate/{pid}",
                "status": "created", "amount": amount * 100, "simulated": True}
    body = {"amount": amount * 100, "currency": "INR", "description": description[:200],
            "reference_id": reference_id, "notify": {"sms": False, "email": False},
            "reminder_enable": False}
    if callback_url:
        body |= {"callback_url": callback_url, "callback_method": "get"}
    return _call("POST", "/payment_links", cred, body) | {"simulated": False}


def fetch_payment_link(merchant, plink_id):
    if plink_id.startswith("sim_"):
        return {"id": plink_id, "status": "paid", "payment_id": "sim_pay_" + plink_id[-6:],
                "simulated": True}
    r = _call("GET", f"/payment_links/{plink_id}", creds(merchant))
    paid = [p for p in r.get("payments") or [] if p.get("status") == "captured"]
    return r | {"payment_id": paid[0]["payment_id"] if paid else None, "simulated": False}


def order(merchant, amount, receipt):
    """Order for the autonomous agent path. `amount` is rupees."""
    cred = creds(merchant)
    if not cred[0]:
        return {"id": "sim_order_" + secrets.token_hex(6), "amount": amount * 100,
                "status": "created", "simulated": True}
    return _call("POST", "/orders", cred,
                 {"amount": amount * 100, "currency": "INR", "receipt": receipt[:40],
                  "payment_capture": 1}) | {"simulated": False}


def verify_signature(merchant, order_id, payment_id, signature) -> bool:
    """Standard Razorpay checkout signature check: HMAC-SHA256(order|payment)."""
    secret = creds(merchant)[1]
    if not secret:
        return False
    expected = hmac.new(secret.encode(), f"{order_id}|{payment_id}".encode(),
                        hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")
