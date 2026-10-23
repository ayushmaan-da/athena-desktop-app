
import { app, BrowserWindow, ipcMain } from "electron";
import { randomUUID } from "crypto";
import { Buffer } from "buffer";
import { platform } from "os";
import path from "path";
import fs from "fs";

let electronWindow = null, startTimestamp = null;
let timer = null, cameraTimer = null, activeSessionId = null;
let storageFolder = path.join(import.meta.dirname, "user-camera-snap");

const dataFolder = path.resolve(import.meta.dirname, "../data");
const questionsFile = path.join(dataFolder, "questions.json");
const sessionsFile = path.join(dataFolder, "sessions.json");

fs.mkdirSync(storageFolder, { recursive: true });

const readJSON = async (file, fallback) => {
    try {
        return JSON.parse(await fs.promises.readFile(file, "utf8"));
    } catch (e) {
        if (e.code === "ENOENT" && fallback !== undefined) return fallback;
        throw e;
    }
};

const readQuestions = () => readJSON(questionsFile);
const readSessions = () => readJSON(sessionsFile, []);
const writeSessions = sessions => fs.promises.writeFile(
    sessionsFile, JSON.stringify(sessions, null, 2)
);

function stopMonitoring() {
    clearInterval(timer);
    clearInterval(cameraTimer);
    timer = cameraTimer = startTimestamp = null;
}

function createWindow() {
    electronWindow = new BrowserWindow({
        height: 1000,
        width: 1000,
        webPreferences: {
            devTools: true,
            preload: path.join(import.meta.dirname, "preload.js")
        }
    });

    electronWindow.on("closed", () => {
        stopMonitoring();
        electronWindow = null;
    });

    electronWindow.webContents.on("before-input-event", (_event, input) => {
        if (
            platform() === "darwin" &&
            input.type === "keyDown" &&
            input.meta &&
            input.key.toLowerCase() === "q"
        ) {
            app.quit();
        }
    });

    electronWindow.loadURL("http://localhost:5173");
}

ipcMain.handle("set-exam-kiosk", (_event, enabled) => {
    if (typeof enabled !== "boolean" || !electronWindow || electronWindow.isDestroyed()) {
        throw new Error("Invalid kiosk mode request.");
    }

    electronWindow.setKiosk(enabled);
    return electronWindow.isKiosk();
});

ipcMain.handle("load-exam-questions", async () =>
    (await readQuestions()).map(({ id, question, options }) =>
        ({ id, question, options })
    )
);

ipcMain.handle("create-exam-session", async () => {
    const sessions = await readSessions();
    const userId = 1;
    const name = "Student";

    const existing = sessions.find(s =>
        s.sessionId === activeSessionId && s.status === "in-progress" &&
        s.userId === userId && s.name === name
    );

    if (existing) return { sessionId: existing.sessionId };

    const session = {
        sessionId: `session-${randomUUID()}`,
        userId,
        name,
        startedAt: new Date().toISOString(),
        submittedAt: null,
        status: "in-progress",
        attempted: 0, correct: 0, wrong: 0, answers: []
    };

    sessions.push(session);
    await writeSessions(sessions);
    activeSessionId = session.sessionId;
    return { sessionId: session.sessionId };
});

ipcMain.handle("submit-exam", async (_event, submission) => {
    const [questions, sessions] = await Promise.all([
        readQuestions(), readSessions()
    ]);

    const session = sessions.find(s =>
        s.sessionId === submission?.sessionId
    );

    if (!session) throw new Error("Session not found.");

    if (session.status === "submitted") {
        return {
            attempted: session.attempted, correct: session.correct,
            wrong: session.wrong, total: questions.length
        };
    }

    if (session.status !== "in-progress" ||
        !Array.isArray(submission.answers)) {
        throw new Error("Invalid submission.");
    }

    const submitted = new Map();

    for (const a of submission.answers) {
        if (!a || submitted.has(a.questionId)) {
            throw new Error("Invalid or duplicate answer.");
        }
        submitted.set(a.questionId, a.selectedAnswer);
    }

    let attempted = 0, correct = 0;

    session.answers = questions.map(q => {
        const selectedAnswer = submitted.has(q.id)
            ? submitted.get(q.id) : null;

        if (selectedAnswer !== null &&
            (!Number.isInteger(selectedAnswer) ||
             selectedAnswer < 0 || selectedAnswer >= q.options.length)) {
            throw new Error("Invalid answer option.");
        }

        const isCorrect = selectedAnswer !== null &&
            selectedAnswer === q.correctAnswer;

        if (selectedAnswer !== null) attempted++;
        if (isCorrect) correct++;

        return { questionId: q.id, selectedAnswer, correct: isCorrect };
    });

    if ([...submitted.keys()].some(id => !questions.some(q => q.id === id))) {
        throw new Error("Unknown question.");
    }

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
    startTimestamp = Date.now();

    timer = setInterval(() => {
        if (electronWindow && !electronWindow.isDestroyed()) {
            electronWindow.webContents.send(
                "timer", (Date.now() - startTimestamp) / 1000
            );
        }
    }, 1000);

    cameraTimer = setInterval(() => {
        if (electronWindow && !electronWindow.isDestroyed()) {
            electronWindow.webContents.send("camera-shot");
        }
    }, 5000);

    return true;
});

ipcMain.handle("stop-timer", () => {
    stopMonitoring();
    return true;
});

ipcMain.handle("store-camera-snap-image-on-disk", async (_event, data) => {
    if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) {
        throw new Error("Invalid snapshot data.");
    }

    await fs.promises.writeFile(
        path.join(storageFolder, `${Date.now()}.jpg`), Buffer.from(data)
    );
    return true;
});

app.whenReady().then(createWindow);
app.on("before-quit", () => {
    stopMonitoring();
    if (electronWindow && !electronWindow.isDestroyed() && electronWindow.isKiosk()) {
        electronWindow.setKiosk(false);
    }
});
