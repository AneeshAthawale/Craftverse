import React from 'react';
import { Gamepad2, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function OngoingEvent() {
  return (
    <section className="dashboard-section ongoing-event-card">
      <div className="geo-bg-circle"></div>
      <div className="geo-bg-ring"></div>

      <div className="section-header" style={{ borderBottomColor: 'var(--accent-border)' }}>
        <Gamepad2 className="section-icon" size={24} />
        <h2 className="section-title">Current Challenge</h2>
      </div>

      <div className="event-details">
        <p className="ongoing-sub">● LIVE</p>
        <h3 className="ongoing-title">Red Light Green Light</h3>

        <div className="event-detail-row">
          <span className="geo geo-triangle" style={{ color: 'var(--accent)' }}></span>
          SURVIVAL ROUND
        </div>
        <div className="event-detail-row">
          <span className="geo geo-circle" style={{ color: 'var(--text-dim)' }}></span>
          Status: <strong>LIVE</strong>
        </div>

        <p className="event-brief">
          Survive the algorithm challenges before the time runs out.
        </p>

        <Link to="/games/rlgl" className="primary-btn">
          Enter Game <ArrowRight size={18} />
        </Link>
      </div>
    </section>
  );
}