import React, { useState, useEffect, useRef } from 'react';
import { Editor } from '@monaco-editor/react';
import './RLGL.css';

// --- HACKATHON OFFICIAL DOMAINS & PROBLEMS ---
const DOMAINS = [
  'AIML', 'SPACETECH', 'CYBERSECURITY', 'SMART CITIES & IOT',
  'HEALTHCARE & MEDTECH', 'SUSTAINABILITY', 'FINTECH',
  'ROBOTICS & AUTOMATION', 'AR/VR & GAMING', 'EDTECH', 'OPEN INNOVATION'
];

const PROBLEMS = [
  {
    id: 'easy_1',
    title: '1. Cyber String Decryptor (Reverse Words)',
    domain: 'CYBERSECURITY',
    difficulty: 'Easy',
    description: 'Part of Round 2 Cybersecurity task: Write a function `reverseWords(str)` that takes an encrypted telemetry packet of words separated by spaces and reverses the order of words while trimming extra whitespace.',
    starterCode: `function reverseWords(str) {\n  // Code during GREEN LIGHT ONLY!\n  return str.trim().split(/\\s+/).reverse().join(" ");\n}`,
    testCases: [
      { input: ['"the sky is blue"'], expected: '"blue is sky the"' },
      { input: ['"  hello world  "'], expected: '"world hello"' },
      { input: ['"a good   example"'], expected: '"example good a"' }
    ],
    fnName: 'reverseWords'
  },
  {
    id: 'medium_1',
    title: '2. FinTech Transaction Matcher (Two Sum)',
    domain: 'FINTECH',
    difficulty: 'Medium',
    description: 'Part of Round 2 FinTech task: Write a function `twoSum(nums, target)` that returns the 0-based indices of two transaction amounts in an array that sum up to `target`. Return `[idx1, idx2]`.',
    starterCode: `function twoSum(nums, target) {\n  // Code during GREEN LIGHT ONLY!\n  for (let i = 0; i < nums.length; i++) {\n    for (let j = i + 1; j < nums.length; j++) {\n      if (nums[i] + nums[j] === target) return [i, j];\n    }\n  }\n  return [];\n}`,
    testCases: [
      { input: ['[2, 7, 11, 15]', '9'], expected: '[0, 1]' },
      { input: ['[3, 2, 4]', '6'], expected: '[1, 2]' },
      { input: ['[3, 3]', '6'], expected: '[0, 1]' }
    ],
    fnName: 'twoSum'
  },
  {
    id: 'hard_1',
    title: '3. SpaceTech Payload Parser (Valid Parentheses)',
    domain: 'SPACETECH',
    difficulty: 'Hard',
    description: 'Part of Round 2 SpaceTech task: Write a function `isValid(s)` that verifies if satellite data packet containing brackets `()[]{}` is structured validly.',
    starterCode: `function isValid(s) {\n  // Code during GREEN LIGHT ONLY!\n  const stack = [];\n  const map = { ")": "(", "]": "[", "}": "{" };\n  for (let char of s) {\n    if (char in map) {\n      if (stack.pop() !== map[char]) return false;\n    } else {\n      stack.push(char);\n    }\n  }\n  return stack.length === 0;\n}`,
    testCases: [
      { input: ['"()"'], expected: 'true' },
      { input: ['"()[]{}"'], expected: 'true' },
      { input: ['"(]"'], expected: 'false' }
    ],
    fnName: 'isValid'
  }
];

// --- INITIAL COMPETITOR TEAMS ---
const INITIAL_RIVALS = [
  { id: '456', name: 'Team 456 (Your Team)', isPlayer: true, status: 'CODING', progress: 0 },
  { id: '001', name: 'Team Alpha (PCCOER)', isPlayer: false, status: 'CODING', progress: 15 },
  { id: '218', name: 'Team CyberKnight', isPlayer: false, status: 'CODING', progress: 25 },
  { id: '067', name: 'Team Phoenix Devs', isPlayer: false, status: 'CODING', progress: 20 },
  { id: '101', name: 'Team Byte Busters', isPlayer: false, status: 'CODING', progress: 10 },
  { id: '199', name: 'Team Quantum Craft', isPlayer: false, status: 'CODING', progress: 18 }
];

