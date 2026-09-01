import { Gamepad2, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

/** The currently LIVE game from the backend games list, if any. */
export default function OngoingEvent({ games }) {
  const liveGame = (games ?? []).find((g) => g.status === 'LIVE');
  const route = liveGame?.route ? `/games/${liveGame.route}` : null;

  return (
    <section className="dashboard-section ongoing-event-card">
      <div className="geo-bg-circle"></div>
      <div className="geo-bg-ring"></div>

      <div className="section-header" style={{ borderBottomColor: 'var(--accent-border)' }}>
        <Gamepad2 className="section-icon" size={24} />
        <h2 className="section-title">Current Challenge</h2>
      </div>

      {liveGame ? (
        <div className="event-details">
          <p className="ongoing-sub">● LIVE</p>
          <h3 className="ongoing-title">{liveGame.name}</h3>

          <div className="event-detail-row">
            <span className="geo geo-triangle" style={{ color: 'var(--accent)' }}></span>
            {liveGame.description || 'Competition round in progress'}
          </div>
          <div className="event-detail-row">
            <span className="geo geo-circle" style={{ color: 'var(--text-dim)' }}></span>
            Status: <strong>{liveGame.status}</strong>
          </div>

          {route && (
            <Link to={route} className="primary-btn">
              Enter Game <ArrowRight size={18} />
            </Link>
          )}
        </div>
      ) : (
        <div className="event-details">
          <p className="ongoing-sub">● STANDBY</p>
          <h3 className="ongoing-title">No event is currently active</h3>
          <p className="event-brief">
            Check the schedule and notifications for the next challenge.
          </p>
        </div>
      )}
    </section>
  );
}
