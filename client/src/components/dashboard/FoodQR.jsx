import QRCode from 'react-qr-code';
import { UtensilsCrossed } from 'lucide-react';

/**
 * Displays the food token returned by the backend (GET /api/food/me).
 * The token is ALWAYS backend-generated; never created or validated here.
 */
export default function FoodQR({ access, meal }) {
  // No active meal window or no linked participant -> nothing to show.
  if (!access || !access.token) {
    return (
      <section className="dashboard-section">
        <div className="section-header">
          <UtensilsCrossed className="section-icon" size={24} />
          <h2 className="section-title">Food QR</h2>
        </div>
        <p className="available-soon">
          No food QR is available right now. Your QR appears when a meal break starts.
        </p>
      </section>
    );
  }

  const status = access.status || 'UNUSED';
  const isUsed = status === 'USED';
  const isExpired = status === 'EXPIRED';
  const unusable = isUsed || isExpired;
  const participantLabel = `P${String(access.participant_id).padStart(3, '0')}`;

  return (
    <section className="dashboard-section">
      <div className="section-header">
        <UtensilsCrossed className="section-icon" size={24} />
        <h2 className="section-title">Food QR</h2>
        {!unusable && (
          <span className="food-qr-valid">Valid for current break</span>
        )}
      </div>

      <div className="food-pass">
        <div className="food-pass-header">
          <span className="food-pass-title">
            <span className="geo geo-triangle" style={{ color: 'var(--accent)', marginRight: 8 }}></span>
            Food Access
          </span>
          <span className="food-pass-site">{meal ?? `DAY ${access.event_day}`}</span>
        </div>

        <div className={`food-qr-body ${unusable ? 'food-qr-unusable' : ''}`}>
          <div className="food-qr-code">
            {unusable ? (
              <div className="food-qr-overlay">
                <span>{isUsed ? 'USED' : 'EXPIRED'}</span>
              </div>
            ) : (
              <>
                <QRCode value={access.token} size={148} />
                <div className="food-qr-scan-hint">Scan at the food counter</div>
              </>
            )}
          </div>

          <div className="food-qr-details">
            <div className="food-qr-row">
              <span className="food-qr-label">Meal</span>
              <span className="food-qr-value">{meal ?? `${access.meal_type} · Day ${access.event_day}`}</span>
            </div>
            <div className="food-qr-row">
              <span className="food-qr-label">Participant</span>
              <span className="food-qr-value" style={{ fontFamily: 'var(--mono)' }}>
                {participantLabel}
              </span>
            </div>
            <div className="food-qr-row">
              <span className="food-qr-label">Status</span>
              <span className={`food-qr-status ${status.toLowerCase()}`}>
                {status}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
