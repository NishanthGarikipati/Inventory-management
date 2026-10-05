import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import type { IScannerControls } from '@zxing/browser';
import { Sheet, TextField } from './ui';

/**
 * Camera barcode reading. The phone does the decoding: a barcode read on the
 * device is exact, which is why it outranks anything the AI reads off a photo.
 * Typing the number by hand is always available, because cameras fail.
 */
export function BarcodeScanner({
  open,
  onClose,
  onDetected,
  title = 'Scan Barcode',
}: {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
  title?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [manual, setManual] = useState('');
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    let controls: IScannerControls | null = null;
    let cancelled = false;

    const reader = new BrowserMultiFormatReader();
    reader
      .decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result) => {
        if (result && !cancelled) {
          cancelled = true;
          controls?.stop();
          onDetected(result.getText());
        }
      })
      .then((activeControls) => {
        controls = activeControls;
        if (cancelled) activeControls.stop();
      })
      .catch(() => {
        setCameraError('The camera could not start. Type the barcode number instead.');
      });

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [open, onDetected]);

  return (
    <Sheet open={open} title={title} onClose={onClose}>
      <div className="stack">
        {cameraError ? (
          <div className="banner warning">{cameraError}</div>
        ) : (
          <div className="camera-frame">
            <video ref={videoRef} muted playsInline />
            <div className="camera-overlay" />
          </div>
        )}
        <p className="muted">Hold the barcode inside the box.</p>
        <TextField
          label="Or type the barcode number"
          value={manual}
          onChange={setManual}
          inputMode="numeric"
          placeholder="8901234567890"
        />
        <button
          type="button"
          className="btn btn-block"
          disabled={manual.trim().length < 4}
          onClick={() => onDetected(manual.trim())}
        >
          Find Product
        </button>
      </div>
    </Sheet>
  );
}
