import React, { useState, useEffect, useRef } from 'react';
import './RLGL.css';

// --- SAMPLE CODING PROBLEMS FOR PROJECTOR & USER SCREEN ---
const PROBLEMS = [
  {
    id: 'easy_1',
    title: '1. Reverse Words in a String',
    difficulty: 'Easy',
    description: 'Write a function `reverseWords(str)` that takes a string of words separated by spaces and reverses the order of the words while trimming extra spaces.',
    starterCode: `function reverseWords(str) {\n  // Your code here during GREEN LIGHT\n  return str.trim().split(/\\s+/).reverse().join(" ");\n}`,
    testCases: [
      { input: ['"the sky is blue"'], expected: '"blue is sky the"' },
      { input: ['"  hello world  "'], expected: '"world hello"' },
      { input: ['"a good   example"'], expected: '"example good a"' }
    ],
    fnName: 'reverseWords'
  },
  {
    id: 'medium_1',
    title: '2. Two Sum Target Index',
    difficulty: 'Medium',
    description: 'Write a function `twoSum(nums, target)` that returns the 0-based indices of two numbers in an array that add up to `target`. Return `[idx1, idx2]`.',
    starterCode: `function twoSum(nums, target) {\n  // Your code here during GREEN LIGHT\n  for (let i = 0; i < nums.length; i++) {\n    for (let j = i + 1; j < nums.length; j++) {\n      if (nums[i] + nums[j] === target) return [i, j];\n    }\n  }\n  return [];\n}`,
    testCases: [
      { input: ['[2, 7, 11, 15]', '9'], expected: '[0, 1]' },
      { input: ['[3, 2, 4]', '6'], expected: '[1, 2]' },
      { input: ['[3, 3]', '6'], expected: '[0, 1]' }
    ],
    fnName: 'twoSum'
  },
  {
    id: 'hard_1',
    title: '3. Valid Parentheses Match',
    difficulty: 'Hard',
    description: 'Write a function `isValid(s)` that determines if input string containing brackets `()[]{}` is valid in order.',
    starterCode: `function isValid(s) {\n  const stack = [];\n  const map = { ")": "(", "]": "[", "}": "{" };\n  for (let char of s) {\n    if (char in map) {\n      if (stack.pop() !== map[char]) return false;\n    } else {\n      stack.push(char);\n    }\n  }\n  return stack.length === 0;\n}`,
    testCases: [
      { input: ['"()"'], expected: 'true' },
      { input: ['"()[]{}"'], expected: 'true' },
      { input: ['"(]"'], expected: 'false' }
    ],
    fnName: 'isValid'
  }
];

// --- INITIAL RIVAL AI TEAMS ---
const INITIAL_RIVALS = [
  { id: '456', name: 'Player 456 (You)', isPlayer: true, status: 'CODING', progress: 0, time: 0 },
  { id: '001', name: 'Team 001 (Ill-nam)', isPlayer: false, status: 'CODING', progress: 15, time: 0 },
  { id: '218', name: 'Team 218 (Sang-woo)', isPlayer: false, status: 'CODING', progress: 25, time: 0 },
  { id: '067', name: 'Team 067 (Sae-byeok)', isPlayer: false, status: 'CODING', progress: 20, time: 0 },
  { id: '101', name: 'Team 101 (Deok-su)', isPlayer: false, status: 'CODING', progress: 10, time: 0 },
  { id: '199', name: 'Team 199 (Ali)', isPlayer: false, status: 'CODING', progress: 18, time: 0 }
];

