@echo off
REM SkyChess 沙盘 —— Windows 稳定后台启动（不随终端关闭而退出）
cd /d "%~dp0"
where node >nul 2>nul || (echo [错误] 未找到 node，请先安装 Node.js & exit /b 1)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8765" ^| findstr "LISTENING"') do (
  echo [提示] 8765 已被 PID %%p 占用；如需重启请先结束该进程
)
start "SkyChess Sandbox" /min cmd /c "node server.mjs"
timeout /t 3 /nobreak >nul
echo [完成] 服务已启动：http://127.0.0.1:8765/teacher.html
