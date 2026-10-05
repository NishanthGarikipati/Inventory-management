import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '../components/AppShell';
import { Card, Empty, ErrorNotice, Loading, Screen } from '../components/ui';
import { useAsync } from '../hooks/useAsync';
import { api } from '../lib/api';
import { dateLabel, money, quantity as qtyLabel } from '../lib/format';
import type { Party, SellableItem } from '../lib/types';

interface SearchResults {
  products: SellableItem[];
  customers: Party[];
  suppliers: Party[];
  sales: Array<{ id: string; invoiceNumber: string; totalPaise: number; saleDate: string }>;
}

const EMPTY: SearchResults = { products: [], customers: [], suppliers: [], sales: [] };

/** One box for products, people and bills. */
export function GlobalSearch() {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const query = term.trim();

  const results = useAsync(
    () => (query.length >= 1 ? api.get<SearchResults>('/search', { q: query }) : Promise.resolve(EMPTY)),
    [query],
  );
  const data = results.data ?? EMPTY;
  const nothing = query.length >= 1 && !results.loading && !data.products.length && !data.customers.length && !data.suppliers.length && !data.sales.length;

  return (
    <>
      <TopBar title="Search" back />
      <div className="pos-search">
        <input
          className="input"
          placeholder="Product, customer, supplier or bill number"
          value={term}
          autoFocus
          onChange={(event) => setTerm(event.target.value)}
        />
      </div>
      <Screen>
        <ErrorNotice error={results.error} onRetry={results.reload} />
        {results.loading && query ? <Loading /> : null}
        {nothing ? <Empty icon="🔍" title="Nothing matches" hint="Try a shorter word or the barcode." /> : null}

        {data.products.length ? (
          <Card title="Products" flush>
            <div className="list">
              {data.products.map((product) => (
                <button key={product.variantId} type="button" className="list-item" onClick={() => navigate(`/stock/${product.variantId}`)}>
                  <div className="li-main">
                    <div className="li-title">{product.name}</div>
                    <div className="li-sub">
                      {qtyLabel(product.stock)} {product.unit.toLowerCase()} · {product.sku}
                    </div>
                  </div>
                  <div className="li-right">
                    <div className="li-amount">{money(product.sellingPricePaise)}</div>
                  </div>
                </button>
              ))}
            </div>
          </Card>
        ) : null}

        {data.customers.length ? (
          <Card title="Customers" flush>
            <div className="list">
              {data.customers.map((customer) => (
                <button key={customer.id} type="button" className="list-item" onClick={() => navigate(`/customers/${customer.id}`)}>
                  <div className="avatar">{customer.name.slice(0, 2).toUpperCase()}</div>
                  <div className="li-main">
                    <div className="li-title">{customer.name}</div>
                    <div className="li-sub">{customer.phone ?? 'No number'}</div>
                  </div>
                  <div className="li-right">
                    {customer.balancePaise > 0 ? <div className="li-amount">{money(customer.balancePaise)}</div> : null}
                  </div>
                </button>
              ))}
            </div>
          </Card>
        ) : null}

        {data.suppliers.length ? (
          <Card title="Suppliers" flush>
            <div className="list">
              {data.suppliers.map((supplier) => (
                <button key={supplier.id} type="button" className="list-item" onClick={() => navigate(`/suppliers/${supplier.id}`)}>
                  <div className="avatar">{supplier.name.slice(0, 2).toUpperCase()}</div>
                  <div className="li-main">
                    <div className="li-title">{supplier.name}</div>
                    <div className="li-sub">{supplier.phone ?? 'No number'}</div>
                  </div>
                  <div className="li-right">
                    {supplier.balancePaise > 0 ? <div className="li-amount">{money(supplier.balancePaise)}</div> : null}
                  </div>
                </button>
              ))}
            </div>
          </Card>
        ) : null}

        {data.sales.length ? (
          <Card title="Bills" flush>
            <div className="list">
              {data.sales.map((sale) => (
                <button key={sale.id} type="button" className="list-item" onClick={() => navigate(`/sales/${sale.id}`)}>
                  <div className="li-main">
                    <div className="li-title">{sale.invoiceNumber}</div>
                    <div className="li-sub">{dateLabel(sale.saleDate)}</div>
                  </div>
                  <div className="li-right">
                    <div className="li-amount">{money(sale.totalPaise)}</div>
                  </div>
                </button>
              ))}
            </div>
          </Card>
        ) : null}
      </Screen>
    </>
  );
}