export default function RLGL() {
  const [gameState, setGameState] = useState('PRE_GAME'); // PRE_GAME | GREEN_LIGHT | RED_LIGHT | DISQUALIFIED | VICTORY
  const [selectedProblemIdx, setSelectedProblemIdx] = useState(0);
  const [userCode, setUserCode] = useState(PROBLEMS[0].starterCode);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [phaseTimeLeft, setPhaseTimeLeft] = useState(7); // Duration of Green or Red light
  const [totalRoundTimer, setTotalRoundTimer] = useState(180); // 3 minutes total
  const [prizePool, setPrizePool] = useState(45600000000); // ₩45.6 Billion
  const [rivals, setRivals] = useState(INITIAL_RIVALS);
  const [testResults, setTestResults] = useState([]);
  const [disqualifyReason, setDisqualifyReason] = useState('');
  const [podium, setPodium] = useState([]);

  const activeProblem = PROBLEMS[selectedProblemIdx];
  const audioCtxRef = useRef(null);

  // Initialize Web Audio Synth
  const playSynthSound = (type) => {
    if (!soundEnabled) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;

      if (type === 'GREEN') {
        // Upbeat chime sequence (Mugunghwa melody notes)
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, now); // A4
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.2); // A5
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      } else if (type === 'RED') {
        // Red warning pulse siren
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.linearRampToValueAtTime(90, now + 0.5);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
        osc.start(now);
        osc.stop(now + 0.5);
      } else if (type === 'ELIMINATED') {
        // Harsh gunshot / elimination buzz
        osc.type = 'square';
        osc.frequency.setValueAtTime(120, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.6);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
        osc.start(now);
        osc.stop(now + 0.6);
      } else if (type === 'VICTORY') {
        // Arpeggiated victory fanfare
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.15); // E5
        osc.frequency.setValueAtTime(783.99, now + 0.3); // G5
        osc.frequency.setValueAtTime(1046.5, now + 0.45); // C6
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
        osc.start(now);
        osc.stop(now + 0.8);
      }
    } catch (e) {
      console.warn('Audio Context Error:', e);
    }
  };

  // --- KEYBOARD LISTENER FOR DISQUALIFICATION DURING RED LIGHT ---
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Allow modifier keys like Ctrl/Shift alone, but any typing key eliminates player in RED_LIGHT
      if (gameState === 'RED_LIGHT') {
        setGameState('DISQUALIFIED');
        setDisqualifyReason(`DISQUALIFIED! Keystroke "${e.key}" detected during RED LIGHT!`);
        playSynthSound('ELIMINATED');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState]);

  // --- START GAME & RESET ---
  const handleStartGame = () => {
    setUserCode(PROBLEMS[selectedProblemIdx].starterCode);
    setGameState('GREEN_LIGHT');
    setPhaseTimeLeft(6);
    setTotalRoundTimer(180);
    setRivals(INITIAL_RIVALS.map(r => ({ ...r, status: 'CODING', progress: 0 })));
    setTestResults([]);
    setDisqualifyReason('');
    playSynthSound('GREEN');
  };

  // --- RED LIGHT / GREEN LIGHT STATE MACHINE TIMER ---
  useEffect(() => {
    if (gameState !== 'GREEN_LIGHT' && gameState !== 'RED_LIGHT') return;

    const interval = setInterval(() => {
      // Total round countdown
      setTotalRoundTimer(prev => {
        if (prev <= 1) {
          // Time expired
          setGameState('DISQUALIFIED');
          setDisqualifyReason('DISQUALIFIED! Round time expired before completion!');
          playSynthSound('ELIMINATED');
          return 0;
        }
        return prev - 1;
      });

      // Light phase countdown
      setPhaseTimeLeft(prev => {
        if (prev <= 1) {
          // Switch phase
          if (gameState === 'GREEN_LIGHT') {
            setGameState('RED_LIGHT');
            playSynthSound('RED');
            return Math.floor(Math.random() * 4) + 4; // Red light lasts 4-7 sec
          } else {
            setGameState('GREEN_LIGHT');
            playSynthSound('GREEN');
            return Math.floor(Math.random() * 5) + 5; // Green light lasts 5-9 sec
          }
        }
        return prev - 1;
      });

      // Update AI Rivals progress & random RED LIGHT eliminations
      setRivals(prevRivals => {
        return prevRivals.map(r => {
          if (r.isPlayer || r.status !== 'CODING') return r;

          if (gameState === 'GREEN_LIGHT') {
            const addProgress = Math.floor(Math.random() * 6) + 3;
            const newProgress = Math.min(100, r.progress + addProgress);
            const status = newProgress >= 100 ? 'FINISHED' : 'CODING';
            return { ...r, progress: newProgress, status };
          } else if (gameState === 'RED_LIGHT') {
            // 15% chance a bot moves during Red Light and gets eliminated!
            if (Math.random() < 0.15) {
              setPrizePool(p => p + 1000000000); // +1 Billion per bot eliminated
              playSynthSound('ELIMINATED');
              return { ...r, status: 'ELIMINATED' };
            }
          }
          return r;
        });
      });

    }, 1000);

    return () => clearInterval(interval);
  }, [gameState]);

  // --- CODE EXECUTION & TEST RUNNER ---
  const handleRunTests = () => {
    if (gameState === 'RED_LIGHT') {
      setGameState('DISQUALIFIED');
      setDisqualifyReason('DISQUALIFIED! Attempted to run tests during RED LIGHT!');
      playSynthSound('ELIMINATED');
      return;
    }

    try {
      // Evaluate solution function safely
      const problem = activeProblem;
      const userFn = new Function(`
        ${userCode}
        return ${problem.fnName};
      `)();

      let passedCount = 0;
      const results = problem.testCases.map((tc, idx) => {
        try {
          const args = tc.input.map(arg => JSON.parse(arg));
          const actualOutput = userFn(...args);
          const expectedParsed = JSON.parse(tc.expected);
          const isPassed = JSON.stringify(actualOutput) === JSON.stringify(expectedParsed);

          if (isPassed) passedCount++;
          return {
            id: idx + 1,
            input: tc.input.join(', '),
            expected: tc.expected,
            actual: JSON.stringify(actualOutput),
            passed: isPassed
          };
        } catch (err) {
          return {
            id: idx + 1,
            input: tc.input.join(', '),
            expected: tc.expected,
            actual: `Error: ${err.message}`,
            passed: false
          };
        }
      });

      setTestResults(results);

      // Check if all test cases passed!
      if (passedCount === problem.testCases.length) {
        // Player Wins!
        const finishTime = 180 - totalRoundTimer;
        setGameState('VICTORY');
        playSynthSound('VICTORY');

        // Construct Podium Leaders
        const allCompetitors = [
          { rankName: 'Player 456 (You)', time: `${finishTime}s`, accuracy: '100%' },
          { rankName: 'Team 218 (Sang-woo)', time: `${finishTime + 12}s`, accuracy: '95%' },
          { rankName: 'Team 067 (Sae-byeok)', time: `${finishTime + 24}s`, accuracy: '90%' }
        ];
        setPodium(allCompetitors);
      }
    } catch (err) {
      setTestResults([{ id: 1, input: 'Syntax Check', expected: 'Valid JS', actual: err.message, passed: false }]);
    }
  };

  const aliveCount = rivals.filter(r => r.status !== 'ELIMINATED').length;

  return (
    <div className={`rlgl-container state-${gameState}`}>
      {/* --- SQUID GAME HEADER BAR --- */}
      <header className="rlgl-header">
        <div className="squid-logo">
          <div className="squid-shapes">
            <span className="squid-shape circle">◯</span>
            <span className="squid-shape triangle">△</span>
            <span className="squid-shape square">□</span>
          </div>
          <h1 className="game-title">CraftVerse: Red Light Green Light</h1>
        </div>

        <div className="header-stats">
          <div className="piggy-bank">
            <span>🐖 PRIZE POOL:</span>
            <span>₩ {(prizePool / 1000000000).toFixed(1)}B WON</span>
          </div>

          <div className="player-tag">
            <span>TEAMS ALIVE: {aliveCount} / 6</span>
          </div>

          <button className="audio-btn" onClick={() => setSoundEnabled(!soundEnabled)}>
            {soundEnabled ? '🔊 Sound ON' : '🔇 Muted'}
          </button>
        </div>
      </header>

      {/* --- ARENA TOP BANNER / DOLL & LIGHT INDICATOR --- */}
      <div className={`arena-status-bar status-${gameState}`}>
        <div className="status-left-info">
          <div className={`phase-badge phase-${gameState === 'GREEN_LIGHT' ? 'GREEN' : 'RED'}`}>
            <span className="phase-indicator-dot" style={{ backgroundColor: gameState === 'GREEN_LIGHT' ? '#00e676' : '#ff1744' }}></span>
            {gameState === 'GREEN_LIGHT' ? 'GREEN LIGHT (무궁화 꽃이 피었습니다)' : 'RED LIGHT (STOP CODING!)'}
          </div>
          <div className="phase-subtext">
            {gameState === 'GREEN_LIGHT'
              ? 'Safe to type and run code! Keep coding...'
              : 'HANDS OFF KEYBOARD! Typing triggers instant elimination!'}
          </div>
        </div>

        {/* --- DOLL AVATAR ANIMATION --- */}
        <div className="doll-stage">
          <div className="doll-avatar-wrap">
            <div className={`doll-avatar ${gameState === 'GREEN_LIGHT' ? 'facing-away' : 'facing-forward'}`}>
              {gameState === 'GREEN_LIGHT' ? (
                <div className="doll-hair-back"></div>
              ) : (
                <div className="doll-face">
                  <div className="doll-eyes">
                    <span className="doll-eye"></span>
                    <span className="doll-eye"></span>
                  </div>
                  <div className="doll-mouth"></div>
                </div>
              )}
            </div>
            {gameState === 'RED_LIGHT' && <div className="laser-beam"></div>}
          </div>
        </div>

        <div className="timer-countdown">
          <div>PHASE CHANGE: <span>{phaseTimeLeft}s</span></div>
          <div style={{ fontSize: '0.9rem', color: '#94a3b8', marginTop: '4px' }}>ROUND TIMER: {totalRoundTimer}s</div>
        </div>
      </div>

      {/* --- MAIN GAME GRID (PROJECTOR QUESTION & CODE EDITOR) --- */}
      <div className="game-main-grid">
        {/* --- LEFT PANEL: PROJECTOR & USER SCREEN QUESTION DISPLAY --- */}
        <div className="screen-panel">
          <div className="problem-header">
            <h2 className="problem-title">{activeProblem.title}</h2>
            <span className={`difficulty-badge difficulty-${activeProblem.difficulty.toLowerCase()}`}>
              {activeProblem.difficulty}
            </span>
          </div>

          <div className="problem-description">
            {activeProblem.description}
          </div>

          <div className="problem-examples">
            <div className="example-title">Projector Test Suite Preview:</div>
            {activeProblem.testCases.map((tc, idx) => (
              <div key={idx} className="example-box">
                <div>Input: <code>{tc.input.join(', ')}</code></div>
                <div>Expected Output: <code style={{ color: '#00e676' }}>{tc.expected}</code></div>
              </div>
            ))}
          </div>

          {/* Test Execution Output */}
          <div className="test-suite-card">
            <div className="test-suite-header">
              <span>LIVE TEST CASES ({testResults.filter(r => r.passed).length}/{activeProblem.testCases.length} PASSED)</span>
            </div>
            {testResults.length === 0 ? (
              <div style={{ fontSize: '0.85rem', color: '#64748b', fontStyle: 'italic' }}>
                Click "RUN TESTS" during GREEN LIGHT to evaluate your code.
              </div>
            ) : (
              testResults.map(res => (
                <div key={res.id} className={`test-item ${res.passed ? 'passed' : 'failed'}`}>
                  <span>Test #{res.id}: {res.passed ? 'PASSED ✅' : 'FAILED ❌'}</span>
                  <span>Out: {res.actual}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* --- RIGHT PANEL: CODE EDITOR & RIVAL LEADERBOARD --- */}
        <div className="editor-panel">
          <div className="editor-header">
            <div className="editor-title">
              <span>💻 SQUID CODE EDITOR</span>
              {gameState === 'RED_LIGHT' && <span style={{ color: '#ff1744', fontSize: '0.8rem' }}>(FREEZE!)</span>}
            </div>

            <div className="editor-actions">
              <button
                className="btn-editor"
                onClick={() => setUserCode(activeProblem.starterCode)}
                disabled={gameState === 'RED_LIGHT'}
              >
                Reset Code
              </button>
              <button
                className="btn-run"
                onClick={handleRunTests}
                disabled={gameState === 'RED_LIGHT'}
              >
                ▶ RUN TESTS (GREEN ONLY)
              </button>
            </div>
          </div>

          {/* Code Textarea Wrapper with Red Light Warning */}
          <div className="code-area-wrapper">
            <textarea
              className={`code-textarea ${gameState === 'RED_LIGHT' ? 'disabled-red-light' : ''}`}
              value={userCode}
              onChange={(e) => {
                if (gameState === 'RED_LIGHT') {
                  setGameState('DISQUALIFIED');
                  setDisqualifyReason('DISQUALIFIED! Keystroke detected during RED LIGHT!');
                  playSynthSound('ELIMINATED');
                } else {
                  setUserCode(e.target.value);
                }
              }}
              placeholder="// Write your Javascript solution here..."
              spellCheck="false"
            />
            {gameState === 'RED_LIGHT' && (
              <div className="red-light-overlay">
                <div className="overlay-text">⚠️ DO NOT TYPE! RED LIGHT ACTIVE ⚠️</div>
              </div>
            )}
          </div>

          {/* AI Rival Teams Progress */}
          <div className="rivals-card">
            <div className="rivals-header">
              <span>COMPETING RIVAL TEAMS</span>
              <span>PROGRESS</span>
            </div>
            {rivals.map(r => (
              <div
                key={r.id}
                className={`rival-row ${r.isPlayer ? 'is-player' : ''} ${r.status === 'ELIMINATED' ? 'eliminated' : ''}`}
              >
                <span>{r.name}</span>
                <span className={`rival-status ${r.status === 'CODING' ? 'coding' : r.status === 'ELIMINATED' ? 'elim' : 'done'}`}>
                  {r.status === 'ELIMINATED' ? '❌ DISQUALIFIED' : `${r.progress}% CODED`}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* --- MODAL 1: PRE_GAME START MODAL --- */}
      {gameState === 'PRE_GAME' && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-icon">🦑</div>
            <h2 className="modal-title">RED LIGHT GREEN LIGHT</h2>
            <div className="modal-desc">
              <strong>OFFICIAL RULES:</strong><br />
              1. Problem statement is displayed on the Projector & User Screen.<br />
              2. During <strong>GREEN LIGHT</strong>, type & submit your solution.<br />
              3. During <strong>RED LIGHT</strong>, <strong>STOP TYPING!</strong> Keystrokes lead to <strong>INSTANT DISQUALIFICATION</strong>.<br />
              4. Fastest solution with 100% test accuracy wins the Prize Pool!
            </div>

            <div style={{ margin: '1rem 0' }}>
              <label style={{ marginRight: '10px', fontSize: '0.9rem', color: '#94a3b8' }}>Select Challenge:</label>
              <select
                value={selectedProblemIdx}
                onChange={(e) => setSelectedProblemIdx(Number(e.target.value))}
                style={{
                  background: '#0a0c10',
                  color: '#fff',
                  padding: '0.4rem 0.85rem',
                  borderRadius: '8px',
                  border: '1px solid var(--squid-pink)'
                }}
              >
                {PROBLEMS.map((p, idx) => (
                  <option key={p.id} value={idx}>{p.title} ({p.difficulty})</option>
                ))}
              </select>
            </div>

            <button className="btn-start-game" onClick={handleStartGame}>
              ENTER ARENA & START
            </button>
          </div>
        </div>
      )}

      {/* --- MODAL 2: DISQUALIFIED MODAL --- */}
      {gameState === 'DISQUALIFIED' && (
        <div className="modal-overlay">
          <div className="modal-content eliminated-modal">
            <div className="modal-icon">🛑</div>
            <h2 className="modal-title">PLAYER 456 ELIMINATED!</h2>
            <div className="modal-desc" style={{ color: '#ff88a0', fontWeight: 'bold' }}>
              {disqualifyReason || 'Disqualified for typing during RED LIGHT phase!'}
            </div>
            <button className="btn-start-game" onClick={handleStartGame}>
              RETRY CHALLENGE
            </button>
          </div>
        </div>
      )}

      {/* --- MODAL 3: VICTORY & PODIUM MODAL --- */}
      {gameState === 'VICTORY' && (
        <div className="modal-overlay">
          <div className="modal-content victory-modal">
            <div className="modal-icon">🏆</div>
            <h2 className="modal-title">VICTORY & TOP 3 WINNERS!</h2>
            <div className="modal-desc">
              Congratulations! You completed the challenge accurately during Green Light!
            </div>

            <div className="podium-list">
              {podium.map((p, idx) => (
                <div key={idx} className={`podium-item rank-${idx + 1}`}>
                  <span>{idx === 0 ? '🥇 1st Place' : idx === 1 ? '🥈 2nd Place' : '🥉 3rd Place'}</span>
                  <span>{p.rankName}</span>
                  <span>{p.time} ({p.accuracy})</span>
                </div>
              ))}
            </div>

            <button className="btn-start-game" onClick={handleStartGame}>
              PLAY AGAIN
            </button>
          </div>
        </div>
      )}
    </div>
  );
}