import { useEffect, useMemo, useState } from 'react';
import { TopBar } from '../components/AppShell';
import {
  Banner,
  Card,
  ChipRow,
  ConfirmSheet,
  Empty,
  ErrorNotice,
  Field,
  Loading,
  MoneyField,
  Screen,
  SectionHeading,
  SelectField,
  Sheet,
  StatTile,
  TextAreaField,
  TextField,
} from '../components/ui';
import { useAsync, useSubmit } from '../hooks/useAsync';
import { ApiError, api, newRequestId } from '../lib/api';
import { queueOperation } from '../lib/sync';
import { dateLabel, money } from '../lib/format';
import { RANGE_OPTIONS, rangeFor, type RangeKey } from '../lib/ranges';
import { toast } from '../lib/toast';
import { useSession } from '../store/session';
import type { PaymentMethod } from '../lib/types';

interface ExpenseCategory {
  id: string;
  name: string;
}

interface ExpenseRow {
  id: string;
  amountPaise: number;
  method: string;
  description: string | null;
  expenseDate: string;
  categoryId: string | null;
  category: ExpenseCategory | null;
}

interface ExpenseListResponse {
  items: ExpenseRow[];
  total: number;
  page: number;
  pageSize: number;
  totalAmountPaise: number;
}

const METHOD_OPTIONS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'CASH', label: '💵 Cash' },
  { value: 'UPI', label: '📱 UPI' },
  { value: 'CARD', label: '💳 Card' },
  { value: 'OTHER', label: '🧾 Other' },
];

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  CARD: 'Card',
  CREDIT: 'On credit',
  OTHER: 'Other',
};

const NEW_CATEGORY = '__NEW__';

const todayValue = (): string => new Date().toISOString().slice(0, 10);

