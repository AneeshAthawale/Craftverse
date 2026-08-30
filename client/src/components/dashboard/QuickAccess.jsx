import React from 'react';
import { Users, QrCode, Utensils, HelpCircle } from 'lucide-react';

function scrollToId(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const TILES = [
  { id: 'participant-info', label: 'My Team', icon: Users, geo: 'circle' },
  { id: 'participant-info', label: 'ID Pass', icon: QrCode, geo: 'square' },
  { id: 'food-qr', label: 'Food QR', icon: Utensils, geo: 'triangle' },
  { id: 'inquiry', label: 'Support', icon: HelpCircle, geo: 'circle' },
];

export default function QuickAccess() {
  return (
    <section className="dashboard-section">
      <h2 className="section-title" style={{ marginBottom: '16px' }}>Quick Access</h2>

      <div className="quick-access-grid">
        {TILES.map((tile) => {
          const Icon = tile.icon;
          return (
            <button
              key={tile.label}
              className="quick-access-btn"
              onClick={() => scrollToId(tile.id)}
            >
              <Icon size={24} />
              <span>{tile.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}