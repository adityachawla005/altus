"""SQLite storage for Altus.

Money is stored as whole rupees in INTEGER columns — no floats anywhere on the
money path. Razorpay wants paise, so multiply by 100 at the boundary only.

ponytail: raw sqlite3 + ANSI-ish SQL. For Postgres in prod, swap _connect() for
psycopg and the `?` placeholders for `%s`; the queries themselves carry over.
"""
import os
import sqlite3
import secrets
from contextlib import contextmanager
from datetime import datetime, timezone

DB_PATH = os.getenv("ALTUS_DB", os.path.join(os.path.dirname(__file__), "altus.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  brand_color TEXT DEFAULT '#4f46e5',
  razorpay_key_id TEXT DEFAULT '',
  razorpay_key_secret TEXT DEFAULT '',
  max_autonomous_spend INTEGER NOT NULL DEFAULT 2000,
  requires_confirmation_above INTEGER NOT NULL DEFAULT 1500,
  substitution_allowed INTEGER NOT NULL DEFAULT 0,
  refund_authority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  category TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  product_id TEXT,
  buyer TEXT NOT NULL,
  amount INTEGER NOT NULL,
  provider_id TEXT,
  payment_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  agent_id TEXT DEFAULT '',
  action TEXT NOT NULL,
  product_id TEXT DEFAULT '',
  amount INTEGER DEFAULT 0,
  reason TEXT DEFAULT '',
  transaction_id TEXT DEFAULT '',
  status TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_merchant ON audit(merchant_id, id);
CREATE INDEX IF NOT EXISTS products_merchant ON products(merchant_id);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(4)}"


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def rows(sql, args=()):
    with db() as c:
        return [dict(r) for r in c.execute(sql, args)]


def row(sql, args=()):
    r = rows(sql, args)
    return r[0] if r else None


def log(merchant_id, action, status, agent_id="", product_id="", amount=0,
        reason="", transaction_id=""):
    """Append one audit entry and return it."""
    entry = dict(timestamp=now(), merchant_id=merchant_id, agent_id=agent_id,
                 action=action, product_id=product_id, amount=amount,
                 reason=reason, transaction_id=transaction_id, status=status)
    with db() as c:
        cur = c.execute(
            "INSERT INTO audit (timestamp,merchant_id,agent_id,action,product_id,"
            "amount,reason,transaction_id,status) VALUES (?,?,?,?,?,?,?,?,?)",
            tuple(entry[k] for k in ("timestamp", "merchant_id", "agent_id", "action",
                                     "product_id", "amount", "reason",
                                     "transaction_id", "status")))
        entry["id"] = cur.lastrowid
    return entry


def create_merchant(m: dict, products: list[dict]) -> str:
    mid = m.get("id") or new_id("mrc")
    with db() as c:
        c.execute(
            "INSERT INTO merchants (id,name,description,brand_color,razorpay_key_id,"
            "razorpay_key_secret,max_autonomous_spend,requires_confirmation_above,"
            "substitution_allowed,refund_authority,created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (mid, m["name"], m.get("description", ""), m.get("brand_color") or "#4f46e5",
             m.get("razorpay_key_id", ""), m.get("razorpay_key_secret", ""),
             int(m.get("max_autonomous_spend", 2000)),
             int(m.get("requires_confirmation_above", 1500)),
             int(bool(m.get("substitution_allowed"))),
             int(bool(m.get("refund_authority"))), now()))
        for p in products:
            c.execute(
                "INSERT INTO products (id,merchant_id,name,description,price,stock,category)"
                " VALUES (?,?,?,?,?,?,?)",
                (p.get("id") or new_id("prd"), mid, p["name"], p.get("description", ""),
                 int(p["price"]), int(p.get("stock", 0)), p.get("category", "")))
    return mid


DEMO_ID = "sharma_gifts"
DEMO_PRODUCTS = [
    ("Handmade Mysore Sandal Soap Set", "Six bars of pure sandalwood soap, gift boxed.", 249, 40, "gifting"),
    ("Resistance Band Set", "Five latex bands, light to heavy. Fitness starter kit.", 449, 25, "fitness"),
    ("Steel Gym Water Bottle 1L", "Insulated, leak proof, fits a gym bag side pocket.", 599, 30, "fitness"),
    ("Brass Diya Pair", "Traditional hand-cast brass lamps for the pooja shelf.", 1200, 12, "gifting"),
    ("Yoga Mat 6mm", "Non-slip TPE mat with carry strap.", 1750, 8, "fitness"),
    ("Titan Analog Wrist Watch", "Leather strap dress watch, two year warranty.", 4500, 5, "premium"),
]


def seed_demo():
    """Idempotent: only inserts the demo merchant if it isn't there yet."""
    if row("SELECT id FROM merchants WHERE id=?", (DEMO_ID,)):
        return DEMO_ID
    return create_merchant(
        {"id": DEMO_ID, "name": "Sharma Gifts, Bengaluru",
         "description": "Gifting and fitness essentials from Jayanagar 4th Block. "
                        "Family run since 1998.",
         "brand_color": "#c2410c",
         "max_autonomous_spend": 2000, "requires_confirmation_above": 1500,
         "substitution_allowed": False, "refund_authority": False},
        [{"id": f"{DEMO_ID}_p{i}", "name": n, "description": d, "price": pr,
          "stock": st, "category": cat}
         for i, (n, d, pr, st, cat) in enumerate(DEMO_PRODUCTS, 1)])


def init():
    with db() as c:
        c.executescript(SCHEMA)
    seed_demo()
