import { UserCircle } from 'lucide-react';

export default function UserInfoCard({ profile }) {
  const authUser = profile?.user ?? {};
  const team = profile?.team ?? {};

  const participantId = authUser.participant_id
    ? `P${String(authUser.participant_id).padStart(3, '0')}`
    : '—';

  // Team member name: from participants list if available, else the email prefix.
  const participants = profile?.participants ?? [];
  const member =
    participants.find((p) => p.participant_id === authUser.participant_id) ?? null;
  const name = member?.name ?? (authUser.email ? authUser.email.split('@')[0] : '—');

  const status =
    team.registration_status === 'REGISTERED'
      ? 'Registered'
      : team.registration_status === 'UNREGISTERED'
        ? 'Pending Registration'
        : 'Registered';

  return (
    <section className="dashboard-section">
      <div className="section-header">
        <UserCircle className="section-icon" size={24} />
        <h2 className="section-title">Participant Identification</h2>
      </div>

      <div className="user-id-record">
        <div className="user-info-row">
          <span className="user-info-label">Name</span>
          <span className="user-info-value">{name}</span>
        </div>

        <div className="user-info-row">
          <span className="user-info-label">Participant ID</span>
          <span className="user-info-value id-value">{participantId}</span>
        </div>

        <div className="user-info-row">
          <span className="user-info-label">Team ID</span>
          <span className="user-info-value id-value">{team.team_id ?? authUser.team_id ?? '—'}</span>
        </div>

        <div className="user-info-row">
          <span className="user-info-label">Team</span>
          <span className="user-info-value">{team.team_name ?? '—'}</span>
        </div>

        <div className="user-info-row">
          <span className="user-info-label">Status</span>
          <span className={`status-registered ${team.registration_status === 'UNREGISTERED' ? 'status-pending' : ''}`}>
            {status}
          </span>
        </div>
      </div>
    </section>
  );
}
