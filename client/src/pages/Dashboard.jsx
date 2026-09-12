import { useEffect, useState, useCallback } from 'react';
import QRCode from 'react-qr-code';
import Header from '../components/dashboard/Header';
import EventStatus from '../components/dashboard/EventStatus';
import OngoingEvent from '../components/dashboard/OngoingEvent';
import EventTimeline from '../components/dashboard/EventTimeline';
import NotificationPanel from '../components/dashboard/NotificationPanel';
import QuickAccess from '../components/dashboard/QuickAccess';
import UserInfoCard from '../components/dashboard/UserInfoCard';
import Games from '../components/dashboard/Games';
import FoodQR from '../components/dashboard/FoodQR';
import Inquiry from '../components/dashboard/Inquiry';
import api from '../services/api.js';
import { onEvent, onReconnect, onSocketStatus } from '../services/socket.js';
import { useAuth } from '../context/useAuth.js';
import './Dashboard.css';

export default function Dashboard() {
  const { user, logout } = useAuth();

  const [profile, setProfile] = useState(null);       // { user, team, participants, registration }
  const [eventStatus, setEventStatus] = useState(null); // NOT_STARTED | LIVE | BREAK | ENDED
  const [games, setGames] = useState(null);
  const [food, setFood] = useState(null);             // { meal, access }
  const [notifications, setNotifications] = useState([]);
  const [inquiries, setInquiries] = useState([]);
  const [socketConnected, setSocketConnected] = useState(false);
  const [error, setError] = useState('');
  // Bumped when the team is verified (registration:completed) so all data —
  // including the team status that gates the dashboard — reloads.
  const [reloadKey, setReloadKey] = useState(0);
  // The team's single Registration QR, shown to every member while not checked
  // in (also the QR's delivery channel until email exists).
  const [registrationQr, setRegistrationQr] = useState(null);

  const teamId = user?.team_id ?? null;
  const isParticipant = user?.role === 'PARTICIPANT';
  const regStatus = profile?.team?.registration_status ?? null;
  // Event-day sections stay locked until the backend says the team is checked
  // in. Backend authorization (403s on food/RLGL) enforces this for real.
  const teamLocked = isParticipant && !!teamId && !!regStatus && regStatus !== 'REGISTERED';

  const loadFood = useCallback(async () => {
    try {
      const data = await api.get('/food/me');
      setFood(data);
    } catch (err) {
      // 403 (no participant link) or network — leave food as null, show nothing.
      if (err.status !== 403) setError(err.message || 'Could not load food QR');
    }
  }, []);

  // Authoritative event status (re-fetched on load AND on socket reconnect).
  const loadEventStatus = useCallback(async () => {
    try {
      const data = await api.get('/event/status');
      setEventStatus(data.event.status);
    } catch (err) {
      // Non-fatal — the dashboard still works without the event state.
      if (err.status !== 401 && err.status !== 403) {
        setError(err.message || 'Could not load event status');
      }
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    queueMicrotask(loadEventStatus);
  }, [user, loadEventStatus]);

  // Load all dashboard data once the authenticated user is known.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const loadAll = async () => {
      try {
        setRegistrationQr(null);
        // /auth/me is the one load that must succeed for the page to render.
        const me = await api.get('/auth/me');
        if (cancelled) return;
        const authUser = me.user;
        setProfile({ user: authUser, team: null, participants: [], registration: null });

        // Team + registration status (participants need their team name/status).
        if (authUser.team_id) {
          try {
            const teamRes = await api.get(`/teams/${authUser.team_id}`);
            if (!cancelled) {
              setProfile({
                user: authUser,
                team: teamRes.team ?? null,
                participants: teamRes.participants ?? [],
                registration: teamRes.team ?? null,
              });
            }
          } catch (err) {
            // Team may be missing in odd cases; continue with what we have.
            if (!cancelled && err.status !== 403) {
              setError(err.message || 'Could not load team information');
            }
          }
        }

        // The remaining sections are fetched independently so one failure
        // (e.g. a role-gated 403 on /inquiries/mine for ADMIN/DEV) does not
        // blank the whole dashboard.
        const [gamesRes, notifRes, inqRes, foodRes] = await Promise.all([
          api.get('/games').catch((err) => {
            if (!cancelled && err.status !== 403) setError(err.message || 'Could not load games');
            return { games: null };
          }),
          api.get('/notifications').catch((err) => {
            if (!cancelled && err.status !== 403) setError(err.message || 'Could not load notifications');
            return { notifications: [] };
          }),
          api.get('/inquiries/mine').catch(() => ({ inquiries: [] })),
          api.get('/food/me').catch((err) => {
            // 403 = no participant link (ADMIN/DEV view) — not an error.
            if (err.status !== 403 && !cancelled) setError(err.message || 'Could not load food QR');
            return { meal: null, access: null };
          }),
        ]);
        if (cancelled) return;

        if (gamesRes.games) setGames(gamesRes.games);
        if (notifRes.notifications) setNotifications(notifRes.notifications);
        if (inqRes.inquiries) setInquiries(inqRes.inquiries);
        setFood(foodRes);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load dashboard data');
      }
    };

    loadAll();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Socket: connection status + real-time events.
  useEffect(() => {
    const offStatus = onSocketStatus(setSocketConnected);
    const offReconnect = onReconnect(() => {
      // Full resync after a disconnect window: notifications/inquiries/games
      // may have changed while we were offline. Each fetch is isolated so a
      // role-gated 403 (ADMIN/DEV on participant endpoints) cannot blank the
      // sections that did load.
      if (!user) return;
      loadEventStatus();
      loadFood();
      api.get('/games').then((r) => setGames(r.games)).catch(() => {});
      api.get('/notifications').then((r) => setNotifications(r.notifications)).catch(() => {});
      api.get('/inquiries/mine').then((r) => setInquiries(r.inquiries)).catch(() => {});
    });

    const offEventStatus = onEvent('event:status', ({ status }) => {
      setEventStatus(status);
    });

    const offNotif = onEvent('notification:new', ({ notification }) => {
      setNotifications((prev) => [notification, ...prev]);
    });

    const offInquiry = onEvent('inquiry:updated', ({ inquiry }) => {
      setInquiries((prev) =>
        prev.map((i) => (i.inquiry_id === inquiry.inquiry_id ? inquiry : i))
      );
    });

    const offFood = onEvent('food:access:updated', (payload) => {
      if (payload?.participantId && user?.participant_id === payload.participantId) {
        loadFood();
      }
    });

    // Team checked in on event day (admin verified the Registration QR):
    // reload everything so the locked dashboard unlocks live.
    const offReg = onEvent('registration:completed', (payload) => {
      if (payload?.team?.team_id && payload.team.team_id === user?.team_id) {
        setReloadKey((k) => k + 1);
      }
    });

    return () => {
      offStatus();
      offReconnect();
      offEventStatus();
      offNotif();
      offInquiry();
      offFood();
      offReg();
    };
  }, [user, loadFood, loadEventStatus]);

  // Team just verified (registration:completed): refresh the backend-derived
  // team status (unlocks the dashboard) and the food token in one pass.
  useEffect(() => {
    if (!user || reloadKey === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await api.get('/auth/me');
        if (cancelled) return;
        if (me.user.team_id) {
          const teamRes = await api.get(`/teams/${me.user.team_id}`);
          if (cancelled) return;
          setProfile({
            user: me.user,
            team: teamRes.team ?? null,
            participants: teamRes.participants ?? [],
            registration: teamRes.team ?? null,
          });
        }
        loadFood();
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not refresh team status');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, user, loadFood]);

  // Fetch the team's single Registration QR while the team is not yet checked
  // in — every member of the team may present it (team-level credential).
  useEffect(() => {
    if (!teamLocked || !teamId) return;
    let cancelled = false;
    api
      .get(`/teams/${teamId}/qr`)
      .then((data) => {
        if (!cancelled && data.token) {
          setRegistrationQr({ token: data.token, team_name: data.team_name });
        }
      })
      .catch(() => {
        // Non-fatal: the locked panel still explains what to do.
        if (!cancelled) setRegistrationQr(null);
      });
    return () => {
      cancelled = true;
    };
  }, [teamLocked, teamId]);

  // Show a loading state while the auth session or first data load is pending.
  // Participants must know their team's registration status before the
  // dashboard decides between the locked gate and the event sections — waiting
  // here avoids flashing unlocked content before that backend check arrives.
  const awaitingTeamStatus = isParticipant && !!teamId && !!profile && profile.team === null && !error;
  if ((!profile && !error) || awaitingTeamStatus) {
    return (
      <div className="dashboard-container">
        <Header user={user} socketConnected={socketConnected} onLogout={logout} />
        <main className="dashboard-main">
          <p className="dash-loading">Loading dashboard…</p>
        </main>
      </div>
    );
  }

  // The team is not yet checked in: event sections (food, games, ongoing
  // event) stay locked. Every member sees the team's single Registration QR.
  if (teamLocked) {
    const pending = regStatus === 'SUBMITTED';
    return (
      <div className="dashboard-container">
        <Header user={user} socketConnected={socketConnected} onLogout={logout} />
        <main className="dashboard-main">
          {error && <p className="dash-error">⚠ {error}</p>}
          <div className="registration-gate">
            <h2 className="registration-gate-title">
              {pending ? 'Registration submitted' : 'Team not checked in'}
            </h2>
            <p className="registration-gate-text">
              {teamId ? (
                <>
                  <strong>{profile?.team?.team_name ?? teamId}</strong> ({teamId}) is{' '}
                  {pending
                    ? 'registered and waiting for event-day check-in.'
                    : 'not verified yet.'}
                </>
              ) : (
                'Your account is not linked to a team.'
              )}{' '}
              Event features unlock once the team is checked in at the venue.
            </p>

            <div className="registration-gate-qr">
              {registrationQr?.token ? (
                <>
                  <div className="registration-gate-qr-code">
                    <QRCode value={registrationQr.token} size={176} />
                  </div>
                  <p className="registration-gate-text">
                    Any team member can present this Registration QR at the
                    check-in desk. One scan checks the whole team in.
                  </p>
                </>
              ) : (
                <p className="registration-gate-text">Loading your Registration QR…</p>
              )}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <Header user={user} socketConnected={socketConnected} onLogout={logout} />

      <main className="dashboard-main">
        {error && <p className="dash-error">⚠ {error}</p>}

        <div className="dashboard-grid">
          {/* Left Column - Primary Information */}
          <div className="dashboard-primary">
            <EventStatus eventStatus={eventStatus} socketConnected={socketConnected} />
            <div id="ongoing-event">
              <OngoingEvent eventStatus={eventStatus} games={games} />
            </div>
            <EventTimeline />
            <Games games={games} />
            <div id="food-qr">
              <FoodQR access={food?.access ?? null} meal={food?.meal ?? null} />
            </div>
            <div id="inquiry">
              <Inquiry
                initial={inquiries}
                onSubmitted={(inq) => setInquiries((prev) => [inq, ...prev])}
              />
            </div>
          </div>

          {/* Right Column - User & Updates */}
          <div className="dashboard-secondary">
            <div id="participant-info">
              <UserInfoCard profile={profile} />
            </div>
            <QuickAccess />
            <NotificationPanel
              notifications={notifications}
              socketConnected={socketConnected}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
