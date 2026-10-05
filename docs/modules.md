# Modules

Each module below is the same shape: what it is, the tables it owns, the API, the screens, the
workflow, the rules, and where it is tested. Shared rules — tenant scope, paise, and the inventory
ledger — are in [architecture.md](architecture.md). Endpoints are listed in full in
[api.md](api.md).

## 1. Foundation: business, auth, roles

**What.** One shop signs up, picks an industry, and gets a PIN. Everyone else who uses the phone is
a staff member with a role.

**Tables.** `Business`, `BusinessSettings`, `User`, `RefreshToken`, `Tax`, `Category`, `Brand`,
`Unit`, `UnitConversion`, `ProductAttributeDefinition`, `ExpenseCategory`, `DocumentSequence`.

**API.** `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`,
`GET /auth/me`, `POST /auth/change-pin`, `GET|POST /auth/users`, `PATCH /auth/users/:id`,
`GET|PATCH /business`, `GET|PATCH /business/settings`, `GET|POST /business/taxes`.

**Screens.** Welcome and business-type picker, shop details, tax and currency, PIN. Later: Settings,
Business, Tax, Staff.

**Workflow.** Choose a type → name, owner, mobile, address, optional GSTIN → tax on or off, prices
inclusive or exclusive → 4–6 digit PIN → dashboard. Adding staff is name, mobile, PIN and a role.

**Rules.** PIN is bcrypt-hashed. A phone number may belong to more than one shop; login then asks
which one. Owner has every permission, Manager runs the shop without staff or settings, Cashier
bills and looks up products. The phone hides what the role cannot do; the server still checks.

**Validation.** Shop name and owner at least two characters, mobile at least ten digits, PIN digits
only, tax rate 0–100, GSTIN optional.

**Tests.** `server/src/tests/access.test.ts` covers login, roles and the fact that one shop's token
cannot read another shop.

## 2. Products, variants, attributes

**What.** One product record for every industry. The business type decides which extra fields appear.
Variants are optional; a product with no sizes still has one hidden default variant so stock always
has a single key.

**Tables.** `Product`, `ProductVariant`, `ProductAttributeValue`, `Category`, `Brand`, `Unit`,
`SerialItem`.

**API.** `GET|POST /products`, `GET|PUT /products/:id`, `DELETE /products/:id` (deactivates),
`GET /products/barcode/:code`, `POST /products/match`, `POST /products/variants/:id/barcode`,
`GET|POST /business/categories`, `/brands`, `/units`, `/unit-conversions`, `/attributes`.

**Screens.** Product list (search, category, barcode), product form, product detail.

**Workflow.** Name, unit, prices, tax, minimum stock, optional barcode. If the shop uses variants,
each size or colour gets its own SKU, barcode, price and stock. A barcode that is not in the shop
offers "create product" or "search".

**Rules.** Duplicate barcodes inside one shop are rejected. Creating a product whose name is very
close to an existing one returns a warning the owner can override. Deleting hides the product; its
history stays. Units convert (1 box = 100 pieces) per shop or per product. Attribute definitions are
seeded from the business type and only those are shown.

**Validation.** Name required, prices in paise and non-negative, tax rate within the shop's rates,
barcode unique per shop.

**Tests.** `server/src/tests/products.test.ts`.

## 3. Inventory

**What.** The stock screen and the ledger behind it. The number on screen is a cache of the ledger,
never the other way round.

**Tables.** `Inventory`, `InventoryTransaction`, `StockAdjustment`, `Batch`.

**API.** `GET /inventory`, `GET /inventory/item/:variantId`, `GET /inventory/ledger/:variantId`,
`GET /inventory/batches/:variantId`, `POST /inventory/adjustment`.

**Screens.** Stock list with search and status filters, stock item with movement history and an
adjust sheet.

**Workflow.** Search or scan → see level, value, prices → adjust with a reason (damaged, expired,
lost, personal use, physical count, opening stock, other) → confirm. The ledger line records the
previous level, the new level, the user and the reason.

**Rules.** `applyStockMovement` is the only writer. Selling or adjusting below zero is refused
unless the shop allows it, and the message says how many are actually there. Batch-tracked goods
allocate first-expiry-first-out. Low, out and expiring-soon are derived, not stored.

**Validation.** Quantity not zero, reason required, variant belongs to this shop.

**Tests.** `server/src/tests/inventory.test.ts`.

## 4. Sell (POS)

**What.** The fastest path in the app: find a product, set a quantity, take money, print a bill.

**Tables.** `Sale`, `SaleItem`, `SalePayment`, `Invoice`.

**API.** `POST /sales`, `GET /sales`, `GET /sales/:id`, `GET /sales/:id/receipt`,
`POST /sales/:id/cancel`.

