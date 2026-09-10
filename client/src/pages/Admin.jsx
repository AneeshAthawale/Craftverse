import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api.js';
import { onEvent, onReconnect, onSocketStatus } from '../services/socket.js';
import { useAuth } from '../context/useAuth.js';
import './Admin.css';

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const NOTIF_TYPES = ['NORMAL', 'IMPORTANT', 'GAME', 'EMERGENCY'];
const EVENT_STATUSES = ['NOT_STARTED', 'LIVE', 'BREAK', 'ENDED'];
const GAME_STATUS_META = {
  LIVE: 'live',
  UPCOMING: 'upcoming',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  LOCKED: 'locked',
};

// Games that currently ship an admin control panel (route registered in App.jsx).
// Add a game's route here when its control panel exists so the link stays
// generic without pointing at a 404.
const GAME_CONTROL_ROUTES = ['rlgl'];

export default function Admin() {
  const { user, logout, socketConnected } = useAuth();

  const [stats, setStats] = useState(null);
  const [eventStatus, setEventStatus] = useState(null); // NOT_STARTED | LIVE | BREAK | ENDED
  const [teams, setTeams] = useState(null);
  const [participants, setParticipants] = useState(null);
  const [games, setGames] = useState(null);
  const [notifications, setNotifications] = useState(null);
  const [inquiries, setInquiries] = useState(null);
  const [error, setError] = useState('');

  // Event control: which status change is currently in flight + result feedback.
  const [eventBusy, setEventBusy] = useState(false);
  const [eventResult, setEventResult] = useState(null); // { ok, message }

  // Notification compose form.
  const [notifTitle, setNotifTitle] = useState('');
  const [notifMessage, setNotifMessage] = useState('');
  const [notifType, setNotifType] = useState('NORMAL');
  const [notifStatus, setNotifStatus] = useState('');

  // Inquiry reply state: { id, status, response } | null
  const [replying, setReplying] = useState(null);

  // Participant management: detail panel for one participant.
  const [manage, setManage] = useState(null);       // participant detail object
  const [editForm, setEditForm] = useState(null);   // { name, email, phone }
  const [manageBusy, setManageBusy] = useState(false);
  const [resetPw, setResetPw] = useState('');       // new password to confirm
  const [manageMsg, setManageMsg] = useState(null); // { ok, message }

  // Registration verification.
  const [regToken, setRegToken] = useState('');
  const [regResult, setRegResult] = useState(null); // { ok, message, team? }
  const [regBusy, setRegBusy] = useState(false);

  const loadAll = useCallback(async () => {
    setError('');
    try {
      const [statsRes, eventRes, teamsRes, partsRes, gamesRes, notifRes, inqRes] = await Promise.all([
        api.get('/admin/stats'),
        api.get('/event/status'),
        api.get('/teams'),
        api.get('/participants'),
        api.get('/games'),
        api.get('/notifications'),
        api.get('/inquiries'),
      ]);
      setStats(statsRes.stats);
      setEventStatus(eventRes.event.status);
      setTeams(teamsRes.teams);
      setParticipants(partsRes.participants);
      setGames(gamesRes.games);
      setNotifications(notifRes.notifications);
      setInquiries(inqRes.inquiries);
    } catch (err) {
      setError(err.message || 'Could not load admin dashboard');
    }
  }, []);

  useEffect(() => {
    queueMicrotask(loadAll);
  }, [loadAll]);

  // Socket subscriptions (cleaned up on unmount).
  useEffect(() => {
    const offNotif = onEvent('notification:new', ({ notification }) => {
      setNotifications((prev) => {
        const list = prev ?? [];
        // Idempotent: the sender prepends from the POST response, and the
        // broadcast also reaches this admin's own socket — avoid duplicates.
        if (list.some((n) => n.notification_id === notification.notification_id)) return list;
        return [notification, ...list];
      });
    });
    const offInqNew = onEvent('inquiry:new', ({ inquiry }) => {
      setInquiries((prev) => [inquiry, ...(prev ?? [])]);
    });
    const offInqUpd = onEvent('inquiry:updated', ({ inquiry }) => {
      setInquiries((prev) =>
        (prev ?? []).map((i) => (i.inquiry_id === inquiry.inquiry_id ? inquiry : i))
      );
    });
    const offGame = onEvent('game:updated', () => {
      // Refresh games list on any game status change.
      api.get('/games').then((r) => setGames(r.games)).catch(() => {});
    });
    const offReg = onEvent('registration:completed', ({ team }) => {
      if (!team) return;
      setTeams((prev) =>
        (prev ?? []).map((t) =>
          t.team_id === team.team_id ? { ...t, registration_status: 'REGISTERED', registered_at: team.registered_at } : t
        )
      );
      // Reconcile with the authoritative /admin/stats rather than assuming the
      // +1/-1 math (a team that was never PENDING would drift the counters).
      api.get('/admin/stats').then((r) => setStats(r.stats)).catch(() => {});
    });
    const offStatus = onSocketStatus(() => {}); // keep socket helper wired
    // Refetch ALL authoritative state after a socket reconnect (avoids stale UI
    // from notifications/inquiries/stats that changed while offline).
    const offReconnect = onReconnect(() => {
      queueMicrotask(loadAll);
    });
    // Another admin changed the event state — reflect it immediately.
    const offEventStatus = onEvent('event:status', ({ status }) => {
      setEventStatus(status);
    });

    return () => {
      offNotif();
      offInqNew();
      offInqUpd();
      offGame();
      offReg();
      offStatus();
      offReconnect();
      offEventStatus();
    };
  }, [loadAll]);

  const handleSendNotification = async (e) => {
    e.preventDefault();
    if (!notifTitle.trim() || !notifMessage.trim()) return;
    setNotifStatus('sending');
    try {
      const { notification } = await api.post('/notifications', {
        type: notifType,
        title: notifTitle.trim(),
        message: notifMessage.trim(),
      });
      setNotifTitle('');
      setNotifMessage('');
      setNotifType('NORMAL');
      // Prepend the backend-confirmed notification so the list is correct even
      // if the socket broadcast is delayed or down (it will not double-add:
      // the socket path prepends only when THIS admin is not the sender).
      setNotifications((prev) => [notification, ...(prev ?? [])]);
      setNotifStatus('sent');
      setTimeout(() => setNotifStatus(''), 2500);
    } catch (err) {
      setNotifStatus('error:' + (err.message || 'Could not send'));
    }
  };

  const handleSetEventStatus = async (status) => {
    if (eventBusy || status === eventStatus) return;
    setEventBusy(true);
    setEventResult(null);
    try {
      const { event } = await api.patch('/event/status', { status });
      // Reflect the backend-confirmed value (the socket also broadcasts it).
      setEventStatus(event.status);
      setEventResult({ ok: true, message: `Event status changed to ${event.status}.` });
    } catch (err) {
      setEventResult({ ok: false, message: err.message || 'Could not update event status' });
    } finally {
      setEventBusy(false);
    }
  };

  const handleVerifyRegistration = async (e) => {
    e.preventDefault();
    const token = regToken.trim();
    if (!token) return;
    setRegBusy(true);
    setRegResult(null);
    try {
      const data = await api.post('/registration/verify', { token });
      setRegResult({ ok: true, message: `Team ${data.team.team_name} (${data.team.team_id}) registered.` });
      setRegToken('');
      // Update UI immediately; socket event also updates other admin clients.
      setTeams((prev) =>
        (prev ?? []).map((t) =>
          t.team_id === data.team.team_id ? { ...t, registration_status: 'REGISTERED', registered_at: data.team.registered_at } : t
        )
      );
      setStats((prev) =>
        prev
          ? {
              ...prev,
              registeredTeams: prev.registeredTeams + 1,
              pendingTeams: Math.max(0, prev.pendingTeams - 1),
            }
          : prev
      );
      loadAll();
    } catch (err) {
      setRegResult({ ok: false, message: err.message || 'Verification failed' });
    } finally {
      setRegBusy(false);
    }
  };

  const handleReply = async (e) => {
    e.preventDefault();
    if (!replying) return;
    const body = {};
    if (replying.status) body.status = replying.status;
    if (replying.response !== undefined) body.response = replying.response;
    if (Object.keys(body).length === 0) return;
    try {
      const { inquiry } = await api.patch(`/inquiries/${replying.id}`, body);
      setInquiries((prev) =>
        (prev ?? []).map((i) => (i.inquiry_id === inquiry.inquiry_id ? inquiry : i))
      );
      setReplying(null);
    } catch (err) {
      setError(err.message || 'Could not update inquiry');
    }
  };

  // ---- Participant management (ADMIN/DEV) ----

  /** Refresh the participant + team lists after an edit/leader change. */
  const refreshParticipantLists = useCallback(async () => {
    try {
      const [p, t] = await Promise.all([api.get('/participants'), api.get('/teams')]);
      setParticipants(p.participants);
      setTeams(t.teams);
    } catch (err) {
      setError(err.message || 'Could not refresh lists');
    }
  }, []);

  const openManage = async (p) => {
    setManageMsg(null);
    setResetPw('');
    try {
      const { participant } = await api.get(`/participants/${p.participant_id}`);
      setManage(participant);
      setEditForm({
        name: participant.name,
        email: participant.email ?? '',
        phone: participant.phone ?? '',
      });
    } catch (err) {
      setError(err.message || 'Could not load participant details');
    }
  };

  const closeManage = () => {
    setManage(null);
    setEditForm(null);
    setResetPw('');
    setManageMsg(null);
  };

  const handleSaveParticipant = async (e) => {
    e.preventDefault();
    if (!manage || !editForm) return;
    setManageBusy(true);
    setManageMsg(null);
    try {
      const { participant } = await api.patch(`/participants/${manage.participant_id}`, {
        name: editForm.name.trim(),
        email: editForm.email.trim(),
        phone: editForm.phone.trim() || null,
      });
      setManage(participant);
      setEditForm({
        name: participant.name,
        email: participant.email ?? '',
        phone: participant.phone ?? '',
      });
      setManageMsg({ ok: true, message: 'Participant details saved.' });
      await refreshParticipantLists();
    } catch (err) {
      setManageMsg({ ok: false, message: err.message || 'Could not save participant' });
    } finally {
      setManageBusy(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!manage) return;
    if (resetPw.length < 6) {
      setManageMsg({ ok: false, message: 'New password must be at least 6 characters.' });
      return;
    }
    setManageBusy(true);
    setManageMsg(null);
    try {
      const data = await api.post(`/participants/${manage.participant_id}/reset-password`, {
        password: resetPw,
      });
      setResetPw('');
      setManageMsg({ ok: true, message: data.message || 'Password updated.' });
    } catch (err) {
      setManageMsg({ ok: false, message: err.message || 'Could not reset password' });
    } finally {
      setManageBusy(false);
    }
  };

  const handleMakeLeader = async () => {
    if (!manage) return;
    if (!window.confirm(`Make ${manage.name} the team leader of ${manage.team_id}?`)) return;
    setManageBusy(true);
    setManageMsg(null);
    try {
      const data = await api.post(`/participants/${manage.participant_id}/make-leader`);
      setManage((prev) => ({ ...prev, is_leader: true }));
      setManageMsg({ ok: true, message: data.message || 'Team leader updated.' });
      await refreshParticipantLists();
    } catch (err) {
      setManageMsg({ ok: false, message: err.message || 'Could not change team leader' });
    } finally {
      setManageBusy(false);
    }
  };

  if (!stats && !error) {
    return (
      <div className="admin-page">
        <p className="dash-loading">Loading admin dashboard…</p>
      </div>
    );
  }

  const statCards = stats
    ? [
        { label: 'Teams', value: stats.teams },
        { label: 'Checked in', value: stats.registeredTeams },
        { label: 'Pending', value: stats.pendingTeams },
        { label: 'Participants', value: stats.participants },
        { label: 'Live Games', value: stats.liveGames },
        { label: 'Completed', value: stats.completedGames },
        { label: 'Open Inquiries', value: stats.openInquiries },
      ]
    : [];

  return (
    <div className="admin-page">
      <header className="admin-header">
        <div className="admin-header-left">
          <h1 className="admin-title">CraftVerse</h1>
          <span className="admin-subtitle">ADMIN CONSOLE</span>
        </div>
        <div className="admin-header-right">
          {socketConnected ? (
            <span className="socket-indicator">● LIVE</span>
          ) : (
            <span className="socket-indicator off">○ OFFLINE</span>
          )}
          <span className="admin-identity">
            {user?.email ?? 'admin'} <span className="header-role">{user?.role ?? 'ADMIN'}</span>
          </span>
          <Link to="/" className="admin-link">Participant View</Link>
          <button className="admin-logout" onClick={logout}>Logout</button>
        </div>
      </header>

      {error && <p className="dash-error">⚠ {error}</p>}

      <main className="admin-main">
        {/* Event Control — authoritative event lifecycle (backend-controlled) */}
        <section className="admin-section">
          <h2 className="admin-section-title">Event Control</h2>
          <p className="admin-section-desc">
            Current Event Status:{' '}
            <strong className="admin-event-status">{eventStatus ?? 'Loading…'}</strong>
          </p>
          <div className="admin-event-actions">
            {EVENT_STATUSES.map((s) => (
              <button
                key={s}
                className="admin-btn"
                type="button"
                disabled={eventBusy || s === eventStatus}
                onClick={() => handleSetEventStatus(s)}
              >
                {s === 'NOT_STARTED' ? 'NOT STARTED' : s}
              </button>
            ))}
          </div>
          {eventBusy && <p className="admin-ok">Updating event status…</p>}
          {eventResult && !eventBusy && (
            <p className={eventResult.ok ? 'admin-ok' : 'admin-err'}>
              {eventResult.ok ? '✓ ' : '✗ '}
              {eventResult.message}
            </p>
          )}
        </section>

        {/* Stats */}
        <section className="admin-section">
          <h2 className="admin-section-title">Overview</h2>
          <div className="admin-stats-grid">
            {statCards.map((s) => (
              <div key={s.label} className="admin-stat-card">
                <span className="admin-stat-value">{s.value}</span>
                <span className="admin-stat-label">{s.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Registration verification */}
        <section className="admin-section">
          <h2 className="admin-section-title">Registration Verification</h2>
          <p className="admin-section-desc">
            Scan or paste the team's Registration QR token. The backend validates it.
          </p>
          <form className="admin-inline-form" onSubmit={handleVerifyRegistration}>
            <input
              className="admin-input"
              type="text"
              placeholder="cv-reg-T01-…"
              value={regToken}
              onChange={(e) => setRegToken(e.target.value)}
            />
            <button className="admin-btn" type="submit" disabled={regBusy || !regToken.trim()}>
              {regBusy ? 'Verifying…' : 'Verify Registration'}
            </button>
          </form>
          {regResult && (
            <p className={regResult.ok ? 'admin-ok' : 'admin-err'}>
              {regResult.ok ? '✓ ' : '✗ '}
              {regResult.message}
            </p>
          )}
        </section>

        {/* Teams */}
        <section className="admin-section">
          <h2 className="admin-section-title">Teams</h2>
          {!teams ? (
            <p className="available-soon">Loading teams…</p>
          ) : teams.length === 0 ? (
            <p className="available-soon">No teams yet.</p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Team ID</th>
                  <th>Name</th>
                  <th>Leader</th>
                  <th>Members</th>
                  <th>Registration</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((t) => (
                  <tr key={t.team_id}>
                    <td className="mono">{t.team_id}</td>
                    <td>{t.team_name}</td>
                    <td>
                      {t.leader_name ? (
                        <>
                          <div>{t.leader_name}</div>
                          <div className="mono admin-team-leader-email">{t.leader_email}</div>
                        </>
                      ) : (
                        <span className="available-soon">—</span>
                      )}
                    </td>
                    <td>{t.participant_count ?? 0}</td>
                    <td>
                      <span className={`status-chip ${t.registration_status === 'REGISTERED' ? 'ok' : 'pending'}`}>
                        {t.registration_status === 'SUBMITTED'
                          ? 'SUBMITTED — awaiting check-in'
                          : t.registration_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Participants */}
        <section className="admin-section">
          <h2 className="admin-section-title">Participants</h2>
          {!participants ? (
            <p className="available-soon">Loading participants…</p>
          ) : participants.length === 0 ? (
            <p className="available-soon">No participants yet.</p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Team</th>
                  <th>Leader</th>
                  <th>Team status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {participants.map((p) => (
                  <tr key={p.participant_id}>
                    <td className="mono">P{String(p.participant_id).padStart(3, '0')}</td>
                    <td>{p.name}</td>
                    <td className="mono">{p.email ?? '—'}</td>
                    <td className="mono">{p.team_id}</td>
                    <td>
                      {p.is_leader ? (
                        <span className="status-chip ok">LEADER</span>
                      ) : (
                        <span className="status-chip info">member</span>
                      )}
                    </td>
                    <td>
                      <span className={`status-chip ${p.registration_status === 'REGISTERED' ? 'ok' : 'pending'}`}>
                        {p.registration_status === 'SUBMITTED'
                          ? 'SUBMITTED — awaiting check-in'
                          : p.registration_status}
                      </span>
                    </td>
                    <td>
                      <button type="button" className="admin-btn" onClick={() => openManage(p)}>
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {manage && (
            <div className="admin-manage">
              <div className="admin-manage-head">
                <h3 className="admin-manage-title">
                  Participant P{String(manage.participant_id).padStart(3, '0')} — {manage.name}
                </h3>
                <button type="button" className="admin-btn" onClick={closeManage}>
                  Close
                </button>
              </div>

              <div className="admin-manage-meta">
                <span className="admin-manage-meta-item">
                  Team: <strong className="mono">{manage.team_id}</strong>
                </span>
                <span className="admin-manage-meta-item">
                  Leader:{' '}
                  {manage.is_leader ? (
                    <span className="status-chip ok">YES</span>
                  ) : (
                    <span className="status-chip info">no</span>
                  )}
                </span>
                <span className="admin-manage-meta-item">
                  Team status: {manage.registration_status}
                </span>
              </div>

              {manageMsg && (
                <p className={manageMsg.ok ? 'admin-ok' : 'admin-err'}>
                  {manageMsg.ok ? '✓ ' : '✗ '}
                  {manageMsg.message}
                </p>
              )}

              <div className="admin-manage-grid">
                <form className="admin-manage-card" onSubmit={handleSaveParticipant}>
                  <h4>Edit details</h4>
                  <label className="admin-manage-label" htmlFor={`pm-name-${manage.participant_id}`}>
                    Name
                  </label>
                  <input
                    id={`pm-name-${manage.participant_id}`}
                    className="admin-input admin-manage-input"
                    value={editForm?.name ?? ''}
                    onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  />
                  <label className="admin-manage-label" htmlFor={`pm-email-${manage.participant_id}`}>
                    Email
                  </label>
                  <input
                    id={`pm-email-${manage.participant_id}`}
                    className="admin-input admin-manage-input"
                    type="email"
                    value={editForm?.email ?? ''}
                    onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                  />
                  <label className="admin-manage-label" htmlFor={`pm-phone-${manage.participant_id}`}>
                    Phone (optional)
                  </label>
                  <input
                    id={`pm-phone-${manage.participant_id}`}
                    className="admin-input admin-manage-input"
                    value={editForm?.phone ?? ''}
                    onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                  <button className="admin-btn" type="submit" disabled={manageBusy}>
                    Save details
                  </button>
                </form>

                <div className="admin-manage-card">
                  <h4>Team leader</h4>
                  <p className="admin-manage-note">
                    Every team has exactly one leader. Changing it never moves teams,
                    accounts, Food QR or check-in state — and every member can still
                    present the team&apos;s Registration QR.
                  </p>
                  <button
                    type="button"
                    className="admin-btn"
                    disabled={manageBusy || manage.is_leader}
                    onClick={handleMakeLeader}
                  >
                    {manage.is_leader ? 'Current team leader' : 'Make team leader'}
                  </button>

                  <h4>Reset password</h4>
                  <p className="admin-manage-note">
                    Sets the login password for this participant&apos;s individual account
                    (hashed, same mechanism as registration/login).
                  </p>
                  <form className="admin-manage-reset" onSubmit={handleResetPassword}>
                    <input
                      className="admin-input admin-manage-input"
                      type="password"
                      autoComplete="new-password"
                      placeholder="New password (min 6)"
                      value={resetPw}
                      onChange={(e) => setResetPw(e.target.value)}
                    />
                    <button
                      className="admin-btn"
                      type="submit"
                      disabled={manageBusy || resetPw.length < 6}
                    >
                      Set new password
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Games + control panel links */}
        <section className="admin-section">
          <h2 className="admin-section-title">Game Control Center</h2>
          {!games ? (
            <p className="available-soon">Loading games…</p>
          ) : games.length === 0 ? (
            <p className="available-soon">No games scheduled.</p>
          ) : (
            <div className="admin-games-grid">
              {games.map((g) => (
                <div key={g.game_id} className="admin-game-card">
                  <div className="admin-game-top">
                    <h3>{g.name}</h3>
                    <span className={`status-chip ${GAME_STATUS_META[g.status] || 'locked'}`}>
                      {g.status}
                    </span>
                  </div>
                  {g.description && <p className="admin-game-desc">{g.description}</p>}
                  {g.route && <p className="mono admin-game-route">/{g.route}</p>}
                  <div className="admin-game-actions">
                    {g.status === 'LIVE' && GAME_CONTROL_ROUTES.includes(g.route) && (
                      <Link to={`/admin/games/${g.route}`} className="admin-btn admin-btn-link">
                        Open Control Panel →
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Notifications */}
        <section className="admin-section">
          <h2 className="admin-section-title">Notifications</h2>
          <form className="admin-notif-form" onSubmit={handleSendNotification}>
            <select
              className="admin-input"
              value={notifType}
              onChange={(e) => setNotifType(e.target.value)}
            >
              {NOTIF_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <input
              className="admin-input"
              type="text"
              placeholder="Title"
              value={notifTitle}
              onChange={(e) => setNotifTitle(e.target.value)}
            />
            <input
              className="admin-input"
              type="text"
              placeholder="Message"
              value={notifMessage}
              onChange={(e) => setNotifMessage(e.target.value)}
            />
            <button className="admin-btn" type="submit" disabled={notifStatus === 'sending'}>
              Send
            </button>
          </form>
          {notifStatus === 'sent' && <p className="admin-ok">✓ Notification sent.</p>}
          {notifStatus.startsWith('error') && <p className="admin-err">✗ {notifStatus.slice(6)}</p>}

          {!notifications ? (
            <p className="available-soon">Loading notifications…</p>
          ) : notifications.length === 0 ? (
            <p className="available-soon">No notifications yet.</p>
          ) : (
            <ul className="admin-list">
              {notifications.map((n) => (
                <li key={n.notification_id} className="admin-list-item">
                  <span className="mono admin-list-time">{fmtTime(n.created_at)}</span>
                  <span className={`status-chip ${n.type === 'EMERGENCY' ? 'danger' : n.type === 'IMPORTANT' ? 'warn' : 'info'}`}>
                    {n.type}
                  </span>
                  <span><strong>{n.title}</strong> — {n.message}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Inquiries */}
        <section className="admin-section">
          <h2 className="admin-section-title">Inquiries</h2>
          {!inquiries ? (
            <p className="available-soon">Loading inquiries…</p>
          ) : inquiries.length === 0 ? (
            <p className="available-soon">No inquiries yet.</p>
          ) : (
            <ul className="admin-list">
              {inquiries.map((q) => (
                <li key={q.inquiry_id} className="admin-list-item admin-inquiry">
                  <div className="admin-inquiry-top">
                    <span className={`status-chip ${q.status === 'OPEN' ? 'pending' : q.status === 'IN_PROGRESS' ? 'warn' : 'ok'}`}>
                      {q.status}
                    </span>
                    <span className="mono admin-inquiry-meta">
                      {q.participant_id ? `P${String(q.participant_id).padStart(3, '0')}` : '—'} · {q.team_id ?? '—'} · {fmtTime(q.created_at)}
                    </span>
                  </div>
                  <p className="admin-inquiry-text"><strong>{q.title}</strong> — {q.message}</p>
                  {q.response && (
                    <p className="admin-inquiry-response"><span>Staff:</span> {q.response}</p>
                  )}
                  {replying && replying.id === q.inquiry_id ? (
                    <form className="admin-inline-form" onSubmit={handleReply}>
                      <select
                        className="admin-input"
                        value={replying.status}
                        onChange={(e) => setReplying({ ...replying, status: e.target.value })}
                      >
                        <option value="OPEN">OPEN</option>
                        <option value="IN_PROGRESS">IN PROGRESS</option>
                        <option value="RESOLVED">RESOLVED</option>
                      </select>
                      <input
                        className="admin-input"
                        type="text"
                        placeholder="Response"
                        value={replying.response ?? ''}
                        onChange={(e) => setReplying({ ...replying, response: e.target.value })}
                      />
                      <button className="admin-btn" type="submit">Save</button>
                      <button className="admin-btn admin-btn-ghost" type="button" onClick={() => setReplying(null)}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <button
                      className="admin-btn admin-btn-ghost"
                      onClick={() => setReplying({ id: q.inquiry_id, status: q.status, response: q.response ?? '' })}
                    >
                      Respond
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
