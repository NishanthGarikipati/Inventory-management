# Dukaan — AI-powered inventory and business management for small shops

A mobile-first app for small businesses in India: stock, billing, purchases, customers, suppliers,
payments, expenses and reports, with a camera-driven **Smart Scanner** that reads supplier invoices,
product labels and stock sheets and turns them into proposed changes the owner confirms.

> Simple on the surface. Powerful underneath.

One codebase serves eleven kinds of shop — kirana, grocery, pharmacy, electronics, stationery,
bakery, boutique, hardware, restaurant, mobile accessories and cosmetics — through a common core
plus per-industry configuration, not eleven applications.

---

## What is in the box

| | |
|---|---|
| **`server/`** | Node 20 + TypeScript + Express + Prisma. Multi-tenant REST API, inventory ledger, POS, purchases, returns, expenses, reports, notifications, audit log, offline sync, and the image-scanner pipeline. |
| **`mobile/`** | React 18 + TypeScript + Vite PWA, Android-first, installable, offline-capable. Four tabs: HOME, SELL, STOCK, MORE. |
| **`docs/`** | [Architecture](docs/architecture.md), [API reference](docs/api.md), [module guide](docs/modules.md). |

---

## Quick start

```bash
npm install

# Create the SQLite database and the Prisma client
npm run db:push --workspace=server
npm exec --workspace=server prisma generate

# Fill it with eleven demo shops, their products, sales, purchases,
# expenses and sample scanner images
npm run seed

# Terminal 1 — API on http://localhost:4000
npm run dev:server

# Terminal 2 — PWA on http://localhost:5173 (proxies /api to the server)
npm run dev:mobile
```

The seed prints a login for every demo shop. Each one is a phone number and the PIN `1234`.

To try it on a phone, run the Vite dev server with `--host` (it already binds to `0.0.0.0`) and open
the machine's LAN address. Chrome on Android will offer to install it; camera scanning needs HTTPS
or `localhost`, so use a tunnel such as `ngrok` when testing the scanner from a real handset.

### Every script

| Command | What it does |
|---|---|
| `npm run dev` | Server and PWA together |
| `npm run build` | Compiles the server and builds the PWA into `mobile/dist` |
| `npm test` | The full backend suite (142 tests) |
| `npm run typecheck` | TypeScript over both workspaces |
| `npm run db:push` | Applies `prisma/schema.prisma` to the database |
| `npm run seed` | Rebuilds the demo data for all eleven business types |

Configuration lives in `server/.env` — copy [`server/.env.example`](server/.env.example). Nothing
needs an API key: the scanner falls back to a deterministic on-server reader unless you set
`AI_PROVIDER=openai`.

---

## The three workflows the app is built around

**Sell.** Open the app → SELL → scan or search → quantity → payment → done. The catalogue lives on
the phone, so billing never waits for the network and never stops when it disappears.

**Purchase.** Open the app → SCAN INVOICE → take a photo → the server reads it → review what it
found → confirm → stock, supplier balance and the purchase record all move together.

**Stock check.** Open the app → STOCK → search or scan → see the level → adjust with a reason →
confirm.

---

## How the AI scanner is kept safe

The scanner never writes to the books. It proposes.

```
photo → quality check → barcode detection → OCR / vision extraction
      → structured JSON → schema validation → business-rule validation
      → product matching → confidence scoring
      → HUMAN REVIEW AND APPROVAL
      → purchase / stock adjustment / product update → inventory transaction
```

* Every extracted field carries a confidence, and every line carries a match score and the
  alternatives that were considered.
* Barcode matches beat text matches, because a barcode read on the phone is exact.
* High-confidence lines are pre-ticked on the review screen; they still need the owner's press.
* Values are validated a second time at the moment of approval, not only when they were read.
* The approval snapshot records what was extracted, what the owner changed and what was finally
  confirmed, against the image and the user — see `AI_SCAN_APPROVED` in the audit log.
* There is a manual path out of every failure: bad photo, unreadable quantity, ambiguous match.

`server/src/tests/scanner.test.ts` asserts the property the whole design rests on: a scan cannot
change stock without passing validation and an explicit approval.

---

## Architecture in one paragraph

Every business-owned row carries a `businessId` and every query goes through a tenant scope, so two
shops can never see each other's data. Stock is only ever changed by writing an
`InventoryTransaction` — opening, purchase, sale, returns, adjustment, damage, expiry, production,
consumption or image-scan adjustment — which records the previous and new level, the reference
document, the user and the source. Money is stored as integer paise, quantities as numbers with
three decimals, so no float ever decides what a customer owes. The phone keeps its own copy of the
catalogue in IndexedDB and queues mutations with client request ids; the server deduplicates them,
so a replayed queue is applied exactly once. The full reasoning is in
[docs/architecture.md](docs/architecture.md).

---

## Testing

```bash
npm test
```

142 tests across ten files cover the inventory ledger and FEFO batch picking, POS including tax
modes, credit limits and cancellation, purchases and supplier dues, both kinds of return, customer
and supplier payments, profit and tax maths, role permissions, tenant isolation, offline sync
idempotency, reporting, and the scanner's extraction, matching, correction, approval and rejection
paths.

---

## Status

The MVP checklist is implemented end to end: authentication and onboarding, business types,
dashboard, products with variants and dynamic attributes, barcode scanning, the image scanner with
matching, confidence and approval, POS, payments, customers and credit, suppliers, purchases,
inventory with adjustments and ledger, both returns, expenses, tax configuration, receipts,
reports, notifications, daily closing, RBAC, audit log, offline-friendly architecture,
multi-tenancy and the industry-specific features.

Deliberately left for later, because they need infrastructure rather than code: push notifications
(the in-app feed is there), object storage beyond the local disk adapter, a background job runner
beyond the in-process scheduler, and a Capacitor wrapper for the Play Store (the PWA is already
installable).
