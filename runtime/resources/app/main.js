/**
 * 三体控制台 · 桌面壳
 *
 * 这个进程只做三件事：
 *   1. 把本地服务（server.mjs）拉起来，等端口通了再开窗口
 *   2. 打开一个没有地址栏的窗口（最大化），关窗时把服务一起收掉
 *   3. 兜住外链、快捷键、单实例
 *
 * 退出时不留孤儿进程：Windows 上用 taskkill /T 杀整棵树。
 */

const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');

const PORT = Number(process.env.CONSOLE_PORT || 7788);
const APP_DIR = __dirname;
const SERVER = path.join(APP_DIR, 'server.mjs');

// GPU 策略（实测结论，2026-10-26）：
//   - 之前「GPU 子进程连续崩溃（0xC0000005）→ FATAL」的源头不是显卡驱动，
//     而是 Chromium 的 **GPU 沙箱**与本机环境（MuMu 虚拟显卡 + AMD/NV 双显卡
//     切换）冲突。关掉 GPU 沙箱后硬件加速完全正常：144fps、最差帧 7ms、
//     WebGL 可用、长时间运行零崩溃。
//   - 渲染器沙箱同样必须关（no-sandbox），否则页面加载了但永远不响应。
//   - 硬件加速模式下不要加 in-process-gpu（硬件合成需要独立 GPU 进程），
//     也不要 disable-gpu / disable-gpu-compositing（会让渲染进程卡死）。
// 逃生门：环境变量 CONSOLE_SW=1 强制回旧的纯软件渲染路径
// （万一换了环境导致上面的组合失效，用它兜底）。
if (process.env.CONSOLE_SW === '1') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('in-process-gpu');
  app.commandLine.appendSwitch('no-sandbox');
} else {
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('no-sandbox');
}

let child = null;
let win = null;
let ownServer = false;
ipcMain.handle('console:capture-view',async(event)=>{
  if(!win||event.sender!==win.webContents||new URL(event.sender.getURL()).origin!==`http://127.0.0.1:${PORT}`)throw Error('只接受当前三体窗口');
  const image=await win.webContents.capturePage();return image.resize({width:Math.min(1600,image.getSize().width)}).toPNG().toString('base64');
});

/* ---------------- 找一个能跑 node 的二进制 ---------------- */

