# API reference

Base path `/api`. Everything except the four public routes needs
`Authorization: Bearer <accessToken>`.

**Money** is always an integer number of paise (`totalPaise: 49400` is ₹494.00). **Quantities** are
numbers with up to three decimals. **Dates** are ISO strings.

**Errors** always look like this, and the `actions` are what the phone turns into buttons:

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Only 5 units of Rice 5KG are available. You tried to sell 8.",
    "actions": [{ "label": "Change Quantity", "action": "CHANGE_QUANTITY", "payload": { "available": 5 } }]
  }
}
```

Status codes: `400` bad request, `401` not signed in, `403` role not allowed, `404` not found,
`409` conflict (duplicate, already cancelled, credit limit), `422` validation failed or image
unreadable, `429` rate limited.

**Idempotency.** Every endpoint that moves money or stock accepts an `Idempotency-Key` header and a
`clientRequestId` in the body. Replaying one returns the first response with
`Idempotent-Replay: true` instead of acting twice.

---

## Auth and onboarding

| Method | Path | Notes |
|---|---|---|
| `GET` | `/auth/business-types` | Public. The eleven templates with icon, description and features. |
| `GET` | `/auth/roles` | Public. Roles with their permission lists. |
| `POST` | `/auth/register` | Public. Creates business, settings, owner, units, taxes, categories, attributes and expense heads in one transaction. Returns tokens. |
| `POST` | `/auth/login` | Public. `{phone, pin, businessId?}`. Returns `300 CHOOSE_BUSINESS` with the list when one number owns several shops. |
| `POST` | `/auth/refresh` | `{refreshToken}` → a new pair. |
| `POST` | `/auth/logout` | Revokes the refresh token. |
| `GET` | `/auth/me` | User, business, settings, permissions and resolved feature flags. |
| `POST` | `/auth/change-pin` | `{currentPin, newPin}`. |
| `GET` `POST` | `/auth/users` | Staff list and creation. `user:manage`. |
| `PATCH` | `/auth/users/:id` | Role, name, active. `user:manage`. |

## Business configuration

| Method | Path | Notes |
|---|---|---|
| `GET` `PATCH` | `/business` | Shop profile. Patch needs `settings:write`. |
| `GET` `PATCH` | `/business/settings` | Tax mode, negative stock, round-off, alert days, scanner confidence thresholds, `featureOverrides`. |
| `GET` `POST` | `/business/taxes` | Tax rates. |
| `GET` `POST` | `/business/categories` | |
| `GET` `POST` | `/business/brands` | |
| `GET` `POST` | `/business/units` | Also returns conversions, e.g. `1 Box = 100 Pieces`. |
| `POST` | `/business/unit-conversions` | Optionally per product. |
| `GET` `POST` | `/business/attributes` | The dynamic product attributes for this business type. |

## Products

| Method | Path | Notes |
|---|---|---|
| `GET` | `/products` | `search`, `categoryId`, `brandId`, `page`, `pageSize`, `includeInactive`. |
| `GET` | `/products/:id` | Full detail with variants, attributes and stock. |
| `POST` | `/products` | Single or multi-variant. Refuses a probable duplicate with `Use Existing` / `Create New` actions; resend with `ignoreDuplicateWarning: true` to override. Accepts `openingStock`, which is written as an `OPENING` transaction. |
| `PUT` | `/products/:id` | Price changes are written to the audit log. |
| `DELETE` | `/products/:id` | Deactivates. Products are never hard deleted — their history has to stay readable. |
| `POST` | `/products/:id/variants` | |
| `POST` | `/products/variants/:variantId/barcode` | Generates a barcode for a product that has none. |
| `GET` | `/products/barcode/:code` | `404` carries `CREATE_PRODUCT` and `SEARCH_PRODUCT` actions. |
| `POST` | `/products/match` | `{name?, barcode?, sku?, brand?, size?}` → the match cascade with candidates and scores. Shared with the scanner. |

## Inventory

| Method | Path | Notes |
|---|---|---|
| `GET` | `/inventory` | `search`, `categoryId`, `brandId`, `status` (`IN_STOCK`, `LOW_STOCK`, `OUT_OF_STOCK`, `EXPIRING_SOON`), paging. Returns rows plus a summary with total stock value. |
| `GET` | `/inventory/item/:variantId` | One stock card. |
| `GET` | `/inventory/ledger/:variantId` | Stock movement, newest first. |
| `GET` | `/inventory/batches/:variantId` | Open batches with expiry. |
| `GET` | `/inventory/fefo/:variantId?quantity=` | What FEFO would pick. |
| `GET` | `/inventory/serials/:variantId` | Serial / IMEI items and their state. |
| `POST` | `/inventory/adjustment` | `{reason, note?, lines:[{variantId, quantityChange \| countedQuantity}]}`. Reason is mandatory: `DAMAGED`, `EXPIRED`, `LOST`, `PERSONAL_USE`, `COUNT_DIFF`, `OPENING`, `OTHER`. Idempotent. |
| `GET` | `/inventory/adjustments` | Recent adjustments with their lines. |

## Sales

| Method | Path | Notes |
|---|---|---|
| `POST` | `/sales` | `{customerId?, items[], discountPaise?, payments[], channel?, tableLabel?, note?, clientRequestId?}`. One transaction: stock out with FEFO and recipe consumption, payments, credit, COGS, profit, receipt. Cash tendered above the total is change, not an error; the response carries `changePaise`. Idempotent. |
| `GET` | `/sales` | `from`, `to`, `customerId`, `status`, paging. |
| `GET` | `/sales/:id` | Items, payments, customer, returns. |
| `GET` | `/sales/:id/receipt` | The stored receipt payload. |
| `POST` | `/sales/:id/cancel` | `{reason}`. Returns stock and reverses the customer balance. `sale:cancel`. |

Payment methods: `CASH`, `UPI`, `CARD`, `CREDIT`, `OTHER`. Several may be sent for a split payment.
An unpaid balance requires a customer — the error offers `Select Customer` and `Take Full Payment`.

## Purchases

| Method | Path | Notes |
|---|---|---|
| `POST` | `/purchases` | `{supplierId?, invoiceNumber?, purchaseDate?, items[], discountPaise?, payments[], note?}`. Items may carry batch, expiry, MRP, serials and a new selling price. Raises stock, creates batches, updates the moving average cost and the supplier balance. Idempotent. |
| `GET` | `/purchases` | `from`, `to`, `supplierId`, paging. |
| `GET` | `/purchases/:id` | |
| `POST` | `/purchases/:id/cancel` | `{reason}`. Refuses when the goods have already been sold and the shop disallows negative stock, offering a purchase return or a stock adjustment instead. |

## Customers, suppliers, payments

| Method | Path | Notes |
|---|---|---|
| `GET` `POST` | `/customers` | List carries a summary with total outstanding. `withDueOnly=true` filters. |
| `GET` `PUT` | `/customers/:id` | Detail includes bills, payments, totals. |
| `GET` `POST` | `/suppliers` | |
| `GET` `PUT` | `/suppliers/:id` | |
| `POST` | `/payments/customer` | `{customerId, amountPaise, method?, reference?, note?, saleId?}`. Without a `saleId` the money settles the oldest bills first, so the bill list always agrees with the balance. Returns `settledBills`. Idempotent. |
| `POST` | `/payments/supplier` | The mirror image, with `purchaseId?`. |

## Returns

| Method | Path | Notes |
|---|---|---|
| `POST` | `/returns/sales` | `{saleId?, customerId?, reason, refundMethod?, items[{saleItemId?, variantId?, quantity, restock?}]}`. Cannot exceed what was sold. `restock: false` writes the goods off instead of putting them back. Refund methods: `CASH`, `UPI`, `CARD`, `CREDIT_NOTE`, `ADJUST_DUE`. |
| `GET` | `/returns/sales` | |
| `POST` | `/returns/purchases` | `{purchaseId?, supplierId?, reason, settlement?, items[]}`. Settlement is `ADJUST_DUE` or `CASH_REFUND`. |
| `GET` | `/returns/purchases` | |

## Smart scanner

| Method | Path | Notes |
|---|---|---|
| `POST` | `/scanner/upload` | `multipart/form-data`: `image`, `scanType`, optional `barcodes` and `ocrText`. Returns `422 POOR_IMAGE_QUALITY` with `Take Another Photo` / `Enter Manually` when the photo cannot be read. |
| `POST` | `/scanner/:id/process` | Runs extraction, validation, matching and scoring. |
| `POST` | `/scanner/scan` | Upload and read in one call — what the "Scan Invoice" button uses. |
| `GET` | `/scanner` | History. `status`, `scanType`, `limit`. |
| `GET` | `/scanner/:id` | The review payload: items, confidences, match candidates, issues, thresholds, approvals, corrections. |
| `GET` | `/scanner/:id/image` | The stored photo. |
| `POST` | `/scanner/:id/review` | `{corrections:[{itemId, matchedVariantId?, createNewProduct?, quantity?, prices?, batch?, expiry?, reviewState?}]}`. Every correction is recorded against the original extraction. |
| `POST` | `/scanner/:id/approve` | `{acceptedItemIds[], rejectedItemIds?, supplierId?, supplierName?, invoiceNumber?, invoiceDate?, payment?, note?}`. Needs `scanner:approve`. **This is the only path from a photo to the books.** |
| `POST` | `/scanner/:id/reject` | `{reason}`. Nothing is written to stock. |

Scan types: `INVOICE`, `PRODUCT`, `SHELF`, `STOCK_SHEET`, `RECEIPT`.
Statuses: `UPLOADED`, `PROCESSING`, `EXTRACTED`, `REVIEW_REQUIRED`, `APPROVED`, `REJECTED`, `FAILED`.

Approval creates a purchase for `INVOICE` and `RECEIPT`, a counted stock adjustment for `SHELF` and
`STOCK_SHEET`, and a catalogue update for `PRODUCT` — always through the normal services, so every
inventory change still has its transaction row.

## Dashboard and reports

| Method | Path | Notes |
|---|---|---|
| `GET` | `/dashboard` | Today's sales, purchases, expenses, gross profit, credit given; low stock, out of stock, expiring, customer and supplier dues, scans awaiting review; stock value; this month's top products; feature flags and industry highlights. |
| `GET` | `/reports/sales` | |
| `GET` | `/reports/sales/products` | |
| `GET` | `/reports/sales/categories` | |
| `GET` | `/reports/purchases` | |
| `GET` | `/reports/inventory` | Valuation, low stock, out of stock, expiring. |
| `GET` | `/reports/outstanding` | Both directions. |
| `GET` | `/reports/profit` | Revenue, COGS, gross profit, expenses, estimated net profit — as separate figures. |
| `GET` | `/reports/expenses` | |
| `GET` | `/reports/payments` | By method. |
| `GET` | `/reports/stock-movement` | Optionally `variantId`. |
| `GET` | `/reports/scans` | What the scanner read and what was confirmed. |

All reports accept `preset=TODAY|YESTERDAY|THIS_WEEK|THIS_MONTH|LAST_MONTH|THIS_YEAR|CUSTOM` with
`from` and `to` for `CUSTOM`.

## Operations

| Method | Path | Notes |
|---|---|---|
| `GET` `POST` | `/expenses`, `/expenses/categories` | Idempotent create. |
| `DELETE` | `/expenses/:id` | |
| `GET` | `/closing/summary?date=` | Sales, split by method, expenses, expected cash. |
| `POST` | `/closing` | `{date?, actualCashPaise, note?}` → the difference. Optional; a shop may never close a day. |
| `GET` | `/closing` | Past closings. |
| `GET` | `/notifications` | `unreadOnly`, `limit`, `refresh=true` to re-evaluate alerts first. |
| `POST` | `/notifications/:id/read`, `/notifications/read-all` | |
| `GET` `POST` | `/production/recipes` | Bakery and restaurant. |
| `POST` `GET` | `/production/runs` | Consumes ingredients, produces finished goods. |
| `POST` `GET` | `/production/wastage` | |
| `GET` | `/audit` | `entityType`, `entityId`, `action`, `limit`. `audit:read`. |
| `GET` | `/search?q=` | Products, customers, suppliers and bills in one call. |

## Sync

| Method | Path | Notes |
|---|---|---|
| `GET` | `/sync/pull?since=` | Everything changed since the timestamp: products, inventory, customers, suppliers, taxes, units, settings. |
| `POST` | `/sync/push` | `{operations:[{clientRequestId, type, payload, queuedAt}]}`, up to 100. Types: `SALE`, `PURCHASE`, `ADJUSTMENT`, `CUSTOMER_PAYMENT`, `SUPPLIER_PAYMENT`, `EXPENSE`. Each result is `APPLIED`, `DUPLICATE` or `FAILED` with a reason; the role is re-checked per operation. |

## Health

`GET /health` — unauthenticated liveness check.
