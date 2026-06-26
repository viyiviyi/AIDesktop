const WebSocket = require('ws');

const convId = '037e79b3-cffe-48b6-9bca-ce8fcc66f00c';
const appId = 'desktop-assistant';
const ws = new WebSocket('ws://localhost:8000/api/ws');
let events = [];

ws.on('open', () => {
  console.log('[WS] Connected');
  ws.send(JSON.stringify({ type: 'subscribe', convId }));
  console.log('[WS] Subscribed to ' + convId);
});

ws.on('message', (data) => {
  const msg = data.toString();
  console.log('[WS EVENT]', msg);
  events.push(msg);
});

ws.on('error', (e) => console.log('[WS] Error:', e.message));

// 等待 1 秒后发送消息
setTimeout(() => {
  const http = require('http');
  const body = JSON.stringify({ content: [{ type: 'text', text: '你好，请回复"测试通过"。' }] });
  const req = http.request({
    hostname: 'localhost',
    port: 8000,
    path: '/api/apps/' + appId + '/conversations/' + convId + '/messages',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, (res) => {
    let body2 = '';
    res.on('data', (chunk) => body2 += chunk);
    res.on('end', () => console.log('[HTTP]', body2.slice(0, 500)));
  });
  req.write(body);
  req.end();
  console.log('[HTTP] Message sent');
}, 1000);

// 等待 25 秒收集事件
setTimeout(() => {
  console.log('[WS] Received ' + events.length + ' events total');
  for (const e of events) {
    try { console.log('  -', JSON.parse(e).type); } catch {}
  }
  ws.close();
  process.exit(0);
}, 25000);
