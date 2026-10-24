
import { app, BrowserWindow, ipcMain } from "electron";
import { randomUUID } from "crypto";
import { Buffer } from "buffer";
import { platform } from "os";
import path from "path";
import fs from "fs";

let win, startTime, timer, cameraTimer, activeSessionId = null;
let quitConfirmationOpen = false;
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
const readSessions = () => readJSON(sessionsFile, []);
const writeSessions = s =>
    fs.promises.writeFile(sessionsFile, JSON.stringify(s, null, 2));

function stopMonitoring() {
    clearInterval(timer);
    clearInterval(cameraTimer);
    timer = cameraTimer = startTime = null;
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

    win.webContents.on("before-input-event", (event, input) => {
        if (platform() === "darwin" && input.type === "keyDown" &&
            input.meta && input.key.toLowerCase() === "q") {
            event.preventDefault();
            if (!quitConfirmationOpen && win && !win.isDestroyed()) {
                quitConfirmationOpen = true;
                win.webContents.send("quit-confirmation-requested");
            }
        }
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
    win.setKiosk(enabled);
    return win.isKiosk();
});

ipcMain.handle("respond-to-quit-confirmation", (_e, quit) => {
    if (typeof quit !== "boolean") throw new Error("Invalid response.");
    quitConfirmationOpen = false;
    if (quit) app.quit();
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
        attempted: 0, correct: 0, wrong: 0, answers: []
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

    if (session.status === "submitted")
        return {
            attempted: session.attempted, correct: session.correct,
            wrong: session.wrong, total: questions.length
        };
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
    return { attempted, correct, wrong: attempted - correct, total: questions.length };
});

ipcMain.handle("start-timer", () => {
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
app.on("before-quit", () => {
    quitConfirmationOpen = false;
    stopMonitoring();
    if (win && !win.isDestroyed() && win.isKiosk()) win.setKiosk(false);
});
