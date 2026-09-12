import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import QrScanner from 'qr-scanner';
import api from '../services/api.js';
import './QrScanner.css';

/** Participant's food tokens are `cv-food-…` (see server/services/food.service.js). */
const FOOD_TOKEN_PREFIX = 'cv-food-';

function participantLabel(participant) {
  if (!participant) return '—';
  const id = participant.participant_id != null
    ? `P${String(participant.participant_id).padStart(3, '0')}`
    : null;
  const name = participant.name ?? null;
  if (name && id) return `${name} (${id})`;
  return name ?? id ?? '—';
}

/**
 * Organizer-facing Food QR scanner.
 *
 * Decodes a participant's individual Food QR and sends the token to
 * POST /api/food/verify — the authoritative endpoint that marks the token USED.
 * This is deliberately SEPARATE from the registration scanner: registration
 * QRs are team-level check-in, food QRs are per-participant meal access. The
 * two are never accepted interchangeably.
 */
export default function ScanFoodQR() {
  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  // Guards against duplicate submissions while a verify request is in flight.
  const busyRef = useRef(false);
  // True once a terminal result is shown (scanner paused until "Scan next").
  const doneRef = useRef(false);

  const [status, setStatus] = useState('starting');
  const [result, setResult] = useState(null);
  const [errMessage, setErrMessage] = useState(null);
  const [notice, setNotice] = useState(null);
  // Bumping this tears down and re-creates the scanner (retry after error).
  const [initKey, setInitKey] = useState(0);

  const handleDecode = useCallback(async (scanResult) => {
    const token = (typeof scanResult === 'string' ? scanResult : scanResult?.data ?? '').trim();
    if (!token || busyRef.current || doneRef.current) return;

    // Non-authoritative hint only. The server still rejects a registration
    // token posted to /food/verify (it has no matching food_access row -> 404).
    if (!token.startsWith(FOOD_TOKEN_PREFIX)) {
      setNotice('That is not a Food QR. Scan a participant\'s Food QR instead.');
      return;
    }

    busyRef.current = true;
    doneRef.current = true;
    setNotice(null);
    setErrMessage(null);
    setResult(null);
    setStatus('verifying');

    try {
      await scannerRef.current?.pause();
    } catch {
      // Scanner already stopped; the guard above prevents resubmits.
    }

    try {
      const data = await api.post('/food/verify', { token });
      setResult({ participant: data.participant, mealLabel: data.mealLabel });
      setStatus('success');
    } catch (err) {
      setErrMessage(err?.message ?? 'Verification failed');
      if (err?.code === 'ALREADY_USED') setStatus('already');
      else if (err?.code === 'TOKEN_EXPIRED') setStatus('expired');
      else if (err?.code === 'MEAL_NOT_ACTIVE') setStatus('not-active');
      else if (err?.code === 'INVALID_TOKEN') setStatus('invalid');
      else if (err?.status === 0 || err?.code === 'NETWORK_ERROR') setStatus('network');
      else setStatus('error');
    } finally {
      busyRef.current = false;
    }
  }, []);

  // Create the scanner once (and again whenever initKey changes for a retry).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    let cancelled = false;

    const init = async () => {
      setStatus('starting');
      setNotice(null);
      setResult(null);
      setErrMessage(null);
      doneRef.current = false;

      if (!window.isSecureContext) {
        setStatus('insecure');
        return;
      }

      let hasCamera;
      try {
        hasCamera = await QrScanner.hasCamera();
      } catch {
        hasCamera = false;
      }
      if (cancelled) return;
      if (!hasCamera) {
        setStatus('no-camera');
        return;
      }

      const scanner = new QrScanner(video, handleDecode, {
        onDecodeError: () => {},
        preferredCamera: 'environment',
        maxScansPerSecond: 10,
        highlightScanRegion: true,
        highlightCodeOutline: true,
        returnDetailedScanResult: true,
      });
      scannerRef.current = scanner;

      try {
        await scanner.start();
        if (!cancelled) setStatus('scanning');
      } catch (err) {
        if (cancelled) return;
        const name = err?.name ?? '';
        if (name === 'NotAllowedError' || name === 'SecurityError' || /permission/i.test(err?.message ?? '')) {
          setStatus('permission');
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError') {
          setStatus('no-camera');
        } else {
          setErrMessage(err?.message ?? 'Camera error');
          setStatus('error');
        }
      }
    };

    init();

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner) {
        try {
          scanner.stop();
        } catch {
          // Already stopped.
        }
        try {
          scanner.destroy();
        } catch {
          // Already destroyed.
        }
      }
    };
  }, [initKey, handleDecode]);

  // Resume scanning for the next participant after a result.
  const goAgain = useCallback(async () => {
    doneRef.current = false;
    busyRef.current = false;
    setResult(null);
    setErrMessage(null);
    setNotice(null);

    const scanner = scannerRef.current;
    if (!scanner) {
      setInitKey((k) => k + 1);
      return;
    }
    setStatus('scanning');
    try {
      await scanner.start();
    } catch (err) {
      setErrMessage(err?.message ?? 'Could not restart the camera');
      setStatus('error');
    }
  }, []);

  const isTerminal = status === 'success' || status === 'already' || status === 'expired' ||
    status === 'not-active' || status === 'invalid' || status === 'network' ||
    status === 'error' || status === 'permission' || status === 'no-camera' ||
    status === 'insecure';

  const statusText = {
    starting: 'Starting camera…',
    scanning: 'Point the camera at a participant\'s Food QR.',
    verifying: 'Verifying…',
  }[status];

  return (
    <div className="scan-page">
      <header className="scan-header">
        <div className="scan-header-left">
          <span className="scan-brand">CraftVerse</span>
          <span className="scan-subtitle">FOOD SCANNER</span>
        </div>
        <Link to="/admin" className="scan-back">← Admin Console</Link>
      </header>

      <main className="scan-main">
        <div className="scan-stage">
          <div className={`scan-video-wrap${isTerminal ? ' hidden' : ''}`}>
            <video ref={videoRef} className="scan-video" muted playsInline />
            {status === 'verifying' && <div className="scan-video-overlay">Verifying…</div>}
          </div>
          {statusText && <p className="scan-status">{statusText}</p>}
          {notice && <p className="scan-notice">{notice}</p>}
        </div>

        <aside className="scan-panel">
          {status === 'starting' && <p className="scan-hint">Requesting camera access…</p>}

          {status === 'scanning' && (
            <div className="scan-guide">
              <h2 className="scan-guide-title">Scan a Food QR</h2>
              <p className="scan-guide-text">
                Each participant has their own meal token. One scan marks that
                person's meal as used for the current break.
              </p>
            </div>
          )}

          {status === 'verifying' && <p className="scan-hint">Contacting the server…</p>}

          {status === 'success' && (
            <div className="scan-result ok">
              <span className="scan-result-tag">VALID</span>
              <dl className="scan-kv">
                <dt className="scan-kv-label">Participant</dt>
                <dd className="scan-kv-value">{participantLabel(result?.participant)}</dd>
                <dt className="scan-kv-label">Meal</dt>
                <dd className="scan-kv-value">{result?.mealLabel ?? '—'}</dd>
                <dt className="scan-kv-label">Status</dt>
                <dd className="scan-kv-value">USED</dd>
              </dl>
              <button className="scan-btn primary" type="button" onClick={goAgain}>
                Scan next
              </button>
            </div>
          )}

          {status === 'already' && (
            <div className="scan-result warn">
              <span className="scan-result-tag">ALREADY USED</span>
              <p className="scan-result-line">{errMessage}</p>
              <p className="scan-result-note">This meal token was already redeemed.</p>
              <button className="scan-btn" type="button" onClick={goAgain}>
                Scan next
              </button>
            </div>
          )}

          {status === 'expired' && (
            <div className="scan-result warn">
              <span className="scan-result-tag">EXPIRED</span>
              <p className="scan-result-line">{errMessage}</p>
              <button className="scan-btn" type="button" onClick={goAgain}>
                Scan next
              </button>
            </div>
          )}

          {status === 'not-active' && (
            <div className="scan-result warn">
              <span className="scan-result-tag">NOT ACTIVE</span>
              <p className="scan-result-line">{errMessage}</p>
              <button className="scan-btn" type="button" onClick={goAgain}>
                Scan next
              </button>
            </div>
          )}

          {status === 'invalid' && (
            <div className="scan-result bad">
              <span className="scan-result-tag">INVALID QR</span>
              <p className="scan-result-line">This is not a valid Food QR.</p>
              <button className="scan-btn" type="button" onClick={goAgain}>
                Try again
              </button>
            </div>
          )}

          {status === 'network' && (
            <div className="scan-result bad">
              <span className="scan-result-tag">CONNECTION ERROR</span>
              <p className="scan-result-line">Cannot reach the server. Check the connection and retry.</p>
              <button className="scan-btn" type="button" onClick={goAgain}>
                Retry
              </button>
            </div>
          )}

          {status === 'error' && (
            <div className="scan-result bad">
              <span className="scan-result-tag">SCAN FAILED</span>
              <p className="scan-result-line">{errMessage ?? 'Something went wrong.'}</p>
              <button className="scan-btn" type="button" onClick={() => setInitKey((k) => k + 1)}>
                Try again
              </button>
            </div>
          )}

          {status === 'permission' && (
            <div className="scan-result bad">
              <span className="scan-result-tag">CAMERA PERMISSION DENIED</span>
              <p className="scan-result-line">
                Allow camera access for this site in your browser settings, then retry.
              </p>
              <button className="scan-btn" type="button" onClick={() => setInitKey((k) => k + 1)}>
                Try again
              </button>
              <Link to="/admin" className="scan-link">Or use manual token entry in the Admin Console</Link>
            </div>
          )}

          {status === 'no-camera' && (
            <div className="scan-result bad">
              <span className="scan-result-tag">CAMERA UNAVAILABLE</span>
              <p className="scan-result-line">No usable camera was found on this device.</p>
              <button className="scan-btn" type="button" onClick={() => setInitKey((k) => k + 1)}>
                Retry
              </button>
              <Link to="/admin" className="scan-link">Or use manual token entry in the Admin Console</Link>
            </div>
          )}

          {status === 'insecure' && (
            <div className="scan-result bad">
              <span className="scan-result-tag">CAMERA REQUIRES HTTPS</span>
              <p className="scan-result-line">
                Browser cameras only work over a secure connection (HTTPS or localhost).
              </p>
              <Link to="/admin" className="scan-link">Use manual token entry instead</Link>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
