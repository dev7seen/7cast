/**
 * 7CAST - Frontend Application Engine
 * Real-time WebSocket events, Stream management & Custom Player integration
 */

import { CustomStreamPlayer } from './player.js';

let channels = [];
let activePlayer = null;
let activeLogChannelId = null;
let ws = null;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initWebSocket();
  initModals();
  initNavigation();
  initEventListeners();
  initLogoEditor();
  loadSystemStats();
  loadChannels();
});

// ----------------- Authentication -----------------
async function initAuth() {
  try {
    const res = await fetch('/api/auth/check');
    const data = await res.json();
    if (!data.authenticated) {
      window.location.href = '/login.html';
    }
  } catch (e) {
    window.location.href = '/login.html';
  }
}

document.getElementById('btnLogout').addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
    localStorage.removeItem('7cast_token');
    window.location.href = '/login.html';
  } catch (e) {
    window.location.href = '/login.html';
  }
});

// ----------------- WebSocket Engine -----------------
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[7CAST] WebSocket متصل بنجاح');
  };

  ws.onmessage = (event) => {
    try {
      const { type, payload } = JSON.parse(event.data);

      if (type === 'status') {
        updateChannelStatus(payload.channelId, payload.status, payload.transcodeBadge);
        if (activePlayer && activePlayer.currentChannel && activePlayer.currentChannel.id === payload.channelId) {
          const oldStatus = activePlayer.currentChannel.status;
          activePlayer.currentChannel.status = payload.status;
          activePlayer.currentChannel.transcodeBadge = payload.transcodeBadge;
          activePlayer.updateLiveBadge(payload.status, payload.transcodeBadge);
          if (payload.status === 'running' && oldStatus !== 'running' && activePlayer.streamMode === 'live') {
            activePlayer.loadStream(activePlayer.currentChannel);
          }
        }
      } else if (type === 'stats') {
        updateChannelStats(payload.channelId, payload.stats);
      } else if (type === 'log') {
        if (activeLogChannelId === payload.channelId) {
          appendLogToTerminal(payload.log);
        }
      } else if (type === 'system_tick') {
        updateTopCounters();
        if (payload.metrics) {
          updateSystemMetrics(payload.metrics);
        }
      }
    } catch (e) {
      console.warn('WS parse error:', e);
    }
  };

  ws.onclose = () => {
    setTimeout(initWebSocket, 3000);
  };
}

function updateSystemMetrics(metrics) {
  if (!metrics) return;

  // CPU Usage
  if (metrics.cpu) {
    const cpuEl = document.getElementById('sysCpuUsage');
    const drawerCpu = document.getElementById('drawerCpuUsage');
    const pct = typeof metrics.cpu.usagePercent === 'number' ? metrics.cpu.usagePercent : 0;
    const cpuColor = pct > 85 ? '#ef4444' : pct > 65 ? '#f59e0b' : '#10b981';

    if (cpuEl) {
      cpuEl.textContent = `${pct}%`;
      cpuEl.style.color = cpuColor;
    }
    if (drawerCpu) {
      drawerCpu.textContent = `${pct}%`;
      drawerCpu.style.color = cpuColor;
    }
  }

  // RAM Usage
  if (metrics.ram) {
    const ramEl = document.getElementById('sysRamUsage');
    const drawerRam = document.getElementById('drawerRamUsage');
    const ramPct = metrics.ram.usagePercent || 0;
    const ramColor = ramPct > 90 ? '#ef4444' : ramPct > 75 ? '#f59e0b' : '#38bdf8';
    const ramText = `${metrics.ram.usedGb} GB / ${metrics.ram.totalGb} GB (${ramPct}%)`;

    if (ramEl) {
      ramEl.textContent = ramText;
      ramEl.style.color = ramColor;
    }
    if (drawerRam) {
      drawerRam.textContent = ramText;
      drawerRam.style.color = ramColor;
    }
  }

  // Uptime
  if (metrics.system && metrics.system.uptime) {
    const upEl = document.getElementById('sysUptime');
    const drawerUp = document.getElementById('drawerUptime');
    if (upEl) upEl.textContent = metrics.system.uptime;
    if (drawerUp) drawerUp.textContent = metrics.system.uptime;
  }
}

// ----------------- Load & Render Channels -----------------
async function loadChannels() {
  try {
    const res = await fetch('/api/channels');
    const data = await res.json();
    if (data.success) {
      channels = data.channels || [];
      renderChannels();
      updateTopCounters();
    }
  } catch (err) {
    showToast('تعذر تحميل قائمة القنوات', 'error');
  }
}

async function loadSystemStats() {
  try {
    const res = await fetch('/api/system/stats');
    const data = await res.json();
    if (data.success && data.metrics) {
      updateSystemMetrics(data.metrics);
    }
  } catch (e) {}
}

function updateTopCounters() {
  const total = channels.length;
  const running = channels.filter(c => c.status === 'running').length;
  let activeDests = 0;
  channels.forEach(c => {
    if (c.status === 'running' && Array.isArray(c.destinations)) {
      activeDests += c.destinations.filter(d => d.enabled).length;
    }
  });

  const statTotal = document.getElementById('statTotalChannels');
  if (statTotal) statTotal.textContent = total;
  const statActive = document.getElementById('statActiveStreams');
  if (statActive) statActive.textContent = running;
  const statDests = document.getElementById('statTotalDestinations');
  if (statDests) statDests.textContent = activeDests;
  const chCountBadge = document.getElementById('channelsCountBadge');
  if (chCountBadge) chCountBadge.textContent = `${total} قنوات`;

  const countStreams = document.getElementById('activeStreamsCount');
  if (countStreams) countStreams.textContent = running;
  const countDests = document.getElementById('activeDestinationsCount');
  if (countDests) countDests.textContent = activeDests;

  // Mobile drawer quick stream count
  const drawerActive = document.getElementById('drawerActiveStreams');
  if (drawerActive) drawerActive.textContent = running;

  const liveDot = document.getElementById('liveDot');
  if (liveDot) {
    liveDot.style.display = running > 0 ? 'block' : 'inline-block';
  }
}

