import React from 'react';
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
import './Dashboard.css';

export default function Dashboard() {
  return (
    <div className="dashboard-container">
      <Header />
      
      <main className="dashboard-main">
        <div className="dashboard-grid">
          {/* Left Column - Primary Information */}
          <div className="dashboard-primary">
            <EventStatus status="ongoing" />
            <div id="ongoing-event">
              <OngoingEvent />
            </div>
            <EventTimeline />
            <Games />
            <div id="food-qr">
              <FoodQR />
            </div>
            <div id="inquiry">
              <Inquiry />
            </div>
          </div>

          {/* Right Column - User & Updates */}
          <div className="dashboard-secondary">
            <div id="participant-info">
              <UserInfoCard />
            </div>
            <QuickAccess />
            <NotificationPanel />
          </div>
        </div>
      </main>
    </div>
  );
}