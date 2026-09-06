import { useEffect, useState, useCallback } from 'react';
import { LogOut, Users, Trophy, UserCircle, Wifi, WifiOff } from 'lucide-react';
import api from '../services/api.js';
import { onEvent, onReconnect, onSocketStatus } from '../services/socket.js';
import { useAuth } from '../context/useAuth.js';
import EventStatus from '../components/dashboard/EventStatus';
import OngoingEvent from '../components/dashboard/OngoingEvent';
import Games from '../components/dashboard/Games';
import NotificationPanel from '../components/dashboard/NotificationPanel';
import Inquiry from '../components/dashboard/Inquiry';
import './Dashboard.css';
import './TeamDashboard.css';

export default function TeamDashboard() {
  const { user, logout, socketConnected } = useAuth();

  const [team, setTeam] = useState(null);            // { team_id, team_name, registration_status, ... }
  const [participants, setParticipants] = useState([]);
  const [results, setResults] = useState(null);      // null = loading; [] = no results
  const [games, setGames] = useState(null);
  const [eventStatus, setEventStatus] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [inquiries, setInquiries] = useState([]);
  const [error, setError] = useState('');

  const teamId = user?.team_id;

  const loadTeam = useCallback(async () => {
    if (!teamId) return;
    try {
      const data = await api.get(`/teams/${teamId}`);
      setTeam(data.team);
      setParticipants(data.participants ?? []);
    } catch (err) {
      setError(err.message || 'Could not load team information');
    }
  }, [teamId]);

  const loadResults = useCallback(async () => {
    if (!teamId) return;
    try {
      const data = await api.get(`/teams/${teamId}/results`);
      setResults(data.results ?? []);
    } catch (err) {
      // Results are optional — don't block the whole dashboard on failure.
      if (err.status !== 403) setResults([]);
    }
  }, [teamId]);

  const loadGames = useCallback(async () => {
    try {
      const data = await api.get('/games');
      setGames(data.games);
    } catch (err) {
      setError(err.message || 'Could not load games');
    }
  }, []);

  const loadEventStatus = useCallback(async () => {
    try {
      const data = await api.get('/event/status');
      setEventStatus(data.event.status);
    } catch (err) {
      if (err.status !== 401 && err.status !== 403) {
        setError(err.message || 'Could not load event status');
      }
    }
  }, []);

  // Initial load of all dashboard data.
  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;

    (async () => {
      try {
        const [notifRes, inqRes] = await Promise.all([
          api.get('/notifications'),
          api.get('/inquiries/mine'),
        ]);
        if (cancelled) return;
        setNotifications(notifRes.notifications);
        setInquiries(inqRes.inquiries);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load dashboard data');
      }
    })();

    queueMicrotask(loadTeam);
    queueMicrotask(loadResults);
    queueMicrotask(loadGames);
    queueMicrotask(loadEventStatus);

    return () => {
      cancelled = true;
    };
  }, [teamId, loadTeam, loadResults, loadGames, loadEventStatus]);

  // Socket subscriptions — all events the TEAM room legitimately receives.
  useEffect(() => {
    const offStatus = onSocketStatus(() => {}); // socketConnected comes from AuthProvider
    const offReconnect = onReconnect(() => {
      loadEventStatus();
      loadGames();
    });

    const offEventStatus = onEvent('event:status', ({ status }) => {
      setEventStatus(status);
    });

    // Admin scanned the team's Registration QR.
    const offRegistered = onEvent('registration:completed', () => {
      loadTeam();
    });

    const offNotif = onEvent('notification:new', ({ notification }) => {
      setNotifications((prev) => [notification, ...prev]);
    });

    const offInquiry = onEvent('inquiry:updated', ({ inquiry }) => {
      setInquiries((prev) =>
        prev.map((i) => (i.inquiry_id === inquiry.inquiry_id ? inquiry : i))
      );
    });

    // Game lifecycle (started/updated/ended all arrive as game:updated here too).
    const offGame = onEvent('game:updated', (payload) => {
      if (payload?.type === 'result') {
        loadResults();
      } else {
        loadGames();
      }
    });
    const offGameStarted = onEvent('game:started', () => loadGames());
    const offGameEnded = onEvent('game:ended', () => loadGames());

    return () => {
      offStatus();
      offReconnect();
      offEventStatus();
      offRegistered();
      offNotif();
      offInquiry();
      offGame();
      offGameStarted();
      offGameEnded();
    };
  }, [loadTeam, loadGames, loadResults, loadEventStatus]);

  const registered = team?.registration_status === 'REGISTERED';

  if (!team && !error) {
    return (
      <div className="dashboard-container">
        <TeamHeader
          socketConnected={socketConnected}
          user={user}
          onLogout={logout}
          teamName={team?.team_name}
          teamId={teamId}
        />
        <main className="dashboard-main">
          <p className="dash-loading">Loading team dashboard…</p>
        </main>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <TeamHeader
        socketConnected={socketConnected}
        user={user}
        onLogout={logout}
        teamName={team?.team_name}
        teamId={teamId}
      />

      <main className="dashboard-main">
        {error && <p className="dash-error">⚠ {error}</p>}

        <div className="dashboard-grid">
          {/* Left column — event + games */}
          <div className="dashboard-primary">
            <EventStatus eventStatus={eventStatus} />
            <div id="ongoing-event">
              <OngoingEvent eventStatus={eventStatus} games={games} />
            </div>

            {/* Games */}
            <Games games={games} />

            {/* Team results */}
            <section className="dashboard-section">
              <div className="section-header">
                <Trophy className="section-icon" size={24} />
                <h2 className="section-title">Game Results</h2>
              </div>
              {!results ? (
                <p className="available-soon">Loading results…</p>
              ) : results.length === 0 ? (
                <p className="available-soon">
                  No results recorded for your team yet.
                </p>
              ) : (
                <div className="team-results-list">
                  {results.map((r) => (
                    <div key={r.result_id ?? `${r.game_id}-${r.team_id}`} className="team-result-item">
                      <div className="team-result-top">
                        <span className="team-result-game">{r.game_name}</span>
                        <span className={`game-status ${
                          r.result_status === 'WINNER'
                            ? 'live'
                            : r.result_status === 'QUALIFIED'
                              ? 'completed'
                              : r.result_status === 'DISQUALIFIED'
                                ? 'locked'
                                : 'upcoming'
                        }`}>
                          {r.result_status}
                        </span>
                      </div>
                      <div className="team-result-stats">
                        {r.rank != null && (
                          <span className="team-result-stat">
                            Rank: <strong>#{r.rank}</strong>
                          </span>
                        )}
                        {r.score != null && (
                          <span className="team-result-stat">
                            Score: <strong>{r.score}</strong>
                          </span>
                        )}
                        {r.time_seconds != null && (
                          <span className="team-result-stat">
                            Time: <strong>{r.time_seconds}s</strong>
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Right column — team info + support */}
          <div className="dashboard-secondary">
            {/* Team info */}
            <section className="dashboard-section">
              <div className="section-header">
                <Users className="section-icon" size={24} />
                <h2 className="section-title">Team Information</h2>
              </div>

              <div className="user-id-record">
                <div className="user-info-row">
                  <span className="user-info-label">Team ID</span>
                  <span className="user-info-value id-value">{team?.team_id ?? '—'}</span>
                </div>
                <div className="user-info-row">
                  <span className="user-info-label">Team Name</span>
                  <span className="user-info-value">{team?.team_name ?? '—'}</span>
                </div>
                <div className="user-info-row">
                  <span className="user-info-label">Members</span>
                  <span className="user-info-value">{participants.length}</span>
                </div>
                <div className="user-info-row">
                  <span className="user-info-label">Registration</span>
                  <span className={`status-registered ${registered ? '' : 'status-pending'}`}>
                    {registered ? 'REGISTERED' : 'UNREGISTERED'}
                  </span>
                </div>
              </div>

              {!registered && (
                <p className="registration-hint">
                  Your team is not registered yet. When you arrive, an organizer
                  will scan your team's Registration QR to complete registration.
                </p>
              )}

              <div className="member-list">
                {participants.length === 0 ? (
                  <p className="available-soon">No members on this team yet.</p>
                ) : (
                  participants.map((p) => (
                    <div key={p.participant_id} className="member-item">
                      <UserCircle size={18} className="member-icon" />
                      <span className="member-id">
                        P{String(p.participant_id).padStart(3, '0')}
                      </span>
                      <span className="member-name">{p.name}</span>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* Notifications */}
            <NotificationPanel
              notifications={notifications}
              socketConnected={socketConnected}
            />

            {/* Inquiries */}
            <Inquiry
              initial={inquiries}
              onSubmitted={(inq) => setInquiries((prev) => [inq, ...prev])}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

/** Team console header — CraftVerse + team name/ID + socket + logout. */
function TeamHeader({ socketConnected, user, onLogout, teamName, teamId }) {
  return (
    <header className="header-container">
      <div className="header-bar">
        <h1 className="header-logo">
          CraftVerse
          <span className="header-logo-ghost">TEAM CONSOLE</span>
        </h1>

        <div className="header-nav">
          {teamName && (
            <div className="header-profile" title={teamName}>
              <Users size={17} />
              <span>{teamName}</span>
              <span className="header-role">{teamId ?? user?.team_id ?? ''}</span>
            </div>
          )}
          {socketConnected ? (
            <span className="socket-indicator" title="Realtime connected">
              <Wifi size={14} /> LIVE
            </span>
          ) : (
            <span className="socket-indicator off" title="Realtime disconnected">
              <WifiOff size={14} /> OFFLINE
            </span>
          )}
          {onLogout && (
            <button className="header-icon-btn" aria-label="Sign out" onClick={onLogout}>
              <LogOut size={18} />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