function renderChannels(filterText = '') {
  const container = document.getElementById('channelsListContainer');
  const filtered = channels.filter(c => {
    if (!filterText) return true;
    const txt = filterText.toLowerCase();
    return (c.name && c.name.toLowerCase().includes(txt)) ||
           (c.sourceUrl && c.sourceUrl.toLowerCase().includes(txt)) ||
           (c.group && c.group.toLowerCase().includes(txt));
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📡</div>
        <h3>لا توجد قنوات بث مطابقة</h3>
        <p>قم بإضافة قناة جديدة واضبط مخارج البث (RTMP/RTMPS) للبدء في إعادة التوزيع فوراً.</p>
        <button class="btn btn-primary" id="btnEmptyAdd">
          <span>➕ إضافة قناة جديدة</span>
        </button>
      </div>
    `;
    const btnEmptyAdd = document.getElementById('btnEmptyAdd');
    if (btnEmptyAdd) {
      btnEmptyAdd.addEventListener('click', () => openChannelModal());
    }
    return;
  }

  container.innerHTML = filtered.map(ch => {
    const isRunning = ch.status === 'running';
    const isStarting = ch.status === 'starting';

    // Transcode mode text
    let transcodeLabel = 'تلقائي ذكي ⚡';
    let isDirect = false;
    if (ch.transcodeMode === 'direct_copy') {
      transcodeLabel = 'نسخ مباشر (0% CPU) ⚡';
      isDirect = true;
    } else if (ch.transcodeMode === 'force_h264') {
      transcodeLabel = 'إجباري H.264 ⚡';
    } else if (ch.transcodeBadge) {
      transcodeLabel = ch.transcodeBadge;
    }

    // Destinations tags
    const dests = Array.isArray(ch.destinations) ? ch.destinations : [];
    const destsHtml = dests.map(d => {
      return `
        <div class="dest-tag ${d.enabled ? 'active' : ''}">
          <span class="dot"></span>
          <span>${escapeHtml(d.name || d.platform || 'مخرج')}</span>
        </div>
      `;
    }).join('') || '<span style="font-size:0.8rem; color:var(--text-dim);">لا توجد مخارج محددة</span>';

    // Live Metrics Bar (shown when running)
    const stats = ch.stats || { fps: 0, bitrate: '0 kbps', speed: '1.00x', time: '00:00:00' };
    const metricsHtml = `
      <div class="channel-live-metrics" id="metrics-${ch.id}" style="${isRunning ? 'display:grid;' : 'display:none;'}">
        <div class="live-metric-item">
          <span class="lbl">معدل الإطارات (FPS):</span>
          <span class="val metric-fps">${stats.fps || 0}</span>
        </div>
        <div class="live-metric-item">
          <span class="lbl">معدل البث (Bitrate):</span>
          <span class="val metric-bitrate">${stats.bitrate || '0 kbps'}</span>
        </div>
        <div class="live-metric-item">
          <span class="lbl">سرعة البث (Speed):</span>
          <span class="val metric-speed">${stats.speed || '1.00x'}</span>
        </div>
        <div class="live-metric-item">
          <span class="lbl">مدة البث المتواصل:</span>
          <span class="val metric-time">${stats.time || '00:00:00'}</span>
        </div>
      </div>
    `;

    return `
      <div class="channel-card ${isRunning ? 'is-running' : ''}" id="card-${ch.id}">
        <div class="channel-header">
          <div class="channel-title-group">
            <span class="channel-status-badge ${ch.status || 'stopped'}" id="status-badge-${ch.id}">
              ${ch.status === 'running' ? '● مباشر الآن' : ch.status === 'starting' ? '⏳ جاري البدء...' : '○ متوقف'}
            </span>
            <h3 class="channel-name">${escapeHtml(ch.name)}</h3>
            <span class="channel-group-tag">${escapeHtml(ch.group || 'عام')}</span>
          </div>

          <div class="channel-badges-row">
            <span class="transcode-chip ${isDirect ? 'direct' : ''}" id="badge-transcode-${ch.id}">
              ${transcodeLabel}
            </span>
            <span class="transcode-chip" style="background: rgba(6, 182, 212, 0.12); color: #06b6d4; border-color: rgba(6, 182, 212, 0.3);">
              ${escapeHtml(ch.resolution === 'original' ? 'الدقة الأصلية' : ch.resolution)}
            </span>
            <span class="transcode-chip" style="background: ${ch.watermarkEnabled ? 'rgba(99, 102, 241, 0.15)' : 'rgba(148, 163, 184, 0.1)'}; color: ${ch.watermarkEnabled ? '#818cf8' : '#94a3b8'}; border-color: ${ch.watermarkEnabled ? 'rgba(99, 102, 241, 0.35)' : 'rgba(148, 163, 184, 0.25)'};">
              ${ch.watermarkEnabled ? '🌊 نص عائم مفعّل' : '⚪ بدون نص'}
            </span>
            <span class="transcode-chip" style="background: ${ch.logoEnabled ? 'rgba(225, 29, 72, 0.18)' : 'rgba(148, 163, 184, 0.1)'}; color: ${ch.logoEnabled ? '#fb7185' : '#94a3b8'}; border-color: ${ch.logoEnabled ? 'rgba(225, 29, 72, 0.4)' : 'rgba(148, 163, 184, 0.25)'};">
              ${ch.logoEnabled ? '👑 شعار البث مفعّل' : '⚪ بدون شعار'}
            </span>
          </div>
        </div>

        <div class="channel-body-grid">
          <!-- Source info -->
          <div class="source-info-box">
            <div class="info-label">
              <span class="ui-icon icon-sm icon-video" style="color: #38bdf8;"></span>
              <span style="color: var(--text-main); font-weight: 600;">رابط المصدر:</span>
              <button class="quick-pill" onclick="navigator.clipboard.writeText('${escapeHtml(ch.sourceUrl)}'); alert('تم نسخ رابط المصدر');" style="display: inline-flex; align-items: center; gap: 0.3rem;">
                <span class="ui-icon icon-sm icon-copy" style="color: #38bdf8;"></span>
                <span>نسخ</span>
              </button>
            </div>
            <div class="source-url-text">${escapeHtml(ch.sourceUrl)}</div>
          </div>

          <!-- Destinations info -->
          <div class="destinations-box">
            <div class="info-label">
              <span class="ui-icon icon-sm icon-rocket" style="color: #34d399;"></span>
              <span style="color: var(--text-main); font-weight: 600;">مخارج البث (${dests.filter(d => d.enabled).length} مفعلة من ${dests.length}):</span>
            </div>
            <div class="destination-tags-list">
              ${destsHtml}
            </div>
          </div>
        </div>

        <!-- Realtime Live Metrics -->
        ${metricsHtml}

        <!-- Actions Toolbar -->
        <div class="channel-actions-toolbar">
          ${isRunning ? `
            <button class="btn btn-danger btn-sm btn-action-stop" data-id="${ch.id}">
              <span style="font-size: 0.95rem;">⏹</span>
              <span>إيقاف البث</span>
            </button>
          ` : `
            <button class="btn btn-success btn-sm btn-action-start" data-id="${ch.id}" ${isStarting ? 'disabled' : ''}>
              <span style="font-size: 0.95rem;">▶</span>
              <span>تشغيل البث</span>
            </button>
          `}

          <button class="btn btn-secondary btn-sm btn-action-logo-editor" data-id="${ch.id}" style="color: #fb7185; border-color: rgba(225, 29, 72, 0.4);" title="تعديل الشعار فوق البث بالسحب والإفلات">
            <span style="font-size: 0.95rem;">🎨</span>
            <span>محرر الشعار</span>
          </button>

          <button class="btn btn-primary btn-sm btn-action-preview" data-id="${ch.id}">
            <span class="ui-icon icon-sm icon-preview" style="color: #ffffff;"></span>
            <span>معاينة المشغل</span>
          </button>

          <button class="btn btn-secondary btn-sm btn-action-logs" data-id="${ch.id}">
            <span class="ui-icon icon-sm icon-logs" style="color: #fbbf24;"></span>
            <span>السجل الحي</span>
          </button>

          <button class="btn btn-secondary btn-sm btn-action-edit" data-id="${ch.id}">
            <span class="ui-icon icon-sm icon-edit" style="color: #38bdf8;"></span>
            <span>تعديل</span>
          </button>

          <button class="btn btn-secondary btn-sm btn-action-delete" data-id="${ch.id}" style="color: #f87171;" title="حذف القناة">
            <span class="ui-icon icon-sm icon-trash" style="color: #f87171;"></span>
            <span>حذف</span>
          </button>
        </div>
      </div>
    `;
  }).join('');

  attachCardEvents();
}

// ----------------- Real-Time Updates -----------------
function updateChannelStatus(channelId, status, transcodeBadge) {
  const channel = channels.find(c => c.id === channelId);
  if (channel) {
    channel.status = status;
    if (transcodeBadge) channel.transcodeBadge = transcodeBadge;
  }

  const card = document.getElementById(`card-${channelId}`);
  const badge = document.getElementById(`status-badge-${channelId}`);
  const metrics = document.getElementById(`metrics-${channelId}`);

  if (card && badge) {
    if (status === 'running') {
      card.classList.add('is-running');
      badge.className = 'channel-status-badge running';
      badge.innerHTML = '● مباشر الآن';
      if (metrics) metrics.style.display = 'grid';
    } else if (status === 'starting') {
      badge.className = 'channel-status-badge starting';
      badge.innerHTML = '⏳ جاري البدء...';
    } else {
      card.classList.remove('is-running');
      badge.className = 'channel-status-badge stopped';
      badge.innerHTML = '○ متوقف';
      if (metrics) metrics.style.display = 'none';
    }
  }

  updateTopCounters();
}

function updateChannelStats(channelId, stats) {
  const metrics = document.getElementById(`metrics-${channelId}`);
  if (metrics) {
    metrics.style.display = 'grid';
    const fps = metrics.querySelector('.metric-fps');
    const bitrate = metrics.querySelector('.metric-bitrate');
    const speed = metrics.querySelector('.metric-speed');
    const time = metrics.querySelector('.metric-time');

    if (fps) fps.textContent = stats.fps || 0;
    if (bitrate) bitrate.textContent = stats.bitrate || '0 kbps';
    if (speed) speed.textContent = stats.speed || '1.00x';
    if (time) time.textContent = stats.time || '00:00:00';
  }
}

function appendLogToTerminal(line) {
  const terminal = document.getElementById('terminalWindow');
  if (!terminal) return;

  const div = document.createElement('div');
  div.className = 'terminal-line';
  if (line.includes('ERROR') || line.includes('error')) div.classList.add('error');
  else if (line.includes('warning') || line.includes('WARN')) div.classList.add('warn');
  else if (line.includes('[7CAST]')) div.classList.add('info');

  div.textContent = line;
  terminal.appendChild(div);

  const checkAutoScroll = document.getElementById('checkAutoScrollLogs');
  if (checkAutoScroll && checkAutoScroll.checked) {
    terminal.scrollTop = terminal.scrollHeight;
  }
}

// ----------------- Actions & Handlers -----------------
function attachCardEvents() {
  // Start stream
  document.querySelectorAll('.btn-action-start').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = btn.getAttribute('data-id');
      btn.disabled = true;
      btn.innerHTML = '<span>⏳</span> <span>جاري التشغيل...</span>';
      try {
        const res = await fetch(`/api/channels/${id}/start`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast('تم إطلاق البث بنجاح!', 'success');
          loadChannels();
        } else {
          showToast(data.error || 'فشل تشغيل البث', 'error');
          loadChannels();
        }
      } catch (err) {
        showToast('خطأ في الاتصال بالخادم', 'error');
        loadChannels();
      }
    });
  });

  // Stop stream
  document.querySelectorAll('.btn-action-stop').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = btn.getAttribute('data-id');
      btn.disabled = true;
      btn.innerHTML = '<span>⏳</span> <span>جاري الإيقاف...</span>';
      try {
        const res = await fetch(`/api/channels/${id}/stop`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast('تم إيقاف البث', 'success');
          loadChannels();
        } else {
          showToast(data.error || 'فشل إيقاف البث', 'error');
          loadChannels();
        }
      } catch (err) {
        showToast('خطأ في الاتصال بالخادم', 'error');
        loadChannels();
      }
    });
  });

  // Preview player
  document.querySelectorAll('.btn-action-preview').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const channel = channels.find(c => c.id === id);
      if (channel) {
        openPlayerModal(channel);
      }
    });
  });

  // Live Logs
  document.querySelectorAll('.btn-action-logs').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const channel = channels.find(c => c.id === id);
      if (channel) {
        openLogsModal(channel);
      }
    });
  });

  // Open Logo Editor for specific channel
  document.querySelectorAll('.btn-action-logo-editor').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      switchView('logo-editor');
      selectLogoEditorChannel(id);
    });
  });

  // Edit channel
  document.querySelectorAll('.btn-action-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const channel = channels.find(c => c.id === id);
      if (channel) {
        openChannelModal(channel);
      }
    });
  });

  // Delete channel
  document.querySelectorAll('.btn-action-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      if (confirm('هل أنت متأكد من رغبتك في حذف هذه القناة نهائياً؟')) {
        try {
          const res = await fetch(`/api/channels/${id}`, { method: 'DELETE' });
          const data = await res.json();
          if (data.success) {
            showToast('تم حذف القناة بنجاح', 'success');
            loadChannels();
          }
        } catch (e) {
          showToast('فشل حذف القناة', 'error');
        }
      }
    });
  });
}

// ----------------- Modals Management -----------------
function initModals() {
  // Close buttons
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close-modal');
      closeModal(modalId);
    });
  });

  // Close on outside overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeModal(overlay.id);
      }
    });
  });

  // Tabs inside channel modal
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const pane = document.getElementById(targetTab);
      if (pane) pane.classList.add('active');
    });
  });

  // Quick user-agent presets
  document.querySelectorAll('.quick-pill[data-ua]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('inputUserAgent').value = btn.getAttribute('data-ua');
    });
  });

  // Open Add modal button
  document.getElementById('btnOpenAddChannelModal').addEventListener('click', () => {
    openChannelModal();
  });

  // Open Backup modal button
  document.getElementById('btnOpenBackupModal').addEventListener('click', () => {
    openModal('backupModal');
  });

  // Search input filter
  document.getElementById('searchInput').addEventListener('input', (e) => {
    renderChannels(e.target.value);
  });
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('open');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('open');
    if (id === 'playerModal' && activePlayer) {
      activePlayer.destroy();
      activePlayer = null;
    }
    if (id === 'logsModal') {
      activeLogChannelId = null;
    }
  }
}

// ----------------- Channel Edit / Add Wizard -----------------
function openChannelModal(channel = null) {
  const isEdit = !!channel;
  document.getElementById('channelModalTitle').innerHTML = isEdit
    ? `<span>✏️</span> <span>تعديل القناة: ${escapeHtml(channel.name)}</span>`
    : `<span>➕</span> <span>إضافة قناة بث جديدة</span>`;

  document.getElementById('channelEditId').value = isEdit ? channel.id : '';
  document.getElementById('inputChannelName').value = isEdit ? channel.name : '';
  document.getElementById('inputChannelGroup').value = isEdit ? channel.group : 'عام';
  document.getElementById('inputUserAgent').value = isEdit ? (channel.userAgent || '') : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  document.getElementById('inputReferer').value = isEdit ? (channel.referer || '') : '';
  document.getElementById('inputOrigin').value = isEdit ? (channel.origin || '') : '';
  document.getElementById('inputCookie').value = isEdit ? (channel.cookie || '') : '';
  document.getElementById('inputAuthorization').value = isEdit ? (channel.authorization || '') : '';
  document.getElementById('inputXForwardedFor').value = isEdit ? (channel.xForwardedFor || '') : '';
  document.getElementById('inputHost').value = isEdit ? (channel.host || '') : '';
  document.getElementById('inputDrmKey').value = isEdit ? (channel.drmKey || '') : '';
  document.getElementById('inputDrmKeyUrl').value = isEdit ? (channel.drmKeyUrl || '') : '';
  document.getElementById('inputCustomHeaders').value = isEdit ? (channel.customHeaders || '') : '';

  document.getElementById('selectTranscodeMode').value = isEdit ? channel.transcodeMode : 'auto';
  document.getElementById('selectResolution').value = isEdit ? channel.resolution : 'original';
  document.getElementById('selectPreset').value = isEdit ? channel.preset : 'veryfast';
  document.getElementById('selectFpsLimit').value = isEdit ? (channel.fpsLimit || 'auto') : 'auto';
  document.getElementById('selectVideoBitrate').value = isEdit ? channel.videoBitrate : '4500k';
  document.getElementById('selectAudioBitrate').value = isEdit ? channel.audioBitrate : '160k';
  document.getElementById('checkAutoRestart').checked = isEdit ? (channel.autoRestart !== false) : true;

  // Watermark settings
  const wmEnabled = isEdit ? !!channel.watermarkEnabled : false;
  document.getElementById('checkWatermarkEnabled').checked = wmEnabled;
  toggleWatermarkConfigFields(wmEnabled);

  document.getElementById('inputWatermarkText').value = isEdit ? (channel.watermarkText || '') : '';
  document.getElementById('selectWatermarkPosition').value = isEdit ? (channel.watermarkPosition || 'floating_2d') : 'floating_2d';

  const wmTransition = isEdit ? (channel.watermarkTransition || 'fade') : 'fade';
  document.getElementById('selectWatermarkTransition').value = wmTransition;
  const wmFadeDuration = isEdit && channel.watermarkFadeDuration ? channel.watermarkFadeDuration : 1.5;
  document.getElementById('inputWatermarkFadeDuration').value = wmFadeDuration;
  document.getElementById('lblFadeDuration').textContent = `${wmFadeDuration} ثانية`;
  toggleTransitionFadeGroup(wmTransition);

  const currentFont = isEdit ? (channel.watermarkFont || 'LamaSans-Bold.otf') : 'LamaSans-Bold.otf';
  loadFontsList(currentFont);

  // Timing Display Mode
  const wmDisplayMode = isEdit ? (channel.watermarkDisplayMode || 'always') : 'always';
  document.getElementById('selectWatermarkDisplayMode').value = wmDisplayMode;
  document.getElementById('inputWatermarkShowDuration').value = isEdit && channel.watermarkShowDuration ? channel.watermarkShowDuration : 15;
  document.getElementById('inputWatermarkHideDuration').value = isEdit && channel.watermarkHideDuration ? channel.watermarkHideDuration : 45;
  togglePeriodicTimingGroup(wmDisplayMode);
  updatePeriodicHintText();

  const wmFontSize = isEdit && channel.watermarkFontSize ? channel.watermarkFontSize : 32;
  document.getElementById('inputWatermarkFontSize').value = wmFontSize;
  document.getElementById('lblFontSize').textContent = `${wmFontSize}px`;

  const wmSpeed = isEdit && channel.watermarkSpeed ? channel.watermarkSpeed : 40;
  document.getElementById('inputWatermarkSpeed').value = wmSpeed;
  document.getElementById('lblSpeed').textContent = formatSpeedLabel(wmSpeed);

  const wmColor = isEdit && channel.watermarkColor ? channel.watermarkColor : '#ffffff';
  document.getElementById('inputWatermarkColor').value = wmColor;
  document.getElementById('inputWatermarkColorText').value = wmColor;
  // Default is false (clean text without background box)
  document.getElementById('checkWatermarkBg').checked = isEdit ? (channel.watermarkBg === true) : false;
  // Pure typography without stroke (optional soft shadow)
  const checkWmShadow = document.getElementById('checkWatermarkShadow');
  if (checkWmShadow) {
    checkWmShadow.checked = isEdit ? (channel.watermarkShadow === true) : false;
  }

  document.getElementById('probeResultBox').style.display = 'none';

  // Render destinations
  renderDestinationsList(isEdit && Array.isArray(channel.destinations) ? channel.destinations : []);

  // Reset to first tab
  document.querySelector('.tab-btn[data-tab="tabSource"]').click();

  openModal('channelModal');
}

function renderDestinationsList(destinations) {
  const container = document.getElementById('destinationsContainer');
  container.innerHTML = '';

  if (destinations.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 1.5rem; background: rgba(0,0,0,0.2); border-radius: var(--radius-md); color: var(--text-dim); font-size: 0.88rem;">
        اضغط على الأزرار أعلاه لإضافة وجهات البث (OK.ru, Telegram, YouTube, إلخ)
      </div>
    `;
    return;
  }

  destinations.forEach((dest, idx) => {
    const row = document.createElement('div');
    row.className = 'dest-item-row';
    row.innerHTML = `
      <div style="display: flex; align-items: center; gap: 0.4rem;">
        <input type="checkbox" class="dest-item-check" ${dest.enabled ? 'checked' : ''} title="تفعيل/تعطيل">
        <input type="text" class="form-control form-control-sm dest-item-name" value="${escapeHtml(dest.name || '')}" placeholder="اسم المنصة">
      </div>
      <input type="text" class="form-control form-control-sm ltr dest-item-url" value="${escapeHtml(dest.url || '')}" placeholder="rtmp://... أو rtmps://...">
      <button type="button" class="btn btn-secondary btn-sm dest-item-remove" style="color: #f87171; padding: 0.35rem 0.5rem;" title="حذف">✕</button>
    `;

    row.querySelector('.dest-item-remove').addEventListener('click', () => {
      row.remove();
    });

    container.appendChild(row);
  });
}

function addDestinationRow(name, url) {
  const container = document.getElementById('destinationsContainer');
  if (container.children.length === 1 && container.children[0].textContent.includes('اضغط على الأزرار أعلاه')) {
    container.innerHTML = '';
  }

  const row = document.createElement('div');
  row.className = 'dest-item-row';
  row.innerHTML = `
    <div style="display: flex; align-items: center; gap: 0.4rem;">
      <input type="checkbox" class="dest-item-check" checked title="تفعيل/تعطيل">
      <input type="text" class="form-control form-control-sm dest-item-name" value="${escapeHtml(name)}" placeholder="اسم المنصة">
    </div>
    <input type="text" class="form-control form-control-sm ltr dest-item-url" value="${escapeHtml(url)}" placeholder="rtmp://... أو rtmps://...">
    <button type="button" class="btn btn-secondary btn-sm dest-item-remove" style="color: #f87171; padding: 0.35rem 0.5rem;" title="حذف">✕</button>
  `;

  row.querySelector('.dest-item-remove').addEventListener('click', () => {
    row.remove();
  });

  container.appendChild(row);
}

// ----------------- Platform Preset Adders -----------------
function initEventListeners() {
  document.getElementById('btnAddPlatformOK').addEventListener('click', () => {
    addDestinationRow('OK.ru Live', 'rtmp://vsu.okcdn.ru/input/17351163453153_21061894736609_cobvg34z7q');
  });

  document.getElementById('btnAddPlatformTelegram').addEventListener('click', () => {
    addDestinationRow('Telegram Live', 'rtmps://dc4-1.rtmp.t.me/s/3912844726:chrruO2xmwbeY3VE1K4_gQ');
  });

  document.getElementById('btnAddPlatformYouTube').addEventListener('click', () => {
    addDestinationRow('YouTube Live', 'rtmp://a.rtmp.youtube.com/live2/YOUR_STREAM_KEY');
  });

  document.getElementById('btnAddPlatformFacebook').addEventListener('click', () => {
    addDestinationRow('Facebook Live', 'rtmps://live-api-s.facebook.com:443/rtmp/YOUR_STREAM_KEY');
  });

  document.getElementById('btnAddCustomDest').addEventListener('click', () => {
    addDestinationRow('مخرج مخصص', 'rtmp://');
  });

  // Watermark controls sync
  const wmFontSizeSlider = document.getElementById('inputWatermarkFontSize');
  if (wmFontSizeSlider) {
    wmFontSizeSlider.addEventListener('input', (e) => {
      document.getElementById('lblFontSize').textContent = `${e.target.value}px`;
    });
  }

  const wmSpeedSlider = document.getElementById('inputWatermarkSpeed');
  if (wmSpeedSlider) {
    wmSpeedSlider.addEventListener('input', (e) => {
      document.getElementById('lblSpeed').textContent = formatSpeedLabel(e.target.value);
    });
  }

  const wmColorPicker = document.getElementById('inputWatermarkColor');
  const wmColorText = document.getElementById('inputWatermarkColorText');
  if (wmColorPicker && wmColorText) {
    wmColorPicker.addEventListener('input', (e) => {
      wmColorText.value = e.target.value;
    });
    wmColorText.addEventListener('input', (e) => {
      wmColorPicker.value = e.target.value;
    });
  }

  // Custom Font Upload
  const btnTriggerFontUpload = document.getElementById('btnTriggerFontUpload');
  const inputFileFontUpload = document.getElementById('inputFileFontUpload');
  if (btnTriggerFontUpload && inputFileFontUpload) {
    btnTriggerFontUpload.addEventListener('click', () => {
      inputFileFontUpload.click();
    });

    inputFileFontUpload.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const formData = new FormData();
      formData.append('font', file);

      btnTriggerFontUpload.disabled = true;
      btnTriggerFontUpload.innerHTML = '<span>⏳ جاري الرفع...</span>';

      try {
        const res = await fetch('/api/fonts/upload', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        btnTriggerFontUpload.disabled = false;
        btnTriggerFontUpload.innerHTML = '<span>📤 رفع خط جديد (TTF/OTF)</span>';

        if (data.success && data.font) {
          showToast(`تم رفع الخط بنجاح: ${data.font.name}`, 'success');
          await loadFontsList(data.font.filename);
        } else {
          showToast(data.error || 'فشل رفع الخط', 'error');
        }
      } catch (err) {
        btnTriggerFontUpload.disabled = false;
        btnTriggerFontUpload.innerHTML = '<span>📤 رفع خط جديد (TTF/OTF)</span>';
        showToast('تعذر رفع ملف الخط', 'error');
      }

      inputFileFontUpload.value = '';
    });
  }

  // Watermark Enable Toggle
  const checkWmEnabled = document.getElementById('checkWatermarkEnabled');
  if (checkWmEnabled) {
    checkWmEnabled.addEventListener('change', (e) => {
      toggleWatermarkConfigFields(e.target.checked);
    });
  }

  // Watermark Transition Effect Toggle
  const selectTransition = document.getElementById('selectWatermarkTransition');
  if (selectTransition) {
    selectTransition.addEventListener('change', (e) => {
      toggleTransitionFadeGroup(e.target.value);
    });
  }

  const inputFadeDuration = document.getElementById('inputWatermarkFadeDuration');
  if (inputFadeDuration) {
    inputFadeDuration.addEventListener('input', (e) => {
      document.getElementById('lblFadeDuration').textContent = `${e.target.value} ثانية`;
    });
  }

  // Periodic Timing Toggle & Hint updates
  const selectWatermarkDisplayMode = document.getElementById('selectWatermarkDisplayMode');
  if (selectWatermarkDisplayMode) {
    selectWatermarkDisplayMode.addEventListener('change', (e) => {
      togglePeriodicTimingGroup(e.target.value);
    });
  }

  const inputShowDuration = document.getElementById('inputWatermarkShowDuration');
  const inputHideDuration = document.getElementById('inputWatermarkHideDuration');
  if (inputShowDuration && inputHideDuration) {
    inputShowDuration.addEventListener('input', updatePeriodicHintText);
    inputHideDuration.addEventListener('input', updatePeriodicHintText);
  }

  // Probe Source Button
  document.getElementById('btnProbeSource').addEventListener('click', async () => {
    const url = document.getElementById('inputSourceUrl').value.trim();
    if (!url) {
      alert('يرجى كتابة رابط المصدر أولاً');
      return;
    }

    const btn = document.getElementById('btnProbeSource');
    btn.disabled = true;
    btn.innerHTML = '<span>⏳ جاري الفحص...</span>';

    try {
      const res = await fetch('/api/channels/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          userAgent: document.getElementById('inputUserAgent').value,
          referer: document.getElementById('inputReferer').value,
          origin: document.getElementById('inputOrigin').value,
          cookie: document.getElementById('inputCookie').value,
          authorization: document.getElementById('inputAuthorization').value,
          xForwardedFor: document.getElementById('inputXForwardedFor').value,
          host: document.getElementById('inputHost').value,
          drmKey: document.getElementById('inputDrmKey').value,
          drmKeyUrl: document.getElementById('inputDrmKeyUrl').value,
          customHeaders: document.getElementById('inputCustomHeaders').value
        })
      });

      const data = await res.json();
      btn.disabled = false;
      btn.innerHTML = '<span>🔍 فحص المصدر</span>';

      const box = document.getElementById('probeResultBox');
      const grid = document.getElementById('probeGridContent');

      if (data.success) {
        box.style.display = 'block';
        grid.innerHTML = `
          <div class="probe-cell">
            <span>كوديك الفيديو</span>
            <strong>${data.video ? data.video.codec.toUpperCase() : 'لا يوجد'}</strong>
          </div>
          <div class="probe-cell">
            <span>الدقة والأبعاد</span>
            <strong>${data.video ? data.video.resolution : 'N/A'}</strong>
          </div>
          <div class="probe-cell">
            <span>معدل الإطارات (FPS)</span>
            <strong>${data.video ? data.video.fps : 'N/A'}</strong>
          </div>
          <div class="probe-cell">
            <span>كوديك الصوت</span>
            <strong>${data.audio ? data.audio.codec.toUpperCase() : 'لا يوجد'}</strong>
          </div>
          <div class="probe-cell">
            <span>معدل البت</span>
            <strong>${data.bitrate || 'N/A'}</strong>
          </div>
        `;
        showToast('تم فحص المصدر بنجاح!', 'success');
      } else {
        box.style.display = 'block';
        grid.innerHTML = `<div style="color:#ef4444; padding:0.5rem;">فشل الفحص: ${escapeHtml(data.error || 'خطأ')}</div>`;
      }
    } catch (e) {
      btn.disabled = false;
      btn.innerHTML = '<span>🔍 فحص المصدر</span>';
      showToast('تعذر فحص المصدر', 'error');
    }
  });

  // Save Channel
  document.getElementById('btnSaveChannel').addEventListener('click', async () => {
    const editId = document.getElementById('channelEditId').value;
    const name = document.getElementById('inputChannelName').value.trim();
    const sourceUrl = document.getElementById('inputSourceUrl').value.trim();

    if (!name || !sourceUrl) {
      alert('يرجى ملء اسم القناة ورابط المصدر');
      return;
    }

    // Collect destinations
    const destRows = document.querySelectorAll('#destinationsContainer .dest-item-row');
    const destinations = [];
    destRows.forEach(row => {
      const checked = row.querySelector('.dest-item-check').checked;
      const dName = row.querySelector('.dest-item-name').value.trim();
      const dUrl = row.querySelector('.dest-item-url').value.trim();
      if (dUrl) {
        destinations.push({
          id: 'dst-' + Math.random().toString(36).substr(2, 6),
          name: dName || 'وجهة بث',
          url: dUrl,
          enabled: checked
        });
      }
    });

    const payload = {
      name,
      group: document.getElementById('inputChannelGroup').value.trim() || 'عام',
      sourceUrl,
      userAgent: document.getElementById('inputUserAgent').value.trim(),
      referer: document.getElementById('inputReferer').value.trim(),
      origin: document.getElementById('inputOrigin').value.trim(),
      cookie: document.getElementById('inputCookie').value.trim(),
      authorization: document.getElementById('inputAuthorization').value.trim(),
      xForwardedFor: document.getElementById('inputXForwardedFor').value.trim(),
      host: document.getElementById('inputHost').value.trim(),
      drmKey: document.getElementById('inputDrmKey').value.trim(),
      drmKeyUrl: document.getElementById('inputDrmKeyUrl').value.trim(),
      customHeaders: document.getElementById('inputCustomHeaders').value.trim(),
      transcodeMode: document.getElementById('selectTranscodeMode').value,
      resolution: document.getElementById('selectResolution').value,
      preset: document.getElementById('selectPreset').value,
      fpsLimit: document.getElementById('selectFpsLimit').value,
      videoBitrate: document.getElementById('selectVideoBitrate').value,
      audioBitrate: document.getElementById('selectAudioBitrate').value,
      watermarkEnabled: document.getElementById('checkWatermarkEnabled').checked,
      watermarkText: document.getElementById('inputWatermarkText').value.trim(),
      watermarkPosition: document.getElementById('selectWatermarkPosition').value,
      watermarkTransition: document.getElementById('selectWatermarkTransition').value,
      watermarkFadeDuration: parseFloat(document.getElementById('inputWatermarkFadeDuration').value) || 1.5,
      watermarkFont: document.getElementById('selectWatermarkFont').value,
      watermarkFontSize: parseInt(document.getElementById('inputWatermarkFontSize').value) || 32,
      watermarkSpeed: parseInt(document.getElementById('inputWatermarkSpeed').value) || 40,
      watermarkShadow: document.getElementById('checkWatermarkShadow') ? document.getElementById('checkWatermarkShadow').checked : false,
      watermarkColor: document.getElementById('inputWatermarkColor').value,
      watermarkBg: document.getElementById('checkWatermarkBg').checked,
      watermarkDisplayMode: document.getElementById('selectWatermarkDisplayMode').value,
      watermarkShowDuration: parseInt(document.getElementById('inputWatermarkShowDuration').value) || 15,
      watermarkHideDuration: parseInt(document.getElementById('inputWatermarkHideDuration').value) || 45,
      autoRestart: document.getElementById('checkAutoRestart').checked,
      destinations,
      shouldRestart: true
    };

    try {
      const url = editId ? `/api/channels/${editId}` : '/api/channels';
      const method = editId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (data.success) {
        showToast(editId ? 'تم تحديث القناة بنجاح!' : 'تم إضافة القناة بنجاح!', 'success');
        closeModal('channelModal');
        loadChannels();
      } else {
        alert(data.error || 'حدث خطأ أثناء الحفظ');
      }
    } catch (e) {
      alert('فشل حفظ القناة');
    }
  });

  // Backup & Import
  const importInput = document.getElementById('inputImportFile');
  document.getElementById('btnTriggerImport').addEventListener('click', () => {
    importInput.click();
  });

  importInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const json = JSON.parse(text);

      const res = await fetch('/api/system/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json)
      });

      const data = await res.json();
      if (data.success) {
        showToast(`تم استعادة ${data.count} قنوات بنجاح!`, 'success');
        closeModal('backupModal');
        loadChannels();
      } else {
        alert(data.error || 'فشل الاستيراد');
      }
    } catch (err) {
      alert('الملف غير صالح');
    }
  });

  // Copy Logs
  document.getElementById('btnCopyLogs').addEventListener('click', () => {
    const terminal = document.getElementById('terminalWindow');
    navigator.clipboard.writeText(terminal.innerText).then(() => {
      showToast('تم نسخ السجل إلى الحافظة', 'success');
    });
  });

  // Clear Logs
  document.getElementById('btnClearLogs').addEventListener('click', () => {
    document.getElementById('terminalWindow').innerHTML = '';
  });
}

