import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import './Register.css';

const EMPTY_MEMBER = { name: '', email: '' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Register() {
  const navigate = useNavigate();

  const [teamName, setTeamName] = useState('');
  const [leaderName, setLeaderName] = useState('');
  const [leaderEmail, setLeaderEmail] = useState('');
  const [members, setMembers] = useState([{ ...EMPTY_MEMBER }, { ...EMPTY_MEMBER }, { ...EMPTY_MEMBER }]);
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null); // { team_id, team_name }

  const setMember = (index, key, value) => {
    setMembers((prev) => prev.map((m, i) => (i === index ? { ...m, [key]: value } : m)));
  };

  const validate = () => {
    const errors = {};
    const emails = new Set();
    const seen = (email, field) => {
      const clean = email.trim().toLowerCase();
      if (emails.has(clean)) {
        errors[field] = 'This email is already used by another member on the form';
        return false;
      }
      emails.add(clean);
      return true;
    };

    if (teamName.trim().length < 2) errors.teamName = 'Team name must be at least 2 characters';
    if (!leaderName.trim()) errors.leaderName = 'Team leader name is required';
    if (!EMAIL_RE.test(leaderEmail.trim())) {
      errors.leaderEmail = 'A valid team leader email is required';
    } else {
      seen(leaderEmail, 'leaderEmail');
    }
    if (password.length < 6) errors.password = 'Password must be at least 6 characters';

    members.forEach((m, i) => {
      const nameFilled = !!m.name.trim();
      const emailFilled = !!m.email.trim();
      if (!nameFilled && !emailFilled) return; // blank member slot is fine
      if (!nameFilled) {
        errors[`member${i}Name`] = 'Enter a name for this member';
      }
      if (!emailFilled || !EMAIL_RE.test(m.email.trim())) {
        errors[`member${i}Email`] = 'A valid email is required for this member';
      } else {
        seen(m.email, `member${i}Email`);
      }
    });

    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    const errors = validate();
    setFieldErrors(errors);
    setFormError('');
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const res = await api.post('/registration', {
        teamName: teamName.trim(),
        leader: { name: leaderName.trim(), email: leaderEmail.trim() },
        members: members
          .filter((m) => m.name.trim() || m.email.trim())
          .map((m) => ({ name: m.name.trim(), email: m.email.trim() })),
        password,
      });
      setSubmitted({ team_id: res.team.team_id, team_name: res.team.team_name });
    } catch (err) {
      if (err.code === 'DUPLICATE_TEAM_NAME') {
        setFieldErrors({ teamName: err.message });
      } else {
        setFormError(err.message || 'Registration failed. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // --- Success screen (function first, no decoration) ---
  if (submitted) {
    return (
      <div className="register-page">
        <div className="register-card">
          <h1 className="register-title">Team registered</h1>
          <p className="register-subtitle">
            Team <strong>{submitted.team_name}</strong> ({submitted.team_id}) has been submitted
            and is waiting for event-day check-in.
          </p>
          <div className="register-success-notes">
            <p>
              Team members sign in with their own email and the shared team password. Any member
              can view the team&apos;s Registration QR on the dashboard.
            </p>
          </div>
          <button type="button" className="register-btn" onClick={() => navigate('/login')}>
            Go to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="register-page">
      <form className="register-card" onSubmit={handleSubmit} noValidate>
        <h1 className="register-title">
          CraftVerse
          <span className="register-subtitle">TEAM REGISTRATION</span>
        </h1>

        <h2 className="register-section-title">Team details</h2>
        <label className="register-label" htmlFor="reg-team-name">Team name</label>
        <input
          id="reg-team-name"
          className="register-input"
          value={teamName}
          onChange={(e) => setTeamName(e.target.value)}
          placeholder="e.g. Null Pointers"
        />
        {fieldErrors.teamName && <p className="register-error">{fieldErrors.teamName}</p>}

        <h2 className="register-section-title">Team leader</h2>
        <p className="register-hint">
          The team leader is a team member whose email is the team&apos;s main contact.
        </p>
        <label className="register-label" htmlFor="reg-leader-name">Team leader name</label>
        <input
          id="reg-leader-name"
          className="register-input"
          value={leaderName}
          onChange={(e) => setLeaderName(e.target.value)}
          placeholder="Full name"
        />
        {fieldErrors.leaderName && <p className="register-error">{fieldErrors.leaderName}</p>}
        <label className="register-label" htmlFor="reg-leader-email">Team leader email</label>
        <input
          id="reg-leader-email"
          className="register-input"
          type="email"
          value={leaderEmail}
          onChange={(e) => setLeaderEmail(e.target.value)}
          placeholder="leader@example.com"
        />
        {fieldErrors.leaderEmail && <p className="register-error">{fieldErrors.leaderEmail}</p>}

        <h2 className="register-section-title">Team members (optional)</h2>
        <p className="register-hint">Up to 3 additional members. Leave a row blank to skip it.</p>
        {members.map((member, i) => (
          <div className="register-member-row" key={i}>
            <div className="register-member-fields">
              <div>
                <label className="register-label" htmlFor={`reg-member-${i}-name`}>
                  Member {i + 1} name
                </label>
                <input
                  id={`reg-member-${i}-name`}
                  className="register-input"
                  value={member.name}
                  onChange={(e) => setMember(i, 'name', e.target.value)}
                  placeholder="Full name"
                />
                {fieldErrors[`member${i}Name`] && (
                  <p className="register-error">{fieldErrors[`member${i}Name`]}</p>
                )}
              </div>
              <div>
                <label className="register-label" htmlFor={`reg-member-${i}-email`}>
                  Member {i + 1} email
                </label>
                <input
                  id={`reg-member-${i}-email`}
                  className="register-input"
                  type="email"
                  value={member.email}
                  onChange={(e) => setMember(i, 'email', e.target.value)}
                  placeholder="member@example.com"
                />
                {fieldErrors[`member${i}Email`] && (
                  <p className="register-error">{fieldErrors[`member${i}Email`]}</p>
                )}
              </div>
            </div>
          </div>
        ))}

        <h2 className="register-section-title">Team password</h2>
        <p className="register-hint">
          One shared password for every member of this team. They sign in with their own email
          and this password.
        </p>
        <label className="register-label" htmlFor="reg-password">Team password</label>
        <input
          id="reg-password"
          className="register-input"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 6 characters"
        />
        {fieldErrors.password && <p className="register-error">{fieldErrors.password}</p>}

        {formError && <p className="register-error register-form-error">{formError}</p>}

        <button className="register-btn" type="submit" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Register team'}
        </button>
        <p className="register-alt">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
