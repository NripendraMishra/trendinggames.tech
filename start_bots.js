'use strict';

const { spawn } = require('child_process');
const path      = require('path');

// ─── Config ───────────────────────────────────────────────────────────────────

const BOT_COUNT   = 8;
const STAGGER_MS  = 300;   // delay between each bot spawn

// ─── Args ─────────────────────────────────────────────────────────────────────

const roomCode = process.argv[2];
if (!roomCode || !/^\d{5}$/.test(roomCode)) {
    console.error('Usage: node start_bots.js <5-digit-room-code>');
    process.exit(1);
}

console.log(`🎃  Spawning ${BOT_COUNT} bots into room ${roomCode}...\n`);

// ─── Spawn ────────────────────────────────────────────────────────────────────

const botScript = path.join(__dirname, 'bot_server.js');
const children  = [];

for (let i = 0; i < BOT_COUNT; i++) {
    setTimeout(() => {
        const label = `Bot-${i + 1}`;
        const child = spawn(process.execPath, [botScript, roomCode], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        children.push(child);

        child.stdout.on('data', buf => {
            buf.toString().split('\n').filter(Boolean).forEach(line => {
                console.log(`[${label}] ${line}`);
            });
        });

        child.stderr.on('data', buf => {
            buf.toString().split('\n').filter(Boolean).forEach(line => {
                console.error(`[${label}] ERR: ${line}`);
            });
        });

        child.on('exit', code => {
            console.log(`[${label}] exited (code ${code})`);
        });

        console.log(`[${label}] started (pid ${child.pid})`);
    }, i * STAGGER_MS);
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown() {
    console.log('\n🛑  Stopping all bots...');
    for (const child of children) {
        if (!child.killed) child.kill('SIGTERM');
    }
    setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
