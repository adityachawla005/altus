"""Claude calls for the shop chat and the buying agent.

Both calls use structured outputs, so the caller always gets parseable JSON and
never has to scrape prose. The model never decides policy — it only picks a
product; spend limits are enforced in main.py.

Without ANTHROPIC_API_KEY both fall back to a deterministic keyword/price match
so the demo is runnable before keys are pasted in. `source` says which ran.
"""
import json
import os
import re

import anthropic

MODEL = os.getenv("ALTUS_MODEL", "claude-sonnet-4-6")
_client = anthropic.Anthropic() if os.getenv("ANTHROPIC_API_KEY") else None


def _schema(props):
    return {"format": {"type": "json_schema", "schema": {
        "type": "object", "properties": props, "required": list(props),
        "additionalProperties": False}}}


def _ask(system, user, props, max_tokens=1500):
    r = _client.messages.create(
        model=MODEL, max_tokens=max_tokens, system=system,
        messages=user, output_config=_schema(props))
    text = next(b.text for b in r.content if b.type == "text")
    return json.loads(text)


def _catalog(products):
    return json.dumps([{k: p[k] for k in
                        ("id", "name", "description", "price", "stock", "category")}
                       for p in products], indent=1)


def _score(product, text):
    """Cheap bag-of-words overlap used by the no-API-key fallback."""
    words = set(re.findall(r"[a-z]{3,}", text.lower()))
    hay = set(re.findall(r"[a-z]{3,}",
                         f"{product['name']} {product['description']} {product['category']}".lower()))
    return len(words & hay)


# --- human chat -------------------------------------------------------------

CHAT_SYSTEM = """You are the shop assistant for {name}, an Indian small business.
{description}

Catalog (prices in rupees, only these products exist):
{catalog}

Rules:
- Recommend only products from the catalog that have stock > 0.
- Prices are in whole rupees. Write them as ₹499.
- Keep replies under 60 words, warm and direct. No markdown headings or bullets.
- Put the ids of anything you recommend in product_ids.
- Set purchase_product_id ONLY when the buyer has clearly confirmed they want to
  buy one specific item ("yes, buy the bands", "I'll take the bottle"). Otherwise
  leave it as an empty string. Never assume a confirmation."""


def chat(merchant, products, history):
    if not _client:
        last = history[-1]["content"] if history else ""
        budget = _budget(last)
        pool = [p for p in products if p["stock"] > 0 and (not budget or p["price"] <= budget)]
        pool.sort(key=lambda p: (-_score(p, last), p["price"]))
        buy = next((p for p in pool if re.search(r"\b(buy|take|yes|confirm|order)\b",
                                                 last, re.I)), None)
        picks = pool[:3]
        reply = ("Here's what I'd suggest: "
                 + ", ".join(f"{p['name']} at ₹{p['price']}" for p in picks)
                 if picks else "I don't have anything matching that right now.")
        return {"reply": reply, "product_ids": [p["id"] for p in picks],
                "purchase_product_id": buy["id"] if buy else "", "source": "fallback"}

    out = _ask(
        CHAT_SYSTEM.format(name=merchant["name"], description=merchant["description"],
                           catalog=_catalog(products)),
        [{"role": m["role"], "content": m["content"]} for m in history],
        {"reply": {"type": "string"},
         "product_ids": {"type": "array", "items": {"type": "string"}},
         "purchase_product_id": {"type": "string"}})
    return out | {"source": MODEL}


# --- agent buyer ------------------------------------------------------------

PICK_SYSTEM = """You are a purchasing agent buying on behalf of a user from
{name}. Choose at most one product from the catalog that best fits the task.

Catalog (prices in whole rupees):
{catalog}

Rules:
- Only choose a product with stock > 0.
- Respect any budget stated in the task; if nothing fits, return an empty
  product_id and explain why.
- reasoning: one sentence, name the product and the price, and say why it fits.
- Do not consider the merchant's spending policy — that is enforced separately."""


def _budget(task):
    """Largest rupee figure mentioned in the task, if any."""
    nums = [int(n.replace(",", "")) for n in
            re.findall(r"(?:₹|rs\.?\s*|inr\s*)?([\d,]{2,9})", task, re.I)]
    return max(nums) if nums else 0


def pick(merchant, products, task, budget=0):
    budget = budget or _budget(task)
    task_line = task if not budget else f"{task}\n(Hard budget: ₹{budget})"
    available = [p for p in products if p["stock"] > 0
                 and (not budget or p["price"] <= budget)]

    if not _client:
        available.sort(key=lambda p: (-_score(p, task), p["price"]))
        if not available:
            return {"product_id": "", "budget": budget, "source": "fallback",
                    "reasoning": f"No in-stock product fits the task within ₹{budget}."
                    if budget else "No in-stock product matches the task."}
        p = available[0]
        return {"product_id": p["id"], "budget": budget, "source": "fallback",
                "reasoning": f"{p['name']} at ₹{p['price']} is the closest keyword "
                             f"match in stock."}

    out = _ask(PICK_SYSTEM.format(name=merchant["name"], catalog=_catalog(available)),
               [{"role": "user", "content": task_line}],
               {"product_id": {"type": "string"}, "reasoning": {"type": "string"}})
    return out | {"budget": budget, "source": MODEL}
