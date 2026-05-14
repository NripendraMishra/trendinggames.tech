'use strict';

/**
 * ws_bot_server_game3.js — FPS Bot Server
 * =========================================
 * Connects 6 bot clients to the game's WebSocket server.
 * Each bot joins a room, moves around the map, shoots at real players,
 * takes damage, and respawns — behaving like real players from the server's view.
 *
 * Usage:
 *   node ws_bot_server_game3.js [roomCode]
 *
 * If roomCode is omitted, bot #1 creates a room and prints the code.
 * Pass the code to fps.html to join and play against bots.
 */

const WebSocket = require('ws');

// ── Config ────────────────────────────────────────────────────────────────────
const SERVER_URL   = process.env.BOT_SERVER_URL || 'ws://localhost:8765';
const BOT_COUNT    = 6;
const TICK_MS      = 50;      // 20 Hz state broadcast
const SHOOT_RANGE  = 35;      // units — max shoot distance
const SHOOT_CD     = 1.1;     // seconds between shots per bot
const BOT_SPEED    = 3.5;     // units/s
const GRAVITY      = -25;
const PLAYER_H     = 1.7;
const MAP_LIMIT    = 84;
const RESPAWN_SECS = 3000;    // ms

// de_dust2 AABB cover boxes — mirrors generateMap() in fps.js
// Each entry: [cx, cy_min, cz, w, h, d]  (cx/cz = centre, cy_min = floor y)
// We only need enough geometry for bot pathfinding avoidance.
// Full list is expensive to maintain — bots use boundary clamping + simple obstacle nudge.
const SPAWN_POINTS = [
    [-72, -72], [-60, -70],   // T-spawn
    [ 72,  72], [ 60,  70],   // CT-spawn
    [  0,   0], [ 20, -30],   // mid / long A
];

// ── Utility ───────────────────────────────────────────────────────────────────
function rand(min, max) { return min + Math.random() * (max - min); }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function dist2d(ax, az, bx, bz) {
    const dx = ax - bx, dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
}

// ── Bot state ─────────────────────────────────────────────────────────────────
class Bot {
    constructor(id, roomCode, isCreator) {
        this.id         = id;       // assigned by server after join
        this.name       = `BOT_${id}`;
        this.roomCode   = roomCode;
        this.isCreator  = isCreator;

        // Physics
        this.x   = 0; this.y = PLAYER_H; this.z = 0;
        this.vx  = 0; this.vy = 0;       this.vz = 0;
        this.yaw = Math.random() * Math.PI * 2;
        this.onGround = false;

        // State
        this.hp           = 100;
        this.kills        = 0;
        this.deaths       = 0;
        this.shootCd      = Math.random() * SHOOT_CD;  // stagger initial shots
        this.thinkTimer   = 0;
        this.wanderAngle  = this.yaw;
        this.wanderTimer  = rand(1, 3);
        this.targetX      = null;
        this.targetZ      = null;
        this.dead         = false;

        // WS
        this.ws          = null;
        this.serverId    = null;   // playerId assigned by ws_server
        this.syncTimer   = 0;

        // All known players in room: id → {x, z, hp}
        this.peers       = {};

        this._connect();
    }

    _connect() {
        const ws = new WebSocket(SERVER_URL);
        this.ws = ws;

        ws.on('open', () => {
            if (this.isCreator) {
                ws.send(JSON.stringify({ type: 'create' }));
            } else {
                ws.send(JSON.stringify({ type: 'join', code: this.roomCode }));
            }
        });

        ws.on('message', raw => {
            let msg;
            try { msg = JSON.parse(raw); } catch { return; }
            this._onMessage(msg);
        });

        ws.on('close', () => {
            if (!this.dead) {
                console.log(`[bot ${this.name}] disconnected, reconnecting in 2s…`);
                setTimeout(() => this._connect(), 2000);
            }
        });

        ws.on('error', err => console.error(`[bot ${this.name}] ws error:`, err.message));
    }

