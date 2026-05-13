'use strict';

const WebSocket = require('ws');

// ─── Config ───────────────────────────────────────────────────────────────────

const WS_URL         = 'ws://localhost:8765';
const SPEED          = 4;       // units/second (matches wolf speed)
const SYNC_MS        = 50;      // 20 fps state sync
const COLLECT_RANGE  = 3.0;     // units — treat pumpkin as collected when within this distance
const MAP_LIMIT      = 175;     // clamp x/z to ±175

// Wolf simulation
const WOLF_HIT_MIN_S  = 8;      // min seconds between wolf hits
const WOLF_HIT_MAX_S  = 20;     // max seconds between wolf hits
const WOLF_DMG_MIN    = 8;      // min damage per hit
const WOLF_DMG_MAX    = 18;     // max damage per hit

// Wander when no pumpkins known
const TURN_MIN_MS    = 2000;
const TURN_MAX_MS    = 4500;

const LOG_MS         = 5000;

// ─── SimplexNoise (verbatim from game.js) ────────────────────────────────────

const SimplexNoise = (function () {
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;
    const grad3 = [
        [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
        [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
        [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]
    ];

    function SimplexNoise(seed) {
        this.p = new Uint8Array(256);
        this.perm = new Uint8Array(512);
        const rng = seedRNG(seed || Math.random() * 65536);
        for (let i = 0; i < 256; i++) this.p[i] = i;
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [this.p[i], this.p[j]] = [this.p[j], this.p[i]];
        }
        for (let i = 0; i < 512; i++) this.perm[i] = this.p[i & 255];
    }

    function seedRNG(s) {
        return function() {
            s = (s * 16807 + 0) % 2147483647;
            return (s - 1) / 2147483646;
        };
    }

    SimplexNoise.prototype.noise2D = function (xin, yin) {
        let n0, n1, n2;
        const s = (xin + yin) * F2;
        const i = Math.floor(xin + s);
        const j = Math.floor(yin + s);
        const t = (i + j) * G2;
        const X0 = i - t, Y0 = j - t;
        const x0 = xin - X0, y0 = yin - Y0;
        let i1, j1;
        if (x0 > y0) { i1 = 1; j1 = 0; }
        else { i1 = 0; j1 = 1; }
        const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
        const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
        const ii = i & 255, jj = j & 255;
        const gi0 = this.perm[ii + this.perm[jj]] % 12;
        const gi1 = this.perm[ii + i1 + this.perm[jj + j1]] % 12;
        const gi2 = this.perm[ii + 1 + this.perm[jj + 1]] % 12;
        let t0 = 0.5 - x0 * x0 - y0 * y0;
        n0 = t0 < 0 ? 0 : (t0 *= t0, t0 * t0 * (grad3[gi0][0] * x0 + grad3[gi0][1] * y0));
        let t1 = 0.5 - x1 * x1 - y1 * y1;
        n1 = t1 < 0 ? 0 : (t1 *= t1, t1 * t1 * (grad3[gi1][0] * x1 + grad3[gi1][1] * y1));
        let t2 = 0.5 - x2 * x2 - y2 * y2;
        n2 = t2 < 0 ? 0 : (t2 *= t2, t2 * t2 * (grad3[gi2][0] * x2 + grad3[gi2][1] * y2));
        return 70 * (n0 + n1 + n2);
    };

    return SimplexNoise;
})();

// ─── Terrain height (exact same formula as game.js getHeight) ────────────────

const noise = new SimplexNoise(42);

function getHeight(x, z) {
    const flatness = noise.noise2D(x * 0.005 + 100, z * 0.005 + 100);
    if (flatness < 0.4) {
        let h = 0;
        h += noise.noise2D(x * 0.03, z * 0.03) * 1.5;
        h += noise.noise2D(x * 0.08, z * 0.08) * 0.5;
        return h;
    }
    let h = 0;
    const elevation = (flatness - 0.4) / 0.6;
    h += noise.noise2D(x * 0.008, z * 0.008) * 30 * elevation;
    h += noise.noise2D(x * 0.02, z * 0.02) * 12 * elevation;
    h += noise.noise2D(x * 0.06, z * 0.06) * 4;
    h += noise.noise2D(x * 0.15, z * 0.15) * 1.5;
    return h;
}

// ─── Bot state ────────────────────────────────────────────────────────────────

const bot = {
    x: (Math.random() - 0.5) * 60,
    z: (Math.random() - 0.5) * 60,
    yaw: 0,
    hp: 100,
    pumpkins: 0,
    dx: 1, dz: 0,         // heading used when wandering
    playerId: null,
    isDead: false,
};

// Known pumpkin positions received from host (P1)
let knownPumpkins = [];   // [{ x, z }, ...]

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function dist2D(ax, az, bx, bz) {
    const dx = ax - bx, dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function nearestPumpkin() {
    let best = null, bestD = Infinity;
    for (const p of knownPumpkins) {
        const d = dist2D(bot.x, bot.z, p.x, p.z);
        if (d < bestD) { bestD = d; best = p; }
    }
    return best;
}

function steerToward(tx, tz) {
    const dx = tx - bot.x;
    const dz = tz - bot.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.001) return;
    bot.dx  = dx / len;
    bot.dz  = dz / len;
    bot.yaw = Math.atan2(dz, dx);
}

function pickWanderDirection() {
    const angle = Math.random() * Math.PI * 2;
    bot.dx  = Math.cos(angle);
    bot.dz  = Math.sin(angle);
    bot.yaw = angle;
}

function stepBot(dtSec) {
    if (bot.isDead) return;

    const target = nearestPumpkin();
    if (target) {
        steerToward(target.x, target.z);

        // Collected — remove from list, credit bot
        if (dist2D(bot.x, bot.z, target.x, target.z) < COLLECT_RANGE) {
            knownPumpkins = knownPumpkins.filter(p => p !== target);
            bot.pumpkins++;
            console.log(`   🎃 Bot collected pumpkin! total=${bot.pumpkins}`);
        }
    }

    bot.x = clamp(bot.x + bot.dx * SPEED * dtSec, -MAP_LIMIT, MAP_LIMIT);
    bot.z = clamp(bot.z + bot.dz * SPEED * dtSec, -MAP_LIMIT, MAP_LIMIT);

    if (Math.abs(bot.x) >= MAP_LIMIT || Math.abs(bot.z) >= MAP_LIMIT) {
        pickWanderDirection();
    }
}

// ─── Wolf simulation ──────────────────────────────────────────────────────────

function scheduleWolfHit() {
    const delay = (WOLF_HIT_MIN_S + Math.random() * (WOLF_HIT_MAX_S - WOLF_HIT_MIN_S)) * 1000;
    setTimeout(() => {
        if (bot.isDead) { scheduleWolfHit(); return; }
        const dmg = WOLF_DMG_MIN + Math.floor(Math.random() * (WOLF_DMG_MAX - WOLF_DMG_MIN + 1));
        bot.hp = Math.max(0, bot.hp - dmg);
        console.log(`   🐺 Wolf hit bot! -${dmg} HP → ${bot.hp}`);
        if (bot.hp <= 0) respawnBot();
        else scheduleWolfHit();
    }, delay);
}

function respawnBot() {
    bot.isDead = true;
    console.log(`   💀 Bot died — respawning in 3s...`);
    setTimeout(() => {
        bot.x        = (Math.random() - 0.5) * 60;
        bot.z        = (Math.random() - 0.5) * 60;
        bot.hp       = 100;
        bot.pumpkins = 0;
        bot.isDead   = false;
        pickWanderDirection();
        console.log(`   ♻️  Bot respawned at (${bot.x.toFixed(1)}, ${bot.z.toFixed(1)})`);
        scheduleWolfHit();
    }, 3000);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const roomCode = process.argv[2];
if (!roomCode || !/^\d{5}$/.test(roomCode)) {
    console.error('Usage: node bot_server.js <5-digit-room-code>');
    process.exit(1);
}

console.log(`🤖  Bot joining room ${roomCode}...`);

const ws = new WebSocket(WS_URL);

ws.on('error', err => {
    console.error(`❌  WS error: ${err.message}`);
    process.exit(1);
});

ws.on('close', () => {
    console.log('\n🔌  Disconnected. Bye!');
    process.exit(0);
});

ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'join', code: roomCode }));
});

