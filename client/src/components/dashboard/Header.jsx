import React from 'react';
import { User, Bell, Menu } from 'lucide-react';

export default function Header() {
  return (
    <header className="header-container">
      <div className="header-bar">
        <h1 className="header-logo">
          CraftVerse
          <span className="header-logo-ghost">COMPETITION TERMINAL</span>
        </h1>

        <div className="header-nav">
          <div className="header-profile">
            <User size={17} />
            <span>Participant</span>
          </div>
          <button className="header-icon-btn" aria-label="Notifications">
            <Bell size={18} />
          </button>
          <button className="header-icon-btn menu-btn" aria-label="Menu" style={{ display: 'none' /* Will show on mobile later */ }}>
            <Menu size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}