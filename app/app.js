
import { app, BrowserWindow, ipcMain } from "electron";
import { randomUUID } from "crypto";
import { Buffer } from "buffer";
import { platform } from "os";
import path from "path";
import fs from "fs";

let win, startTime, timer, cameraTimer, activeSessionId = null;
let quitConfirmationOpen = false;
let refreshConfirmationOpen = false;
let examActive = false;
let feedbackPendingSessionId = null;
let feedbackWriteInProgress = false;
let approvedQuit = false;
const storageFolder = path.join(app.getPath("userData"), "user-camera-snap");
fs.mkdirSync(storageFolder, { recursive: true });

const data = path.join(import.meta.dirname, "../data");
const questionsFile = path.join(data, "questions.json");
const sessionsFile = path.join(app.getPath("userData"), "sessions.json");

console.log("User data directory:", app.getPath("userData"));
console.log("Snapshot directory:", storageFolder);
console.log("Sessions file:", sessionsFile);



const readJSON = async (file, fallback) => {
    try {
        return JSON.parse(await fs.promises.readFile(file, "utf8"));
    } catch (e) {
        if (e.code === "ENOENT" && fallback !== undefined) return fallback;
        throw e;
    }
};
if (!fs.existsSync(sessionsFile)) {
    fs.writeFileSync(sessionsFile, "[]");
}

const readQuestions = () => readJSON(questionsFile);
const readSessions = async () => {
    const sessions = await readJSON(sessionsFile, []);
    const needsFeedbackField = sessions.some(session =>
        !Object.hasOwn(session, "feedback")
    );
    if (needsFeedbackField) {
        for (const session of sessions) {
            if (!Object.hasOwn(session, "feedback")) session.feedback = null;
        }
        await writeSessions(sessions);
    }
    return sessions;
};
const writeSessions = s =>
    fs.promises.writeFile(sessionsFile, JSON.stringify(s, null, 2));

function stopMonitoring() {
    clearInterval(timer);
    clearInterval(cameraTimer);
    timer = cameraTimer = startTime = null;
}

function requestQuitConfirmation() {
    if (!examActive || feedbackPendingSessionId || quitConfirmationOpen ||
        refreshConfirmationOpen || !win || win.isDestroyed()) return;
    quitConfirmationOpen = true;
    win.webContents.send("quit-confirmation-requested");
}

function requestRefreshConfirmation() {
    if (!examActive || feedbackPendingSessionId || quitConfirmationOpen ||
        refreshConfirmationOpen || !win || win.isDestroyed()) return;
    refreshConfirmationOpen = true;
    win.webContents.send("refresh-confirmation-requested");
}

function createWindow() {
    win = new BrowserWindow({
        width: 1000,
        height: 1000,
        webPreferences: {
            devTools: true,
            preload: path.join(import.meta.dirname, "preload.js")
        }
    });

    win.on("closed", () => {
        stopMonitoring();
        win = null;
    });

    win.on("close", event => {
        if (!examActive || approvedQuit) return;
        event.preventDefault();
        requestQuitConfirmation();
    });

    win.webContents.on("before-input-event", (event, input) => {
        if (input.type !== "keyDown" || !examActive) return;

        const key = input.key.toLowerCase();
        const escapeKey = key === "escape" || key === "esc";
        const isMac = platform() === "darwin";
        const modifier = isMac ? input.meta : input.control;
        const quitShortcut = modifier && key === "q";
        const refreshShortcut = input.key === "F5" || (modifier && key === "r");
        const blockedShortcut = escapeKey || input.key === "F11" ||
            (input.alt && key === "f4") || (modifier && key === "w") ||
            (isMac && input.meta && input.control && key === "f");

        if (!quitShortcut && !refreshShortcut && !blockedShortcut) return;
        event.preventDefault();

        if (feedbackPendingSessionId) return;
        if (escapeKey) return;
        if (quitShortcut) requestQuitConfirmation();
        else if (refreshShortcut) requestRefreshConfirmation();
    });

    if (app.isPackaged) {
        win.loadFile(path.join(app.getAppPath(), "dist/index.html"));
    } else {
        win.loadURL("http://localhost:5173");
    }
}

ipcMain.handle("set-exam-kiosk", (_e, enabled) => {
    if (typeof enabled !== "boolean" || !win || win.isDestroyed())
        throw new Error("Invalid kiosk mode request.");
    if (!enabled && examActive)
        throw new Error("Cannot disable fullscreen during an active exam.");
    win.setKiosk(enabled);
    return win.isKiosk();
});

ipcMain.handle("respond-to-quit-confirmation", (_e, quit) => {
    if (typeof quit !== "boolean") throw new Error("Invalid response.");
    if (quit && feedbackPendingSessionId)
        throw new Error("Feedback must be submitted before quitting.");
    quitConfirmationOpen = false;
    if (quit) {
        approvedQuit = true;
        app.quit();
    }
    return true;
});

ipcMain.handle("respond-to-refresh-confirmation", (_e, shouldRefresh) => {
    if (typeof shouldRefresh !== "boolean" || !refreshConfirmationOpen)
        throw new Error("Invalid refresh response.");
    refreshConfirmationOpen = false;
    if (shouldRefresh) {
        examActive = false;
        stopMonitoring();
        if (win && !win.isDestroyed() && win.isKiosk()) win.setKiosk(false);
        win.webContents.reload();
    }
    return true;
});

