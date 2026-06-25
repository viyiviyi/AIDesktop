#!/bin/bash
# ============================================================
# AIDesktop Build Distribution Script
# 构建可免安装依赖运行的发布版本
#
# 用法:
#   ./scripts/build-dist.sh              # 构建（默认 release 模式）
#   ./scripts/build-dist.sh debug        # 构建（debug 模式，保留原始 node_modules）
#
# 输出目录: build/aidesktop/
# 运行: ./build/aidesktop/start.sh
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PROJECT_DIR/build/aidesktop"
BUILD_MODE="${1:-release}"

echo "=== AIDesktop Build Distribution ==="
echo "Mode: $BUILD_MODE"
echo "Output: $DIST_DIR"
echo ""

# ---- Step 1: Clean ----
echo "--- Step 1: Clean dist ---"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# ---- Step 2: Build Frontend ----
echo ""
echo "--- Step 2: Build Frontend (Vite) ---"
cd "$PROJECT_DIR/client"
npx tsc -b --noEmit 2>/dev/null || true
npx vite build
echo "Frontend built: client/dist/"

# ---- Step 3: Build Backend (esbuild bundle with all deps inlined) ----
echo ""
echo "--- Step 3: Build Backend (esbuild bundle) ---"
cd "$PROJECT_DIR/server"
rm -rf "$DIST_DIR/server.mjs"
npx esbuild src/index.ts \
  --bundle \
  --platform=node \
  --format=cjs \
  --target=node20 \
  --outfile="$DIST_DIR/server.cjs" \
  --external:playwright \
  --external:@playwright/mcp \
  --define:import.meta.url="\"file:///$PROJECT_DIR/server/src/index.ts\""

echo "Backend bundled: $DIST_DIR/server.mjs"

# ---- Step 3b: Install external dependencies (playwright) ----
echo ""
echo "--- Step 3b: Install external dependencies ---"
# playwright 被 esbuild external 了（太大了），需要在运行时安装
if [ ! -d "$DIST_DIR/node_modules/playwright" ]; then
  cd "$DIST_DIR"
  npm init -y --silent 2>/dev/null
  npm install playwright @playwright/mcp --no-audit --no-fund --loglevel=warn 2>&1 | tail -3
  echo "External dependencies installed."
fi

# ---- Step 4: Copy Frontend Dist ----
echo ""
echo "--- Step 4: Copy Frontend Dist ---"
mkdir -p "$DIST_DIR/client/dist"
cp -r "$PROJECT_DIR/client/dist/"* "$DIST_DIR/client/dist/"
echo "Frontend static files copied."

# ---- Step 5: Copy Desktop Data ----
echo ""
# ---- Step 5: Copy Desktop Data ----
echo ""
echo "--- Step 5: Copy Desktop Data ---"

# 系统应用（只读，必需）
mkdir -p "$DIST_DIR/desktop_data/apps"
cp -r "$PROJECT_DIR/server/desktop_data/apps/system" "$DIST_DIR/desktop_data/apps/system"
echo "  system apps: copied"

# 示例技能（系统自带，必需）
mkdir -p "$DIST_DIR/desktop_data"
cp -r "$PROJECT_DIR/server/desktop_data/public_data" "$DIST_DIR/desktop_data/public_data"
echo "  public data (skills): copied"

# 系统图标（必需）
cp -r "$PROJECT_DIR/server/desktop_data/public_icons" "$DIST_DIR/desktop_data/public_icons"
echo "  public icons: copied"

# 用户数据目录（初始化空目录，不复制任何用户数据）
mkdir -p "$DIST_DIR/desktop_data/apps/user"
mkdir -p "$DIST_DIR/desktop_data/apps_data"
mkdir -p "$DIST_DIR/desktop_data/configs"
mkdir -p "$DIST_DIR/desktop_data/wallpapers"
echo '{"skills":[],"globalEnabled":true}' > "$DIST_DIR/desktop_data/configs/enabled_skills.json"
echo "  user data directories: initialized (empty)"
echo "Desktop data ready."

# ---- Step 6: Create Start Scripts ----
echo ""
echo "--- Step 7: Create Start Scripts ---"

cat > "$DIST_DIR/start.sh" << 'SCRIPT'
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== AIDesktop ==="
echo ""

PORT=${PORT:-27135}

if ! command -v node &> /dev/null; then
  echo "Error: Node.js is not installed."
  echo "Please install Node.js 20+ from https://nodejs.org"
  read -p "Press Enter to exit..."
  exit 1
fi

echo "Starting server on http://localhost:$PORT"
echo ""

if command -v xdg-open &> /dev/null; then
  (sleep 2 && xdg-open "http://localhost:$PORT") &
elif command -v open &> /dev/null; then
  (sleep 2 && open "http://localhost:$PORT") &
fi\nexec node server.cjs
SCRIPT
chmod +x "$DIST_DIR/start.sh"

cat > "$DIST_DIR/start.bat" << 'SCRIPT'
@echo off
cd /d "%~dp0"
echo === AIDesktop ===
echo.

set PORT=27135

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
  echo Error: Node.js is not installed.
  echo Please install Node.js 20+ from https://nodejs.org
  pause
  exit /b 1
)

echo Starting server on http://localhost:%PORT%
echo.

set NODE_PATH=server\node_modules
start "" http://localhost:%PORT%
node server.mjs
pause
SCRIPT

echo "Start scripts created."

# ---- Step 8: README ----
echo ""
echo "--- Step 8: Create README ---"
cat > "$DIST_DIR/README.txt" << 'EOF'
=== AIDesktop ===

启动方法:
  Windows: 双击 start.bat
  macOS:   终端运行 ./start.sh
  Linux:   终端运行 ./start.sh

启动后浏览器自动打开 http://localhost:27135

前置要求: Node.js 20+ (https://nodejs.org)

目录说明:
  server.mjs               后端服务（单个文件）
  client/                  前端静态文件
  desktop_data/            系统数据（应用、技能、图标）
  server/node_modules/     运行时依赖
  start.sh / start.bat     启动脚本
EOF

echo "README created."

# ---- Summary ----
echo ""
echo "=== Build Complete ==="
echo "Output: $DIST_DIR"
echo ""
if command -v du &> /dev/null; then
  du -sh "$DIST_DIR"
fi
echo ""
echo "To run: $DIST_DIR/start.sh"

# ---- Packaging for Windows ----
echo ""
echo "--- Packaging: Create ZIP for Windows ---"
ZIP_FILE="$PROJECT_DIR/build/aidesktop-windows.zip"
rm -f "$ZIP_FILE"
cd "$PROJECT_DIR/build"
if command -v zip &> /dev/null; then
  zip -r "$ZIP_FILE" "aidesktop" -x "*/node_modules/.cache/*" > /dev/null 2>&1
  echo "Windows zip created: $ZIP_FILE"
  ls -lh "$ZIP_FILE"
elif command -v 7z &> /dev/null; then
  7z a -r "$ZIP_FILE" "aidesktop" > /dev/null 2>&1
  echo "Windows zip created: $ZIP_FILE"
  ls -lh "$ZIP_FILE"
else
  echo "zip/7z not found, skipping zip packaging."
  echo "Tip: install 'zip' or manually zip the build/aidesktop/ folder."
fi
echo ""
