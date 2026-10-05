import { useEffect, useState } from 'react';
import { TopBar } from '../components/AppShell';
import {
  Banner,
  Card,
  ErrorNotice,
  Loading,
  MoneyField,
  Screen,
  SectionHeading,
  StatTile,
  TextAreaField,
  TextField,
  TotalsRow,
} from '../components/ui';
import { useAsync, useSubmit } from '../hooks/useAsync';
import { api } from '../lib/api';
import { dateLabel, money } from '../lib/format';
import { toast } from '../lib/toast';
import { useSession } from '../store/session';

interface ClosingRow {
  id: string;
  closingDate: string;
  salesPaise: number;
  cashPaise: number;
  upiPaise: number;
  cardPaise: number;
  creditPaise: number;
  otherPaise: number;
  expensesPaise: number;
  customerCollectionPaise: number;
  expectedCashPaise: number;
  actualCashPaise: number;
  differencePaise: number;
  note: string | null;
  createdAt: string;
}

interface DaySummary {
  date: string;
  billCount: number;
  salesPaise: number;
  cashPaise: number;
  upiPaise: number;
  cardPaise: number;
  creditPaise: number;
  otherPaise: number;
  expensesPaise: number;
  expenseCount: number;
  customerCollectionPaise: number;
  expectedCashPaise: number;
  closed: boolean;
  closing: ClosingRow | null;
}

const todayValue = (): string => new Date().toISOString().slice(0, 10);

/**
 * End of the day: what the app expects in the cash box against what the owner
 * counted. Skipping it costs the shop nothing, so nothing here is forced.
 */