// ----------------- Live Video Preview Modal -----------------
function openPlayerModal(channel) {
  document.getElementById('playerModalTitle').textContent = `معاينة القناة: ${channel.name}`;
  document.getElementById('playerModalSourceUrl').textContent = channel.sourceUrl;

  const destsList = document.getElementById('playerModalDestinationsList');
  const dests = Array.isArray(channel.destinations) ? channel.destinations : [];
  destsList.innerHTML = dests.map(d => `
    <span class="dest-tag ${d.enabled ? 'active' : ''}">
      <span class="dot"></span>
      <span>${escapeHtml(d.name)}</span>
    </span>
  `).join('');

  const container = document.getElementById('playerContainer');
  activePlayer = new CustomStreamPlayer(container);
  activePlayer.render(channel);

  openModal('playerModal');
}

// ----------------- Live Logs Terminal Modal -----------------
async function openLogsModal(channel) {
  activeLogChannelId = channel.id;
  document.getElementById('logsModalTitle').textContent = `سجل البث الحي: ${channel.name}`;

  const terminal = document.getElementById('terminalWindow');
  terminal.innerHTML = '<div class="terminal-line info">[7CAST] جاري جلب السجلات الحية...</div>';

  openModal('logsModal');

  try {
    const res = await fetch(`/api/channels/${channel.id}/logs`);
    const data = await res.json();
    if (data.success && Array.isArray(data.logs)) {
      terminal.innerHTML = '';
      data.logs.forEach(l => appendLogToTerminal(l));
    }
  } catch (e) {
    appendLogToTerminal('[7CAST ERROR] فشل جلب السجلات');
  }
}