function resolveNode() {
  const fixed = [
    process.env.CONSOLE_NODE_BIN,
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Users\\<user>\\AppData\\Local\\Programs\\nodejs\\node.exe',
  ].filter(Boolean);

  for (const p of fixed) {
    if (fs.existsSync(p)) return { bin: p, env: {} };
  }
  // 找不到独立 node 时，让 electron 自己以 node 身份跑
  return { bin: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
}

/* ---------------- 端口探测 ---------------- */

/**
 * 问端口上那个服务「你是谁」。
 * 只知道「7788 有东西在听」不够——可能是跑着旧代码的僵尸服务，
 * 连上去会看到搬目录之前的界面，还以为是 bug。
 */
function identify(timeoutMs = 900) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: PORT, path: '/api/identify', timeout: timeoutMs },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => {
          body += d;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

function probe() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: PORT, path: '/api/state', timeout: 900 },
      (res) => {
        res.resume();
        resolve(true);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/**
 * 清掉端口上的「别人」。
 *
 * 两种来源：
 *   - 孤儿服务：桌面壳被 taskkill /F 强杀时，服务的 will-quit 不会跑，
 *     node 子进程留在那儿一直占着 7788；
 *   - 异源服务：旧版本代码留在别的目录（比如搬盘之前）起的。
 *
 * 判断依据是 /api/identify 报的 appDir 和 pid，跟当前这份对不上就杀掉。
 */
async function reapForeignServer() {
  const info = await identify();
  if (!info) return null;

  const sameCode = info.appDir && path.resolve(info.appDir) === path.resolve(APP_DIR);
  if (sameCode && pidAlive(info.parentPid)) {
    // 是当前这份代码起的，而且它背后的桌面壳还活着 —— 单实例锁本不该出现这情况，
    // 但如果真出现了（比如用户手动起了 server.mjs），尊重它，不动。
    return info;
  }

  console.log('[console] 清掉端口上的遗留服务：', info.appDir, 'pid', info.pid);
  try {
    execFileSync('taskkill', ['/PID', String(info.pid), '/T', '/F'], { windowsHide: true });
  } catch {
    try {
      process.kill(info.pid);
    } catch {}
  }
  // 等端口真正松开
  for (let i = 0; i < 20; i++) {
    if (!(await probe())) return null;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

async function waitForServer(timeoutMs = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await probe()) return true;
    if (child && child.exitCode !== null) return false;
    await new Promise((r) => setTimeout(r, 350));
  }
  return false;
}

/* ---------------- 启动服务 ---------------- */

async function ensureServer() {
  // 先清掉端口上的遗留/异源服务，再决定是复用还是自己起一个
  const existing = await reapForeignServer();
  if (existing) {
    ownServer = false;
    return true;
  }

  const { bin, env } = resolveNode();
  child = spawn(bin, [SERVER], {
    cwd: APP_DIR,
    env: {
      ...process.env,
      CONSOLE_PORT: String(PORT),
      CONSOLE_PARENT_PID: String(process.pid),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  ownServer = true;

  let log = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    log += d;
    if (log.length > 8000) log = log.slice(-8000);
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d) => {
    log += d;
    if (log.length > 8000) log = log.slice(-8000);
  });

  const ok = await waitForServer();
  if (!ok) console.error('[console] 服务没有起来：\n' + log.slice(-2000));
  return ok;
}

function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  // Only the UI HTTP service belongs to the window. The durable task worker
  // owns active native processes and must survive closing/reloading the UI.
  try { proc.kill(); } catch {}
}

/* ---------------- 窗口 ---------------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: '三体控制台',
    backgroundColor: '#f5f3ef',
    autoHideMenuBar: true,
    icon: path.join(APP_DIR, 'icon.ico'),
    // 去掉系统标题栏（用户要求消除顶部蓝条）：
    // hidden + overlay = 内容延伸到窗口顶，右上角保留原生的最小化/最大化/关闭
    titleBarStyle: 'hidden',
    // Transparent in-page controls share the actual gradient instead of a solid native strip.
    titleBarOverlay: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(APP_DIR, 'preload.js'),
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  win.once('ready-to-show', () => {
    win.maximize();
    if (process.env.CONSOLE_QA !== '1') win.show();
  });

  win.loadURL(`http://127.0.0.1:${PORT}/`);
  for(const event of ['maximize','unmaximize'])win.on(event,()=>win?.webContents.send('console:window-state',{maximized:win.isMaximized()}));

  // 外链交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${PORT}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${PORT}`)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  win.on('closed', () => {
    win = null;
  });
}

/* ---------------- 主题联动：标题栏按钮区随明暗主题换色 ---------------- */

ipcMain.on('console:overlay-color', () => {}); // Compatibility with older theme code; no solid strip.
ipcMain.handle('console:window-state',event=>{
  if(!win||event.sender!==win.webContents)throw Error('不是当前窗口');return {maximized:win.isMaximized()};
});
ipcMain.handle('console:window-command',(event,action)=>{
  if(!win||event.sender!==win.webContents||new URL(event.sender.getURL()).origin!==`http://127.0.0.1:${PORT}`)throw Error('不是当前窗口');
  if(action==='minimize')win.minimize();else if(action==='maximize'){if(win.isMaximized())win.unmaximize();else win.maximize();}else if(action==='close')win.close();else throw Error('未知窗口操作');
  return {maximized:win?.isMaximized()||false};
});

/* 外链 → 系统默认浏览器；本地文件 → 资源管理器定位 */
let projectDialogPending=false;
ipcMain.handle('console:choose-project-folder',async event=>{
  if(!win||event.sender!==win.webContents||projectDialogPending)return null;
  projectDialogPending=true;
  try{const result=await dialog.showOpenDialog(win,{title:'选择项目文件夹',buttonLabel:'选择文件夹',properties:['openDirectory','dontAddToRecent']});return result.canceled?null:result.filePaths[0]||null;}
  finally{projectDialogPending=false;}
});

ipcMain.on('console:open-external', (_e, url) => {
  if (/^https?:\/\//i.test(String(url))) shell.openExternal(String(url));
});
ipcMain.on('console:reveal-file', (_e, p) => {
  const target = String(p);
  if (/^([a-zA-Z]:[\\/]|\\\\)/.test(target) && !target.includes('..')) {
    shell.showItemInFolder(target);
  }
});

// Explicit user button only: open the bridge's native interactive login flow.
ipcMain.on('console:workbuddy-login', () => {
  const { bin } = resolveNode();
  const cli = path.resolve(APP_DIR, '../../../bridges/wb-bridge/cli.mjs');
  const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
  spawn('powershell.exe', ['-NoProfile', '-NoExit', '-Command', `& ${quote(bin)} ${quote(cli)} /login`], {
    cwd: APP_DIR, detached: true, windowsHide: false, stdio: 'ignore',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '', NODE_OPTIONS: '' },
  }).unref();
});

/* ---------------- 菜单（只留快捷键） ---------------- */

function buildMenu() {
  const template = [
    {
      label: '视图',
      submenu: [
        { label: '刷新', accelerator: 'CmdOrCtrl+R', click: () => win && win.reload() },
        { label: '强制刷新', accelerator: 'CmdOrCtrl+Shift+R', click: () => win && win.reloadIgnoringCache() },
        { type: 'separator' },
        { label: '全屏', accelerator: 'F11', click: () => win && win.setFullScreen(!win.isFullScreen()) },
        { label: '开发者工具', accelerator: 'F12', click: () => win && win.webContents.toggleDevTools() },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', role: 'quit' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------------- 生命周期 ---------------- */

if (process.env.CONSOLE_INSTANCE_DIR) { fs.mkdirSync(process.env.CONSOLE_INSTANCE_DIR, { recursive: true }); app.setPath('userData', process.env.CONSOLE_INSTANCE_DIR); }

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    buildMenu();
    const ok = await ensureServer();
    if (!ok) {
      const choice = dialog.showMessageBoxSync({
        type: 'error',
        title: '三体控制台',
        message: '本地服务没能启动',
        detail: `端口 ${PORT} 没有响应。\n请检查是否有其它程序占用，或把 CONSOLE_PORT 换成别的端口再试。`,
        buttons: ['仍然打开窗口', '退出'],
        defaultId: 1,
      });
      if (choice === 1) app.quit();
    }
    createWindow();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('will-quit', () => {
    if (ownServer) {
      killTree(child);
      // taskkill /F 是强杀，服务进程没机会跑自己的清理逻辑，身份文件由壳代删
      try {
        fs.unlinkSync(process.env.CONSOLE_IDENTITY_FILE || path.join(APP_DIR, '.console-server.json'));
      } catch {}
    }
    child = null;
  });
}
