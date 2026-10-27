#!/usr/bin/env bash
# ==============================================================================
#  7CAST - Automated Production VPS Installation Script
#  Repository: https://github.com/dev7seen/7cast
#  One-Line Command:
#    curl -fsSL https://raw.githubusercontent.com/dev7seen/7cast/main/install.sh | sudo bash
# ==============================================================================

set -euo pipefail

# Color Codes (ANSI)
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

INSTALL_DIR="/opt/7cast"
REPO_URL="https://github.com/dev7seen/7cast.git"
APP_PORT=7878

clear

echo -e "${CYAN}"
echo "  ███████╗ ██████╗ █████╗ ███████╗████████╗"
echo "  ╚════██║██╔════╝██╔══██╗██╔════╝╚══██╔══╝"
echo "    ███╔═╝██║     ███████║███████╗   ██║   "
echo "  ██╔══╝  ██║     ██╔══██║╚════██║   ██║   "
echo "  ███████╗╚██████╗██║  ██║███████║   ██║   "
echo "  ╚══════╝ ╚═════╝╚═╝  ╚═╝╚══════╝   ╚═╝   "
echo -e "${NC}"
echo -e "${WHITE}  7CAST - Intelligent Multi-Stream RTMP/RTMPS Hub & Live Logo Overlay Engine${NC}"
echo -e "${CYAN}  Repository: ${REPO_URL}${NC}"
echo -e "  ----------------------------------------------------------------------"
echo ""

# 1. Root Permission Check
if [ "$(id -u)" -ne 0 ]; then
  echo -e "${RED}[ERROR] This installation script must be run as root or with sudo.${NC}"
  echo -e "${YELLOW}Please run:${NC} curl -fsSL https://raw.githubusercontent.com/dev7seen/7cast/main/install.sh | sudo bash"
  exit 1
fi

echo -e "${CYAN}[1/6] Detecting Operating System & Package Manager...${NC}"
OS=""
PKG_MANAGER=""

if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS=$ID
fi

case "$OS" in
  ubuntu|debian)
    PKG_MANAGER="apt"
    ;;
  centos|rhel|almalinux|rocky|fedora)
    PKG_MANAGER="dnf"
    if ! command -v dnf &>/dev/null; then
      PKG_MANAGER="yum"
    fi
    ;;
  *)
    echo -e "${YELLOW}[WARNING] Untested Linux distribution ($OS). Attempting debian/apt fallback...${NC}"
    PKG_MANAGER="apt"
    ;;
esac

echo -e "${GREEN}[OK] Detected OS: $OS (Manager: $PKG_MANAGER)${NC}"

# 2. System Updates & Core Dependencies (FFmpeg, Git, Curl)
echo -e "\n${CYAN}[2/6] Installing Essential Packages & FFmpeg Media Engine...${NC}"

