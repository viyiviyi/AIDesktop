@echo off
chcp 65001 >nul
REM ============================================================
REM AIDesktop Build Distribution Script (Windows)
REM 构建可免安装依赖运行的发布版本
REM
REM 用法:
REM   scripts\build-dist.bat             构建（默认 release 模式）
REM   scripts\build-dist.bat debug       构建（debug 模式，保留原始 node_modules）
REM
REM 输出目录: build\aidesktop\
REM 运行: build\aidesktop\start.bat
REM ============================================================

setlocal enabledelayedexpansion

set "PROJECT_DIR=%~dp0.."
set "DIST_DIR=%PROJECT_DIR%\build\aidesktop"
set "BUILD_MODE=%1"
if "%BUILD_MODE%"=="" set "BUILD_MODE=release"

echo === AIDesktop Build Distribution ===
echo Mode: %BUILD_MODE%
echo Output: %DIST_DIR%
echo.

REM ---- Step 1: Clean ----
echo --- Step 1: Clean dist ---
if exist "%DIST_DIR%" rmdir /s /q "%DIST_DIR%"
mkdir "%DIST_DIR%"
echo.

REM ---- Step 2: Build Frontend ----
echo --- Step 2: Build Frontend (Vite) ---
cd /d "%PROJECT_DIR%\client"
call npx tsc -b --noEmit 2>nul
call npx vite build
if %ERRORLEVEL% neq 0 (
  echo Frontend build failed!
  exit /b 1
)
echo Frontend built: client/dist/
echo.

REM ---- Step 3: Build Backend ----
echo --- Step 3: Build Backend (esbuild bundle) ---
cd /d "%PROJECT_DIR%\server"
call npx esbuild src/index.ts --bundle --platform=node --format=cjs --target=node20 --outfile="%DIST_DIR%\server.cjs" --external:playwright --external:@playwright/mcp --alias:@earendil-works/pi-ai=../vendor/pi/packages/ai/src --alias:@earendil-works/pi-agent-core=../vendor/pi/packages/agent/src
if %ERRORLEVEL% neq 0 (
  echo Backend build failed!
  exit /b 1
)
echo Backend bundled: %DIST_DIR%\server.cjs
echo.

REM ---- Step 4: Copy Frontend Dist ----
echo --- Step 4: Copy Frontend Dist ---
mkdir "%DIST_DIR%\client"
xcopy /s /e /q /y "%PROJECT_DIR%\client\dist\*" "%DIST_DIR%\client\"
echo Frontend static files copied.
echo.

REM ---- Step 5: Copy Desktop Data ----
echo --- Step 5: Copy Desktop Data ---

REM 系统应用（只读，必需）
xcopy /s /e /q /y "%PROJECT_DIR%\server\desktop_data\apps\system" "%DIST_DIR%\desktop_data\apps\system\"
echo   system apps: copied

REM 示例技能（系统自带，必需）
xcopy /s /e /q /y "%PROJECT_DIR%\server\desktop_data\public_data" "%DIST_DIR%\desktop_data\public_data\"
echo   public data (skills): copied

REM 系统图标（必需）
xcopy /s /e /q /y "%PROJECT_DIR%\server\desktop_data\public_icons" "%DIST_DIR%\desktop_data\public_icons\"
echo   public icons: copied

REM 用户数据目录（初始化空目录，不复制任何用户数据）
mkdir "%DIST_DIR%\desktop_data\apps\user"
mkdir "%DIST_DIR%\desktop_data\apps_data"
mkdir "%DIST_DIR%\desktop_data\configs"
mkdir "%DIST_DIR%\desktop_data\wallpapers"
echo {"skills":[],"globalEnabled":true} > "%DIST_DIR%\desktop_data\configs\enabled_skills.json"
echo   user data directories: initialized (empty)
echo Desktop data ready.
echo.

REM ---- Step 6: Create start.bat for distribution ----
echo --- Step 6: Create start.bat ---
(
echo @echo off
echo cd /d "%%~dp0"
echo.
echo set PORT=27135
echo.
echo where node ^>nul 2^>nul
echo if %%ERRORLEVEL%% neq 0 (
echo   echo Error: Node.js is not installed.
echo   echo Please install Node.js 20+ from https://nodejs.org
echo   pause
echo   exit /b 1
echo )
echo.
echo echo Starting server on http://localhost:%%PORT%%
echo echo.
echo start "" http://localhost:%%PORT%%
echo node server.cjs
echo pause
) > "%DIST_DIR%\start.bat"
echo start.bat created.
echo.

REM ---- Step 8: Create README ----
echo --- Step 8: Create README ---
(
echo === AIDesktop ===
echo.
echo Starting method:
echo   Windows: Double-click start.bat
echo.
echo Open browser at http://localhost:27135
echo.
echo Prerequisite: Node.js 20+ (https://nodejs.org)
echo.
echo Directory structure:
echo   server.mjs              Backend (single file)
echo   client/                 Frontend static files
echo   desktop_data/           System data (apps, skills, icons)
echo   server\node_modules/    Runtime dependencies
echo   start.bat               Launch script
) > "%DIST_DIR%\README.txt"
echo README created.
echo.

REM ---- Summary ----
echo === Build Complete ===
echo Output: %DIST_DIR%
echo.
echo To run: %DIST_DIR%\start.bat

endlocal