// ----------------- Toast Utility (Zero Emojis / Crisp SVGs) -----------------
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  let iconSvg = '';
  if (type === 'success') {
    iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
  } else if (type === 'error') {
    iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  } else if (type === 'warning') {
    iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  } else {
    iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  }

  toast.innerHTML = `
    <span class="toast-icon-wrap" style="display:inline-flex; align-items:center;">${iconSvg}</span>
    <span class="toast-msg-text">${escapeHtml(message)}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
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

// ----------------- Watermark Font & Periodic Helpers -----------------
function toggleWatermarkConfigFields(enabled) {
  const fields = document.getElementById('watermarkConfigFields');
  const banner = document.getElementById('watermarkDisabledBanner');
  if (fields) {
    fields.style.display = enabled ? 'block' : 'none';
  }
  if (banner) {
    banner.style.display = enabled ? 'none' : 'block';
  }
}

function toggleTransitionFadeGroup(transition) {
  const grp = document.getElementById('groupFadeDuration');
  const hint = document.getElementById('hintTransitionText');
  if (grp) {
    grp.style.display = (transition === 'fade') ? 'block' : 'none';
  }
  if (hint) {
    if (transition === 'fade') {
      hint.textContent = 'سيتلاشى النص تدريجياً للظهور بنعومة، ويثبت طوال مدة العرض وهو يطفو، ثم يتلاشى بنعومة عند الاختفاء.';
    } else {
      hint.textContent = 'سيظهر النص ويختفي بشكل فوري ومباشر دون تأثير تلاشي.';
    }
  }
}

function togglePeriodicTimingGroup(mode) {
  const grp = document.getElementById('groupPeriodicTiming');
  if (grp) {
    grp.style.display = (mode === 'periodic') ? 'block' : 'none';
  }
}

function updatePeriodicHintText() {
  const showEl = document.getElementById('inputWatermarkShowDuration');
  const hideEl = document.getElementById('inputWatermarkHideDuration');
  const hintEl = document.getElementById('hintPeriodicText');
  if (showEl && hideEl && hintEl) {
    const s = parseInt(showEl.value) || 15;
    const h = parseInt(hideEl.value) || 45;
    hintEl.textContent = `سيظهر النص لمدة ${s} ثانية، ثم يختفي لمدة ${h} ثانية، ويتكرر ذلك طوال البث.`;
  }
}

async function loadFontsList(selected = null) {
  const select = document.getElementById('selectWatermarkFont');
  if (!select) return;

  try {
    const res = await fetch('/api/fonts');
    const data = await res.json();
    if (data.success && Array.isArray(data.fonts)) {
      select.innerHTML = '';
      data.fonts.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.filename;
        opt.textContent = `${f.name} (${f.size})`;
        if (selected && selected === f.filename) {
          opt.selected = true;
        }
        select.appendChild(opt);
      });

      if (selected) {
        select.value = selected;
      }
    }
  } catch (err) {
    console.warn('Failed to load fonts:', err);
  }
}

function formatSpeedLabel(speed) {
  const val = parseInt(speed) || 40;
  if (val <= 25) return `بطيء وهادئ (${val})`;
  if (val <= 45) return `متوسط انسيابي (${val})`;
  if (val <= 70) return `سريع نشط (${val})`;
  return `فائق السرعة (${val})`;
}

// =========================================================================
// 7CAST PRO - VIEW NAVIGATION & MOBILE DRAWER ENGINE
// =========================================================================
let currentView = 'dashboard';

function initNavigation() {
  const navItems = document.querySelectorAll('.header-nav-btn[data-view], .header-brand-wrap[data-view]');
  navItems.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const view = btn.getAttribute('data-view');
      switchView(view);
    });
  });

  const btnBack = document.getElementById('btnBackToDashboard');
  if (btnBack) {
    btnBack.addEventListener('click', () => {
      switchView('dashboard');
    });
  }

  // Initialize Mobile Off-Canvas Drawer
  initMobileDrawer();
}

function initMobileDrawer() {
  const btnToggle = document.getElementById('btnToggleMobileDrawer');
  const overlay = document.getElementById('mobileDrawerOverlay');
  const btnClose = document.getElementById('btnCloseMobileDrawer');
  const btnAdd = document.getElementById('btnDrawerAddChannel');
  const navDash = document.getElementById('drawerNavDashboard');
  const navLogo = document.getElementById('drawerNavLogoEditor');
  const btnBackup = document.getElementById('btnDrawerBackup');
  const btnLogout = document.getElementById('btnDrawerLogout');

  const openDrawer = () => {
    if (overlay) overlay.classList.add('open');
  };
  const closeDrawer = () => {
    if (overlay) overlay.classList.remove('open');
  };

  if (btnToggle) btnToggle.addEventListener('click', openDrawer);
  if (btnClose) btnClose.addEventListener('click', closeDrawer);
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeDrawer();
    });
  }

  if (btnAdd) {
    btnAdd.addEventListener('click', () => {
      closeDrawer();
      openChannelModal();
    });
  }

  if (navDash) {
    navDash.addEventListener('click', () => {
      closeDrawer();
      switchView('dashboard');
    });
  }

  if (navLogo) {
    navLogo.addEventListener('click', () => {
      closeDrawer();
      switchView('logo-editor');
    });
  }

  if (btnBackup) {
    btnBackup.addEventListener('click', () => {
      closeDrawer();
      window.location.href = '/api/channels/export';
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
        localStorage.removeItem('7cast_token');
        window.location.href = '/login.html';
      } catch (e) {
        window.location.href = '/login.html';
      }
    });
  }
}

function switchView(viewName) {
  currentView = viewName;

  const viewDashboard = document.getElementById('viewDashboard');
  const viewLogo = document.getElementById('viewLogoEditor');

  // Update active header nav button
  document.querySelectorAll('.header-nav-btn[data-view]').forEach(item => {
    if (item.getAttribute('data-view') === viewName) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  if (viewName === 'logo-editor') {
    if (viewDashboard) viewDashboard.style.display = 'none';
    if (viewLogo) viewLogo.style.display = 'block';

    // Refresh channel select and pick current or first channel
    populateEditorChannelSelect();
  } else {
    if (viewLogo) viewLogo.style.display = 'none';
    if (viewDashboard) viewDashboard.style.display = 'block';
  }
}

// =========================================================================
// 7CAST PRO - MULTI-LOGO LAYERS ENGINE (Canvas, Touch, & Live Hot-Swap)
// =========================================================================
let activeEditorChannelId = null;
let editorLogos = []; // Array of logo layer objects
let activeLayerIndex = 0; // Index of the currently selected layer

function populateEditorChannelSelect() {
  const select = document.getElementById('selectEditorChannel');
  if (!select) return;

  select.innerHTML = '';
  if (channels.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'لا توجد قنوات متاحة';
    select.appendChild(opt);
    return;
  }

  channels.forEach(ch => {
    const opt = document.createElement('option');
    opt.value = ch.id;
    opt.textContent = `${ch.name} (${ch.status === 'running' ? '● مباشر' : '○ متوقف'})`;
    select.appendChild(opt);
  });

  if (!activeEditorChannelId || !channels.some(c => c.id === activeEditorChannelId)) {
    activeEditorChannelId = channels[0].id;
  }

  select.value = activeEditorChannelId;
  loadChannelIntoEditor(activeEditorChannelId);
}

function selectLogoEditorChannel(channelId) {
  activeEditorChannelId = channelId;
  const select = document.getElementById('selectEditorChannel');
  if (select) {
    select.value = channelId;
  }
  loadChannelIntoEditor(channelId);
}

async function loadChannelIntoEditor(channelId) {
  const channel = channels.find(c => c.id === channelId);
  if (!channel) return;

  activeEditorChannelId = channelId;

  // Update header stream labels
  const lblName = document.getElementById('lblEditorStreamName');
  const lblStatus = document.getElementById('lblEditorStreamStatus');
  const txtStatus = document.getElementById('txtEditorLiveStatus');

  if (lblName) lblName.textContent = channel.name || 'stream_preview.mp4';
  if (lblStatus && txtStatus) {
    if (channel.status === 'running') {
      lblStatus.style.background = 'rgba(16, 185, 129, 0.2)';
      lblStatus.style.color = '#34d399';
      txtStatus.textContent = 'بث مباشر نشط';
    } else {
      lblStatus.style.background = 'rgba(148, 163, 184, 0.15)';
      lblStatus.style.color = '#94a3b8';
      txtStatus.textContent = 'البث متوقف (معاينة)';
    }
  }

  // Populate editorLogos from channel
  if (Array.isArray(channel.logos) && channel.logos.length > 0) {
    editorLogos = channel.logos.map((l, idx) => ({
      id: l.id || `layer_${Date.now()}_${idx}`,
      name: l.name || `الشعار ${idx + 1}`,
      url: l.url || '',
      origin: l.origin || 'top_right',
      x: l.x !== undefined ? parseInt(l.x) : 40,
      y: l.y !== undefined ? parseInt(l.y) : 40,
      width: l.width ? parseInt(l.width) : 180,
      opacity: l.opacity !== undefined ? (l.opacity <= 1 ? Math.round(l.opacity * 100) : parseInt(l.opacity)) : 100,
      rotation: l.rotation !== undefined ? parseInt(l.rotation) : 0,
      visible: l.visible !== false,
      fixed: true,
      type: 'image'
    }));
  } else if (channel.logoUrl) {
    editorLogos = [{
      id: 'layer_1',
      name: 'الشعار الرئيسي',
      url: channel.logoUrl,
      origin: channel.logoOrigin || 'top_right',
      x: channel.logoX !== undefined ? parseInt(channel.logoX) : 40,
      y: channel.logoY !== undefined ? parseInt(channel.logoY) : 40,
      width: channel.logoWidth ? parseInt(channel.logoWidth) : 180,
      opacity: channel.logoOpacity !== undefined ? Math.round(parseFloat(channel.logoOpacity) * 100) : 100,
      rotation: channel.logoRotation !== undefined ? parseInt(channel.logoRotation) : 0,
      visible: channel.logoEnabled !== false,
      fixed: true,
      type: 'image'
    }];
  } else {
    // Default initial layer
    editorLogos = [{
      id: 'layer_1',
      name: 'الشعار 1',
      url: '',
      origin: 'top_right',
      x: 40,
      y: 40,
      width: 180,
      opacity: 100,
      rotation: 0,
      visible: true,
      fixed: true,
      type: 'image'
    }];
  }

  activeLayerIndex = editorLogos.length > 0 ? 0 : -1;

  renderLogoLayersList();
  renderCanvasBoxes();
  syncInspectorToActiveLayer();

  // Fetch live stream frame snapshot as reference
  await fetchStreamSnapshot(channelId, false);
}

async function fetchStreamSnapshot(channelId, showToastMsg = true) {
  const btnSnapshot = document.getElementById('btnRefreshStreamSnapshot');
  const imgSnapshot = document.getElementById('canvasSnapshotImg');

  if (btnSnapshot) {
    btnSnapshot.disabled = true;
    btnSnapshot.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin-icon"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
      <span>جاري سحب لقطة حية من البث...</span>
    `;
  }

  try {
    const res = await fetch(`/api/channels/${channelId}/snapshot`);
    const data = await res.json();
    if (data.success && data.snapshotUrl) {
      if (imgSnapshot) {
        imgSnapshot.src = `${data.snapshotUrl}?t=${Date.now()}`;
      }
      if (showToastMsg) {
        showToast(data.isLive ? 'تم التقاط فريم بدقة 1080p من البث كمرجع' : 'تم عرض فريم مرجعي للبث', 'success');
      }
    }
  } catch (err) {
    console.warn('Failed to get snapshot:', err);
  } finally {
    if (btnSnapshot) {
      btnSnapshot.disabled = false;
      btnSnapshot.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        <span>سحب لقطة حية من البث</span>
      `;
    }
  }
}

// ----------------- Layers Management & Rendering -----------------
function renderLogoLayersList() {
  const listContainer = document.getElementById('logoLayersList');
  const countBadge = document.getElementById('lblLayersCount');

  if (countBadge) {
    countBadge.textContent = editorLogos.length;
  }

  if (!listContainer) return;

  if (editorLogos.length === 0) {
    listContainer.innerHTML = `
      <div style="padding: 0.8rem; text-align: center; color: var(--text-dim); font-size: 0.8rem;">
        لا توجد طبقات شعارات مضافة. اضغط على "+ إضافة شعار" للبدء.
      </div>
    `;
    return;
  }

  listContainer.innerHTML = editorLogos.map((layer, idx) => {
    const isActive = idx === activeLayerIndex;
    return `
      <div class="logo-layer-card ${isActive ? 'active' : ''} ${!layer.visible ? 'is-hidden' : ''}" data-layer-idx="${idx}">
        <div class="layer-handle" title="ترتيب الطبقة">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
        </div>
        <div class="layer-thumb">
          ${layer.url 
            ? `<img src="${escapeHtml(layer.url)}" alt="${escapeHtml(layer.name)}">`
            : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`
          }
        </div>
        <div class="layer-info">
          <span class="layer-name">${escapeHtml(layer.name || `شعار ${idx + 1}`)}</span>
          <span class="layer-meta">${layer.width}px · ${formatOriginLabel(layer.origin)}</span>
        </div>
        <div class="layer-actions">
          <button type="button" class="btn-layer-action btn-toggle-vis" data-layer-idx="${idx}" title="${layer.visible ? 'إخفاء الطبقة' : 'إظهار الطبقة'}">
            ${layer.visible
              ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`
              : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
            }
          </button>
          <button type="button" class="btn-layer-action btn-delete-layer" data-layer-idx="${idx}" title="حذف الطبقة">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Wire selection
  listContainer.querySelectorAll('.logo-layer-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-layer-action')) return;
      const idx = parseInt(card.getAttribute('data-layer-idx'));
      if (!isNaN(idx) && idx !== activeLayerIndex) {
        activeLayerIndex = idx;
        renderLogoLayersList();
        renderCanvasBoxes();
        syncInspectorToActiveLayer();
      }
    });
  });

  // Wire visibility toggle
  listContainer.querySelectorAll('.btn-toggle-vis').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-layer-idx'));
      if (!isNaN(idx) && editorLogos[idx]) {
        editorLogos[idx].visible = !editorLogos[idx].visible;
        renderLogoLayersList();
        renderCanvasBoxes();
      }
    });
  });

  // Wire delete layer
  listContainer.querySelectorAll('.btn-delete-layer').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-layer-idx'));
      if (!isNaN(idx) && editorLogos[idx]) {
        editorLogos.splice(idx, 1);
        if (activeLayerIndex >= editorLogos.length) {
          activeLayerIndex = editorLogos.length - 1;
        }
        renderLogoLayersList();
        renderCanvasBoxes();
        syncInspectorToActiveLayer();
      }
    });
  });
}

