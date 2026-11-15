@echo off
setlocal
rem Run the checked-in Impeccable launcher from the repository root.
rem Example: scripts\impeccable.cmd live --target src/owner-web/src/features/finance/FinanceHomePage.tsx
set "repo=%~dp0.."
set "launcher=%repo%\.codex\skills\impeccable\scripts\impeccable.cmd"

if not exist "%launcher%" (
  echo Impeccable launcher not found: "%launcher%" 1>&2
  exit /b 1
)

pushd "%repo%" || exit /b 1
call "%launcher%" %*
set "result=%ERRORLEVEL%"
popd
exit /b %result%
