@echo off
chcp 65001 >nul
cd /d D:\atom_work\face-label
echo ========================================================
echo   FaceLabel 服务器启动脚本
echo ========================================================
echo   工作目录: %CD%
echo   Python:   C:\Users\issuser\AppData\Local\Programs\Python\Python312\python.exe
echo   监听地址: 0.0.0.0:8000
echo   日志文件: server_run.log
echo --------------------------------------------------------
echo   按 Ctrl+C 停止服务
echo ========================================================
echo.
C:\Users\issuser\AppData\Local\Programs\Python\Python312\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload > server_run.log 2>&1
echo.
echo 服务已停止。
pause
