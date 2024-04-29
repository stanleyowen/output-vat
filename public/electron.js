const path = require("path");
const Store = require("electron-store");
const isDev = require("electron-is-dev");
const { autoUpdater } = require("electron-updater");
const { app, shell, BrowserWindow, ipcMain } = require("electron");

let mainWindow;
let store = new Store();

function createWindow() {
  function setLocalStorageDatabase() {
    mainWindow.webContents.executeJavaScript([
      `localStorage.setItem('excel-template',${JSON.stringify(
        store.get("excel-template")
      )})`,
      `localStorage.setItem('use-reference-number',${JSON.stringify(
        store.get("use-reference-number")
      )})`,
    ]);
  }

  mainWindow = new BrowserWindow({
    width: 900,
    height: 680,
    show: false,
    webPreferences: {
      plugins: true,
      webSecurity: false,
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadURL(
    isDev
      ? "http://localhost:3000"
      : `file://${path.join(__dirname, "../build/index.html")}`
  );
  mainWindow.setMenuBarVisibility(false);
  mainWindow.on("closed", () => (mainWindow = null));
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    autoUpdater.checkForUpdates();
  });
  mainWindow.webContents.on("new-window", (e, url) => {
    e.preventDefault();
    shell.openExternal(url);
  });

  setLocalStorageDatabase();

  ipcMain.on("store-data", (_, arg) => {
    const { id, value } = JSON.parse(arg);
    store.set(id, value);
    setLocalStorageDatabase();
    mainWindow.webContents.send("store-data-status", { success: true });
  });

  ipcMain.on("restart_app", () => autoUpdater.quitAndInstall());
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (mainWindow === null) createWindow();
});

autoUpdater.on("update-available", () =>
  mainWindow.webContents.send("update_available")
);
autoUpdater.on("update-downloaded", () =>
  mainWindow.webContents.send("update_downloaded")
);