**Screens.** Sell, checkout sheet, bills list, bill detail.

**Workflow.** Search or scan → quantity on a big stepper → cash, UPI, card, credit or a split →
done. A credit bill needs a customer. Cancelling a bill puts the stock back and reverses the
customer's balance, and it asks for a reason.

**Rules.** Each line stores its own cost, so gross profit is known on the bill. Tax follows the
shop setting (included in the price, or added on top). Optional round-off to the nearest rupee is
stored separately so the receipt still adds up. A bill can be queued offline; the same
`clientRequestId` means a retry cannot create a second bill. Stock on the phone is reduced locally
so the next bill sees the right number.

**Validation.** At least one line, quantity above zero, payment not more than the total (change is
computed, not stored as overpayment), credit only with a customer inside their limit.

**Tests.** `server/src/tests/sales.test.ts`.

## 5. Customers, suppliers, payments

**What.** People the shop sells to and buys from, and the money still open on either side.

**Tables.** `Customer`, `Supplier`, `CustomerPayment`, `SupplierPayment`.

**API.** `GET|POST /customers`, `GET|PUT /customers/:id`, the same for `/suppliers`,
`POST /payments/customer`, `POST /payments/supplier`.

**Screens.** Customer and supplier lists and detail, party form, Payments.

**Workflow.** A payment names an amount and a method. It is applied to the oldest unpaid bill or
purchase first. Paying more than the balance leaves an advance. Customer payments can be queued
offline.

**Rules.** Balance is derived from bills, purchases, payments and returns, and the stored balance is
updated in the same transaction. One shop cannot see another's people.

**Validation.** Name required, amount above zero, party belongs to this shop.

**Tests.** `server/src/tests/payments.test.ts` and the party coverage inside the access tests.

## 6. Purchases

**What.** Goods coming in: typed in, scanned by barcode, or confirmed from a photographed invoice.

**Tables.** `Purchase`, `PurchaseItem`, `PurchasePayment`.

**API.** `POST /purchases`, `GET /purchases`, `GET /purchases/:id`, `POST /purchases/:id/cancel`.

**Screens.** Purchase list, new purchase, purchase detail. The scanner's confirm step creates the
same purchase with `source = IMAGE_SCAN`.

**Workflow.** Choose a supplier (required when anything stays unpaid) → invoice number and date →
add products by search or barcode, with quantity and purchase price, and batch plus expiry when the
product tracks them → paid in full, part paid, or on credit → save. Stock rises, the moving average
cost refreshes, and the supplier's balance rises by whatever was not paid. Cancelling pulls the
stock back out; if the goods have already been sold, cancel is refused and the screen offers a
supplier return instead.

**Rules.** A purchase is a document plus ledger lines. There is no path that increments stock on its
own. Prices typed here can update the catalogue purchase price, MRP and selling price when the owner
asks.

**Validation.** At least one line, quantity above zero, cost non-negative, payment not wildly above
the total, supplier required for a due balance.

**Tests.** `server/src/tests/purchases.test.ts`.

## 7. Returns

**What.** Goods coming back from a customer, or going back to a supplier.

**Tables.** `SalesReturn`, `SalesReturnItem`, `PurchaseReturn`, `PurchaseReturnItem`.

**API.** `POST|GET /returns/sales`, `POST|GET /returns/purchases`.

**Screens.** Returns list, customer return, supplier return. A bill and a purchase both link
straight into the matching form.

**Workflow.** Open the bill → choose how many of each line come back (never more than what is still
returnable) → reason → cash, UPI, reduce dues, or a credit note. Resellable goods go back on the
shelf; damaged ones are received and immediately written off as damage so the history shows both.
A supplier return reduces stock and, by default, reduces what the shop owes.

**Rules.** Returned quantity is stored on the original line, so the same piece cannot be returned
twice. The return is its own numbered document.

**Validation.** Reason at least two characters, quantity above zero and within what remains, a
product or an original line, a supplier when the settlement reduces a due.

**Tests.** `server/src/tests/returns.test.ts`.

## 8. Expenses, daily closing, reports, notifications

**What.** Money that is not stock, the end-of-day cash count, and the questions an owner actually
asks.

**Tables.** `Expense`, `ExpenseCategory`, `DailyClosing`, `Notification`.

**API.** `GET|POST /expenses`, `DELETE /expenses/:id`, `GET|POST /expenses/categories`,
`GET|POST /closing`, `GET /dashboard`, `GET /reports/sales`, `/sales/products`, `/sales/categories`,
`/purchases`, `/inventory`, `/outstanding`, `/profit`, `/expenses`, `/payments`, `/stock-movement`,
`/scans`, `GET /notifications`.

**Screens.** Expenses, Close the Day, Reports and each report, Home, Notifications.