function formatOriginLabel(origin) {
  switch (origin) {
    case 'top_right': return 'أعلى اليمين';
    case 'top_left': return 'أعلى اليسار';
    case 'top_center': return 'أعلى الوسط';
    case 'bottom_right': return 'أسفل اليمين';
    case 'bottom_left': return 'أسفل اليسار';
    case 'center': return 'مركزي';
    default: return 'أعلى اليمين';
  }
}

// ----------------- Canvas Multi-Box Rendering & Touch / Mouse Interaction -----------------
function renderCanvasBoxes() {
  const stage = document.getElementById('canvasStageWrapper');
  if (!stage) return;

  // Remove existing logo boxes, keep snapshot background image
  stage.querySelectorAll('.interactive-logo-box').forEach(el => el.remove());

  const stageW = stage.clientWidth;
  const stageH = stage.clientHeight;
  if (stageW === 0 || stageH === 0) return;

  editorLogos.forEach((layer, idx) => {
    if (!layer.visible || !layer.url) return;

    const isActive = idx === activeLayerIndex;
    const box = document.createElement('div');
    box.className = `interactive-logo-box ${isActive ? 'active-layer' : ''}`;
    box.setAttribute('data-layer-idx', idx);

    // Calculate box width proportional to 1920x1080 stage
    const cssWidth = Math.round((layer.width / 1920) * stageW);
    box.style.width = `${Math.max(25, cssWidth)}px`;

    // Position calculation
    let cssLeft = 0;
    let cssTop = 0;
    const boxW = cssWidth;
    const boxH = Math.round(cssWidth * 0.55); // estimated initial aspect ratio

    if (layer.origin === 'top_left') {
      cssLeft = Math.round((layer.x / 1920) * stageW);
      cssTop = Math.round((layer.y / 1080) * stageH);
    } else if (layer.origin === 'bottom_right') {
      const rightMargin = Math.round((layer.x / 1920) * stageW);
      const bottomMargin = Math.round((layer.y / 1080) * stageH);
      cssLeft = stageW - boxW - rightMargin;
      cssTop = stageH - boxH - bottomMargin;
    } else if (layer.origin === 'bottom_left') {
      cssLeft = Math.round((layer.x / 1920) * stageW);
      const bottomMargin = Math.round((layer.y / 1080) * stageH);
      cssTop = stageH - boxH - bottomMargin;
    } else if (layer.origin === 'top_center') {
      cssLeft = Math.round((stageW - boxW) / 2);
      cssTop = Math.round((layer.y / 1080) * stageH);
    } else if (layer.origin === 'center') {
      cssLeft = Math.round((stageW - boxW) / 2);
      cssTop = Math.round((stageH - boxH) / 2);
    } else {
      // top_right default
      const rightMargin = Math.round((layer.x / 1920) * stageW);
      cssLeft = stageW - boxW - rightMargin;
      cssTop = Math.round((layer.y / 1080) * stageH);
    }

    cssLeft = Math.max(0, Math.min(cssLeft, stageW - boxW));
    cssTop = Math.max(0, Math.min(cssTop, stageH - boxH));

    box.style.left = `${cssLeft}px`;
    box.style.top = `${cssTop}px`;

    // HTML Content inside box
    box.innerHTML = `
      <div class="logo-box-inner" style="opacity: ${layer.opacity / 100}; transform: rotate(${layer.rotation}deg);">
        <img src="${escapeHtml(layer.url)}" alt="${escapeHtml(layer.name)}">
      </div>
      ${isActive ? `
        <div class="resize-handle handle-tl" data-handle="tl"></div>
        <div class="resize-handle handle-tr" data-handle="tr"></div>
        <div class="resize-handle handle-bl" data-handle="bl"></div>
        <div class="resize-handle handle-br" data-handle="br"></div>
        <div class="active-layer-indicator-tag">${escapeHtml(layer.name || `شعار ${idx + 1}`)}</div>
      ` : ''}
    `;

    // Wire Dragging & Resizing (Touch + Mouse)
    attachBoxInteractivity(box, idx);

    stage.appendChild(box);
  });
}

