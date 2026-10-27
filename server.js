const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const config = require('./config.json');
const auth = require('./src/auth');
const StreamManager = require('./src/streamManager');
const { createProxy } = require('./src/proxy');
const systemStats = require('./src/systemStats');
const multer = require('multer');

const fontsDir = path.join(__dirname, 'public', 'assets', 'fonts');
if (!fs.existsSync(fontsDir)) fs.mkdirSync(fontsDir, { recursive: true });

const logosDir = path.join(__dirname, 'public', 'assets', 'logos');
if (!fs.existsSync(logosDir)) fs.mkdirSync(logosDir, { recursive: true });

const uploadLogosDir = path.join(__dirname, 'public', 'uploads', 'logos');
if (!fs.existsSync(uploadLogosDir)) fs.mkdirSync(uploadLogosDir, { recursive: true });

const snapshotsDir = path.join(__dirname, 'public', 'snapshots');
if (!fs.existsSync(snapshotsDir)) fs.mkdirSync(snapshotsDir, { recursive: true });

const fontStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, fontsDir),
  filename: (req, file, cb) => {
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    cb(null, cleanName);
  }
});

const fontUpload = multer({
  storage: fontStorage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.ttf', '.otf', '.woff', '.woff2'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('الملف ليس خطاً صالحاً (يسمح بملفات .ttf أو .otf فقط)'));
    }
  }
});

const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadLogosDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    const cleanName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_\-\u0600-\u06FF]/g, '_');
    cb(null, `${cleanName}_${Date.now()}${ext}`);
  }
});

const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('الملف ليس صورة صالحة (يسمح بملفات PNG, JPG, WEBP, GIF فقط)'));
    }
  }
});

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const streamManager = new StreamManager(config);
const proxyHandler = createProxy(streamManager);

// Basic middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve HLS live preview streams with strict no-cache & correct video MIME types
app.use('/hls', express.static(path.join(__dirname, 'public', 'hls'), {
  setHeaders: (res, filePath) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    if (filePath.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    } else if (filePath.endsWith('.ts')) {
      res.setHeader('Content-Type', 'video/mp2t');
    }
  }
}));

// Serve static frontend assets
app.use(auth.authMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

// ----------------- Auth Routes -----------------
app.get('/api/auth/status', (req, res) => {
  const isFirstRun = auth.isFirstRun();
  res.json({ success: true, isFirstRun });
});

app.post('/api/auth/setup', (req, res) => {
  if (!auth.isFirstRun()) {
    return res.status(400).json({ success: false, error: 'تم تعيين كلمة سر المدير مسبقاً' });
  }
  const { password } = req.body;
  if (!password || password.trim().length < 4) {
    return res.status(400).json({ success: false, error: 'كلمة المرور يجب ألا تقل عن 4 خانات' });
  }
  try {
    const token = auth.setupAdminPassword(password);
    res.setHeader('Set-Cookie', `7cast_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 86400}`);
    return res.json({ success: true, token, message: 'تم تعيين كلمة سر المدير بنجاح!' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  if (auth.isFirstRun()) {
    return res.status(400).json({ success: false, requireSetup: true, error: 'يجب إعداد كلمة سر المدير أولاً' });
  }

  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, error: 'يرجى إدخال كلمة المرور' });
  }

  if (auth.verifyPassword(password)) {
    const token = auth.createSession();
    res.setHeader('Set-Cookie', `7cast_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 86400}`);
    return res.json({ success: true, token });
  }

  return res.status(401).json({ success: false, error: 'كلمة المرور غير صحيحة!' });
});

app.get('/api/auth/check', (req, res) => {
  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.headers.cookie) {
    const cookies = req.headers.cookie.split(';');
    for (const c of cookies) {
      const [name, val] = c.trim().split('=');
      if (name === '7cast_token') {
        token = val;
        break;
      }
    }
  }
  const authenticated = auth.isValidSession(token);
  return res.json({ authenticated });
});

app.post('/api/auth/logout', (req, res) => {
  if (req.userSession) {
    auth.destroySession(req.userSession);
  }
  res.setHeader('Set-Cookie', `7cast_token=; Path=/; HttpOnly; Max-Age=0`);
  return res.json({ success: true });
});

