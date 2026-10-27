const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const fontsDir = path.join(__dirname, '..', 'public', 'assets', 'fonts');
const iconsDir = path.join(__dirname, '..', 'public', 'assets', 'icons');
const libsDir = path.join(__dirname, '..', 'public', 'js', 'libs');

[fontsDir, iconsDir, libsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const client = url.startsWith('https') ? https : http;
    const request = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 7CAST-Asset-Downloader' } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        return reject(new Error(`Failed to download ${url}: status code ${response.statusCode}`));
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve(dest));
      });
    });
    request.on('error', err => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
}

const fonts = [
  'LamaSans-Regular.otf',
  'LamaSans-Medium.otf',
  'LamaSans-SemiBold.otf',
  'LamaSans-Bold.otf'
];

const icons = [
  'Video.svg',
  'Monitor.svg',
  'Flash.svg',
  'Tick-Circle.svg',
  'X-Circle.svg',
  'Setting.svg',
  'Trash Bin.svg',
  'Edit.svg',
  'Copy.svg',
  'Key.svg',
  'Lock.svg',
  'Unlock.svg',
  'Login.svg',
  'Logout.svg',
  'TV.svg',
  'Rocket.svg',
  'Chart.svg',
  'Volume-High.svg',
  'Volume-Low.svg',
  'Volume.svg',
  'Shield-Done.svg',
  'Attention-Triangle.svg',
  'Info-Circle.svg',
  'Arrow-Right.svg',
  'Arrow-Left.svg',
  'Arrow-Down.svg',
  'Arrow-Up.svg',
  'Download.svg',
  'Upload.svg',
  'Category.svg',
  'Bell.svg',
  'Search.svg',
  'Clock.svg',
  'Save.svg'
];

const libs = [
  {
    name: 'hls.min.js',
    url: 'https://cdn.jsdelivr.net/npm/hls.js@latest/dist/hls.min.js'
  },
  {
    name: 'mpegts.js',
    url: 'https://cdn.jsdelivr.net/npm/mpegts.js@latest/dist/mpegts.js'
  }
];

async function run() {
  console.log('Downloading fonts from dev7seen/7ui-icons...');
  for (const font of fonts) {
    const url = `https://raw.githubusercontent.com/dev7seen/7ui-icons/main/fonts/${font}`;
    const dest = path.join(fontsDir, font);
    try {
      await downloadFile(url, dest);
      console.log(`[Font OK] ${font}`);
    } catch (e) {
      console.warn(`[Font Warning] ${font}: ${e.message}`);
    }
  }

  console.log('Downloading icons from dev7seen/7ui-icons...');
  for (const icon of icons) {
    const encodedIcon = encodeURIComponent(icon);
    const url = `https://raw.githubusercontent.com/dev7seen/7ui-icons/main/v1/${encodedIcon}`;
    const dest = path.join(iconsDir, icon);
    try {
      await downloadFile(url, dest);
      console.log(`[Icon OK] ${icon}`);
    } catch (e) {
      console.warn(`[Icon Warning] ${icon}: ${e.message}`);
    }
  }

  console.log('Downloading player libraries (hls.js, mpegts.js)...');
  for (const lib of libs) {
    const dest = path.join(libsDir, lib.name);
    try {
      await downloadFile(lib.url, dest);
      console.log(`[Lib OK] ${lib.name}`);
    } catch (e) {
      console.warn(`[Lib Warning] ${lib.name}: ${e.message}`);
    }
  }

  console.log('All assets processed successfully!');
}

run();
