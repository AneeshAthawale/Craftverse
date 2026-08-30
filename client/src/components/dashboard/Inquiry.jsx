import React, { useState } from 'react';
import { HelpCircle, Send } from 'lucide-react';

const INITIAL_INQUIRIES = [
  {
    id: 1,
    title: 'Lunch QR missing',
    message: 'I have not received my lunch QR.',
    status: 'IN_PROGRESS',
    response: 'Regenerating your QR now. Please refresh in a few minutes.',
    createdAt: '10:12 AM',
  },
];

export default function Inquiry({ initial }) {
  const [inquiries, setInquiries] = useState(initial ?? INITIAL_INQUIRIES);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [justSent, setJustSent] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedMessage = message.trim();
    if (!trimmedTitle || !trimmedMessage) return;

    setInquiries((prev) => [
      {
        id: Date.now(),
        title: trimmedTitle,
        message: trimmedMessage,
        status: 'OPEN',
        createdAt: 'Just now',
      },
      ...prev,
    ]);
    setTitle('');
    setMessage('');
    setJustSent(true);
    setTimeout(() => setJustSent(false), 2500);
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
        <button className="inquiry-send-btn" type="submit">
          Transmit Inquiry <Send size={15} />
        </button>
      </form>

      {justSent && (
        <p className="inquiry-sent-note">Inquiry submitted. Staff will respond shortly.</p>
      )}

      {inquiries.filter((i) => i.status !== 'OPEN' || true).length > 0 && (
        <div className="inquiries-list">
          {inquiries.map((item) => (
            <div key={item.id} className={`inquiry-item inquiry-${item.status.toLowerCase()}`}>
              <div className="inquiry-item-header">
                <h4 className="inquiry-item-title">{item.title}</h4>
                <span className={`inquiry-status ${item.status.toLowerCase()}`}>
                  {item.status === 'IN_PROGRESS' ? 'IN PROGRESS' : item.status}
                </span>
              </div>
              <p className="inquiry-item-message">{item.message}</p>
              {item.response && (
                <div className="inquiry-item-response">
                  <span className="inquiry-response-label">Staff:</span> {item.response}
                </div>
              )}
              {item.createdAt && (
                <div className="inquiry-item-time">{item.createdAt}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}