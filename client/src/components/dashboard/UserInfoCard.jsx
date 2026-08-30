import React from 'react';
import { UserCircle } from 'lucide-react';

export default function UserInfoCard() {
  // Mock data for the current user/team
  const user = {
    participantId: 'P001',
    name: 'Alex Developer',
    role: 'Participant',
    teamId: 'T01',
    teamName: 'Null Pointers',
    status: 'Registered'
  };

  return (
    <section className="dashboard-section">
      <div className="section-header">
        <UserCircle className="section-icon" size={24} />
        <h2 className="section-title">Participant Identification</h2>
      </div>

      <div className="user-id-record">
        <div className="user-info-row">
          <span className="user-info-label">Name</span>
          <span className="user-info-value">{user.name}</span>
        </div>

        <div className="user-info-row">
          <span className="user-info-label">Participant ID</span>
          <span className="user-info-value id-value">{user.participantId}</span>
        </div>

        <div className="user-info-row">
          <span className="user-info-label">Team ID</span>
          <span className="user-info-value id-value">{user.teamId}</span>
        </div>

        <div className="user-info-row">
          <span className="user-info-label">Team</span>
          <span className="user-info-value">{user.teamName}</span>
        </div>

        <div className="user-info-row">
          <span className="user-info-label">Status</span>
          <span className="status-registered">{user.status}</span>
        </div>
      </div>
    </section>
  );
}