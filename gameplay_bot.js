/**
 * gameplay_bot.js — Pumpkin Collector Multiplayer Bot
 * Two Chromium windows, 12 minutes of automated gameplay.
 *
 * Usage: node gameplay_bot.js
 */

const { chromium } = require('playwright');
const path          = require('path');
const fs            = require('fs');

const HTTP_URL          = 'http://localhost:3000';
const THREE_LOCAL_PATH  = path.join(__dirname, 'three.min.js');
const GAME_MINUTES      = 12;
const GAME_MS           = GAME_MINUTES * 60 * 1000;
const STAT_INTERVAL_MS  = 2 * 60 * 1000;

// ─── tiny helpers ─────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function safeEval(page, fn, fallback = null) {
    try { return await page.evaluate(fn); } catch { return fallback; }
}

async function getPlayerState(page) {
    return safeEval(page, () => {
        // game is a top-level const — accessible via script scope but NOT window.game
        const g = typeof game !== 'undefined' ? game : null;
        const p = g && g.player;
        if (!p) return null;
        return { hp: p.hp, coins: p.coins, pumpkins: p.pumpkins, maxHp: p.maxHp || 100 };
    }, null);
}

async function pressKey(page, key, duration = 80) {
    await page.keyboard.down(key);
    await sleep(duration);
    await page.keyboard.up(key);
}

async function holdKey(page, key, ms) {
    await page.keyboard.down(key);
    await sleep(ms);
    await page.keyboard.up(key);
}

async function mouseLook(page, dx, dy) {
    try {
        const box = await page.locator('canvas').first().boundingBox();
        if (!box) return;
        const cx = box.x + box.width  / 2;
        const cy = box.y + box.height / 2;
        await page.mouse.move(cx, cy);
        await page.mouse.move(cx + dx, cy + dy, { steps: 10 });
    } catch { /* ignore */ }
}

async function clickCanvas(page) {
    try { await page.locator('canvas').first().click({ timeout: 5000 }); } catch { /* ignore */ }
}

// ─── overlay / game-over handling ─────────────────────────────────────────────

async function dismissOverlays(page, label) {
    // Rotate overlay — hide it
    try {
        await page.evaluate(() => {
            const el = document.getElementById('rotate-overlay');
            if (el) el.style.display = 'none';
        });
    } catch { /* ignore */ }
}

// Returns true if game over was detected and handled (page reloads — caller must re-init)
async function checkGameOver(page, label) {
    try {
        const vis = await page.locator('#game-over').isVisible({ timeout: 300 }).catch(() => false);
        if (!vis) return false;
        console.log(`  [${label}] Game Over — clicking PLAY AGAIN`);
        await page.locator('#game-over button:has-text("PLAY AGAIN")').click().catch(() => {});

        // Wait for page reload — domcontentloaded fires after location.reload()
        await page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
        await sleep(1000);

        // Re-patch pointer lock on the fresh page
        await page.evaluate(() => {
            Element.prototype.requestPointerLock = function() {
                if (typeof game !== 'undefined') game.isLocked = true;
                return Promise.resolve();
            };
        }).catch(() => {});

        // Skip loader, show blocker
        await page.evaluate(() => {
            const l = document.getElementById('loader');
            if (l) l.style.display = 'none';
            const b = document.getElementById('blocker');
            if (b) b.style.display = 'flex';
        }).catch(() => {});

        // Wait for #blocker to be visible
        await page.waitForSelector('#blocker', { state: 'visible', timeout: 10000 }).catch(() => {});

        await page.locator('button.difficulty-btn[data-difficulty="normal"]').click({ timeout: 3000 }).catch(() => {});
        await page.locator('#start-btn').click({ timeout: 3000 }).catch(() => {});

        // Wait for game world to be running (same logic as waitForGameWorld)
        for (let i = 0; i < 30; i++) {
            const info = await safeEval(page, () => {
                if (typeof game === 'undefined') return { ready: false, status: 'no-game' };
                return { ready: game.isRunning === true, status: String(game.isRunning) };
            }, { ready: false, status: 'eval-failed' });

            if (info.ready) {
                await page.evaluate(() => { if (typeof game !== 'undefined') game.isLocked = true; }).catch(() => {});
                console.log(`  [${label}] Back in game ✓`);
                return true;
            }

            if (i >= 1 && info.status === 'false') {
                await safeEval(page, () => {
                    if (typeof game !== 'undefined' && !game.isRunning) game._proceedGameStart();
                });
            }
            await sleep(1000);
        }

        // Fallback: force it
        await page.evaluate(() => {
            if (typeof game !== 'undefined') {
                if (!game.isRunning) game._proceedGameStart();
                game.isLocked = true;
            }
        }).catch(() => {});
        return true;
    } catch { return false; }
}

