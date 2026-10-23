const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld("athena", {
    registerListenerForTimerTickFromMain: (callback) => {
        // callback is setTimer
        const fn = (event, message) => {
            callback(message);
        }

        ipcRenderer.on('timer', fn);

        return () => {
            ipcRenderer.removeListener('timer', fn);
        }
    },
    startTimerOnMain: () => {
        return ipcRenderer.invoke('start-timer');
    },
    stopTimerOnMain: () => ipcRenderer.invoke('stop-timer'),
    setExamKioskOnMain: (enabled) => ipcRenderer.invoke('set-exam-kiosk', enabled),
    loadExamQuestions: () => ipcRenderer.invoke('load-exam-questions'),
    createExamSession: (student) => ipcRenderer.invoke('create-exam-session', student),
    submitExam: (submission) => ipcRenderer.invoke('submit-exam', submission),

    // New Preload Functions

    // Functions related to capturing camera snaps of user
    registerListenerForCameraSnapFromMain: (callback) => {
        const fn = () => callback();
        ipcRenderer.on('camera-shot', fn);

        return () => {
            ipcRenderer.removeListener('camera-shot', fn);
        }
    },

    storeCameraSnapImageOnDisk: (data) => {
        return ipcRenderer.invoke('store-camera-snap-image-on-disk', data);
    },

})
