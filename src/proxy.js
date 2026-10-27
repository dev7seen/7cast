const http = require('http');
const https = require('https');
const { URL } = require('url');

function createProxy(streamManager) {
  return async function proxyHandler(req, res) {
    const channelId = req.params.channelId;
    const channel = streamManager.getChannel(channelId);

    if (!channel) {
      return res.status(404).json({ error: 'القناة غير موجودة' });
    }

    let initialUrl = req.query.url ? decodeURIComponent(req.query.url) : channel.sourceUrl;
    if (!initialUrl) {
      return res.status(400).json({ error: 'رابط المصدر غير متوفر' });
    }

    // Set CORS headers early
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }

    // Follow redirects internally up to 5 times
    executeProxyFetch(initialUrl, channel, req, res, 0);
  };
}

function executeProxyFetch(targetUrl, channel, req, res, redirectCount) {
  if (redirectCount > 5) {
    if (!res.headersSent) {
      return res.status(508).json({ error: 'تجاوز الحد الأقصى لإعادة التوجيه (Too many redirects)' });
    }
    return;
  }

  try {
    const parsedUrl = new URL(targetUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    // Build custom request headers
    const reqHeaders = {
      'User-Agent': channel.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Connection': 'keep-alive'
    };

    if (channel.referer && channel.referer.trim()) reqHeaders['Referer'] = channel.referer.trim();
    if (channel.origin && channel.origin.trim()) reqHeaders['Origin'] = channel.origin.trim();
    if (channel.cookie && channel.cookie.trim()) reqHeaders['Cookie'] = channel.cookie.trim();
    if (channel.authorization && channel.authorization.trim()) reqHeaders['Authorization'] = channel.authorization.trim();
    if (channel.xForwardedFor && channel.xForwardedFor.trim()) reqHeaders['X-Forwarded-For'] = channel.xForwardedFor.trim();
    if (channel.host && channel.host.trim()) reqHeaders['Host'] = channel.host.trim();

    if (channel.customHeaders && channel.customHeaders.trim()) {
      const lines = channel.customHeaders.split(/\r?\n/);
      for (const line of lines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          const hKey = line.substring(0, colonIdx).trim();
          const hVal = line.substring(colonIdx + 1).trim();
          if (hKey && hVal) {
            reqHeaders[hKey] = hVal;
          }
        }
      }
    }

    const proxyReq = client.request(targetUrl, {
      method: req.method,
      headers: reqHeaders,
      timeout: 15000
    }, (proxyRes) => {
      // 1. Handle HTTP Redirects internally on server side
      if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
        proxyReq.destroy();
        const nextUrl = new URL(proxyRes.headers.location, targetUrl).toString();
        return executeProxyFetch(nextUrl, channel, req, res, redirectCount + 1);
      }

      const contentType = proxyRes.headers['content-type'] || '';

      // 2. If it's an HLS playlist (m3u8), rewrite segment URLs to route through proxy
      if (targetUrl.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('application/x-mpegurl')) {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        let m3u8Data = '';
        proxyRes.on('data', chunk => {
          m3u8Data += chunk.toString('utf8');
        });
        proxyRes.on('end', () => {
          const rewritten = rewriteM3u8(m3u8Data, targetUrl, channel.id, req.query.token);
          res.send(rewritten);
        });
        return;
      }

      // 3. For MPEG-TS or other binary streams
      if (targetUrl.includes('.ts') || contentType.includes('mp2t') || contentType.includes('octet-stream')) {
        res.setHeader('Content-Type', 'video/mp2t');
      } else if (contentType) {
        res.setHeader('Content-Type', contentType);
      }

      res.status(proxyRes.statusCode);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error(`[7CAST Proxy Error] ${targetUrl}:`, err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'تعذر الاتصال بالمصدر: ' + err.message });
      }
    });

    req.on('close', () => {
      proxyReq.destroy();
    });

    proxyReq.end();

  } catch (err) {
    console.error('[7CAST Proxy Exception]:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'خطأ في معالجة البروكسي: ' + err.message });
    }
  }
}

function rewriteM3u8(content, baseUrl, channelId, token) {
  const lines = content.split(/\r?\n/);
  const outLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      outLines.push(line);
      continue;
    }

    if (trimmed.startsWith('#')) {
      if (trimmed.includes('URI="')) {
        const rewrittenTag = trimmed.replace(/URI="([^"]+)"/, (match, uri) => {
          const resolved = new URL(uri, baseUrl).toString();
          return `URI="/api/proxy/stream/${channelId}?url=${encodeURIComponent(resolved)}&token=${token || ''}"`;
        });
        outLines.push(rewrittenTag);
      } else {
        outLines.push(line);
      }
    } else {
      try {
        const resolved = new URL(trimmed, baseUrl).toString();
        outLines.push(`/api/proxy/stream/${channelId}?url=${encodeURIComponent(resolved)}&token=${token || ''}`);
      } catch (e) {
        outLines.push(line);
      }
    }
  }

  return outLines.join('\n');
}

module.exports = { createProxy };