// ─── shop helpers (call game methods directly via evaluate) ───────────────────

async function shopSell(page) {
    return safeEval(page, () => { game.sellPumpkins(); return true; }, false);
}
async function shopHeal(page) {
    return safeEval(page, () => { game.buyHealthPotion(); return true; }, false);
}
async function shopUpgrade(page) {
    return safeEval(page, () => { game.upgradeWeapon(); return true; }, false);
}
async function shopBuyGun(page, slot) {
    // Gun shop items are rendered dynamically; click via DOM
    try {
        const btns = await page.locator('#gun-shop-items button').all();
        for (const btn of btns) {
            const txt = (await btn.textContent()) || '';
            if (txt.toUpperCase().includes('BUY') || txt.toUpperCase().includes('SHOTGUN')) {
                // Check if it references the right slot (slot 2 = shotgun)
                const parent = btn.locator('..');
                const label  = await parent.textContent().catch(() => '');
                if (label.toLowerCase().includes('shotgun') || btns.indexOf(btn) === 0) {
                    await btn.click();
                    return true;
                }
            }
        }
    } catch { /* ignore */ }
    return false;
}

async function doShopVisit(page, role, label) {
    const state = await getPlayerState(page);
    if (!state) return;

    // Open shop via keyboard
    await pressKey(page, 'b');
    await sleep(400);

    // Check shop is open
    const isOpen = await safeEval(page, () => {
        const s = document.getElementById('shop-panel');
        return s && (s.style.display === 'block' || s.style.display === 'flex' ||
                     getComputedStyle(s).display !== 'none');
    }, false);

    if (!isOpen) {
        await safeEval(page, () => { if (typeof game !== 'undefined' && game.toggleShop) game.toggleShop(); });
        await sleep(300);
    }

    // Sell pumpkins first
    if (state.pumpkins > 0) {
        await shopSell(page);
        console.log(`  [${label}] Sold ${state.pumpkins} pumpkins`);
        await sleep(200);
    }

    // Refresh state after selling
    const s2 = await getPlayerState(page);
    if (!s2) { await pressKey(page, 'b'); return; }

    // Emergency heal
    if (s2.hp < 60 && s2.coins >= 15) {
        await shopHeal(page);
        console.log(`  [${label}] Bought health potion (HP=${s2.hp}, coins=${s2.coins})`);
        await sleep(200);
    }

    // Role-specific upgrades
    if (role === 1 && s2.coins >= 20) {
        await shopUpgrade(page);
        console.log(`  [${label}] P1 upgraded weapon`);
    } else if (role === 2) {
        const bought = await shopBuyGun(page, 2);
        if (bought) console.log(`  [${label}] P2 bought gun`);
        else if (s2.coins >= 20) {
            await shopUpgrade(page);
            console.log(`  [${label}] P2 upgraded weapon`);
        }
    }

    // Close shop
    await pressKey(page, 'b');
    await sleep(200);
}

// ─── SETUP: difficulty select ─────────────────────────────────────────────────

async function selectDifficulty(page, label) {
    // Wait for blocker (start screen) to be visible
    await page.waitForSelector('#blocker', { state: 'visible', timeout: 20000 });
    await sleep(300);

    // NORMAL is the default active button, but click it explicitly to be sure
    await page.locator('button.difficulty-btn[data-difficulty="normal"]').click({ timeout: 5000 });
    console.log(`  [${label}] Selected NORMAL difficulty`);
    await sleep(200);
}

// ─── SETUP: P1 creates room ───────────────────────────────────────────────────

async function createRoomAndStart(page) {
    // Leave room-code-input empty → game.startGame() will call ws.send({type:'create'})
    await page.locator('#room-code-input').fill('');
    await sleep(200);

    await page.locator('#start-btn').click({ timeout: 5000 });
    console.log('  [P1] Clicked CLICK TO PLAY (creating room)');

    // Wait for room code to appear in #room-code-display
    let code = null;
    for (let i = 0; i < 40; i++) {
        code = await safeEval(page, () => {
            // Try HUD display element
            const el = document.getElementById('room-code-display');
            if (el) {
                const txt = el.textContent.trim();
                if (/^\d{5}$/.test(txt)) return txt;
            }
            // Fall back to game.mp.roomCode (top-level const, not window.game)
            if (typeof game === 'undefined') return null;
            const mp = game.mp;
            if (mp && mp.roomCode && /^\d{5}$/.test(String(mp.roomCode))) return String(mp.roomCode);
            return null;
        });
        if (code) break;
        await sleep(500);
    }

    if (!code) throw new Error('P1: could not retrieve room code after 20 seconds');
    console.log(`  [P1] Room created — code: ${code}`);
    return code;
}

