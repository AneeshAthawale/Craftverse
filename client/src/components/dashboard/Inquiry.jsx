import { useState } from 'react';
import { HelpCircle, Send } from 'lucide-react';
import api from '../../services/api.js';

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function Inquiry({ initial, onSubmitted }) {
  const [inquiries, setInquiries] = useState(initial ?? []);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState(''); // '', 'submitting', 'sent', 'error'
  const [error, setError] = useState('');

  // Keep in sync if the parent refreshes the list.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setInquiries(initial ?? []);
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedMessage = message.trim();
    if (!trimmedTitle || !trimmedMessage || status === 'submitting') return;

    setStatus('submitting');
    setError('');
    try {
      const { inquiry } = await api.post('/inquiries', {
        title: trimmedTitle,
        message: trimmedMessage,
      });
      setInquiries((prev) => [inquiry, ...prev]);
      onSubmitted?.(inquiry);
      setTitle('');
      setMessage('');
      setStatus('sent');
      setTimeout(() => setStatus(''), 2500);
    } catch (err) {
      setStatus('error');
      setError(err.message || 'Could not submit inquiry');
    }
  };

  return (
    <section className="dashboard-section">
      <div className="section-header">
        <HelpCircle className="section-icon" size={24} />
        <h2 className="section-title">Request Assistance</h2>
      </div>

      <form className="inquiry-form" onSubmit={handleSubmit}>
        <label className="inquiry-field-label" htmlFor="inquiry-subject">Subject</label>
        <input
          id="inquiry-subject"
          className="inquiry-input"
          type="text"
          placeholder="Subject"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <label className="inquiry-field-label" htmlFor="inquiry-message">Message</label>
        <textarea
          id="inquiry-message"
          className="inquiry-textarea"
          placeholder="Describe your question or issue..."
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button className="inquiry-send-btn" type="submit" disabled={status === 'submitting'}>
          Transmit Inquiry <Send size={15} />
        </button>
      </form>

      {status === 'sent' && (
        <p className="inquiry-sent-note">Inquiry submitted. Staff will respond shortly.</p>
      )}
      {status === 'error' && <p className="dash-error">⚠ {error}</p>}

      {inquiries.length > 0 && (
        <div className="inquiries-list">
          {inquiries.map((item) => (
            <div key={item.inquiry_id ?? item.id} className={`inquiry-item inquiry-${(item.status || 'OPEN').toLowerCase()}`}>
              <div className="inquiry-item-header">
                <h4 className="inquiry-item-title">{item.title}</h4>
                <span className={`inquiry-status ${(item.status || 'OPEN').toLowerCase()}`}>
                  {item.status === 'IN_PROGRESS' ? 'IN PROGRESS' : item.status || 'OPEN'}
                </span>
              </div>
              <p className="inquiry-item-message">{item.message}</p>
              {item.response && (
                <div className="inquiry-item-response">
                  <span className="inquiry-response-label">Staff:</span> {item.response}
                </div>
              )}
              {item.created_at && (
                <div className="inquiry-item-time">{formatTime(item.created_at)}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
