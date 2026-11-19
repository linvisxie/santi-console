"""
生成 GBK 编码的启动器。

三个坑：
1. 中文版 Windows 的 cmd.exe 按 ANSI 代码页（GBK）解析 .cmd。UTF-8 会让
   脚本里的中文路径变成乱码，start 直接报 9009「不是内部或外部命令」。
2. `start "" "三体控制台.exe"` 里的裸文件名解析不稳定，写成 `.\三体控制台.exe`，
   强制按当前目录解析。
3. ELECTRON_RUN_AS_NODE=1 会让 Electron 把自己当成普通 node 跑并立刻退出，
   启动前必须清掉。

另外加一道自检：start 之后等几秒看 7788 有没有起来，没起来就前台运行，
让用户直接看到错误输出，而不是对着一个没反应的图标发呆。
"""
import os

LAUNCHER = (
    "@echo off\r\n"
    "rem Santi Console launcher (GBK + CRLF, do not re-save as UTF-8).\r\n"
    "set ELECTRON_RUN_AS_NODE=\r\n"
    "set NODE_OPTIONS=\r\n"
    "cd /d \"D:\\santi-console\\runtime\"\r\n"
    "start \"\" \".\\三体控制台.exe\"\r\n"
    "timeout /t 8 /nobreak >nul\r\n"
    "netstat -an | find \"127.0.0.1:7788\" | find \"LISTENING\" >nul\r\n"
    "if errorlevel 1 (\r\n"
    "  echo.\r\n"
    "  echo [!] Service on port 7788 did not come up. Running in foreground for details...\r\n"
    "  echo.\r\n"
    "  \".\\三体控制台.exe\"\r\n"
    ")\r\n"
    "exit\r\n"
)

TARGETS = [
    r"D:\santi-console\launch.cmd",
    r"D:\桌面\三体控制台.cmd",
]

for p in TARGETS:
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as f:
        f.write(LAUNCHER.encode("gbk"))
    print("written:", p)

a = open(TARGETS[0], "rb").read()
b = open(TARGETS[1], "rb").read()
print("desktop copy identical:", a == b)
print("GBK roundtrip ok:", "三体控制台" in a.decode("gbk"))
print("CRLF only:", a.count(b"\n") == a.count(b"\r\n"))