// ─── SETUP: P2 joins room ─────────────────────────────────────────────────────

async function joinRoomAndStart(page, code) {
    await page.locator('#room-code-input').fill(code, { timeout: 5000 });
    await sleep(300);
    await page.locator('#start-btn').click({ timeout: 5000 });
    console.log(`  [P2] Clicked CLICK TO PLAY (joining room ${code})`);
}

// ─── SETUP: wait for game world ───────────────────────────────────────────────

async function waitForGameWorld(page, label) {
    console.log(`  [${label}] Waiting for game world...`);
    for (let i = 0; i < 60; i++) {
        const info = await safeEval(page, () => {
            if (typeof game === 'undefined') return { ready: false, isRunning: 'no-game' };
            return {
                ready:     game.isRunning === true,
                isRunning: game.isRunning,
            };
        }, { ready: false, isRunning: 'eval-failed' });

        if (i % 5 === 0) {
            console.log(`  [${label}] tick ${i}: isRunning=${info.isRunning}`);
        }

        if (info.ready) {
            console.log(`  [${label}] In game world ✓`);
            return;
        }

        // If game object exists but not yet running, call _proceedGameStart directly
        if (i >= 1 && info.isRunning === false) {
            await safeEval(page, () => {
                if (typeof game !== 'undefined' && !game.isRunning) {
                    game._proceedGameStart();
                }
            });
        }

        await sleep(1000);
    }
    throw new Error(`${label}: game world did not load within 60 seconds`);
}

// ─── MOVEMENT plan ────────────────────────────────────────────────────────────

function makeState(role) {
    return {
        role,
        label:        `P${role}`,
        lastActivity: Date.now(),
        shopTimer:    Date.now() - (role === 2 ? 30_000 : 0),  // stagger shop visits
        attackTimer:  Date.now(),
        lookTimer:    Date.now(),
        collectTimer: Date.now(),
    };
}

// Random movement segment
function randomMove() {
    const fwds   = ['KeyW', 'KeyW', 'KeyW', 'KeyS'];            // bias forward
    const sides  = ['KeyA', 'KeyD', null, null, null];           // sometimes strafe
    return {
        fwd:      fwds [Math.floor(Math.random() * fwds.length)],
        side:     sides[Math.floor(Math.random() * sides.length)],
        sprint:   Math.random() < 0.22,
        jump:     Math.random() < 0.12,
        duration: 700 + Math.random() * 2500,
    };
}

// ─── PLAYER LOOP ──────────────────────────────────────────────────────────────

