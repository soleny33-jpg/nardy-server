const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Nardy: Classic WebSocket Server is running.\n');
});

const wss = new WebSocket.Server({ server });

const waitingQueue = { short: null, long: null };
const rooms = new Map();

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? genCode() : code;
}

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function pairPlayers(p1, p2, variant, code) {
  const room = { code, variant, white: p1, black: p2 };
  rooms.set(code, room);
  p1.roomCode = code;
  p2.roomCode = code;
  send(p1, { type: 'matched', color: 'white', variant, code });
  send(p2, { type: 'matched', color: 'black', variant, code });
}

function cleanupClient(ws) {
  for (const v of ['short', 'long']) {
    if (waitingQueue[v] === ws) waitingQueue[v] = null;
  }
  if (ws.roomCode && rooms.has(ws.roomCode)) {
    const room = rooms.get(ws.roomCode);
    const other = room.white === ws ? room.black : room.white;
    if (other) {
      other.roomCode = null;
      send(other, { type: 'opponent_left' });
    }
    rooms.delete(ws.roomCode);
    ws.roomCode = null;
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'find_match') {
      cleanupClient(ws);
      const v = msg.variant === 'long' ? 'long' : 'short';
      const waiting = waitingQueue[v];
      if (waiting && waiting !== ws && waiting.readyState === WebSocket.OPEN) {
        waitingQueue[v] = null;
        pairPlayers(waiting, ws, v, genCode());
      } else {
        waitingQueue[v] = ws;
        send(ws, { type: 'waiting' });
      }
    } else if (msg.type === 'create_room') {
      cleanupClient(ws);
      const v = msg.variant === 'long' ? 'long' : 'short';
      const code = genCode();
      rooms.set(code, { code, variant: v, white: ws, black: null });
      ws.roomCode = code;
      send(ws, { type: 'room_created', code, variant: v });
    } else if (msg.type === 'join_room') {
      cleanupClient(ws);
      const code = String(msg.code || '').trim().toUpperCase();
      const room = rooms.get(code);
      if (!room || room.black) {
        send(ws, { type: 'error', message: 'Room not found or full' });
        return;
      }
      room.black = ws;
      ws.roomCode = code;
      send(room.white, { type: 'matched', color: 'white', variant: room.variant, code });
      send(room.black, { type: 'matched', color: 'black', variant: room.variant, code });
    } else if (['roll', 'move', 'undo', 'endTurn'].includes(msg.type)) {
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      const other = room.white === ws ? room.black : room.white;
      send(other, msg);
    } else if (msg.type === 'leave') {
      cleanupClient(ws);
    }
  });

  ws.on('close', () => cleanupClient(ws));
});

const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(interval));

server.listen(PORT, () => {
  console.log(`Nardy WebSocket server listening on port ${PORT}`);
});
