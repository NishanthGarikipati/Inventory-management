# Architecture

This document explains why the system is shaped the way it is. The API surface is listed separately
in [api.md](api.md), and each module is walked through in [modules.md](modules.md).

```
                      Android phone (PWA, installable)
                                   │
                 IndexedDB: catalogue cache + mutation queue
                                   │  HTTPS, bearer token
                      ┌────────────┴────────────┐
                      │   Express API + auth    │
                      └────────────┬────────────┘
        ┌──────────────┬───────────┼───────────┬──────────────┐
     Product        Inventory     Sales     Purchase       Scanner
        └──────────────┴───────────┼───────────┴──────────────┘
                          Prisma / relational DB
                                   │
                      ┌────────────┴────────────┐
                 Object storage            In-process jobs
                 (scan images)          (alerts, key cleanup)
```

## 1. Choices, and what they cost

**Node 20 + TypeScript + Express + Prisma.** One language across the phone and the server, so the
money and tax arithmetic is written once and mirrored, not reimplemented. Prisma gives a typed
schema and a migration path from SQLite to PostgreSQL without touching the services.

**SQLite by default.** A single shop runs on one file, which makes the demo and the test suite fast
and hermetic. The schema avoids native enums and `Decimal` (SQLite has neither) by using string
unions validated with Zod and integer paise. Moving to PostgreSQL is a provider change plus a
migration; nothing in the services assumes SQLite.

**A PWA rather than a native app.** It installs from the browser, updates without a store review,
and runs the same code in a desktop browser for support. It is Capacitor-ready when Play Store
distribution is wanted: the camera, storage and background sync are all behind thin modules.

## 2. Multi-tenancy

Every business-owned table carries `businessId`. Access is never made from a raw id: handlers
resolve a `TenantScope { businessId, userId, role }` from the access token and pass it down, and the
repository helpers in `src/db/tenant.ts` refuse a query without one. Cross-entity writes call
`assertSameBusiness` so a crafted id from another shop fails before it reaches the database.

`src/tests/access.test.ts` proves the isolation from the outside: two shops, one token each, and
every read path — products, customers, sales, inventory, search, invoice numbering, dashboards —
checked for leakage. Invoice numbering in particular is per-business, so two shops both start at
`INV-0001`.

## 3. The inventory transaction engine

**Stock is never assigned, only moved.** `applyStockMovement` is the single writer. It takes a
signed quantity and a type, reads the current level inside the transaction, writes an
`InventoryTransaction` row recording previous level, new level, reference document, user and source,
and then updates the denormalised level on the variant.

Transaction types: `OPENING`, `PURCHASE`, `SALE`, `SALE_RETURN`, `PURCHASE_RETURN`, `ADJUSTMENT`,
`DAMAGE`, `EXPIRY`, `TRANSFER`, `PRODUCTION`, `CONSUMPTION`, `IMAGE_SCAN_ADJUSTMENT`.

Consequences that fall out of this rule:

* The ledger always reconstructs the level. A disagreement is a bug with evidence attached.
* Anything created from a photo carries `source = IMAGE_SCAN`, so AI-driven movements can be listed,
  audited or reversed as a group.
* Selling below zero is a per-shop setting, not a hard rule, because a kirana genuinely sells from a
  sack it has not counted yet. When it is off, the error says how many are left and offers to change
  the quantity.

**Costing.** Each variant keeps a moving average cost, updated on every inward movement. Outward
movements record the cost of goods at that moment, which is what makes gross profit per bill
possible without a nightly job.

**Batches and FEFO.** Batch-tracked products allocate first-expiry-first-out when a sale does not
name a batch. A pharmacy therefore sells the strip that expires soonest without the counter staff
thinking about it.

**Variants.** Every product gets a default variant even when the shop will never use variants, so
inventory always keys off `variantId`. The UI hides the concept entirely when there is one variant.

## 4. Money and quantities

Money is integer **paise** everywhere: database, API, phone. It is divided by 100 exactly once, at
the moment of display. Quantities are numbers rounded to three decimals, enough for 5 g of saffron
and cheap to reason about.

Tax is configurable per shop and per product: on or off, inclusive or exclusive, with a per-product
rate. `computeLineTax` handles both directions, bill-level discounts are spread across lines by
value before tax is computed, and optional round-off to the rupee is recorded as its own field so
the receipt adds up. The same arithmetic is mirrored in `mobile/src/store/cart.ts` so the counter
display matches the printed bill; the server stays the authority.

## 5. Authentication and authorisation

PIN login. A phone number plus a 4–6 digit PIN hashed with bcrypt, exchanged for a short-lived
access token and a rotating refresh token whose hash is stored. One number can own several shops, in
which case login returns the list and asks which one instead of guessing.

Three roles — Owner, Manager, Cashier — map to a fixed permission set (`src/domain/permissions.ts`).
Permissions are checked on the server on every route, and the same list is sent to the phone so it
can hide what the user cannot do. Hiding is a courtesy; the check is the control. Offline operations
are re-checked against the role when the queue is replayed.