async function runPlayerLoop(page, st, stopSignal) {
    const SHOP_INTERVAL = 40_000;

    while (!stopSignal.stop) {
        // Check for game over / page reload
        const wasOver = await checkGameOver(page, st.label).catch(() => false);
        if (wasOver) {
            st.lastActivity = Date.now();
            st.shopTimer    = Date.now();
            await sleep(1000);
            continue;
        }

        await dismissOverlays(page, st.label);

        const ps = await getPlayerState(page);

        // Game state not yet available — wait
        if (!ps) { await sleep(500); continue; }

        const now = Date.now();

        // ── Emergency heal (only if we have coins) ───────────────────────────
        if (ps.hp < 50 && ps.coins >= 15) {
            console.log(`  [${st.label}] HP critical (${ps.hp}) — healing`);
            await pressKey(page, 'b').catch(() => {}); await sleep(350);
            await shopHeal(page);
            await sleep(200);
            await pressKey(page, 'b').catch(() => {}); await sleep(200);
            st.lastActivity = Date.now();
            await sleep(300);
            continue;
        }

        // ── Shop visit ───────────────────────────────────────────────────────
        if (now - st.shopTimer > SHOP_INTERVAL) {
            st.shopTimer = now;
            await doShopVisit(page, st.role, st.label).catch(e => console.log(`  [${st.label}] shop error: ${e.message}`));
            st.lastActivity = now;
            await sleep(300);
            continue;
        }

        // ── Collect (E) ──────────────────────────────────────────────────────
        if (now - st.collectTimer > 2500 + Math.random() * 2000) {
            await pressKey(page, 'KeyE', 100).catch(() => {});
            st.collectTimer  = Date.now();
            st.lastActivity  = Date.now();
        }

        // ── Attack (F) ───────────────────────────────────────────────────────
        if (now - st.attackTimer > 1200 + Math.random() * 600) {
            await pressKey(page, 'KeyF', 130).catch(() => {});
            st.attackTimer  = Date.now();
            st.lastActivity = Date.now();
        }

        // ── Look around ──────────────────────────────────────────────────────
        if (now - st.lookTimer > 900 + Math.random() * 700) {
            await mouseLook(page, (Math.random() - 0.5) * 350, (Math.random() - 0.5) * 50).catch(() => {});
            st.lookTimer    = Date.now();
            st.lastActivity = Date.now();
        }

        // ── WASD movement ────────────────────────────────────────────────────
        try {
            const mv = randomMove();
            const keysDown = [mv.fwd];
            if (mv.side) keysDown.push(mv.side);

            if (mv.sprint) await page.keyboard.down('ShiftLeft');
            for (const k of keysDown) await page.keyboard.down(k);

            if (mv.jump) {
                const jumpAt = Math.random() * mv.duration;
                await sleep(jumpAt);
                await pressKey(page, 'Space', 80).catch(() => {});
                await sleep(Math.max(0, mv.duration - jumpAt));
            } else {
                await sleep(mv.duration);
            }

            for (const k of keysDown) await page.keyboard.up(k).catch(() => {});
            if (mv.sprint) await page.keyboard.up('ShiftLeft').catch(() => {});

            st.lastActivity = Date.now();
        } catch { /* page may have navigated */ await sleep(500); continue; }

        // ── Idle watchdog ────────────────────────────────────────────────────
        if (Date.now() - st.lastActivity > 10_000) {
            console.log(`  [${st.label}] Idle watchdog — forcing W burst`);
            await holdKey(page, 'KeyW', 1500).catch(() => {});
            st.lastActivity = Date.now();
        }

        await sleep(80 + Math.random() * 150);
    }
}

// ─── STATS ────────────────────────────────────────────────────────────────────

