/**
 * 7CAST - Custom Live Video Player Controller
 * Delivers what is ACTUALLY being broadcasted to RTMP/RTMPS (with watermark, animations & transcode)
 * Features:
 * - Real ON AIR badge & Transcoding badge
 * - Smart Mode Switcher:
 *   1. "مخرج RTMP (مع العلامة)": Plays the exact FFmpeg broadcast stream via low-latency HLS
 *   2. "المصدر الأصلي": Plays the raw incoming source URL via backend proxy
 * - Fast buffering, automatic retry poller, and 1-click start from inside player
 */

export class CustomStreamPlayer {
  constructor(containerEl) {
    this.container = containerEl;
    this.videoEl = null;
    this.wrapper = null;
    this.spinner = null;
    this.mpegtsPlayer = null;
    this.hlsPlayer = null;
    this.currentChannel = null;
    this.isMuted = true;
    this.isPlaying = false;
    this.streamMode = 'live'; // 'live' (RTMP output with watermark) | 'source' (raw input)
    this.pollTimer = null;
  }

  render(channel) {
    this.currentChannel = channel;
    this.destroy(); // cleanup any previous instance

    // 1. Determine REAL broadcast status for the live badge
    const isRunning = channel.status === 'running';
    const isStarting = channel.status === 'starting';

    let liveBadgeClass = 'player-badge-live';
    let liveBadgeHtml = '';

    if (isRunning) {
      liveBadgeHtml = `<span class="live-dot"></span> ON AIR`;
    } else if (isStarting) {
      liveBadgeClass += ' starting';
      liveBadgeHtml = `<span class="live-dot"></span> STARTING...`;
    } else {
      liveBadgeClass += ' offline';
      liveBadgeHtml = `<span class="live-dot"></span> OFFLINE`;
    }

    // 2. Determine REAL transcoding badge info
    let transcodeBadgeClass = 'player-badge-transcode';
    let transcodeText = 'TRANSCODING H.264';
    const hasWatermark = !!(channel.watermarkEnabled && channel.watermarkText && channel.watermarkText.trim());

    if (channel.transcodeMode === 'direct_copy' && !hasWatermark) {
      transcodeBadgeClass += ' direct';
      transcodeText = 'DIRECT COPY (H.264)';
    } else if (channel.transcodeBadge) {
      transcodeText = channel.transcodeBadge.replace(/⚡/g, '').trim();
    } else if (hasWatermark) {
      transcodeText = 'TRANSCODING H.264 + WATERMARK';
    } else if (channel.transcodeMode === 'force_h264') {
      transcodeText = 'TRANSCODING H.264';
    } else {
      transcodeText = 'TRANSCODING H.264';
    }

    // 3. Optional resolution specs chip
    let specsHtml = '';
    if (channel.probeInfo && channel.probeInfo.video && channel.probeInfo.video.resolution) {
      const res = channel.probeInfo.video.resolution;
      const fps = channel.probeInfo.video.fps || '';
      specsHtml = `<div class="player-badge-specs">${res}${fps ? ' • ' + fps : ''}</div>`;
    }

    this.container.innerHTML = `
      <div class="custom-player-wrapper" id="customPlayerWrapper">
        <video class="custom-player-video" id="customVideoEl" playsinline muted autoplay></video>

        <!-- Loading / Buffering Spinner -->
        <div class="player-loading-spinner" id="playerSpinner">
          <div class="spinner-ring"></div>
          <span id="playerSpinnerText">جاري الاتصال بمخرج البث المباشر...</span>
        </div>

        <!-- Top Left: Live Output vs Raw Source Mode Toggle -->
        <div class="player-top-left-overlay">
          <div class="player-mode-toggle" id="playerModeToggle">
            <button type="button" class="mode-pill ${this.streamMode === 'live' ? 'active live-pill' : ''}" id="btnModeLive" title="مخرج البث الفعلي مع العلامة المائية والترميز المرسل للمنصات">
              <span class="live-pulse-dot"></span>
              <span>مخرج RTMP (مع العلامة)</span>
            </button>
            <button type="button" class="mode-pill ${this.streamMode === 'source' ? 'active' : ''}" id="btnModeSource" title="المصدر الأصلي قبل أي معالجة">
              <span>🌐 المصدر الأصلي</span>
            </button>
          </div>
        </div>

        <!-- Top Right Badges Matching Reference Screenshot -->
        <div class="player-top-overlay">
          ${specsHtml}

          <!-- Transcoding Pill Badge (Amber or Emerald for direct) -->
          <div class="${transcodeBadgeClass}" id="playerBadgeTranscode">
            <svg class="bolt-icon" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
            </svg>
            <span>${escapeHtml(transcodeText)}</span>
          </div>

          <!-- ON AIR Pill Badge (Crimson glowing with dot) -->
          <div class="${liveBadgeClass}" id="playerBadgeLive">
            ${liveBadgeHtml}
          </div>
        </div>

        <!-- Bottom Controls Bar Matching User Reference -->
        <div class="player-bottom-overlay">
          <!-- Bottom Left: Fullscreen Button -->
          <div class="player-left-group">
            <button class="player-ctrl-btn" id="btnFullscreen" title="ملء الشاشة" aria-label="ملء الشاشة">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
              </svg>
            </button>
          </div>

          <!-- Bottom Right: Refresh, Mute, Play/Pause -->
          <div class="player-right-group">
            <!-- Refresh Button -->
            <button class="player-ctrl-btn" id="btnRefresh" title="تحديث البث" aria-label="تحديث البث">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
              </svg>
            </button>

            <!-- Mute/Unmute Button -->
            <button class="player-ctrl-btn muted" id="btnMute" title="كتم/تشغيل الصوت" aria-label="الصوت">
              <svg id="iconMuted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 5L6 9H2v6h4l5 4V5z"/>
                <line x1="23" y1="9" x2="17" y2="15"/>
                <line x1="17" y1="9" x2="23" y2="15"/>
              </svg>
              <svg id="iconUnmuted" style="display:none;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
              </svg>
            </button>

            <!-- Play / Pause Button -->
            <button class="player-ctrl-btn" id="btnPlayPause" title="إيقاف مؤقت" aria-label="تشغيل أو إيقاف">
              <svg id="iconPause" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1.5"></rect>
                <rect x="14" y="4" width="4" height="16" rx="1.5"></rect>
              </svg>
              <svg id="iconPlay" style="display:none;" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `;

    this.videoEl = this.container.querySelector('#customVideoEl');
    this.wrapper = this.container.querySelector('#customPlayerWrapper');
    this.spinner = this.container.querySelector('#playerSpinner');

    this.setupEventListeners();
    this.loadStream(channel);
  }

