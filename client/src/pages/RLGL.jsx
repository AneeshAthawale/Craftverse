import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Editor } from '@monaco-editor/react';
import api from '../services/api.js';
import { onEvent, onReconnect, getSocket } from '../services/socket.js';
import { useAuth } from '../context/useAuth.js';
import './RLGL.css';

/** A tiny ticking clock (250ms) so corner countdowns re-render smoothly.
 *  Purely cosmetic — the authoritative state change arrives via rlgl:state.
 *  The snapshot is CACHED (only updated when the interval fires) because
 *  useSyncExternalStore requires getSnapshot to return a stable value between
 *  ticks — a fresh Date.now() every call triggers an infinite render loop. */
let tickerSnapshot = Date.now();
function subscribeTicker(callback) {
  const interval = setInterval(() => {
    tickerSnapshot = Date.now();
    callback();
  }, 250);
  return () => clearInterval(interval);
}
const getTickerSnapshot = () => tickerSnapshot;

export default function RLGL() {
  const { user, socketConnected } = useAuth();

  // Authoritative game state from GET /api/games/rlgl/state + rlgl:state events.
  const [problem, setProblem] = useState(null); // from games.config.problem
  const [light, setLight] = useState('GREEN'); // current authoritative light
  const [roundStatus, setRoundStatus] = useState('WAITING'); // WAITING | ACTIVE | COMPLETED
  const [transition, setTransition] = useState(null); // { to, appliesAt } | null
  const [myResult, setMyResult] = useState(null); // my team's game_results row | null

  // Team identity — always from the authenticated user, never from the URL.
  const [team, setTeam] = useState(null); // { team_id, team_name } from GET /teams/:id
  const teamId = user?.team_id ?? null;

  const [code, setCode] = useState('');
  const [testOutcome, setTestOutcome] = useState(null); // { passed, passedCount, total, results } | null
  const [submitState, setSubmitState] = useState('idle'); // idle | running | passed | error
  const [submitError, setSubmitError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // A ticking clock drives countdown re-renders; the authoritative transition
  // still arrives via rlgl:state (this is display-only). The store snapshot is
  // an external "now" the render can read without calling an impure function.
  const nowMs = useSyncExternalStore(subscribeTicker, getTickerSnapshot);
  // Remaining whole seconds to the pending transition (display only). The chip
  // is hidden at 0 so the player never sees a stale "0s" while the server's
  // flip broadcast is in flight — the authoritative light change replaces it.
  const transitionSeconds = transition ? Math.max(0, Math.ceil((transition.appliesAt - nowMs) / 1000)) : 0;
  const transitionPending =
    Boolean(transition) &&
    roundStatus === 'ACTIVE' &&
    transitionSeconds > 0 &&
    // If the current light already equals the pending target, the transition
    // applied — never show a chip over the new state.
    light !== transition.to;

  const redLight = light === 'RED';
  // The editor is NEVER read-only during an ACTIVE round — RED LIGHT detects
  // illegal typing instead of preventing it. Only round lifecycle (non-ACTIVE)
  // locks the editor, and only the Reset/Run actions are disabled during RED.
  const roundInactive = roundStatus !== 'ACTIVE';
  const myStatus = myResult?.status; // PLAYING | WINNER | DISQUALIFIED | QUALIFIED

  // Tracks that THIS tab already reported a RED-light typing violation, so a
  // stream of keystrokes produces exactly one report (the server disqualified
  // the team on the first one). Reset when the round starts or the team is
  // reinstated — both arrive as rlgl:state (gameStatus ACTIVE) or rlgl:result
  // with a non-DISQUALIFIED status.
  const violationSent = useRef(false);
  useEffect(() => {
    if (roundStatus === 'ACTIVE' && myStatus !== 'DISQUALIFIED') {
      violationSent.current = false;
    }
  }, [roundStatus, myStatus]);

  // RED LIGHT monitors illegal typing instead of blocking the editor. While the
  // authoritative state is RED (and only then), any key the player types in the
  // editor is reported once to the backend; the backend validates team + state
  // and is the sole authority on disqualification. We do NOT require a locally
  // known result — a fresh page load has none until rlgl:result arrives, and
  // the backend still has the authoritative row.
  const reportViolation = useCallback(async () => {
    if (!redLight || roundStatus !== 'ACTIVE') return;
    if (myStatus === 'DISQUALIFIED' || myStatus === 'WINNER') return;
    if (violationSent.current) return;
    violationSent.current = true; // one report per RED phase
    const socket = getSocket();
    if (socket?.connected) {
      socket.emit('rlgl:violation', {}, (ack) => {
        if (!ack?.ok) violationSent.current = false; // rejected — allow retry
      });
    } else {
      // Socket down (tab just restored / reconnecting): fall back to the REST
      // endpoint so the violation still reaches the backend authoritatively.
      try {
        await api.post('/games/rlgl/violation');
      } catch {
        violationSent.current = false; // failed — allow retry
      }
    }
  }, [redLight, roundStatus, myStatus, violationSent]);
  useEffect(() => {
    const onKeyDown = (e) => {
      const target = e.target;
      // Only editor content typing counts. Monaco focuses a <textarea> inside
      // .monaco-editor — accept any element under that container. Modifier-only
      // chords are ignored.
      if (!target || target !== document.activeElement) return;
      if (!(target instanceof Element)) return;
      if (!target.closest('.monaco-editor')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'CapsLock') return;
      if (e.key.length === 1 || ['Backspace', 'Delete', 'Enter', 'Tab', 'Space'].includes(e.key)) {
        // NOTE: deliberately NO preventDefault() here. The keystroke must keep
        // flowing into Monaco so the player can type in every state (GREEN,
        // countdown, and RED). RED LIGHT detection reports the activity to the
        // backend; it must never swallow the input.
        reportViolation();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [reportViolation]);

  // Load authoritative state on mount + after every reconnect. /state now also
  // returns the caller's own result row, so a refresh during DISQUALIFIED /
  // WINNER restores the correct panel instead of showing a stale editor.
  const prevGameStatus = useRef(null);
  useEffect(() => {
    const fetchState = async () => {
      try {
        const data = await api.get('/games/rlgl/state');
        setProblem(data.problem);
        setLight(data.state.light);
        setRoundStatus(data.state.gameStatus);
        setTransition(data.state.transition);
        if (data.result) setMyResult(data.result);
        prevGameStatus.current = data.state.gameStatus;
        setLoadError('');
      } catch (err) {
        setLoadError(err.message || 'Could not load the RLGL arena');
      } finally {
        setLoading(false);
      }
    };
    fetchState();
    const offReconnect = onReconnect(fetchState);
    return () => offReconnect();
  }, []);

  // Fetch my team's name from the backend (own-team endpoint, ownership-enforced).
  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    api
      .get(`/teams/${teamId}`)
      .then(({ team: t }) => {
        if (!cancelled) setTeam(t);
      })
      .catch(() => {
        if (!cancelled) setTeam({ team_id: teamId, team_name: null });
      });
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  // Live socket updates (rlgl:state) + my team's result (rlgl:result).
  useEffect(() => {
    const offState = onEvent('rlgl:state', ({ state }) => {
      if (!state) return;
      const prev = prevGameStatus.current;
      prevGameStatus.current = state.gameStatus;
      setLight(state.light);
      setRoundStatus(state.gameStatus);
      setTransition(state.transition);
      // A genuine round restart (START ROUND: non-ACTIVE -> ACTIVE) resets every
      // team's result to PLAYING server-side but emits no per-team rlgl:result.
      // Drop a terminal result (WINNER/DISQUALIFIED) held from the previous
      // round so the editor returns. A light flip within an ACTIVE round keeps
      // the current result (a live DQ must not vanish).
      if (state.gameStatus === 'ACTIVE' && prev !== 'ACTIVE') {
        setMyResult(null);
      }
    });
    const offResult = onEvent('rlgl:result', ({ result }) => {
      if (result && String(result.team_id) === String(teamId)) setMyResult(result);
    });
    return () => {
      offState();
      offResult();
    };
  }, [teamId]);

  // When the round first becomes ACTIVE (or the problem first loads), prime
  // the editor with the starter code. Tracked via a ref so it happens once.
  const primedRound = useRef(null);
  useEffect(() => {
    if (!problem?.starterCode || code !== '') return;
    const key = `${roundStatus}:${problem.id}`;
    if (primedRound.current === key) return;
    primedRound.current = key;
    setCode(problem.starterCode);
  }, [roundStatus, problem, code]);

  const handleResetCode = () => {
    if (roundInactive) return;
    if (problem?.starterCode) setCode(problem.starterCode);
  };

  const handleRunTests = async () => {
    // Submitting is a deliberate click, NOT typing, so it is allowed during
    // both GREEN and RED while the round is ACTIVE (the backend re-validates).
    if (roundInactive || submitState === 'running') return;
    setSubmitState('running');
    setSubmitError('');
    setTestOutcome(null);
    try {
      const outcome = await api.post('/games/rlgl/submit', { code });
      setTestOutcome({
        passed: outcome.passed,
        passedCount: outcome.passedCount,
        total: outcome.total,
        results: outcome.results ?? [],
      });
      if (outcome.result) setMyResult(outcome.result);
      if (outcome.passed) setSubmitState('passed');
      else setSubmitState('error');
    } catch (err) {
      setSubmitError(err.message || 'Submission failed');
      setSubmitState('error');
      if (err.code === 'TEAM_DISQUALIFIED') {
        setMyResult({ status: 'DISQUALIFIED', team_id: teamId });
      }
    }
  };

  // ---------------- Rendering ----------------

  if (loading) {
    return (
      <div className="rlgl-page">
        <p className="rlgl-muted">Loading the arena…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rlgl-page">
        <div className="rlgl-state-panel rlgl-state-error">
          <h1>ARENA UNAVAILABLE</h1>
          <p>{loadError}</p>
          <button className="rlgl-btn" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!teamId) {
    return (
      <div className="rlgl-page">
        <div className="rlgl-state-panel">
          <h1>NO TEAM ASSIGNED</h1>
          <p>Your account is not linked to a team, so you cannot enter the arena.</p>
        </div>
      </div>
    );
  }

  const disqualified = myStatus === 'DISQUALIFIED';
  const finished = myStatus === 'WINNER' || roundStatus === 'COMPLETED';

  return (
    <div className={`rlgl-page ${redLight ? 'light-red' : 'light-green'}`}>
      {/* Thin header: brand + team + connection */}
      <header className="rlgl-topbar">
        <div className="rlgl-brand">
          <span className="rlgl-brand-mark">CRAFTVERSE</span>
          <span className="rlgl-brand-sep">/</span>
          <span className="rlgl-brand-game">RLGL</span>
        </div>
        <div className="rlgl-team">
          {team && (
            <>
              <span className="rlgl-team-id">TEAM {team.team_id}</span>
              {team.team_name && <span className="rlgl-team-name">{team.team_name}</span>}
            </>
          )}
          <span className={`rlgl-conn ${socketConnected ? 'live' : 'down'}`}>
            {socketConnected ? '● LIVE' : '○ RECONNECTING'}
          </span>
        </div>
      </header>

      {/* Light state strip — the single most important signal */}
      <section className={`rlgl-lightbar ${redLight ? 'is-red' : 'is-green'}`}>
        <div className="rlgl-light-indicator">
          <span className="rlgl-light-dot" />
          <span className="rlgl-light-label">
            {roundStatus === 'ACTIVE'
              ? redLight
                ? 'RED LIGHT'
                : 'GREEN LIGHT'
              : roundStatus === 'COMPLETED'
              ? 'ROUND COMPLETE'
              : 'STAND BY'}
          </span>
          {roundStatus === 'ACTIVE' && !disqualified && !finished && (
            <span className="rlgl-light-hint">{redLight ? 'STOP TYPING' : 'CODE NOW'}</span>
          )}
        </div>
      </section>

      {/* Floating corner countdown — fixed top-right, non-blocking, no modal.
          Only visible while a transition is genuinely pending (>0s remaining
          and the light has not yet reached the pending target). */}
      {transitionPending && (
        <div className="rlgl-countdown-chip" aria-live="polite">
          <span className="rlgl-countdown-label">STATE CHANGE IN</span>
          <span className={`rlgl-countdown-value ${transition.to === 'RED' ? 'to-red' : 'to-green'}`}>
            {transitionSeconds}s
          </span>
        </div>
      )}

      {disqualified ? (
        <div className="rlgl-state-panel rlgl-state-disqualified">
          <h1>DISQUALIFIED</h1>
          <p>
            Team {team?.team_name ?? teamId} — you are no longer eligible to
            participate in this round.
          </p>
        </div>
      ) : finished ? (
        <div className="rlgl-state-panel rlgl-state-complete">
          <h1>RLGL COMPLETE</h1>
          <p>Your team has finished the round.</p>
          {myStatus === 'WINNER' && (
            <p className="rlgl-state-ok">Cleared all test cases. Results are final.</p>
          )}
        </div>
      ) : (
        <main className="rlgl-main">
          {/* Problem panel */}
          <aside className="rlgl-problem">
            {!problem ? (
              <p className="rlgl-muted">The round problem has not been set yet.</p>
            ) : (
              <>
                <div className="rlgl-problem-head">
                  <h1 className="rlgl-problem-title">{problem.title}</h1>
                  <div className="rlgl-problem-meta">
                    {problem.domain && <span className="rlgl-chip">{problem.domain}</span>}
                    {problem.difficulty && (
                      <span className={`rlgl-chip rlgl-chip-${String(problem.difficulty).toLowerCase()}`}>
                        {problem.difficulty}
                      </span>
                    )}
                  </div>
                </div>

                {problem.description && (
                  <p className="rlgl-problem-desc">{problem.description}</p>
                )}

                {problem.testCases?.length > 0 && (
                  <div className="rlgl-examples">
                    <h2 className="rlgl-panel-label">EXAMPLES</h2>
                    {problem.testCases.map((tc, idx) => (
                      <div key={idx} className="rlgl-example">
                        <div className="rlgl-example-row">
                          <span className="rlgl-example-kind">Input</span>
                          <code>{tc.input.join(', ')}</code>
                        </div>
                        <div className="rlgl-example-row">
                          <span className="rlgl-example-kind">Expected</span>
                          <code>{tc.expected}</code>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </aside>

          {/* Editor panel */}
          <section className="rlgl-editor">
            <div className="rlgl-editor-head">
              <div className="rlgl-editor-tabs">
                <span className="rlgl-editor-tab active">solution.js</span>
              </div>
              <div className="rlgl-editor-actions">
                <button
                  className="rlgl-btn rlgl-btn-ghost"
                  onClick={handleResetCode}
                  disabled={roundInactive}
                >
                  Reset Code
                </button>
                <button
                  className="rlgl-btn rlgl-btn-run"
                  onClick={handleRunTests}
                  disabled={roundInactive || submitState === 'running'}
                  title="Run the round test cases against your code"
                >
                  {submitState === 'running' ? 'RUNNING…' : 'RUN TESTS'}
                </button>
              </div>
            </div>

            <div className="rlgl-editor-shell">
              <Editor
                height="100%"
                defaultLanguage="javascript"
                theme="vs-dark"
                value={code}
                onChange={(value) => {
                  setCode(value || '');
                }}
                options={{
                  // Read-only ONLY outside an ACTIVE round (WAITING/COMPLETED).
                  // During RED the editor stays editable — typing is monitored
                  // and reported to the backend instead of being blocked.
                  readOnly: roundInactive,
                  minimap: { enabled: false },
                  fontSize: 14,
                  fontFamily: "'Fira Code', 'Cascadia Code', monospace",
                  scrollBeyondLastLine: false,
                }}
              />
              {redLight && (
                <div className="rlgl-red-veil" aria-live="polite">
                  <span>RED LIGHT — DO NOT TYPE</span>
                </div>
              )}
            </div>

            {/* Submission feedback (only shown when the server actually ran tests) */}
            {(testOutcome || submitError) && (
              <div className="rlgl-submit-feedback">
                {testOutcome && (
                  <>
                    <div className="rlgl-submit-summary">
                      <span className={testOutcome.passed ? 'rlgl-pass' : 'rlgl-fail'}>
                        {testOutcome.passed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}
                      </span>
                      <span className="rlgl-muted">
                        {testOutcome.passedCount}/{testOutcome.total} passed
                      </span>
                    </div>
                    <div className="rlgl-test-list">
                      {testOutcome.results.map((r) => (
                        <div key={r.id} className={`rlgl-test-row ${r.passed ? 'pass' : 'fail'}`}>
                          <span>Test {r.id}</span>
                          <span>{r.passed ? 'PASSED' : 'FAILED'}</span>
                          {!r.passed && <code>expected {r.expected}</code>}
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {submitError && <p className="rlgl-submit-error">{submitError}</p>}
              </div>
            )}
          </section>
        </main>
      )}
    </div>
  );
}
