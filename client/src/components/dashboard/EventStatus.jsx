import { Activity } from 'lucide-react';

/**
 * Renders the authoritative event lifecycle status passed in by the page.
 * This component never fetches — the container owns the data and updates it
 * via API + `event:status` socket events.
 *
 * status: 'NOT_STARTED' | 'LIVE' | 'BREAK' | 'ENDED' | null (loading)
 */
const STATUS_COPY = {
  NOT_STARTED: {
    badge: 'NOT STARTED',
    title: 'Event has not started yet.',
    desc: 'Check back here when the event begins. The schedule and notifications will keep you updated.',
    isLive: false,
  },
  LIVE: {
    badge: 'LIVE',
    title: 'Hackathon is currently in progress.',
    desc: 'Please keep an eye on the schedule and notifications for updates.',
    isLive: true,
  },
  BREAK: {
    badge: 'BREAK',
    title: 'Event is currently on a break.',
    desc: 'Rest up — the next session will appear here and in notifications when it starts.',
    isLive: false,
  },
  ENDED: {
    badge: 'ENDED',
    title: 'The event has ended.',
    desc: 'Thanks for participating! Final results are available in the games section.',
    isLive: false,
  },
};

export default function EventStatus({ eventStatus, socketConnected }) {
  const copy = STATUS_COPY[eventStatus] ?? null;

  return (
    <section className="dashboard-section">
      <div className="section-header">
        <Activity className="section-icon" size={24} />
        <h2 className="section-title">Event Status</h2>
        <div style={{ flex: 1 }}></div>
        {copy && (
          <div className={`status-badge ${copy.isLive ? 'live' : 'idle'}`}>
            <span className="status-indicator"></span>
            {copy.badge}
          </div>
        )}
      </div>

      <div className="event-status-body">
        <span className="sys-tag">
          <span className={`dot ${socketConnected === false ? 'off' : ''}`}></span>
          {socketConnected === false ? 'SYSTEM OFFLINE' : 'SYSTEM ONLINE'}
        </span>

        {copy ? (
          <>
            <p className="event-status-value">{copy.title}</p>
            <p className="event-status-desc">{copy.desc}</p>
          </>
        ) : (
          <>
            <p className="event-status-value">Loading event status…</p>
            <p className="event-status-desc">Fetching the current state from the backend.</p>
          </>
        )}

        <div className="event-status-sys">
          <span className="sys-line">SYSTEM STATUS</span>
          <span className={`sys-line ${socketConnected === false ? '' : 'ok'}`}>
            {socketConnected === false ? 'RECONNECTING' : 'OPERATIONAL'}
          </span>
        </div>
      </div>
    </section>
  );
}
