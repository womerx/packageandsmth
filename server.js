// WebSocket Server for Monkey Tag Multiplayer
// Deploy this to Railway, Render, or Fly.io (NOT Vercel - Vercel doesn't support WS)
// Then update WS_SERVER in index.html with your deployed URL

const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3001;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Monkey Tag WebSocket Server Running');
});

const wss = new WebSocketServer({ server });

// lobbies[lobbyId] = { [playerId]: { ws, name, color, x, y, z, yaw } }
const lobbies = {};

let nextId = 1;

function getLobby(id) {
  if (!lobbies[id]) lobbies[id] = {};
  return lobbies[id];
}

function broadcast(lobby, msg, excludeId = null) {
  const data = JSON.stringify(msg);
  Object.entries(lobby).forEach(([id, player]) => {
    if (id !== excludeId && player.ws.readyState === 1) {
      player.ws.send(data);
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

wss.on('connection', (ws) => {
  const id = String(nextId++);
  let playerLobbyId = null;
  let playerName = 'Monkey';

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join') {
      playerLobbyId = msg.lobby || 'public';
      playerName = (msg.name || 'Monkey').substring(0, 16);
      const lobby = getLobby(playerLobbyId);

      lobby[id] = {
        ws, name: playerName,
        color: msg.color || 0xff6600,
        x: 0, y: 1.6, z: 0, yaw: 0
      };

      // Welcome this player
      ws.send(JSON.stringify({ type: 'welcome', id }));

      // Send current state
      ws.send(JSON.stringify({ type: 'state', players: getLobbyState(lobby) }));

      // Notify others
      broadcast(lobby, { type: 'player_join', id, name: playerName, color: msg.color }, id);

      console.log(`[${playerLobbyId}] ${playerName} (${id}) joined — ${Object.keys(lobby).length} players`);
    }

    if (msg.type === 'move' && playerLobbyId) {
      const lobby = getLobby(playerLobbyId);
      if (lobby[id]) {
        lobby[id].x = msg.x || 0;
        lobby[id].y = msg.y || 1.6;
        lobby[id].z = msg.z || 0;
        lobby[id].yaw = msg.yaw || 0;
        if (msg.name) lobby[id].name = msg.name.substring(0, 16);
        broadcast(lobby, { type: 'player_move', id, ...msg }, id);
      }
    }
  });

  ws.on('close', () => {
    if (!playerLobbyId) return;
    const lobby = getLobby(playerLobbyId);
    if (lobby[id]) {
      broadcast(lobby, { type: 'player_leave', id, name: playerName });
      delete lobby[id];
      console.log(`[${playerLobbyId}] ${playerName} (${id}) left — ${Object.keys(lobby).length} players`);
      if (Object.keys(lobby).length === 0) delete lobbies[playerLobbyId];
    }
  });
});

server.listen(PORT, () => console.log(`Monkey Tag WS server on port ${PORT}`));
