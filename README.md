Athena Desktop Exam App
Athena is an Electron desktop application for running a monitored exam. It uses a React renderer and an Electron main process to manage exam sessions, timing, camera snapshot requests, fullscreen/kiosk behavior, submissions, and feedback.
Features
- Loads exam questions from data/questions.json.
- Creates and stores exam sessions in the application's user-data directory.
- Validates submitted answers and calculates attempted, correct, and incorrect counts.
- Runs an exam timer and sends timer updates to the renderer.
- Requests webcam snapshots at regular intervals through the renderer.
- Saves received camera snapshot images locally.
- Uses fullscreen/kiosk mode and blocks selected keyboard shortcuts during an active exam.
- Shows confirmation flows for quitting or refreshing during an exam.
- Saves post-exam feedback with the submitted session.
Screen sharing and automatic screen screenshots every five seconds should be documented as available only after those features have been implemented and tested.

Project Structure
The exact structure may vary, but the files referenced by the current implementation include:
athena-desktop-app/
├── app/
│   ├── app.js          # Electron main process and IPC handlers
│   └── preload.js      # Secure bridge between renderer and main process
├── src/
│   ├── App.jsx         # React exam interface and renderer-side logic
│   └── App.css         # Interface styles
├── data/
│   └── questions.json  # Exam question data
├── dist/               # Production renderer build
└── package.json        # Scripts and dependencies


How It Works
1. Electron creates the application window and loads the development server or packaged renderer.
2. The renderer requests questions and creates an exam session through the preload API.
3. Starting the exam activates the timer and periodic camera snapshot requests.
4. Submitted answers are validated against the question data.
5. The session results are saved to sessions.json in Electron's user-data directory.
6. The student submits feedback; the feedback is saved to the session before the app exits.

Local Development
Install the project dependencies:
npm install

Start the renderer and Electron using the scripts configured in package.json. In the current development setup, the Electron main process loads the renderer from:
http://localhost:5173

Use the exact scripts defined in your package.json (for example, npm run dev and npm run electron if those scripts exist).

Data Storage
- Questions: data/questions.json
- Exam sessions: sessions.json inside Electron's application user-data directory
- Camera snapshots: user-camera-snap/ inside the application user-data directory
The application may create or update session records when it detects older records without a feedback field.

Security and Exam Controls
The Electron main process handles sensitive actions through IPC handlers, while preload.js exposes a limited API to the renderer. Keep contextIsolation enabled, avoid exposing ipcRenderer directly, and preserve input validation and exam-state checks when changing the code.

Fullscreen/kiosk behavior and shortcut blocking should be tested in both development and packaged builds. Operating-system permissions may affect camera or future screen-capture features.