function getPointerCoordinates(e) {
  if (e.touches && e.touches.length > 0) {
    return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
  }
  return { clientX: e.clientX, clientY: e.clientY };
}

function attachBoxInteractivity(box, layerIdx) {
  const stage = document.getElementById('canvasStageWrapper');

  // 1. DRAG BOX (Mouse and Mobile Touch)
  const onDragStart = (e) => {
    if (e.target.classList.contains('resize-handle')) return;

    // If not active layer, activate it first
    if (activeLayerIndex !== layerIdx) {
      activeLayerIndex = layerIdx;
      renderLogoLayersList();
      renderCanvasBoxes();
      syncInspectorToActiveLayer();
      return;
    }

    const { clientX, clientY } = getPointerCoordinates(e);
    let startX = clientX;
    let startY = clientY;
    let startLeft = box.offsetLeft;
    let startTop = box.offsetTop;

    box.classList.add('is-dragging');
    if (e.cancelable && e.type.startsWith('touch')) {
      e.preventDefault();
    }

    const onDragMove = (moveEvt) => {
      if (moveEvt.cancelable && moveEvt.type.startsWith('touch')) {
        moveEvt.preventDefault();
      }
      const coords = getPointerCoordinates(moveEvt);
      const stageW = stage.clientWidth;
      const stageH = stage.clientHeight;
      const boxW = box.offsetWidth;
      const boxH = box.offsetHeight;

      const deltaX = coords.clientX - startX;
      const deltaY = coords.clientY - startY;

      let newLeft = startLeft + deltaX;
      let newTop = startTop + deltaY;

      newLeft = Math.max(0, Math.min(newLeft, stageW - boxW));
      newTop = Math.max(0, Math.min(newTop, stageH - boxH));

      box.style.left = `${newLeft}px`;
      box.style.top = `${newTop}px`;

      // Update layer coordinates (1920x1080)
      const currentLayer = editorLogos[activeLayerIndex];
      if (currentLayer) {
        const videoXFromRight = Math.round(((stageW - (newLeft + boxW)) / stageW) * 1920);
        const videoYFromTop = Math.round((newTop / stageH) * 1080);

        currentLayer.x = Math.max(0, videoXFromRight);
        currentLayer.y = Math.max(0, videoYFromTop);
        currentLayer.origin = 'top_right';

        const inputX = document.getElementById('inputLogoX');
        const inputY = document.getElementById('inputLogoY');
        if (inputX) inputX.value = currentLayer.x;
        if (inputY) inputY.value = currentLayer.y;

        detectClosestAlignmentGrid(newLeft + boxW / 2, newTop + boxH / 2, stageW, stageH);
      }
    };

    const onDragEnd = () => {
      box.classList.remove('is-dragging');
      window.removeEventListener('mousemove', onDragMove);
      window.removeEventListener('mouseup', onDragEnd);
      window.removeEventListener('touchmove', onDragMove);
      window.removeEventListener('touchend', onDragEnd);
    };

    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
    window.addEventListener('touchmove', onDragMove, { passive: false });
    window.addEventListener('touchend', onDragEnd);
  };

  box.addEventListener('mousedown', onDragStart);
  box.addEventListener('touchstart', onDragStart, { passive: false });

  // 2. CORNER RESIZE HANDLES (Mouse and Mobile Touch)
  box.querySelectorAll('.resize-handle').forEach(handle => {
    const onResizeStart = (e) => {
      e.stopPropagation();
      if (e.cancelable && e.type.startsWith('touch')) {
        e.preventDefault();
      }

      const activeHandle = handle.getAttribute('data-handle');
      const { clientX } = getPointerCoordinates(e);
      let resizeStartX = clientX;
      let resizeStartW = box.offsetWidth;

      const onResizeMove = (moveEvt) => {
        if (moveEvt.cancelable && moveEvt.type.startsWith('touch')) {
          moveEvt.preventDefault();
        }
        const coords = getPointerCoordinates(moveEvt);
        const stageW = stage.clientWidth;
        const deltaX = coords.clientX - resizeStartX;
        let newCssWidth = resizeStartW;

        if (activeHandle === 'tr' || activeHandle === 'br') {
          newCssWidth = resizeStartW + deltaX;
        } else {
          newCssWidth = resizeStartW - deltaX;
        }

        let videoWidth = Math.round((newCssWidth / stageW) * 1920);
        videoWidth = Math.max(40, Math.min(600, videoWidth));

        const currentLayer = editorLogos[activeLayerIndex];
        if (currentLayer) {
          currentLayer.width = videoWidth;

          const sliderSize = document.getElementById('sliderLogoSize');
          const inputSize = document.getElementById('inputLogoSizeNum');
          if (sliderSize) sliderSize.value = videoWidth;
          if (inputSize) inputSize.value = videoWidth;

          const cssW = Math.round((videoWidth / 1920) * stageW);
          box.style.width = `${Math.max(25, cssW)}px`;
        }
      };

      const onResizeEnd = () => {
        window.removeEventListener('mousemove', onResizeMove);
        window.removeEventListener('mouseup', onResizeEnd);
        window.removeEventListener('touchmove', onResizeMove);
        window.removeEventListener('touchend', onResizeEnd);
        renderLogoLayersList(); // update size tag in layers list
      };

      window.addEventListener('mousemove', onResizeMove);
      window.addEventListener('mouseup', onResizeEnd);
      window.addEventListener('touchmove', onResizeMove, { passive: false });
      window.addEventListener('touchend', onResizeEnd);
    };

    handle.addEventListener('mousedown', onResizeStart);
    handle.addEventListener('touchstart', onResizeStart, { passive: false });
  });

  // 3. MOUSE WHEEL ZOOM / SCALING
  box.addEventListener('wheel', (e) => {
    e.preventDefault();
    const currentLayer = editorLogos[activeLayerIndex];
    if (!currentLayer) return;

    const change = e.deltaY < 0 ? 10 : -10;
    currentLayer.width = Math.max(40, Math.min(600, currentLayer.width + change));

    const sliderSize = document.getElementById('sliderLogoSize');
    const inputSize = document.getElementById('inputLogoSizeNum');
    if (sliderSize) sliderSize.value = currentLayer.width;
    if (inputSize) inputSize.value = currentLayer.width;

    const stageW = stage.clientWidth;
    const cssW = Math.round((currentLayer.width / 1920) * stageW);
    box.style.width = `${Math.max(25, cssW)}px`;
    renderLogoLayersList();
  });
}

