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
import { onEvent, onSocketStatus } from '../services/socket.js';
import { useAuth } from '../context/useAuth.js';
import './Dashboard.css';

export default function Dashboard() {
  const { user, logout } = useAuth();

  const [profile, setProfile] = useState(null);       // { user, team, participants, registration }
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

  // Load all dashboard data once the authenticated user is known.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      try {
        const [me, gamesRes, notifRes, inqRes] = await Promise.all([
          api.get('/auth/me'),
          api.get('/games'),
          api.get('/notifications'),
          api.get('/inquiries/mine'),
        ]);

        if (cancelled) return;

        const authUser = me.user;

        // Team + registration status (participants need their team name/status).
        let teamData = null;
        if (authUser.team_id) {
          try {
            const teamRes = await api.get(`/teams/${authUser.team_id}`);
            teamData = teamRes;
          } catch {
            // Team may be missing in odd cases; continue with what we have.
          }
        }

        setProfile({
          user: authUser,
          team: teamData?.team ?? null,
          participants: teamData?.participants ?? [],
          registration: teamData?.team ?? null,
        });
        setGames(gamesRes.games);
        setNotifications(notifRes.notifications);
        setInquiries(inqRes.inquiries);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load dashboard data');
      }
    })();

    queueMicrotask(loadFood);
    return () => {
      cancelled = true;
    };
  }, [user, loadFood]);

  // Socket: connection status + real-time events.
  useEffect(() => {
    const offStatus = onSocketStatus(setSocketConnected);

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
      offNotif();
      offInquiry();
      offFood();
    };
  }, [user, loadFood]);

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
            <EventStatus status={profile?.registration ? 'registered' : 'ongoing'} />
            <div id="ongoing-event">
              <OngoingEvent games={games} />
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
