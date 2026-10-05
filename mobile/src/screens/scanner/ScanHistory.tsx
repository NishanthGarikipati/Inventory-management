import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '../../components/AppShell';
import { Badge, ChipRow, Empty, ErrorNotice, Loading, Screen } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { dateTimeLabel, percent } from '../../lib/format';

interface ScanRow {
  id: string;
  scanType: string;
  status: string;
  overallConfidence: number;
  extractedSupplierName: string | null;
  invoiceNumber: string | null;
  createdAt: string;
  _count: { items: number };
}

const TYPE_LABEL: Record<string, string> = {
  INVOICE: 'Invoice',
  RECEIPT: 'Receipt',
  PRODUCT: 'Product label',
  SHELF: 'Shelf photo',
  STOCK_SHEET: 'Stock sheet',
};

const STATUS: Record<string, { tone: 'green' | 'amber' | 'red' | 'grey' | 'blue'; label: string }> = {
  APPROVED: { tone: 'green', label: 'Confirmed' },
  REVIEW_REQUIRED: { tone: 'amber', label: 'Needs review' },
  EXTRACTED: { tone: 'blue', label: 'Read' },
  REJECTED: { tone: 'grey', label: 'Cancelled' },
  FAILED: { tone: 'red', label: 'Could not read' },
  UPLOADED: { tone: 'grey', label: 'Uploaded' },
  PROCESSING: { tone: 'blue', label: 'Reading' },
};

const FILTERS = [
  { value: 'ALL' as const, label: 'All' },
  { value: 'REVIEW_REQUIRED' as const, label: 'Needs review' },
  { value: 'APPROVED' as const, label: 'Confirmed' },
  { value: 'REJECTED' as const, label: 'Cancelled' },
];

/** Every photo the shop scanned, what was read and what was finally confirmed. */
export function ScanHistory() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<(typeof FILTERS)[number]['value']>('ALL');

  const scans = useAsync(
    () => api.get<{ scans: ScanRow[] }>('/scanner', { status: status === 'ALL' ? undefined : status, limit: 100 }),
    [status],
  );

  const rows = scans.data?.scans ?? [];

  return (
    <>
      <TopBar
        title="Smart Scans"
        back
        actions={
          <button type="button" className="icon-button" aria-label="New scan" onClick={() => navigate('/scanner')}>
            📷
          </button>
        }
      />
      <Screen>
        <ChipRow value={status} onChange={setStatus} options={FILTERS} />
        <ErrorNotice error={scans.error} onRetry={scans.reload} />
        {scans.loading ? <Loading /> : null}
        {!scans.loading && !rows.length ? (
          <Empty
            icon="📷"
            title="No scans yet"
            hint="Photograph a supplier invoice and the app will read it for you."
            action={
              <button type="button" className="btn" onClick={() => navigate('/scanner')}>
                Scan Now
              </button>
            }
          />
        ) : null}
        {rows.length ? (
          <div className="list">
            {rows.map((scan) => {
              const badge = STATUS[scan.status] ?? { tone: 'grey' as const, label: scan.status };
              return (
                <button key={scan.id} type="button" className="list-item" onClick={() => navigate(`/scanner/${scan.id}`)}>
                  <div className="li-main">
                    <div className="li-title">
                      {TYPE_LABEL[scan.scanType] ?? scan.scanType}
                      {scan.invoiceNumber ? ` #${scan.invoiceNumber}` : ''}
                    </div>
                    <div className="li-sub">
                      {scan._count.items} products · {scan.extractedSupplierName ?? 'No supplier read'}
                    </div>
                    <div className="li-sub">
                      {dateTimeLabel(scan.createdAt)} · read {percent(scan.overallConfidence)}
                    </div>
                  </div>
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                </button>
              );
            })}
          </div>
        ) : null}
      </Screen>
    </>
  );
}
