// ============================================================
// PUMPKIN COLLECTOR - Minecraft Style First Person Game
// ============================================================

// ---- SIMPLEX NOISE (compact implementation) ----
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

// ============================================================
// GAME CLASS
// ============================================================
class PumpkinCollectorGame {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = new THREE.Clock();
        this.noise = new SimplexNoise(42);

        // Weapons definition
        this.weaponDefs = [
            { id: 0, name: 'Sword', type: 'melee', damage: 15, range: 3, cooldown: 0.5, cost: 0, owned: true, color: 0xC0C0C0 },
            { id: 1, name: 'Pistol', type: 'gun', damage: 12, range: 40, cooldown: 0.4, cost: 0, owned: true, color: 0x555555, bulletSpeed: 80, spread: 0.02 },
            { id: 2, name: 'Shotgun', type: 'gun', damage: 8, range: 20, cooldown: 0.8, cost: 30, owned: false, color: 0x8B4513, bulletSpeed: 60, spread: 0.1, pellets: 5 },
            { id: 3, name: 'Rifle', type: 'gun', damage: 25, range: 80, cooldown: 0.7, cost: 60, owned: false, color: 0x2F4F2F, bulletSpeed: 120, spread: 0.01 },
            { id: 4, name: 'Sniper', type: 'gun', damage: 50, range: 150, cooldown: 1.5, cost: 100, owned: false, color: 0x333333, bulletSpeed: 200, spread: 0.003 }
        ];

        // ---- Audio ----
        const makeAudio = (src, loop = false, volume = 1.0) => {
            const a = new Audio(src);
            a.loop   = loop;
            a.volume = volume;
            return a;
        };
        this.sfx = {
            pistol:     makeAudio('pistal-shoot.mp3',    false, 0.7),
            rifle:      makeAudio('rifle-gunshot.mp3',   false, 0.8),
            walking:    makeAudio('walking-sound.mp3',   true,  0.4),
            leopard:    makeAudio('leopard-attack.mp3',  false, 0.9),
            bgScore:    makeAudio('background-score.mp3', true, 0.3),
            achieve:    makeAudio('achieve.mp3', false, 1.0)
        };
        this._walkingPlaying  = false;
        this._leopardCooldown = 0;
        this._forceAttackTimer = 10; // first attack no earlier than 10s after game start

        this.difficultyProfiles = {
            easy: {
                label: 'Easy',
                guardCount: 8,
                predatorCount: 5,
                initialPumpkinCount: 46,
                pumpkinRespawnDelayMs: 20000,
                guardDetectionMultiplier: 0.8,
                guardChaseMultiplier: 0.85,
                guardSpotPenalty: 1,
                guardHitPenalty: 3,
                guardCatchHpLoss: 10,
                predatorDamageMultiplier: 0.8
            },
            normal: {
                label: 'Normal',
                guardCount: 12,
                predatorCount: 8,
                initialPumpkinCount: 35,
                pumpkinRespawnDelayMs: 30000,
                guardDetectionMultiplier: 1,
                guardChaseMultiplier: 1,
                guardSpotPenalty: 2,
                guardHitPenalty: 5,
                guardCatchHpLoss: 15,
                predatorDamageMultiplier: 1
            },
            hard: {
                label: 'Hard',
                guardCount: 16,
                predatorCount: 12,
                initialPumpkinCount: 26,
                pumpkinRespawnDelayMs: 42000,
                guardDetectionMultiplier: 1.2,
                guardChaseMultiplier: 1.2,
                guardSpotPenalty: 3,
                guardHitPenalty: 7,
                guardCatchHpLoss: 22,
                predatorDamageMultiplier: 1.35
            }
        };
        this.difficulty = 'normal';
        this.activeDifficulty = this.difficultyProfiles.normal;

        // Player state
        this.player = {
            position: new THREE.Vector3(0, 15, 0),
            velocity: new THREE.Vector3(),
            onGround: false,
            hp: 100,
            maxHp: 100,
            pumpkins: 0,
            coins: 0,
            totalCoinsEarned: 0,
            currentWeapon: 1,
            weaponLevel: 1,
            weaponRange: 40,
            speed: 8,
            sprintSpeed: 14,
            jumpForce: 12,
            isSprinting: false,
            isAttacking: false,
            isShooting: false,
            attackCooldown: 0,
            height: 1.7,
            radius: 0.4,
            walkBob: 0
        };

        // Bullets
        this.bullets = [];
        this.muzzleFlash = null;

        // World config
        this.worldSize = 200;
        this.chunkSize = 16;
        this.terrainResolution = 1;

        // Input
        this.keys = {};
        this.mouseMovement = { x: 0, y: 0 };
        this.isLocked = false;
        this.yaw = 0;
        this.pitch = 0;

        // Game objects
        this.terrainMesh = null;
        this.heightMap = [];
        this.biomeMap = [];
        this.waterMeshes = [];
        this.pumpkins = [];
        this.guards = [];
        this.animals = [];
        this.predators = [];
        this.villagers = [];
        this.predatorAttackArrows = new Map(); // villager → ArrowHelper showing wolf attack direction
        this.particles = [];
        this.trees = [];
        this.huts = [];
        this.fields = [];
        this.herbs = [];

        // Multiplayer state
        this.mp = {
            enabled:       false,
            ws:            null,
            roomCode:      null,
            playerId:      null,
            remotePlayers: {},   // id → { mesh, walkTimer }
            syncTimer:     0
        };
        this.entities = [];

        // UI
        this.shopOpen = false;
        this.messageTimeout = null;
        this.alertTimeout = null;

        // Game state
        this.isRunning = false;
        this.gravity = -25;

        // Touch / mobile controls state
        this.touch = {
            mode: false,
            joystick: { id: null, active: false, dx: 0, dy: 0 },
            look:     { id: null, lastX: 0, lastY: 0 },
            sprint: false
        };

