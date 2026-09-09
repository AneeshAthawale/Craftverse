import { Calendar } from 'lucide-react';

const META = {
  completed: 'COMPLETED',
  active: 'CURRENT',
  upcoming: 'UPCOMING',
};

export default function EventTimeline() {
  // Mock data for the timeline
  const schedule = [
    { id: 1, time: '09:00 AM', title: 'Registration & Breakfast', status: 'completed' },
    { id: 2, time: '10:00 AM', title: 'Opening Ceremony', status: 'completed' },
    { id: 3, time: '11:00 AM', title: 'Red Light Green Light', status: 'active' },
    { id: 4, time: '01:00 PM', title: 'Lunch Break', status: 'upcoming' },
    { id: 5, time: '02:00 PM', title: 'Hackathon Session 1', status: 'upcoming' },
    { id: 6, time: '06:00 PM', title: 'Dinner & Networking', status: 'upcoming' }
  ];

  return (
    <section className="dashboard-section">
      <div className="section-header">
        <Calendar className="section-icon" size={24} />
        <h2 className="section-title">Event Schedule</h2>
      </div>

      <div className="event-progression-title">EVENT PROGRESSION</div>

      <div className="timeline">
        {schedule.map((item) => (
          <div key={item.id} className={`timeline-item ${item.status}`}>
            <div className="timeline-marker"></div>
            <div className="timeline-content">
              <div className="timeline-top">
                <div className="timeline-time">{item.time}</div>
                <div className={`timeline-meta ${item.status === 'active' ? 'current' : item.status}`}>
                  {META[item.status]}
                </div>
              </div>
              <h4 className="timeline-title">{item.title}</h4>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}