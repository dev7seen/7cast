const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const logosDir = path.join(__dirname, '..', 'public', 'assets', 'logos');
if (!fs.existsSync(logosDir)) fs.mkdirSync(logosDir, { recursive: true });

// 1. 7SEEN TV Logo
const svg7seen = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120" width="320" height="120">
  <!-- Crown Icon -->
  <path d="M88 38 L96 16 L112 32 L128 12 L144 32 L160 16 L168 38 Z" fill="url(#goldGrad)" />
  <circle cx="96" cy="14" r="3.5" fill="#fef08a" />
  <circle cx="128" cy="10" r="4" fill="#fef08a" />
  <circle cx="160" cy="14" r="3.5" fill="#fef08a" />
  <!-- Text 7SEEN -->
  <text x="15" y="88" font-family="Arial, sans-serif" font-weight="900" font-size="56" fill="#e11d48">7</text>
  <text x="50" y="88" font-family="Arial, sans-serif" font-weight="900" font-size="56" fill="#ffffff" letter-spacing="2">SEEN</text>
  <!-- TV Badge -->
  <rect x="225" y="46" width="82" height="48" rx="10" fill="url(#tvGrad)" />
  <text x="240" y="82" font-family="Arial, sans-serif" font-weight="900" font-size="34" fill="#ffffff">TV</text>
  <defs>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fbbf24" />
      <stop offset="50%" stop-color="#f59e0b" />
      <stop offset="100%" stop-color="#d97706" />
    </linearGradient>
    <linearGradient id="tvGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#e11d48" />
      <stop offset="100%" stop-color="#be123c" />
    </linearGradient>
  </defs>
</svg>`;
const p1 = path.join(logosDir, '7seen_tv.svg');
fs.writeFileSync(p1, svg7seen);
execSync(`ffmpeg -y -i "${p1}" "${path.join(logosDir, '7seen_tv.png')}"`);

// 2. Champions League Logo
const svgUcl = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <circle cx="100" cy="100" r="92" fill="#03071e" stroke="rgba(255,255,255,0.3)" stroke-width="2" />
  <polygon points="100,30 106,48 125,48 109,60 115,78 100,67 85,78 91,60 75,48 94,48" fill="#ffffff" />
  <polygon points="60,70 64,84 79,84 67,93 72,107 60,98 48,107 53,93 41,84 56,84" fill="#ffffff" />
  <polygon points="140,70 144,84 159,84 147,93 152,107 140,98 128,107 133,93 121,84 136,84" fill="#ffffff" />
  <text x="100" y="145" font-family="Arial, sans-serif" font-weight="900" font-size="16" fill="#ffffff" text-anchor="middle" letter-spacing="3">UEFA</text>
  <text x="100" y="165" font-family="Arial, sans-serif" font-weight="700" font-size="12" fill="#93c5fd" text-anchor="middle" letter-spacing="1.5">CHAMPIONS</text>
  <text x="100" y="180" font-family="Arial, sans-serif" font-weight="700" font-size="12" fill="#93c5fd" text-anchor="middle" letter-spacing="1.5">LEAGUE</text>
</svg>`;
const p2 = path.join(logosDir, 'champions_league.svg');
fs.writeFileSync(p2, svgUcl);
execSync(`ffmpeg -y -i "${p2}" "${path.join(logosDir, 'champions_league.png')}"`);

// 3. beIN SPORTS Logo
const svgBein = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 100" width="280" height="100">
  <rect x="5" y="10" width="270" height="80" rx="18" fill="#2e1065" stroke="#7e22ce" stroke-width="2" />
  <text x="25" y="65" font-family="Arial, sans-serif" font-weight="900" font-size="44" fill="#ffffff">beIN</text>
  <rect x="145" y="24" width="115" height="52" rx="10" fill="#a855f7" />
  <text x="153" y="60" font-family="Arial, sans-serif" font-weight="800" font-size="24" fill="#ffffff">SPORTS</text>
</svg>`;
const p3 = path.join(logosDir, 'bein_sports.svg');
fs.writeFileSync(p3, svgBein);
execSync(`ffmpeg -y -i "${p3}" "${path.join(logosDir, 'bein_sports.png')}"`);

// 4. Al Iraq TV Logo
const svgIraq = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 100" width="240" height="100">
  <rect x="5" y="10" width="230" height="80" rx="18" fill="#991b1b" stroke="#ef4444" stroke-width="2" />
  <polygon points="35,32 35,68 65,50" fill="#ffffff" />
  <text x="85" y="64" font-family="Arial, Tahoma, sans-serif" font-weight="900" font-size="40" fill="#ffffff">العراق</text>
</svg>`;
const p4 = path.join(logosDir, 'al_iraq_tv.svg');
fs.writeFileSync(p4, svgIraq);
execSync(`ffmpeg -y -i "${p4}" "${path.join(logosDir, 'al_iraq_tv.png')}"`);

console.log('All 4 logos generated successfully!');