        this.init();
    }

    init() {
        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(this.renderer.domElement);

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB);
        this.scene.fog = new THREE.Fog(0x87CEEB, 60, 150);

        // Camera
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 300);

        // Lighting
        this.setupLighting();

        // Events
        this.setupEvents();

        // Start button
        document.getElementById('start-btn').addEventListener('click', () => this.startGame());
        this.setupDifficultySelector();
        this.setupTouchControls();

        // Global: whenever user returns to this tab on mobile, always restore fullscreen
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && this.touch.mode && this.isRunning) {
                this._restoreFullscreen();
            }
        });

        // Render loop (but don't update game logic until started)
        this.animate();
    }

    // ============================================================
    // TOUCH / MOBILE CONTROLS
    // ============================================================
    setupTouchControls() {
        // Only activate when true touch is present
        if (!('ontouchstart' in window) && navigator.maxTouchPoints < 1) return;

        this.touch.mode = true;
        // Show fullscreen restore button on mobile
        const fsBtn = document.getElementById('fs-btn');
        if (fsBtn) fsBtn.style.display = 'flex';

        // Lock to landscape where the Screen Orientation API is available
        if (screen.orientation && screen.orientation.lock) {
            screen.orientation.lock('landscape').catch(() => {});
        }

        const joystickBase = document.getElementById('joystick-base');
        const joystickKnob = document.getElementById('joystick-knob');
        const MAX_RADIUS = 42; // pixels
        let joyStartX = 0, joyStartY = 0;

        // Helper: register a press+release on an action button
        const bindBtn = (id, onDown, onUp = null) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('touchstart', (e) => {
                e.stopPropagation(); e.preventDefault();
                el.classList.add('pressed');
                if (onDown) onDown();
            }, { passive: false });
            el.addEventListener('touchend', (e) => {
                e.stopPropagation();
                el.classList.remove('pressed');
                if (onUp) onUp();
            }, { passive: true });
            el.addEventListener('touchcancel', () => {
                el.classList.remove('pressed');
                if (onUp) onUp();
            });
        };

        // ---- Joystick: touchstart on the base ----
        joystickBase.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const t = e.changedTouches[0];
            this.touch.joystick.id = t.identifier;
            this.touch.joystick.active = true;
            const r = joystickBase.getBoundingClientRect();
            joyStartX = r.left + r.width  / 2;
            joyStartY = r.top  + r.height / 2;
            joystickKnob.style.background = 'rgba(255,153,0,0.7)';
        }, { passive: false });

        // ---- Global touchmove: joystick + camera look ----
        document.addEventListener('touchmove', (e) => {
            if (!this.isRunning || !this.touch.mode) return;
            e.preventDefault(); // prevent scroll
            for (const t of e.changedTouches) {
                // Joystick
                if (t.identifier === this.touch.joystick.id) {
                    let dx = t.clientX - joyStartX;
                    let dy = t.clientY - joyStartY;
                    const dist = Math.hypot(dx, dy);
                    if (dist > MAX_RADIUS) { dx = dx / dist * MAX_RADIUS; dy = dy / dist * MAX_RADIUS; }
                    this.touch.joystick.dx = dx / MAX_RADIUS;
                    this.touch.joystick.dy = dy / MAX_RADIUS;
                    joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
                }
                // Camera look (any touch on right 55% of screen that isn't the joystick)
                if (t.identifier === this.touch.look.id) {
                    const ddx = t.clientX - this.touch.look.lastX;
                    const ddy = t.clientY - this.touch.look.lastY;
                    this.yaw   -= ddx * 0.005;
                    this.pitch -= ddy * 0.005;
                    this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
                    this.touch.look.lastX = t.clientX;
                    this.touch.look.lastY = t.clientY;
                }
            }
        }, { passive: false });

        // ---- Global touchstart: register look touches ----
        document.addEventListener('touchstart', (e) => {
            if (!this.isRunning || this.shopOpen || !this.touch.mode) return;
            for (const t of e.changedTouches) {
                if (this.touch.look.id === null &&
                    t.identifier !== this.touch.joystick.id &&
                    t.clientX > window.innerWidth * 0.45) {
                    this.touch.look.id  = t.identifier;
                    this.touch.look.lastX = t.clientX;
                    this.touch.look.lastY = t.clientY;
                }
            }
        }, { passive: true });

        // ---- Global touchend / touchcancel ----
        const onTouchEnd = (e) => {
            for (const t of e.changedTouches) {
                if (t.identifier === this.touch.joystick.id) {
                    this.touch.joystick.id = null;
                    this.touch.joystick.active = false;
                    this.touch.joystick.dx = 0;
                    this.touch.joystick.dy = 0;
                    joystickKnob.style.transform = 'translate(-50%, -50%)';
                    joystickKnob.style.background = 'rgba(255,255,255,0.45)';
                }
                if (t.identifier === this.touch.look.id) {
                    this.touch.look.id = null;
                }
            }
        };
        document.addEventListener('touchend',    onTouchEnd, { passive: true });
        document.addEventListener('touchcancel', onTouchEnd, { passive: true });

        // ---- Action buttons ----
        bindBtn('btn-attack',  () => {
            if (!this.isRunning) return;
            if (this._nearCollectible) this.interact(); else this.attack();
        });
        bindBtn('btn-jump',    () => {
            if (this.isRunning && this.player.onGround) {
                this.player.velocity.y = this.player.jumpForce;
                this.player.onGround = false;
            }
        });
        bindBtn('btn-sprint',  () => { this.touch.sprint = true; },
                               () => { this.touch.sprint = false; });
        bindBtn('btn-collect', () => { if (this.isRunning) this.interact(); });
        bindBtn('btn-shop',    () => { if (this.isRunning) this.toggleShop(); });
    }

    setupDifficultySelector() {
        const buttons = document.querySelectorAll('.difficulty-btn');
        if (!buttons.length) return;

        const helpByDifficulty = {
            easy: 'Easy: more pumpkins, fewer enemies, lighter penalties.',
            normal: 'Normal: balanced guards, predators and pumpkin spawn.',
            hard: 'Hard: fewer pumpkins, stronger enemies, harsher penalties.'
        };

        buttons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const selected = btn.dataset.difficulty;
                if (!this.difficultyProfiles[selected]) return;
                this.difficulty = selected;
                this.activeDifficulty = this.difficultyProfiles[selected];

                buttons.forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');

                const help = document.getElementById('difficulty-help');
                if (help) help.textContent = helpByDifficulty[selected];
            });
        });
    }

    setupLighting() {
        const ambient = new THREE.AmbientLight(0x6688cc, 0.5);
        this.scene.add(ambient);

        const sun = new THREE.DirectionalLight(0xffeedd, 1.0);
        sun.position.set(80, 100, 60);
        sun.castShadow = true;
        sun.shadow.mapSize.width = 2048;
        sun.shadow.mapSize.height = 2048;
        sun.shadow.camera.near = 0.5;
        sun.shadow.camera.far = 300;
        sun.shadow.camera.left = -100;
        sun.shadow.camera.right = 100;
        sun.shadow.camera.top = 100;
        sun.shadow.camera.bottom = -100;
        this.scene.add(sun);

        const hemi = new THREE.HemisphereLight(0x88bbff, 0x445522, 0.4);
        this.scene.add(hemi);
    }

    setupEvents() {
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });

        document.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            if (e.code === 'KeyE' && this.isLocked) this.interact();
            if (e.code === 'KeyC' && this.isLocked) this.watchAdForReward('coins');
            if (e.code === 'KeyF' && this.isLocked) this.attack();
            if (e.code === 'KeyB' && this.isLocked) this.toggleShop();
            // Weapon switching: 0=Sword, 1=Pistol, 2=Shotgun, 3=Rifle, 4=Sniper
            if (e.code === 'Digit0' && this.isLocked) this.switchWeapon(0);
            if (e.code === 'Digit1' && this.isLocked) this.switchWeapon(1);
            if (e.code === 'Digit2' && this.isLocked) this.switchWeapon(2);
            if (e.code === 'Digit3' && this.isLocked) this.switchWeapon(3);
            if (e.code === 'Digit4' && this.isLocked) this.switchWeapon(4);
        });
        document.addEventListener('keyup', (e) => this.keys[e.code] = false);

        // Mouse click to shoot
        document.addEventListener('mousedown', (e) => {
            if (e.button === 0 && this.isLocked) this.attack();
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isLocked) return;
            this.yaw -= e.movementX * 0.002;
            this.pitch -= e.movementY * 0.002;
            this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
        });

        document.addEventListener('pointerlockchange', () => {
            this.isLocked = document.pointerLockElement === this.renderer.domElement;
            if (!this.isLocked && this.isRunning && !this.shopOpen && !this.touch.mode) {
                document.getElementById('blocker').style.display = 'flex';
                document.getElementById('blocker').querySelector('h2').textContent = 'PAUSED';
                document.getElementById('start-btn').textContent = 'CLICK TO RESUME';
            }
        });
    }

    startGame() {
        // Resuming from pause — skip re-connecting
        if (this.isRunning) { this._proceedGameStart(); return; }

        const statusEl = document.getElementById('mp-status');
        if (statusEl) statusEl.textContent = 'Connecting…';

        const codeInput   = document.getElementById('room-code-input');
        const enteredCode = codeInput ? codeInput.value.trim().replace(/\D/g, '').slice(0, 5) : '';
        // Valid room code = 5-digit number
        const isJoin = enteredCode.length === 5;

        let settled = false;
        const proceed = () => { if (settled) return; settled = true; this._proceedGameStart(); };

        try {
            // Automatically use 'wss://' if the site is loaded over 'https://'
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            // Automatically use the VPS domain instead of hardcoding localhost
            const host = window.location.hostname || 'localhost';
            const wsUrl = `${protocol}//${host}:8765`;
            
            const ws = new WebSocket(wsUrl);
            const timeout = setTimeout(() => { try { ws.close(); } catch(e){} proceed(); }, 1500);
            ws.onopen = () => {
                clearTimeout(timeout);
                this.mp.ws = ws;
                this.mp.enabled = true;
                this._setupWsHandlers(proceed);
                ws.send(JSON.stringify(
                    isJoin
                        ? { type: 'join',   code: enteredCode }
                        : { type: 'create' }
                ));
            };
            ws.onerror = () => { clearTimeout(timeout); proceed(); };
        } catch(e) { proceed(); }
    }

    _proceedGameStart() {
        // Remove all loader ad elements from DOM when game starts
        ['loader-top-ad', 'ad-panel-left', 'ad-panel-right'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });

        document.getElementById('blocker').style.display = 'none';
        document.getElementById('hud').style.display = 'block';
        document.getElementById('health-bar-container').style.display = 'block';
        // Show FREE +5 immediately with 60s cooldown countdown
        document.getElementById('ad-coins-btn').style.display = 'block';
        this._resetAdCoinBtn();

        if (!this.touch.mode) {
            this.renderer.domElement.requestPointerLock();
        } else {
            document.getElementById('touch-controls').style.display = 'block';
            document.getElementById('look-hint').style.display = 'block';
            setTimeout(() => { document.getElementById('look-hint').style.display = 'none'; }, 4000);
            const el = document.documentElement;
            if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
            else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        }
        this.sfx.bgScore.play().catch(() => {});

        if (!this.isRunning) {
            this.isRunning = true;
            this.activeDifficulty = this.difficultyProfiles[this.difficulty] || this.difficultyProfiles.normal;
            this.showMessage(`Difficulty: ${this.activeDifficulty.label}`);
            this.generateWorld();
            // Non-host players spawn at a random location, then snap near Pn-1 once their position is known
            if (this.mp.enabled && this.mp.playerId && this.mp.playerId > 1) {
                const ang = Math.random() * Math.PI * 2;
                const dst = 20 + Math.random() * 30;
                const sx  = Math.cos(ang) * dst;
                const sz  = Math.sin(ang) * dst;
                this.player.position.set(sx, this.getHeight(sx, sz) + 3, sz);
                this.mp.spawnNearPrevPlayer = true;
            }
            this._showMpHud();
        }
    }

    _setupWsHandlers(onReady) {
        const ws = this.mp.ws;
        ws.onmessage = (event) => {
            let data;
            try { data = JSON.parse(event.data); } catch(e) { return; }
            switch (data.type) {
                case 'created':
                    this.mp.roomCode = data.code;
                    this.mp.playerId = 1;
                    onReady();
                    break;
                case 'joined':
                    this.mp.roomCode = data.code;
                    this.mp.playerId = data.playerId;
                    onReady();
                    break;
                case 'existingPlayers':
                    for (const pid of (data.playerIds || [])) this._createRemotePlayer(pid);
                    break;
                case 'playerJoined':
                    this._createRemotePlayer(data.playerId);
                    this.showMessage(`Player ${data.playerId} joined! 🎃`);
                    break;
                case 'playerState':
                    if (this.isRunning) this._updateRemotePlayer(data.playerId, data.data);
                    break;
                case 'playerLeft':
                    this._removeRemotePlayer(data.playerId);
                    if (this.isRunning) this.showMessage(`Player ${data.playerId} left.`);
                    break;
                case 'snatched': {
                    // Opponent snatched — fixed -12 penalty
                    const penalty = Math.min(12, this.player.pumpkins);
                    this.player.pumpkins = Math.max(0, this.player.pumpkins - 12);
                    this.updateHUD();
                    // Start 10s truce against the attacker
                    const rp = this.mp.remotePlayers[data.fromId];
                    if (rp) { rp.snatchHp = 60; rp.cooldown = 10; }
                    if (penalty > 0) {
                        this.showAlert(`P${data.fromId} stole from you! -12 🎃`);
                    }
                    break;
                }
                case 'error': {
                    const el = document.getElementById('mp-status');
                    if (el) el.textContent = '⚠️ ' + data.msg;
                    this.mp.enabled = false;
                    onReady();
                    break;
                }
            }
        };
        ws.onclose = () => {
            this.mp.enabled = false;
            if (this.isRunning) this.showMessage('Disconnected from multiplayer server.');
        };
    }

    _showMpHud() {
        const mpHud = document.getElementById('mp-hud');
        if (!mpHud || !this.mp.enabled || !this.mp.roomCode) return;
        document.getElementById('player-num').textContent        = this.mp.playerId;
        document.getElementById('room-code-display').textContent = this.mp.roomCode;
        mpHud.style.display = '';
    }

    _createRemotePlayer(id) {
        if (this.mp.remotePlayers[id]) return;
        // Distinct colour per player slot
        const palette = [null, 0xFF3300, 0x3388FF, 0x33CC55, 0xFF33CC,
                         0xFFCC00, 0x00CCFF, 0xFF6600, 0x9933FF, 0x00FF99, 0xFF0066];
        const color = palette[id] || 0xFFAA00;
        const mesh  = this.createHumanoid({ body: color, legs: 0x333344 });

        const rx = (Math.random() - 0.5) * 40;
        const rz = (Math.random() - 0.5) * 40;
        mesh.position.set(rx, this.getHeight(rx, rz), rz);
        this.scene.add(mesh);

        // Large player number label floating above head
        const canvas = document.createElement('canvas');
        canvas.width = 128; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0.80)';
        ctx.beginPath();
        ctx.roundRect(2, 2, 124, 60, 10);
        ctx.fill();
        ctx.strokeStyle = '#f90';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(2, 2, 124, 60, 10);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 38px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('P' + id, 64, 46);
        const labelTex = new THREE.CanvasTexture(canvas);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: labelTex,
            transparent: true, depthTest: false
        }));
        sprite.scale.set(3.2, 1.6, 1);
        sprite.position.set(0, 4.2, 0);
        mesh.add(sprite);

        this.mp.remotePlayers[id] = {
            mesh, walkTimer: 0,
            snatchHp: 60,   // PvP HP pool (independent of real HP)
            pumpkins: 0,    // updated each state sync
            cooldown: 0     // seconds remaining of PvP truce after a snatch
        };
    }

    _updateRemotePlayer(id, state) {
        if (!this.mp.remotePlayers[id]) this._createRemotePlayer(id);
        const rp = this.mp.remotePlayers[id];
        // Use locally-computed terrain height so remote players stand on the ground,
        // not at camera/eye level (state.y = terrainH + player.height).
        const groundY = this.getHeight(state.x, state.z);
        rp.mesh.position.set(state.x, groundY, state.z);
        rp.mesh.rotation.y = (state.yaw || 0) + Math.PI;
        if (state.pumpkins !== undefined) rp.pumpkins = state.pumpkins;

        // Snap new player to within 15m of Pn-1 on first received state
        if (this.mp.spawnNearPrevPlayer && id === this.mp.playerId - 1) {
            const ang = Math.random() * Math.PI * 2;
            const dst = 5 + Math.random() * 10;
            const sx = state.x + Math.cos(ang) * dst;
            const sz = state.z + Math.sin(ang) * dst;
            this.player.position.set(sx, this.getHeight(sx, sz) + 3, sz);
            this.mp.spawnNearPrevPlayer = false;
        }
    }

    _removeRemotePlayer(id) {
        const rp = this.mp.remotePlayers[id];
        if (!rp) return;
        this.scene.remove(rp.mesh);
        delete this.mp.remotePlayers[id];
    }

    _syncMpState(dt) {
        if (!this.mp.enabled || !this.mp.ws || this.mp.ws.readyState !== WebSocket.OPEN) return;
        this.mp.syncTimer += dt;
        if (this.mp.syncTimer < 0.05) return;   // max 20 fps
        this.mp.syncTimer = 0;
        this.mp.ws.send(JSON.stringify({
            type: 'state',
            data: {
                x:        this.player.position.x,
                y:        this.player.position.y,
                z:        this.player.position.z,
                yaw:      this.yaw,
                hp:       Math.round(this.player.hp),
                pumpkins: this.player.pumpkins
            }
        }));
    }

    // ============================================================
    // TERRAIN GENERATION (70% plains)
    // ============================================================
    getHeight(x, z) {
        // Biome-based height: use a separate noise to decide flat vs elevated
        const flatness = this.noise.noise2D(x * 0.005 + 100, z * 0.005 + 100);

        // ~70% of the world is plains (flatness < 0.4 on -1..1 scale = ~70%)
        if (flatness < 0.4) {
            // Plains: very gentle rolling, mostly flat
            let h = 0;
            h += this.noise.noise2D(x * 0.03, z * 0.03) * 1.5;   // Gentle rolls
            h += this.noise.noise2D(x * 0.08, z * 0.08) * 0.5;   // Tiny bumps
            return h;
        }

        // Remaining 30%: mountains, hills, water
        let h = 0;
        const elevation = (flatness - 0.4) / 0.6; // 0..1 normalized
        h += this.noise.noise2D(x * 0.008, z * 0.008) * 30 * elevation;
        h += this.noise.noise2D(x * 0.02, z * 0.02) * 12 * elevation;
        h += this.noise.noise2D(x * 0.06, z * 0.06) * 4;
        h += this.noise.noise2D(x * 0.15, z * 0.15) * 1.5;
        return h;
    }

    getBiome(x, z) {
        const flatness = this.noise.noise2D(x * 0.005 + 100, z * 0.005 + 100);
        const moisture = this.noise.noise2D(x * 0.01 + 500, z * 0.01 + 500);
        const h = this.getHeight(x, z);

        if (h < -5) return 'water';
        if (flatness >= 0.4 && h > 18) return 'mountain';

        // Plains biomes (70% of world)
        if (flatness < 0.4) {
            if (moisture > 0.2) return 'forest';
            if (moisture < -0.3) return 'field';
            return 'plains';
        }

        // Transition areas
        if (moisture > 0.3) return 'forest';
        if (moisture < -0.2) return 'field';
        return 'grassland';
    }

    generateWorld() {
        this.generateTerrain();
        this.generateWater();
        this.generateTrees();
        this.generateHuts();
        this.generateFields();
        this.spawnGuards();
        this.spawnPumpkins();
        this.spawnAnimals();
        this.spawnPredators();
        this.spawnVillagers();
        this.spawnHerbs();

        // Place player on terrain
        const py = this.getHeight(0, 0);
        this.player.position.set(0, py + 3, 0);
    }

    generateTerrain() {
        const size = this.worldSize;
        const res = this.terrainResolution;
        const segments = Math.floor(size * 2 / res);
        const geo = new THREE.PlaneGeometry(size * 2, size * 2, segments, segments);
        geo.rotateX(-Math.PI / 2);

        const positions = geo.attributes.position.array;
        const colors = new Float32Array(positions.length);

        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const z = positions[i + 2];
            const h = this.getHeight(x, z);
            positions[i + 1] = h;

            // Color by biome
            const biome = this.getBiome(x, z);
            let r, g, b;
            if (biome === 'water') {
                r = 0.2; g = 0.4; b = 0.7;
            } else if (biome === 'mountain') {
                const snow = h > 28 ? 1 : 0;
                r = snow ? 0.9 : 0.5;
                g = snow ? 0.9 : 0.45;
                b = snow ? 0.95 : 0.4;
            } else if (biome === 'forest') {
                r = 0.15; g = 0.45 + Math.random() * 0.1; b = 0.12;
            } else if (biome === 'field') {
                r = 0.6; g = 0.55; b = 0.2;
            } else if (biome === 'plains') {
                // Bright green flat plains
                r = 0.35 + Math.random() * 0.05;
                g = 0.65 + Math.random() * 0.1;
                b = 0.2;
            } else {
                r = 0.3; g = 0.6 + Math.random() * 0.1; b = 0.2;
            }
            colors[i] = r;
            colors[i + 1] = g;
            colors[i + 2] = b;
        }

        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.computeVertexNormals();

        const mat = new THREE.MeshLambertMaterial({
            vertexColors: true,
            flatShading: true
        });

        this.terrainMesh = new THREE.Mesh(geo, mat);
        this.terrainMesh.receiveShadow = true;
        this.scene.add(this.terrainMesh);
    }

    generateWater() {
        const waterGeo = new THREE.PlaneGeometry(this.worldSize * 2, this.worldSize * 2);
        waterGeo.rotateX(-Math.PI / 2);
        const waterMat = new THREE.MeshLambertMaterial({
            color: 0x3366aa,
            transparent: true,
            opacity: 0.7
        });
        const water = new THREE.Mesh(waterGeo, waterMat);
        water.position.y = -5;
        this.scene.add(water);
    }

    // ============================================================
    // BLOCK-STYLE OBJECT BUILDERS
    // ============================================================
    createBox(w, h, d, color) {
        const geo = new THREE.BoxGeometry(w, h, d);
        const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
    }

    createTree(x, z) {
        const h = this.getHeight(x, z);
        if (h < -3 || h > 25) return null;

        const group = new THREE.Group();
        group.position.set(x, h, z);

        // Trunk
        const trunk = this.createBox(0.8, 4 + Math.random() * 2, 0.8, 0x6B4226);
        trunk.position.y = 2.5;
        group.add(trunk);

        // Leaves (blocky, Minecraft style)
        const leafSize = 2 + Math.random();
        const treeTop = trunk.position.y + 2.5;
        for (let ly = 0; ly < 3; ly++) {
            const s = leafSize - ly * 0.4;
            const leaves = this.createBox(s * 2, 1.2, s * 2, 0x228B22);
            leaves.position.y = treeTop + ly * 1.1;
            group.add(leaves);
        }
        // Top
        const topLeaf = this.createBox(1.5, 1.5, 1.5, 0x2d9b2d);
        topLeaf.position.y = treeTop + 3.3;
        group.add(topLeaf);

        this.scene.add(group);
        return group;
    }

    createHut(x, z) {
        const h = this.getHeight(x, z);
        if (h < -2 || h > 18) return null;

        const group = new THREE.Group();
        group.position.set(x, h, z);

        // Walls
        const wall = this.createBox(5, 3, 5, 0x8B7355);
        wall.position.y = 1.5;
        group.add(wall);

        // Door (dark hole)
        const door = this.createBox(1.2, 2, 0.3, 0x332211);
        door.position.set(0, 1, 2.6);
        group.add(door);

        // Roof
        const roof = this.createBox(6, 0.5, 6, 0xcc4400);
        roof.position.y = 3.2;
        group.add(roof);
        const roof2 = this.createBox(4, 0.5, 4, 0xcc4400);
        roof2.position.y = 3.9;
        group.add(roof2);
        const roof3 = this.createBox(2, 0.5, 2, 0xcc4400);
        roof3.position.y = 4.5;
        group.add(roof3);

        // Windows
        const windowMat = new THREE.MeshLambertMaterial({ color: 0x88CCFF, emissive: 0x224455 });
        for (const side of [-1, 1]) {
            const win = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, 0.8), windowMat);
            win.position.set(side * 2.6, 1.8, 0);
            group.add(win);
        }

        this.scene.add(group);
        return { group, position: new THREE.Vector3(x, h, z) };
    }

    createPumpkin(x, z) {
        const h = this.getHeight(x, z);
        if (h < -3) return null;

        const group = new THREE.Group();
        group.position.set(x, h + 0.5, z);

        // Pumpkin body (blocky)
        const body = this.createBox(0.8, 0.7, 0.8, 0xFF8C00);
        group.add(body);

        // Stem
        const stem = this.createBox(0.2, 0.3, 0.2, 0x228B22);
        stem.position.y = 0.5;
        group.add(stem);

        // Face (carved)
        const eye1 = this.createBox(0.15, 0.15, 0.1, 0x000000);
        eye1.position.set(-0.15, 0.1, 0.41);
        group.add(eye1);
        const eye2 = this.createBox(0.15, 0.15, 0.1, 0x000000);
        eye2.position.set(0.15, 0.1, 0.41);
        group.add(eye2);
        const mouth = this.createBox(0.3, 0.1, 0.1, 0x000000);
        mouth.position.set(0, -0.1, 0.41);
        group.add(mouth);

        // Glow
        const glow = new THREE.PointLight(0xFF8C00, 0.5, 5);
        glow.position.y = 0.3;
        group.add(glow);

        group.userData = { type: 'pumpkin', collected: false };
        this.scene.add(group);
        return group;
    }

    // ============================================================
    // ENTITY BUILDERS
    // ============================================================
    createHumanoid(colors, headColor) {
        const group = new THREE.Group();

        // Body
        const body = this.createBox(0.8, 1.2, 0.5, colors.body);
        body.position.y = 1.2;
        group.add(body);

        // Head
        const head = this.createBox(0.6, 0.6, 0.6, headColor || 0xDEB887);
        head.position.y = 2.1;
        group.add(head);

        // Arms
        const armMeshes = [];
        for (const side of [-1, 1]) {
            const arm = this.createBox(0.3, 1, 0.3, colors.body);
            arm.position.set(side * 0.55, 1.2, 0);
            group.add(arm);
            armMeshes.push(arm);
        }

        // Legs
        const legMeshes = [];
        for (const side of [-1, 1]) {
            const leg = this.createBox(0.3, 0.8, 0.3, colors.legs);
            leg.position.set(side * 0.2, 0.4, 0);
            group.add(leg);
            legMeshes.push(leg);
        }

        // Store limb refs for walk-cycle animation (on the object itself, not in userData)
        group._limbs = { body, legs: legMeshes, arms: armMeshes, walkTimer: 0 };
        return group;
    }

    createGuard(x, z) {
        const h = this.getHeight(x, z);
        if (h < -2 || h > 20) return null;

        const group = this.createHumanoid({ body: 0x444488, legs: 0x333366 });
        group.position.set(x, h, z);

        // Helmet
        const helmet = this.createBox(0.7, 0.3, 0.7, 0x888888);
        helmet.position.y = 2.5;
        group.add(helmet);

        // Spear
        const spear = this.createBox(0.1, 2.5, 0.1, 0x8B4513);
        spear.position.set(0.7, 1.5, 0);
        group.add(spear);
        const spearTip = this.createBox(0.15, 0.4, 0.15, 0xAAAAAA);
        spearTip.position.set(0.7, 2.9, 0);
        group.add(spearTip);

        // Pumpkin crate near guard
        const crate = this.createBox(1.2, 0.8, 1.2, 0x8B7355);
        crate.position.set(1.5, 0.4, 1.5);
        group.add(crate);
        const cratePumpkin = this.createBox(0.5, 0.4, 0.5, 0xFF8C00);
        cratePumpkin.position.set(1.5, 1.0, 1.5);
        group.add(cratePumpkin);

        group.userData = {
            type: 'guard',
            alertLevel: 0,         // 0 = unaware, 1 = suspicious, 2 = alerted
            patrolCenter: new THREE.Vector3(x, h, z),
            patrolRadius: 5 + Math.random() * 5,
            patrolAngle: Math.random() * Math.PI * 2,
            patrolSpeed: 0.3 + Math.random() * 0.3,
            chaseSpeed: 6 * this.activeDifficulty.guardChaseMultiplier,
            detectionRange: 12 * this.activeDifficulty.guardDetectionMultiplier,
            pumpkinsToSteal: 8,
            chaseTarget: null,
            cooldown: 0,
            stateTimer: 0,
            hp: 60,
            maxHp: 60,
            beingAttacked: false,
            attacker: null
        };

        this.scene.add(group);
        return group;
    }

    createAnimal(x, z, type) {
        const h = this.getHeight(x, z);
        if (h < -2) return null;

        const group = new THREE.Group();
        group.position.set(x, h, z);

        let bodyColor, bodyW, bodyH, bodyD, legH;

        if (type === 'rabbit') {
            bodyColor = 0xBBAA88;
            bodyW = 0.3; bodyH = 0.3; bodyD = 0.5; legH = 0.2;
            const body = this.createBox(bodyW, bodyH, bodyD, bodyColor);
            body.position.y = 0.35;
            group.add(body);
            const head = this.createBox(0.25, 0.25, 0.25, bodyColor);
            head.position.set(0, 0.5, 0.3);
            group.add(head);
            // Ears
            for (const s of [-1, 1]) {
                const ear = this.createBox(0.06, 0.3, 0.06, 0xDDCCBB);
                ear.position.set(s * 0.08, 0.8, 0.3);
                group.add(ear);
            }
            // Tail
            const tail = this.createBox(0.15, 0.15, 0.15, 0xFFFFFF);
            tail.position.set(0, 0.4, -0.3);
            group.add(tail);
        } else if (type === 'goat') {
            bodyColor = 0xCCBBAA;
            const body = this.createBox(0.6, 0.5, 1.0, bodyColor);
            body.position.y = 0.7;
            group.add(body);
            const head = this.createBox(0.35, 0.35, 0.4, bodyColor);
            head.position.set(0, 0.95, 0.6);
            group.add(head);
            // Horns
            for (const s of [-1, 1]) {
                const horn = this.createBox(0.06, 0.3, 0.06, 0x888877);
                horn.position.set(s * 0.15, 1.3, 0.6);
                group.add(horn);
            }
            // Legs
            const goatLegs = [];
            for (const sx of [-1, 1]) {
                for (const sz of [-1, 1]) {
                    const leg = this.createBox(0.12, 0.5, 0.12, bodyColor);
                    leg.position.set(sx * 0.2, 0.25, sz * 0.35);
                    group.add(leg);
                    goatLegs.push(leg);
                }
            }
            group._limbs = { legs: goatLegs, walkTimer: 0 };
        } else { // cow
            bodyColor = 0x444444;
            const body = this.createBox(0.9, 0.7, 1.4, bodyColor);
            body.position.y = 0.9;
            group.add(body);

            // White patches
            const patch = this.createBox(0.4, 0.35, 0.5, 0xFFFFFF);
            patch.position.set(0.2, 1.0, 0.2);
            group.add(patch);

            const head = this.createBox(0.5, 0.45, 0.5, bodyColor);
            head.position.set(0, 1.2, 0.85);
            group.add(head);

            // Legs
            const cowLegs = [];
            for (const sx of [-1, 1]) {
                for (const sz of [-1, 1]) {
                    const leg = this.createBox(0.15, 0.6, 0.15, bodyColor);
                    leg.position.set(sx * 0.3, 0.3, sz * 0.5);
                    group.add(leg);
                    cowLegs.push(leg);
                }
            }
            group._limbs = { legs: cowLegs, walkTimer: 0 };
        }

        group.userData = {
            type: 'animal',
            animalType: type,
            wanderTarget: new THREE.Vector3(x + Math.random() * 10 - 5, 0, z + Math.random() * 10 - 5),
            speed: type === 'rabbit' ? 3 : 1.5,
            fleeSpeed: type === 'rabbit' ? 8 : 5,
            fleeing: false,
            fleeTimer: 0
        };

        this.scene.add(group);
        return group;
    }

    createPredator(x, z) {
        const h = this.getHeight(x, z);
        if (h < -2) return null;

        const group = new THREE.Group();
        group.position.set(x, h, z);

        // Wolf-like body
        const body = this.createBox(0.6, 0.5, 1.2, 0x555555);
        body.position.y = 0.7;
        group.add(body);

        const head = this.createBox(0.4, 0.35, 0.45, 0x666666);
        head.position.set(0, 0.85, 0.7);
        group.add(head);

        // Snout
        const snout = this.createBox(0.2, 0.15, 0.2, 0x444444);
        snout.position.set(0, 0.75, 0.95);
        group.add(snout);

        // Eyes (red)
        for (const s of [-1, 1]) {
            const eye = this.createBox(0.08, 0.08, 0.05, 0xFF0000);
            eye.position.set(s * 0.12, 0.92, 0.93);
            group.add(eye);
        }

        // Ears
        for (const s of [-1, 1]) {
            const ear = this.createBox(0.1, 0.2, 0.08, 0x666666);
            ear.position.set(s * 0.13, 1.1, 0.65);
            group.add(ear);
        }

        // Tail
        const tail = this.createBox(0.1, 0.1, 0.5, 0x555555);
        tail.position.set(0, 0.8, -0.6);
        tail.rotation.x = -0.4;
        group.add(tail);

        // Legs
        const wolfLegs = [];
        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
                const leg = this.createBox(0.12, 0.5, 0.12, 0x555555);
                leg.position.set(sx * 0.2, 0.25, sz * 0.4);
                group.add(leg);
                wolfLegs.push(leg);
            }
        }
        group._limbs = { legs: wolfLegs, tail, walkTimer: 0 };

        group.userData = {
            type: 'predator',
            hp: 30,
            maxHp: 30,
            damage: Math.round(10 * this.activeDifficulty.predatorDamageMultiplier),
            attackCooldown: 0,
            speed: 5,
            aggroRange: 35,
            attackRange: 2,
            target: null,
            state: 'roaming', // roaming, hunting, attacking
            wanderTarget: new THREE.Vector3(x + Math.random() * 20 - 10, 0, z + Math.random() * 20 - 10),
            roamTimer: 0,
            huntingVillager: null,
            huntingGuard: null
        };

        this.scene.add(group);
        return group;
    }

    createVillager(x, z) {
        const h = this.getHeight(x, z);
        if (h < -2 || h > 18) return null;

        const colors = [0x886644, 0x668844, 0x884466, 0x446688];
        const c = colors[Math.floor(Math.random() * colors.length)];
        const group = this.createHumanoid({ body: c, legs: 0x555544 });
        group.position.set(x, h, z);

        // Hat
        const hat = this.createBox(0.8, 0.15, 0.8, 0x886633);
        hat.position.y = 2.4;
        group.add(hat);

        group.userData = {
            type: 'villager',
            hp: 30,
            maxHp: 30,
            wanderTarget: new THREE.Vector3(x + Math.random() * 10 - 5, 0, z + Math.random() * 10 - 5),
            speed: 1.5,
            fleeSpeed: 4,
            beingAttacked: false,
            attacker: null,
            saved: false,
            stateTimer: 0
        };

        this.scene.add(group);
        return group;
    }

    createField(x, z) {
        const h = this.getHeight(x, z);
        if (h < -2 || h > 15) return null;

        const group = new THREE.Group();
        group.position.set(x, h + 0.01, z);

        // Soil base
        const soil = this.createBox(8, 0.2, 8, 0x5C4033);
        soil.position.y = 0.1;
        group.add(soil);

        // Crop rows
        for (let row = -3; row <= 3; row += 1.5) {
            for (let col = -3; col <= 3; col += 1) {
                const crop = this.createBox(0.2, 0.4 + Math.random() * 0.3, 0.2, 0x44AA22);
                crop.position.set(col, 0.5, row);
                group.add(crop);
            }
        }

        // Fence posts
        for (let i = -4; i <= 4; i += 2) {
            for (const side of [-4, 4]) {
                const post = this.createBox(0.15, 1, 0.15, 0x8B4513);
                post.position.set(i, 0.5, side);
                group.add(post);
                const post2 = this.createBox(0.15, 1, 0.15, 0x8B4513);
                post2.position.set(side, 0.5, i);
                group.add(post2);
            }
        }
        // Fence rails
        for (const side of [-4, 4]) {
            const rail = this.createBox(8, 0.1, 0.1, 0x8B4513);
            rail.position.set(0, 0.8, side);
            group.add(rail);
            const rail2 = this.createBox(0.1, 0.1, 8, 0x8B4513);
            rail2.position.set(side, 0.8, 0);
            group.add(rail2);
        }

        this.scene.add(group);
        return group;
    }

    // ============================================================
    // WORLD POPULATION
    // ============================================================
    generateTrees() {
        for (let i = 0; i < 400; i++) {
            const x = (Math.random() - 0.5) * this.worldSize * 1.8;
            const z = (Math.random() - 0.5) * this.worldSize * 1.8;
            const biome = this.getBiome(x, z);
            if (biome === 'forest' || (biome === 'grassland' && Math.random() < 0.3) || (biome === 'plains' && Math.random() < 0.08)) {
                const tree = this.createTree(x, z);
                if (tree) this.trees.push(tree);
            }
        }
    }

    generateHuts() {
        const hutPositions = [];
        for (let i = 0; i < 15; i++) {
            let x, z, valid;
            let attempts = 0;
            do {
                x = (Math.random() - 0.5) * this.worldSize * 1.2;
                z = (Math.random() - 0.5) * this.worldSize * 1.2;
                valid = true;
                const biome = this.getBiome(x, z);
                if (biome === 'water' || biome === 'mountain') valid = false;
                for (const p of hutPositions) {
                    if (Math.hypot(p.x - x, p.z - z) < 20) valid = false;
                }
                attempts++;
            } while (!valid && attempts < 50);
            if (valid) {
                const hut = this.createHut(x, z);
                if (hut) {
                    this.huts.push(hut);
                    hutPositions.push({ x, z });
                }
            }
        }
    }

    generateFields() {
        for (let i = 0; i < 10; i++) {
            const x = (Math.random() - 0.5) * this.worldSize * 1.2;
            const z = (Math.random() - 0.5) * this.worldSize * 1.2;
            const biome = this.getBiome(x, z);
            if (biome === 'field' || biome === 'grassland') {
                const field = this.createField(x, z);
                if (field) this.fields.push(field);
            }
        }
    }

    isPumpkinSpawnValid(x, z, minGuardDistance, minPumpkinDistance) {
        const spawnPos = new THREE.Vector3(x, 0, z);

        // Keep pumpkins away from guards so stealing and searching are more separated.
        for (const guard of this.guards) {
            const guardPos = new THREE.Vector3(guard.position.x, 0, guard.position.z);
            if (spawnPos.distanceTo(guardPos) < minGuardDistance) {
                return false;
            }
        }

        // Avoid tight pumpkin clusters.
        for (const pumpkin of this.pumpkins) {
            if (pumpkin.userData.collected) continue;
            const pumpkinPos = new THREE.Vector3(pumpkin.position.x, 0, pumpkin.position.z);
            if (spawnPos.distanceTo(pumpkinPos) < minPumpkinDistance) {
                return false;
            }
        }

        return true;
    }

    spawnSinglePumpkin(minGuardDistance = 20, minPumpkinDistance = 14, maxAttempts = 80) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const x = (Math.random() - 0.5) * this.worldSize * 1.6;
            const z = (Math.random() - 0.5) * this.worldSize * 1.6;
            if (!this.isPumpkinSpawnValid(x, z, minGuardDistance, minPumpkinDistance)) continue;
            const pumpkin = this.createPumpkin(x, z);
            if (pumpkin) {
                this.pumpkins.push(pumpkin);
                return true;
            }
        }
        return false;
    }

    spawnPumpkins() {
        for (let i = 0; i < this.activeDifficulty.initialPumpkinCount; i++) {
            this.spawnSinglePumpkin(20, 14, 100);
        }
    }

    spawnGuards() {
        for (let i = 0; i < this.activeDifficulty.guardCount; i++) {
            const x = (Math.random() - 0.5) * this.worldSize * 1.2;
            const z = (Math.random() - 0.5) * this.worldSize * 1.2;
            const biome = this.getBiome(x, z);
            if (biome !== 'water') {
                const guard = this.createGuard(x, z);
                if (guard) this.guards.push(guard);
            }
        }
    }

    spawnAnimals() {
        const types = ['rabbit', 'rabbit', 'rabbit', 'goat', 'goat', 'cow', 'cow'];
        for (let i = 0; i < 35; i++) {
            const x = (Math.random() - 0.5) * this.worldSize * 1.4;
            const z = (Math.random() - 0.5) * this.worldSize * 1.4;
            const type = types[Math.floor(Math.random() * types.length)];
            const animal = this.createAnimal(x, z, type);
            if (animal) this.animals.push(animal);
        }
    }

    spawnPredators() {
        for (let i = 0; i < this.activeDifficulty.predatorCount; i++) {
            const x = (Math.random() - 0.5) * this.worldSize * 1.4;
            const z = (Math.random() - 0.5) * this.worldSize * 1.4;
            const pred = this.createPredator(x, z);
            if (pred) this.predators.push(pred);
        }
    }

    spawnVillagers() {
        for (let i = 0; i < 15; i++) {
            const x = (Math.random() - 0.5) * this.worldSize * 1.2;
            const z = (Math.random() - 0.5) * this.worldSize * 1.2;
            const biome = this.getBiome(x, z);
            if (biome !== 'water' && biome !== 'mountain') {
                const v = this.createVillager(x, z);
                if (v) this.villagers.push(v);
            }
        }
    }

    createHerb(x, z) {
        const h = this.getHeight(x, z);
        if (h < -1 || h > 16) return null;
        // Stem
        const group = new THREE.Group();
        const stem = this.createBox(0.12, 0.55, 0.12, 0x3a7d1e);
        stem.position.y = 0.28;
        group.add(stem);
        // Leaves (cross shape, bright green)
        const leaf1 = this.createBox(0.55, 0.12, 0.18, 0x4caf50);
        leaf1.position.y = 0.55;
        group.add(leaf1);
        const leaf2 = this.createBox(0.18, 0.12, 0.55, 0x4caf50);
        leaf2.position.y = 0.55;
        group.add(leaf2);
        // Flower top (magenta dot)
        const flower = this.createBox(0.2, 0.2, 0.2, 0xe040fb);
        flower.position.y = 0.75;
        group.add(flower);
        group.position.set(x, h, z);
        group.userData = { type: 'herb', collected: false };
        this.scene.add(group);
        return group;
    }

    spawnHerbs() {
        for (let i = 0; i < 20; i++) {
            this.spawnSingleHerb();
        }
    }

    spawnSingleHerb() {
        for (let attempt = 0; attempt < 20; attempt++) {
            const x = (Math.random() - 0.5) * this.worldSize * 1.4;
            const z = (Math.random() - 0.5) * this.worldSize * 1.4;
            const biome = this.getBiome(x, z);
            if (biome === 'water' || biome === 'mountain') continue;
            const herb = this.createHerb(x, z);
            if (herb) { this.herbs.push(herb); return; }
        }
    }

    updateHerbs(dt) {
        // proximity hint handled in updateProximityHints
    }

    // ============================================================
    // PLAYER CONTROLS
    // ============================================================
    updatePlayer(dt) {
        if ((!this.isLocked && !this.touch.mode) || this.shopOpen) return;

        // Camera rotation
        const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
        this.camera.quaternion.setFromEuler(euler);

        // Movement
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw, 0))
        );
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw, 0))
        );

        this.player.isSprinting = this.keys['ShiftLeft'] || this.keys['ShiftRight'] || this.touch.sprint;
        const speed = this.player.isSprinting ? this.player.sprintSpeed : this.player.speed;

        const moveDir = new THREE.Vector3();
        if (this.keys['KeyW']) moveDir.add(forward);
        if (this.keys['KeyS']) moveDir.sub(forward);
        if (this.keys['KeyD']) moveDir.add(right);
        if (this.keys['KeyA']) moveDir.sub(right);
        // Joystick input (dy positive = stick pushed down = move backward)
        if (this.touch.joystick.active) {
            moveDir.addScaledVector(forward, -this.touch.joystick.dy);
            moveDir.addScaledVector(right,   this.touch.joystick.dx);
        }

        if (moveDir.length() > 0) {
            moveDir.normalize();
            this.player.velocity.x = moveDir.x * speed;
            this.player.velocity.z = moveDir.z * speed;
        } else {
            this.player.velocity.x *= 0.85;
            this.player.velocity.z *= 0.85;
        }

        // Jump
        if (this.keys['Space'] && this.player.onGround) {
            this.player.velocity.y = this.player.jumpForce;
            this.player.onGround = false;
        }

        // Gravity
        this.player.velocity.y += this.gravity * dt;

        // Move
        this.player.position.x += this.player.velocity.x * dt;
        this.player.position.z += this.player.velocity.z * dt;
        this.player.position.y += this.player.velocity.y * dt;

        // Terrain collision
        const terrainH = this.getHeight(this.player.position.x, this.player.position.z);

        // Water - don't sink below water level
        const waterLevel = -5;
        const minY = Math.max(terrainH, waterLevel) + this.player.height;

        if (this.player.position.y <= minY) {
            // Snap to ground (handles both sinking below and walking onto higher terrain)
            this.player.position.y = minY;
            this.player.velocity.y = 0;
            this.player.onGround = true;
        } else {
            this.player.onGround = false;
        }

        // World bounds
        const bound = this.worldSize - 5;
        this.player.position.x = Math.max(-bound, Math.min(bound, this.player.position.x));
        this.player.position.z = Math.max(-bound, Math.min(bound, this.player.position.z));

        // ── Cylinder collision push-out ──────────────────────────────
        // Each entry: { x, z, r }  — treat as infinite-height cylinder
        const px = this.player.position.x;
        const pz = this.player.position.z;
        const playerR = 0.4;

        const pushOut = (cx, cz, objR) => {
            const dx = px - cx;
            const dz = pz - cz;
            const distSq = dx * dx + dz * dz;
            const minDist = playerR + objR;
            if (distSq < minDist * minDist && distSq > 0.0001) {
                const dist = Math.sqrt(distSq);
                const overlap = minDist - dist;
                this.player.position.x += (dx / dist) * overlap;
                this.player.position.z += (dz / dist) * overlap;
                // Kill velocity component toward object
                this.player.velocity.x *= 0.5;
                this.player.velocity.z *= 0.5;
            }
        };

        // Trees (trunk radius 0.6)
        for (const tree of this.trees) {
            pushOut(tree.position.x, tree.position.z, 0.6);
        }
        // Huts (5×5 walls → approx radius 3.0)
        for (const hut of this.huts) {
            const hp = hut.position || (hut.group && hut.group.position);
            if (hp) pushOut(hp.x, hp.z, 3.0);
        }
        // Guards
        for (const g of this.guards) {
            pushOut(g.position.x, g.position.z, 0.6);
        }
        // Villagers
        for (const v of this.villagers) {
            pushOut(v.position.x, v.position.z, 0.5);
        }
        // Predators
        for (const p of this.predators) {
            pushOut(p.position.x, p.position.z, 0.7);
        }
        // ─────────────────────────────────────────────────────────────

        // Update camera + head bob while walking
        this.camera.position.copy(this.player.position);
        const horizSpeed = Math.sqrt(this.player.velocity.x ** 2 + this.player.velocity.z ** 2);
        if (horizSpeed > 0.5 && this.player.onGround) {
            this.player.walkBob += dt * (this.player.isSprinting ? 12 : 8);
            // Walking sound
            if (!this._walkingPlaying) {
                this._walkingPlaying = true;
                this.sfx.walking.play().catch(() => {});
            }
        } else {
            this.player.walkBob *= 0.8;
            if (this._walkingPlaying) {
                this._walkingPlaying = false;
                this.sfx.walking.pause();
            }
        }
        const bobAmt = this.player.isSprinting ? 0.08 : 0.05;
        this.camera.position.y += Math.sin(this.player.walkBob) * bobAmt;
        this.camera.position.x += Math.sin(this.player.walkBob * 0.5) * bobAmt * 0.3;

        // Attack cooldown
        if (this.player.attackCooldown > 0) this.player.attackCooldown -= dt;

        // Regeneration (slow)
        if (this.player.hp < this.player.maxHp) {
            this.player.hp = Math.min(this.player.maxHp, this.player.hp + 0.5 * dt);
        }
    }

    // ============================================================
    // INTERACTION & COMBAT
    // ============================================================
    interact() {
        const pos = this.player.position;
        const range = 4;

        // Check medicinal herbs
        for (let i = this.herbs.length - 1; i >= 0; i--) {
            const h = this.herbs[i];
            if (h.userData.collected) continue;
            if (pos.distanceTo(h.position) < range) {
                h.userData.collected = true;
                this.scene.remove(h);
                this.herbs.splice(i, 1);
                this.player.hp = Math.min(this.player.maxHp, this.player.hp + 5);
                this.showMessage('+5 HP 🌿 Medicinal Herb!');
                this.updateHUD();
                // Respawn herb after 60s
                setTimeout(() => { this.spawnSingleHerb(); }, 60000);
                return;
            }
        }

        // Check pumpkins
        for (let i = this.pumpkins.length - 1; i >= 0; i--) {
            const p = this.pumpkins[i];
            if (p.userData.collected) continue;
            const dist = pos.distanceTo(p.position);
            if (dist < range) {
                const collectPos = p.position.clone();
                p.userData.collected = true;
                this.scene.remove(p);
                this.pumpkins.splice(i, 1);
                this.player.pumpkins++;
                this.spawnCollectionEffect(collectPos);
                this.showMessage('+1 Pumpkin! 🎃');
                const t = this.player.pumpkins;
                if (t === 50 || t === 100 || (t > 100 && t % 100 === 0)) {
                    this.sfx.achieve.currentTime = 0;
                    this.sfx.achieve.play().catch(() => {});
                }
                this.updateHUD();
                if (typeof gtag === 'function') {
                    gtag('event', 'pumpkin_collected', {
                        total_pumpkins: this.player.pumpkins,
                        difficulty:     this.difficulty,
                        multiplayer:    this.mp.enabled
                    });
                }

                // Caught red-handed? Alert any guard within detection range that can see the player
                let caughtByGuard = false;
                for (const guard of this.guards) {
                    const ud = guard.userData;
                    if (ud.alertLevel > 0) continue;
                    const distToGuard = pos.distanceTo(guard.position);
                    if (distToGuard < ud.detectionRange) {
                        const guardFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(guard.quaternion);
                        const toPlayer = new THREE.Vector3().subVectors(pos, guard.position).normalize();
                        const dot = guardFwd.dot(toPlayer);
                        if (dot > 0.3) {
                            ud.alertLevel = 2;
                            ud.stateTimer = 8;
                            caughtByGuard = true;
                        }
                    }
                }
                if (caughtByGuard) {
                    this.showAlert('Caught red-handed! Guard is coming! 🚨');
                }

                // Respawn a new pumpkin elsewhere
                setTimeout(() => {
                    this.spawnSinglePumpkin(20, 14, 120);
                }, this.activeDifficulty.pumpkinRespawnDelayMs);
                return;
            }
        }

        // Check guard pumpkin steal
        for (const guard of this.guards) {
            const dist = pos.distanceTo(guard.position);
            const ud = guard.userData;
            if (dist < range && ud.alertLevel === 0) {
                // Steal attempt - check if behind guard
                const guardFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(guard.quaternion);
                const toPlayer = new THREE.Vector3().subVectors(pos, guard.position).normalize();
                const dot = guardFwd.dot(toPlayer);

                if (dot < 0.3) {
                    // Player is behind or to the side - successful steal
                    this.player.pumpkins += ud.pumpkinsToSteal;
                    this.showMessage(`+${ud.pumpkinsToSteal} Stolen Pumpkins! 🎃`);
                    ud.pumpkinsToSteal = 0;
                    setTimeout(() => { ud.pumpkinsToSteal = 8; }, 30000);
                } else {
                    // Caught red-handed stealing — fixed 3 pumpkin penalty
                    ud.alertLevel = 2;
                    ud.stateTimer = 8;
                    this.showAlert('CAUGHT stealing! -3 pumpkins! RUN!');
                    this.player.pumpkins = Math.max(0, this.player.pumpkins - 3);
                }
                this.updateHUD();
                return;
            }
        }
    }

    // ============================================================
    // WEAPON SWITCHING
    // ============================================================
    switchWeapon(id) {
        const wep = this.weaponDefs[id];
        if (!wep) return;
        if (!wep.owned) {
            this.showMessage(`${wep.name} not owned! Buy from shop (B)`);
            return;
        }
        this.player.currentWeapon = id;
        this.player.weaponRange = wep.range;
        this.showMessage(`Switched to ${wep.name}`);
        // Rebuild weapon visual
        this.rebuildWeaponVisual();
        this.updateHUD();
    }

    attack() {
        if (this.player.attackCooldown > 0) return;

        const wep = this.weaponDefs[this.player.currentWeapon];
        this.player.attackCooldown = wep.cooldown;
        this.player.isAttacking = true;
        setTimeout(() => this.player.isAttacking = false, 150);

        const pos = this.player.position;
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        const damage = wep.damage + (wep.type === 'melee' ? this.player.weaponLevel * 3 : 0);

        if (wep.type === 'gun') {
            // Shooting
            this.player.isShooting = true;
            setTimeout(() => this.player.isShooting = false, 100);
            this.showMuzzleFlash();

            // Gun sound: pistol uses pistal-shoot.mp3, all others use rifle-gunshot.mp3
            const snd = (wep.id === 1) ? this.sfx.pistol : this.sfx.rifle;
            snd.currentTime = 0;
            snd.play().catch(() => {});

            const pellets = wep.pellets || 1;
            for (let p = 0; p < pellets; p++) {
                const dir = fwd.clone();
                dir.x += (Math.random() - 0.5) * wep.spread;
                dir.y += (Math.random() - 0.5) * wep.spread;
                dir.z += (Math.random() - 0.5) * wep.spread;
                dir.normalize();
                this.fireBullet(pos.clone(), dir, wep.bulletSpeed, damage, wep.range);
            }
        } else {
            // Melee sword attack
            this.meleeHitCheck(pos, fwd, wep.range + this.player.weaponLevel * 0.5, damage);
        }
    }

    fireBullet(origin, direction, speed, damage, maxRange) {
        const geo = new THREE.SphereGeometry(0.06, 4, 4);
        const mat = new THREE.MeshBasicMaterial({ color: 0xFFFF00 });
        const bullet = new THREE.Mesh(geo, mat);
        bullet.position.copy(origin);
        this.scene.add(bullet);

        this.bullets.push({
            mesh: bullet,
            direction: direction.clone(),
            speed,
            damage,
            distanceTraveled: 0,
            maxRange
        });
    }

    updateBullets(dt) {
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            const move = b.direction.clone().multiplyScalar(b.speed * dt);
            b.mesh.position.add(move);
            b.distanceTraveled += b.speed * dt;

            // Check terrain collision
            const terrainH = this.getHeight(b.mesh.position.x, b.mesh.position.z);
            if (b.mesh.position.y < terrainH + 0.1) {
                this.removeBullet(i);
                continue;
            }

            // Check max range
            if (b.distanceTraveled > b.maxRange) {
                this.removeBullet(i);
                continue;
            }

            // Hit predators
            let hit = false;
            for (let j = this.predators.length - 1; j >= 0; j--) {
                const pred = this.predators[j];
                if (b.mesh.position.distanceTo(pred.position) < 1.5) {
                    pred.userData.hp -= b.damage;
                    this.showMessage(`Hit! Predator HP: ${Math.max(0, Math.round(pred.userData.hp))}`);
                    if (pred.userData.hp <= 0) {
                        // Guard save reward
                        if (pred.userData.huntingGuard && this.guards.includes(pred.userData.huntingGuard)) {
                            pred.userData.huntingGuard.userData.beingAttacked = false;
                            pred.userData.huntingGuard.userData.attacker = null;
                            this.player.pumpkins += 8;
                            this.showMessage('Guard saved! +8 Pumpkins! 🛡️🎃');
                            this.updateHUD();
                        }
                        this.scene.remove(pred);
                        this.predators.splice(j, 1);
                        this.showMessage('Predator defeated! 🐺');
                        setTimeout(() => {
                            const nx = (Math.random() - 0.5) * this.worldSize * 1.4;
                            const nz = (Math.random() - 0.5) * this.worldSize * 1.4;
                            const np = this.createPredator(nx, nz);
                            if (np) this.predators.push(np);
                        }, 30000);
                    }
                    hit = true;
                    break;
                }
            }

            // Hit guards (penalty!)
            if (!hit) {
                for (const guard of this.guards) {
                    if (b.mesh.position.distanceTo(guard.position) < 1.5) {
                        const penalty = this.activeDifficulty.guardHitPenalty;
                        this.player.pumpkins = Math.max(0, this.player.pumpkins - penalty);
                        guard.userData.alertLevel = 2;
                        guard.userData.stateTimer = 12;
                        this.showAlert(`You shot a guard! -${penalty} pumpkins! RUN!`);
                        this.updateHUD();
                        hit = true;
                        break;
                    }
                }
            }

            // Hit remote players — PvP pumpkin snatch (no real HP damage)
            if (!hit && this.mp.enabled) {
                for (const [rpId, rp] of Object.entries(this.mp.remotePlayers)) {
                    const numId = Number(rpId);
                    if (rp.cooldown > 0) continue;  // truce active
                    // XZ-only distance — avoids Y-gap between bullet height and player feet
                    const dxB = b.mesh.position.x - rp.mesh.position.x;
                    const dzB = b.mesh.position.z - rp.mesh.position.z;
                    if (Math.sqrt(dxB * dxB + dzB * dzB) < 1.5) {
                        rp.snatchHp -= b.damage;
                        if (rp.snatchHp <= 0) {
                            rp.snatchHp = 60;
                            rp.cooldown = 10;
                            this.player.pumpkins += 12;
                            this.showMessage(`Snatched +12 🎃 from P${numId}!`);
                            this.updateHUD();
                            if (this.mp.ws && this.mp.ws.readyState === WebSocket.OPEN) {
                                this.mp.ws.send(JSON.stringify({ type: 'snatch', targetId: numId, amount: 12 }));
                            }
                        } else {
                            this.showMessage(`P${numId} snatch: ${Math.max(0, Math.round(rp.snatchHp))}/60 HP`);
                        }
                        hit = true;
                        break;
                    }
                }
            }

            if (hit) {
                this.removeBullet(i);
            }
        }
    }

    removeBullet(index) {
        const b = this.bullets[index];
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
        this.bullets.splice(index, 1);
    }

    showMuzzleFlash() {
        if (this.muzzleFlash) {
            this.camera.remove(this.muzzleFlash);
        }
        const flashGeo = new THREE.SphereGeometry(0.08, 6, 6);
        const flashMat = new THREE.MeshBasicMaterial({ color: 0xFFFF44 });
        this.muzzleFlash = new THREE.Mesh(flashGeo, flashMat);
        this.muzzleFlash.position.set(0.25, -0.15, -0.8);
        this.camera.add(this.muzzleFlash);
        setTimeout(() => {
            if (this.muzzleFlash) {
                this.camera.remove(this.muzzleFlash);
                flashGeo.dispose();
                flashMat.dispose();
                this.muzzleFlash = null;
            }
        }, 60);
    }

    meleeHitCheck(pos, fwd, range, damage) {
        // Attack predators
        for (let i = this.predators.length - 1; i >= 0; i--) {
            const pred = this.predators[i];
            const dist = pos.distanceTo(pred.position);
            if (dist < range) {
                const toPred = new THREE.Vector3().subVectors(pred.position, pos).normalize();
                if (fwd.dot(toPred) > 0.5) {
                    pred.userData.hp -= damage;
                    this.showMessage(`Hit! Predator HP: ${Math.max(0, Math.round(pred.userData.hp))}`);
                    if (pred.userData.hp <= 0) {
                        // Guard save reward
                        if (pred.userData.huntingGuard && this.guards.includes(pred.userData.huntingGuard)) {
                            pred.userData.huntingGuard.userData.beingAttacked = false;
                            pred.userData.huntingGuard.userData.attacker = null;
                            this.player.pumpkins += 8;
                            this.showMessage('Guard saved! +8 Pumpkins! 🛡️🎃');
                            this.updateHUD();
                        }
                        this.scene.remove(pred);
                        this.predators.splice(i, 1);
                        this.showMessage('Predator defeated! 🐺');
                        setTimeout(() => {
                            const nx = (Math.random() - 0.5) * this.worldSize * 1.4;
                            const nz = (Math.random() - 0.5) * this.worldSize * 1.4;
                            const np = this.createPredator(nx, nz);
                            if (np) this.predators.push(np);
                        }, 30000);
                    }
                    return;
                }
            }
        }

        // Check if hit guard (5 pumpkin penalty!)
        for (const guard of this.guards) {
            const dist = pos.distanceTo(guard.position);
            if (dist < range) {
                const toGuard = new THREE.Vector3().subVectors(guard.position, pos).normalize();
                if (fwd.dot(toGuard) > 0.5) {
                    const penalty = this.activeDifficulty.guardHitPenalty;
                    this.player.pumpkins = Math.max(0, this.player.pumpkins - penalty);
                    guard.userData.alertLevel = 2;
                    guard.userData.stateTimer = 12;
                    this.showAlert(`You hit a guard! -${penalty} pumpkins! RUN!`);
                    this.updateHUD();
                    return;
                }
            }
        }

        // Melee on remote players — PvP snatch
        if (this.mp.enabled) {
            for (const [rpId, rp] of Object.entries(this.mp.remotePlayers)) {
                const numId = Number(rpId);
                if (rp.cooldown > 0) continue;
                // XZ-only distance and direction — camera height vs feet would break 3D checks
                const dxM = rp.mesh.position.x - pos.x;
                const dzM = rp.mesh.position.z - pos.z;
                const dist = Math.sqrt(dxM * dxM + dzM * dzM);
                if (dist < range) {
                    const toRp = new THREE.Vector3(dxM, 0, dzM).normalize();
                    const fwdXZ = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
                    if (fwdXZ.dot(toRp) > 0.5) {
                        rp.snatchHp -= damage;
                        if (rp.snatchHp <= 0) {
                            rp.snatchHp = 60;
                            rp.cooldown = 10;
                            this.player.pumpkins += 12;
                            this.showMessage(`Snatched +12 🎃 from P${numId}!`);
                            this.updateHUD();
                            if (this.mp.ws && this.mp.ws.readyState === WebSocket.OPEN) {
                                this.mp.ws.send(JSON.stringify({ type: 'snatch', targetId: numId, amount: 12 }));
                            }
                        }
                        return;
                    }
                }
            }
        }
    }

    // ============================================================
    // AI UPDATES
    // ============================================================
    updateGuards(dt) {
        const playerPos = this.player.position;

        for (const guard of this.guards) {
            const ud = guard.userData;
            const gPos = guard.position;

            if (ud.cooldown > 0) {
                ud.cooldown -= dt;
                continue;
            }

            const distToPlayer = playerPos.distanceTo(gPos);

            if (ud.alertLevel === 2) {
                // Chasing player
                ud.stateTimer -= dt;
                if (ud.stateTimer <= 0 || distToPlayer > 35) {
                    ud.alertLevel = 0;
                    ud.stateTimer = 0;
                    continue;
                }

                // Chase
                const dir = new THREE.Vector3().subVectors(playerPos, gPos).normalize();
                gPos.x += dir.x * ud.chaseSpeed * dt;
                gPos.z += dir.z * ud.chaseSpeed * dt;
                gPos.y = this.getHeight(gPos.x, gPos.z);
                guard.lookAt(playerPos.x, gPos.y, playerPos.z);

                // Catch player
                if (distToPlayer < 2.5) {
                    const pumpkinPenalty = this.activeDifficulty.guardSpotPenalty;
                    const hpPenalty = this.activeDifficulty.guardCatchHpLoss;
                    this.player.pumpkins = Math.max(0, this.player.pumpkins - pumpkinPenalty);
                    this.player.hp -= hpPenalty;
                    this.showAlert(`Guard caught you! -${pumpkinPenalty} pumpkins, -${hpPenalty} HP!`);
                    ud.alertLevel = 0;
                    ud.cooldown = 5;

                    // Push player away
                    const pushDir = new THREE.Vector3().subVectors(playerPos, gPos).normalize();
                    this.player.velocity.x = pushDir.x * 15;
                    this.player.velocity.z = pushDir.z * 15;
                    this.player.velocity.y = 8;

                    this.updateHUD();
                }
            } else if (ud.alertLevel === 1) {
                // Suspicious
                guard.lookAt(playerPos.x, gPos.y, playerPos.z);
                ud.stateTimer -= dt;
                if (distToPlayer < ud.detectionRange * 0.7) {
                    ud.alertLevel = 2;
                    ud.stateTimer = 8;
                    this.showAlert('Guard spotted you! RUN!');
                } else if (ud.stateTimer <= 0 || distToPlayer > ud.detectionRange * 1.5) {
                    ud.alertLevel = 0;
                }
            } else {
                // Patrol
                ud.patrolAngle += ud.patrolSpeed * dt;
                const px = ud.patrolCenter.x + Math.cos(ud.patrolAngle) * ud.patrolRadius;
                const pz = ud.patrolCenter.z + Math.sin(ud.patrolAngle) * ud.patrolRadius;
                const dir = new THREE.Vector3(px - gPos.x, 0, pz - gPos.z);
                if (dir.length() > 0.1) {
                    dir.normalize();
                    gPos.x += dir.x * 1.5 * dt;
                    gPos.z += dir.z * 1.5 * dt;
                    gPos.y = this.getHeight(gPos.x, gPos.z);
                    guard.lookAt(gPos.x + dir.x, gPos.y, gPos.z + dir.z);
                }
                // Guards only catch the player red-handed during pumpkin collection (see interact())
            }

            // Guard walk-cycle animation
            const glimbs = guard._limbs;
            if (glimbs) {
                if (ud.alertLevel !== 1) { // moving (patrol or chase)
                    glimbs.walkTimer += dt * (ud.alertLevel === 2 ? 10 : 4);
                    const sw = Math.sin(glimbs.walkTimer);
                    glimbs.legs[0].rotation.x = sw * 0.6;
                    glimbs.legs[1].rotation.x = -sw * 0.6;
                    glimbs.arms[0].rotation.x = -sw * 0.4;
                    glimbs.arms[1].rotation.x = sw * 0.4;
                    glimbs.body.position.y = 1.2 + Math.abs(sw) * 0.06;
                } else { // suspicious — settle limbs back
                    glimbs.legs[0].rotation.x *= 0.85;
                    glimbs.legs[1].rotation.x *= 0.85;
                    glimbs.arms[0].rotation.x *= 0.85;
                    glimbs.arms[1].rotation.x *= 0.85;
                    glimbs.body.position.y = 1.2;
                }
            }
        }
    }

    updateAnimals(dt) {
        for (const animal of this.animals) {
            const ud = animal.userData;
            const pos = animal.position;

            // Check flee from player
            const distToPlayer = this.player.position.distanceTo(pos);
            if (distToPlayer < 6 && !ud.fleeing) {
                ud.fleeing = true;
                ud.fleeTimer = 3;
                const away = new THREE.Vector3().subVectors(pos, this.player.position).normalize();
                ud.wanderTarget.set(pos.x + away.x * 15, 0, pos.z + away.z * 15);
            }

            if (ud.fleeing) {
                ud.fleeTimer -= dt;
                if (ud.fleeTimer <= 0) ud.fleeing = false;
            }

            // Move toward target
            const speed = ud.fleeing ? ud.fleeSpeed : ud.speed;
            const dir = new THREE.Vector3().subVectors(ud.wanderTarget, pos);
            dir.y = 0;
            if (dir.length() < 2 || dir.length() > 100) {
                // New wander target
                ud.wanderTarget.set(
                    pos.x + (Math.random() - 0.5) * 20,
                    0,
                    pos.z + (Math.random() - 0.5) * 20
                );
            } else {
                dir.normalize();
                pos.x += dir.x * speed * dt;
                pos.z += dir.z * speed * dt;
                pos.y = this.getHeight(pos.x, pos.z);
                animal.lookAt(pos.x + dir.x, pos.y, pos.z + dir.z);
            }

            // Leg cycle for goat & cow (diagonal-pair trot gait)
            const alimbs = animal._limbs;
            if (alimbs && alimbs.legs) {
                alimbs.walkTimer += dt * speed * 2;
                const sw = Math.sin(alimbs.walkTimer);
                alimbs.legs[0].rotation.x =  sw * 0.5;  // left-front
                alimbs.legs[3].rotation.x =  sw * 0.5;  // right-back (diagonal)
                alimbs.legs[1].rotation.x = -sw * 0.5;  // left-back
                alimbs.legs[2].rotation.x = -sw * 0.5;  // right-front
            }

            // Hop animation for rabbits
            if (ud.animalType === 'rabbit' && (ud.fleeing || dir.length() > 2)) {
                pos.y += Math.abs(Math.sin(Date.now() * 0.01)) * 0.3;
            }
        }
    }

    updatePredators(dt) {
        const playerPos = this.player.position;
        const huntedVillagers = new Set();
        const huntedGuards = new Set();
        if (this._leopardCooldown > 0) this._leopardCooldown -= dt;

        // Force an attack every 25-40 seconds — one at a time
        this._forceAttackTimer -= dt;
        if (this._forceAttackTimer <= 0) {
            this._forceAttackTimer = 25 + Math.random() * 15;

            // Only trigger if fewer than 2 predators are already actively hunting
            const alreadyHunting = this.predators.filter(p =>
                p.userData.state === 'hunting' && p.userData.target !== null
            ).length;

            if (alreadyHunting < 2) {
                const candidates = [];
                for (const v of this.villagers) {
                    const d = playerPos.distanceTo(v.position);
                    if (d < 100) candidates.push({ type: 'villager', obj: v, dist: d });
                }
                for (const g of this.guards) {
                    const d = playerPos.distanceTo(g.position);
                    if (d < 100) candidates.push({ type: 'guard', obj: g, dist: d });
                }
                candidates.push({ type: 'player', obj: null, dist: 0 });

                const target = candidates[Math.floor(Math.random() * candidates.length)];

                // Find a roaming predator within 80m, or teleport one nearby
                let attacker = null;
                let bestDist = Infinity;
                for (const p of this.predators) {
                    const d = playerPos.distanceTo(p.position);
                    if (d < 100 && p.userData.state === 'roaming' && d < bestDist) {
                        bestDist = d;
                        attacker = p;
                    }
                }
                if (!attacker && this.predators.length > 0) {
                    attacker = this.predators[Math.floor(Math.random() * this.predators.length)];
                    const angle = Math.random() * Math.PI * 2;
                    const spawnDist = 30 + Math.random() * 20;
                    attacker.position.x = playerPos.x + Math.cos(angle) * spawnDist;
                    attacker.position.z = playerPos.z + Math.sin(angle) * spawnDist;
                    attacker.position.y = this.getHeight(attacker.position.x, attacker.position.z);
                }

                if (attacker) {
                    const ud = attacker.userData;
                    ud.state = 'hunting';
                    if (target.type === 'player') {
                        ud.target = 'player';
                        ud.huntingVillager = null;
                        ud.huntingGuard = null;
                    } else if (target.type === 'villager') {
                        ud.target = 'villager';
                        ud.huntingVillager = target.obj;
                        ud.huntingGuard = null;
                        target.obj.userData.beingAttacked = true;
                        target.obj.userData.attacker = attacker;
                    } else if (target.type === 'guard') {
                        ud.target = 'guard';
                        ud.huntingGuard = target.obj;
                        ud.huntingVillager = null;
                        target.obj.userData.beingAttacked = true;
                        target.obj.userData.attacker = attacker;
                    }
                }
            } // end !alreadyHunting
        }

        const huntingCount = this.predators.filter(p => p.userData.state === 'hunting').length;

        for (let i = this.predators.length - 1; i >= 0; i--) {
            const pred = this.predators[i];
            const ud = pred.userData;
            const pos = pred.position;

            if (ud.attackCooldown > 0) ud.attackCooldown -= dt;

            const distToPlayer = playerPos.distanceTo(pos);
            const inPlayerRange = distToPlayer < 100;

            // Check for nearby villagers to hunt
            let nearestVillager = null;
            let nearestVDist = Infinity;
            if (inPlayerRange) {
                for (const v of this.villagers) {
                    const d = pos.distanceTo(v.position);
                    if (d < ud.aggroRange && d < nearestVDist) {
                        nearestVDist = d;
                        nearestVillager = v;
                    }
                }
            }

            // Check for nearby guards to hunt
            let nearestGuard = null;
            let nearestGDist = Infinity;
            if (inPlayerRange) {
                for (const g of this.guards) {
                    const d = pos.distanceTo(g.position);
                    if (d < ud.aggroRange && d < nearestGDist) {
                        nearestGDist = d;
                        nearestGuard = g;
                    }
                }
            }

            // Prioritize player if very close — always overrides
            if (distToPlayer < ud.aggroRange * 0.7) {
                ud.state = 'hunting';
                ud.target = 'player';
                ud.huntingVillager = null;
                ud.huntingGuard = null;
            } else if (ud.state === 'hunting' && ud.target !== null) {
                // Already committed to a hunt — keep it unless target is gone or out of give-up range
                const giveUpRange = ud.aggroRange * 1.5;
                if (ud.target === 'villager') {
                    if (!ud.huntingVillager || !this.villagers.includes(ud.huntingVillager) ||
                        pos.distanceTo(ud.huntingVillager.position) > giveUpRange) {
                        ud.state = 'roaming'; ud.target = null; ud.huntingVillager = null;
                    }
                } else if (ud.target === 'guard') {
                    if (!ud.huntingGuard || !this.guards.includes(ud.huntingGuard) ||
                        pos.distanceTo(ud.huntingGuard.position) > giveUpRange) {
                        ud.state = 'roaming'; ud.target = null; ud.huntingGuard = null;
                    }
                }
                // else target === 'player': keep hunting player until give-up
            } else if (huntingCount < 2 && nearestVillager && (!nearestGuard || nearestVDist <= nearestGDist)) {
                ud.state = 'hunting';
                ud.target = 'villager';
                ud.huntingVillager = nearestVillager;
                ud.huntingGuard = null;
                nearestVillager.userData.beingAttacked = true;
                nearestVillager.userData.attacker = pred;
            } else if (huntingCount < 2 && nearestGuard) {
                ud.state = 'hunting';
                ud.target = 'guard';
                ud.huntingGuard = nearestGuard;
                ud.huntingVillager = null;
                nearestGuard.userData.beingAttacked = true;
                nearestGuard.userData.attacker = pred;
            } else {
                ud.state = 'roaming';
                ud.target = null;
                ud.huntingVillager = null;
                ud.huntingGuard = null;
            }

            // Update floating danger arrow above targeted villager or guard
            if (ud.target === 'villager' && ud.huntingVillager) {
                const v = ud.huntingVillager;
                huntedVillagers.add(v);
                if (!this.predatorAttackArrows.has(v)) {
                    const arrow = new THREE.ArrowHelper(
                        new THREE.Vector3(0, -1, 0),
                        new THREE.Vector3(),
                        2.0, 0xFF2200, 0.7, 0.5
                    );
                    this.scene.add(arrow);
                    this.predatorAttackArrows.set(v, arrow);
                }
                const arrow = this.predatorAttackArrows.get(v);
                const yBob = Math.sin(Date.now() * 0.005) * 0.25;
                arrow.position.set(v.position.x, v.position.y + 5.5 + yBob, v.position.z);
            } else if (ud.target === 'guard' && ud.huntingGuard) {
                const g = ud.huntingGuard;
                huntedGuards.add(g);
                if (!this.predatorAttackArrows.has(g)) {
                    const arrow = new THREE.ArrowHelper(
                        new THREE.Vector3(0, -1, 0),
                        new THREE.Vector3(),
                        2.0, 0xFF8800, 0.7, 0.5
                    );
                    this.scene.add(arrow);
                    this.predatorAttackArrows.set(g, arrow);
                }
                const arrow = this.predatorAttackArrows.get(g);
                const yBob = Math.sin(Date.now() * 0.005) * 0.25;
                arrow.position.set(g.position.x, g.position.y + 5.5 + yBob, g.position.z);
            }

            if (ud.state === 'hunting') {
                const huntTarget = ud.target === 'player' ? playerPos :
                    ud.target === 'villager' ? (ud.huntingVillager ? ud.huntingVillager.position : null) :
                    ud.target === 'guard' ? (ud.huntingGuard ? ud.huntingGuard.position : null) : null;

                if (huntTarget) {
                    const dir = new THREE.Vector3().subVectors(huntTarget, pos);
                    dir.y = 0;
                    const dist = dir.length();

                    if (dist > 1.5) {
                        dir.normalize();
                        pos.x += dir.x * ud.speed * dt;
                        pos.z += dir.z * ud.speed * dt;
                        pos.y = this.getHeight(pos.x, pos.z);
                        pred.lookAt(huntTarget.x, pos.y, huntTarget.z);
                    }

                    // Attack
                    if (dist < ud.attackRange && ud.attackCooldown <= 0) {
                        ud.attackCooldown = 1.5;
                        if (ud.target === 'player') {
                            // Leopard attack sound — only when hitting the player
                            if (this._leopardCooldown <= 0) {
                                this.sfx.leopard.currentTime = 0;
                                this.sfx.leopard.play().catch(() => {});
                                this._leopardCooldown = 2.5;
                            }
                            this.player.hp -= ud.damage;
                            this.showAlert(`Wolf attack! -${ud.damage} HP!`);
                            this.updateHUD();
                            if (this.player.hp <= 0) this.gameOver();
                        } else if (ud.target === 'villager' && ud.huntingVillager) {
                            ud.huntingVillager.userData.hp -= 15;
                            if (ud.huntingVillager.userData.hp <= 0) {
                                // Villager dies — clean up attack arrow
                                if (this.predatorAttackArrows.has(ud.huntingVillager)) {
                                    this.scene.remove(this.predatorAttackArrows.get(ud.huntingVillager));
                                    this.predatorAttackArrows.delete(ud.huntingVillager);
                                }
                                this.showMessage('A villager was killed by wolves! 💀');
                                this.scene.remove(ud.huntingVillager);
                                const idx = this.villagers.indexOf(ud.huntingVillager);
                                if (idx >= 0) this.villagers.splice(idx, 1);
                                ud.huntingVillager = null;
                                ud.state = 'roaming';
                            }
                        } else if (ud.target === 'guard' && ud.huntingGuard) {
                            ud.huntingGuard.userData.hp -= 15;
                            if (ud.huntingGuard.userData.hp <= 0) {
                                // Guard dies
                                this.showMessage('A guard was killed by wolves! 💀');
                                this.scene.remove(ud.huntingGuard);
                                const gIdx = this.guards.indexOf(ud.huntingGuard);
                                if (gIdx >= 0) this.guards.splice(gIdx, 1);
                                ud.huntingGuard = null;
                                ud.state = 'roaming';
                            }
                        }
                    }
                }
            } else {
                // Roam
                ud.roamTimer -= dt;
                if (ud.roamTimer <= 0) {
                    ud.wanderTarget.set(
                        pos.x + (Math.random() - 0.5) * 30,
                        0,
                        pos.z + (Math.random() - 0.5) * 30
                    );
                    ud.roamTimer = 3 + Math.random() * 4;
                }
                const dir = new THREE.Vector3().subVectors(ud.wanderTarget, pos);
                dir.y = 0;
                if (dir.length() > 1) {
                    dir.normalize();
                    pos.x += dir.x * ud.speed * 0.4 * dt;
                    pos.z += dir.z * ud.speed * 0.4 * dt;
                    pos.y = this.getHeight(pos.x, pos.z);
                    pred.lookAt(pos.x + dir.x, pos.y, pos.z + dir.z);
                }
            }

            // Wolf walk-cycle animation
            const wlimbs = pred._limbs;
            if (wlimbs) {
                wlimbs.walkTimer += dt * (ud.state === 'hunting' ? 8 : 3);
                const sw = Math.sin(wlimbs.walkTimer);
                wlimbs.legs[0].rotation.x =  sw * 0.55;  // left-front
                wlimbs.legs[3].rotation.x =  sw * 0.55;  // right-back
                wlimbs.legs[1].rotation.x = -sw * 0.55;  // left-back
                wlimbs.legs[2].rotation.x = -sw * 0.55;  // right-front
                wlimbs.tail.rotation.z = Math.sin(wlimbs.walkTimer * 1.5) *
                    (ud.state === 'hunting' ? 0.4 : 0.2);
            }
        }

        // Remove arrows for villagers/guards no longer being actively hunted
        const arrowsToRemove = [];
        for (const [target] of this.predatorAttackArrows) {
            if (!huntedVillagers.has(target) && !huntedGuards.has(target)) arrowsToRemove.push(target);
        }
        for (const target of arrowsToRemove) {
            this.scene.remove(this.predatorAttackArrows.get(target));
            this.predatorAttackArrows.delete(target);
        }

        // Update danger compass HUD
        const compassEl = document.getElementById('danger-compass');
        if (compassEl) {
            if (huntedVillagers.size === 0 && huntedGuards.size === 0) {
                compassEl.style.display = 'none';
                compassEl.innerHTML = '';
            } else {
                compassEl.style.display = 'flex';
                const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
                camFwd.y = 0;
                if (camFwd.lengthSq() > 0.001) camFwd.normalize();
                const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
                camRight.y = 0;
                if (camRight.lengthSq() > 0.001) camRight.normalize();

                const arrows = ['↑','↗','→','↘','↓','↙','←','↖'];
                let html = '';

                const buildCard = (target, label, icon, maxHp) => {
                    const toT = new THREE.Vector3().subVectors(target.position, this.player.position);
                    const dist = Math.round(toT.length());
                    toT.y = 0;
                    if (toT.lengthSq() > 0.001) toT.normalize();
                    const angle = Math.atan2(camRight.dot(toT), camFwd.dot(toT)) * 180 / Math.PI;
                    const arrowIdx = Math.round(((angle % 360) + 360) % 360 / 45) % 8;
                    const dir = arrows[arrowIdx];
                    const wolf = target.userData.attacker;
                    const wolfDist = wolf ? wolf.position.distanceTo(target.position) : dist;
                    const timeToReach = Math.max(0, (wolfDist - 2) / 5);
                    const hitsLeft = Math.ceil(target.userData.hp / 15);
                    const secsLeft = Math.max(1, Math.round(timeToReach + hitsLeft * 1.5));
                    const urgency = secsLeft <= 3 ? '🔴' : secsLeft <= 6 ? '🟡' : '🟢';
                    html += `<div class="danger-card">${urgency} ${icon} ${label} ${dir} ${dist}m &mdash; ~${secsLeft}s</div>`;
                };

                for (const v of huntedVillagers) buildCard(v, 'Villager', '👤', 30);
                for (const g of huntedGuards)    buildCard(g, 'Guard',    '🛡️', 60);

                compassEl.innerHTML = html;
            }
        }
    }

    updateVillagers(dt) {
        for (const v of this.villagers) {
            const ud = v.userData;
            const pos = v.position;

            if (ud.beingAttacked && ud.attacker) {
                // Flee from attacker
                const away = new THREE.Vector3().subVectors(pos, ud.attacker.position).normalize();
                pos.x += away.x * ud.fleeSpeed * dt;
                pos.z += away.z * ud.fleeSpeed * dt;
                pos.y = this.getHeight(pos.x, pos.z);

                // Check if player killed the attacker (saved the villager)
                if (!this.predators.includes(ud.attacker)) {
                    if (this.predatorAttackArrows.has(v)) {
                        this.scene.remove(this.predatorAttackArrows.get(v));
                        this.predatorAttackArrows.delete(v);
                    }
                    ud.beingAttacked = false;
                    ud.attacker = null;
                    if (!ud.saved) {
                        ud.saved = true;
                        this.player.pumpkins += 5;
                        this.showMessage('Villager saved! +5 Pumpkins! 🎃🛡️');
                        this.updateHUD();
                    }
                }
            } else {
                // Wander
                ud.stateTimer -= dt;
                if (ud.stateTimer <= 0) {
                    ud.wanderTarget.set(
                        pos.x + (Math.random() - 0.5) * 15,
                        0,
                        pos.z + (Math.random() - 0.5) * 15
                    );
                    ud.stateTimer = 3 + Math.random() * 5;
                }
                const dir = new THREE.Vector3().subVectors(ud.wanderTarget, pos);
                dir.y = 0;
                if (dir.length() > 1) {
                    dir.normalize();
                    pos.x += dir.x * ud.speed * dt;
                    pos.z += dir.z * ud.speed * dt;
                    pos.y = this.getHeight(pos.x, pos.z);
                    v.lookAt(pos.x + dir.x, pos.y, pos.z + dir.z);
                }
            }

            // Villager walk-cycle animation
            const vlimbs = v._limbs;
            if (vlimbs) {
                const walkSpeed = ud.beingAttacked ? ud.fleeSpeed : ud.speed;
                vlimbs.walkTimer += dt * walkSpeed * 2;
                const sw = Math.sin(vlimbs.walkTimer);
                vlimbs.legs[0].rotation.x =  sw * 0.5;
                vlimbs.legs[1].rotation.x = -sw * 0.5;
                vlimbs.arms[0].rotation.x = -sw * 0.35;
                vlimbs.arms[1].rotation.x =  sw * 0.35;
                vlimbs.body.position.y = 1.2 + Math.abs(sw) * 0.04;
            }
        }
    }

    // ============================================================
    // SHOP SYSTEM
    // ============================================================
    toggleShop() {
        this.shopOpen = !this.shopOpen;
        document.getElementById('shop-panel').style.display = this.shopOpen ? 'block' : 'none';
        if (this.shopOpen) {
            document.exitPointerLock();
        } else {
            this.renderer.domElement.requestPointerLock();
        }
        this.updateShopUI();
    }

    sellPumpkins() {
        if (this.player.pumpkins <= 0) {
            this.showMessage('No pumpkins to sell!');
            return;
        }
        const earned = this.player.pumpkins * 5;
        this.player.coins += earned;
        this.player.totalCoinsEarned += earned;
        this.showMessage(`Sold ${this.player.pumpkins} pumpkins for ${earned} coins! 🪙`);
        this.player.pumpkins = 0;
        this.updateHUD();
        this.updateShopUI();
    }

    upgradeWeapon() {
        const cost = this.player.weaponLevel * 20;
        if (this.player.coins < cost) {
            this.showMessage('Not enough coins!');
            return;
        }
        this.player.coins -= cost;
        this.player.weaponLevel++;
        this.showMessage(`Sword upgraded to Level ${this.player.weaponLevel}! ⚔️`);
        this.updateHUD();
        this.updateShopUI();
    }

    buyGun(id) {
        const wep = this.weaponDefs[id];
        if (!wep || wep.owned) return;
        if (this.player.coins < wep.cost) {
            this.showMessage('Not enough coins!');
            return;
        }
        this.player.coins -= wep.cost;
        wep.owned = true;
        this.showMessage(`${wep.name} purchased! Press ${id} to equip`);
        this.updateHUD();
        this.updateShopUI();
    }

    buyHealthPotion() {
        if (this.player.coins < 15) {
            this.showMessage('Not enough coins!');
            return;
        }
        this.player.coins -= 15;
        this.player.hp = this.player.maxHp;
        this.showMessage('Full HP restored! ❤️');
        this.updateHUD();
        this.updateShopUI();
    }

    updateShopUI() {
        const cost = this.player.weaponLevel * 20;
        const nextLevel = this.player.weaponLevel + 1;
        document.getElementById('upgrade-cost').textContent = `Cost: ${cost} coins (Level ${nextLevel})`;
        document.getElementById('upgrade-btn').disabled = this.player.coins < cost;

        // Update gun shop items
        const gunShopDiv = document.getElementById('gun-shop-items');
        if (gunShopDiv) {
            gunShopDiv.innerHTML = '';
            for (let i = 2; i <= 4; i++) {
                const w = this.weaponDefs[i];
                const item = document.createElement('div');
                item.className = 'shop-item';
                item.innerHTML = `<div>
                    <div style="color:#4af">${w.name} ${w.owned ? '(OWNED)' : ''}</div>
                    <div style="font-size:12px;color:#aaa">DMG: ${w.damage} | Range: ${w.range} | Key: ${i}</div>
                </div>
                <button ${w.owned || this.player.coins < w.cost ? 'disabled' : ''}
                    onclick="game.buyGun(${i})">${w.owned ? 'OWNED' : w.cost + ' coins'}</button>`;
                gunShopDiv.appendChild(item);
            }
        }
    }

    // ============================================================
    // UI UPDATES
    // ============================================================
    updateHUD() {
        document.getElementById('pumpkin-count').textContent = this.player.pumpkins;
        document.getElementById('coin-count').textContent = this.player.coins;
        const wep = this.weaponDefs[this.player.currentWeapon];
        document.getElementById('weapon-level').textContent = wep.name + (wep.type === 'melee' ? ' Lv' + this.player.weaponLevel : '');

        // HP box: show "P1 · HP: 100" in MP, or plain "HP: 100" solo
        const hpBox = document.getElementById('hp-box');
        if (this.mp && this.mp.enabled && this.mp.playerId) {
            hpBox.innerHTML = `❤️ <span style="color:#f90;font-weight:bold">P${this.mp.playerId}</span> &middot; HP: <span id="hp-display">${Math.round(this.player.hp)}</span> &nbsp;<span class="code-chip" style="font-size:12px">${this.mp.roomCode || ''}</span>`;
        } else {
            hpBox.innerHTML = `❤️ HP: <span id="hp-display">${Math.round(this.player.hp)}</span>`;
        }

        const hpPercent = (this.player.hp / this.player.maxHp) * 100;
        document.getElementById('health-bar').style.width = hpPercent + '%';
        document.getElementById('health-text').textContent = `HP: ${Math.round(this.player.hp)}/${this.player.maxHp}`;

        // Color health bar
        const bar = document.getElementById('health-bar');
        if (hpPercent > 60) bar.style.background = '#4a4';
        else if (hpPercent > 30) bar.style.background = '#aa4';
        else bar.style.background = '#a44';
    }

    showMessage(text) {
        const el = document.getElementById('message');
        el.textContent = text;
        el.style.opacity = 1;
        clearTimeout(this.messageTimeout);
        this.messageTimeout = setTimeout(() => el.style.opacity = 0, 2500);
    }

    showAlert(text) {
        const el = document.getElementById('alert-message');
        el.textContent = text;
        el.style.opacity = 1;
        clearTimeout(this.alertTimeout);
        this.alertTimeout = setTimeout(() => el.style.opacity = 0, 3000);
    }

    _resetAdCoinBtn() {
        const btn  = document.getElementById('ad-coins-btn');
        const base = this.touch.mode ? '🪙 FREE +5' : '🪙 FREE +5 (C)';
        this._adCoinReady = false;
        btn.classList.add('ad-btn-cooldown');
        let cd = 60;
        btn.textContent = base + ' · ' + cd + 's';
        const tick = setInterval(() => {
            if (!this.isRunning) { clearInterval(tick); return; }
            cd--;
            if (cd <= 0) {
                clearInterval(tick);
                this._adCoinReady = true;
                btn.classList.remove('ad-btn-cooldown');
                btn.textContent = base;
            } else {
                btn.textContent = base + ' · ' + cd + 's';
            }
        }, 1000);
    }

    gameOver() {
        this.isRunning = false;
        document.exitPointerLock();
        document.getElementById('game-over').style.display = 'flex';
        document.getElementById('ad-coins-btn').style.display = 'none';
        document.getElementById('final-pumpkins').textContent = this.player.pumpkins;
        document.getElementById('final-coins').textContent = this.player.totalCoinsEarned;
    }

    watchAdForReward(type) {
        if (type === 'coins' && !this._adCoinReady) return;
        // Open Adsterra SmartLink — try to keep focus on game tab
        const adWin = window.open('https://www.profitablecpmratenetwork.com/p6hirw8jd?key=f3fc10bb15115938e85e09f28c16e67f', '_blank', 'noopener,noreferrer');
        if (adWin) { try { adWin.blur(); } catch(e) {} }
        window.focus();

        // Pause game loop
        this._adWatching = true;

        // Show countdown overlay
        const overlay   = document.getElementById('ad-overlay');
        const countEl   = document.getElementById('ad-countdown');
        const msgEl     = document.getElementById('ad-reward-msg');

        msgEl.textContent = type === 'revive' ? '🟢 Reviving after countdown…' : '🪙 +5 Coins after countdown…';
        overlay.style.display = 'flex';

        let count = 6;
        countEl.textContent = count;

        const tick = setInterval(() => {
            count--;
            countEl.textContent = count;
            if (count <= 0) {
                clearInterval(tick);
                overlay.style.display = 'none';
                this._adWatching = false;

                if (type === 'revive') {
                    document.getElementById('game-over').style.display = 'none';
                    this.player.hp = this.player.maxHp;
                    this.isRunning = true;
                    this.updateHUD();
                    this.showMessage('Revived! ❤️');
                } else {
                    this.player.coins += 5;
                    this.updateHUD();
                    this.showMessage('+5 Coins! 🪙');
                    this._resetAdCoinBtn();
                }

                // Restore fullscreen at countdown end (global visibilitychange handles the tab-return case)
                if (this.touch.mode) this._restoreFullscreen();
            }
        }, 1000);
    }

    _restoreFullscreen() {
        // Check actual screen dimensions — fullscreen is lost when window is smaller than screen
        const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement ||
                             (window.innerHeight >= screen.height - 10);
        if (isFullscreen) return;

        const el = document.documentElement;
        const doFS = () => {
            if (document.fullscreenElement || document.webkitFullscreenElement) return;
            if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
            else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        };

        // Try immediately (works on Android Chrome from visibilitychange)
        doFS();

        // iOS Safari requires a real user gesture — fire on next touch
        const onTouch = () => {
            document.removeEventListener('touchstart', onTouch, true);
            doFS();
        };
        document.addEventListener('touchstart', onTouch, { once: true, capture: true });
    }

    // ============================================================
    // WEAPON VISUAL
    // ============================================================
    buildSwordVisual() {
        const group = new THREE.Group();
        const handle = this.createBox(0.08, 0.5, 0.08, 0x8B4513);
        handle.position.set(0, -0.25, 0);
        group.add(handle);
        const crossguard = this.createBox(0.3, 0.06, 0.08, 0xDAA520);
        crossguard.position.set(0, 0, 0);
        group.add(crossguard);
        const bladeLen = 0.6 + this.player.weaponLevel * 0.1;
        const blade = this.createBox(0.06, bladeLen, 0.03, 0xC0C0C0);
        blade.position.set(0, bladeLen / 2, 0);
        group.add(blade);
        const tip = this.createBox(0.04, 0.15, 0.02, 0xDDDDDD);
        tip.position.set(0, bladeLen + 0.07, 0);
        group.add(tip);
        group.position.set(0.35, -0.35, -0.5);
        group.rotation.z = -0.3;
        return group;
    }

    buildPistolVisual() {
        const group = new THREE.Group();
        // Grip
        const grip = this.createBox(0.08, 0.18, 0.12, 0x3a3a3a);
        grip.position.set(0, -0.09, 0);
        grip.rotation.x = 0.2;
        group.add(grip);
        // Body
        const body = this.createBox(0.08, 0.1, 0.3, 0x555555);
        body.position.set(0, 0.03, -0.1);
        group.add(body);
        // Barrel
        const barrel = this.createBox(0.05, 0.05, 0.22, 0x444444);
        barrel.position.set(0, 0.06, -0.28);
        group.add(barrel);
        group.position.set(0.3, -0.25, -0.45);
        return group;
    }

    buildShotgunVisual() {
        const group = new THREE.Group();
        // Stock
        const stock = this.createBox(0.07, 0.09, 0.25, 0x8B4513);
        stock.position.set(0, -0.02, 0.15);
        group.add(stock);
        // Body
        const body = this.createBox(0.08, 0.1, 0.4, 0x5a4a3a);
        body.position.set(0, 0.02, -0.1);
        group.add(body);
        // Barrel (double)
        for (const s of [-1, 1]) {
            const barrel = this.createBox(0.035, 0.035, 0.35, 0x444444);
            barrel.position.set(s * 0.025, 0.06, -0.35);
            group.add(barrel);
        }
        // Pump
        const pump = this.createBox(0.09, 0.07, 0.12, 0x6a5a4a);
        pump.position.set(0, -0.01, -0.2);
        group.add(pump);
        group.position.set(0.3, -0.28, -0.4);
        return group;
    }

    buildRifleVisual() {
        const group = new THREE.Group();
        // Stock
        const stock = this.createBox(0.07, 0.1, 0.3, 0x2F4F2F);
        stock.position.set(0, -0.02, 0.2);
        group.add(stock);
        // Body
        const body = this.createBox(0.08, 0.1, 0.45, 0x3a5a3a);
        body.position.set(0, 0.02, -0.1);
        group.add(body);
        // Barrel
        const barrel = this.createBox(0.04, 0.04, 0.4, 0x333333);
        barrel.position.set(0, 0.06, -0.45);
        group.add(barrel);
        // Magazine
        const mag = this.createBox(0.06, 0.14, 0.06, 0x2a2a2a);
        mag.position.set(0, -0.1, -0.05);
        group.add(mag);
        group.position.set(0.3, -0.28, -0.4);
        return group;
    }

    buildSniperVisual() {
        const group = new THREE.Group();
        // Stock
        const stock = this.createBox(0.06, 0.09, 0.35, 0x333333);
        stock.position.set(0, -0.02, 0.25);
        group.add(stock);
        // Body
        const body = this.createBox(0.07, 0.09, 0.5, 0x2a2a2a);
        body.position.set(0, 0.02, -0.1);
        group.add(body);
        // Long barrel
        const barrel = this.createBox(0.035, 0.035, 0.55, 0x222222);
        barrel.position.set(0, 0.06, -0.55);
        group.add(barrel);
        // Scope
        const scope = this.createBox(0.04, 0.06, 0.15, 0x111111);
        scope.position.set(0, 0.12, -0.08);
        group.add(scope);
        const scopeLens = this.createBox(0.035, 0.035, 0.02, 0x4488FF);
        scopeLens.position.set(0, 0.12, -0.16);
        group.add(scopeLens);
        // Bipod
        for (const s of [-1, 1]) {
            const leg = this.createBox(0.02, 0.12, 0.02, 0x333333);
            leg.position.set(s * 0.05, -0.08, -0.3);
            leg.rotation.x = 0.3;
            group.add(leg);
        }
        group.position.set(0.3, -0.28, -0.35);
        return group;
    }

    rebuildWeaponVisual() {
        // Remove old weapon
        if (this.weaponGroup) {
            this.camera.remove(this.weaponGroup);
        }
        const id = this.player.currentWeapon;
        switch (id) {
            case 0: this.weaponGroup = this.buildSwordVisual(); break;
            case 1: this.weaponGroup = this.buildPistolVisual(); break;
            case 2: this.weaponGroup = this.buildShotgunVisual(); break;
            case 3: this.weaponGroup = this.buildRifleVisual(); break;
            case 4: this.weaponGroup = this.buildSniperVisual(); break;
            default: this.weaponGroup = this.buildPistolVisual(); break;
        }
        this.camera.add(this.weaponGroup);
        if (!this.camera.parent) this.scene.add(this.camera);
    }

    drawWeapon() {
        if (this.weaponGroup) return;
        this.rebuildWeaponVisual();
    }

    updateWeaponVisual(dt) {
        if (!this.weaponGroup) {
            this.drawWeapon();
            return;
        }

        const wep = this.weaponDefs[this.player.currentWeapon];
        const time = Date.now() * 0.003;
        const isMoving = (this.keys['KeyW'] || this.keys['KeyS'] || this.keys['KeyA'] || this.keys['KeyD']);
        const bobAmount = isMoving ? 0.02 : 0.008;
        const bobSpeed = isMoving ? (this.player.isSprinting ? 8 : 5) : 2;

        const basePos = this.weaponGroup.userData.basePos || this.weaponGroup.position.clone();
        if (!this.weaponGroup.userData.basePos) this.weaponGroup.userData.basePos = basePos.clone();

        this.weaponGroup.position.y = basePos.y + Math.sin(time * bobSpeed) * bobAmount;
        this.weaponGroup.position.x = basePos.x + Math.cos(time * bobSpeed * 0.5) * bobAmount * 0.5;

        if (wep.type === 'melee') {
            // Sword swing
            if (this.player.isAttacking) {
                this.weaponGroup.rotation.x = -1.2;
                this.weaponGroup.position.z = basePos.z + 0.2;
            } else {
                this.weaponGroup.rotation.x += (-0.2 - this.weaponGroup.rotation.x) * 0.1;
                this.weaponGroup.position.z += (basePos.z - this.weaponGroup.position.z) * 0.1;
            }
        } else {
            // Gun recoil
            if (this.player.isShooting) {
                this.weaponGroup.position.z = basePos.z + 0.08;
                this.weaponGroup.rotation.x = -0.08;
            } else {
                this.weaponGroup.position.z += (basePos.z - this.weaponGroup.position.z) * 0.15;
                this.weaponGroup.rotation.x += (0 - this.weaponGroup.rotation.x) * 0.15;
            }
        }
    }

    // ============================================================
    // DAY/NIGHT VISUAL (subtle tinting)
    // ============================================================
    updateSkybox(dt) {
        const time = Date.now() * 0.00005;
        const dayFactor = (Math.sin(time) + 1) / 2;
        const r = 0.3 + dayFactor * 0.2;
        const g = 0.5 + dayFactor * 0.3;
        const b = 0.7 + dayFactor * 0.2;
        this.scene.background.setRGB(r, g, b);
        this.scene.fog.color.setRGB(r, g, b);
    }

    // ============================================================
    // FLOATING TEXT INDICATORS
    // ============================================================
    createFloatingText(text, position, color) {
        // Simple billboard text using a sprite
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.font = 'bold 32px Courier New';
        ctx.fillStyle = color || '#ffff00';
        ctx.textAlign = 'center';
        ctx.fillText(text, 128, 40);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.position.copy(position);
        sprite.position.y += 2;
        sprite.scale.set(3, 0.75, 1);
        this.scene.add(sprite);

        // Animate up and fade
        const startY = sprite.position.y;
        const startTime = Date.now();
        const animInterval = setInterval(() => {
            const elapsed = (Date.now() - startTime) / 1000;
            sprite.position.y = startY + elapsed * 2;
            spriteMat.opacity = 1 - elapsed / 2;
            if (elapsed > 2) {
                clearInterval(animInterval);
                this.scene.remove(sprite);
                texture.dispose();
                spriteMat.dispose();
            }
        }, 30);
    }

    // ============================================================
    // PROXIMITY HINTS
    // ============================================================
    updateProximityHints() {
        const pos = this.player.position;

        // Check near pumpkins
        for (const p of this.pumpkins) {
            if (p.userData.collected) continue;
            if (pos.distanceTo(p.position) < 5) {
                document.getElementById('crosshair').textContent = '[ E ] Collect';
                document.getElementById('crosshair').style.color = '#f90';
                return;
            }
        }

        // Check near herbs
        for (const h of this.herbs) {
            if (h.userData.collected) continue;
            if (pos.distanceTo(h.position) < 5) {
                document.getElementById('crosshair').textContent = '[ E ] Herb +5HP';
                document.getElementById('crosshair').style.color = '#4caf50';
                return;
            }
        }

        // Check near guards
        for (const g of this.guards) {
            if (pos.distanceTo(g.position) < 5 && g.userData.alertLevel === 0) {
                document.getElementById('crosshair').textContent = '[ E ] Steal';
                document.getElementById('crosshair').style.color = '#f44';
                return;
            }
        }

        document.getElementById('crosshair').textContent = '+';
        document.getElementById('crosshair').style.color = '#fff';

        // On mobile: switch attack button to collect icon when near any collectible
        if (this.touch.mode) {
            let nearCollect = false;
            for (const p of this.pumpkins) {
                if (!p.userData.collected && pos.distanceTo(p.position) < 5) { nearCollect = true; break; }
            }
            if (!nearCollect) {
                for (const h of this.herbs) {
                    if (!h.userData.collected && pos.distanceTo(h.position) < 5) { nearCollect = true; break; }
                }
            }
            if (!nearCollect) {
                for (const g of this.guards) {
                    if (pos.distanceTo(g.position) < 5 && g.userData.alertLevel === 0) { nearCollect = true; break; }
                }
            }
            this._nearCollectible = nearCollect;
            const ab = document.getElementById('btn-attack');
            ab.textContent  = nearCollect ? '🎃' : '⚔️';
            ab.style.background = nearCollect ? 'rgba(255,153,0,0.65)' : 'rgba(190,40,40,0.65)';
            ab.style.borderColor = nearCollect ? 'rgba(255,200,0,0.7)' : 'rgba(255,100,100,0.7)';
        }
    }

    // ============================================================
    // PARTICLE EFFECTS
    // ============================================================
    spawnCollectionEffect(worldPos) {
        const colors = [0xFF8C00, 0xFFD700, 0xFF4400, 0x228B22, 0xFFFF00];
        for (let i = 0; i < 14; i++) {
            const size = 0.07 + Math.random() * 0.13;
            const geo = new THREE.BoxGeometry(size, size, size);
            const mat = new THREE.MeshBasicMaterial({ color: colors[i % colors.length] });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(worldPos);
            this.scene.add(mesh);
            const angle = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
            const upward = 2.5 + Math.random() * 3.5;
            const outward = 1.5 + Math.random() * 2.5;
            const maxLife = 0.5 + Math.random() * 0.45;
            this.particles.push({
                mesh,
                velocity: new THREE.Vector3(
                    Math.cos(angle) * outward,
                    upward,
                    Math.sin(angle) * outward
                ),
                lifetime: maxLife,
                maxLifetime: maxLife
            });
        }
    }

    updateParticles(dt) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.lifetime -= dt;
            if (p.lifetime <= 0) {
                this.scene.remove(p.mesh);
                this.particles.splice(i, 1);
                continue;
            }
            p.mesh.position.addScaledVector(p.velocity, dt);
            p.velocity.y -= 14 * dt; // gravity pull-down
            const s = Math.max(0.01, p.lifetime / p.maxLifetime);
            p.mesh.scale.setScalar(s);
        }
    }

    // ============================================================
    // MAIN GAME LOOP
    // ============================================================
    animate() {
        requestAnimationFrame(() => this.animate());

        if (!this.isRunning || this._adWatching) {
            this.renderer.render(this.scene, this.camera);
            return;
        }

        const dt = Math.min(this.clock.getDelta(), 0.05);

        this.updatePlayer(dt);
        this.updateGuards(dt);
        this.updateAnimals(dt);
        this.updatePredators(dt);
        this.updateVillagers(dt);
        this.updateBullets(dt);
        this.updateParticles(dt);
        this.updateHerbs(dt);
        this.updateWeaponVisual(dt);
        this.updateSkybox(dt);
        this.updateProximityHints();
        this.updateHUD();

        // Multiplayer: broadcast own state + animate remote players
        this._syncMpState(dt);
        for (const rp of Object.values(this.mp.remotePlayers)) {
            // Tick PvP cooldown
            if (rp.cooldown > 0) rp.cooldown = Math.max(0, rp.cooldown - dt);
            rp.walkTimer += dt * 5;
            const sw    = Math.sin(rp.walkTimer);
            const limbs = rp.mesh._limbs;
            if (limbs) {
                if (limbs.legs  && limbs.legs.length  >= 2) {
                    limbs.legs[0].rotation.x =  sw * 0.5;
                    limbs.legs[1].rotation.x = -sw * 0.5;
                }
                if (limbs.arms  && limbs.arms.length  >= 2) {
                    limbs.arms[0].rotation.x = -sw * 0.4;
                    limbs.arms[1].rotation.x =  sw * 0.4;
                }
            }
        }

        // Pumpkin bob animation
        for (const p of this.pumpkins) {
            if (!p.userData.collected) {
                p.position.y = this.getHeight(p.position.x, p.position.z) + 0.5 +
                    Math.sin(Date.now() * 0.003 + p.position.x) * 0.15;
                p.rotation.y += dt * 0.5;
            }
        }

        // Herb bob animation
        for (const h of this.herbs) {
            if (!h.userData.collected) {
                h.position.y = this.getHeight(h.position.x, h.position.z) + 0.4 +
                    Math.sin(Date.now() * 0.004 + h.position.z) * 0.12;
                h.rotation.y += dt * 0.8;
            }
        }

        // Check player death
        if (this.player.hp <= 0) {
            this.gameOver();
        }

        this.renderer.render(this.scene, this.camera);
    }
}

// ============================================================
// START GAME
// ============================================================
const game = new PumpkinCollectorGame();