// ----------------- Inspector Form Sync & Controls -----------------
function syncInspectorToActiveLayer() {
  const currentLayer = editorLogos[activeLayerIndex];
  if (!currentLayer) return;

  const inputX = document.getElementById('inputLogoX');
  const inputY = document.getElementById('inputLogoY');
  const sliderSize = document.getElementById('sliderLogoSize');
  const inputSize = document.getElementById('inputLogoSizeNum');
  const sliderOpacity = document.getElementById('sliderLogoOpacity');
  const inputOpacity = document.getElementById('inputLogoOpacityNum');
  const sliderRot = document.getElementById('sliderLogoRotation');
  const inputRot = document.getElementById('inputLogoRotationNum');
  const checkFixed = document.getElementById('checkLogoFixed');

  if (inputX) inputX.value = currentLayer.x;
  if (inputY) inputY.value = currentLayer.y;
  if (sliderSize) sliderSize.value = currentLayer.width;
  if (inputSize) inputSize.value = currentLayer.width;
  if (sliderOpacity) sliderOpacity.value = currentLayer.opacity;
  if (inputOpacity) inputOpacity.value = currentLayer.opacity;
  if (sliderRot) sliderRot.value = currentLayer.rotation;
  if (inputRot) inputRot.value = currentLayer.rotation;
  if (checkFixed) checkFixed.checked = currentLayer.fixed !== false;

  highlightActiveGridCell(currentLayer.origin);
  highlightActivePreset(currentLayer.origin);

  // Highlight matching saved logo in library
  document.querySelectorAll('#savedLogosGrid .saved-logo-card').forEach(c => {
    if (c.getAttribute('data-url') === currentLayer.url) {
      c.classList.add('active');
    } else {
      c.classList.remove('active');
    }
  });
}

function highlightActiveGridCell(origin) {
  document.querySelectorAll('#alignmentGrid3x3 .grid-cell').forEach(cell => {
    if (cell.getAttribute('data-pos') === origin) {
      cell.classList.add('active');
    } else {
      cell.classList.remove('active');
    }
  });
}

function highlightActivePreset(preset) {
  document.querySelectorAll('.presets-cards-row .preset-card').forEach(card => {
    if (card.getAttribute('data-preset') === preset) {
      card.classList.add('active');
    } else {
      card.classList.remove('active');
    }
  });
}

function applyAlignmentPreset(pos) {
  const currentLayer = editorLogos[activeLayerIndex];
  if (!currentLayer) return;

  currentLayer.origin = pos;
  if (pos === 'top_right') {
    currentLayer.x = 40;
    currentLayer.y = 40;
  } else if (pos === 'top_left') {
    currentLayer.x = 40;
    currentLayer.y = 40;
  } else if (pos === 'top_center') {
    currentLayer.x = 0;
    currentLayer.y = 40;
  } else if (pos === 'bottom_right') {
    currentLayer.x = 40;
    currentLayer.y = 40;
  } else if (pos === 'bottom_left') {
    currentLayer.x = 40;
    currentLayer.y = 40;
  } else if (pos === 'center') {
    currentLayer.x = 0;
    currentLayer.y = 0;
  } else {
    currentLayer.x = 40;
    currentLayer.y = 40;
  }

  syncInspectorToActiveLayer();
  renderCanvasBoxes();
  renderLogoLayersList();
}

function detectClosestAlignmentGrid(centerX, centerY, stageW, stageH) {
  const normX = centerX / stageW;
  const normY = centerY / stageH;

  let pos = 'top_right';
  if (normY < 0.33) {
    if (normX > 0.66) pos = 'top_right';
    else if (normX > 0.33) pos = 'top_center';
    else pos = 'top_left';
  } else if (normY < 0.66) {
    if (normX > 0.66) pos = 'mid_right';
    else if (normX > 0.33) pos = 'center';
    else pos = 'mid_left';
  } else {
    if (normX > 0.66) pos = 'bot_right';
    else if (normX > 0.33) pos = 'bot_center';
    else pos = 'bot_left';
  }

  document.querySelectorAll('#alignmentGrid3x3 .grid-cell').forEach(cell => {
    if (cell.getAttribute('data-pos') === pos) {
      cell.classList.add('active');
    } else {
      cell.classList.remove('active');
    }
  });
}

