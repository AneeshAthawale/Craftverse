import React, { useState, useEffect, useRef } from 'react';
import './Admin.css';

export default function Admin() {
  const [gameState, setGameState] = useState('PRE_GAME');
  const [isCountdownActive, setIsCountdownActive] = useState(false);
  const [countdownVal, setCountdownVal] = useState(3);
  const [totalRoundTimer, setTotalRoundTimer] = useState(180);
  const [connected, setConnected] = useState(false);
  
  const channelRef = useRef(null);

  useEffect(() => {
    channelRef.current = new BroadcastChannel('rlgl-admin-channel');
    
    const handleMessage = (event) => {
      if (event.data.type === 'STATE_SYNC') {
        const { payload } = event.data;
        setGameState(payload.gameState);
        setIsCountdownActive(payload.isCountdownActive);
        setCountdownVal(payload.countdownVal);
        setTotalRoundTimer(payload.totalRoundTimer);
        setConnected(true);
      }
    };

    channelRef.current.addEventListener('message', handleMessage);
    
    // Request initial sync
    channelRef.current.postMessage({ type: 'REQUEST_SYNC' });

    return () => {
      channelRef.current.removeEventListener('message', handleMessage);
    };
  }, []);

  const handleAdminTriggerStateChange = () => {
    if (isCountdownActive || (gameState !== 'GREEN_LIGHT' && gameState !== 'RED_LIGHT')) return;
    
    if (channelRef.current) {
      channelRef.current.postMessage({ type: 'TRIGGER_STATE_CHANGE' });
    }
  };

  const handleDisqualifyTeam = () => {
    if (channelRef.current) {
      channelRef.current.postMessage({ type: 'DISQUALIFY_TEAM' });
    }
  };

  return (
    <div className="admin-page-container">
      <div className="admin-console-bar standalone">
        <div className="admin-console-header">
          <span>👑 CRAFTVERSE ADMIN CONTROL PANEL (HOST MODE)</span>
          <span className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
            {connected ? '🟢 Connected to Arena' : '🔴 Disconnected'}
          </span>
        </div>

        <div className="admin-console-content">
          <div className="admin-status-indicator">
            <div className="status-row">
               Current Light State: <strong style={{ color: gameState === 'GREEN_LIGHT' ? '#00e676' : gameState === 'RED_LIGHT' ? '#ff1744' : '#fff' }}>{gameState}</strong>
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
                ? `Switching state in ${countdownVal}s...`
                : gameState === 'GREEN_LIGHT'
                ? '🔴 CHANGE TO RED LIGHT (Trigger 3s Warning)'
                : gameState === 'RED_LIGHT'
                ? '🟢 CHANGE TO GREEN LIGHT (Trigger 3s Warning)'
                : 'WAITING FOR GAME START'}
            </button>

            <button
              className="btn-admin-danger"
              onClick={handleDisqualifyTeam}
              disabled={gameState === 'PRE_GAME' || gameState === 'DISQUALIFIED' || gameState === 'VICTORY'}
            >
              🛑 FORCE DISQUALIFY TEAM
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}