export function DailyClosing() {
  const can = useSession((state) => state.can);
  const [date, setDate] = useState(todayValue());
  const [countedPaise, setCountedPaise] = useState(0);
  const [note, setNote] = useState('');

  // Midday keeps the day the owner picked, whatever the phone's timezone does.
  const chosenDay = `${date || todayValue()}T12:00:00`;

  const summary = useAsync(() => api.get<DaySummary>('/closing/summary', { date: new Date(chosenDay).toISOString() }), [
    chosenDay,
  ]);
  const history = useAsync(() => api.get<{ closings: ClosingRow[] }>('/closing', { limit: 10 }), []);

  const day = summary.data;

  useEffect(() => {
    setCountedPaise(0);
    setNote('');
  }, [chosenDay]);

  const difference = countedPaise - (day?.expectedCashPaise ?? 0);

  const close = useSubmit(async () => {
    await api.post('/closing', {
      date: new Date(chosenDay).toISOString(),
      actualCashPaise: countedPaise,
      note: note.trim() || undefined,
    });
    toast.success('Day closed.');
    summary.reload();
    history.reload();
  });

  return (
    <>
      <TopBar title="Close the Day" subtitle={dateLabel(chosenDay)} back />
      <Screen>
        <TextField label="Which day" value={date} onChange={setDate} type="date" />

        <ErrorNotice error={summary.error} onRetry={summary.reload} />
        {summary.loading && !day ? <Loading label="Adding up the day…" /> : null}

        {day ? (
          <>
            <div className="stat-grid">
              <StatTile
                label="Sales"
                value={money(day.salesPaise)}
                note={`${day.billCount} ${day.billCount === 1 ? 'bill' : 'bills'}`}
                accent
              />
              <StatTile label="Cash expected" value={money(day.expectedCashPaise)} note="Should be in the box" />
            </div>

            <Card title="How the money came in">
              <TotalsRow label="💵 Cash" value={money(day.cashPaise)} />
              <TotalsRow label="📱 UPI" value={money(day.upiPaise)} />
              <TotalsRow label="💳 Card" value={money(day.cardPaise)} />
              {day.otherPaise > 0 ? <TotalsRow label="🧾 Other" value={money(day.otherPaise)} /> : null}
              <TotalsRow label="📒 Credit given" value={money(day.creditPaise)} />
              <TotalsRow label="Total sales" value={money(day.salesPaise)} grand />
            </Card>

            <Card title="Cash in the box">
              <TotalsRow label="Cash from bills" value={money(day.cashPaise)} />
              <TotalsRow label="Money collected from customers" value={`+ ${money(day.customerCollectionPaise)}`} />
              <TotalsRow
                label={`Expenses paid${day.expenseCount ? ` (${day.expenseCount})` : ''}`}
                value={`− ${money(day.expensesPaise)}`}
              />
              <TotalsRow label="Cash expected" value={money(day.expectedCashPaise)} grand />
              <p className="muted" style={{ marginTop: 8 }}>
                Credit given is not counted here. That money comes in when the customer pays.
              </p>
            </Card>

            {day.closed && day.closing ? (
              <Card title="Already closed">
                <TotalsRow label="Counted" value={money(day.closing.actualCashPaise)} />
                <TotalsRow label="Expected" value={money(day.closing.expectedCashPaise)} />
                <TotalsRow label={differenceLabel(day.closing.differencePaise)} value={money(Math.abs(day.closing.differencePaise))} />
                {day.closing.note ? <p className="muted" style={{ marginTop: 8 }}>{day.closing.note}</p> : null}
              </Card>
            ) : can('closing:write') ? (
              <Card title="Count the cash box">
                <div className="stack">
                  <MoneyField
                    label="Cash you counted"
                    valuePaise={countedPaise}
                    onChange={setCountedPaise}
                    hint="Notes and coins actually in the box right now."
                  />

                  {countedPaise > 0 || day.expectedCashPaise === 0 ? (
                    <Banner
                      tone={difference === 0 ? 'success' : Math.abs(difference) > 10_000 ? 'danger' : 'warning'}
                      icon={difference === 0 ? '✅' : difference > 0 ? '➕' : '➖'}
                    >
                      {difference === 0
                        ? 'The box matches the app exactly.'
                        : difference > 0
                          ? `${money(difference)} more than the app expects. Look for a bill that was never entered.`
                          : `${money(-difference)} short. Look for an expense that was never entered, or cash given out.`}
                    </Banner>
                  ) : (
                    <Banner tone="info" icon="🧮">
                      Count the notes and coins in the box and type the total. The app will tell you if it is short or
                      extra.
                    </Banner>
                  )}

                  <TextAreaField
                    label="Note (optional)"
                    value={note}
                    onChange={setNote}
                    placeholder="Gave ₹200 to Raju for tea and snacks"
                  />

                  <ErrorNotice error={close.error} />

                  <button
                    type="button"
                    className="btn btn-block btn-lg"
                    disabled={close.busy}
                    onClick={() => void close.run()}
                  >
                    {close.busy ? 'Closing…' : 'Close the Day'}
                  </button>

                  <p className="muted">
                    Closing the day is optional. Nothing stops working if you skip it — it only records what was in the
                    box so you can spot a gap early.
                  </p>
                </div>
              </Card>
            ) : (
              <Banner tone="info" icon="🔒">
                Only the owner or a manager can close the day.
              </Banner>
            )}
          </>
        ) : null}

        {history.data?.closings.length ? (
          <>
            <SectionHeading>Last few closings</SectionHeading>
            <div className="list">
              {history.data.closings.map((closing) => (
                <div className="list-item" key={closing.id}>
                  <div className="li-main">
                    <div className="li-title">{dateLabel(closing.closingDate)}</div>
                    <div className="li-sub">
                      {money(closing.salesPaise)} sales · {money(closing.expensesPaise)} expenses
                    </div>
                  </div>
                  <div className="li-right">
                    <div
                      className="li-amount"
                      style={{
                        color:
                          closing.differencePaise === 0
                            ? 'var(--green-700)'
                            : closing.differencePaise > 0
                              ? 'var(--blue-600)'
                              : 'var(--red-700)',
                      }}
                    >
                      {closing.differencePaise === 0 ? 'Matched' : money(Math.abs(closing.differencePaise))}
                    </div>
                    <div className="li-sub">
                      {closing.differencePaise === 0 ? 'Cash box tallied' : differenceLabel(closing.differencePaise)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </Screen>
    </>
  );
}

const differenceLabel = (differencePaise: number): string => {
  if (differencePaise > 0) return 'Extra in the box';
  if (differencePaise < 0) return 'Short in the box';
  return 'Matched exactly';
};