if [ "$PKG_MANAGER" = "apt" ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y -q
  apt-get install -y -q curl wget git ffmpeg ca-certificates gnupg lsb-release
elif [ "$PKG_MANAGER" = "dnf" ] || [ "$PKG_MANAGER" = "yum" ]; then
  $PKG_MANAGER install -y -q epel-release || true
  # Enable RPM Fusion if on RHEL/CentOS for FFmpeg
  $PKG_MANAGER install -y -q --nogpgcheck https://mirrors.rpmfusion.org/free/el/rpmfusion-free-release-$(rpm -E %rhel).noarch.rpm || true
  $PKG_MANAGER install -y -q curl wget git ffmpeg
fi

# Verify FFmpeg
if ! command -v ffmpeg &>/dev/null; then
  echo -e "${RED}[ERROR] FFmpeg installation failed. Please install FFmpeg manually.${NC}"
  exit 1
fi
FFMPEG_VER=$(ffmpeg -version | head -n 1)
echo -e "${GREEN}[OK] FFmpeg installed: ${FFMPEG_VER}${NC}"

# 3. Node.js 20 LTS & PM2
echo -e "\n${CYAN}[3/6] Setting up Node.js 20 (LTS) & PM2 Daemon Supervisor...${NC}"

if ! command -v node &>/dev/null || [ "$(node -v | cut -d'.' -f1 | tr -d 'v')" -lt 18 ]; then
  echo -e "Installing Node.js 20 LTS from NodeSource..."
  if [ "$PKG_MANAGER" = "apt" ]; then
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes
    NODE_MAJOR=20
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list
    apt-get update -y -q
    apt-get install -y -q nodejs
  elif [ "$PKG_MANAGER" = "dnf" ] || [ "$PKG_MANAGER" = "yum" ]; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    $PKG_MANAGER install -y -q nodejs
  fi
fi

NODE_VER=$(node -v)
NPM_VER=$(npm -v)
echo -e "${GREEN}[OK] Node.js: ${NODE_VER} | npm: ${NPM_VER}${NC}"

# Install PM2 globally
if ! command -v pm2 &>/dev/null; then
  echo -e "Installing PM2 globally..."
  npm install -g pm2 --silent
fi
echo -e "${GREEN}[OK] PM2 installed: $(pm2 -v)${NC}"

# 4. Clone or Update 7CAST Repository
echo -e "\n${CYAN}[4/6] Deploying 7CAST to ${INSTALL_DIR}...${NC}"

if [ -d "$INSTALL_DIR/.git" ]; then
  echo -e "Existing repository found in ${INSTALL_DIR}. Pulling latest changes..."
  cd "$INSTALL_DIR"
  git fetch origin
  git reset --hard origin/main
else
  echo -e "Cloning ${REPO_URL} into ${INSTALL_DIR}..."
  rm -rf "$INSTALL_DIR"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# 5. Dependencies & Permissions Setup
echo -e "\n${CYAN}[5/6] Installing Application Dependencies & Preparing Data Directories...${NC}"
cd "$INSTALL_DIR"
npm install --omit=dev --silent

mkdir -p "$INSTALL_DIR/data"
mkdir -p "$INSTALL_DIR/public/uploads/logos"
mkdir -p "$INSTALL_DIR/public/snapshots"

# Ensure clean initial state if channels.json or config.json don't exist
if [ ! -f "$INSTALL_DIR/data/channels.json" ]; then
  echo "[]" > "$INSTALL_DIR/data/channels.json"
fi

if [ ! -f "$INSTALL_DIR/config.json" ]; then
  cat <<'EOF' > "$INSTALL_DIR/config.json"
{
  "port": 7878,
  "jwtSecret": "",
  "authPassword": "",
  "isConfigured": false,
  "system": {
    "autoRestartStreams": true,
    "maxConcurrentStreams": 10
  }
}
EOF
fi

chmod -R 755 "$INSTALL_DIR"

# 6. Firewall Configuration (UFW / Firewalld)
echo -e "\n${CYAN}[6/6] Configuring Firewall & Starting Service...${NC}"

if command -v ufw &>/dev/null && ufw status | grep -q "Status: active"; then
  echo -e "Allowing port ${APP_PORT}/tcp via UFW..."
  ufw allow ${APP_PORT}/tcp || true
elif command -v firewall-cmd &>/dev/null && firewall-cmd --state &>/dev/null; then
  echo -e "Allowing port ${APP_PORT}/tcp via Firewalld..."
  firewall-cmd --permanent --add-port=${APP_PORT}/tcp || true
  firewall-cmd --reload || true
fi

# Configure PM2 Daemon
cd "$INSTALL_DIR"
pm2 delete 7cast 2>/dev/null || true
pm2 start server.js --name 7cast --time
pm2 startup systemd -u root --hp /root || true
pm2 save --force

# Detect Public Server IP
SERVER_IP=$(curl -s --max-time 4 https://api.ipify.org || curl -s --max-time 4 ifconfig.me || hostname -I | awk '{print $1}')

echo ""
echo -e "${GREEN}======================================================================${NC}"
echo -e "${WHITE}           7CAST INSTALLATION COMPLETED SUCCESSFULLY!                ${NC}"
echo -e "${GREEN}======================================================================${NC}"
echo ""
echo -e "  Web Dashboard:       ${CYAN}http://${SERVER_IP}:${APP_PORT}${NC}"
echo -e "  Installation Path:   ${WHITE}${INSTALL_DIR}${NC}"
echo -e "  System Daemon:       ${WHITE}PM2 (Service: 7cast)${NC}"
echo ""
echo -e "${YELLOW}  FIRST RUN INSTRUCTION:${NC}"
echo -e "  Open ${CYAN}http://${SERVER_IP}:${APP_PORT}${NC} in your browser."
echo -e "  You will be prompted to set your Master Admin Password on first launch."
echo ""
echo -e "${WHITE}  USEFUL COMMANDS:${NC}"
echo -e "  - View live logs:     ${CYAN}pm2 logs 7cast${NC}"
echo -e "  - Restart dashboard:  ${CYAN}pm2 restart 7cast${NC}"
echo -e "  - Stop dashboard:     ${CYAN}pm2 stop 7cast${NC}"
echo -e "  - Update to latest:   ${CYAN}cd /opt/7cast && git pull && npm install && pm2 restart 7cast${NC}"
echo ""
echo -e "${GREEN}======================================================================${NC}"