ipcMain.handle("load-exam-questions", async () =>
    (await readQuestions()).map(({ id, question, options }) =>
        ({ id, question, options })
    )
);

ipcMain.handle("create-exam-session", async () => {
    const sessions = await readSessions();
    const existing = sessions.find(s =>
        s.sessionId === activeSessionId && s.status === "in-progress"
    );

    if (existing) return { sessionId: existing.sessionId };

    const session = {
        sessionId: `session-${randomUUID()}`,
        userId: 1, name: "Student",
        startedAt: new Date().toISOString(),
        submittedAt: null, status: "in-progress",
        attempted: 0, correct: 0, wrong: 0, answers: [], feedback: null
    };

    sessions.push(session);
    await writeSessions(sessions);
    activeSessionId = session.sessionId;
    return { sessionId: session.sessionId };
});

ipcMain.handle("submit-exam", async (_e, submission) => {
    if (!submission || typeof submission.sessionId !== "string" ||
        !Array.isArray(submission.answers))
        throw new Error("Invalid submission.");

    const [questions, sessions] = await Promise.all([
        readQuestions(), readSessions()
    ]);
    const session = sessions.find(s => s.sessionId === submission.sessionId);
    if (!session) throw new Error("Session not found.");

    if (session.status === "submitted") {
        if (session.feedback == null) feedbackPendingSessionId = session.sessionId;
        return {
            attempted: session.attempted, correct: session.correct,
            wrong: session.wrong, total: questions.length
        };
    }
    if (session.status !== "in-progress") throw new Error("Invalid session.");

    const submitted = new Map();
    for (const a of submission.answers) {
        if (!a || !["string", "number"].includes(typeof a.questionId) ||
            submitted.has(a.questionId))
            throw new Error("Invalid or duplicate answer.");
        submitted.set(a.questionId, a.selectedAnswer);
    }

    if ([...submitted.keys()].some(id => !questions.some(q => q.id === id)))
        throw new Error("Unknown question.");

    let attempted = 0, correct = 0;
    session.answers = questions.map(q => {
        const selectedAnswer = submitted.has(q.id) ? submitted.get(q.id) : null;

        if (selectedAnswer !== null &&
            (!Number.isInteger(selectedAnswer) || selectedAnswer < 0 ||
             selectedAnswer >= q.options.length))
            throw new Error("Invalid answer option.");

        const isCorrect = selectedAnswer !== null &&
            selectedAnswer === q.correctAnswer;
        if (selectedAnswer !== null) attempted++;
        if (isCorrect) correct++;

        return { questionId: q.id, selectedAnswer, correct: isCorrect };
    });

    Object.assign(session, {
        attempted, correct, wrong: attempted - correct,
        submittedAt: new Date().toISOString(), status: "submitted"
    });

    await writeSessions(sessions);
    if (activeSessionId === session.sessionId) activeSessionId = null;
    feedbackPendingSessionId = session.sessionId;
    return { attempted, correct, wrong: attempted - correct, total: questions.length };
});

ipcMain.handle("submit-exam-feedback", async (_e, feedback) => {
    if (!feedback || typeof feedback.sessionId !== "string" ||
        !Number.isInteger(feedback.rating) || feedback.rating < 1 ||
        feedback.rating > 5)
        throw new Error("A valid feedback rating from 1 to 5 is required.");
    if (feedback.sessionId !== feedbackPendingSessionId)
        throw new Error("Feedback does not match the submitted exam session.");
    if (feedbackWriteInProgress) throw new Error("Feedback is already being saved.");

    feedbackWriteInProgress = true;
    try {
        const sessions = await readSessions();
        const session = sessions.find(s => s.sessionId === feedback.sessionId);
        if (!session || session.status !== "submitted")
            throw new Error("Submitted exam session not found.");
        if (session.feedback != null)
            throw new Error("Feedback has already been saved for this session.");

        session.feedback = { rating: feedback.rating };
        await writeSessions(sessions);

        feedbackPendingSessionId = null;
        examActive = false;
        approvedQuit = true;
        app.quit();
        return true;
    } finally {
        feedbackWriteInProgress = false;
    }
});

ipcMain.handle("start-timer", () => {
    examActive = true;
    if (timer || cameraTimer) return true;
    startTime = Date.now();

    timer = setInterval(() => {
        if (win && !win.isDestroyed())
            win.webContents.send("timer", (Date.now() - startTime) / 1000);
    }, 1000);

    cameraTimer = setInterval(() => {
        if (win && !win.isDestroyed())
            win.webContents.send("camera-shot");
    }, 5000);

    return true;
});

ipcMain.handle("stop-timer", () => {
    stopMonitoring();
    return true;
});

ipcMain.handle("store-camera-snap-image-on-disk", async (_e, bytes) => {
    if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes))
        throw new Error("Invalid snapshot data.");

    await fs.promises.writeFile(
        path.join(storageFolder, `${Date.now()}.jpg`), Buffer.from(bytes)
    );
    return true;
});

app.whenReady().then(createWindow);
app.on("before-quit", event => {
    if (examActive && !approvedQuit) {
        event.preventDefault();
        requestQuitConfirmation();
        return;
    }
    quitConfirmationOpen = false;
    refreshConfirmationOpen = false;
    stopMonitoring();
    if (win && !win.isDestroyed() && win.isKiosk()) win.setKiosk(false);
});