Login and registration are rate limited. PINs are never logged: the logger redacts `pin`, `pinHash`,
`authorization` and token fields.

## 6. Offline-first

The phone holds its own copy of the shop in IndexedDB: the catalogue, stock levels, customers and
suppliers, pulled incrementally (`GET /sync/pull?since=`) so a large catalogue downloads once and
then trickles.

Mutations made offline — bills, stock adjustments, customer payments, expenses — are written to a
local queue with a `clientRequestId` generated on the device, and the cached stock is adjusted
immediately so the next bill shows the right number. When connectivity returns, `POST /sync/push`
replays the queue in batches.

Exactly-once is enforced on the server: the request id is stored with the response, so a replay
returns the original result marked `DUPLICATE` rather than creating a second bill. The same
mechanism backs the `Idempotency-Key` header on the online endpoints, which means a flaky network
during checkout is harmless.

An operation the server rejects — say a sale that would oversell after someone else bought the last
piece — stays on the phone with the reason attached, on a "waiting to sync" screen, where the owner
can fix the cause and send it again or discard it. A transaction is never silently dropped.

Connection state is surfaced as ONLINE, OFFLINE, SYNCING or SYNC ERROR in the top bar, with the
count of entries still waiting.

## 7. The image scanner

A separate module (`src/services/scanner/`) with a linear pipeline and a hard gate in the middle.

```
upload → quality check → barcode detection → extraction provider
       → Zod schema validation → business-rule validation → product matching
       → confidence scoring → REVIEW_REQUIRED
       → human review and approval
       → purchase / stock adjustment / product update → inventory transactions
```

**Providers are pluggable.** `heuristic` is a deterministic reader used by the tests and the demo;
`openai` calls a vision model with a strict JSON schema. The key lives on the server and the phone
never sees it. A provider failure falls back rather than failing the scan.

**Barcodes outrank text.** The phone decodes barcodes from the photo and sends them with the upload,
because an exact number beats a fuzzy read of a smudged label.

**Matching is a cascade**, in decreasing order of certainty: barcode, SKU, exact name, normalised
name, brand plus size, then fuzzy similarity. Candidates and their scores are kept so the review
screen can offer "we found two possible products, please choose".

**Validation is deterministic and happens twice.** Model output is parsed by a Zod schema, then
checked against business rules — quantity above zero and below a ceiling, prices non-negative, tax
within the rates the shop actually uses, dates real, expiry in the future — and again at the moment
of approval. Issues are graded `BLOCK` (cannot be confirmed) or `ASK` (needs a look).

**Nothing is applied without a human.** Approval requires `scanner:approve`, names the exact line
ids being accepted, and only then creates a purchase (invoice, receipt), a counted stock adjustment
(shelf, stock sheet) or a catalogue update (product label). Image-based counting is recorded as a
proposed physical count, never as an overwrite.

**Everything is remembered.** The approval stores a snapshot: what was extracted with what
confidence, what the owner corrected, what was finally confirmed, the image reference, the user and
the time. That snapshot is also written to the audit log as `AI_SCAN_APPROVED`.

Images go to object storage, never into the database. The default driver writes to disk under a
per-business prefix and content hash; the same interface is what an S3 driver implements, and it
includes a retention purge.

## 8. Reporting and notifications

Reports are computed on demand from the transactional tables with date presets the shop thinks in
(today, yesterday, this week, this month, last month, custom). Profit is reported as revenue, cost
of goods, gross profit, expenses and estimated net profit — separate lines, never conflated.

Notifications are generated by the same services that change the data (low stock after a sale,
expiry during the daily sweep, dues after a bill) and deduplicated by a key so a product that stays
low does not produce an alert an hour. A small in-process scheduler refreshes business-wide alerts
and clears expired idempotency keys; in a cloud deployment it becomes a worker.

## 9. Audit

`AuditLog` records price changes, stock adjustments, sale cancellations, purchase edits, customer
balance changes, supplier payments, user changes and every AI-generated or AI-confirmed change, with
before and after values, the actor and the source. The source field distinguishes `MANUAL`,
`OFFLINE_SYNC` and `IMAGE_SCAN`, which is what makes "show me everything the scanner did last month"
a query rather than an investigation.

## 10. Performance

Indexes cover every tenant-scoped lookup and the hot paths: barcode, SKU, normalised name, invoice
number, transaction by variant and date. Lists are paginated. The phone searches its local cache,
so the POS does not hit the network per keystroke. Sync is incremental. Image reading happens on a
separate request from billing, so the counter is never blocked while a photo is processed.

The design target is 1,000–100,000 products per shop with millions of transactions; the parts that
would strain first — report aggregation and the full catalogue pull — are already paged and
incremental respectively.

## 11. Where this grows

The multi-tenant boundary already exists, so multi-store is an extra scope level rather than a
rewrite: a `storeId` under `businessId`, with the inventory engine keyed on both. The scanner's
provider interface accepts a better model without touching the approval path. The offline queue's
operation types are a small, explicit list, which keeps the sync contract reviewable as it grows.
