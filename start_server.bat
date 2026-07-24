@echo off
cd /d D:\atom_work\face-label
"C:\Users\issuser\AppData\Local\Programs\Python\Python312\python.exe" -m uvicorn main:app --host 0.0.0.0 --port 8000 > server_run.log 2>&1
