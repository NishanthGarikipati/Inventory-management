import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { TopBar } from '../../components/AppShell';
import { CameraCapture } from '../../components/CameraCapture';
import { Banner, Card, ErrorNotice, Screen } from '../../components/ui';
import { useSubmit } from '../../hooks/useAsync';
import { ApiError, request } from '../../lib/api';
import { toast } from '../../lib/toast';
import type { ErrorAction, ScanDetail, ScanType } from '../../lib/types';

const SCAN_TYPES: Array<{ code: ScanType; icon: string; label: string; hint: string }> = [
  { code: 'INVOICE', icon: '🧾', label: 'Supplier Invoice', hint: 'Adds the goods and the supplier bill' },
  { code: 'PRODUCT', icon: '🏷️', label: 'Product Label', hint: 'Reads name, size, MRP and barcode' },
  { code: 'STOCK_SHEET', icon: '📝', label: 'Stock Sheet', hint: 'Handwritten or printed counts' },
  { code: 'SHELF', icon: '🗄️', label: 'Shelf Photo', hint: 'Rough count from a shelf picture' },
  { code: 'RECEIPT', icon: '🧮', label: 'Purchase Receipt', hint: 'Small cash memo' },
];

/**
 * "Scan Invoice". The photo goes to the server, which reads it and proposes
 * changes - nothing is written to stock here. The owner confirms on the next
 * screen.
 */
export function Scanner() {
  const navigate = useNavigate();
  const [scanType, setScanType] = useState<ScanType>('INVOICE');
  const [poorQuality, setPoorQuality] = useState<string | null>(null);

  const { run, busy, error, clearError } = useSubmit(async (file: File) => {
    setPoorQuality(null);
    const form = new FormData();
    form.append('image', file);
    form.append('scanType', scanType);

    // A barcode read on the phone is exact. Sending it with the photo lets the
    // server match on the number instead of guessing from blurry text.
    const barcodes = await readBarcodes(file);
    if (barcodes.length) form.append('barcodes', JSON.stringify(barcodes));

    try {
      const scan = await request<ScanDetail>('/scanner/scan', { method: 'POST', formData: form });
      navigate(`/scanner/${scan.id}`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'POOR_IMAGE_QUALITY') {
        setPoorQuality(cause.message);
        return;
      }
      if (cause instanceof ApiError && cause.isOffline) {
        toast.warning('Scanning needs the internet. Enter the purchase by hand for now.');
        return;
      }
      throw cause;
    }
  });

  const onErrorAction = (action: ErrorAction) => {
    if (action.action === 'MANUAL_ENTRY') navigate('/purchases/new');
    if (action.action === 'RETAKE') {
      clearError();
      setPoorQuality(null);
    }
  };

  return (
    <>
      <TopBar
        title="Scan"
        back
        actions={
          <button type="button" className="icon-button" aria-label="Past scans" onClick={() => navigate('/scanner/history')}>
            🕘
          </button>
        }
      />
      <Screen>
        <Card title="What are you photographing?" flush>
          <div className="list">
            {SCAN_TYPES.map((type) => (
              <button
                key={type.code}
                type="button"
                className="list-item"
                onClick={() => setScanType(type.code)}
                style={type.code === scanType ? { background: 'var(--teal-50)' } : undefined}
              >
                <div className="avatar">{type.icon}</div>
                <div className="li-main">
                  <div className="li-title">{type.label}</div>
                  <div className="li-sub">{type.hint}</div>
                </div>
                {type.code === scanType ? <span className="checkbox checked">✓</span> : <span className="checkbox" />}
              </button>
            ))}
          </div>
        </Card>

        {poorQuality ? (
          <Banner
            tone="warning"
            icon="📷"
            actions={
              <button type="button" className="btn btn-sm btn-outline" onClick={() => navigate('/purchases/new')}>
                Enter Manually
              </button>
            }
          >
            {poorQuality}
          </Banner>
        ) : null}

        <ErrorNotice error={error} onAction={onErrorAction} />

        {busy ? (
          <Banner tone="info" icon="⏳">
            Reading your photo. This takes a few seconds.
          </Banner>
        ) : null}

        <CameraCapture onCapture={(file) => void run(file)} busy={busy} />

        <Banner tone="info" icon="🔒">
          Nothing changes in your stock until you confirm what was read.
        </Banner>
      </Screen>
    </>
  );
}

async function readBarcodes(file: File): Promise<string[]> {
  try {
    const url = URL.createObjectURL(file);
    try {
      const reader = new BrowserMultiFormatReader();
      const result = await reader.decodeFromImageUrl(url);
      return result ? [result.getText()] : [];
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    // No readable barcode in the picture is normal, not a failure.
    return [];
  }
}
