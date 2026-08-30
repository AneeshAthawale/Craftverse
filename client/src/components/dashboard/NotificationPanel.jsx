import React from 'react';
import { BellRing } from 'lucide-react';

export default function NotificationPanel() {
  const notifications = [
    { id: 1, time: '10:45 AM', message: 'Red Light Green Light game is starting in 15 minutes. Please take your seats.', important: true },
    { id: 2, time: '09:30 AM', message: 'Welcome to CraftVerse! Make sure your team is fully registered.' }
  ];

  return (
    <section className="dashboard-section">
      <div className="section-header">
        <BellRing className="section-icon" size={24} />
        <h2 className="section-title">System Announcements</h2>
      </div>

      <div className="notifications-list">
        {notifications.length === 0 ? (
          <p className="available-soon">No new notifications.</p>
        ) : (
          notifications.map(notif => (
            <div key={notif.id} className={`notification-item ${notif.important ? 'important' : ''}`}>
              <div className="notification-top">
                <span className="notification-time">{notif.time}</span>
                <span className={`notification-tag ${notif.important ? '' : 'info'}`}>
                  {notif.important ? 'IMPORTANT' : 'NOTICE'}
                </span>
              </div>
              <p className="notification-text">{notif.message}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}