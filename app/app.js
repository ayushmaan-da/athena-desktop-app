import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "path";
import fs from "fs";

let electronWindow = null;
let startTimestamp = null
let storageFolder = path.join(import.meta.dirname, "user-camera-snap");

fs.mkdirSync(storageFolder, { recursive: true });

function createWindow() {
    electronWindow = new BrowserWindow({
        height: 1000,
        width: 1000,
        webPreferences: {
            devTools: true,
            preload: path.join(import.meta.dirname, 'preload.js')
        }
    })

    electronWindow.loadURL('http://localhost:5173')
}

ipcMain.handle('start-timer', (event) => {
    startTimestamp = Date.now();

    // Send Timer Tick every 1s
    setInterval(() => {
        electronWindow.webContents.send('timer', (Date.now() - startTimestamp) / 1000);
    }, 1000);

    // Capture user's camera snap every 5s
    setInterval(() => {
        electronWindow.webContents.send('camera-shot')
    }, 5000);
})


ipcMain.handle('store-camera-snap-image-on-disk', (_event, data) => {
    const filePath = path.join(storageFolder, `${Date.now()}.jpg`);
    fs.writeFileSync(filePath, Buffer.from(data));
})

ipcMain.handle('select-storage-folder', async () => {
    const result = await dialog.showOpenDialog({
        title: 'Choose where to save camera snapshots',
        properties: ['openDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }

    storageFolder = result.filePaths[0];
    fs.mkdirSync(storageFolder, { recursive: true });
    return storageFolder;
});


ipcMain.on("show-rules", async () => {
    const result = await dialog.showMessageBox(electronWindow, {
        type: "info",
        title: "Athena Exam Rules",
        message: "Exam Rules",
        detail:
            "1. Stay on the exam screen.\n" +
            "2. Camera must remain enabled.\n" +
            "3. Do not leave the exam.\n" +
            "4. Do not use external assistance.\n" +
            "5. Click Exit Exam when finished.",
        checkboxLabel: "I have read and agree to these rules",
        checkboxChecked: false,
        buttons: ["Agree", "Cancel"],
        defaultId: 0,
        cancelId: 1,
    });

    console.log("Rules dialog button clicked:", result.response === 0 ? "Agree" : "Cancel");
    console.log("Rules checkbox selected:", result.checkboxChecked);
});


app.whenReady().then(createWindow);