    _onMessage(msg) {
        switch (msg.type) {
            case 'created':
                this.serverId = msg.playerId;
                this.roomCode = msg.code;
                console.log(`\n🤖  Bot server room code: ${msg.code}`);
                console.log(`    Open fps.html and enter this code to play against bots.\n`);
                this._respawnAt(SPAWN_POINTS[0]);
                startRemainingBots(msg.code);
                break;

            case 'joined':
                this.serverId = msg.playerId;
                const spIdx = (this.serverId - 1) % SPAWN_POINTS.length;
                this._respawnAt(SPAWN_POINTS[spIdx]);
                break;

            case 'existingPlayers':
                for (const pid of (msg.playerIds || [])) {
                    if (!this.peers[pid]) this.peers[pid] = { x: 0, z: 0, hp: 100 };
                }
                break;

            case 'playerJoined':
                this.peers[msg.playerId] = { x: 0, z: 0, hp: 100 };
                break;

            case 'playerState':
                if (!this.peers[msg.playerId]) this.peers[msg.playerId] = { x: 0, z: 0, hp: 100 };
                const d = msg.data || {};
                this.peers[msg.playerId].x  = d.x  ?? this.peers[msg.playerId].x;
                this.peers[msg.playerId].z  = d.z  ?? this.peers[msg.playerId].z;
                this.peers[msg.playerId].hp = d.hp ?? this.peers[msg.playerId].hp;
                break;

            case 'playerLeft':
                delete this.peers[msg.playerId];
                break;

            case 'damaged':
                if (this.hp <= 0) break;
                this.hp = Math.max(0, this.hp - (msg.damage || 0));
                console.log(`[bot ${this.name}] hit by P${msg.fromId} for ${msg.damage} — HP ${this.hp}`);
                if (this.hp <= 0) this._die(msg.fromId);
                break;

            case 'killed':
                // Track kills for peer bots
                if (msg.killerId === this.serverId) {
                    this.kills++;
                    console.log(`[bot ${this.name}] got a kill! (${this.kills} total)`);
                }
                // If victim is one of our peer bots managed elsewhere, handled by that bot instance
                break;
        }
    }

