const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
  res.end('Monkey Tag Server OK');
});

const wss = new WebSocketServer({ server, perMessageDeflate: false });
const lobbies = {};
let nextId = 1;

function getLobby(id) { if (!lobbies[id]) lobbies[id] = {}; return lobbies[id]; }

function broadcast(lobby, msg, excludeId = null) {
  const data = JSON.stringify(msg);
  Object.entries(lobby).forEach(([id, p]) => {
    if (id !== excludeId && p.ws.readyState === WebSocket.OPEN) {
      try { p.ws.send(data); } catch (e) {}
    }
  });
}

function lobbyState(lobby) {
  const players = {};
  Object.entries(lobby).forEach(([id, p]) => {
    players[id] = { name: p.name, color: p.color, cos: p.cos, x: p.x, y: p.y, z: p.z, yaw: p.yaw };
  });
  return players;
}

wss.on('connection', (ws, req) => {
  const id = String(nextId++);
  let lobbyId = null, playerName = 'Monkey', isAlive = true;
  console.log(`[+] ${id} connected`);

  ws.on('pong', () => { isAlive = true; });
  const hb = setInterval(() => {
    if (!isAlive) { clearInterval(hb); ws.terminate(); return; }
    isAlive = false; try { ws.ping(); } catch (e) {}
  }, 20000);

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'join') {
      lobbyId = String(msg.lobby || 'public').toLowerCase().slice(0, 20);
      playerName = String(msg.name || 'Monkey').slice(0, 16);
      const lobby = getLobby(lobbyId);
      lobby[id] = { ws, name: playerName, color: msg.color || 0xff6600, cos: msg.cos || {}, x: 0, y: 0, z: 0, yaw: 0 };
      try {
        ws.send(JSON.stringify({ type: 'welcome', id }));
        ws.send(JSON.stringify({ type: 'state', players: lobbyState(lobby) }));
      } catch (e) {}
      broadcast(lobby, { type: 'player_join', id, name: playerName, color: msg.color, cos: msg.cos || {} }, id);
      console.log(`[${lobbyId}] ${playerName}(${id}) joined — ${Object.keys(lobby).length} players`);
    }

    if (msg.type === 'move' && lobbyId) {
      const lobby = getLobby(lobbyId);
      if (lobby[id]) {
        lobby[id].x = +msg.x || 0; lobby[id].y = +msg.y || 0;
        lobby[id].z = +msg.z || 0; lobby[id].yaw = +msg.yaw || 0;
        if (msg.name) lobby[id].name = String(msg.name).slice(0, 16);
        if (msg.cos) lobby[id].cos = msg.cos;
        broadcast(lobby, { type: 'player_move', id, x: lobby[id].x, y: lobby[id].y, z: lobby[id].z, yaw: lobby[id].yaw, name: lobby[id].name, color: lobby[id].color, cos: lobby[id].cos }, id);
      }
    }

    if (msg.type === 'chat' && lobbyId) {
      const lobby = getLobby(lobbyId);
      if (lobby[id]) {
        const text = String(msg.text || '').slice(0, 80);
        if (text) broadcast(lobby, { type: 'chat', id, name: lobby[id].name, text }, id);
      }
    }

    if (msg.type === 'cos' && lobbyId) {
      const lobby = getLobby(lobbyId);
      if (lobby[id] && msg.cos) {
        lobby[id].cos = msg.cos;
        broadcast(lobby, { type: 'cos_update', id, cos: msg.cos }, id);
      }
    }
  });

  ws.on('close', () => {
    clearInterval(hb);
    if (!lobbyId) return;
    const lobby = getLobby(lobbyId);
    if (lobby[id]) {
      broadcast(lobby, { type: 'player_leave', id, name: playerName });
      delete lobby[id];
      console.log(`[${lobbyId}] ${playerName}(${id}) left — ${Object.keys(lobby).length} players`);
      if (Object.keys(lobby).length === 0) delete lobbies[lobbyId];
    }
  });

  ws.on('error', err => console.error(`${id} error: ${err.message}`));
});

server.listen(PORT, '0.0.0.0', () => console.log(`✅ Monkey Tag server on port ${PORT}`));
process.on('SIGTERM', () => { wss.clients.forEach(c => c.close()); server.close(() => process.exit(0)); });
