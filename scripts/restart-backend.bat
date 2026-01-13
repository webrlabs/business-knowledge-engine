@echo off
echo Restarting backend server...

REM Kill existing backend process on port 8080
for /f "tokens=5" %%a in ('netstat -aon ^| find ":8080" ^| find "LISTENING"') do (
    echo Stopping process %%a on port 8678
    taskkill /F /PID %%a
)

timeout /t 2 /nobreak > nul

REM Start backend server
echo Starting backend server...
cd backend
start /B node src/index.js
cd ..

echo Backend server restarted!
echo Waiting for server to be ready...
timeout /t 3 /nobreak > nul

REM Test the server
curl http://localhost:8080/health

echo.
echo Backend is ready!
