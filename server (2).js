const { WebSocketServer } = require("ws");
const http = require("http");

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "ok", lobbies: lobbies.size }));
  } else if (req.url === "/lobbies") {
    const publicLobbies = [];
    lobbies.forEach((lobby, code) => {
      if (!lobby.isPrivate) {
        publicLobbies.push({
          code,
          name: lobby.name,
          players: lobby.players.size,
          maxPlayers: 50,
        });
      }
    });
    res.writeHead(200);
    res.end(JSON.stringify(publicLobbies));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  }
});

const wss = new WebSocketServer({ server });

// lobbies: Map<code, { name, isPrivate, players: Map<id, playerData>, host: id }>
const lobbies = new Map();
// clients: Map<ws, { id, lobbyCode, name, color }>
const clients = new Map();

let idCounter = 0;

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function broadcast(lobbyCode, data, excludeWs = null) {
  const lobby = lobbies.get(lobbyCode);
  if (!lobby) return;
  const msg = JSON.stringify(data);
  lobby.players.forEach((_, pid) => {
    // find ws for this pid
    clients.forEach((client, ws) => {
      if (client.id === pid && ws !== excludeWs && ws.readyState === 1) {
        ws.send(msg);
      }
    });
  });
}

function getLobbyPlayerList(lobbyCode) {
  const lobby = lobbies.get(lobbyCode);
  if (!lobby) return [];
  const list = [];
  lobby.players.forEach((p, id) => {
    list.push({ id, name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, rx: p.rx, ry: p.ry });
  });
  return list;
}

wss.on("connection", (ws) => {
  const id = `p${++idCounter}`;
  clients.set(ws, { id, lobbyCode: null, name: "Monkey", color: "#8B4513" });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const client = clients.get(ws);

    switch (msg.type) {
      case "create_lobby": {
        const code = generateCode();
        const name = (msg.lobbyName || "Monkey Lobby").substring(0, 30);
        const isPrivate = !!msg.isPrivate;
        lobbies.set(code, {
          name,
          isPrivate,
          players: new Map(),
          host: id,
        });
        client.name = (msg.playerName || "Monkey").substring(0, 20);
        client.color = msg.color || "#8B4513";
        client.lobbyCode = code;
        const lobby = lobbies.get(code);
        lobby.players.set(id, {
          name: client.name,
          color: client.color,
          x: 0, y: 1, z: 0,
          rx: 0, ry: 0,
        });
        ws.send(JSON.stringify({
          type: "lobby_joined",
          code,
          isHost: true,
          players: getLobbyPlayerList(code),
          lobbyName: name,
          isPrivate,
        }));
        break;
      }

      case "join_lobby": {
        const code = (msg.code || "").toUpperCase();
        const lobby = lobbies.get(code);
        if (!lobby) {
          ws.send(JSON.stringify({ type: "error", message: "Lobby not found!" }));
          return;
        }
        client.name = (msg.playerName || "Monkey").substring(0, 20);
        client.color = msg.color || "#8B4513";
        client.lobbyCode = code;
        lobby.players.set(id, {
          name: client.name,
          color: client.color,
          x: Math.random() * 4 - 2, y: 1, z: Math.random() * 4 - 2,
          rx: 0, ry: 0,
        });
        ws.send(JSON.stringify({
          type: "lobby_joined",
          code,
          isHost: lobby.host === id,
          players: getLobbyPlayerList(code),
          lobbyName: lobby.name,
          isPrivate: lobby.isPrivate,
        }));
        broadcast(code, {
          type: "player_joined",
          player: { id, name: client.name, color: client.color, x: 0, y: 1, z: 0, rx: 0, ry: 0 },
        }, ws);
        broadcast(code, { type: "chat", sender: "🐒 Server", text: `${client.name} joined!`, isSystem: true }, ws);
        break;
      }

      case "move": {
        const lobby = lobbies.get(client.lobbyCode);
        if (!lobby) return;
        const player = lobby.players.get(id);
        if (!player) return;
        player.x = msg.x ?? player.x;
        player.y = msg.y ?? player.y;
        player.z = msg.z ?? player.z;
        player.rx = msg.rx ?? player.rx;
        player.ry = msg.ry ?? player.ry;
        broadcast(client.lobbyCode, {
          type: "player_move",
          id, x: player.x, y: player.y, z: player.z,
          rx: player.rx, ry: player.ry,
        }, ws);
        break;
      }

      case "chat": {
        const text = (msg.text || "").substring(0, 200);
        if (!text.trim()) return;
        broadcast(client.lobbyCode, {
          type: "chat",
          sender: client.name,
          text,
          color: client.color,
        });
        // also send to self
        ws.send(JSON.stringify({
          type: "chat",
          sender: client.name,
          text,
          color: client.color,
          isSelf: true,
        }));
        break;
      }

      case "get_lobbies": {
        const publicLobbies = [];
        lobbies.forEach((lobby, code) => {
          if (!lobby.isPrivate) {
            publicLobbies.push({ code, name: lobby.name, players: lobby.players.size });
          }
        });
        ws.send(JSON.stringify({ type: "lobbies_list", lobbies: publicLobbies }));
        break;
      }
    }
  });

  ws.on("close", () => {
    const client = clients.get(ws);
    if (!client) return;
    const lobby = lobbies.get(client.lobbyCode);
    if (lobby) {
      lobby.players.delete(id);
      broadcast(client.lobbyCode, { type: "player_left", id });
      broadcast(client.lobbyCode, { type: "chat", sender: "🐒 Server", text: `${client.name} left.`, isSystem: true });
      if (lobby.players.size === 0) {
        lobbies.delete(client.lobbyCode);
      } else if (lobby.host === id) {
        lobby.host = lobby.players.keys().next().value;
        broadcast(client.lobbyCode, { type: "new_host", id: lobby.host });
      }
    }
    clients.delete(ws);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🐒 Gorilla Tag Server running on port ${PORT}`));
