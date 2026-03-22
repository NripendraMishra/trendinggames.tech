/**
 * Pumpkin Collector – Multiplayer WebSocket Server (Node.js)
 * ===========================================================
 * Requirements:  npm install ws
 * Run:           node ws_server.js
 * Listens on:    ws://localhost:8765
 */

const { WebSocketServer } = require('ws');

const PORT  = 8765;
// rooms[code] = { players: Map<id, ws>, nextId: number }
const rooms = {};

function randomCode() {
    // 5-digit number — easy to share aloud (10000-99999)
    return String(Math.floor(Math.random() * 90000) + 10000);
}

function send(ws, obj) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function broadcast(room, excludeId, obj) {
    const text = JSON.stringify(obj);
    for (const [pid, ws] of room.players) {
        if (pid !== excludeId && ws.readyState === ws.OPEN) {
            ws.send(text);
        }
    }
}

// ---------------------------------------------------------
// WSS (Secure WebSocket) SETUP
// ---------------------------------------------------------
// To use WSS (wss://), you need to provide your SSL certificates.
// Update the paths below to point to your VPS's SSL certs (e.g., Let's Encrypt).
const https = require('https');
const fs = require('fs');

let server;
let isSecure = false;

try {
    // If these files exist, start as an HTTPS/WSS server
    const options = {
        key: fs.readFileSync('./cert/privkey.pem'),       // <--- UPDATE PATH TO YOUR PRIVATE KEY
        cert: fs.readFileSync('./cert/fullchain.pem')     // <--- UPDATE PATH TO YOUR CERTIFICATE
    };
    server = https.createServer(options);
    server.listen(PORT, '0.0.0.0');
    isSecure = true;
    console.log('✅ Loaded SSL certificates for secure WSS connection.');
} catch (e) {
    // Fallback for local development
    console.log('⚠️ SSL certificates not found (or paths are incorrect).');
    console.log('   Falling back to standard WS (ws://) for local development.');
}

const wssOptions = isSecure ? { server } : { host: '0.0.0.0', port: PORT };
const wss = new WebSocketServer(wssOptions);
// ---------------------------------------------------------

wss.on('connection', (ws) => {
    let pid  = null;
    let code = null;

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        const t = msg.type;

        // ── CREATE ROOM ─────────────────────────────────────────────────
        if (t === 'create') {
            let newCode;
            do { newCode = randomCode(); } while (rooms[newCode]);
            code = newCode;
            pid  = 1;
            rooms[code] = { players: new Map([[1, ws]]), nextId: 2 };
            send(ws, { type: 'created', code, playerId: 1 });
            console.log(`[+] Room ${code} created by P1`);

        // ── JOIN ROOM ────────────────────────────────────────────────────
        } else if (t === 'join') {
            const joinCode = String(msg.code || '').trim();
            const room     = rooms[joinCode];

            if (!room) {
                send(ws, { type: 'error', msg: `Room "${joinCode}" not found.` });
            } else if (room.players.size >= 10) {
                send(ws, { type: 'error', msg: 'Room is full (10/10).' });
            } else {
                code = joinCode;
                pid  = room.nextId++;
                room.players.set(pid, ws);

                const existing = [...room.players.keys()].filter(p => p !== pid);
                send(ws, { type: 'joined', playerId: pid, code });
                send(ws, { type: 'existingPlayers', playerIds: existing });
                broadcast(room, pid, { type: 'playerJoined', playerId: pid });
                console.log(`[+] P${pid} joined room ${code}  (players: ${room.players.size})`);
            }

        // ── RELAY STATE ──────────────────────────────────────────────────
        } else if (t === 'state' && code && rooms[code]) {
            broadcast(rooms[code], pid, {
                type:     'playerState',
                playerId: pid,
                data:     msg.data || {}
            });

        // ── RELAY SNATCH (PvP) ───────────────────────────────────────────
        } else if (t === 'snatch' && code && rooms[code]) {
            const targetWs = rooms[code].players.get(Number(msg.targetId));
            if (targetWs) send(targetWs, { type: 'snatched', fromId: pid, amount: msg.amount || 0 });
        }
    });

    ws.on('close', () => {
        if (!code || !rooms[code] || !pid) return;
        const room = rooms[code];
        room.players.delete(pid);
        console.log(`[-] P${pid} left room ${code}  (players: ${room.players.size})`);

        if (room.players.size > 0) {
            broadcast(room, null, { type: 'playerLeft', playerId: pid });
        } else {
            delete rooms[code];
            console.log(`[-] Room ${code} closed`);
        }
    });

    ws.on('error', (err) => console.error(`[!] WS error (P${pid}):`, err.message));
});

console.log('🎃  Pumpkin Collector — Multiplayer Server (Node.js)');
if (isSecure) {
    console.log(`    wss://0.0.0.0:${PORT} (Secure WebSocket)`);
} else {
    console.log(`    ws://0.0.0.0:${PORT}  (Unsecure WebSocket)`);
}
console.log('    Press Ctrl+C to stop\n');