// ----------------- Initialization of Logo Editor Controls -----------------
function initLogoEditor() {
  const stage = document.getElementById('canvasStageWrapper');
  const selectChannel = document.getElementById('selectEditorChannel');

  if (!stage) return;

  // Handle Channel Selection Change
  if (selectChannel) {
    selectChannel.addEventListener('change', (e) => {
      loadChannelIntoEditor(e.target.value);
    });
  }

  // Handle Window Resize to keep proportional positioning
  window.addEventListener('resize', () => {
    if (currentView === 'logo-editor') {
      renderCanvasBoxes();
    }
  });

  // 1. ADD LAYER BUTTON
  const btnAddLayer = document.getElementById('btnAddLogoLayer');
  if (btnAddLayer) {
    btnAddLayer.addEventListener('click', () => {
      const num = editorLogos.length + 1;
      const newLayer = {
        id: `layer_${Date.now()}`,
        name: `شعار ${num}`,
        url: '',
        origin: 'top_right',
        x: 40 + ((num - 1) * 30),
        y: 40 + ((num - 1) * 30),
        width: 170,
        opacity: 100,
        rotation: 0,
        visible: true,
        fixed: true,
        type: 'image'
      };
      editorLogos.push(newLayer);
      activeLayerIndex = editorLogos.length - 1;
      renderLogoLayersList();
      renderCanvasBoxes();
      syncInspectorToActiveLayer();
      showToast(`تمت إضافة طبقة: ${newLayer.name}. اختر شعاراً لها من المكتبة أو ارفع ملفاً`, 'info');
    });
  }

  // 2. 3x3 ALIGNMENT GRID BUTTONS
  document.querySelectorAll('#alignmentGrid3x3 .grid-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const pos = cell.getAttribute('data-pos');
      applyAlignmentPreset(pos);
    });
  });

  // 3. PRESET CARDS
  document.querySelectorAll('.presets-cards-row .preset-card').forEach(card => {
    card.addEventListener('click', () => {
      const preset = card.getAttribute('data-preset');
      applyAlignmentPreset(preset);
    });
  });

  // 4. NUMERIC OFFSET INPUTS (X / Y)
  const inputX = document.getElementById('inputLogoX');
  const inputY = document.getElementById('inputLogoY');
  if (inputX) {
    inputX.addEventListener('input', (e) => {
      if (editorLogos[activeLayerIndex]) {
        editorLogos[activeLayerIndex].x = parseInt(e.target.value) || 0;
        renderCanvasBoxes();
      }
    });
  }
  if (inputY) {
    inputY.addEventListener('input', (e) => {
      if (editorLogos[activeLayerIndex]) {
        editorLogos[activeLayerIndex].y = parseInt(e.target.value) || 0;
        renderCanvasBoxes();
      }
    });
  }

  // 5. SLIDERS: Size, Opacity, Rotation
  const sliderSize = document.getElementById('sliderLogoSize');
  const inputSize = document.getElementById('inputLogoSizeNum');
  if (sliderSize && inputSize) {
    sliderSize.addEventListener('input', (e) => {
      inputSize.value = e.target.value;
      if (editorLogos[activeLayerIndex]) {
        editorLogos[activeLayerIndex].width = parseInt(e.target.value);
        renderCanvasBoxes();
      }
    });
    inputSize.addEventListener('input', (e) => {
      sliderSize.value = e.target.value;
      if (editorLogos[activeLayerIndex]) {
        editorLogos[activeLayerIndex].width = parseInt(e.target.value);
        renderCanvasBoxes();
      }
    });
  }

  const sliderOpacity = document.getElementById('sliderLogoOpacity');
  const inputOpacity = document.getElementById('inputLogoOpacityNum');
  if (sliderOpacity && inputOpacity) {
    sliderOpacity.addEventListener('input', (e) => {
      inputOpacity.value = e.target.value;
      if (editorLogos[activeLayerIndex]) {
        editorLogos[activeLayerIndex].opacity = parseInt(e.target.value);
        renderCanvasBoxes();
      }
    });
    inputOpacity.addEventListener('input', (e) => {
      sliderOpacity.value = e.target.value;
      if (editorLogos[activeLayerIndex]) {
        editorLogos[activeLayerIndex].opacity = parseInt(e.target.value);
        renderCanvasBoxes();
      }
    });
  }

  const sliderRot = document.getElementById('sliderLogoRotation');
  const inputRot = document.getElementById('inputLogoRotationNum');
  if (sliderRot && inputRot) {
    sliderRot.addEventListener('input', (e) => {
      inputRot.value = e.target.value;
      if (editorLogos[activeLayerIndex]) {
        editorLogos[activeLayerIndex].rotation = parseInt(e.target.value);
        renderCanvasBoxes();
      }
    });
    inputRot.addEventListener('input', (e) => {
      sliderRot.value = e.target.value;
      if (editorLogos[activeLayerIndex]) {
        editorLogos[activeLayerIndex].rotation = parseInt(e.target.value);
        renderCanvasBoxes();
      }
    });
  }

  const checkFixed = document.getElementById('checkLogoFixed');
  if (checkFixed) {
    checkFixed.addEventListener('change', (e) => {
      if (editorLogos[activeLayerIndex]) {
        editorLogos[activeLayerIndex].fixed = e.target.checked;
      }
    });
  }

  // 6. LOGO UPLOAD & DROPZONE
  const dropzone = document.getElementById('logoDropzone');
  const fileInput = document.getElementById('inputLogoFileUpload');
  const btnUploadTrigger = document.getElementById('btnUploadLogoTrigger');

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());
    if (btnUploadTrigger) btnUploadTrigger.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('drag-over');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) {
        handleLogoFileUpload(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleLogoFileUpload(e.target.files[0]);
      }
    });
  }

  // 7. SNAPSHOT BUTTON
  const btnSnapshot = document.getElementById('btnRefreshStreamSnapshot');
  if (btnSnapshot) {
    btnSnapshot.addEventListener('click', () => {
      if (activeEditorChannelId) {
        fetchStreamSnapshot(activeEditorChannelId, true);
      }
    });
  }

  // 8. RESET SETTINGS BUTTON
  const btnReset = document.getElementById('btnResetLogoSettings');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      const cur = editorLogos[activeLayerIndex];
      if (cur) {
        cur.origin = 'top_right';
        cur.x = 40;
        cur.y = 40;
        cur.width = 180;
        cur.opacity = 100;
        cur.rotation = 0;
        syncInspectorToActiveLayer();
        renderCanvasBoxes();
        renderLogoLayersList();
        showToast('تمت إعادة تعيين إعدادات الطبقة الحالية للافتراضي', 'info');
      }
    });
  }

  // 9. SAVE AS TEMPLATE BUTTON
  const btnSaveTpl = document.getElementById('btnSaveAsTemplate');
  if (btnSaveTpl) {
    btnSaveTpl.addEventListener('click', () => {
      localStorage.setItem('7cast_logo_template', JSON.stringify(editorLogos));
      showToast('تم حفظ ضبط طبقات الشعارات كقالب جاهز بنجاح!', 'success');
    });
  }

  // 10. APPLY TO LIVE STREAM (Seamless Direct Broadcast Application)
  const btnApply = document.getElementById('btnApplyLogoToStream');
  if (btnApply) {
    btnApply.addEventListener('click', async () => {
      if (!activeEditorChannelId) {
        showToast('يرجى تحديد قناة للبث أولاً', 'error');
        return;
      }

      const configuredLogos = editorLogos.filter(l => l.url && l.visible);
      if (configuredLogos.length === 0) {
        showToast('يرجى رفع شعار أو اختياره من القائمة أولاً وتفعيله', 'warning');
        return;
      }

      btnApply.disabled = true;
      btnApply.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin-icon"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
        <span>جاري التطبيق المباشر على البث...</span>
      `;

      const primary = configuredLogos[0];
      const payload = {
        logos: editorLogos,
        logoEnabled: true,
        logoUrl: primary.url,
        logoOrigin: primary.origin || 'top_right',
        logoX: primary.x,
        logoY: primary.y,
        logoWidth: primary.width,
        logoOpacity: primary.opacity / 100,
        logoRotation: primary.rotation,
        logoFixed: primary.fixed !== false,
        logoType: 'image'
      };

      try {
        const res = await fetch(`/api/channels/${activeEditorChannelId}/logo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.success) {
          showToast(`تم تطبيق ${configuredLogos.length} شعار بنجاح ومباشرةً فوق البث دون انقطاع!`, 'success');

          // Update channel in local memory
          const ch = channels.find(c => c.id === activeEditorChannelId);
          if (ch) {
            Object.assign(ch, payload);
            renderChannels();
          }

          // Automatically fetch fresh snapshot after 2.5 seconds to show the logos in action
          setTimeout(() => {
            fetchStreamSnapshot(activeEditorChannelId, false);
          }, 2500);
        } else {
          showToast(data.error || 'فشل تطبيق الشعارات', 'error');
        }
      } catch (err) {
        showToast('خطأ في الاتصال بالخادم أثناء تطبيق الشعارات', 'error');
      } finally {
        btnApply.disabled = false;
        btnApply.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          <span>تطبيق على البث</span>
        `;
      }
    });
  }

  // Initial load of saved logos library
  loadSavedLogos();
}

async function loadSavedLogos() {
  const grid = document.getElementById('savedLogosGrid');
  if (!grid) return;

  try {
    const res = await fetch('/api/logos');
    const data = await res.json();
    if (data.success && Array.isArray(data.logos)) {
      if (data.logos.length === 0) {
        grid.innerHTML = `
          <div class="saved-logos-empty-state">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            <p>لا توجد شعارات مرفوعة بعد</p>
            <span>قم برفع شعار من جهازك عبر المربع أعلاه للبدء</span>
          </div>
        `;
        return;
      }

      const activeUrl = editorLogos[activeLayerIndex]?.url || '';

      grid.innerHTML = data.logos.map(logo => `
        <div class="saved-logo-card ${logo.url === activeUrl ? 'active' : ''}" data-url="${escapeHtml(logo.url)}" data-name="${escapeHtml(logo.name)}" data-filename="${escapeHtml(logo.filename)}">
          <button type="button" class="btn-delete-logo" data-filename="${escapeHtml(logo.filename)}" title="حذف الشعار">✕</button>
          <div class="logo-thumb-wrapper">
            <img src="${escapeHtml(logo.url)}" alt="${escapeHtml(logo.name)}">
          </div>
          <span class="logo-name-tag" title="${escapeHtml(logo.name)}">${escapeHtml(logo.name)}</span>
        </div>
      `).join('');

      // Wire card selection
      grid.querySelectorAll('.saved-logo-card').forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.classList.contains('btn-delete-logo')) return;
          const url = card.getAttribute('data-url');
          const name = card.getAttribute('data-name');

          if (editorLogos.length === 0) {
            editorLogos.push({
              id: `layer_${Date.now()}`,
              name: name || 'شعار 1',
              url: url,
              origin: 'top_right',
              x: 40,
              y: 40,
              width: 180,
              opacity: 100,
              rotation: 0,
              visible: true,
              fixed: true,
              type: 'image'
            });
            activeLayerIndex = 0;
          } else {
            if (activeLayerIndex < 0 || activeLayerIndex >= editorLogos.length) {
              activeLayerIndex = 0;
            }
            editorLogos[activeLayerIndex].url = url;
            if (!editorLogos[activeLayerIndex].name || editorLogos[activeLayerIndex].name.startsWith('شعار ')) {
              editorLogos[activeLayerIndex].name = name;
            }
          }

          grid.querySelectorAll('.saved-logo-card').forEach(c => c.classList.remove('active'));
          card.classList.add('active');

          renderLogoLayersList();
          renderCanvasBoxes();
          syncInspectorToActiveLayer();

          showToast(`تم تعيين الشعار للطبقة الحالية: ${name}`, 'info');
        });
      });

      // Wire delete buttons
      grid.querySelectorAll('.btn-delete-logo').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const filename = btn.getAttribute('data-filename');
          if (!filename) return;

          if (confirm('هل ترغب في حذف هذا الشعار نهائياً من المكتبة؟')) {
            try {
              const delRes = await fetch(`/api/logos/${encodeURIComponent(filename)}`, { method: 'DELETE' });
              const delData = await delRes.json();
              if (delData.success) {
                showToast('تم حذف الشعار بنجاح', 'success');
                await loadSavedLogos();
              } else {
                showToast(delData.error || 'فشل حذف الشعار', 'error');
              }
            } catch (err) {
              showToast('تعذر حذف الشعار', 'error');
            }
          }
        });
      });
    }
  } catch (err) {
    console.warn('Failed to load saved logos:', err);
  }
}

async function handleLogoFileUpload(file) {
  if (!file) return;

  const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
  if (!allowedTypes.includes(file.type) && !file.name.match(/\.(png|jpe?g|webp|gif|svg)$/i)) {
    showToast('صيغة الملف غير مدعومة (يسمح بـ PNG, JPG, WEBP, GIF فقط)', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('logo', file);

  const dropzoneTitle = document.querySelector('.logo-dropzone .dropzone-title');
  if (dropzoneTitle) dropzoneTitle.textContent = 'جاري رفع الشعار...';

  try {
    const res = await fetch('/api/logos/upload', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (data.success && data.logo) {
      showToast(`تم رفع الشعار بنجاح: ${data.logo.name}`, 'success');

      if (editorLogos.length === 0) {
        editorLogos.push({
          id: `layer_${Date.now()}`,
          name: data.logo.name,
          url: data.logo.url,
          origin: 'top_right',
          x: 40,
          y: 40,
          width: 180,
          opacity: 100,
          rotation: 0,
          visible: true,
          fixed: true,
          type: 'image'
        });
        activeLayerIndex = 0;
      } else {
        if (activeLayerIndex < 0 || activeLayerIndex >= editorLogos.length) {
          activeLayerIndex = 0;
        }
        editorLogos[activeLayerIndex].url = data.logo.url;
        editorLogos[activeLayerIndex].name = data.logo.name;
      }

      renderLogoLayersList();
      renderCanvasBoxes();
      syncInspectorToActiveLayer();
      await loadSavedLogos();
    } else {
      showToast(data.error || 'فشل رفع الشعار', 'error');
    }
  } catch (err) {
    showToast('تعذر رفع ملف الشعار إلى الخادم', 'error');
  } finally {
    if (dropzoneTitle) dropzoneTitle.textContent = 'اسحب الشعار هنا';
  }
}