**Workflow.** An expense is a category, an amount, a date and how it was paid. Closing shows sales
split by cash, UPI, card and credit, minus expenses, then asks for the cash actually in the box and
records the difference. Reports take today, yesterday, this week, this month or a custom range, and
can be copied as plain text.

**Rules.** Profit is four numbers: revenue, cost of goods, gross profit, expenses, then an
*estimated* net. Gross profit is never labelled net. Low-stock, expiry, customer-due, supplier-due
and "scan waiting for review" notifications are written by the service that caused them and
deduplicated so a product that stays low does not alert every hour.

**Tests.** `server/src/tests/reports.test.ts`.

## 9. Smart Scanner

**What.** A photo of an invoice, a label, a shelf or a handwritten stock sheet becomes a proposal.
It becomes stock only after a person confirms it.

**Tables.** `ImageScan`, `ImageScanItem`, `ImageScanApproval`, `ImageScanCorrection`. The image
itself lives in file storage; the row keeps the reference.

**API.** `POST /scanner/upload`, `GET /scanner`, `GET /scanner/:id`, `POST /scanner/:id/review`,
`POST /scanner/:id/approve`, `POST /scanner/:id/reject`.

**Screens.** Scanner (camera or file), review, scan history.

**Workflow.** Take a photo → the server checks it is readable, reads barcodes, asks the extraction
provider for structured JSON, validates that JSON, matches each line to an existing product, scores
confidence → the review screen shows every line with its confidence and any problem → the owner
edits product, quantity, price, tax, supplier, batch or expiry → confirm or cancel. Confirm creates
a purchase (invoice or receipt), a stock adjustment (shelf or stock sheet) or a catalogue update
(label). Cancel keeps the photo and the extraction and changes nothing in stock.

**Rules.** AI output is parsed by a schema and then checked again: quantity above zero, price
non-negative, tax inside the shop's rates, real dates, a real product. High confidence can be
pre-ticked; medium asks for a look; low must be corrected. Confidence is never treated as proof.
Barcode match wins over a fuzzy name. A probable existing product is offered as "use this" before
"create new", so a scan does not invent a duplicate. A blurry photo, a failed read or an ambiguous
shelf says so in words and offers typing it in by hand.

**Validation.** Approval names the exact line ids. Lines with a blocking issue cannot be confirmed.
The same scan cannot be approved twice.

**Tests.** `server/src/tests/scanner.test.ts`, including the guarantee that extraction alone never
writes stock.

## 10. Offline sync

**What.** The phone keeps working when the network does not, and catches up without doubling
anything.

**Tables.** `IdempotencyKey` on the server. IndexedDB tables `products`, `stock`, `parties`,
`queue`, `meta` on the phone.

**API.** `GET /sync/pull`, `POST /sync/push`.

**Screens.** The connection pill on every screen, and Pending (waiting to sync).

**Workflow.** Catalogue, stock and people download once, then only what changed. A bill, purchase,
stock adjustment, payment or expense made offline is stored with a client request id and a one-line
summary. When the phone is online again the queue is sent. Applied and duplicate entries leave the
phone. A rejected one stays, with the sentence the server sent, until the owner retries or discards
it.

**Rules.** Replay of the same id returns the original response. Permissions are checked again at
replay time. The POS never waits on a photo being read.

**Tests.** `server/src/tests/sync.test.ts`.

## 11. Industry configuration

**What.** Eleven shop types share the engines above. A type is a template: which features start on,
which units, categories, attributes and expense heads are seeded, and which dashboard lines matter.

**Where.** `server/src/domain/businessTypes.ts`, applied during registration. Overrides live in
`BusinessSettings.featureOverrides` and are editable under Settings → Shop features.

**What each type turns on.**

| Type | Extra behaviour |
|---|---|
| Kirana / general | Barcode, loose qty, units, MRP, batch, expiry, offers |
| Grocery | Weight and volume units, perishables, batch, expiry, MRP |
| Medical | Composition, manufacturer, batch, expiry, FEFO |
| Electronics | Model, serial, IMEI, warranty |
| Stationery | Pack size, unit conversion, colour, size |
| Bakery | Ingredients, recipes, production, wastage, expiry |
| Boutique | Size, colour, fabric, variants, exchanges |
| Hardware | Box-to-piece conversion, bulk pricing, dimensions |
| Restaurant | Menu items, recipes, ingredient consumption, tables, takeaway |
| Mobile accessories | Compatibility, brand, colour, warranty |
| Cosmetics | Shade, size, batch, expiry, MRP |

Recipes (bakery, restaurant) consume ingredients when the finished item is sold, through the same
ledger, as `CONSUMPTION` lines. Regulatory extras such as prescriptions stay behind a feature flag
so a deployment can leave them off.
