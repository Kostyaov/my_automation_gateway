@echo off
setlocal EnableExtensions

set "PROJECT_DIR=%~dp0my_automation_gateway"
set "APP_URL=http://127.0.0.1:8000/"
set "HEALTH_URL=http://127.0.0.1:8000/api/health"

cd /d "%PROJECT_DIR%"
if errorlevel 1 (
  echo Could not enter project directory:
  echo %PROJECT_DIR%
  pause
  exit /b 1
)

echo Local Automation Gateway
echo Project: %PROJECT_DIR%
echo.

if exist ".env" (
  echo Loading environment from .env
  for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $response = Invoke-WebRequest -UseBasicParsing '%HEALTH_URL%' -TimeoutSec 2; if ($response.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  echo Server is already running:
  echo %APP_URL%
  start "" "%APP_URL%"
  exit /b 0
)

if not exist "requirements.txt" (
  echo requirements.txt was not found in:
  echo %PROJECT_DIR%
  pause
  exit /b 1
)

set "PYTHON_LAUNCHER="
py -3.12 -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)" >nul 2>nul
if not errorlevel 1 set "PYTHON_LAUNCHER=py -3.12"

if not defined PYTHON_LAUNCHER (
  py -3.11 -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)" >nul 2>nul
  if not errorlevel 1 set "PYTHON_LAUNCHER=py -3.11"
)

if not defined PYTHON_LAUNCHER (
  py -3.13 -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 13) else 1)" >nul 2>nul
  if not errorlevel 1 set "PYTHON_LAUNCHER=py -3.13"
)

if not defined PYTHON_LAUNCHER (
  python -c "import sys; raise SystemExit(0 if (3, 11) <= sys.version_info[:2] <= (3, 13) else 1)" >nul 2>nul
  if not errorlevel 1 set "PYTHON_LAUNCHER=python"
)

if not defined PYTHON_LAUNCHER (
  echo Could not find a supported Python version.
  echo Please install Python 3.12 or 3.11. Python 3.14 is not supported by the current dependencies yet.
  pause
  exit /b 1
)

if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -c "import sys; raise SystemExit(0 if (3, 11) <= sys.version_info[:2] <= (3, 13) else 1)" >nul 2>nul
  if errorlevel 1 (
    echo Existing .venv uses an unsupported Python version. Recreating it...
    rmdir /s /q ".venv"
    if errorlevel 1 (
      echo Could not remove the old .venv folder. Close programs that may use it and try again.
      pause
      exit /b 1
    )
  )
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating Python virtual environment...
  %PYTHON_LAUNCHER% -m venv .venv
  if errorlevel 1 (
    echo Could not create Python virtual environment.
    echo Install Python 3.12 or 3.11 and try again.
    pause
    exit /b 1
  )
)

for /f %%H in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-FileHash requirements.txt -Algorithm SHA256).Hash.ToLower()"') do set "REQUIREMENTS_HASH=%%H"
set "INSTALLED_HASH="
if exist ".venv\.requirements-installed" (
  set /p INSTALLED_HASH=<".venv\.requirements-installed"
)

if not "%INSTALLED_HASH%"=="%REQUIREMENTS_HASH%" (
  echo Installing Python dependencies...
  ".venv\Scripts\python.exe" -m pip install --upgrade pip setuptools wheel
  if errorlevel 1 (
    echo Could not update pip/build tools.
    pause
    exit /b 1
  )
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
  > ".venv\.requirements-installed" echo %REQUIREMENTS_HASH%
)

echo Starting server on %APP_URL%
echo Close this Command Prompt window or press Ctrl+C to stop the server.
echo.

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process '%APP_URL%'"

".venv\Scripts\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8000 --loop asyncio

endlocal
