import React from 'react';
import QRCode from 'react-qr-code';
import { UtensilsCrossed } from 'lucide-react';

export default function FoodQR({ access }) {
  // Single current food-access entry following the food_access table shape.
  const current = access ?? {
    participantId: 'P001',
    mealType: 'Day 1 · Lunch',
    eventDay: 1,
    token: 'cv-food-P001-D1-LUNCH-9f3a2c',
    status: 'UNUSED'
  };

  const isUsed = current.status === 'USED';
  const isExpired = current.status === 'EXPIRED';
  const unusable = isUsed || isExpired;

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
          <span className="food-pass-site">DAY {current.eventDay}</span>
        </div>

        <div className={`food-qr-body ${unusable ? 'food-qr-unusable' : ''}`}>
          <div className="food-qr-code">
            {unusable ? (
              <div className="food-qr-overlay">
                <span>{isUsed ? 'USED' : 'EXPIRED'}</span>
              </div>
            ) : (
              <>
                <QRCode value={current.token} size={148} />
                <div className="food-qr-scan-hint">Scan at the food counter</div>
              </>
            )}
          </div>

          <div className="food-qr-details">
            <div className="food-qr-row">
              <span className="food-qr-label">Meal</span>
              <span className="food-qr-value">{current.mealType}</span>
            </div>
            <div className="food-qr-row">
              <span className="food-qr-label">Participant</span>
              <span className="food-qr-value" style={{ fontFamily: 'var(--mono)' }}>
                {current.participantId}
              </span>
            </div>
            <div className="food-qr-row">
              <span className="food-qr-label">Status</span>
              <span className={`food-qr-status ${current.status.toLowerCase()}`}>
                {current.status}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}