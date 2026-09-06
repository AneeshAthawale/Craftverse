import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import api from '../services/api.js';
import { onEvent, onReconnect, getSocket } from '../services/socket.js';
import { useAuth } from '../context/useAuth.js';
import './RLGLControlPanel.css';

/** A tiny ticking clock (250ms) so corner countdowns re-render smoothly.
 *  The snapshot is CACHED (updated only when the interval fires) so
 *  useSyncExternalStore does not see a new value every render. */
let tickerSnapshot = Date.now();
function subscribeTicker(callback) {
  const interval = setInterval(() => {
    tickerSnapshot = Date.now();
    callback();
  }, 250);
  return () => clearInterval(interval);
}
const getTickerSnapshot = () => tickerSnapshot;

export default function RLGLControlPanel() {
  const { user, socketConnected } = useAuth();

  // Authoritative RLGL state (games.config.state).
  const [light, setLight] = useState('GREEN');
  const [roundStatus, setRoundStatus] = useState('WAITING'); // WAITING | ACTIVE | COMPLETED
  const [transition, setTransition] = useState(null); // { to, appliesAt } | null
  const [gameStatus, setGameStatus] = useState('UPCOMING'); // games.status (LIVE)
  const [gameId, setGameId] = useState(null);

  // Team roster — authoritative game_results for the RLGL game.
  const [results, setResults] = useState([]); // [{ team_id, team_name, status, score }]
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { ok, message }

  // A ticking clock drives countdown re-renders; the authoritative transition
  // still arrives via rlgl:state (this is display-only). The store snapshot is
  // an external "now" the render can read without calling an impure function.
  const nowMs = useSyncExternalStore(subscribeTicker, getTickerSnapshot);
  // Hide the pending state the moment the light already reached the target or
  // the remaining time hit 0 (the server's flip broadcast is authoritative).
  const transitionSeconds = transition ? Math.max(0, Math.ceil((transition.appliesAt - nowMs) / 1000)) : 0;
  const transitionPending =
    Boolean(transition) &&
    roundStatus === 'ACTIVE' &&
    transitionSeconds > 0 &&
    light !== transition.to;
  const pending = transitionPending;
  const nextLight = light === 'GREEN' ? 'RED' : 'GREEN';

  const loadRoster = async (gid) => {
    try {
      const res = await api.get(`/games/${gid}/results`);
      setResults(res.results ?? []);
    } catch (err) {
      setNotice({ ok: false, message: err.message || 'Could not load the team roster' });
    }
  };

  const loadState = async () => {
    try {
      const data = await api.get('/games/rlgl/state');
      setGameId(data.gameId);
      setGameStatus(data.status);
      setLight(data.state.light);
      setRoundStatus(data.state.gameStatus);
      setTransition(data.state.transition);
      await loadRoster(data.gameId);
    } catch (err) {
      setNotice({ ok: false, message: err.message || 'Could not load RLGL state' });
    }
  };

  // Load the authoritative state + roster on mount and after reconnects.
  useEffect(() => {
    // Defer so the async state writes don't run synchronously inside the
    // effect body (matches the Admin.jsx pattern).
    queueMicrotask(loadState);
    const offReconnect = onReconnect(loadState);
    return () => offReconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live updates.
  useEffect(() => {
    const offState = onEvent('rlgl:state', ({ state }) => {
      if (!state) return;
      setLight(state.light);
      setRoundStatus(state.gameStatus);
      setTransition(state.transition);
    });
    const refreshRoster = () => {
      if (gameId) loadRoster(gameId);
    };
    const offResult = onEvent('rlgl:result', refreshRoster);
    const offGameUpdated = onEvent('game:updated', refreshRoster);
    return () => {
      offState();
      offResult();
      offGameUpdated();
    };
  }, [gameId]);

  const flash = (ok, message) => {
    setNotice({ ok, message });
    setTimeout(() => setNotice(null), 4000);
  };

  // CHANGE STATE — emit the socket event exactly like the player-driven flow;
  // the server validates the role from the JWT and schedules the countdown.
  const handleChangeState = () => {
    if (pending || roundStatus !== 'ACTIVE') return;
    const socket = getSocket();
    if (!socket) {
      flash(false, 'Socket not connected');
      return;
    }
    socket.emit('rlgl:transition', { to: nextLight }, (ack) => {
      if (!ack?.ok) {
        flash(false, ack?.reason === 'TRANSACTION_PENDING' || ack?.reason === 'TRANSITION_PENDING'
          ? 'A transition is already in progress'
          : ack?.reason === 'GAME_NOT_ACTIVE'
          ? 'Round is not active'
          : ack?.message || 'Could not schedule the state change');
      }
    });
  };

  const handleStartRound = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post('/games/rlgl/start-round');
      if (gameId) await loadRoster(gameId);
      flash(true, 'Round started — results reset.');
    } catch (err) {
      flash(false, err.message || 'Could not start the round');
    } finally {
      setBusy(false);
    }
  };

  const handleEndRound = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post('/games/rlgl/end-round');
      flash(true, 'Round ended.');
    } catch (err) {
      flash(false, err.message || 'Could not end the round');
    } finally {
      setBusy(false);
    }
  };

  const handleDisqualifyTeam = async (teamIdToDq) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/games/rlgl/disqualify/${teamIdToDq}`);
      flash(true, `Team ${teamIdToDq} disqualified.`);
      if (gameId) loadRoster(gameId);
    } catch (err) {
      flash(false, err.message || 'Could not disqualify team');
    } finally {
      setBusy(false);
    }
  };

  const handleDisqualifyAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post('/games/rlgl/disqualify-all');
      flash(true, 'All active teams disqualified.');
      if (gameId) loadRoster(gameId);
    } catch (err) {
      flash(false, err.message || 'Could not disqualify teams');
    } finally {
      setBusy(false);
    }
  };

  const handleReinstateTeam = async (teamIdToReinstate) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/games/rlgl/reinstate/${teamIdToReinstate}`);
      flash(true, `Team ${teamIdToReinstate} reinstated.`);
      if (gameId) loadRoster(gameId);
    } catch (err) {
      flash(false, err.message || 'Could not reinstate team');
    } finally {
      setBusy(false);
    }
  };

  const { activeTeams, victoriousTeams, disqualifiedTeams } = useMemo(() => {
    const active = [];
    const victorious = [];
    const disqualified = [];
    for (const r of results) {
      const label = r.team_name ?? r.team_id;
      if (r.status === 'WINNER') victorious.push({ ...r, label });
      else if (r.status === 'DISQUALIFIED') disqualified.push({ ...r, label });
      else active.push({ ...r, label });
    }
    return { activeTeams: active, victoriousTeams: victorious, disqualifiedTeams: disqualified };
  }, [results]);

  const toggleLabel = roundStatus !== 'ACTIVE'
    ? 'START ROUND'
    : light === 'GREEN'
    ? 'CHANGE STATE → RED'
    : 'CHANGE STATE → GREEN';

  const canToggle = roundStatus === 'ACTIVE' && !pending;

  return (
    <div className="admin-page-container dashboard-layout">
      {/* Sidebar Controls */}
      <div className="admin-sidebar">
        <div className="admin-console-header">
          <span>CRAFTVERSE · RLGL CONTROL</span>
        </div>

        <div className="admin-console-content">
          <div className="admin-status-indicator">
            <div className="status-row">
              <span className="status-dot" style={{ background: light === 'RED' ? '#ff4d6d' : '#34d399' }} />
              Light State:{' '}
              <strong className={light === 'RED' ? 'text-red' : 'text-green'}>{light}</strong>
            </div>
            <div className="status-row">
              Round: <strong>{roundStatus}</strong>
            </div>
            <div className="status-row">
              Game: <strong>{gameStatus}</strong>
            </div>
            {pending && (
              <div className="admin-countdown-badge">
                STATE CHANGE IN {transitionSeconds}s → {transition?.to}
              </div>
            )}
          </div>

          <div className="admin-action-buttons">
            {roundStatus !== 'ACTIVE' ? (
              <button
                className="btn-admin-toggle to-green"
                onClick={handleStartRound}
                disabled={busy}
              >
                {busy ? 'STARTING…' : 'START ROUND'}
              </button>
            ) : (
              <button
                className={`btn-admin-toggle ${light === 'GREEN' ? 'to-red' : 'to-green'}`}
                onClick={handleChangeState}
                disabled={!canToggle}
              >
                {pending
                  ? `SWITCHING IN ${transitionSeconds}s…`
                  : toggleLabel}
              </button>
            )}
            {roundStatus === 'ACTIVE' && (
              <button
                className="btn-admin-danger"
                onClick={handleDisqualifyAll}
                disabled={busy || activeTeams.length === 0}
              >
                DISQUALIFY ALL ACTIVE
              </button>
            )}
            {roundStatus === 'ACTIVE' && (
              <button
                className="btn-admin-ghost"
                onClick={handleEndRound}
                disabled={busy}
              >
                END ROUND
              </button>
            )}
          </div>

          {notice && (
            <div className={`admin-notice ${notice.ok ? 'ok' : 'err'}`}>{notice.message}</div>
          )}

          <div className="status-row connection-info">
            <span className={`connection-status ${socketConnected ? 'connected' : 'disconnected'}`}>
              {socketConnected ? '● LIVE' : '○ RECONNECTING'}
            </span>
            <span className="admin-identity">
              {user?.email ?? 'admin'} · {user?.role ?? ''}
            </span>
          </div>
        </div>
      </div>

      {/* Main Dashboard Panel */}
      <div className="admin-main-panel">
        <div className="dashboard-header">
          <h2>RLGL Control Panel</h2>
          <p>Authoritative arena state — live across every connected client.</p>
        </div>

        <div className="teams-grid">
          {/* Active Teams */}
          <div className="teams-column">
            <h3>ACTIVE ({activeTeams.length})</h3>
            <div className="teams-list active-list">
              {activeTeams.length === 0 ? (
                <p className="empty-msg">No teams in play.</p>
              ) : (
                activeTeams.map((t) => (
                  <div key={t.team_id} className="team-card active-team">
                    <span className="team-name">{t.label}</span>
                    <button className="btn-sm-danger" onClick={() => handleDisqualifyTeam(t.team_id)}>
                      Disqualify
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Victorious Teams */}
          <div className="teams-column">
            <h3>FINISHED ({victoriousTeams.length})</h3>
            <div className="teams-list victory-list">
              {victoriousTeams.length === 0 ? (
                <p className="empty-msg">No finishers yet.</p>
              ) : (
                victoriousTeams.map((t) => (
                  <div key={t.team_id} className="team-card victory-team">
                    <span className="team-name">{t.label}</span>
                    {t.score !== null && <span className="team-score">score {t.score}</span>}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Disqualified Teams */}
          <div className="teams-column">
            <h3>DISQUALIFIED ({disqualifiedTeams.length})</h3>
            <div className="teams-list disqualified-list">
              {disqualifiedTeams.length === 0 ? (
                <p className="empty-msg">No disqualified teams.</p>
              ) : (
                disqualifiedTeams.map((t) => (
                  <div key={t.team_id} className="team-card disqualified-team">
                    <span className="team-name">{t.label}</span>
                    <button className="btn-sm-reinstate" onClick={() => handleReinstateTeam(t.team_id)}>
                      Reinstate
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
