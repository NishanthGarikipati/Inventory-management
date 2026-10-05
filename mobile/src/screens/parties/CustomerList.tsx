import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { TopBar } from '../../components/AppShell';
import { Empty, ErrorNotice, ListRow, Loading, Screen, StatTile } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { initials, money } from '../../lib/format';

interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  balancePaise: number;
  creditLimitPaise: number;
}

interface CustomerListResponse {
  items: CustomerRow[];
  total: number;
  summary: { outstandingPaise: number; withDueCount: number };
}

/** Everybody who buys from the shop, and what they still owe. */
export function CustomerList() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const dueOnly = params.get('due') === '1';
  const [search, setSearch] = useState('');

  const customers = useAsync(
    () =>
      api.get<CustomerListResponse>('/customers', {
        search: search.trim() || undefined,
        withDueOnly: dueOnly || undefined,
        pageSize: 200,
      }),
    [search, dueOnly],
  );

  const rows = customers.data?.items ?? [];
  const summary = customers.data?.summary;

  return (
    <>
      <TopBar title="Customers" back subtitle={customers.data ? `${customers.data.total} in your book` : undefined} />

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
            {dueOnly ? '✓ Only those who owe' : 'Only those who owe'}
          </button>
        </div>

        {summary ? (
          <div className="stat-grid">
            <StatTile
              label="Money Due"
              value={money(summary.outstandingPaise)}
              note={`${summary.withDueCount} ${summary.withDueCount === 1 ? 'customer' : 'customers'}`}
              accent
            />
            <StatTile label="Customers" value={customers.data?.total ?? 0} note="In your book" />
          </div>
        ) : null}

        <button type="button" className="btn btn-block" onClick={() => navigate('/customers/new')}>
          Add Customer
        </button>

        <ErrorNotice error={customers.error} onRetry={customers.reload} />
        {customers.loading && !customers.data ? <Loading /> : null}

        {customers.data && !rows.length ? (
          <Empty
            icon="👥"
            title={dueOnly ? 'Nobody owes you' : search ? 'Nobody matches that' : 'No customers yet'}
            hint={
              dueOnly
                ? 'Every customer has settled up.'
                : search
                  ? 'Try a shorter name or the phone number.'
                  : 'Add a customer to keep a record of credit given.'
            }
            action={
              !search && !dueOnly ? (
                <button type="button" className="btn" onClick={() => navigate('/customers/new')}>
                  Add Customer
                </button>
              ) : null
            }
          />
        ) : null}

        {rows.length ? (
          <div className="list">
            {rows.map((customer) => (
              <ListRow
                key={customer.id}
                avatar={initials(customer.name) || '👤'}
                title={customer.name}
                subtitle={customer.phone ?? 'No number'}
                amount={customer.balancePaise > 0 ? money(customer.balancePaise) : '—'}
                note={customer.balancePaise > 0 ? 'due' : 'settled'}
                onClick={() => navigate(`/customers/${customer.id}`)}
              />
            ))}
          </div>
        ) : null}
      </Screen>
    </>
  );
}
