@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo GIDEON icin Node.js 24.16 veya ustu desteklenen surumu gerekli.
  pause
  exit /b 1
)
if not exist "node_modules\openclaw\openclaw.mjs" (
  call npm ci --no-fund --no-audit
  if errorlevel 1 goto :failure
)
call npm run setup
if errorlevel 1 goto :failure
call npm start
if errorlevel 1 goto :failure
exit /b 0
:failure
echo GIDEON baslatilamadi. Yukaridaki hatayi inceleyin; mevcut kurulumunuz degistirilmedi.
pause
exit /b 1
