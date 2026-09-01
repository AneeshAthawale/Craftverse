import { Gamepad2, Lock, Clock, CircleCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Play } from 'lucide-react';

const STATUS_META = {
  LIVE: { className: 'live', icon: Play },
  UPCOMING: { className: 'upcoming', icon: Clock },
  COMPLETED: { className: 'completed', icon: CircleCheck },
  LOCKED: { className: 'locked', icon: Lock },
  PAUSED: { className: 'upcoming', icon: Clock },
};

export default function Games({ games }) {
  const items = games ?? [];

  return (
    <section className="dashboard-section">
      <div className="section-header">
        <Gamepad2 className="section-icon" size={24} />
        <h2 className="section-title">Games</h2>
      </div>

      {items.length === 0 ? (
        <p className="available-soon">No games scheduled yet.</p>
      ) : (
        <div className="games-list">
          {items.map((game, index) => {
            const meta = STATUS_META[game.status] || STATUS_META.LOCKED;
            const StatusIcon = meta.icon;
            const round = String(index + 1).padStart(2, '0');
            const route = game.route ? `/games/${game.route}` : null;
            return (
              <div key={game.game_id ?? game.id} className={`game-item ${game.status === 'LIVE' ? 'live-card' : ''}`}>
                <div className="game-round">ROUND {round}</div>
                <div className="game-item-header">
                  <h3 className="game-item-name">{game.name}</h3>
                  <span className={`game-status ${meta.className}`}>
                    <StatusIcon size={14} />
                    {game.status}
                  </span>
                </div>
                {game.description && (
                  <p className="game-item-desc">{game.description}</p>
                )}
                {game.status === 'LIVE' && route && (
                  <Link to={route} className="game-enter-link">
                    Enter Game
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