let syncInterval = null;
let logInterval  = null;
let turnTimeout  = null;
let lastTick     = Date.now();

function scheduleTurn() {
    const delay = TURN_MIN_MS + Math.random() * (TURN_MAX_MS - TURN_MIN_MS);
    turnTimeout = setTimeout(() => {
        if (!nearestPumpkin()) pickWanderDirection();
        scheduleTurn();
    }, delay);
}

function startLoops() {
    pickWanderDirection();
    scheduleTurn();
    scheduleWolfHit();

    syncInterval = setInterval(() => {
        const now = Date.now();
        const dt  = (now - lastTick) / 1000;
        lastTick  = now;

        stepBot(dt);

        const y = getHeight(bot.x, bot.z) + 1.7;

        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'state',
                data: {
                    x:        parseFloat(bot.x.toFixed(3)),
                    y:        parseFloat(y.toFixed(3)),
                    z:        parseFloat(bot.z.toFixed(3)),
                    yaw:      parseFloat(bot.yaw.toFixed(4)),
                    hp:       bot.hp,
                    pumpkins: bot.pumpkins,
                },
            }));
        }
    }, SYNC_MS);

    logInterval = setInterval(() => {
        const target = nearestPumpkin();
        const tStr   = target ? `→ pumpkin at (${target.x.toFixed(1)}, ${target.z.toFixed(1)})` : 'wandering';
        console.log(`   🤖 (${bot.x.toFixed(1)}, ${bot.z.toFixed(1)})  HP=${bot.hp}  🎃=${bot.pumpkins}  known=${knownPumpkins.length}  ${tStr}`);
    }, LOG_MS);
}

ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
        case 'joined':
            bot.playerId = msg.playerId;
            console.log(`✅  Joined as Player ${msg.playerId} in room ${msg.code}`);
            console.log(`🚶  Running... (Ctrl+C to stop)\n`);
            startLoops();
            break;

        case 'error':
            console.error(`❌  Server error: ${msg.msg}`);
            ws.close();
            break;

        case 'existingPlayers':
            console.log(`   Existing players: [${msg.playerIds.join(', ')}]`);
            break;

        case 'worldState':
            // Full pumpkin list from P1 — replace known set
            knownPumpkins = msg.pumpkins || [];
            break;

        case 'playerJoined':
            console.log(`   (+) Player ${msg.playerId} joined`);
            break;

        case 'playerLeft':
            console.log(`   (-) Player ${msg.playerId} left`);
            if (msg.playerId === 1) {
                console.log('   Host left — stopping bot.');
                ws.close();
            }
            break;

        case 'snatched':
            bot.pumpkins = Math.max(0, bot.pumpkins - msg.amount);
            console.log(`   ⚡ Snatched by P${msg.fromId}! -${msg.amount} pumpkins → ${bot.pumpkins}`);
            break;
    }
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown() {
    clearInterval(syncInterval);
    clearInterval(logInterval);
    clearTimeout(turnTimeout);
    if (ws.readyState === WebSocket.OPEN) ws.close();
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
