@echo off
REM OO Recovery — opens the app in your default browser.
setlocal
set "HERE=%~dp0"
start "" "%HERE%web\index.html"
endlocal