/** Money that goes out of the shop but is not stock: rent, salary, transport. */
export function Expenses() {
  const can = useSession((state) => state.can);
  const [range, setRange] = useState<RangeKey>('THIS_MONTH');
  const [addOpen, setAddOpen] = useState(false);
  const [deleting, setDeleting] = useState<ExpenseRow | null>(null);
  const { from, to, label } = rangeFor(range);

  const categories = useAsync(() => api.get<{ categories: ExpenseCategory[] }>('/expenses/categories'), []);
  const expenses = useAsync(
    () => api.get<ExpenseListResponse>('/expenses', { from, to, pageSize: 200 }),
    [from, to],
  );

  const rows = expenses.data?.items ?? [];

  const breakdown = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of rows) {
      const name = row.category?.name ?? 'Other';
      totals.set(name, (totals.get(name) ?? 0) + row.amountPaise);
    }
    return [...totals.entries()].map(([name, amountPaise]) => ({ name, amountPaise })).sort((a, b) => b.amountPaise - a.amountPaise);
  }, [rows]);

  const totalPaise = expenses.data?.totalAmountPaise ?? 0;
  const biggest = breakdown[0]?.amountPaise ?? 0;

  const remove = useSubmit(async (expense: ExpenseRow) => {
    await api.del(`/expenses/${expense.id}`);
    setDeleting(null);
    toast.success('Expense removed.');
    expenses.reload();
  });

  return (
    <>
      <TopBar
        title="Expenses"
        subtitle={label}
        back
        actions={
          can('expense:write') ? (
            <button type="button" className="icon-button" aria-label="Add expense" onClick={() => setAddOpen(true)}>
              ➕
            </button>
          ) : null
        }
      />

      <Screen>
        <ChipRow value={range} onChange={setRange} options={RANGE_OPTIONS} />

        <div className="stat-grid">
          <StatTile
            label={`Spent ${label.toLowerCase()}`}
            value={money(totalPaise)}
            note={`${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`}
            accent
          />
          <StatTile label="Biggest head" value={breakdown[0]?.name ?? '—'} note={breakdown[0] ? money(biggest) : 'Nothing yet'} />
        </div>

        {can('expense:write') ? (
          <button type="button" className="btn btn-block btn-lg" onClick={() => setAddOpen(true)}>
            Add Expense
          </button>
        ) : null}

        <ErrorNotice error={expenses.error} onRetry={expenses.reload} />
        {expenses.loading && !expenses.data ? <Loading /> : null}

        {breakdown.length ? (
          <Card title="Where it went">
            <div className="bar-chart">
              {breakdown.map((entry) => (
                <div className="bar-row" key={entry.name}>
                  <div className="bar-label">
                    <span>{entry.name}</span>
                    <strong>{money(entry.amountPaise)}</strong>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${biggest ? (entry.amountPaise / biggest) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        {!expenses.loading && !rows.length ? (
          <Empty icon="🧾" title="No expenses here" hint="Try a longer date range, or add what you spent." />
        ) : null}

        {rows.length ? (
          <>
            <SectionHeading>Every entry</SectionHeading>
            <div className="list">
              {rows.map((expense) => (
                <div className="list-item" key={expense.id}>
                  <div className="li-main">
                    <div className="li-title">{expense.category?.name ?? 'Other'}</div>
                    <div className="li-sub">
                      {dateLabel(expense.expenseDate)} · {METHOD_LABEL[expense.method] ?? expense.method}
                      {expense.description ? ` · ${expense.description}` : ''}
                    </div>
                  </div>
                  <div className="li-right">
                    <div className="li-amount">{money(expense.amountPaise)}</div>
                    {can('expense:write') ? (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(expense)}>
                        Delete
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </Screen>

      <AddExpenseSheet
        open={addOpen}
        categories={categories.data?.categories ?? []}
        onClose={() => setAddOpen(false)}
        onSaved={() => {
          setAddOpen(false);
          categories.reload();
          expenses.reload();
        }}
      />

      <ConfirmSheet
        open={deleting !== null}
        title="Remove this expense?"
        message={
          deleting
            ? `${money(deleting.amountPaise)} for ${deleting.category?.name ?? 'Other'} on ${dateLabel(deleting.expenseDate)} will be removed from your records.`
            : ''
        }
        confirmLabel="Remove"
        danger
        busy={remove.busy}
        onConfirm={() => {
          if (deleting) void remove.run(deleting);
        }}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

function AddExpenseSheet({
  open,
  categories,
  onClose,
  onSaved,
}: {
  open: boolean;
  categories: ExpenseCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const business = useSession((state) => state.business);
  const refreshPending = useSession((state) => state.refreshPending);

  const [categoryId, setCategoryId] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [amountPaise, setAmountPaise] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [date, setDate] = useState(todayValue());
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!open) return;
    setCategoryId('');
    setCategoryName('');
    setAmountPaise(0);
    setMethod('CASH');
    setDate(todayValue());
    setDescription('');
  }, [open]);

  const newCategory = categoryId === NEW_CATEGORY;
  const chosenName = newCategory ? categoryName.trim() : categories.find((entry) => entry.id === categoryId)?.name ?? '';
  const ready = amountPaise > 0 && Boolean(chosenName);

  const { run, busy, error } = useSubmit(async () => {
    const clientRequestId = newRequestId();
    const payload = {
      categoryId: newCategory || !categoryId ? undefined : categoryId,
      categoryName: newCategory ? categoryName.trim() : undefined,
      amountPaise,
      method,
      description: description.trim() || undefined,
      // Midday keeps the date on the day the owner picked, whatever the phone's timezone does.
      expenseDate: new Date(`${date}T12:00:00`).toISOString(),
      clientRequestId,
    };
    const summary = `${money(amountPaise)} · ${chosenName}`;

    const saveOffline = async () => {
      await queueOperation({
        clientRequestId,
        businessId: business?.id ?? '',
        type: 'EXPENSE',
        payload,
        summary,
      });
      await refreshPending();
      toast.info('Saved on this phone. It will be sent when you are online.');
      onSaved();
    };

    if (!navigator.onLine) {
      await saveOffline();
      return;
    }

    try {
      await api.post('/expenses', payload, clientRequestId);
      toast.success('Expense saved.');
      onSaved();
    } catch (cause) {
      if (cause instanceof ApiError && cause.isOffline) {
        await saveOffline();
        return;
      }
      throw cause;
    }
  });

  return (
    <Sheet open={open} title="Add expense" onClose={onClose}>
      <div className="stack">
        <SelectField
          label="What was it for"
          value={categoryId}
          onChange={setCategoryId}
          placeholder="Choose a head"
          options={[
            ...categories.map((entry) => ({ value: entry.id, label: entry.name })),
            { value: NEW_CATEGORY, label: 'Something else…' },
          ]}
        />
        {newCategory ? (
          <TextField
            label="New head"
            value={categoryName}
            onChange={setCategoryName}
            placeholder="Water, Tea, Repairs"
            hint="This is saved for next time."
          />
        ) : null}

        <MoneyField label="Amount" valuePaise={amountPaise} onChange={setAmountPaise} autoFocus />

        <Field label="Paid by">
          <ChipRow value={method} onChange={setMethod} options={METHOD_OPTIONS} />
        </Field>

        <TextField label="Date" value={date} onChange={setDate} type="date" />

        <TextAreaField
          label="Note (optional)"
          value={description}
          onChange={setDescription}
          placeholder="Shop rent for September"
        />

        {method === 'CASH' ? (
          <Banner tone="info" icon="💵">
            Cash expenses come out of the cash box, so the day's closing will expect {money(amountPaise)} less.
          </Banner>
        ) : null}

        <ErrorNotice error={error} />

        <button type="button" className="btn btn-block btn-lg" disabled={busy || !ready} onClick={() => void run()}>
          {busy ? 'Saving…' : `Save ${money(amountPaise)}`}
        </button>
      </div>
    </Sheet>
  );
}
