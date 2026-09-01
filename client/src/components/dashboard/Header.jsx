import { User, Bell, LogOut, Wifi, WifiOff } from 'lucide-react';

export default function Header({ user, socketConnected, onLogout }) {
  const role = user?.role ?? 'Participant';
  const name = user?.email ? user.email.split('@')[0] : role;

  return (
    <header className="header-container">
      <div className="header-bar">
        <h1 className="header-logo">
          CraftVerse
          <span className="header-logo-ghost">COMPETITION TERMINAL</span>
        </h1>

        <div className="header-nav">
          {socketConnected ? (
            <span className="socket-indicator" title="Realtime connected">
              <Wifi size={14} /> LIVE
            </span>
          ) : (
            <span className="socket-indicator off" title="Realtime disconnected">
              <WifiOff size={14} /> OFFLINE
            </span>
          )}
          <div className="header-profile" title={user?.email ?? ''}>
            <User size={17} />
            <span>{name}</span>
            <span className="header-role">{role}</span>
          </div>
          <button className="header-icon-btn" aria-label="Notifications">
            <Bell size={18} />
          </button>
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
