import React from 'react';
import { Activity } from 'lucide-react';

export default function EventStatus({ status }) {
  return (
    <section className="dashboard-section">
      <div className="section-header">
        <Activity className="section-icon" size={24} />
        <h2 className="section-title">Event Status</h2>
        <div style={{ flex: 1 }}></div>
        {status === 'ongoing' && (
          <div className="status-badge live">
            <span className="status-indicator"></span>
            LIVE
          </div>
        )}
      </div>

      <div className="event-status-body">
        <span className="sys-tag">
          <span className="dot"></span>
          SYSTEM ONLINE
        </span>

        <p className="event-status-value">Hackathon in progress</p>
        <p className="event-status-desc">
          Please keep an eye on the schedule and notifications for updates.
        </p>

        <div className="event-status-sys">
          <span className="sys-line">SYSTEM STATUS</span>
          <span className="sys-line ok">OPERATIONAL</span>
        </div>
      </div>
    </section>
  );
}