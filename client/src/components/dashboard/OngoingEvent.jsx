import { Gamepad2, ArrowRight, Coffee, Hourglass, Flag } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * Shows the currently active challenge — but only when the EVENT lifecycle
 * actually warrants it. Event status and game status are independent concepts:
 * a game can be LIVE while the event is NOT_STARTED/BREAK/ENDED, and the event
 * can be LIVE while no game is running. The event status (backend-authoritative)
 * decides what a participant should see here.
 */
export default function OngoingEvent({ eventStatus, games }) {
  const liveGame = (games ?? []).find((g) => g.status === 'LIVE');
  const route = liveGame?.route ? `/games/${liveGame.route}` : null;

  // Game challenge is shown only during a LIVE event with a LIVE game.
  const showGame = eventStatus === 'LIVE' && liveGame;

  if (showGame) {
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
      </section>
    );
  }

  // Event is live but no game is currently active.
  if (eventStatus === 'LIVE') {
    return (
      <section className="dashboard-section ongoing-event-card">
        <div className="geo-bg-circle"></div>
        <div className="geo-bg-ring"></div>

        <div className="section-header" style={{ borderBottomColor: 'var(--accent-border)' }}>
          <Gamepad2 className="section-icon" size={24} />
          <h2 className="section-title">Ongoing Event</h2>
        </div>

        <div className="event-details">
          <p className="ongoing-sub">● LIVE</p>
          <h3 className="ongoing-title">No game is currently active</h3>
          <p className="event-brief">
            The event is in progress. Check the schedule and notifications for the next challenge.
          </p>
        </div>
      </section>
    );
  }

  // Non-live lifecycle states.
  const idle = {
    NOT_STARTED: {
      icon: <Hourglass size={26} />,
      sub: '● NOT STARTED',
      title: 'Event has not started yet',
      brief: 'The hackathon begins soon. Watch notifications for the kickoff.',
    },
    BREAK: {
      icon: <Coffee size={26} />,
      sub: '● BREAK',
      title: 'Event is currently on a break',
      brief: 'Games are paused. The next session will appear here when it starts.',
    },
    ENDED: {
      icon: <Flag size={26} />,
      sub: '● ENDED',
      title: 'The event has ended',
      brief: 'Thanks for participating! Check the games section for final results.',
    },
  }[eventStatus];

  return (
    <section className="dashboard-section ongoing-event-card">
      <div className="geo-bg-circle"></div>
      <div className="geo-bg-ring"></div>

      <div className="section-header" style={{ borderBottomColor: 'var(--accent-border)' }}>
        <Gamepad2 className="section-icon" size={24} />
        <h2 className="section-title">Ongoing Event</h2>
      </div>

      {idle ? (
        <div className="event-details">
          <p className="ongoing-sub">{idle.sub}</p>
          <h3 className="ongoing-title">{idle.title}</h3>
          <p className="event-brief">{idle.brief}</p>
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
