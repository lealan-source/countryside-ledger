@echo off
REM Weekly price update — drop the new vendor sheets in "Price Sheets" first,
REM then double-click this. It rebuilds, checks the numbers, and asks before
REM publishing anything.
cd /d "%~dp0tools"
node update.js
echo.
pause
