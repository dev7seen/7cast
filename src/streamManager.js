const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const EventEmitter = require('events');
const { shapeArabicText } = require('./arabicShaper');

class StreamManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.channelsFile = path.join(__dirname, '..', 'data', 'channels.json');
    this.channels = [];
    this.processes = new Map(); // channelId -> { proc, status, stats, logs, restartTimer, retryCount, probeInfo }
    this.loadChannels();
  }

  loadChannels() {
    try {
      if (fs.existsSync(this.channelsFile)) {
        const raw = fs.readFileSync(this.channelsFile, 'utf8');
        this.channels = JSON.parse(raw);
      } else {
        this.channels = [];
        this.saveChannels();
      }
    } catch (err) {
      console.error('Error loading channels:', err);
      this.channels = [];
    }
  }

  saveChannels() {
    try {
      const dir = path.dirname(this.channelsFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.channelsFile, JSON.stringify(this.channels, null, 2), 'utf8');
    } catch (err) {
      console.error('Error saving channels:', err);
    }
  }

  formatChannel(ch) {
    const procInfo = this.processes.get(ch.id);
    const status = procInfo ? procInfo.status : (ch.enabled ? 'idle' : 'stopped');
    const hlsFile = path.join(__dirname, '..', 'public', 'hls', ch.id, 'live.m3u8');
    const hasLivePreview = status === 'running' && fs.existsSync(hlsFile);
    return {
      ...ch,
      status,
      stats: procInfo ? procInfo.stats : null,
      probeInfo: procInfo ? procInfo.probeInfo : null,
      livePreviewUrl: hasLivePreview ? `/hls/${ch.id}/live.m3u8` : null
    };
  }

  getChannels() {
    return this.channels.map(ch => this.formatChannel(ch));
  }

  getChannel(id) {
    const ch = this.channels.find(c => c.id === id);
    if (!ch) return null;
    return this.formatChannel(ch);
  }

  addChannel(data) {
    const newChannel = {
      id: 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6),
      name: data.name || 'قناة جديدة',
      group: data.group || 'عام',
      sourceUrl: data.sourceUrl || '',
      sourceType: data.sourceType || 'auto',
      userAgent: data.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      referer: data.referer || '',
      origin: data.origin || '',
      cookie: data.cookie || '',
      authorization: data.authorization || '',
      xForwardedFor: data.xForwardedFor || '',
      host: data.host || '',
      drmKey: data.drmKey || '',
      drmKeyUrl: data.drmKeyUrl || '',
      customHeaders: data.customHeaders || '',
      transcodeMode: data.transcodeMode || 'auto', // auto | force_h264 | direct_copy
      videoCodec: data.videoCodec || 'libx264',
      audioCodec: data.audioCodec || 'aac',
      resolution: data.resolution || 'original', // original | 1080p | 720p | 480p
      preset: data.preset || 'veryfast', // ultrafast | superfast | veryfast | medium
      fpsLimit: data.fpsLimit || 'auto', // auto (30fps) | 60 | 30 | 25
      videoBitrate: data.videoBitrate || '4500k',
      audioBitrate: data.audioBitrate || '160k',
      watermarkEnabled: !!data.watermarkEnabled,
      watermarkText: data.watermarkText || '',
      watermarkPosition: data.watermarkPosition || 'floating_2d',
      watermarkTransition: data.watermarkTransition || 'fade', // fade | instant
      watermarkFadeDuration: data.watermarkFadeDuration ? parseFloat(data.watermarkFadeDuration) : 1.5,
      watermarkFont: data.watermarkFont || 'LamaSans-Bold.otf',
      watermarkFontSize: data.watermarkFontSize ? parseInt(data.watermarkFontSize) : 32,
      watermarkColor: data.watermarkColor || '#ffffff',
      watermarkBg: data.watermarkBg !== false,
      watermarkDisplayMode: data.watermarkDisplayMode || 'always', // always | periodic
      watermarkShowDuration: data.watermarkShowDuration ? parseInt(data.watermarkShowDuration) : 15,
      watermarkHideDuration: data.watermarkHideDuration ? parseInt(data.watermarkHideDuration) : 45,
      watermarkSpeed: data.watermarkSpeed ? parseInt(data.watermarkSpeed) : 40,
      watermarkShadow: data.watermarkShadow === true,
      autoRestart: data.autoRestart !== false,
      restartDelay: data.restartDelay || 3,
      enabled: false,
      logos: Array.isArray(data.logos) ? data.logos : [],
      destinations: Array.isArray(data.destinations) ? data.destinations : [],
      createdAt: Date.now()
    };

    this.channels.push(newChannel);
    this.saveChannels();
    return newChannel;
  }

  updateChannel(id, data) {
    const index = this.channels.findIndex(c => c.id === id);
    if (index === -1) return null;

    const current = this.channels[index];
    const isRunning = this.processes.has(id);

    this.channels[index] = {
      ...current,
      ...data,
      id: current.id, // prevent ID change
      createdAt: current.createdAt,
      logos: Array.isArray(data.logos) ? data.logos : (current.logos || []),
      destinations: Array.isArray(data.destinations) ? data.destinations : current.destinations
    };

    this.saveChannels();

    // If channel is running and config changed, restart it
    if (isRunning && data.shouldRestart) {
      this.restartStream(id);
    }

    return this.getChannel(id);
  }

  deleteChannel(id) {
    this.stopStream(id);
    try {
      const hlsDir = path.join(__dirname, '..', 'public', 'hls', id);
      if (fs.existsSync(hlsDir)) {
        fs.rmSync(hlsDir, { recursive: true, force: true });
      }
    } catch (e) {}
    const index = this.channels.findIndex(c => c.id === id);
    if (index !== -1) {
      this.channels.splice(index, 1);
      this.saveChannels();
      return true;
    }
    return false;
  }

  // FFprobe Source Analyzer
  async probeSource(url, options = {}) {
    return new Promise((resolve) => {
      const ffprobeCmd = this.config.ffprobePath || 'ffprobe';
      const args = [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        '-analyzeduration', '8000000',
        '-probesize', '8000000'
      ];

      // Headers injection
      let headersStr = '';
      if (options.userAgent) {
        args.push('-user_agent', options.userAgent.trim());
      }
      if (options.referer && options.referer.trim()) {
        headersStr += `Referer: ${options.referer.trim()}\r\n`;
      }
      if (options.origin && options.origin.trim()) {
        headersStr += `Origin: ${options.origin.trim()}\r\n`;
      }
      if (options.cookie && options.cookie.trim()) {
        headersStr += `Cookie: ${options.cookie.trim()}\r\n`;
      }
      if (options.authorization && options.authorization.trim()) {
        headersStr += `Authorization: ${options.authorization.trim()}\r\n`;
      }
      if (options.xForwardedFor && options.xForwardedFor.trim()) {
        headersStr += `X-Forwarded-For: ${options.xForwardedFor.trim()}\r\n`;
      }
      if (options.host && options.host.trim()) {
        headersStr += `Host: ${options.host.trim()}\r\n`;
      }
      if (options.customHeaders && options.customHeaders.trim()) {
        headersStr += options.customHeaders.trim() + '\r\n';
      }
      if (headersStr) {
        args.push('-headers', headersStr);
      }
      if (options.drmKey && options.drmKey.trim()) {
        args.push('-decryption_key', options.drmKey.trim());
      }

      args.push(url);

      execFile(ffprobeCmd, args, { timeout: 15000 }, (err, stdout) => {
        if (err || !stdout) {
          return resolve({
            success: false,
            error: err ? err.message : 'لم يتم العثور على بيانات المصدر'
          });
        }

        try {
          const data = JSON.parse(stdout);
          const videoStream = (data.streams || []).find(s => s.codec_type === 'video');
          const audioStream = (data.streams || []).find(s => s.codec_type === 'audio');

          const probeInfo = {
            success: true,
            format: data.format ? data.format.format_name : 'unknown',
            duration: data.format ? data.format.duration : null,
            bitrate: data.format && data.format.bit_rate ? Math.round(data.format.bit_rate / 1000) + ' kbps' : 'N/A',
            video: videoStream ? {
              codec: videoStream.codec_name,
              profile: videoStream.profile,
              width: videoStream.width,
              height: videoStream.height,
              resolution: videoStream.width && videoStream.height ? `${videoStream.width}x${videoStream.height}` : 'N/A',
              fps: videoStream.r_frame_rate ? evalFps(videoStream.r_frame_rate) : 'N/A',
              pixelFormat: videoStream.pix_fmt
            } : null,
            audio: audioStream ? {
              codec: audioStream.codec_name,
              channels: audioStream.channels,
              sampleRate: audioStream.sample_rate ? audioStream.sample_rate + ' Hz' : 'N/A',
              bitrate: audioStream.bit_rate ? Math.round(audioStream.bit_rate / 1000) + ' kbps' : 'N/A'
            } : null
          };

          resolve(probeInfo);
        } catch (parseErr) {
          resolve({
            success: false,
            error: 'فشل في تحليل مخرجات ffprobe: ' + parseErr.message
          });
        }
      });
    });
  }

  async startStream(id) {
    const channel = this.channels.find(c => c.id === id);
    if (!channel) throw new Error('القناة غير موجودة');

    // If already running, do nothing
    const existing = this.processes.get(id);
    if (existing && existing.status === 'running') {
      return this.getChannel(id);
    }

    // Check active destinations
    const activeDestinations = (channel.destinations || []).filter(d => d.enabled && d.url && d.url.trim());
    if (activeDestinations.length === 0) {
      throw new Error('لا توجد مخارج بث (RTMP/RTMPS) مفعلة لهذه القناة');
    }

    channel.enabled = true;
    this.saveChannels();

    const procState = {
      proc: null,
      status: 'starting',
      stats: {
        fps: 0,
        bitrate: '0 kbps',
        speed: '0x',
        time: '00:00:00',
        dropped: 0,
        uptime: 0,
        startTime: Date.now()
      },
      logs: [],
      restartTimer: null,
      retryCount: existing ? existing.retryCount : 0,
      probeInfo: null,
      transcodeReason: ''
    };
    this.processes.set(id, procState);
    this.emit('status', { channelId: id, status: 'starting' });

    // Step 1: Probe the source to determine Smart Adaptive Transcoding
    let probe = null;
    if (channel.transcodeMode === 'auto') {
      this.appendLog(id, '[7CAST] جاري فحص كوديك المصدر لتطبيق الترميز الذكي...');
      probe = await this.probeSource(channel.sourceUrl, {
        userAgent: channel.userAgent,
        referer: channel.referer,
        customHeaders: channel.customHeaders,
        drmKey: channel.drmKey
      });
      procState.probeInfo = probe;
    }

    // Step 2: Build FFmpeg arguments
    const { args, transcodeBadge } = this.buildFfmpegArgs(channel, probe, activeDestinations);
    procState.transcodeBadge = transcodeBadge;
    this.appendLog(id, `[7CAST] وضع المعالجة: ${transcodeBadge}`);
    this.appendLog(id, `[7CAST] الوجهات المستهدفة (${activeDestinations.length}): ${activeDestinations.map(d => d.name).join(' | ')}`);

    const ffmpegCmd = this.config.ffmpegPath || 'ffmpeg';

    try {
      const proc = spawn(ffmpegCmd, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      procState.proc = proc;
      procState.status = 'running';
      this.emit('status', { channelId: id, status: 'running', transcodeBadge });

      // Handle stderr (FFmpeg outputs logs & progress on stderr)
      let buffer = '';
      proc.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        buffer += text;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop(); // keep last incomplete line

        for (const line of lines) {
          if (!line.trim()) continue;
          this.appendLog(id, line);
          this.parseFfmpegStats(id, line);

          if (line.includes('Slave muxer') && line.includes('failed')) {
            this.appendLog(id, `⚠️ [7CAST تنبيه] تعذر الاتصال بأحد مخارج البث أو انقطع الاتصال به (يرجى التأكد من فتح نافذة البث المباشر في المنصة أو تجديد المفتاح)، ويستمر البث للمخارج الأخرى المتبقية بنجاح دون انقطاع.`);
          }

          if (line.includes('error=End of file') || (line.includes('Will reconnect') && line.includes('error='))) {
            const now = Date.now();
            if (!procState.lastEofNotice || (now - procState.lastEofNotice > 30000)) {
              procState.lastEofNotice = now;
              this.appendLog(id, `📡 [7CAST تنبيه المصدر] تم استلام إشارة نهاية التدفق (End of File) من السيرفر المصدر - جاري محاولة استئناف الجلب المباشر تلقائياً...`);
            }
          }
        }
      });

      proc.on('error', (err) => {
        this.appendLog(id, `[7CAST ERROR] فشل تشغيل FFmpeg: ${err.message}`);
        procState.status = 'error';
        this.emit('status', { channelId: id, status: 'error', error: err.message });
      });

      proc.on('close', (code) => {
        this.appendLog(id, `[7CAST] توقفت عملية البث برمز الخروج: ${code}`);
        procState.proc = null;
        procState.status = 'stopped';
        this.emit('status', { channelId: id, status: 'stopped', exitCode: code });

        // Auto restart handling if channel is still enabled
        if (channel.enabled && channel.autoRestart) {
          const delay = (channel.restartDelay || 3) * 1000;
          procState.retryCount = (procState.retryCount || 0) + 1;
          this.appendLog(id, `[7CAST] ستتم إعادة الاتصال تلقائياً بعد ${channel.restartDelay || 3} ثوانٍ (محاولة رقم ${procState.retryCount})...`);
          procState.restartTimer = setTimeout(() => {
            if (channel.enabled) {
              this.startStream(id).catch(err => {
                this.appendLog(id, `[7CAST RESTART ERROR] ${err.message}`);
              });
            }
          }, delay);
        }
      });

    } catch (err) {
      this.appendLog(id, `[7CAST SPAWN ERROR] ${err.message}`);
      procState.status = 'error';
      throw err;
    }

    return this.getChannel(id);
  }

  stopStream(id) {
    const channel = this.channels.find(c => c.id === id);
    if (channel) {
      channel.enabled = false;
      this.saveChannels();
    }

    const procInfo = this.processes.get(id);
    if (!procInfo) return;

    if (procInfo.restartTimer) {
      clearTimeout(procInfo.restartTimer);
      procInfo.restartTimer = null;
    }

    if (procInfo.proc) {
      try {
        procInfo.proc.kill('SIGTERM');
        setTimeout(() => {
          if (procInfo.proc) {
            procInfo.proc.kill('SIGKILL');
          }
        }, 3000);
      } catch (err) {
        console.error('Error stopping stream:', err);
      }
    }

    procInfo.status = 'stopped';
    procInfo.proc = null;

    // Cleanup HLS preview directory
    try {
      const hlsDir = path.join(__dirname, '..', 'public', 'hls', id);
      if (fs.existsSync(hlsDir)) {
        fs.rmSync(hlsDir, { recursive: true, force: true });
      }
    } catch (e) {}

    this.appendLog(id, '[7CAST] تم إيقاف البث يدوياً بواسطة المستخدم.');
    this.emit('status', { channelId: id, status: 'stopped' });
  }

  async restartStream(id) {
    this.stopStream(id);
    await new Promise(r => setTimeout(r, 1000));
    return this.startStream(id);
  }

  buildFfmpegArgs(channel, probe, destinations) {
    const args = [
      '-hide_banner',
      '-loglevel', 'info',
      '-stats'
    ];

    // Robust network reconnect settings with A/V sync protection
    args.push(
      '-fflags', '+genpts+discardcorrupt+nobuffer',
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_on_network_error', '1',
      '-reconnect_on_http_error', '4xx,5xx',
      '-reconnect_delay_max', '4',
      '-rw_timeout', '15000000',
      '-timeout', '15000000',
      '-thread_queue_size', '4096'
    );

    // Headers & user-agent
    if (channel.userAgent && channel.userAgent.trim()) {
      args.push('-user_agent', channel.userAgent.trim());
    }

    let headersStr = '';
    if (channel.referer && channel.referer.trim()) {
      headersStr += `Referer: ${channel.referer.trim()}\r\n`;
    }
    if (channel.origin && channel.origin.trim()) {
      headersStr += `Origin: ${channel.origin.trim()}\r\n`;
    }
    if (channel.cookie && channel.cookie.trim()) {
      headersStr += `Cookie: ${channel.cookie.trim()}\r\n`;
    }
    if (channel.authorization && channel.authorization.trim()) {
      headersStr += `Authorization: ${channel.authorization.trim()}\r\n`;
    }
    if (channel.xForwardedFor && channel.xForwardedFor.trim()) {
      headersStr += `X-Forwarded-For: ${channel.xForwardedFor.trim()}\r\n`;
    }
    if (channel.host && channel.host.trim()) {
      headersStr += `Host: ${channel.host.trim()}\r\n`;
    }
    if (channel.customHeaders && channel.customHeaders.trim()) {
      headersStr += channel.customHeaders.trim() + '\r\n';
    }
    if (headersStr) {
      args.push('-headers', headersStr);
    }

    if (channel.drmKey && channel.drmKey.trim()) {
      args.push('-decryption_key', channel.drmKey.trim());
    }

    // Input URL & Timestamp Normalization
    args.push('-i', channel.sourceUrl);
    args.push('-avoid_negative_ts', 'make_zero');

    // Smart Adaptive Transcoding determination
    let needVideoTranscode = false;
    let needAudioTranscode = false;
    let transcodeBadge = 'DIRECT COPY ⚡';

    const hasWatermark = !!(channel.watermarkEnabled && channel.watermarkText && channel.watermarkText.trim());
    const logosList = (Array.isArray(channel.logos) && channel.logos.length > 0)
      ? channel.logos
      : ((channel.logoEnabled && (channel.logoUrl || channel.logoPath)) ? [{
          url: channel.logoUrl,
          path: channel.logoPath,
          width: channel.logoWidth,
          opacity: channel.logoOpacity,
          rotation: channel.logoRotation,
          origin: channel.logoOrigin,
          x: channel.logoX,
          y: channel.logoY,
          enabled: true
        }] : []);
    const hasLogo = logosList.some(l => l.enabled !== false && (l.url || l.path));
    if (hasWatermark || hasLogo) {
      needVideoTranscode = true;
    }

    const vCodec = probe && probe.video ? probe.video.codec.toLowerCase() : '';
    const aCodec = probe && probe.audio ? probe.audio.codec.toLowerCase() : '';

    if (channel.transcodeMode === 'force_h264') {
      needVideoTranscode = true;
      needAudioTranscode = true;
      if (hasLogo && hasWatermark) transcodeBadge = 'TRANSCODE H.264 + LOGO & WATERMARK ⚡';
      else if (hasLogo) transcodeBadge = 'TRANSCODE H.264 + LOGO OVERLAY ⚡';
      else if (hasWatermark) transcodeBadge = 'TRANSCODE H.264 + WATERMARK ⚡';
      else transcodeBadge = 'TRANSCODING H.264 ⚡';
    } else if (channel.transcodeMode === 'direct_copy' && !hasWatermark && !hasLogo) {
      needVideoTranscode = false;
      needAudioTranscode = false;
      transcodeBadge = 'DIRECT COPY ⚡';
    } else {
      // Auto mode: RTMP standard platforms strictly require H.264 and AAC
      if (vCodec && vCodec !== 'h264') {
        needVideoTranscode = true;
        transcodeBadge = hasLogo
          ? `TRANSCODING ${vCodec.toUpperCase()} ➔ H.264 + LOGO ⚡`
          : (hasWatermark ? `TRANSCODING ${vCodec.toUpperCase()} ➔ H.264 + WATERMARK ⚡` : `TRANSCODING ${vCodec.toUpperCase()} ➔ H.264 ⚡`);
      } else if (hasLogo && hasWatermark) {
        transcodeBadge = 'TRANSCODE H.264 + LOGO & WATERMARK ⚡';
      } else if (hasLogo) {
        transcodeBadge = 'TRANSCODE H.264 + LOGO OVERLAY ⚡';
      } else if (hasWatermark) {
        transcodeBadge = 'TRANSCODING H.264 + WATERMARK ⚡';
      }

      if (aCodec && aCodec !== 'aac') {
        needAudioTranscode = true;
      }
      if (!needVideoTranscode && needAudioTranscode) {
        transcodeBadge = 'AUDIO TRANSCODE (AAC) ⚡';
      } else if (!needVideoTranscode && !needAudioTranscode) {
        transcodeBadge = 'DIRECT COPY (H.264/AAC) ⚡';
      }
    }

    // Video encoding parameters & filters
    if (needVideoTranscode) {
      args.push(
        '-c:v', 'libx264',
        '-preset', channel.preset || 'ultrafast',
        '-tune', 'zerolatency',
        '-threads', '0',
        '-pix_fmt', 'yuv420p',
        '-b:v', channel.videoBitrate || '3500k',
        '-maxrate', channel.videoBitrate || '3500k',
        '-bufsize', (parseInt(channel.videoBitrate || '3500') * 2) + 'k',
        '-g', '60',
        '-keyint_min', '30',
        '-sc_threshold', '0',
        '-fps_mode', 'cfr'
      );

      const baseFilters = [];

      // Frame rate control: 30fps CFR eliminates video lag & guarantees 1:1 real-time sync with audio
      if (channel.fpsLimit === '60') {
        baseFilters.push('fps=60');
      } else if (channel.fpsLimit === '25') {
        baseFilters.push('fps=25');
      } else {
        baseFilters.push('fps=30');
      }

      // Resolution scaling filter
      if (channel.resolution === '720p') {
        baseFilters.push('scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2');
      } else if (channel.resolution === '480p') {
        baseFilters.push('scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2');
      } else if (channel.resolution === '1080p') {
        baseFilters.push('scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2');
      }

      // Multi-Logo Overlay Preparation (Interactive Drag/Drop & Sizing)
      const validLogos = [];
      if (hasLogo) {
        logosList.forEach((item, idx) => {
          if (item.enabled === false) return;
          try {
            let logoFile = item.path || item.logoPath;
            const logoUrl = item.url || item.logoUrl;
            if (!logoFile && logoUrl) {
              logoFile = path.join(__dirname, '..', 'public', logoUrl.replace(/^\//, ''));
            } else if (logoFile && !path.isAbsolute(logoFile)) {
              logoFile = path.join(__dirname, '..', logoFile);
            }

            if (logoFile && fs.existsSync(logoFile)) {
              const escapedLogo = logoFile.replace(/\\/g, '/').replace(/:/g, '\\:');
              const logoWidth = parseInt(item.width || item.logoWidth) || 180;
              const logoOpacity = item.opacity !== undefined ? parseFloat(item.opacity) : (item.logoOpacity !== undefined ? parseFloat(item.logoOpacity) : 1.0);
              const logoRotation = parseInt(item.rotation || item.logoRotation) || 0;
              const logoOrigin = item.origin || item.logoOrigin || 'top_right';
              const logoX = parseInt(item.x !== undefined ? item.x : (item.logoX !== undefined ? item.logoX : 40));
              const logoY = parseInt(item.y !== undefined ? item.y : (item.logoY !== undefined ? item.logoY : 40));

              let xExpr = `main_w-overlay_w-${logoX}`;
              let yExpr = `${logoY}`;

              if (logoOrigin === 'top_left') {
                xExpr = `${logoX}`;
                yExpr = `${logoY}`;
              } else if (logoOrigin === 'bottom_right') {
                xExpr = `main_w-overlay_w-${logoX}`;
                yExpr = `main_h-overlay_h-${logoY}`;
              } else if (logoOrigin === 'bottom_left') {
                xExpr = `${logoX}`;
                yExpr = `main_h-overlay_h-${logoY}`;
              } else if (logoOrigin === 'center') {
                xExpr = `(main_w-overlay_w)/2`;
                yExpr = `(main_h-overlay_h)/2`;
              } else if (logoOrigin === 'custom') {
                xExpr = `${logoX}`;
                yExpr = `${logoY}`;
              }

              let logoPrep = `movie='${escapedLogo}',scale=${logoWidth}:-1,format=rgba`;
              if (logoOpacity < 1.0) {
                logoPrep += `,colorchannelmixer=aa=${logoOpacity}`;
              }
              if (logoRotation !== 0) {
                const rad = `${logoRotation}*PI/180`;
                logoPrep += `,rotate=${rad}:c=none:ow=rotw(${rad}):oh=roth(${rad})`;
              }

              validLogos.push({
                tag: `logo_${idx}`,
                prep: `${logoPrep}[logo_${idx}]`,
                xExpr,
                yExpr
              });
            }
          } catch (logoErr) {
            console.warn('[7CAST Logo Overlay Error]:', logoErr);
          }
        });
      }

      // Animated Watermark / Floating Text Filter Preparation
      let drawtextFilter = '';
      if (hasWatermark) {
        try {
          const shapedText = shapeArabicText(channel.watermarkText.trim());
          const dataDir = path.join(__dirname, '..', 'data');
          if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
          const textFilePath = path.join(dataDir, `watermark_${channel.id}.txt`);
          fs.writeFileSync(textFilePath, shapedText, 'utf8');

          let fontFileName = channel.watermarkFont || 'LamaSans-Bold.otf';
          let fontFilePath = path.join(__dirname, '..', 'public', 'assets', 'fonts', fontFileName);
          if (!fs.existsSync(fontFilePath)) {
            fontFileName = 'LamaSans-Bold.otf';
            fontFilePath = path.join(__dirname, '..', 'public', 'assets', 'fonts', fontFileName);
          }

          const escapedFont = fontFilePath.replace(/\\/g, '/').replace(/:/g, '\\:');
          const escapedTextFile = textFilePath.replace(/\\/g, '/').replace(/:/g, '\\:');

          const fontSize = parseInt(channel.watermarkFontSize) || 32;
          const fontColor = channel.watermarkColor || 'white';
          const speed = parseInt(channel.watermarkSpeed) || 40;
          const speedFactor = Math.max(0.1, speed / 40);

          const useBg = channel.watermarkBg === true;
          const boxOpt = useBg ? ':box=1:boxcolor=black@0.65:boxborderw=8' : ':box=0';
          
          let shadowOpt = ':borderw=0';
          if (channel.watermarkShadow === true) {
            shadowOpt += ':shadowx=1:shadowy=1:shadowcolor=black@0.45';
          } else {
            shadowOpt += ':shadowx=0:shadowy=0';
          }

          const fx = (0.35 * speedFactor).toFixed(3);
          const fy = (0.25 * speedFactor).toFixed(3);

          let xExpr = `(w-tw)/2+sin(t*${fx})*(w-tw)*0.44`;
          let yExpr = `(h-th)/2+cos(t*${fy})*(h-th)*0.40`;

          switch (channel.watermarkPosition) {
            case 'floating_2d':
            default:
              xExpr = `(w-tw)/2+sin(t*${fx})*(w-tw)*0.44`;
              yExpr = `(h-th)/2+cos(t*${fy})*(h-th)*0.40`;
              break;
            case 'floating_center':
              const fcx = (1.0 * speedFactor).toFixed(3);
              const fcy = (0.8 * speedFactor).toFixed(3);
              xExpr = `(w-tw)/2+sin(t*${fcx})*45`;
              yExpr = `(h-th)/2+cos(t*${fcy})*35`;
              break;
            case 'ticker_bottom':
              const tickerSpeed = Math.round(speed * 3.5);
              xExpr = `w-mod(t*${tickerSpeed}\\,w+text_w)`;
              yExpr = 'h-th-30';
              break;
            case 'ticker_top':
              const tickerSpeedTop = Math.round(speed * 3.5);
              xExpr = `w-mod(t*${tickerSpeedTop}\\,w+text_w)`;
              yExpr = '30';
              break;
            case 'center_fixed':
              xExpr = '(w-tw)/2';
              yExpr = '(h-th)/2';
              break;
            case 'corner_tr':
              xExpr = 'w-tw-35';
              yExpr = '35';
              break;
            case 'corner_tl':
              xExpr = '35';
              yExpr = '35';
              break;
            case 'corner_br':
              xExpr = 'w-tw-35';
              yExpr = 'h-th-35';
              break;
            case 'corner_bl':
              xExpr = '35';
              yExpr = 'h-th-35';
              break;
          }

          const transition = channel.watermarkTransition || 'fade';
          const fadeSec = Math.max(0.5, parseFloat(channel.watermarkFadeDuration) || 1.5);

          let enableOpt = '';
          let alphaOpt = '';

          if (channel.watermarkDisplayMode === 'periodic') {
            const showSec = Math.max(2, parseInt(channel.watermarkShowDuration) || 15);
            const hideSec = Math.max(1, parseInt(channel.watermarkHideDuration) || 45);
            const cycle = showSec + hideSec;

            if (transition === 'fade') {
              const safeFade = Math.min(fadeSec, (showSec / 2) - 0.1);
              alphaOpt = `:alpha='clip(min(mod(t\\,${cycle})/${safeFade}\\,(${showSec}-mod(t\\,${cycle}))/${safeFade})\\,0\\,1)'`;
            } else {
              enableOpt = `:enable='between(mod(t\\,${cycle})\\,0\\,${showSec})'`;
            }
          } else {
            if (transition === 'fade') {
              alphaOpt = `:alpha='clip(t/${fadeSec}\\,0\\,1)'`;
            }
          }

          drawtextFilter = `drawtext=fontfile='${escapedFont}':text_shaping=0:textfile='${escapedTextFile}':fontcolor=${fontColor}:fontsize=${fontSize}${boxOpt}${shadowOpt}:x='${xExpr}':y='${yExpr}'${alphaOpt}${enableOpt}`;
        } catch (wmErr) {
          console.error('[7CAST Watermark Error]:', wmErr);
        }
      }

      // Assemble final Filtergraph
      let finalVf = '';
      if (validLogos.length > 0) {
        const filterParts = [];
        filterParts.push(`${baseFilters.join(',')}[v_base]`);

        // Add movie filter inputs
        validLogos.forEach(vl => {
          filterParts.push(vl.prep);
        });

        // Overlay each logo sequentially
        let currentStream = 'v_base';
        validLogos.forEach((vl, idx) => {
          const isLast = (idx === validLogos.length - 1);
          if (isLast && !drawtextFilter) {
            filterParts.push(`[${currentStream}][${vl.tag}]overlay=x='${vl.xExpr}':y='${vl.yExpr}'`);
          } else {
            const nextStream = `v_ov_${idx}`;
            filterParts.push(`[${currentStream}][${vl.tag}]overlay=x='${vl.xExpr}':y='${vl.yExpr}'[${nextStream}]`);
            currentStream = nextStream;
          }
        });

        if (drawtextFilter) {
          filterParts.push(`[${currentStream}]${drawtextFilter}`);
        }

        finalVf = filterParts.join(';');
      } else if (drawtextFilter) {
        finalVf = [...baseFilters, drawtextFilter].join(',');
      } else if (baseFilters.length > 0) {
        finalVf = baseFilters.join(',');
      }

      if (finalVf) {
        args.push('-vf', finalVf);
      }
    } else {
      args.push('-c:v', 'copy', '-tag:v', '7');
    }

    // Audio encoding parameters & Real-time A/V Synchronization
    // In RTMP / FLV multi-streaming (YouTube, OK.ru, Telegram, Twitch, etc.),
    // audio must strictly conform to AAC with standard 44.1kHz stereo headers.
    // The aresample filter (async=1000:min_hard_comp=0.100000:first_pts=0)
    // stretches/trims audio to permanently lock audio PTS to video PTS,
    // totally eliminating audio lag or video drift!
    args.push(
      '-c:a', 'aac',
      '-b:a', channel.audioBitrate || '160k',
      '-ar', '44100',
      '-ac', '2',
      '-af', 'aresample=async=1000:min_hard_comp=0.100000:first_pts=0'
    );

    // Output multi-destination broadcasting & Real-time Live Preview
    // Enterprise Multi-Stream Resilience (like Restream.io):
    // 1. We ALWAYS output a local HLS stream to public/hls/${channel.id}/live.m3u8.
    //    This powers the dashboard live preview player to display the EXACT broadcast
    //    with watermark, animations, and transcoding being sent to RTMP/RTMPS!
    // 2. We output to all enabled RTMP / RTMPS destinations via the 'tee' muxer with [onfail=ignore].
    const hlsDir = path.join(__dirname, '..', 'public', 'hls', channel.id);
    try {
      if (fs.existsSync(hlsDir)) {
        fs.rmSync(hlsDir, { recursive: true, force: true });
      }
      fs.mkdirSync(hlsDir, { recursive: true });
    } catch (e) {
      console.warn('Error creating HLS preview folder:', e);
    }

    const relHlsPath = `public/hls/${channel.id}/live.m3u8`;
    const hlsSlave = `[f=hls:hls_time=2:hls_list_size=3:hls_flags=delete_segments:onfail=ignore]${relHlsPath}`;

    const rtmpSlaves = destinations.map(d => `[f=flv:flvflags=no_duration_filesize:onfail=ignore]${d.url.trim()}`);
    const allSlaves = [hlsSlave, ...rtmpSlaves].join('|');

    args.push('-flags', '+global_header');
    args.push('-map', '0:v');
    args.push('-map', '0:a?');
    // Single-pass async distribution: encode once in memory, fan out via FIFO queues
    args.push('-use_fifo', '1');
    args.push('-f', 'tee', allSlaves);

    return { args, transcodeBadge };
  }

  parseFfmpegStats(id, line) {
    const procInfo = this.processes.get(id);
    if (!procInfo) return;

    // FFmpeg stats line pattern:
    // frame=  124 fps= 29.8 q=-1.0 size=    942kB time=00:00:04.16 bitrate=1853.4kbits/s speed=0.998x drop=0
    if (line.includes('fps=') || line.includes('bitrate=')) {
      const fpsMatch = line.match(/fps=\s*([\d.]+)/);
      const bitrateMatch = line.match(/bitrate=\s*([\d.]+\w+)/);
      const speedMatch = line.match(/speed=\s*([\d.]+x)/);
      const timeMatch = line.match(/time=\s*([\d:.]+)/);
      const dropMatch = line.match(/drop=\s*(\d+)/);

      if (fpsMatch) procInfo.stats.fps = parseFloat(fpsMatch[1]);
      if (bitrateMatch) procInfo.stats.bitrate = bitrateMatch[1];
      if (speedMatch) procInfo.stats.speed = speedMatch[1];
      if (timeMatch) procInfo.stats.time = timeMatch[1].split('.')[0];
      if (dropMatch) procInfo.stats.dropped = parseInt(dropMatch[1]);

      procInfo.stats.uptime = Math.floor((Date.now() - procInfo.stats.startTime) / 1000);

      this.emit('stats', { channelId: id, stats: procInfo.stats });
    }
  }

  appendLog(id, line) {
    const procInfo = this.processes.get(id);
    if (!procInfo) return;

    const timestamp = new Date().toLocaleTimeString('ar-EG');
    const entry = `[${timestamp}] ${line}`;
    procInfo.logs.push(entry);

    if (procInfo.logs.length > 200) {
      procInfo.logs.shift();
    }

    this.emit('log', { channelId: id, log: entry });
  }

  getLogs(id) {
    const procInfo = this.processes.get(id);
    return procInfo ? procInfo.logs : [];
  }
}

function evalFps(fraction) {
  if (!fraction) return 'N/A';
  if (fraction.includes('/')) {
    const parts = fraction.split('/');
    const n = parseFloat(parts[0]);
    const d = parseFloat(parts[1]);
    if (d > 0) return Math.round(n / d) + ' fps';
  }
  return fraction + ' fps';
}

module.exports = StreamManager;
