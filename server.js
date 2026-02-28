const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3001;

const server = http.createServer((req, res) => {
  // Railway health check + CORS
  res.writeHead(200, {
    'Content-Type': 'text/plain',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*'
  });
  res.end('Monkey Tag WS Server — OK');
});

// Attach WebSocket server to the same HTTP server
const wss = new WebSocketServer({ server, perMessageDeflate: false });

const lobbies = {};
let nextId = 1;

function getLobby(id) {
  if (!lobbies[id]) lobbies[id] = {};
  return lobbies[id];
}

function broadcast(lobby, msg, excludeId = null) {
  const data = JSON.stringify(msg);
  Object.entries(lobby).forEach(([id, p]) => {
    if (id !== excludeId && p.ws.readyState === WebSocket.OPEN) {
      try { p.ws.send(data); } catch (e) { /* ignore */ }
    }
  });
}

function broadcastState(lobby) {
  const players = {};
  Object.entries(lobby).forEach(([id, p]) => {
    players[id] = { name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, yaw: p.yaw };
  });
  return players;
}

// Use global WebSocket constant for readyState
const { WebSocket } = require('ws');

wss.on('connection', (ws, req) => {
  const id = String(nextId++);
  let lobbyId = null;
  let playerName = 'Monkey';
  let isAlive = true;

  console.log(`[+] Client ${id} connected`);

  // Keep-alive: ping every 20 seconds to prevent Railway from dropping idle connections
  ws.on('pong', () => { isAlive = true; });
  const heartbeat = setInterval(() => {
    if (!isAlive) {
      console.log(`[-] Client ${id} timed out`);
      clearInterval(heartbeat);
      ws.terminate();
      return;
    }
    isAlive = false;
    try { ws.ping(); } catch (e) {}
  }, 20000);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'join') {
      lobbyId = String(msg.lobby || 'public').toLowerCase().slice(0, 20);
      playerName = String(msg.name || 'Monkey').slice(0, 16);
      const lobby = getLobby(lobbyId);

      lobby[id] = { ws, name: playerName, color: msg.color || 0xff6600, x: 0, y: 0, z: 0, yaw: 0 };

      try {
        ws.send(JSON.stringify({ type: 'welcome', id }));
        ws.send(JSON.stringify({ type: 'state', players: broadcastState(lobby) }));
      } catch (e) {}

      broadcast(lobby, { type: 'player_join', id, name: playerName, color: msg.color || 0xff6600 }, id);
      console.log(`[${lobbyId}] ${playerName}(${id}) joined — ${Object.keys(lobby).length} players`);
    }

    if (msg.type === 'move' && lobbyId) {
      const lobby = getLobby(lobbyId);
      if (lobby[id]) {
        lobby[id].x   = +msg.x   || 0;
        lobby[id].y   = +msg.y   || 0;
        lobby[id].z   = +msg.z   || 0;
        lobby[id].yaw = +msg.yaw || 0;
        if (msg.name) lobby[id].name = String(msg.name).slice(0, 16);
        broadcast(lobby, {
          type: 'player_move', id,
          x: lobby[id].x, y: lobby[id].y, z: lobby[id].z, yaw: lobby[id].yaw,
          name: lobby[id].name, color: lobby[id].color
        }, id);
      }
    }
  });

  ws.on('close', () => {
    clearInterval(heartbeat);
    if (!lobbyId) return;
    const lobby = getLobby(lobbyId);
    if (lobby[id]) {
      broadcast(lobby, { type: 'player_leave', id, name: playerName });
      delete lobby[id];
      console.log(`[${lobbyId}] ${playerName}(${id}) left — ${Object.keys(lobby).length} players`);
      if (Object.keys(lobby).length === 0) {
        delete lobbies[lobbyId];
        console.log(`[${lobbyId}] Lobby closed`);
      }
    }
  });

  ws.on('error', (err) => {
    console.error(`Client ${id} error: ${err.message}`);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Monkey Tag server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server');
  wss.clients.forEach(c => c.close());
  server.close(() => process.exit(0));
});
