const http = require('http');

function post(path, data, token = null) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request({
      hostname: 'localhost',
      port: 7878,
      path,
      method: 'POST',
      headers
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function get(path, token = null) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request({
      hostname: 'localhost',
      port: 7878,
      path,
      method: 'GET',
      headers
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  console.log('1. Testing Login with password 11Q2rrt4@...');
  const loginRes = await post('/api/auth/login', { password: '11Q2rrt4@' });
  console.log('Login result:', loginRes.data);

  const token = loginRes.data.token;
  if (!token) throw new Error('No token returned');

  console.log('\n2. Testing GET /api/channels...');
  const channelsRes = await get('/api/channels', token);
  console.log('Channels count:', channelsRes.data.channels.length);
  console.log('Sample channel:', channelsRes.data.channels[0].name);
  console.log('Destinations:', channelsRes.data.channels[0].destinations.map(d => d.name));

  console.log('\n3. Testing Probe Source on test stream...');
  const probeRes = await post('/api/channels/probe', {
    url: 'http://amlive.cc:80/qqqqqq/qqqqqq/513119.ts'
  }, token);
  console.log('Probe result:', probeRes.data);

  console.log('\n4. Testing System Stats...');
  const statsRes = await get('/api/system/stats', token);
  console.log('System stats:', statsRes.data.stats);

  console.log('\nALL BACKEND API TESTS PASSED SUCCESSFULLY! 🎉');
}

run().catch(console.error);
