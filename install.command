#!/bin/bash
# Screenshot Archive 설치 스크립트
# 더블클릭하면 자동으로 설치됩니다.

set -e
cd "$(dirname "$0")" 2>/dev/null || cd ~

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  📷  Screenshot Archive 설치"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

INSTALL_DIR="$HOME/Desktop/screenshot-archive"

# ── 1. Node.js 확인 ──
NODE=""
for p in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
  [ -f "$p" ] && NODE="$p" && break
done

if [ -z "$NODE" ]; then
  echo "⚠️  Node.js가 없어요. Homebrew로 설치합니다..."
  if ! command -v brew &>/dev/null; then
    echo "   Homebrew 설치 중..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null || true
  fi
  brew install node
  NODE="$(command -v node)"
fi
echo "✅ Node.js: $($NODE -v)"

# ── 2. Git 확인 ──
if ! command -v git &>/dev/null; then
  echo "⚠️  Git이 없어요. Xcode Command Line Tools 설치..."
  xcode-select --install 2>/dev/null || true
  echo "   설치 완료 후 이 파일을 다시 실행해주세요."
  read -p "   아무 키나 누르면 닫힙니다..." -n1
  exit 1
fi
echo "✅ Git: $(git --version | awk '{print $3}')"

# ── 3. 클론 or 업데이트 ──
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "🔄 기존 설치 발견 — 최신 버전으로 업데이트 중..."
  git -C "$INSTALL_DIR" pull --quiet
else
  echo "📦 다운로드 중..."
  git clone --quiet https://github.com/shirleyh-h/screenshot-archive.git "$INSTALL_DIR"
fi

# ── 4. 의존성 설치 ──
echo "📦 패키지 설치 중..."
cd "$INSTALL_DIR"
"$NODE" "$(dirname "$NODE")/../bin/npm" install --quiet 2>&1 | tail -2

# ── 5. 설정 실행 ──
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  아래에서 개인 설정을 입력해주세요"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
"$NODE" "$INSTALL_DIR/setup.js"

# ── 6. 브라우저 열기 ──
PORT=$(node -e "try{const c=require('$INSTALL_DIR/config.json');console.log(c.port||3100)}catch{console.log(3100)}" 2>/dev/null || echo 3100)
echo ""
echo "🌐 브라우저를 열고 있어요..."
sleep 1
open "http://localhost:$PORT"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ 설치 완료!"
echo "  브라우저에서 http://localhost:$PORT 를 확인하세요."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
read -p "  아무 키나 누르면 창이 닫힙니다..." -n1