async function logStats(pages, labels, elapsed) {
    const m = Math.floor(elapsed / 60000);
    const s = Math.floor((elapsed % 60000) / 1000);
    console.log(`\n📊  Stats at ${m}m ${s}s:`);
    for (let i = 0; i < pages.length; i++) {
        const ps = await getPlayerState(pages[i]);
        if (ps) console.log(`    ${labels[i]}: HP=${ps.hp}/${ps.maxHp}  🎃=${ps.pumpkins}  🪙=${ps.coins}`);
        else    console.log(`    ${labels[i]}: (unavailable)`);
    }
    console.log('');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

(async () => {
    console.log('🎃  Pumpkin Collector Gameplay Bot');
    console.log(`    Duration: ${GAME_MINUTES} minutes\n`);

    const browser = await chromium.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-infobars'],
    });

    const ctx1 = await browser.newContext({ viewport: { width: 960, height: 860 } });
    const ctx2 = await browser.newContext({ viewport: { width: 960, height: 860 } });
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    // Best-effort window positioning
    try {
        await page1.evaluate(() => window.moveTo(0,   0));
        await page2.evaluate(() => window.moveTo(960, 0));
    } catch { /* ignore */ }

    // Capture page console errors for debugging
    page1.on('console', msg => { if (msg.type() === 'error') console.log(`  [P1-console] ${msg.text()}`); });
    page2.on('console', msg => { if (msg.type() === 'error') console.log(`  [P2-console] ${msg.text()}`); });
    page1.on('pageerror', err => console.log(`  [P1-pageerror] ${err.message}`));
    page2.on('pageerror', err => console.log(`  [P2-pageerror] ${err.message}`));

    // Route CDN three.js to local file to avoid network timeout
    const threeJs = fs.readFileSync(THREE_LOCAL_PATH, 'utf8');
    for (const ctx of [ctx1, ctx2]) {
        await ctx.route('**/three.js/r128/**three.min.js', route => {
            route.fulfill({ status: 200, contentType: 'application/javascript', body: threeJs });
        });
        // Block slow external ad scripts that cause networkidle to hang
        await ctx.route('**profitablecpmrate**', route => route.abort());
        await ctx.route('**highperformanceformat**', route => route.abort());
        await ctx.route('**googletagmanager**', route => route.abort());
        await ctx.route('**googlesyndication**', route => route.abort());
    }

    // ── Navigate ─────────────────────────────────────────────────────────────
    console.log('Navigating to game...');
    await Promise.all([
        page1.goto(HTTP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }),
        page2.goto(HTTP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }),
    ]);
    console.log('Pages loaded.');

    // Skip the fake 10-second loader by hiding it immediately
    await Promise.all([
        page1.evaluate(() => {
            const l = document.getElementById('loader');
            if (l) l.style.display = 'none';
            const b = document.getElementById('blocker');
            if (b) b.style.display = 'flex';
        }),
        page2.evaluate(() => {
            const l = document.getElementById('loader');
            if (l) l.style.display = 'none';
            const b = document.getElementById('blocker');
            if (b) b.style.display = 'flex';
        }),
    ]);

    // Wait for #blocker to become visible (loader countdown finishes ~10s, or we skip it)
    await Promise.all([
        page1.waitForSelector('#blocker', { state: 'visible', timeout: 30000 }),
        page2.waitForSelector('#blocker', { state: 'visible', timeout: 30000 }),
    ]);
    console.log('Start screen visible on both windows.');

    // Diagnose: check if THREE and game are available
    const [p1three, p2three] = await Promise.all([
        safeEval(page1, () => typeof THREE, 'error'),
        safeEval(page2, () => typeof THREE, 'error'),
    ]);
    const [p1game, p2game] = await Promise.all([
        safeEval(page1, () => typeof game, 'error'),
        safeEval(page2, () => typeof game, 'error'),
    ]);
    console.log(`  THREE: P1=${p1three} P2=${p2three}`);
    console.log(`  game: P1=${p1game} P2=${p2game}`);

    // Patch requestPointerLock to no-op AND fake isLocked so updatePlayer runs
    const patchPointerLock = async (page) => {
        await page.evaluate(() => {
            Element.prototype.requestPointerLock = function() {
                // Fake the lock: set game.isLocked = true immediately
                if (typeof game !== 'undefined') game.isLocked = true;
                return Promise.resolve();
            };
        });
    };
    await Promise.all([patchPointerLock(page1), patchPointerLock(page2)]);
    console.log('Patched requestPointerLock on both pages.');
    await sleep(300);

    // ── Difficulty ────────────────────────────────────────────────────────────
    await Promise.all([
        selectDifficulty(page1, 'P1'),
        selectDifficulty(page2, 'P2'),
    ]);

    // ── P1 creates room ───────────────────────────────────────────────────────
    const roomCode = await createRoomAndStart(page1);

    // Wait briefly so the WS server registers the room before P2 tries to join
    await sleep(1500);

    // ── P2 joins room ─────────────────────────────────────────────────────────
    await joinRoomAndStart(page2, roomCode);

    // ── Wait for both to be in-game ───────────────────────────────────────────
    await Promise.all([
        waitForGameWorld(page1, 'P1'),
        waitForGameWorld(page2, 'P2'),
    ]);

    // Click canvas on both to grab keyboard focus
    await Promise.all([clickCanvas(page1), clickCanvas(page2)]);
    await sleep(600);

    // Force isLocked = true so updatePlayer runs (pointer lock is fake)
    await Promise.all([
        page1.evaluate(() => { if (typeof game !== 'undefined') game.isLocked = true; }),
        page2.evaluate(() => { if (typeof game !== 'undefined') game.isLocked = true; }),
    ]);
    console.log('Forced isLocked=true on both players.');

    // Dismiss any overlays
    await Promise.all([
        dismissOverlays(page1, 'P1'),
        dismissOverlays(page2, 'P2'),
    ]);

    console.log('\n▶  Both players in game — starting 12-minute run\n');

    const stopSignal = { stop: false };
    const st1 = makeState(1);
    const st2 = makeState(2);
    const startTime = Date.now();

    // Stats every 2 minutes
    const statTimer = setInterval(async () => {
        await logStats([page1, page2], ['P1', 'P2'], Date.now() - startTime);
    }, STAT_INTERVAL_MS);

    // Stop after 12 minutes
    const stopTimer = setTimeout(() => {
        stopSignal.stop = true;
        console.log('\n⏱  12 minutes up — stopping');
    }, GAME_MS);

    await Promise.all([
        runPlayerLoop(page1, st1, stopSignal),
        runPlayerLoop(page2, st2, stopSignal),
    ]);

    clearInterval(statTimer);
    clearTimeout(stopTimer);

    await logStats([page1, page2], ['P1', 'P2'], Date.now() - startTime);
    console.log('\n✅  Session complete. Closing in 5s...');
    await sleep(5000);
    await browser.close();
    process.exit(0);
})();
