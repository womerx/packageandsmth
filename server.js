const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3001;

// HTTP server - Railway needs a health check response
const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/plain',
    'Access-Control-Allow-Origin': '*'
  });
  res.end('Monkey Tag Server OK');
});

const wss = new WebSocketServer({ server });

const lobbies = {};
let nextId = 1;

function getLobby(id) {
  if (!lobbies[id]) lobbies[id] = {};
  return lobbies[id];
}

function broadcast(lobby, msg, excludeId = null) {
  const data = JSON.stringify(msg);
  Object.entries(lobby).forEach(([id, p]) => {
    if (id !== excludeId && p.ws.readyState === 1) {
      try { p.ws.send(data); } catch(e) {}
    }
  });
}

function getLobbyState(lobby) {
  const players = {};
  Object.entries(lobby).forEach(([id, p]) => {
    players[id] = { name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, yaw: p.yaw };
  });
  return players;
}

wss.on('connection', (ws, req) => {
  const id = String(nextId++);
  let lobbyId = null;
  let playerName = 'Monkey';

  console.log(`Client ${id} connected from ${req.socket.remoteAddress}`);

  // Keep-alive ping every 25 seconds (Railway kills idle connections)
  const pingInterval = setInterval(() => {
    if (ws.readyState === 1) {
      try { ws.ping(); } catch(e) {}
    }
  }, 25000);

  ws.on('pong', () => {}); // keep alive

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'join') {
      lobbyId = (msg.lobby || 'public').toLowerCase().substring(0, 20);
      playerName = (msg.name || 'Monkey').substring(0, 16);
      const lobby = getLobby(lobbyId);

      lobby[id] = {
        ws,
        name: playerName,
        color: msg.color || 0xff6600,
        x: 0, y: 0, z: 0, yaw: 0
      };

      ws.send(JSON.stringify({ type: 'welcome', id }));
      ws.send(JSON.stringify({ type: 'state', players: getLobbyState(lobby) }));
      broadcast(lobby, { type: 'player_join', id, name: playerName, color: msg.color }, id);

      console.log(`[${lobbyId}] ${playerName}(${id}) joined — ${Object.keys(lobby).length} players`);
    }

    if (msg.type === 'move' && lobbyId) {
      const lobby = getLobby(lobbyId);
      if (lobby[id]) {
        lobby[id].x   = typeof msg.x   === 'number' ? msg.x   : 0;
        lobby[id].y   = typeof msg.y   === 'number' ? msg.y   : 0;
        lobby[id].z   = typeof msg.z   === 'number' ? msg.z   : 0;
        lobby[id].yaw = typeof msg.yaw === 'number' ? msg.yaw : 0;
        if (msg.name) lobby[id].name = msg.name.substring(0, 16);
        broadcast(lobby, { type: 'player_move', id, x: lobby[id].x, y: lobby[id].y, z: lobby[id].z, yaw: lobby[id].yaw, name: lobby[id].name, color: lobby[id].color }, id);
      }
    }
  });

  ws.on('close', () => {
    clearInterval(pingInterval);
    if (!lobbyId) return;
    const lobby = getLobby(lobbyId);
    if (lobby[id]) {
      broadcast(lobby, { type: 'player_leave', id, name: playerName });
      delete lobby[id];
      console.log(`[${lobbyId}] ${playerName}(${id}) left — ${Object.keys(lobby).length} players`);
      if (Object.keys(lobby).length === 0) delete lobbies[lobbyId];
    }
  });

  ws.on('error', (err) => {
    console.error(`Client ${id} error:`, err.message);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Monkey Tag server listening on 0.0.0.0:${PORT}`);
});

// Log active lobbies every 60s
setInterval(() => {
  const total = Object.values(lobbies).reduce((s, l) => s + Object.keys(l).length, 0);
  if (total > 0) console.log(`Active: ${total} players across ${Object.keys(lobbies).length} lobbies`);
}, 60000);
