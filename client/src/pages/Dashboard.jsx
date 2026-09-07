import { useEffect, useState, useCallback } from 'react';
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

    return () => {
      offStatus();
      offReconnect();
      offEventStatus();
      offNotif();
      offInquiry();
      offFood();
    };
  }, [user, loadFood, loadEventStatus]);

  // Show a loading state while the auth session or first data load is pending.
  if (!profile && !error) {
    return (
      <div className="dashboard-container">
        <Header user={user} socketConnected={socketConnected} onLogout={logout} />
        <main className="dashboard-main">
          <p className="dash-loading">Loading dashboard…</p>
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
