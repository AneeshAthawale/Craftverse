import { BellRing } from 'lucide-react';

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function NotificationPanel({ notifications, socketConnected }) {
  const items = notifications ?? [];

  return (
    <section className="dashboard-section">
      <div className="section-header">
        <BellRing className="section-icon" size={24} />
        <h2 className="section-title">System Announcements</h2>
      </div>

      {items.length === 0 ? (
        <p className="available-soon">No new notifications.</p>
      ) : (
        <div className="notifications-list">
          {items.map((notif) => {
            const important = notif.type === 'IMPORTANT' || notif.type === 'EMERGENCY';
            return (
              <div key={notif.notification_id ?? notif.id} className={`notification-item ${important ? 'important' : ''}`}>
                <div className="notification-top">
                  <span className="notification-time">{formatTime(notif.created_at) || notif.time}</span>
                  <span className={`notification-tag ${important ? '' : 'info'}`}>
                    {important ? notif.type : 'NOTICE'}
                  </span>
                </div>
                <p className="notification-text">
                  {notif.title ? <strong>{notif.title}.</strong> : ''} {notif.message}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {socketConnected === false && (
        <p className="socket-note">Realtime updates offline — reconnecting…</p>
      )}
    </section>
  );
}