// ----------------- Channels API -----------------
app.get('/api/channels', (req, res) => {
  res.json({ success: true, channels: streamManager.getChannels() });
});

app.get('/api/channels/:id', (req, res) => {
  const channel = streamManager.getChannel(req.params.id);
  if (!channel) return res.status(404).json({ success: false, error: 'القناة غير موجودة' });
  res.json({ success: true, channel });
});

app.post('/api/channels', (req, res) => {
  try {
    const channel = streamManager.addChannel(req.body);
    res.json({ success: true, channel });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/channels/:id', (req, res) => {
  try {
    const updated = streamManager.updateChannel(req.params.id, req.body);
    if (!updated) return res.status(404).json({ success: false, error: 'القناة غير موجودة' });
    res.json({ success: true, channel: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/channels/:id', (req, res) => {
  const ok = streamManager.deleteChannel(req.params.id);
  if (!ok) return res.status(404).json({ success: false, error: 'القناة غير موجودة' });
  res.json({ success: true });
});

app.post('/api/channels/:id/start', async (req, res) => {
  try {
    const channel = await streamManager.startStream(req.params.id);
    res.json({ success: true, channel });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/channels/:id/stop', (req, res) => {
  try {
    streamManager.stopStream(req.params.id);
    res.json({ success: true, channel: streamManager.getChannel(req.params.id) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/channels/:id/restart', async (req, res) => {
  try {
    const channel = await streamManager.restartStream(req.params.id);
    res.json({ success: true, channel });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/channels/:id/logs', (req, res) => {
  const logs = streamManager.getLogs(req.params.id);
  res.json({ success: true, logs });
});

app.post('/api/channels/probe', async (req, res) => {
  const { url, userAgent, referer, customHeaders, drmKey } = req.body;
  if (!url) return res.status(400).json({ success: false, error: 'يرجى إدخال رابط المصدر' });

  const result = await streamManager.probeSource(url, {
    userAgent,
    referer,
    customHeaders,
    drmKey
  });

  res.json(result);
});

// ----------------- Live Video Proxy -----------------
app.all('/api/proxy/stream/:channelId', proxyHandler);

// ----------------- System & Metrics -----------------
app.get('/api/system/stats', (req, res) => {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  const channels = streamManager.getChannels();
  const activeStreams = channels.filter(c => c.status === 'running').length;
  let totalDestinations = 0;
  channels.forEach(c => {
    if (c.status === 'running' && Array.isArray(c.destinations)) {
      totalDestinations += c.destinations.filter(d => d.enabled).length;
    }
  });

  let ffmpegVersion = 'N/A';
  try {
    const out = execSync(`${config.ffmpegPath || 'ffmpeg'} -version`, { timeout: 3000 }).toString();
    const match = out.match(/ffmpeg version ([^\s]+)/);
    if (match) ffmpegVersion = match[1];
  } catch (e) {
    ffmpegVersion = 'Installed';
  }

  const metrics = systemStats.getMetrics();

  res.json({
    success: true,
    metrics,
    stats: {
      uptime: Math.floor(process.uptime()),
      serverUptime: Math.floor(os.uptime()),
      cpuCount: cpus.length,
      cpuModel: cpus[0] ? cpus[0].model : 'CPU',
      cpuUsage: metrics.cpu ? metrics.cpu.usagePercent : 0,
      memory: {
        total: Math.round(totalMem / (1024 * 1024 * 1024) * 10) / 10 + ' GB',
        used: Math.round(usedMem / (1024 * 1024 * 1024) * 10) / 10 + ' GB',
        percent: Math.round((usedMem / totalMem) * 100) + '%'
      },
      activeStreams,
      totalChannels: channels.length,
      totalDestinations,
      port: config.port,
      ffmpegVersion
    }
  });
});

app.get('/api/system/export', (req, res) => {
  const channels = streamManager.channels;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="7cast-backup.json"');
  res.send(JSON.stringify({ version: '1.0.0', exportedAt: new Date().toISOString(), channels }, null, 2));
});

app.post('/api/system/import', (req, res) => {
  try {
    const data = req.body;
    if (!data || !Array.isArray(data.channels)) {
      return res.status(400).json({ success: false, error: 'تنسيق الملف غير صحيح' });
    }
    streamManager.channels = data.channels;
    streamManager.saveChannels();
    res.json({ success: true, count: data.channels.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------- Fonts API -----------------

app.get('/api/fonts', (req, res) => {
  try {
    const files = fs.readdirSync(fontsDir);
    const fonts = files
      .filter(f => ['.ttf', '.otf', '.woff', '.woff2'].includes(path.extname(f).toLowerCase()))
      .map(file => {
        const stats = fs.statSync(path.join(fontsDir, file));
        return {
          filename: file,
          name: path.basename(file, path.extname(file)),
          size: Math.round(stats.size / 1024) + ' KB'
        };
      });
    res.json({ success: true, fonts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/fonts/upload', fontUpload.single('font'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'لم يتم استلام أي ملف خط' });
  }
  const filename = req.file.filename;
  res.json({
    success: true,
    font: {
      filename,
      name: path.basename(filename, path.extname(filename)),
      size: Math.round(req.file.size / 1024) + ' KB'
    }
  });
});

// ----------------- Logos & Snapshot API -----------------

// Get list of uploaded logos ONLY (no fake or dummy logos)
app.get('/api/logos', (req, res) => {
  try {
    const list = [];
    if (fs.existsSync(uploadLogosDir)) {
      const uFiles = fs.readdirSync(uploadLogosDir);
      uFiles.forEach(f => {
        const ext = path.extname(f).toLowerCase();
        if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) {
          const name = path.basename(f, ext).replace(/_\d+$/, '');
          const stat = fs.statSync(path.join(uploadLogosDir, f));
          list.push({
            id: 'upload_' + f,
            name,
            filename: f,
            url: `/uploads/logos/${f}`,
            size: Math.round(stat.size / 1024) + ' KB',
            isBuiltin: false
          });
        }
      });
    }

    res.json({ success: true, logos: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete an uploaded logo
app.delete('/api/logos/:filename', (req, res) => {
  try {
    const safeFile = path.basename(req.params.filename);
    const targetPath = path.join(uploadLogosDir, safeFile);
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
      return res.json({ success: true, message: 'تم حذف الشعار بنجاح' });
    }
    res.status(404).json({ success: false, error: 'الملف غير موجود' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload new logo
app.post('/api/logos/upload', logoUpload.single('logo'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'لم يتم استلام أي ملف شعار' });
  }
  const f = req.file.filename;
  const ext = path.extname(f).toLowerCase();
  const name = path.basename(f, ext).replace(/_\d+$/, '');
  res.json({
    success: true,
    logo: {
      id: 'upload_' + f,
      name,
      filename: f,
      url: `/uploads/logos/${f}`,
      size: Math.round(req.file.size / 1024) + ' KB'
    }
  });
});

// Capture frame snapshot from channel stream
app.get('/api/channels/:id/snapshot', (req, res) => {
  const { id } = req.params;
  const channel = streamManager.getChannel(id);
  if (!channel) {
    return res.status(404).json({ success: false, error: 'القناة غير موجودة' });
  }

  const snapshotFile = path.join(snapshotsDir, `${id}_snapshot.jpg`);
  const ffmpegCmd = config.ffmpegPath || 'ffmpeg';

  // Check if live HLS playlist exists
  const hlsPlaylist = path.join(__dirname, 'public', 'hls', id, 'live.m3u8');
  let cmd = null;
  let isLive = false;

  if (fs.existsSync(hlsPlaylist)) {
    isLive = true;
    cmd = `"${ffmpegCmd}" -y -i "${hlsPlaylist}" -frames:v 1 -q:v 2 "${snapshotFile}"`;
  } else if (channel.sourceUrl) {
    cmd = `"${ffmpegCmd}" -y -rw_timeout 4000000 -timeout 4000000 -i "${channel.sourceUrl}" -frames:v 1 -q:v 2 "${snapshotFile}"`;
  }

  if (cmd) {
    try {
      execSync(cmd, { timeout: 6000, stdio: 'ignore' });
      if (fs.existsSync(snapshotFile)) {
        return res.json({
          success: true,
          snapshotUrl: `/snapshots/${id}_snapshot.jpg?t=${Date.now()}`,
          isLive
        });
      }
    } catch (err) {
      console.warn(`Snapshot capture failed for ${id}, using fallback:`, err.message);
    }
  }

  // Fallback to sample match frame so editor is never blank
  return res.json({
    success: true,
    snapshotUrl: `/assets/sample_match_frame.jpg`,
    isLive: false,
    isFallback: true
  });
});

// Apply or update logo on channel (supports multi-logo array or single logo)
app.post('/api/channels/:id/logo', async (req, res) => {
  const { id } = req.params;
  const channel = streamManager.getChannel(id);
  if (!channel) {
    return res.status(404).json({ success: false, error: 'القناة غير موجودة' });
  }

  let updateData = {};
  if (Array.isArray(req.body.logos)) {
    updateData = {
      logos: req.body.logos,
      logoEnabled: req.body.logos.some(l => l.enabled !== false),
      shouldRestart: true
    };
  } else {
    const {
      logoEnabled,
      logoUrl,
      logoPath,
      logoX,
      logoY,
      logoOrigin,
      logoWidth,
      logoOpacity,
      logoRotation
    } = req.body;

    const singleLogo = {
      id: 'logo_1',
      url: logoUrl || channel.logoUrl || '',
      path: logoPath || channel.logoPath || '',
      x: logoX !== undefined ? parseInt(logoX) : (channel.logoX || 40),
      y: logoY !== undefined ? parseInt(logoY) : (channel.logoY || 40),
      origin: logoOrigin || channel.logoOrigin || 'top_right',
      width: logoWidth !== undefined ? parseInt(logoWidth) : (channel.logoWidth || 180),
      opacity: logoOpacity !== undefined ? parseFloat(logoOpacity) : (channel.logoOpacity !== undefined ? channel.logoOpacity : 1.0),
      rotation: logoRotation !== undefined ? parseInt(logoRotation) : (channel.logoRotation || 0),
      enabled: logoEnabled !== undefined ? !!logoEnabled : true
    };

    updateData = {
      logos: [singleLogo],
      logoEnabled: singleLogo.enabled,
      logoUrl: singleLogo.url,
      logoPath: singleLogo.path,
      logoX: singleLogo.x,
      logoY: singleLogo.y,
      logoOrigin: singleLogo.origin,
      logoWidth: singleLogo.width,
      logoOpacity: singleLogo.opacity,
      logoRotation: singleLogo.rotation,
      shouldRestart: true
    };
  }

  const updated = streamManager.updateChannel(id, updateData);
  res.json({
    success: true,
    message: 'تم تطبيق الشعارات على البث بنجاح!',
    channel: updated
  });
});

// ----------------- WebSocket Real-Time Broadcast -----------------
function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload });
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      client.send(msg);
    }
  });
}

streamManager.on('status', data => broadcast('status', data));
streamManager.on('stats', data => broadcast('stats', data));
streamManager.on('log', data => broadcast('log', data));

// Periodic system stats broadcast every 2 seconds
setInterval(() => {
  if (wss.clients.size > 0) {
    const channels = streamManager.getChannels();
    const activeStreams = channels.filter(c => c.status === 'running').length;
    const metrics = systemStats.getMetrics();
    broadcast('system_tick', {
      activeStreams,
      metrics,
      timestamp: Date.now()
    });
  }
}, 2000);

// Root route redirect to index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const PORT = config.port || 7878;
const HOST = config.host || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log('====================================================');
  console.log(`🚀 7CAST - لوحة إعادة البث المتعددة تعمل الآن بنجاح!`);
  console.log(`📡 الرابط المحلي: http://localhost:${PORT}`);
  console.log(`🔑 كلمة المرور الافتراضية: ${config.authPassword}`);
  console.log(`🛡️ المنفذ: ${PORT}`);
  console.log('====================================================');
});
