import { useState, useEffect, useRef } from 'react';
import './RLGLControlPanel.css';

export default function RLGLControlPanel() {
  const [gameState, setGameState] = useState('PRE_GAME');
  const [isCountdownActive, setIsCountdownActive] = useState(false);
  const [countdownVal, setCountdownVal] = useState(3);
  const [totalRoundTimer, setTotalRoundTimer] = useState(180);
  const [connected, setConnected] = useState(false);
  const [teams, setTeams] = useState({});
  
  const channelRef = useRef(null);

  useEffect(() => {
    channelRef.current = new BroadcastChannel('rlgl-admin-channel');
    
    const handleMessage = (event) => {
      if (event.data.type === 'STATE_SYNC') {
        const { payload } = event.data;
        
        if (payload.gameState === 'PRE_GAME' || payload.gameState === 'GREEN_LIGHT' || payload.gameState === 'RED_LIGHT') {
          setGameState(payload.gameState);
        }
        
        if (payload.isCountdownActive !== undefined) setIsCountdownActive(payload.isCountdownActive);
        if (payload.countdownVal !== undefined) setCountdownVal(payload.countdownVal);
        if (payload.totalRoundTimer !== undefined) setTotalRoundTimer(payload.totalRoundTimer);
        setConnected(true);

        if (payload.teamName) {
          setTeams(prev => ({
            ...prev,
            [payload.teamName]: {
              gameState: payload.gameState,
              lastSeen: Date.now()
            }
          }));
        }
      }
    };

    channelRef.current.addEventListener('message', handleMessage);
    
    // Request initial sync
    channelRef.current.postMessage({ type: 'REQUEST_SYNC' });

    // Clean up stale teams (no updates for 15 seconds)
    const cleanup = setInterval(() => {
      setTeams(prev => {
        const now = Date.now();
        const updated = { ...prev };
        let changed = false;
        for (const team in updated) {
          if (now - updated[team].lastSeen > 15000) {
            delete updated[team];
            changed = true;
          }
        }
        return changed ? updated : prev;
      });
    }, 5000);

    return () => {
      channelRef.current.removeEventListener('message', handleMessage);
      clearInterval(cleanup);
    };
  }, []);

  const handleAdminTriggerStateChange = () => {
    if (isCountdownActive || (gameState !== 'GREEN_LIGHT' && gameState !== 'RED_LIGHT')) return;
    
    if (channelRef.current) {
      channelRef.current.postMessage({ type: 'TRIGGER_STATE_CHANGE' });
    }
  };

  const handleDisqualifyAll = () => {
    if (channelRef.current) {
      channelRef.current.postMessage({ type: 'DISQUALIFY_TEAM' });
    }
  };

  const handleDisqualifySpecific = (teamName) => {
    if (channelRef.current) {
      channelRef.current.postMessage({ type: 'DISQUALIFY_SPECIFIC_TEAM', payload: { teamName } });
    }
  };

  const activeTeams = [];
  const disqualifiedTeams = [];
  const victoriousTeams = [];

  Object.entries(teams).forEach(([teamName, data]) => {
    if (data.gameState === 'DISQUALIFIED') {
      disqualifiedTeams.push(teamName);
    } else if (data.gameState === 'VICTORY') {
      victoriousTeams.push(teamName);
    } else {
      activeTeams.push(teamName);
    }
  });

  return (
    <div className="admin-page-container dashboard-layout">
      {/* Sidebar Controls */}
      <div className="admin-sidebar">
        <div className="admin-console-header">
          <span>👑 CRAFTVERSE ADMIN</span>
        </div>

        <div className="admin-console-content">
          <div className="admin-status-indicator">
            <div className="status-row">
               Light State: <strong style={{ color: gameState === 'GREEN_LIGHT' ? '#00e676' : gameState === 'RED_LIGHT' ? '#ff1744' : '#fff' }}>{gameState}</strong>
            </div>
            <div className="status-row">
               Round Timer: <strong>{totalRoundTimer}s</strong>
            </div>
            {isCountdownActive && <div className="admin-countdown-badge"> [Countdown {countdownVal}s active]</div>}
          </div>

          <div className="admin-action-buttons">
            <button
              className={`btn-admin-toggle ${gameState === 'GREEN_LIGHT' ? 'to-red' : 'to-green'}`}
              onClick={handleAdminTriggerStateChange}
              disabled={isCountdownActive || (gameState !== 'GREEN_LIGHT' && gameState !== 'RED_LIGHT')}
            >
              {isCountdownActive
                ? `Switching in ${countdownVal}s...`
                : gameState === 'GREEN_LIGHT'
                ? '🔴 CHANGE TO RED LIGHT'
                : gameState === 'RED_LIGHT'
                ? '🟢 CHANGE TO GREEN LIGHT'
                : 'WAITING FOR GAME START'}
            </button>

            <button
              className="btn-admin-danger"
              onClick={handleDisqualifyAll}
              disabled={gameState === 'PRE_GAME' || gameState === 'DISQUALIFIED' || gameState === 'VICTORY'}
            >
              🛑 FORCE DISQUALIFY ALL
            </button>
          </div>
          <div className="status-row connection-info">
             <span className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
               {connected ? '🟢 Connected to Arena' : '🔴 Disconnected'}
             </span>
          </div>
        </div>
      </div>

      {/* Main Dashboard Panel */}
      <div className="admin-main-panel">
        <div className="dashboard-header">
           <h2>Game Dashboard</h2>
           <p>Live tracking of all connected teams.</p>
        </div>
        
        <div className="teams-grid">
           {/* Active Teams Column */}
           <div className="teams-column">
              <h3>ACTIVE TEAMS ({activeTeams.length})</h3>
              <div className="teams-list active-list">
                 {activeTeams.length === 0 ? <p className="empty-msg">No active teams.</p> : activeTeams.map(t => (
                   <div key={t} className="team-card active-team">
                      <span className="team-name">{t}</span>
                      <button className="btn-sm-danger" onClick={() => handleDisqualifySpecific(t)}>Disqualify</button>
                   </div>
                 ))}
              </div>
           </div>
           
           {/* Victorious Teams Column */}
           <div className="teams-column">
              <h3>VICTORIOUS TEAMS ({victoriousTeams.length})</h3>
              <div className="teams-list victory-list">
                 {victoriousTeams.length === 0 ? <p className="empty-msg">No winners yet.</p> : victoriousTeams.map(t => (
                   <div key={t} className="team-card victory-team">
                      <span className="team-name">🏆 {t}</span>
                   </div>
                 ))}
              </div>
           </div>
           
           {/* Disqualified Teams Column */}
           <div className="teams-column">
              <h3>DISQUALIFIED ({disqualifiedTeams.length})</h3>
              <div className="teams-list disqualified-list">
                 {disqualifiedTeams.length === 0 ? <p className="empty-msg">No disqualified teams.</p> : disqualifiedTeams.map(t => (
                   <div key={t} className="team-card disqualified-team">
                      <span className="team-name">💀 {t}</span>
                   </div>
                 ))}
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}
