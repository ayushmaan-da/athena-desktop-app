import { useEffect, useRef, useState } from 'react'
import './App.css'

function formatTime(seconds) {
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  return [hours, minutes, remainingSeconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

function App() {
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [rulesDialogOpen, setRulesDialogOpen] = useState(false);
  const [rulesChecked, setRulesChecked] = useState(false);
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [examRulesOpen, setExamRulesOpen] = useState(false);
  const [timer, setTimer] = useState(0);
  const [screen, setScreen] = useState('setup');
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [sessionId, setSessionId] = useState('');
  const [result, setResult] = useState(null);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const videoRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const startGuardRef = useRef(false);
  const submitGuardRef = useRef(false);
  const snapshotInProgressRef = useRef(false);
  const kioskModeRef = useRef(false);
  const examRulesRef = useRef(null);

  useEffect(() => {
    if (!examRulesOpen) return undefined;

    const closeOnOutsideClick = (event) => {
      if (!examRulesRef.current?.contains(event.target)) {
        setExamRulesOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [examRulesOpen]);

  async function saveVideoScreenShots() {
    const track = cameraStreamRef.current?.getVideoTracks()[0];
    if (!track || track.readyState !== 'live' || snapshotInProgressRef.current) return;

    snapshotInProgressRef.current = true;
    try {
      const imageCapture = new ImageCapture(track);
      const blob = await imageCapture.takePhoto();
      const arrayBuffer = await blob.arrayBuffer();
      await window.athena.storeCameraSnapImageOnDisk(arrayBuffer);
    } catch (error) {
      console.error('Failed to capture image via ImageCapture:', error);
      setErrorMessage('A camera snapshot could not be saved. The exam can continue.');
    } finally {
      snapshotInProgressRef.current = false;
    }
  }

  useEffect(() => {
    const removeTimerTickListener = window.athena.registerListenerForTimerTickFromMain(setTimer);
    const removeCameraSnapListener = window.athena.registerListenerForCameraSnapFromMain(saveVideoScreenShots);
    const syncFullscreenState = () => {
      const isFullscreen = Boolean(document.fullscreenElement);
      setFullScreen(isFullscreen);
      if (!isFullscreen && kioskModeRef.current) {
        kioskModeRef.current = false;
        window.athena.setExamKioskOnMain(false).catch((error) => {
          console.error('Failed to exit exam kiosk mode:', error);
        });
      }
    };

    syncFullscreenState();
    document.addEventListener('fullscreenchange', syncFullscreenState);

    return () => {
      removeTimerTickListener();
      removeCameraSnapListener();
      document.removeEventListener('fullscreenchange', syncFullscreenState);
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      window.athena.stopTimerOnMain().catch((error) => {
        console.error('Failed to stop exam monitoring:', error);
      });
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
      console.error('Cannot access camera:', error);
      setErrorMessage('Cannot access the camera. Check the camera permission and try again.');
    }
  }

  async function enableFullScreen() {
    setErrorMessage('');
    try {
      await document.documentElement.requestFullscreen();
      setFullScreen(Boolean(document.fullscreenElement));
      await window.athena.setExamKioskOnMain(true);
      kioskModeRef.current = true;
    } catch (error) {
      console.error('Cannot enter fullscreen:', error);
      setErrorMessage('Cannot enable fullscreen. Try again and allow fullscreen mode.');
    }
  }

  async function startTest() {
    if (startGuardRef.current) return;
    startGuardRef.current = true;
    setStarting(true);
    setErrorMessage('');

    try {
      const loadedQuestions = await window.athena.loadExamQuestions();
      if (!Array.isArray(loadedQuestions) || loadedQuestions.length === 0) {
        throw new Error('No exam questions are available.');
      }

      const session = await window.athena.createExamSession();
      if (!session?.sessionId) throw new Error('The exam session could not be created.');

      setQuestions(loadedQuestions);
      setSessionId(session.sessionId);
      await window.athena.startTimerOnMain();
      setScreen('exam');
    } catch (error) {
      console.error('Failed to start exam:', error);
      setErrorMessage(`Could not start the exam: ${error.message || error}`);
    } finally {
      setStarting(false);
      startGuardRef.current = false;
    }
  }

  function selectAnswer(questionId, answerIndex) {
    setAnswers((currentAnswers) => ({ ...currentAnswers, [questionId]: answerIndex }));
  }

  async function submitExam() {
    if (submitGuardRef.current || !sessionId) return;
    submitGuardRef.current = true;
    setSubmitting(true);
    setErrorMessage('');

    try {
      const submittedAnswers = questions.map((question) => ({
        questionId: question.id,
        selectedAnswer: Object.hasOwn(answers, question.id) ? answers[question.id] : null,
      }));
      const finalResult = await window.athena.submitExam({ sessionId, answers: submittedAnswers });
      setResult(finalResult);
      setScreen('submitted');
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      if (kioskModeRef.current) {
        kioskModeRef.current = false;
        await window.athena.setExamKioskOnMain(false).catch((error) => {
          console.error('Failed to exit exam kiosk mode:', error);
          setErrorMessage('The exam was submitted, but kiosk mode could not be exited cleanly.');
        });
      }
      try {
        await window.athena.stopTimerOnMain();
      } catch (error) {
        console.error('Failed to stop exam monitoring:', error);
        setErrorMessage('The exam was submitted, but monitoring could not be stopped cleanly.');
      }
    } catch (error) {
      console.error('Failed to submit exam:', error);
      setErrorMessage(`Could not submit the exam: ${error.message || error}`);
    } finally {
      setSubmitting(false);
      submitGuardRef.current = false;
    }
  }

  const currentQuestion = questions[currentQuestionIndex];
  const attemptedCount = Object.keys(answers).length;

  return (
    <div className="page-container">
      {screen === 'setup' && (
        <>
          <header className="header-section">
            <h1>Athena</h1>
            <p>Complete the setup below before starting your test.</p>
          </header>

          <div className="card-container">
            <div className="permission-item camera-permission">
              <div className="permission-content">
                <h3>Configure Camera</h3>
                <p>Kindly configure Camera to attempt quiz/contests.</p>
                <div className="action-row">
                  <button
                    className="btn camera-access-button"
                    disabled={cameraEnabled}
                    onClick={getCameraAccess}
                  >
                    {cameraEnabled ? 'Camera Connected' : 'Get Camera Access'}
                  </button>
                </div>
              </div>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                aria-hidden="true"
                className={`video-preview${cameraEnabled ? ' video-preview-visible' : ''}`}
              />
            </div>

            <div className="divider" />

            <div className="permission-item">
              <div className="permission-content">
                <h3>Switch to full screen</h3>
                <p>Fullscreen must stay enabled to begin the test.</p>
                <button
                  className="btn btn-primary"
                  disabled={fullScreen}
                  onClick={enableFullScreen}
                >
                  {fullScreen ? 'Full Screen Enabled' : 'Give Full Screen Permissions'}
                </button>
              </div>
            </div>

          </div>

          <div className="bottom-actions">
            <button
              className="btn start-test-button"
              disabled={!cameraEnabled || !fullScreen || starting}
              onClick={startTest}
            >
              {starting ? 'Starting Test…' : 'Start Test'}
            </button>
          </div>

          <div className="setup-extras">
            <button
              className="btn exam-nav-button"
              onClick={() => {
                setRulesChecked(rulesAccepted);
                setRulesDialogOpen(true);
              }}
            >
              Rules
            </button>
          </div>

          {rulesDialogOpen && (
            <div className="dialog-backdrop">
              <section
                className="rules-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="rules-dialog-title"
              >
                <h2 id="rules-dialog-title">Exam Rules</h2>
                <ol>
                  <li>Stay on the exam screen.</li>
                  <li>Camera must remain enabled.</li>
                  <li>Do not leave the exam.</li>
                  <li>Do not use external assistance.</li>
                  <li>Click Exit Exam when finished.</li>
                </ol>
                <label className="rules-checkbox">
                  <input
                    type="checkbox"
                    checked={rulesChecked}
                    onChange={(event) => setRulesChecked(event.target.checked)}
                  />
                  <span>I have read and agree to these rules</span>
                </label>
                <div className="dialog-actions">
                  <button
                    className="btn exam-nav-button"
                    onClick={() => setRulesDialogOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn"
                    disabled={!rulesChecked}
                    onClick={() => {
                      setRulesAccepted(true);
                      setRulesDialogOpen(false);
                    }}
                  >
                    Accept
                  </button>
                </div>
              </section>
            </div>
          )}
        </>
      )}

      {screen === 'exam' && currentQuestion && (
        <section className="exam-screen">
          <header className="exam-header">
            <div>
              <h1>Exam</h1>
              <p>Question {currentQuestionIndex + 1} of {questions.length}</p>
            </div>
            <div className="exam-progress" aria-live="polite">
              <span>{formatTime(timer)}</span>
            </div>
          </header>

          <div className="card-container question-card">
            <div className="question-card-topbar">
              <div className="exam-rules-control">
                <button
                  className="exam-rules-info-button"
                  type="button"
                  aria-label="Show exam rules"
                  aria-expanded={examRulesOpen}
                  onClick={() => setExamRulesOpen(true)}
                >
                  i
                </button>
              </div>
              <button
                className="btn submit-exam-button"
                disabled={submitting}
                onClick={submitExam}
              >
                {submitting ? 'Submitting…' : 'Submit Exam'}
              </button>
            </div>

            {examRulesOpen && (
              <div
                className="exam-rules-overlay"
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) setExamRulesOpen(false);
                }}
              >
                <div
                  className="exam-rules-popover"
                  ref={examRulesRef}
                  role="dialog"
                  aria-label="Exam Rules"
                >
                  <h2>Exam Rules</h2>
                  <ol>
                    <li>Stay on the exam screen.</li>
                    <li>Camera must remain enabled.</li>
                    <li>Do not leave the exam.</li>
                    <li>Do not use external assistance.</li>
                    <li>Click Exit Exam when finished.</li>
                  </ol>
                </div>
              </div>
            )}

            <div className="question-body">
              <p className="question-count">Question {currentQuestionIndex + 1}</p>
              <h2>{currentQuestion.question}</h2>
              <div className="answer-options">
                {currentQuestion.options.map((option, index) => (
                  <label className="answer-option" key={`${currentQuestion.id}-${index}`}>
                    <input
                      type="radio"
                      name={`question-${currentQuestion.id}`}
                      value={index}
                      checked={answers[currentQuestion.id] === index}
                      disabled={submitting}
                      onChange={() => selectAnswer(currentQuestion.id, index)}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="question-card-footer">
              <button
                className="btn exam-nav-button"
                disabled={currentQuestionIndex === 0 || submitting}
                onClick={() => setCurrentQuestionIndex((index) => index - 1)}
              >
                Previous
              </button>
              <p className="answered-counter" aria-live="polite">
                {attemptedCount} of {questions.length} answered
              </p>
              {currentQuestionIndex < questions.length - 1 ? (
                <button
                  className="btn exam-nav-button"
                  disabled={submitting}
                  onClick={() => setCurrentQuestionIndex((index) => index + 1)}
                >
                  Next
                </button>
              ) : <span className="question-footer-spacer" />}
            </div>
          </div>
        </section>
      )}

      {screen === 'submitted' && result && (
        <section className="result-screen">
          <div className="card-container">
            <p className="question-count">Exam submitted</p>
            <h1>Your score</h1>
            <p className="final-score">{result.correct} / {result.total}</p>
            <p>{result.attempted} attempted · {result.correct} correct · {result.wrong} wrong</p>
          </div>
        </section>
      )}

      {errorMessage && <p className="error-message" role="alert">{errorMessage}</p>}
    </div>
  );
}

export default App
