import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { TopBar } from '../../components/AppShell';
import { Empty, ErrorNotice, ListRow, Loading, Screen, StatTile } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { initials, money } from '../../lib/format';

interface SupplierRow {
  id: string;
  name: string;
  phone: string | null;
  balancePaise: number;
}

interface SupplierListResponse {
  items: SupplierRow[];
  total: number;
  summary: { outstandingPaise: number; withDueCount: number };
}

/** Everybody the shop buys from, and what is still to be paid. */
export function SupplierList() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const dueOnly = params.get('due') === '1';
  const [search, setSearch] = useState('');

  const suppliers = useAsync(
    () =>
      api.get<SupplierListResponse>('/suppliers', {
        search: search.trim() || undefined,
        withDueOnly: dueOnly || undefined,
        pageSize: 200,
      }),
    [search, dueOnly],
  );

  const rows = suppliers.data?.items ?? [];
  const summary = suppliers.data?.summary;

  return (
    <>
      <TopBar title="Suppliers" back subtitle={suppliers.data ? `${suppliers.data.total} in your book` : undefined} />

      <div className="pos-search">
        <input
          className="input"
          placeholder="Search name or number"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <Screen>
        <div className="chip-row">
          <button
            type="button"
            className={dueOnly ? 'chip active' : 'chip'}
            onClick={() => setParams(dueOnly ? {} : { due: '1' }, { replace: true })}
          >
            {dueOnly ? '✓ Only those you owe' : 'Only those you owe'}
          </button>
        </div>

        {summary ? (
          <div className="stat-grid">
            <StatTile
              label="Supplier Due"
              value={money(summary.outstandingPaise)}
              note={`${summary.withDueCount} ${summary.withDueCount === 1 ? 'supplier' : 'suppliers'}`}
              accent
            />
            <StatTile label="Suppliers" value={suppliers.data?.total ?? 0} note="In your book" />
          </div>
        ) : null}

        <button type="button" className="btn btn-block" onClick={() => navigate('/suppliers/new')}>
          Add Supplier
        </button>

        <ErrorNotice error={suppliers.error} onRetry={suppliers.reload} />
        {suppliers.loading && !suppliers.data ? <Loading /> : null}

        {suppliers.data && !rows.length ? (
          <Empty
            icon="🚚"
            title={dueOnly ? 'You owe nobody' : search ? 'Nobody matches that' : 'No suppliers yet'}
            hint={
              dueOnly
                ? 'Every supplier is paid up.'
                : search
                  ? 'Try a shorter name or the phone number.'
                  : 'Add the shops you buy your goods from.'
            }
            action={
              !search && !dueOnly ? (
                <button type="button" className="btn" onClick={() => navigate('/suppliers/new')}>
                  Add Supplier
                </button>
              ) : null
            }
          />
        ) : null}

        {rows.length ? (
          <div className="list">
            {rows.map((supplier) => (
              <ListRow
                key={supplier.id}
                avatar={initials(supplier.name) || '🚚'}
                title={supplier.name}
                subtitle={supplier.phone ?? 'No number'}
                amount={supplier.balancePaise > 0 ? money(supplier.balancePaise) : '—'}
                note={supplier.balancePaise > 0 ? 'to pay' : 'settled'}
                onClick={() => navigate(`/suppliers/${supplier.id}`)}
              />
            ))}
          </div>
        ) : null}
      </Screen>
    </>
  );
}
