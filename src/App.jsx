
import { useEffect, useRef, useState } from 'react';
import './App.css';

const EXAM_RULES = [
  'Stay on the exam screen.',
  'Camera must remain enabled.',
  'Do not leave the exam.',
  'Do not use external assistance.',
  'Click Exit Exam when finished.'
];

function formatTime(seconds) {
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, Math.floor(seconds) % 60]
    .map(value => String(value).padStart(2, '0')).join(':');
}

function RulesList() {
  return <ol>{EXAM_RULES.map(rule => <li key={rule}>{rule}</li>)}</ol>;
}

function App() {
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [rulesDialogOpen, setRulesDialogOpen] = useState(false);
  const [rulesChecked, setRulesChecked] = useState(false);
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [examRulesOpen, setExamRulesOpen] = useState(false);
  const [quitConfirmationOpen, setQuitConfirmationOpen] = useState(false);
  const [refreshConfirmationOpen, setRefreshConfirmationOpen] = useState(false);
  const [submitConfirmationOpen, setSubmitConfirmationOpen] = useState(false);
  const [timer, setTimer] = useState(0);
  const [screen, setScreen] = useState('setup');
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [sessionId, setSessionId] = useState('');
  const [result, setResult] = useState(null);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [feedbackError, setFeedbackError] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const videoRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const startGuardRef = useRef(false);
  const submitGuardRef = useRef(false);
  const feedbackGuardRef = useRef(false);
  const snapshotInProgressRef = useRef(false);
  const examRulesRef = useRef(null);

  useEffect(() => {
    return window.athena.registerListenerForQuitConfirmation(
      () => setQuitConfirmationOpen(true)
    );
  }, []);

  useEffect(() => {
    return window.athena.registerListenerForRefreshConfirmation(
      () => setRefreshConfirmationOpen(true)
    );
  }, []);

  useEffect(() => {
    if (!examRulesOpen) return;

    const close = event => {
      if (!examRulesRef.current?.contains(event.target)) setExamRulesOpen(false);
    };

    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [examRulesOpen]);

  async function saveVideoScreenShots() {
    const track = cameraStreamRef.current?.getVideoTracks()[0];
    if (!track || track.readyState !== 'live' || snapshotInProgressRef.current) return;

    snapshotInProgressRef.current = true;
    try {
      const blob = await new ImageCapture(track).takePhoto();
      await window.athena.storeCameraSnapImageOnDisk(await blob.arrayBuffer());
    } catch (error) {
      console.error('Snapshot failed:', error);
      setErrorMessage('A camera snapshot could not be saved. The exam can continue.');
    } finally {
      snapshotInProgressRef.current = false;
    }
  }

  function stopCamera() {
    cameraStreamRef.current?.getTracks().forEach(track => track.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  useEffect(() => {
    const removeTimer = window.athena.registerListenerForTimerTickFromMain(setTimer);
    const removeCamera = window.athena.registerListenerForCameraSnapFromMain(saveVideoScreenShots);

    return () => {
      removeTimer();
      removeCamera();
      stopCamera();
      window.athena.stopTimerOnMain().catch(console.error);
    };
  }, []);

  async function getCameraAccess() {
    setErrorMessage('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      cameraStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraEnabled(true);
    } catch (error) {
      console.error(error);
      setErrorMessage('Cannot access the camera. Check the camera permission and try again.');
    }
  }

  async function enableFullScreen() {
    setErrorMessage('');
    try {
      const enabled = await window.athena.setExamKioskOnMain(true);
      setFullScreen(enabled);
    } catch (error) {
      console.error(error);
      setErrorMessage('Cannot enable fullscreen. Try again and allow fullscreen mode.');
    }
  }

  async function startTest() {
    if (startGuardRef.current) return;
    startGuardRef.current = true;
    setStarting(true);
    setErrorMessage('');

    try {
      const loaded = await window.athena.loadExamQuestions();
      if (!Array.isArray(loaded) || !loaded.length) throw new Error('No exam questions are available.');

      const session = await window.athena.createExamSession();
      if (!session?.sessionId) throw new Error('The exam session could not be created.');

      setQuestions(loaded);
      setSessionId(session.sessionId);
      await window.athena.startTimerOnMain();
      setScreen('exam');
    } catch (error) {
      console.error(error);
      setErrorMessage(`Could not start the exam: ${error.message || error}`);
    } finally {
      setStarting(false);
      startGuardRef.current = false;
    }
  }

  function selectAnswer(id, index) {
    setAnswers(current => ({ ...current, [id]: index }));
  }

  async function submitExam() {
    if (submitGuardRef.current || !sessionId) return;
    submitGuardRef.current = true;
    setSubmitting(true);
    setErrorMessage('');

    try {
      const submittedAnswers = questions.map(q => ({
        questionId: q.id,
        selectedAnswer: Object.hasOwn(answers, q.id) ? answers[q.id] : null
      }));

      const finalResult = await window.athena.submitExam({ sessionId, answers: submittedAnswers });
      setResult(finalResult);
      setScreen('submitted');
      stopCamera();

      try {
        await window.athena.stopTimerOnMain();
      } catch (error) {
        console.error(error);
        setErrorMessage('The exam was submitted, but monitoring could not be stopped cleanly.');
      }
    } catch (error) {
      console.error(error);
      setErrorMessage(`Could not submit the exam: ${error.message || error}`);
    } finally {
      setSubmitting(false);
      submitGuardRef.current = false;
    }
  }

  function requestSubmitConfirmation() {
    if (!submitting && !submitGuardRef.current && !submitConfirmationOpen) {
      setSubmitConfirmationOpen(true);
    }
  }

  async function respondToRefresh(shouldRefresh) {
    try {
      await window.athena.respondToRefreshConfirmation(shouldRefresh);
      setRefreshConfirmationOpen(false);
    } catch (error) {
      console.error(error);
      setRefreshConfirmationOpen(false);
      setErrorMessage('Could not process the refresh request. Please try again.');
    }
  }

  async function submitFeedback() {
    if (!feedbackRating || feedbackGuardRef.current || !sessionId) return;
    feedbackGuardRef.current = true;
    setFeedbackSaving(true);
    setFeedbackError('');

    try {
      await window.athena.submitExamFeedback({ sessionId, rating: feedbackRating });
    } catch (error) {
      console.error(error);
      setFeedbackError(`Could not save feedback: ${error.message || error}`);
    } finally {
      setFeedbackSaving(false);
      feedbackGuardRef.current = false;
    }
  }

  async function respondToQuit(quit) {
    try {
      await window.athena.respondToQuitConfirmation(quit);
      if (!quit) setQuitConfirmationOpen(false);
    } catch (error) {
      console.error(error);
      setQuitConfirmationOpen(false);
      setErrorMessage('Could not process the quit request. Please try again.');
    }
  }

  const currentQuestion = questions[currentQuestionIndex];
  const attemptedCount = Object.keys(answers).length;

  return (
    <div className={`page-container${screen === 'exam' ? ' exam-active' : ''}`}>
      {screen === 'setup' && <>
        <header className="header-section">
          <h1>Athena</h1>
          <p>Complete the setup below before starting your test.</p>
        </header>

        <div className="card-container">
          <div className="permission-item camera-permission">
            <div className="permission-content">
              <h3>Configure Camera</h3>
              <p>Kindly configure Camera to attempt quiz/contests.</p>
              <button className="btn camera-access-button" disabled={cameraEnabled} onClick={getCameraAccess}>
                {cameraEnabled ? 'Camera Connected' : 'Get Camera Access'}
              </button>
            </div>
            <video ref={videoRef} autoPlay playsInline muted aria-hidden="true"
              className={`video-preview${cameraEnabled ? ' video-preview-visible' : ''}`} />
          </div>

          <div className="divider" />

          <div className="permission-item">
            <div className="permission-content">
              <h3>Switch to full screen</h3>
              <p>Fullscreen must stay enabled to begin the test.</p>
              <button className="btn btn-primary" disabled={fullScreen} onClick={enableFullScreen}>
                {fullScreen ? 'Full Screen Enabled' : 'Give Full Screen Permissions'}
              </button>
            </div>
          </div>
        </div>

        <div className="bottom-actions">
          <button className="btn start-test-button" disabled={!cameraEnabled || !fullScreen || starting} onClick={startTest}>
            {starting ? 'Starting Test…' : 'Start Test'}
          </button>
        </div>

        <div className="setup-extras">
          <button className="btn exam-nav-button" onClick={() => {
            setRulesChecked(rulesAccepted);
            setRulesDialogOpen(true);
          }}>Rules</button>
        </div>

        {rulesDialogOpen && <div className="dialog-backdrop">
          <section className="rules-dialog" role="dialog" aria-modal="true" aria-labelledby="rules-title">
            <h2 id="rules-title">Exam Rules</h2>
            <RulesList />
            <label className="rules-checkbox">
              <input type="checkbox" checked={rulesChecked} onChange={e => setRulesChecked(e.target.checked)} />
              <span>I have read and agree to these rules</span>
            </label>
            <div className="dialog-actions">
              <button className="btn exam-nav-button" onClick={() => setRulesDialogOpen(false)}>Cancel</button>
              <button className="btn" disabled={!rulesChecked} onClick={() => {
                setRulesAccepted(true);
                setRulesDialogOpen(false);
              }}>Accept</button>
            </div>
          </section>
        </div>}
      </>}

      {screen === 'exam' && currentQuestion && <section className="exam-screen">
        <header className="exam-header">
          <div>
            <h1>Exam</h1>
            <p>Question {currentQuestionIndex + 1} of {questions.length}</p>
          </div>
          <div className="exam-header-actions">
            <div className="exam-progress"><span>{formatTime(timer)}</span></div>
            <button className="btn submit-exam-button" disabled={submitting} onClick={requestSubmitConfirmation}>
              {submitting ? 'Submitting…' : 'Submit Exam'}
            </button>
          </div>
        </header>

        <div className="card-container question-card">
          <div className="question-card-topbar">
            <button className="exam-rules-info-button" type="button" aria-label="Show exam rules"
              aria-expanded={examRulesOpen} onClick={() => setExamRulesOpen(!examRulesOpen)}>i</button>
          </div>

          {examRulesOpen && <div className="exam-rules-overlay">
            <div className="exam-rules-popover" ref={examRulesRef} role="dialog" aria-label="Exam Rules">
              <h2>Exam Rules</h2>
              <RulesList />
            </div>
          </div>}

          <div className="question-body">
            <p className="question-count">Question {currentQuestionIndex + 1}</p>
            <h2>{currentQuestion.question}</h2>
            <div className="answer-options">
              {currentQuestion.options.map((option, index) => <label className="answer-option" key={`${currentQuestion.id}-${index}`}>
                <input type="radio" name={`question-${currentQuestion.id}`} value={index}
                  checked={answers[currentQuestion.id] === index} disabled={submitting}
                  onChange={() => selectAnswer(currentQuestion.id, index)} />
                <span>{option}</span>
              </label>)}
            </div>
          </div>

          <div className="question-card-footer">
            <p className="answered-counter" aria-live="polite">{attemptedCount} of {questions.length} answered</p>
          </div>
        </div>
        <div className="exam-fixed-navigation">
          <button className="btn exam-nav-button" disabled={currentQuestionIndex === 0 || submitting}
            onClick={() => setCurrentQuestionIndex(i => i - 1)}>Previous</button>
          {currentQuestionIndex < questions.length - 1 && (
            <button className="btn exam-nav-button" disabled={submitting}
              onClick={() => setCurrentQuestionIndex(i => i + 1)}>Next</button>
          )}
        </div>
      </section>}

      {quitConfirmationOpen && <div className="quit-dialog-backdrop">
        <section className="quit-dialog" role="alertdialog" aria-modal="true" aria-labelledby="quit-title">
          <h2 id="quit-title">Are you sure you want to quit the exam?</h2>
          <div className="quit-dialog-actions">
            <button className="btn quit-no-button" onClick={() => respondToQuit(false)}>No</button>
            <button className="btn exam-nav-button" onClick={() => respondToQuit(true)}>Yes</button>
          </div>
        </section>
      </div>}

      {refreshConfirmationOpen && <div className="quit-dialog-backdrop">
        <section className="quit-dialog" role="alertdialog" aria-modal="true" aria-labelledby="refresh-title">
          <h2 id="refresh-title">Are you sure you want to refresh the exam?</h2>
          <div className="quit-dialog-actions">
            <button className="btn quit-no-button" onClick={() => respondToRefresh(false)}>No</button>
            <button className="btn exam-nav-button" onClick={() => respondToRefresh(true)}>Yes</button>
          </div>
        </section>
      </div>}

      {submitConfirmationOpen && <div className="quit-dialog-backdrop"
        onClick={event => {
          if (event.target === event.currentTarget) setSubmitConfirmationOpen(false);
        }}>
        <section className="quit-dialog" role="alertdialog" aria-modal="true" aria-labelledby="submit-title">
          <h2 id="submit-title">Are you sure you want to submit the exam?</h2>
          <div className="quit-dialog-actions">
            <button className="btn quit-no-button" onClick={() => setSubmitConfirmationOpen(false)}>No</button>
            <button className="btn exam-nav-button" disabled={submitting} onClick={async () => {
              setSubmitConfirmationOpen(false);
              await submitExam();
            }}>Yes</button>
          </div>
        </section>
      </div>}

      {screen === 'submitted' && result && <section className="result-screen">
        <div className="card-container">
          <p className="question-count">Exam submitted</p>
          <h1>Your score</h1>
          <p className="final-score">{result.correct} / {result.total}</p>
          <p>{result.attempted} attempted · {result.correct} correct · {result.wrong} wrong</p>
        </div>
      </section>}

      {screen === 'submitted' && result && <div className="quit-dialog-backdrop">
        <section className="quit-dialog feedback-dialog" role="dialog" aria-modal="true"
          aria-labelledby="feedback-title">
          <h2 id="feedback-title">Rate Your Exam Experience</h2>
          <p className="feedback-prompt">Select a rating from 1 to 5 stars.</p>
          <div className="feedback-stars" role="radiogroup" aria-label="Exam experience rating"
            aria-required="true">
            {[1, 2, 3, 4, 5].map(rating => (
              <button key={rating} type="button" role="radio" aria-checked={feedbackRating === rating}
                aria-label={`${rating} ${rating === 1 ? 'star' : 'stars'}`}
                className={`feedback-star${feedbackRating >= rating ? ' selected' : ''}`}
                onClick={() => setFeedbackRating(rating)}>★</button>
            ))}
          </div>
          {feedbackError && <p className="feedback-error" role="alert">{feedbackError}</p>}
          <div className="quit-dialog-actions">
            <button className="btn submit-exam-button" disabled={!feedbackRating || feedbackSaving}
              onClick={submitFeedback}>
              {feedbackSaving ? 'Saving…' : 'Submit Feedback & Quit'}
            </button>
          </div>
        </section>
      </div>}

      {errorMessage && <p className="error-message" role="alert">{errorMessage}</p>}
    </div>
  );
}

export default App;
