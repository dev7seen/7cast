@echo off
chcp 65001 >nul
title 7CAST - لوحة إعادة البث المتعدد الذكية
color 0B
echo.
echo ========================================================
echo        7CAST - منصة إعادة البث المتعددة الاحترافية
echo ========================================================
echo.
echo [1/2] التحقق من بيئة Node.js و FFmpeg...

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] تعذر العثور على Node.js على جهازك!
    echo يرجى تثبيت Node.js من: https://nodejs.org
    pause
    exit /b 1
)

where ffmpeg >nul 2>nul
if %errorlevel% neq 0 (
    echo [WARNING] تعذر العثور على FFmpeg في المسار العام (PATH).
    echo يرجى التأكد من توفر FFmpeg لإعادة البث والترميز.
)

if not exist node_modules (
    echo [2/2] تثبيت الحزم المطلوبة للمرة الأولى...
    call npm install
)

echo.
echo ========================================================
echo  تشغيل السيرفر على المنفذ: 7878
echo  الرابط: http://localhost:7878
echo  كلمة المرور: 11Q2rrt4@
echo ========================================================
echo.

node server.js

pause