export default function RLGL() {
  const [gameState, setGameState] = useState('PRE_GAME'); // PRE_GAME | GREEN_LIGHT | RED_LIGHT | DISQUALIFIED | VICTORY
  const [selectedProblemIdx, setSelectedProblemIdx] = useState(0);
  const [userCode, setUserCode] = useState(PROBLEMS[0].starterCode);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [totalRoundTimer, setTotalRoundTimer] = useState(180); // 3 minutes total
  const [prizePool, setPrizePool] = useState(60000); // ₹60,000+
  const [rivals, setRivals] = useState(INITIAL_RIVALS);
  const [testResults, setTestResults] = useState([]);
  const [disqualifyReason, setDisqualifyReason] = useState('');
  const [podium, setPodium] = useState([]);

  // --- ADMIN CONTROLLED COUNTDOWN STATE ---
  const [isCountdownActive, setIsCountdownActive] = useState(false);
  const [countdownVal, setCountdownVal] = useState(3);
  const [nextState, setNextState] = useState('RED_LIGHT');

  const activeProblem = PROBLEMS[selectedProblemIdx];
  const audioCtxRef = useRef(null);
  
  // Use a ref for broadcast channel to avoid re-creations
  const channelRef = useRef(null);

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

      if (type === 'BEEP_3') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (type === 'GREEN') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.2);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      } else if (type === 'RED') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.linearRampToValueAtTime(90, now + 0.5);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
        osc.start(now);
        osc.stop(now + 0.5);
      } else if (type === 'ELIMINATED') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(120, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.6);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
        osc.start(now);
        osc.stop(now + 0.6);
      } else if (type === 'VICTORY') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.15);
        osc.frequency.setValueAtTime(783.99, now + 0.3);
        osc.frequency.setValueAtTime(1046.5, now + 0.45);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
        osc.start(now);
        osc.stop(now + 0.8);
      }
    } catch (e) {
      console.warn('Audio Context Error:', e);
    }
  };

  // Broadcast state changes to Admin
  useEffect(() => {
    if (!channelRef.current) {
      channelRef.current = new BroadcastChannel('rlgl-admin-channel');
    }
    channelRef.current.postMessage({
      type: 'STATE_SYNC',
      payload: {
        gameState,
        isCountdownActive,
        countdownVal,
        nextState,
        totalRoundTimer
      }
    });
  }, [gameState, isCountdownActive, countdownVal, nextState, totalRoundTimer]);

  // Listen for commands from Admin
  useEffect(() => {
    if (!channelRef.current) {
      channelRef.current = new BroadcastChannel('rlgl-admin-channel');
    }
    
    const handleMessage = (event) => {
      const { type } = event.data;
      if (type === 'TRIGGER_STATE_CHANGE') {
        setGameState((currentGameState) => {
          if (isCountdownActive || (currentGameState !== 'GREEN_LIGHT' && currentGameState !== 'RED_LIGHT')) return currentGameState;
          
          const target = currentGameState === 'GREEN_LIGHT' ? 'RED_LIGHT' : 'GREEN_LIGHT';
          setNextState(target);
          setIsCountdownActive(true);
          setCountdownVal(3);
          playSynthSound('BEEP_3');
          return currentGameState;
        });
      } else if (type === 'DISQUALIFY_TEAM') {
        setGameState('DISQUALIFIED');
        setDisqualifyReason('DISQUALIFIED! Admin manually issued team disqualification penalty.');
        playSynthSound('ELIMINATED');
      } else if (type === 'REQUEST_SYNC') {
         channelRef.current.postMessage({
          type: 'STATE_SYNC',
          payload: {
            gameState,
            isCountdownActive,
            countdownVal,
            nextState,
            totalRoundTimer
          }
        });
      }
    };

    channelRef.current.addEventListener('message', handleMessage);
    return () => {
      channelRef.current.removeEventListener('message', handleMessage);
    };
  }, [isCountdownActive]); // Removed playSynthSound from dep array, kept isCountdownActive as it's checked

  // Countdown timer effect when Admin triggers state change
  useEffect(() => {
    if (!isCountdownActive) return;

    const interval = setInterval(() => {
      setCountdownVal(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          setIsCountdownActive(false);
          setGameState(nextState);
          playSynthSound(nextState === 'RED_LIGHT' ? 'RED' : 'GREEN');

          // If switching to RED_LIGHT, check if any AI bots get eliminated!
          if (nextState === 'RED_LIGHT') {
            setRivals(prevRivals => prevRivals.map(r => {
              if (r.isPlayer || r.status !== 'CODING') return r;
              if (Math.random() < 0.2) {
                return { ...r, status: 'ELIMINATED' };
              }
              return r;
            }));
          }
          return 0;
        } else {
          playSynthSound('BEEP_3');
          return prev - 1;
        }
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isCountdownActive, nextState]);

  // --- KEYBOARD LISTENER FOR DISQUALIFICATION DURING RED LIGHT ---
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (gameState === 'RED_LIGHT') {
        setGameState('DISQUALIFIED');
        setDisqualifyReason(`DISQUALIFIED! Keystroke "${e.key}" detected during RED LIGHT! Team eliminated by rule violation.`);
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
    setIsCountdownActive(false);
    setTotalRoundTimer(180);
    setRivals(INITIAL_RIVALS.map(r => ({ ...r, status: 'CODING', progress: 0 })));
    setTestResults([]);
    setDisqualifyReason('');
    playSynthSound('GREEN');
  };

  // --- TOTAL ROUND countdown & Bot coding progress ---
  useEffect(() => {
    if (gameState !== 'GREEN_LIGHT' && gameState !== 'RED_LIGHT') return;

    const interval = setInterval(() => {
      setTotalRoundTimer(prev => {
        if (prev <= 1) {
          setGameState('DISQUALIFIED');
          setDisqualifyReason('DISQUALIFIED! 180s Round Timer Expired before final submission!');
          playSynthSound('ELIMINATED');
          return 0;
        }
        return prev - 1;
      });

      if (gameState === 'GREEN_LIGHT' && !isCountdownActive) {
        setRivals(prevRivals => prevRivals.map(r => {
          if (r.isPlayer || r.status !== 'CODING') return r;
          const addProgress = Math.floor(Math.random() * 5) + 3;
          const newProgress = Math.min(100, r.progress + addProgress);
          return { ...r, progress: newProgress, status: newProgress >= 100 ? 'FINISHED' : 'CODING' };
        }));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [gameState, isCountdownActive]);

  // --- CODE EXECUTION & TEST RUNNER ---
  const handleRunTests = () => {
    if (gameState === 'RED_LIGHT' || (isCountdownActive && nextState === 'RED_LIGHT')) {
      setGameState('DISQUALIFIED');
      setDisqualifyReason('DISQUALIFIED! Attempted to run tests during RED LIGHT!');
      playSynthSound('ELIMINATED');
      return;
    }

    try {
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

      if (passedCount === problem.testCases.length) {
        const finishTime = 180 - totalRoundTimer;
        setGameState('VICTORY');
        playSynthSound('VICTORY');

        const allCompetitors = [
          { rankName: 'Team 456 (Your Team)', time: `${finishTime}s`, accuracy: '100%' },
          { rankName: 'Team CyberKnight', time: `${finishTime + 14}s`, accuracy: '95%' },
          { rankName: 'Team Phoenix Devs', time: `${finishTime + 28}s`, accuracy: '90%' }
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
      {/* --- HACKATHON OFFICIAL HEADER BAR --- */}
      {/* Header removed as requested */}

      {/* --- DOMAINS BANNER --- */}
      <div className="domain-banner">
        <div className="round-badge">ROUND 2: OFFLINE NIGHT SURVIVAL & DEBUGGING SESSION</div>
        <div className="domains-pills">
          {DOMAINS.slice(0, 6).map((d, i) => (
            <span key={i} className={`domain-pill ${activeProblem.domain.includes(d) ? 'active' : ''}`}>
              {d}
            </span>
          ))}
        </div>
      </div>

      {/* --- ARENA TOP BANNER / LIGHT STATUS & DOLL --- */}
      <div className={`arena-status-bar status-${gameState}`}>
        <div className="status-left-info">
          <div className={`phase-badge phase-${gameState === 'GREEN_LIGHT' ? 'GREEN' : 'RED'}`}>
            <span className="phase-indicator-dot" style={{ backgroundColor: gameState === 'GREEN_LIGHT' ? '#00e676' : '#ff1744' }}></span>
            {gameState === 'GREEN_LIGHT' ? 'GREEN LIGHT (CODE NOW!)' : 'RED LIGHT (STOP CODING!)'}
          </div>
          <div className="phase-subtext">
            {gameState === 'GREEN_LIGHT'
              ? 'Safe to code & run tests. Type your solution!'
              : 'HANDS OFF KEYBOARD! Any typing results in instant Round 2 Elimination!'}
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
          <div>CONTROL: <span style={{ fontSize: '1rem', color: '#ff2a70' }}>ADMIN CONTROLLED</span></div>
          <div style={{ fontSize: '0.9rem', color: '#94a3b8', marginTop: '4px' }}>ROUND TIMER: {totalRoundTimer}s</div>
        </div>
      </div>

      {/* --- 3-SECOND WARNING OVERLAY (ADMIN STATE CHANGE) --- */}
      {isCountdownActive && (
        <div className="admin-countdown-overlay">
          <div className="admin-countdown-box">
            <div className="countdown-warning-title">
              ⚠️ ADMIN TRIGGERED STATE CHANGE ⚠️
            </div>
            <div className="countdown-target-text">
              SWITCHING TO <strong style={{ color: nextState === 'RED_LIGHT' ? '#ff1744' : '#00e676' }}>{nextState === 'RED_LIGHT' ? 'RED LIGHT (FREEZE!)' : 'GREEN LIGHT (CODE!)'}</strong> IN:
            </div>
            <div className="countdown-number-pulse">
              {countdownVal}
            </div>
            <div className="countdown-sub-warning">
              {nextState === 'RED_LIGHT' ? 'GET READY TO RELEASE KEYBOARD & STOP TYPING!' : 'GET READY TO CODE YOUR SOLUTION!'}
            </div>
          </div>
        </div>
      )}

      {/* --- MAIN GAME GRID (PROJECTOR & CODE EDITOR) --- */}
      <div className="game-main-grid">
        {/* --- LEFT PANEL: PROJECTOR & USER SCREEN QUESTION DISPLAY --- */}
        <div className="screen-panel">
          <div className="problem-header">
            <div>
              <span className="problem-domain-tag">DOMAIN: {activeProblem.domain}</span>
              <h2 className="problem-title">{activeProblem.title}</h2>
            </div>
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
              <span>💻 CRAFTVERSE SURVIVAL EDITOR</span>
              {gameState === 'RED_LIGHT' && <span style={{ color: '#ff1744', fontSize: '0.8rem' }}>(FREEZE!)</span>}
            </div>

            <div className="editor-actions">
              <button
                className="btn-editor"
                onClick={() => setUserCode(activeProblem.starterCode)}
                disabled={gameState === 'RED_LIGHT' || isCountdownActive}
              >
                Reset Code
              </button>
              <button
                className="btn-run"
                onClick={handleRunTests}
                disabled={gameState === 'RED_LIGHT' || isCountdownActive}
              >
                ▶ RUN TESTS (GREEN ONLY)
              </button>
            </div>
          </div>

          {/* Code Textarea Wrapper with Red Light Warning */}
          <div className="code-area-wrapper">
            <Editor
              height="100%"
              defaultLanguage="javascript"
              theme="vs-dark"
              value={userCode}
              onChange={(value) => {
                if (gameState === 'RED_LIGHT') {
                  setGameState('DISQUALIFIED');
                  setDisqualifyReason('DISQUALIFIED! Keystroke detected during RED LIGHT phase!');
                  playSynthSound('ELIMINATED');
                } else {
                  setUserCode(value || '');
                }
              }}
              options={{
                readOnly: gameState === 'RED_LIGHT' || isCountdownActive,
                minimap: { enabled: false },
                fontSize: 16,
              }}
            />
            {gameState === 'RED_LIGHT' && (
              <div className="red-light-overlay">
                <div className="overlay-text">⚠️ DO NOT TOUCH KEYBOARD! RED LIGHT ACTIVE ⚠️</div>
              </div>
            )}
          </div>

          {/* Rivals Card removed as requested */}
        </div>
      </div>

      {/* --- MODAL 1: PRE_GAME START MODAL --- */}
      {gameState === 'PRE_GAME' && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-icon">🦑</div>
            <div className="modal-pccoer-header">PIMPRI CHINCHWAD COLLEGE OF ENGINEERING & RESEARCH (PCCOER)</div>
            <h2 className="modal-title">CRAFTVERSE HACKATHON</h2>
            <div className="modal-tagline">PLAY. CODE. SURVIVE.</div>

            <div className="event-rounds-summary">
              <div className="round-step">ROUND 1: Online PPT Submission (Unstop)</div>
              <div className="round-step active">ROUND 2: Offline Night Survival (Admin-Controlled Red Light Green Light)</div>
              <div className="round-step">FINAL ROUND: Code Freeze & Presentation</div>
            </div>

            <div className="modal-desc">
              <strong>ADMIN-CONTROLLED SURVIVAL RULES:</strong><br />
              1. Admin controls state changes via Admin Panel.<br />
              2. When Admin clicks <strong>CHANGE STATE</strong>, a <strong>3-SECOND COUNTDOWN</strong> will warning display on screen.<br />
              3. When <strong>RED LIGHT</strong> activates, <strong>STOP TYPING!</strong> Keystrokes result in immediate team disqualification.<br />
              4. Complete test cases during <strong>GREEN LIGHT</strong> to win the <strong>₹60,000+ Prize Pool</strong>!
            </div>

            <div style={{ margin: '0.5rem 0' }}>
              <label style={{ marginRight: '10px', fontSize: '0.9rem', color: '#94a3b8' }}>Select Domain Task:</label>
              <select
                value={selectedProblemIdx}
                onChange={(e) => setSelectedProblemIdx(Number(e.target.value))}
                style={{
                  background: '#0a0c10',
                  color: '#fff',
                  padding: '0.45rem 0.85rem',
                  borderRadius: '8px',
                  border: '1px solid var(--squid-pink)'
                }}
              >
                {PROBLEMS.map((p, idx) => (
                  <option key={p.id} value={idx}>[{p.domain}] {p.title} ({p.difficulty})</option>
                ))}
              </select>
            </div>

            <button className="btn-start-game" onClick={handleStartGame}>
              ENTER SURVIVAL ARENA
            </button>
          </div>
        </div>
      )}

      {/* --- MODAL 2: DISQUALIFIED MODAL --- */}
      {gameState === 'DISQUALIFIED' && (
        <div className="modal-overlay">
          <div className="modal-content eliminated-modal">
            <div className="modal-icon">🛑</div>
            <h2 className="modal-title">TEAM DISQUALIFIED!</h2>
            <div className="modal-desc" style={{ color: '#ff88a0', fontWeight: 'bold' }}>
              {disqualifyReason || 'Disqualified from CraftVerse Round 2!'}
            </div>
            <button className="btn-start-game" onClick={handleStartGame}>
              RETRY SURVIVAL ROUND
            </button>
          </div>
        </div>
      )}

      {/* --- MODAL 3: VICTORY & PODIUM MODAL --- */}
      {gameState === 'VICTORY' && (
        <div className="modal-overlay">
          <div className="modal-content victory-modal">
            <div className="modal-icon">🏆</div>
            <h2 className="modal-title">TOP TEAMS ANNOUNCED!</h2>
            <div className="modal-desc">
              Congratulations! Your team passed all test cases in Round 2 and qualified for the <strong>₹60,000+ Prize Pool</strong>!
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
              REPLAY SURVIVAL ROUND
            </button>
          </div>
        </div>
      )}
    </div>
  );
}