    _die(killerId) {
        this.dead = true;
        this.hp   = 0;
        this.deaths++;
        this._sendState();   // broadcast hp=0

        // Broadcast killed event
        this._send({ type: 'killed', victimId: this.serverId });

        console.log(`[bot ${this.name}] died (killed by P${killerId}) — respawning in ${RESPAWN_SECS / 1000}s`);

        setTimeout(() => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
            this.dead = false;
            this.hp   = 100;
            const spIdx = Math.floor(Math.random() * SPAWN_POINTS.length);
            this._respawnAt(SPAWN_POINTS[spIdx]);
            console.log(`[bot ${this.name}] respawned`);
        }, RESPAWN_SECS);
    }

    _respawnAt([x, z]) {
        this.x = x + rand(-3, 3);
        this.z = z + rand(-3, 3);
        this.y = PLAYER_H;
        this.vx = 0; this.vy = 0; this.vz = 0;
        this.onGround = false;
        this._sendState();
    }

    _send(obj) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(obj));
        }
    }

    _sendState() {
        this._send({
            type: 'state',
            data: {
                x:      parseFloat(this.x.toFixed(3)),
                y:      parseFloat(this.y.toFixed(3)),
                z:      parseFloat(this.z.toFixed(3)),
                yaw:    parseFloat(this.yaw.toFixed(4)),
                hp:     this.hp,
                kills:  this.kills,
                deaths: this.deaths,
            }
        });
    }

    // ── AI tick (called every TICK_MS) ────────────────────────────────────────
    tick(dtSec) {
        if (this.dead || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        // Find nearest live peer (real player or another bot peer)
        let nearestId = null, nearestDist = Infinity;
        for (const [pid, peer] of Object.entries(this.peers)) {
            if (peer.hp <= 0) continue;
            const d = dist2d(this.x, this.z, peer.x, peer.z);
            if (d < nearestDist) { nearestDist = d; nearestId = pid; }
        }

        // ── Movement ─────────────────────────────────────────────────────────
        this.wanderTimer -= dtSec;

        if (nearestId && nearestDist < SHOOT_RANGE * 1.5) {
            // Chase target
            const peer = this.peers[nearestId];
            const angle = Math.atan2(peer.x - this.x, peer.z - this.z) + Math.PI;
            this.yaw = angle;
            this.vx  = Math.sin(angle) * BOT_SPEED * 0.6;
            this.vz  = -Math.cos(angle) * BOT_SPEED * 0.6;

            // Occasional strafe juke
            if (this.wanderTimer <= 0) {
                this.wanderTimer = rand(0.4, 1.2);
                this.vx += Math.cos(angle) * BOT_SPEED * rand(-0.5, 0.5);
                this.vz += Math.sin(angle) * BOT_SPEED * rand(-0.5, 0.5);
            }
        } else {
            // Wander
            if (this.wanderTimer <= 0) {
                this.wanderTimer = rand(1.5, 3.5);
                this.wanderAngle += rand(-1.2, 1.2);
                // Bias toward map center to avoid corners
                const toCx = -this.x * 0.02;
                const toCz = -this.z * 0.02;
                this.wanderAngle += Math.atan2(toCx, toCz) * 0.1;
            }
            this.vx = Math.sin(this.wanderAngle) * BOT_SPEED * 0.4;
            this.vz = Math.cos(this.wanderAngle) * BOT_SPEED * 0.4;
            this.yaw = this.wanderAngle;
        }

        // Gravity + ground
        this.vy += GRAVITY * dtSec;
        this.x  += this.vx * dtSec;
        this.z  += this.vz * dtSec;
        this.y  += this.vy * dtSec;

        if (this.y <= PLAYER_H) {
            this.y = PLAYER_H;
            this.vy = 0;
            this.onGround = true;
            // Occasional jump
            if (Math.random() < 0.008) this.vy = 10;
        }

        // Map boundary
        this.x = clamp(this.x, -(MAP_LIMIT - 1), MAP_LIMIT - 1);
        this.z = clamp(this.z, -(MAP_LIMIT - 1), MAP_LIMIT - 1);

        // Simple wall bounce on boundary
        if (Math.abs(this.x) >= MAP_LIMIT - 1) { this.vx *= -1; this.wanderAngle += Math.PI; }
        if (Math.abs(this.z) >= MAP_LIMIT - 1) { this.vz *= -1; this.wanderAngle += Math.PI; }

        // ── Shooting ─────────────────────────────────────────────────────────
        this.shootCd -= dtSec;
        if (this.shootCd <= 0 && nearestId && nearestDist < SHOOT_RANGE) {
            this.shootCd = SHOOT_CD + rand(-0.1, 0.15);  // slight randomness
            this._botShoot(nearestId, nearestDist);
        }

        // ── Sync state ───────────────────────────────────────────────────────
        this.syncTimer += dtSec;
        if (this.syncTimer >= TICK_MS / 1000) {
            this.syncTimer = 0;
            this._sendState();
        }
    }

    _botShoot(targetId, dist) {
        // Accuracy degrades with distance: 90% at close, 55% at max range
        const accuracy = 0.9 - (dist / SHOOT_RANGE) * 0.35;
        if (Math.random() > accuracy) return;   // missed

        const damage = 10;  // bots never headshot

        this._send({
            type:     'hit',
            targetId: Number(targetId),
            damage,
            headshot: false,
        });

        console.log(`[bot ${this.name}] shot P${targetId} for ${damage}`);
    }
}

// ── Bot pool ──────────────────────────────────────────────────────────────────
const bots = [];

function startRemainingBots(roomCode) {
    for (let i = 1; i < BOT_COUNT; i++) {
        // Stagger connections so server doesn't get hammered
        setTimeout(() => {
            const bot = new Bot(`${i + 1}`, roomCode, false);
            bots.push(bot);
        }, i * 300);
    }
}

// Bot 0 creates the room; rest join after room code is known
const creatorBot = new Bot('1', null, true);
bots.push(creatorBot);

// ── Tick loop ─────────────────────────────────────────────────────────────────
const DT = TICK_MS / 1000;
setInterval(() => {
    for (const bot of bots) bot.tick(DT);
}, TICK_MS);

// ── Ensure bot count stays at 6 (replace dead/disconnected) ──────────────────
setInterval(() => {
    const aliveBots = bots.filter(b => b.ws && b.ws.readyState === WebSocket.OPEN);
    if (aliveBots.length < BOT_COUNT && creatorBot.roomCode) {
        const needed = BOT_COUNT - aliveBots.length;
        console.log(`[bot-server] Replacing ${needed} disconnected bot(s)…`);
        for (let i = 0; i < needed; i++) {
            const idx = bots.length + i + 1;
            const bot = new Bot(`${idx}`, creatorBot.roomCode, false);
            bots.push(bot);
        }
    }
}, 5000);

console.log(`🤖  FPS Bot Server — connecting to ${SERVER_URL}`);
console.log(`    Spawning ${BOT_COUNT} bots…`);
console.log(`    Press Ctrl+C to stop\n`);
