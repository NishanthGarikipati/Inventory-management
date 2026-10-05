import { useEffect, useRef, useState } from 'react';

/**
 * Takes the photo the scanner reads. A live preview is offered where the
 * browser allows it, and the phone's own camera app is always available as a
 * fallback so a failed permission never blocks the workflow.
 */
export function CameraCapture({
  onCapture,
  busy,
  label = 'Take Photo',
}: {
  onCapture: (file: File) => void;
  busy?: boolean;
  label?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      setLive(true);
      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      }, 0);
    } catch {
      setError('The camera could not start. Use "Choose Photo" instead.');
    }
  };

  const snap = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        streamRef.current?.getTracks().forEach((track) => track.stop());
        setLive(false);
        onCapture(new File([blob], `scan-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92,
    );
  };

  return (
    <div className="stack">
      {error ? <div className="banner warning">{error}</div> : null}
      {live ? (
        <>
          <div className="camera-frame">
            <video ref={videoRef} muted playsInline />
            <div className="camera-overlay" />
          </div>
          <button type="button" className="btn btn-block btn-lg" onClick={snap} disabled={busy}>
            📸 Capture
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-block btn-lg" onClick={startCamera} disabled={busy}>
          📷 {label}
        </button>
      )}

      <button type="button" className="btn btn-secondary btn-block" onClick={() => fileRef.current?.click()} disabled={busy}>
        🖼️ Choose Photo
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onCapture(file);
        }}
      />
    </div>
  );
}
