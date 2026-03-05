const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3000;

// Cache dla IP
let cachedIP = null;
// Licznik aktywnych połączeń
let activeConnections = 0;
let totalConnections = 0;

function getExternalIP() {
  return new Promise((resolve) => {
    if (cachedIP) {
      resolve(cachedIP);
      return;
    }
    https.get('https://api.ipify.org', (resp) => {
      let data = '';
      resp.on('data', (chunk) => data += chunk);
      resp.on('end', () => {
        cachedIP = data.trim();
        resolve(cachedIP);
      });
    }).on('error', () => resolve('unknown'));
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // Endpoint /ip
  if (req.url === '/ip') {
    const ip = await getExternalIP();
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(ip);
    return;
  }
  
  // Endpoint /stats - pokaż statystyki
  if (req.url === '/stats') {
    const ip = await getExternalIP();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ip: ip,
      active: activeConnections,
      total: totalConnections,
      maxSlots: 2
    }));
    return;
  }
  
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (clientWs, req) => {
  const params = url.parse(req.url, true).query;
  const target = params.target;
  
  if (!target) {
    clientWs.close(1008, 'Missing target URL');
    return;
  }

  // Zwiększ liczniki
  activeConnections++;
  totalConnections++;
  console.log(`[PROXY] New connection (active: ${activeConnections}) to: ${target}`);
  
  let serverWs;
  try {
    serverWs = new WebSocket(target, {
      headers: {
        'Origin': 'https://tankionline.com/play/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      handshakeTimeout: 10000
    });
  } catch (e) {
    console.error('[PROXY] Failed to connect:', e.message);
    clientWs.close(1011, 'Failed to connect to target');
    return;
  }

  serverWs.binaryType = 'arraybuffer';

  serverWs.on('open', () => {
    console.log('[PROXY] Connected to MooMoo server');
  });

  serverWs.on('message', (data, isBinary) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data, { binary: isBinary });
    }
  });

  serverWs.on('close', (code, reason) => {
    console.log(`[PROXY] Server closed: ${code} ${reason || ''}`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(code, reason);
    }
  });

  serverWs.on('error', (err) => {
    console.error('[PROXY] Server error:', err.message);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1011, 'Server error');
    }
  });

  clientWs.on('message', (data, isBinary) => {
    if (serverWs.readyState === WebSocket.OPEN) {
      serverWs.send(data, { binary: isBinary });
    }
  });

  clientWs.on('close', (code, reason) => {
    activeConnections--;
    console.log(`[PROXY] Client closed (active: ${activeConnections}): ${code}`);
    if (serverWs.readyState === WebSocket.OPEN) {
      serverWs.close();
    }
  });

  clientWs.on('error', (err) => {
    console.error('[PROXY] Client error:', err.message);
    if (serverWs.readyState === WebSocket.OPEN) {
      serverWs.close();
    }
  });
});

server.listen(PORT, () => {
  console.log(`[PROXY] Glotus Proxy running on port ${PORT}`);

});