  setupEventListeners() {
    const btnFullscreen = this.container.querySelector('#btnFullscreen');
    const btnRefresh = this.container.querySelector('#btnRefresh');
    const btnMute = this.container.querySelector('#btnMute');
    const btnPlayPause = this.container.querySelector('#btnPlayPause');
    const btnModeLive = this.container.querySelector('#btnModeLive');
    const btnModeSource = this.container.querySelector('#btnModeSource');

    // Mode Toggle
    btnModeLive?.addEventListener('click', () => this.switchMode('live'));
    btnModeSource?.addEventListener('click', () => this.switchMode('source'));

    // Fullscreen Toggle
    btnFullscreen.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        this.wrapper.requestFullscreen().catch(err => {
          console.warn('Fullscreen error:', err);
        });
      } else {
        document.exitFullscreen();
      }
    });

    // Refresh Stream
    btnRefresh.addEventListener('click', () => {
      this.spinner.classList.remove('hidden');
      this.loadStream(this.currentChannel);
    });

    // Mute / Unmute Toggle
    btnMute.addEventListener('click', () => {
      this.isMuted = !this.isMuted;
      this.videoEl.muted = this.isMuted;
      this.updateAudioButtonState();
    });

    // Play / Pause Toggle
    btnPlayPause.addEventListener('click', () => {
      if (this.videoEl.paused) {
        this.videoEl.play();
      } else {
        this.videoEl.pause();
      }
    });

    // Video Element Events
    this.videoEl.addEventListener('playing', () => {
      this.spinner.classList.add('hidden');
      this.isPlaying = true;
      this.updatePlayPauseButtonState();
    });

    this.videoEl.addEventListener('pause', () => {
      this.isPlaying = false;
      this.updatePlayPauseButtonState();
    });

    this.videoEl.addEventListener('waiting', () => {
      this.spinner.classList.remove('hidden');
    });

    this.videoEl.addEventListener('error', (e) => {
      console.warn('Video element error:', e);
      if (this.streamMode === 'source') {
        this.spinner.innerHTML = `
          <div style="color: #ef4444; font-size: 26px;">⚠️</div>
          <span>تعذر تحميل بث المصدر الأصلي.</span>
        `;
      }
    });
  }

  switchMode(mode) {
    if (this.streamMode === mode) return;
    this.streamMode = mode;

    const btnModeLive = this.container.querySelector('#btnModeLive');
    const btnModeSource = this.container.querySelector('#btnModeSource');

    if (btnModeLive && btnModeSource) {
      if (mode === 'live') {
        btnModeLive.className = 'mode-pill active live-pill';
        btnModeSource.className = 'mode-pill';
      } else {
        btnModeLive.className = 'mode-pill';
        btnModeSource.className = 'mode-pill active';
      }
    }

    this.loadStream(this.currentChannel);
  }

  updateAudioButtonState() {
    const btnMute = this.container.querySelector('#btnMute');
    const iconMuted = this.container.querySelector('#iconMuted');
    const iconUnmuted = this.container.querySelector('#iconUnmuted');

    if (this.isMuted) {
      btnMute.classList.add('muted');
      iconMuted.style.display = 'block';
      iconUnmuted.style.display = 'none';
    } else {
      btnMute.classList.remove('muted');
      iconMuted.style.display = 'none';
      iconUnmuted.style.display = 'block';
    }
  }

  updatePlayPauseButtonState() {
    const iconPause = this.container.querySelector('#iconPause');
    const iconPlay = this.container.querySelector('#iconPlay');

    if (this.videoEl.paused) {
      iconPause.style.display = 'none';
      iconPlay.style.display = 'block';
    } else {
      iconPause.style.display = 'block';
      iconPlay.style.display = 'none';
    }
  }

  loadStream(channel) {
    if (!channel) return;
    this.destroyPlayers();
    clearTimeout(this.pollTimer);

    // Remove any previous offline notice
    const oldNotice = this.wrapper.querySelector('#playerOfflineScreen');
    if (oldNotice) oldNotice.remove();

    if (this.streamMode === 'live') {
      if (channel.status !== 'running') {
        this.spinner.classList.add('hidden');
        this.showOfflineNotice(channel);
        return;
      }
      this.loadLiveBroadcastOutput(channel, 1);
    } else {
      this.loadRawSource(channel);
    }
  }

  /**
   * Load the ACTUAL broadcast stream sent to RTMP / RTMPS (with watermark & transcode)
   */
  loadLiveBroadcastOutput(channel, attempt = 1) {
    this.destroyPlayers();
    this.spinner.classList.remove('hidden');
    const spinnerText = this.wrapper.querySelector('#playerSpinnerText');
    if (spinnerText) {
      spinnerText.textContent = attempt > 1 
        ? `جاري تهيئة مخرج البث المباشر والعلامة المائية (${attempt}/10)...` 
        : 'جاري الاتصال بمخرج البث المباشر (مع العلامة المائية)...';
    }

    const liveHlsUrl = `/hls/${channel.id}/live.m3u8?t=${Date.now()}`;

    // Verify manifest availability
    fetch(liveHlsUrl, { method: 'HEAD' })
      .then(res => {
        if (res.ok) {
          this.attachHlsStream(liveHlsUrl);
        } else if (attempt < 10) {
          this.pollTimer = setTimeout(() => {
            if (this.streamMode === 'live' && this.currentChannel && this.currentChannel.id === channel.id) {
              this.loadLiveBroadcastOutput(channel, attempt + 1);
            }
          }, 1200);
        } else {
          this.spinner.innerHTML = `
            <div style="color: #f59e0b; font-size: 26px;">⏳</div>
            <span>جاري تجهيز مخرج البث... انقر على زر التحديث بعد قليل.</span>
          `;
        }
      })
      .catch(() => {
        if (attempt < 10) {
          this.pollTimer = setTimeout(() => {
            if (this.streamMode === 'live' && this.currentChannel && this.currentChannel.id === channel.id) {
              this.loadLiveBroadcastOutput(channel, attempt + 1);
            }
          }, 1200);
        }
      });
  }

  attachHlsStream(hlsUrl) {
    if (window.Hls && window.Hls.isSupported()) {
      try {
        this.hlsPlayer = new window.Hls({
          enableWorker: false,
          lowLatencyMode: true,
          backBufferLength: 15,
          liveSyncDurationCount: 2,
          liveMaxLatencyDurationCount: 4
        });

        this.hlsPlayer.loadSource(hlsUrl);
        this.hlsPlayer.attachMedia(this.videoEl);
        this.hlsPlayer.on(window.Hls.Events.MANIFEST_PARSED, () => {
          this.videoEl.play().catch(e => console.warn('HLS autoplay prevented:', e));
        });

        this.hlsPlayer.on(window.Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case window.Hls.ErrorTypes.NETWORK_ERROR:
                this.hlsPlayer.startLoad();
                break;
              case window.Hls.ErrorTypes.MEDIA_ERROR:
                this.hlsPlayer.recoverMediaError();
                break;
              default:
                this.destroyPlayers();
                break;
            }
          }
        });
        return;
      } catch (err) {
        console.warn('Failed to init HLS player for live output:', err);
      }
    }

    // Native HLS fallback (Safari/macOS/iOS)
    this.videoEl.src = hlsUrl;
    this.videoEl.load();
    this.videoEl.play().catch(e => console.warn('Native video autoplay prevented:', e));
  }

  /**
   * Show friendly offline card when user requests RTMP preview while channel is stopped
   */
  showOfflineNotice(channel) {
    const existing = this.wrapper.querySelector('#playerOfflineScreen');
    if (existing) existing.remove();

    const notice = document.createElement('div');
    notice.className = 'player-offline-screen';
    notice.id = 'playerOfflineScreen';
    notice.innerHTML = `
      <div class="offline-icon">📡</div>
      <div class="offline-title">مخرج البث متوقف حالياً</div>
      <div class="offline-desc">
        مخرج البث الفعلي (المتضمن العلامة المائية المتحركة والترميز المرسل لـ RTMP/RTMPS) يظهر أثناء تشغيل القناة.
      </div>
      <div class="offline-actions">
        <button type="button" class="btn btn-primary btn-sm" id="btnStartFromPlayer">
          <span>🚀</span>
          <span>بدء تشغيل القناة للمعاينة الحية</span>
        </button>
        <button type="button" class="btn btn-secondary btn-sm" id="btnSwitchToSourceFromPlayer">
          <span>🌐</span>
          <span>معاينة رابط المصدر الخام</span>
        </button>
      </div>
    `;

    this.wrapper.appendChild(notice);

    notice.querySelector('#btnStartFromPlayer')?.addEventListener('click', async () => {
      notice.innerHTML = `
        <div class="spinner-ring" style="margin-bottom: 1rem;"></div>
        <div class="offline-title">جاري تشغيل القناة وبدء البث المباشر...</div>
      `;
      try {
        const res = await fetch(`/api/channels/${channel.id}/start`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          channel.status = 'running';
          this.currentChannel.status = 'running';
          this.updateLiveBadge('running', channel.transcodeBadge);
          setTimeout(() => {
            this.loadStream(channel);
          }, 1500);
        } else {
          alert('تعذر تشغيل القناة: ' + (data.error || 'خطأ غير معروف'));
          this.showOfflineNotice(channel);
        }
      } catch (e) {
        alert('فشل الاتصال بالخادم');
        this.showOfflineNotice(channel);
      }
    });

    notice.querySelector('#btnSwitchToSourceFromPlayer')?.addEventListener('click', () => {
      this.switchMode('source');
    });
  }

  /**
   * Load the RAW source stream through proxy (Original fallback)
   */
  loadRawSource(channel) {
    if (!channel || !channel.sourceUrl) return;

    this.destroyPlayers();
    this.spinner.classList.remove('hidden');
    const spinnerText = this.wrapper.querySelector('#playerSpinnerText');
    if (spinnerText) spinnerText.textContent = 'جاري الاتصال بالمصدر الأصلي...';

    const sourceUrl = channel.sourceUrl.trim();
    const token = localStorage.getItem('7cast_token') || '';
    const proxyUrl = `/api/proxy/stream/${channel.id}?t=${Date.now()}&token=${encodeURIComponent(token)}`;

    const isHls = sourceUrl.includes('.m3u8') || channel.sourceType === 'hls';
    const isTs = sourceUrl.includes('.ts') || channel.sourceType === 'ts';

    // 1. TS stream via mpegts.js
    if ((isTs || !isHls) && window.mpegts && window.mpegts.isSupported()) {
      try {
        this.mpegtsPlayer = window.mpegts.createPlayer({
          type: 'm2ts',
          isLive: true,
          url: proxyUrl,
          hasAudio: true,
          hasVideo: true,
          cors: true
        }, {
          enableWorker: false,
          lazyLoad: false,
          liveBufferLatencyChasing: false,
          autoCleanupSourceBuffer: true
        });

        this.mpegtsPlayer.attachMediaElement(this.videoEl);
        this.mpegtsPlayer.load();
        this.mpegtsPlayer.play().catch(e => console.warn('mpegts autoplay prevented:', e));
        return;
      } catch (err) {
        console.warn('Failed to init mpegts player:', err);
      }
    }

    // 2. HLS stream via hls.js
    if (isHls && window.Hls && window.Hls.isSupported()) {
      try {
        this.hlsPlayer = new window.Hls({
          enableWorker: false,
          lowLatencyMode: true,
          backBufferLength: 30
        });

        this.hlsPlayer.loadSource(proxyUrl);
        this.hlsPlayer.attachMedia(this.videoEl);
        this.hlsPlayer.on(window.Hls.Events.MANIFEST_PARSED, () => {
          this.videoEl.play().catch(e => console.warn('HLS autoplay prevented:', e));
        });
        return;
      } catch (err) {
        console.warn('Failed to init Hls player:', err);
      }
    }

    // 3. Fallback: native video playback
    this.videoEl.src = proxyUrl;
    this.videoEl.load();
    this.videoEl.play().catch(e => console.warn('Native video autoplay prevented:', e));
  }

  updateLiveBadge(status, transcodeBadge) {
    const liveBadge = this.container.querySelector('#playerBadgeLive');
    const transcodeEl = this.container.querySelector('#playerBadgeTranscode');

    if (liveBadge) {
      if (status === 'running') {
        liveBadge.className = 'player-badge-live';
        liveBadge.innerHTML = `<span class="live-dot"></span> ON AIR`;
      } else if (status === 'starting') {
        liveBadge.className = 'player-badge-live starting';
        liveBadge.innerHTML = `<span class="live-dot"></span> STARTING...`;
      } else {
        liveBadge.className = 'player-badge-live offline';
        liveBadge.innerHTML = `<span class="live-dot"></span> OFFLINE`;
      }
    }

    if (transcodeEl && transcodeBadge) {
      const cleanText = transcodeBadge.replace(/⚡/g, '').trim();
      const isDirect = cleanText.includes('DIRECT') || cleanText.includes('PASSTHROUGH');
      transcodeEl.className = `player-badge-transcode ${isDirect ? 'direct' : ''}`;
      transcodeEl.innerHTML = `
        <svg class="bolt-icon" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
        </svg>
        <span>${escapeHtml(cleanText)}</span>
      `;
    }
  }

  destroyPlayers() {
    clearTimeout(this.pollTimer);

    if (this.mpegtsPlayer) {
      try {
        this.mpegtsPlayer.pause();
        this.mpegtsPlayer.unload();
        this.mpegtsPlayer.detachMediaElement();
        this.mpegtsPlayer.destroy();
      } catch (e) {}
      this.mpegtsPlayer = null;
    }

    if (this.hlsPlayer) {
      try {
        this.hlsPlayer.destroy();
      } catch (e) {}
      this.hlsPlayer = null;
    }

    if (this.videoEl) {
      this.videoEl.removeAttribute('src');
      this.videoEl.load();
    }
  }

  destroy() {
    this.destroyPlayers();
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
