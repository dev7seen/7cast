@echo off
chcp 65001 >nul
title تثبيت متطلبات 7CAST
color 0A
echo.
echo ========================================================
echo        7CAST - معالج التثبيت التلقائي السريع
echo ========================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] تعذر العثور على Node.js!
    echo يرجى تثبيت Node.js من: https://nodejs.org
    pause
    exit /b 1
)

echo [1/2] جاري تثبيت حزم npm...
call npm install

echo.
echo [2/2] جاري التحقق من الخطوط والأيقونات والمكتبات...
node scripts/download_assets.js

echo.
echo ========================================================
echo  تم الانتهاء من التثبيت بنجاح!
echo  يمكنك الآن تشغيل اللوحة بالضغط مرتين على start.bat
echo ========================================================
echo.
pause
