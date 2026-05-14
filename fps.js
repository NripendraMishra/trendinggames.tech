'use strict';

// ─── VoxelFPS — Krunker-style browser FPS ────────────────────────────────────

class VoxelFPS {

    // ─── Constants ────────────────────────────────────────────────────────────

    static GRAVITY      = -25;
    static SPEED        = 10;
    static SPRINT_SPEED = 16;
    static JUMP_FORCE   = 14;
    static PLAYER_H     = 1.7;
    static MAP_LIMIT    = 86;
    static KILLS_TO_WIN = 20;
    static RESPAWN_SECS = 3;
    static SYNC_MS      = 50;

    static PALETTE = [
        null,
        0xFF3300, 0x3388FF, 0x33CC55, 0xFF33CC,
        0xFFCC00, 0x00CCFF, 0xFF6600, 0x9933FF
    ];

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor() {
        // Three.js core
        this.scene    = null;
        this.camera   = null;
        this.renderer = null;
        this.clock    = null;

        // Player state
        this.player = {
            position: new THREE.Vector3(0, VoxelFPS.PLAYER_H, 0),
            velocity: new THREE.Vector3(),
            hp:       100,
            kills:    0,
            deaths:   0,
            onGround: false,
        };

        this.yaw   = 0;
        this.pitch = 0;

        // Input
        this.keys    = {};
        this.isLocked = false;

        // Shooting
        this.shootCooldown  = 0;
        this.raycaster      = null;
        this.coverBoxes     = [];    // { min, max } AABB for cover blocks
        this.coverMeshes    = [];

        // Remote players  id → { mesh, hp, kills, deaths, headMesh }
        this.remotePlayers  = {};

        // Kill feed  [{ text, born }]
        this.killFeed = [];

        // Multiplayer
        this.mp = {
            enabled:   false,
            ws:        null,
            roomCode:  null,
            playerId:  null,
            syncTimer: 0,
        };

        this.isRunning    = false;
        this.isRespawning = false;

        // Gun view-model
        this.gun = {
            group:      null,
            muzzleMesh: null,
            bobTimer:   0,
            kickTimer:  0,
            basePos:    new THREE.Vector3(0.28, -0.22, -0.5),
            adsPos:     new THREE.Vector3(0, -0.18, -0.45),   // aim-down-sights position
        };

        this.isAiming = false;

        this.spawnPoints = [
            new THREE.Vector3(-68, 0, -60),  // T-spawn left
            new THREE.Vector3(-60, 0, -60),  // T-spawn right
            new THREE.Vector3( 68, 0,  60),  // CT-spawn left
            new THREE.Vector3( 60, 0,  60),  // CT-spawn right
            new THREE.Vector3(  0, 0,  -5),  // mid
            new THREE.Vector3( 70, 0, -50),  // long-A
            new THREE.Vector3(-70, 0,  50),  // long-B
            new THREE.Vector3( 45, 0, -55),  // A-site
        ];

        // Touch
        this.touch = {
            mode: ('ontouchstart' in window) || (navigator.maxTouchPoints >= 1),
            joystick: { active: false, dx: 0, dy: 0 },
            sprint: false,
        };
    }

    // ─── Init ─────────────────────────────────────────────────────────────────

    init() {
        this._setupScene();
        this._setupInput();
        this.animate();
    }

    _setupScene() {
        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
        document.getElementById('game-canvas').appendChild(this.renderer.domElement);

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB);
        this.scene.fog = new THREE.Fog(0xd4c5a9, 40, 160);

        // Camera
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 300);
        this.camera.position.copy(this.player.position);

        // Lights
        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambient);
        const sun = new THREE.DirectionalLight(0xffffff, 0.9);
        sun.position.set(50, 80, 30);
        sun.castShadow = true;
        sun.shadow.mapSize.width  = 1024;
        sun.shadow.mapSize.height = 1024;
        sun.shadow.camera.near = 1;
        sun.shadow.camera.far  = 250;
        sun.shadow.camera.left = sun.shadow.camera.bottom = -100;
        sun.shadow.camera.right = sun.shadow.camera.top   =  100;
        this.scene.add(sun);

        this.clock         = new THREE.Clock();
        this.raycaster     = new THREE.Raycaster();
        this.occRaycaster  = new THREE.Raycaster();  // occlusion checks

        // Shoot sound
        this.shootSound = new Audio('pistal-shoot.mp3');
        this.shootSound.volume = 0.5;

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    // ─── Map ──────────────────────────────────────────────────────────────────

    generateMap() {
        const W  = 0x8B7355;  // wall tan
        const W2 = 0x7a6a50;  // wall dark
        const W3 = 0x9a8a70;  // wall light
        const FL = 0xb0a080;  // floor/ground
        const BK = 0x5a5a50;  // dark concrete

        const mat = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
        const box = (w, h, d, color, x, y, z) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
            m.position.set(x, y + h / 2, z);
            m.castShadow = m.receiveShadow = true;
            this.scene.add(m);
            const cx = x, cy = y + h / 2, cz = z;
            this.coverBoxes.push({
                min: new THREE.Vector3(cx - w/2, cy - h/2, cz - d/2),
                max: new THREE.Vector3(cx + w/2, cy + h/2, cz + d/2),
            });
            this.coverMeshes.push(m);
        };
        // Ceiling slab — visual only, no collision (players can't go on roof)
        const ceil = (w, d, color, x, y, z) => {
            const m = new THREE.Mesh(
                new THREE.BoxGeometry(w, 0.5, d),
                mat(color)
            );
            m.position.set(x, y, z);
            m.receiveShadow = true;
            this.scene.add(m);
        };

        // ── Ground ───────────────────────────────────────────────────────────
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(220, 220),
            new THREE.MeshLambertMaterial({ color: FL })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);

        // ════════════════════════════════════════════════════════════════════
        // OUTER BOUNDARY  (tall solid walls, height 14)
        // ════════════════════════════════════════════════════════════════════
        box(172, 14, 2,  W,   0,  0, -86);
        box(172, 14, 2,  W,   0,  0,  86);
        box(2,   14, 172, W, -86, 0,   0);
        box(2,   14, 172, W,  86, 0,   0);

        // ════════════════════════════════════════════════════════════════════
        // T-SPAWN  (top-left corner, open courtyard behind spawn wall)
        // ════════════════════════════════════════════════════════════════════
        // Spawn back wall
        box(36, 12, 2,  W2, -68, 0, -72);
        // Side walls forming courtyard
        box(2, 12, 24,  W2, -50, 0, -62);
        box(2, 12, 24,  W2, -84, 0, -62);
        // Spawn crates
        box(5, 4, 5,  W3, -60, 0, -68);
        box(5, 4, 5,  W3, -72, 0, -68);
        box(5, 2, 5,  W3, -66, 4, -68);  // stacked crate

        // ════════════════════════════════════════════════════════════════════
        // CT-SPAWN  (bottom-right corner)
        // ════════════════════════════════════════════════════════════════════
        box(36, 12, 2,  W2,  68, 0,  72);
        box(2, 12, 24,  W2,  50, 0,  62);
        box(2, 12, 24,  W2,  84, 0,  62);
        box(5, 4, 5,  W3,  60, 0,  68);
        box(5, 4, 5,  W3,  72, 0,  68);
        box(5, 2, 5,  W3,  66, 4,  68);

        // ════════════════════════════════════════════════════════════════════
        // LONG-A CORRIDOR  (right side, runs top→bottom along x=72)
        // Enclosed hallway with gap for choke entry to A-site
        // ════════════════════════════════════════════════════════════════════
        // Outer wall (already perimeter at x=86)
        // Inner wall — two segments leaving a 10-unit doorway at z=-20
        box(2, 12, 44,  W,  58, 0, -64);   // north segment
        box(2, 12, 22,  W,  58, 0, -11);   // south segment
        // Ceiling over corridor
        ceil(30, 44, BK, 72, 12, -64);
        ceil(30, 22, BK, 72, 12, -11);
        // A-site side — choke wall with corner cover
        box(2, 12, 10,  W2, 58, 0, 5);
        box(10, 12, 2,  W2, 63, 0, 0);

        // ════════════════════════════════════════════════════════════════════
        // A-SITE  (top-right quadrant, open bomb site)
        // ════════════════════════════════════════════════════════════════════
        // Site walls
        box(2, 12, 40,  W2,  40, 0, -60);   // left wall of site
        box(40, 12, 2,  W2,  60, 0, -42);   // back wall of site
        // Cover inside A-site
        box(8, 5, 8,   W3,  50, 0, -55);   // big A-box
        box(5, 3, 10,  W3,  55, 0, -50);   // side cover
        box(12, 2, 6,  W3,  48, 0, -62);   // low crate
        // Elevated platform (boost spot)
        box(10, 4, 8,  W2,  72, 0, -56);   // boost block
        box(10, 1, 8,  W3,  72, 4, -56);   // platform top
        // Connector from long-A into site
        box(2, 12, 10, W2,  40, 0, -42);

        // ════════════════════════════════════════════════════════════════════
        // SHORT-A / CATWALK  (top middle, diagonal shortcut to A-site)
        // ════════════════════════════════════════════════════════════════════
        // Catwalk walls
        box(2, 12, 36,  W2,  22, 0, -62);   // right catwalk wall
        box(2, 12, 36,  W2,  10, 0, -62);   // left catwalk wall
        ceil(14, 36, BK, 16, 12, -62);
        // Short-A choke wall
        box(14, 12, 2,  W2,  16, 0, -44);
        // Short-A platform / boost
        box(10, 5, 6,  W2,  16, 0, -52);

        // ════════════════════════════════════════════════════════════════════
        // MID  (centre of map — open area with catwalks and cover)
        // ════════════════════════════════════════════════════════════════════
        // Mid doors — two parallel walls with gap
        box(2, 12, 20,  W,  -6, 0,  0);
        box(2, 12, 20,  W,   6, 0,  0);
        // Mid boxes (iconic CS boxes)
        box(6, 6, 6,   W3,   0, 0,  -6);
        box(6, 6, 6,   W3,   0, 0,   6);
        box(6, 3, 6,   W3,   0, 6,  -6);   // stacked
        // Mid window room left
        box(2, 12, 16,  W2, -18, 0, -8);
        box(16, 12, 2,  W2, -10, 0, -16);
        box(16, 5, 2,   W3, -10, 7, -16);  // window opening top
        // Mid window room right
        box(2, 12, 16,  W2,  18, 0, -8);
        box(16, 12, 2,  W2,  10, 0, -16);
        box(16, 5, 2,   W3,  10, 7, -16);

        // ════════════════════════════════════════════════════════════════════
        // LONG-B CORRIDOR  (left side, runs along x=-72)
        // ════════════════════════════════════════════════════════════════════
        box(2, 12, 44,  W, -58, 0,  64);   // north segment
        box(2, 12, 22,  W, -58, 0,  11);   // south segment
        ceil(30, 44, BK, -72, 12, 64);
        ceil(30, 22, BK, -72, 12, 11);
        box(2, 12, 10,  W2, -58, 0, -5);
        box(10, 12, 2,  W2, -63, 0,  0);

        // ════════════════════════════════════════════════════════════════════
        // B-SITE  (bottom-left quadrant)
        // ════════════════════════════════════════════════════════════════════
        box(2, 12, 40,  W2, -40, 0,  60);
        box(40, 12, 2,  W2, -60, 0,  42);
        box(8, 5, 8,   W3, -50, 0,  55);
        box(5, 3, 10,  W3, -55, 0,  50);
        box(12, 2, 6,  W3, -48, 0,  62);
        box(10, 4, 8,  W2, -72, 0,  56);
        box(10, 1, 8,  W3, -72, 4,  56);
        box(2, 12, 10, W2, -40, 0,  42);

        // ════════════════════════════════════════════════════════════════════
        // B-TUNNEL / UNDERGROUND  (enclosed tunnel, bottom middle)
        // ════════════════════════════════════════════════════════════════════
        box(2, 12, 36,  W2, -22, 0,  62);
        box(2, 12, 36,  W2, -10, 0,  62);
        ceil(14, 36, BK, -16, 12, 62);
        box(14, 12, 2,  W2, -16, 0,  44);
        box(10, 5, 6,  W2, -16, 0,  52);

        // ════════════════════════════════════════════════════════════════════
        // INNER DIVIDER WALLS  (split map into halves, force routes)
        // ════════════════════════════════════════════════════════════════════
        // Horizontal mid divider (with gaps for passages)
        box(30, 12, 2,  W,  55, 0,  20);   // right of mid
        box(30, 12, 2,  W, -55, 0, -20);   // left of mid
        // Vertical mid divider
        box(2, 12, 30,  W,  20, 0,  50);
        box(2, 12, 30,  W, -20, 0, -50);

        // ════════════════════════════════════════════════════════════════════
        // COVER PROPS throughout  (barrels, crates)
        // ════════════════════════════════════════════════════════════════════
        // Mid area crates
        box(4, 4, 4,  W3,  30, 0,  30);
        box(4, 4, 4,  W3, -30, 0, -30);
        box(4, 4, 4,  W3,  30, 0, -30);
        box(4, 4, 4,  W3, -30, 0,  30);
        // Corridor barrels
        box(3, 4, 3,  W3,  75, 0, -30);
        box(3, 4, 3,  W3,  75, 0, -45);
        box(3, 4, 3,  W3, -75, 0,  30);
        box(3, 4, 3,  W3, -75, 0,  45);
        // A-site extra
        box(4, 3, 4,  W3,  45, 0, -70);
        box(4, 3, 4,  W3,  65, 0, -70);
        // B-site extra
        box(4, 3, 4,  W3, -45, 0,  70);
        box(4, 3, 4,  W3, -65, 0,  70);
    }

    // ─── Zone labels ─────────────────────────────────────────────────────────

    _addZoneLabel(text, x, y, z) {
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0.72)';
        ctx.beginPath(); ctx.roundRect(2, 2, 252, 60, 10); ctx.fill();
        ctx.strokeStyle = '#f90'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.roundRect(2, 2, 252, 60, 10); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 28px Arial';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, 128, 32);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false
        }));
        sprite.scale.set(8, 2, 1);
        sprite.position.set(x, y, z);
        this.scene.add(sprite);
    }

    _addZoneLabels() {
        // labels hidden
    }

    // ─── Humanoid factory (same as game.js) ───────────────────────────────────

    createBox(w, h, d, color) {
        const geo = new THREE.BoxGeometry(w, h, d);
        const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        return mesh;
    }

    createHumanoid(bodyColor, legsColor = 0x333344) {
        const group = new THREE.Group();

        const body = this.createBox(0.9, 1.6, 0.55, bodyColor);
        body.position.y = 1.6;
        group.add(body);

        const head = this.createBox(0.7, 0.7, 0.7, 0xDEB887);
        head.position.y = 2.75;
        group.add(head);

        const arms = [];
        for (const side of [-1, 1]) {
            const arm = this.createBox(0.32, 1.3, 0.32, bodyColor);
            arm.position.set(side * 0.62, 1.6, 0);
            group.add(arm);
            arms.push(arm);
        }

        const legs = [];
        for (const side of [-1, 1]) {
            const leg = this.createBox(0.35, 1.1, 0.35, legsColor);
            leg.position.set(side * 0.22, 0.55, 0);
            group.add(leg);
            legs.push(leg);
        }

        group._limbs    = { body, head, legs, arms, walkTimer: 0 };
        group._headMesh = head;
        return group;
    }

    // ─── Gun view-model ───────────────────────────────────────────────────────

    _createGun() {
        const g = new THREE.Group();

        const mk = (w, h, d, col) => {
            const m = new THREE.Mesh(
                new THREE.BoxGeometry(w, h, d),
                new THREE.MeshLambertMaterial({ color: col, flatShading: true })
            );
            return m;
        };

        // Receiver / body (main block)
        const body = mk(0.06, 0.06, 0.25, 0x2a2a2a);
        body.position.set(0, 0, 0);
        g.add(body);

        // Barrel (thin, extends forward)
        const barrel = mk(0.025, 0.025, 0.18, 0x1a1a1a);
        barrel.position.set(0, 0.018, -0.21);
        g.add(barrel);

        // Barrel tip (slightly wider — muzzle)
        const muzzle = mk(0.035, 0.035, 0.025, 0x111111);
        muzzle.position.set(0, 0.018, -0.305);
        g.add(muzzle);
        this.gun.muzzleMesh = muzzle;   // world position queried at shoot time

        // Grip (angled down-back)
        const grip = mk(0.05, 0.1, 0.045, 0x1a1a1a);
        grip.position.set(0, -0.07, 0.07);
        grip.rotation.x = 0.35;
        g.add(grip);

        // Trigger guard (thin horizontal bar)
        const guard = mk(0.01, 0.03, 0.06, 0x333333);
        guard.position.set(0, -0.04, 0.02);
        g.add(guard);

        // Magazine (box below body)
        const mag = mk(0.04, 0.08, 0.05, 0x222222);
        mag.position.set(0, -0.07, -0.02);
        g.add(mag);

        // Stock (back end)
        const stock = mk(0.05, 0.055, 0.08, 0x3a2a1a);
        stock.position.set(0, -0.008, 0.145);
        g.add(stock);

        // Scope / top rail (thin strip on top)
        const rail = mk(0.015, 0.012, 0.18, 0x444444);
        rail.position.set(0, 0.038, -0.04);
        g.add(rail);

        // Position the whole group in camera space (bottom-right)
        g.position.copy(this.gun.basePos);

        this.camera.add(g);
        this.gun.group = g;

        // Camera must be in the scene for camera-children (gun) to render
        this.scene.add(this.camera);
    }

    _updateGunBob(dt) {
        if (!this.gun.group) return;
        const g = this.gun.group;

        // ADS lerp — gun slides to center, FOV zooms in
        const targetPos = this.isAiming ? this.gun.adsPos : this.gun.basePos;
        const targetFov = this.isAiming ? 38 : 75;
        const lerpSpeed = dt * 14;
        g.position.lerp(targetPos, Math.min(1, lerpSpeed));
        this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, lerpSpeed);
        this.camera.updateProjectionMatrix();

        // Bob — suppressed while aiming
        const moving = this.keys['KeyW'] || this.keys['KeyS'] ||
                       this.keys['KeyA'] || this.keys['KeyD'] ||
                       this.touch.joystick.active;

        if (moving && this.player.onGround && !this.isAiming) {
            this.gun.bobTimer += dt * 9;
        } else {
            this.gun.bobTimer *= 0.85;
        }
        const bobY = Math.sin(this.gun.bobTimer) * 0.012;
        const bobX = Math.cos(this.gun.bobTimer * 0.5) * 0.006;

        // Kick recoil
        let kickZ = 0, kickY = 0;
        if (this.gun.kickTimer > 0) {
            this.gun.kickTimer -= dt;
            const t = Math.max(0, this.gun.kickTimer);
            kickZ = t * 0.12;
            kickY = t * 0.06;
        }

        g.position.x += bobX;
        g.position.y += bobY + kickY;
        g.position.z += kickZ;
    }

    // ─── Input ────────────────────────────────────────────────────────────────

    _setupInput() {
        document.addEventListener('keydown', e => { this.keys[e.code] = true; });
        document.addEventListener('keyup',   e => {
            this.keys[e.code] = false;
            if (e.code === 'Tab') document.getElementById('scoreboard').style.display = 'none';
        });
        document.addEventListener('keydown', e => {
            if (e.code === 'Tab') {
                e.preventDefault();
                this._updateScoreboard();
                document.getElementById('scoreboard').style.display = 'block';
            }
        });

        document.addEventListener('mousemove', e => {
            if (!this.isLocked) return;
            const sens = this.isAiming ? 0.0012 : 0.002;
            this.yaw   -= e.movementX * sens;
            this.pitch -= e.movementY * sens;
            this.pitch  = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.pitch));
        });

        document.addEventListener('mousedown', e => {
            if (!this.isLocked || !this.isRunning) return;
            if (e.button === 0) this.shoot();
            if (e.button === 2) this.isAiming = true;
        });

        document.addEventListener('mouseup', e => {
            if (e.button === 2) this.isAiming = false;
        });

        document.addEventListener('contextmenu', e => e.preventDefault());

        document.addEventListener('pointerlockchange', () => {
            this.isLocked = document.pointerLockElement === this.renderer.domElement;
            if (!this.isLocked && this.isRunning) {
                document.getElementById('blocker').style.display = 'flex';
            }
        });

        this.renderer.domElement.addEventListener('click', () => {
            if (!this.isRunning) return;
            this.renderer.domElement.requestPointerLock();
        });

        if (this.touch.mode) this._setupTouch();
    }

    _setupTouch() {
        const joystickArea  = document.getElementById('joystick-area');
        const lookArea      = document.getElementById('look-area');
        const shootBtn      = document.getElementById('shoot-btn');
        const jumpBtn       = document.getElementById('jump-btn');
        if (!joystickArea) return;

        let joystickOrigin = { x: 0, y: 0 };
        let joystickId     = null;

        joystickArea.addEventListener('touchstart', e => {
            const t = e.changedTouches[0];
            joystickId      = t.identifier;
            joystickOrigin  = { x: t.clientX, y: t.clientY };
            this.touch.joystick.active = true;
        });
        joystickArea.addEventListener('touchmove', e => {
            for (const t of e.changedTouches) {
                if (t.identifier !== joystickId) continue;
                const dx = (t.clientX - joystickOrigin.x) / 42;
                const dy = (t.clientY - joystickOrigin.y) / 42;
                const len = Math.sqrt(dx * dx + dy * dy);
                if (len > 1) {
                    this.touch.joystick.dx = dx / len;
                    this.touch.joystick.dy = dy / len;
                } else {
                    this.touch.joystick.dx = dx;
                    this.touch.joystick.dy = dy;
                }
            }
        }, { passive: true });
        joystickArea.addEventListener('touchend', e => {
            this.touch.joystick.active = false;
            this.touch.joystick.dx = 0;
            this.touch.joystick.dy = 0;
        });

        let lastTouch = null;
        lookArea.addEventListener('touchmove', e => {
            const t = e.changedTouches[0];
            if (lastTouch) {
                const sens = 0.005;
                this.yaw   -= (t.clientX - lastTouch.x) * sens;
                this.pitch -= (t.clientY - lastTouch.y) * sens;
                this.pitch  = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.pitch));
            }
            lastTouch = { x: t.clientX, y: t.clientY };
        }, { passive: true });
        lookArea.addEventListener('touchend', () => { lastTouch = null; });

        if (shootBtn) shootBtn.addEventListener('touchstart', e => { e.preventDefault(); if (this.isRunning) this.shoot(); });
        if (jumpBtn)  jumpBtn.addEventListener('touchstart',  e => { e.preventDefault(); this.keys['Space'] = true; });
        if (jumpBtn)  jumpBtn.addEventListener('touchend',    e => { this.keys['Space'] = false; });
    }

    // ─── Start game ───────────────────────────────────────────────────────────

    startGame() {
        const statusEl   = document.getElementById('mp-status');
        if (statusEl) statusEl.textContent = 'Connecting…';

        const codeInput   = document.getElementById('room-code-input');
        const enteredCode = codeInput ? codeInput.value.trim().replace(/\D/g, '').slice(0, 5) : '';
        const isJoin      = enteredCode.length === 5;

        let settled = false;
        const proceed = () => { if (settled) return; settled = true; this._proceedStart(); };

        try {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const host     = window.location.hostname || 'localhost';
            const ws       = new WebSocket(`${protocol}//${host}:8765`);
            const timeout  = setTimeout(() => { try { ws.close(); } catch (e) {} proceed(); }, 1500);

            ws.onopen = () => {
                clearTimeout(timeout);
                this.mp.ws      = ws;
                this.mp.enabled = true;
                this._setupWsHandlers(proceed);
                ws.send(JSON.stringify(isJoin ? { type: 'join', code: enteredCode } : { type: 'create' }));
            };
            ws.onerror = () => { clearTimeout(timeout); proceed(); };
        } catch (e) { proceed(); }
    }

    _proceedStart() {
        document.getElementById('blocker').style.display = 'none';
        document.getElementById('hud').style.display     = 'block';

        this.generateMap();
        this._addZoneLabels();
        this._createGun();
        this._spawnPlayer();
        this.isRunning = true;

        this._showMpHud();

        if (!this.touch.mode) {
            this.renderer.domElement.requestPointerLock();
        } else {
            document.getElementById('touch-controls').style.display = 'block';
            const el = document.documentElement;
            if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
        }
    }

    _spawnPlayer(near) {
        // Pick farthest spawn from all remote player positions
        let best = this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)];
        if (Object.keys(this.remotePlayers).length > 0) {
            let maxMin = -1;
            for (const sp of this.spawnPoints) {
                let minD = Infinity;
                for (const rp of Object.values(this.remotePlayers)) {
                    const d = sp.distanceTo(rp.mesh.position);
                    if (d < minD) minD = d;
                }
                if (minD > maxMin) { maxMin = minD; best = sp; }
            }
        }
        this.player.position.set(best.x, VoxelFPS.PLAYER_H, best.z);
        this.player.velocity.set(0, 0, 0);
        this.player.hp = 100;
        this._updateHpBar();

        // 5-second spawn immunity
        this.player.spawnImmune = true;
        clearTimeout(this._spawnImmuneTimer);
        this._spawnImmuneTimer = setTimeout(() => { this.player.spawnImmune = false; }, 5000);
    }

    // ─── WS handlers ──────────────────────────────────────────────────────────

    _setupWsHandlers(onReady) {
        const ws = this.mp.ws;

        ws.onmessage = (event) => {
            let data;
            try { data = JSON.parse(event.data); } catch (e) { return; }

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
                    this._showMessage(`Player ${data.playerId} joined!`);
                    break;

                case 'playerState':
                    if (this.isRunning) this._updateRemotePlayer(data.playerId, data.data);
                    break;

                case 'playerLeft':
                    this._removeRemotePlayer(data.playerId);
                    this._showMessage(`Player ${data.playerId} left.`);
                    break;

                case 'damaged': {
                    if (this.isRespawning || this.player.spawnImmune) break;
                    this.player.hp = Math.max(0, this.player.hp - data.damage);
                    this._updateHpBar();
                    const msg = data.headshot
                        ? `Headshot by P${data.fromId}! -${data.damage}`
                        : `Hit by P${data.fromId}! -${data.damage}`;
                    this._showMessage(msg);
                    if (this.player.hp <= 0) this._die(data.fromId);
                    break;
                }

                case 'killed': {
                    const kName = data.killerId === this.mp.playerId ? 'You' : `P${data.killerId}`;
                    const vName = data.victimId === this.mp.playerId ? 'You' : `P${data.victimId}`;
                    this._addKillFeedEntry(`${kName} ⚔ ${vName}`);
                    // Update kill count for local player
                    const rk = this.remotePlayers[data.killerId];
                    if (rk) rk.kills = (rk.kills || 0) + 1;
                    if (data.killerId === this.mp.playerId) {
                        this.player.kills++;
                        this._updateHud();
                    }
                    // Check win condition
                    if (data.killerId === this.mp.playerId && this.player.kills >= VoxelFPS.KILLS_TO_WIN) {
                        this._showWin();
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
            if (this.isRunning) this._showMessage('Disconnected from server.');
        };
    }

    _showMpHud() {
        const el = document.getElementById('room-code-display');
        if (el && this.mp.roomCode) el.textContent = this.mp.roomCode;
        const pn = document.getElementById('player-num');
        if (pn && this.mp.playerId) pn.textContent = this.mp.playerId;
        const hud = document.getElementById('mp-hud');
        if (hud) hud.style.display = '';
    }

    _syncMpState(dt) {
        if (!this.mp.enabled || !this.mp.ws || this.mp.ws.readyState !== WebSocket.OPEN) return;
        this.mp.syncTimer += dt;
        if (this.mp.syncTimer < 0.05) return;
        this.mp.syncTimer = 0;
        this.mp.ws.send(JSON.stringify({
            type: 'state',
            data: {
                x:      parseFloat(this.player.position.x.toFixed(3)),
                y:      parseFloat(this.player.position.y.toFixed(3)),
                z:      parseFloat(this.player.position.z.toFixed(3)),
                yaw:    parseFloat(this.yaw.toFixed(4)),
                hp:     this.player.hp,
                kills:  this.player.kills,
                deaths: this.player.deaths,
            }
        }));
    }

    // ─── Remote players ───────────────────────────────────────────────────────

    _createRemotePlayer(id) {
        if (this.remotePlayers[id]) return;
        const color = VoxelFPS.PALETTE[id] || 0xFFAA00;
        const mesh  = this.createHumanoid(color);
        mesh.position.set(0, 0, 0);
        this.scene.add(mesh);

        // Label sprite (same technique as game.js _createRemotePlayer)
        const canvas = document.createElement('canvas');
        canvas.width = 128; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0.80)';
        ctx.beginPath(); ctx.roundRect(2, 2, 124, 60, 10); ctx.fill();
        ctx.strokeStyle = '#f90'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.roundRect(2, 2, 124, 60, 10); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 38px Arial'; ctx.textAlign = 'center';
        ctx.fillText('P' + id, 64, 46);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false
        }));
        sprite.scale.set(3.2, 1.6, 1);
        sprite.position.set(0, 4.8, 0);
        mesh.add(sprite);

        // HP bar sprite above label
        const hpCanvas = document.createElement('canvas');
        hpCanvas.width = 128; hpCanvas.height = 16;
        const hpCtx = hpCanvas.getContext('2d');
        hpCtx.fillStyle = '#333'; hpCtx.fillRect(0, 0, 128, 16);
        hpCtx.fillStyle = '#2ecc40'; hpCtx.fillRect(2, 2, 124, 12);
        const hpTex  = new THREE.CanvasTexture(hpCanvas);
        const hpBar  = new THREE.Sprite(new THREE.SpriteMaterial({ map: hpTex, transparent: true, depthTest: false }));
        hpBar.scale.set(3.2, 0.55, 1);
        hpBar.position.set(0, 6.1, 0);
        mesh.add(hpBar);

        this.remotePlayers[id] = { mesh, hp: 100, kills: 0, deaths: 0, hpCanvas, hpCtx, hpTex, hpBar };
    }

    _updateRemotePlayer(id, state) {
        if (!this.remotePlayers[id]) this._createRemotePlayer(id);
        const rp = this.remotePlayers[id];
        rp.mesh.position.set(state.x, 0, state.z);
        rp.mesh.rotation.y = (state.yaw || 0) + Math.PI;
        if (state.hp !== undefined && state.hp !== rp.hp) {
            rp.hp = state.hp;
            this._updateRemoteHpBar(rp);
        }
        if (state.kills  !== undefined) rp.kills  = state.kills;
        if (state.deaths !== undefined) rp.deaths = state.deaths;

        // Instantly hide dead players
        if (rp.hp <= 0) {
            rp.mesh.visible = false;
            return;
        }

        // Occlusion: hide if a cover box is between camera and this player
        const camPos    = this.camera.position;
        const playerTop = rp.mesh.position.clone().add(new THREE.Vector3(0, 1.7, 0));
        const dir       = playerTop.clone().sub(camPos).normalize();
        const dist      = camPos.distanceTo(playerTop);
        this.occRaycaster.set(camPos, dir);
        this.occRaycaster.far = dist - 0.3;
        const blocked = this.occRaycaster.intersectObjects(this.coverMeshes, false);
        rp.mesh.visible = blocked.length === 0;
    }

    _updateRemoteHpBar(rp) {
        const pct = Math.max(0, rp.hp) / 100;
        const ctx = rp.hpCtx;
        ctx.clearRect(0, 0, 128, 16);
        ctx.fillStyle = '#333'; ctx.fillRect(0, 0, 128, 16);
        ctx.fillStyle = pct > 0.5 ? '#2ecc40' : pct > 0.25 ? '#ffdc00' : '#ff4136';
        ctx.fillRect(2, 2, Math.round(124 * pct), 12);
        rp.hpTex.needsUpdate = true;
    }

    _removeRemotePlayer(id) {
        const rp = this.remotePlayers[id];
        if (!rp) return;
        this.scene.remove(rp.mesh);
        delete this.remotePlayers[id];
    }

    // ─── Player update ────────────────────────────────────────────────────────

    updatePlayer(dt) {
        if (!this.isLocked && !this.touch.mode) return;
        if (!this.isRunning || this.isRespawning) return;

        // Camera rotation
        this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));

        // Facing direction (horizontal only)
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw, 0));
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        const right   = new THREE.Vector3(1, 0,  0).applyQuaternion(q);

        const isSprinting = this.keys['ShiftLeft'] || this.keys['ShiftRight'] || this.touch.sprint;
        const speed = isSprinting ? VoxelFPS.SPRINT_SPEED : VoxelFPS.SPEED;

        const moveDir = new THREE.Vector3();
        if (this.keys['KeyW']) moveDir.add(forward);
        if (this.keys['KeyS']) moveDir.sub(forward);
        if (this.keys['KeyD']) moveDir.add(right);
        if (this.keys['KeyA']) moveDir.sub(right);
        if (this.touch.joystick.active) {
            moveDir.addScaledVector(forward, -this.touch.joystick.dy);
            moveDir.addScaledVector(right,    this.touch.joystick.dx);
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
        if ((this.keys['Space']) && this.player.onGround) {
            this.player.velocity.y = VoxelFPS.JUMP_FORCE;
            this.player.onGround = false;
        }

        // Gravity
        this.player.velocity.y += VoxelFPS.GRAVITY * dt;

        // Move
        const pos = this.player.position;
        pos.x += this.player.velocity.x * dt;
        pos.z += this.player.velocity.z * dt;
        pos.y += this.player.velocity.y * dt;

        // Ground
        if (pos.y <= VoxelFPS.PLAYER_H) {
            pos.y = VoxelFPS.PLAYER_H;
            this.player.velocity.y = 0;
            this.player.onGround = true;
        }

        // Map boundary clamp
        const L = VoxelFPS.MAP_LIMIT - 0.5;
        pos.x = Math.max(-L, Math.min(L, pos.x));
        pos.z = Math.max(-L, Math.min(L, pos.z));

        // Cover block collision (AABB) — top-surface first, then horizontal push-out
        const r = 0.4;
        const playerFeet = pos.y - VoxelFPS.PLAYER_H;
        const playerHead = pos.y;

        for (const box of this.coverBoxes) {
            const cx = (box.min.x + box.max.x) / 2;
            const cz = (box.min.z + box.max.z) / 2;
            const hw = (box.max.x - box.min.x) / 2 + r;
            const hd = (box.max.z - box.min.z) / 2 + r;
            const dx = pos.x - cx;
            const dz = pos.z - cz;

            // skip if not overlapping in XZ
            if (Math.abs(dx) >= hw || Math.abs(dz) >= hd) continue;

            const topY    = box.max.y;
            const bottomY = box.min.y;

            // ── Stand on top ── (falling and feet just above/at top surface)
            if (this.player.velocity.y <= 0 && playerFeet < topY + 0.5 && playerFeet > topY - 1.5) {
                pos.y = topY + VoxelFPS.PLAYER_H;
                this.player.velocity.y = 0;
                this.player.onGround = true;
                continue;
            }

            // ── Head bump ── (jumping up and head hits underside)
            if (this.player.velocity.y > 0 && playerHead > bottomY && playerFeet < bottomY) {
                pos.y = bottomY - 0.05;
                this.player.velocity.y = 0;
                continue;
            }

            // ── Horizontal push-out ── (overlapping body height)
            if (playerFeet < topY - 0.1 && playerHead > bottomY) {
                if (Math.abs(dx) / hw < Math.abs(dz) / hd) {
                    pos.z = cz + (dz > 0 ? hd : -hd);
                    this.player.velocity.z = 0;
                } else {
                    pos.x = cx + (dx > 0 ? hw : -hw);
                    this.player.velocity.x = 0;
                }
            }
        }

        // Camera follows player
        this.camera.position.set(pos.x, pos.y + 0.6, pos.z);
    }

    // ─── Shooting ─────────────────────────────────────────────────────────────

    shoot() {
        if (this.shootCooldown > 0 || !this.isRunning || this.isRespawning) return;
        this.shootCooldown = 0.3;
        this.gun.kickTimer = 0.12;   // trigger recoil animation

        // Play shoot sound
        if (this.shootSound) {
            this.shootSound.currentTime = 0;
            this.shootSound.play().catch(() => {});
        }

        // Hitscan ray from screen center (accurate FPS aiming)
        this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);

        // Muzzle world position — trail/flash origin
        const muzzlePos = new THREE.Vector3();
        if (this.gun.muzzleMesh) {
            this.gun.muzzleMesh.getWorldPosition(muzzlePos);
        } else {
            muzzlePos.copy(this.camera.position);
        }

        // Collect all hittable meshes
        const hittable = [];
        for (const [rid, rp] of Object.entries(this.remotePlayers)) {
            if (rp.hp <= 0) continue;   // skip dead/invisible players
            rp.mesh.traverse(child => {
                if (child.isMesh) {
                    child.userData._rpId   = Number(rid);
                    child.userData._isHead = child === rp.mesh._headMesh;
                    hittable.push(child);
                }
            });
        }
        hittable.push(...this.coverMeshes);

        const hits = this.raycaster.intersectObjects(hittable, false);
        if (hits.length > 0) {
            const hit = hits[0];
            this._spawnBulletTrail(muzzlePos, hit.point);

            const rpId = hit.object.userData._rpId;
            if (rpId !== undefined) {
                const isHead = !!hit.object.userData._isHead;
                const damage = isHead ? 60 : 10;

                const rp = this.remotePlayers[rpId];
                if (rp) {
                    rp.hp = Math.max(0, rp.hp - damage);
                    this._updateRemoteHpBar(rp);
                }

                if (this.mp.enabled && this.mp.ws?.readyState === WebSocket.OPEN) {
                    this.mp.ws.send(JSON.stringify({
                        type: 'hit', targetId: rpId, damage, headshot: isHead
                    }));
                }

                if (rp && rp.hp <= 0) {
                    rp.mesh.visible = false;   // instant disappear
                    rp.hp = 100;
                    if (this.mp.enabled && this.mp.ws?.readyState === WebSocket.OPEN) {
                        this.mp.ws.send(JSON.stringify({ type: 'killed', victimId: rpId }));
                    }
                }
            }
        } else {
            // Missed — trail extends 60 units along aim direction from muzzle
            this._spawnBulletTrail(muzzlePos,
                muzzlePos.clone().addScaledVector(this.raycaster.ray.direction, 60));
        }

        this._spawnMuzzleFlash(muzzlePos);
    }

    _spawnBulletTrail(from, to) {
        const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
        const mat = new THREE.LineBasicMaterial({ color: 0xffff88, transparent: true, opacity: 0.8 });
        const line = new THREE.Line(geo, mat);
        this.scene.add(line);
        setTimeout(() => this.scene.remove(line), 150);
    }

    _spawnMuzzleFlash(muzzlePos) {
        const flash = new THREE.Mesh(
            new THREE.SphereGeometry(0.03, 5, 5),
            new THREE.MeshBasicMaterial({ color: 0xffffaa })
        );
        flash.position.copy(muzzlePos);
        this.scene.add(flash);
        setTimeout(() => this.scene.remove(flash), 60);
    }

    // ─── Death & respawn ──────────────────────────────────────────────────────

    _die(killerId) {
        this.isRespawning = true;
        this.player.deaths++;
        this._updateHud();

        if (this.mp.enabled && this.mp.ws?.readyState === WebSocket.OPEN) {
            this.mp.ws.send(JSON.stringify({ type: 'killed', victimId: this.mp.playerId }));
        }

        const overlay = document.getElementById('death-overlay');
        const timer   = document.getElementById('respawn-timer');
        if (overlay) overlay.style.display = 'flex';

        let countdown = VoxelFPS.RESPAWN_SECS;
        if (timer) timer.textContent = countdown;

        const iv = setInterval(() => {
            countdown--;
            if (timer) timer.textContent = countdown;
            if (countdown <= 0) {
                clearInterval(iv);
                if (overlay) overlay.style.display = 'none';
                this._spawnPlayer();
                this.isRespawning = false;
                if (!this.touch.mode && !this.isLocked) {
                    this.renderer.domElement.requestPointerLock();
                }
            }
        }, 1000);
    }

    _showWin() {
        document.getElementById('win-screen').style.display = 'flex';
        document.getElementById('win-kills').textContent = this.player.kills;
    }

    // ─── HUD helpers ──────────────────────────────────────────────────────────

    _updateHpBar() {
        const bar = document.getElementById('hp-fill');
        const txt = document.getElementById('hp-text');
        if (!bar) return;
        const pct = Math.max(0, this.player.hp) / 100;
        bar.style.width = (pct * 100) + '%';
        bar.style.background = pct > 0.5 ? '#2ecc40' : pct > 0.25 ? '#ffdc00' : '#ff4136';
        if (txt) txt.textContent = Math.round(this.player.hp);
    }

    _updateHud() {
        const kd = document.getElementById('kd-display');
        if (kd) kd.textContent = `K:${this.player.kills}  D:${this.player.deaths}`;
    }

    _showMessage(text) {
        const el = document.getElementById('message');
        if (!el) return;
        el.textContent = text;
        el.style.opacity = '1';
        clearTimeout(this._msgTimeout);
        this._msgTimeout = setTimeout(() => { el.style.opacity = '0'; }, 2500);
    }

    _addKillFeedEntry(text) {
        this.killFeed.push({ text, born: Date.now() });
        if (this.killFeed.length > 5) this.killFeed.shift();
        this._renderKillFeed();
    }

    _renderKillFeed() {
        const el = document.getElementById('kill-feed');
        if (!el) return;
        el.innerHTML = this.killFeed
            .filter(e => Date.now() - e.born < 4000)
            .map(e => `<div class="kf-entry">${e.text}</div>`)
            .join('');
    }

    _updateScoreboard() {
        const tbody = document.getElementById('score-tbody');
        if (!tbody) return;
        const rows = [];

        // Local player
        rows.push({ id: this.mp.playerId || '?', kills: this.player.kills, deaths: this.player.deaths, isMe: true });

        // Remote players
        for (const [id, rp] of Object.entries(this.remotePlayers)) {
            rows.push({ id, kills: rp.kills || 0, deaths: rp.deaths || 0, isMe: false });
        }

        rows.sort((a, b) => b.kills - a.kills);
        tbody.innerHTML = rows.map(r =>
            `<tr${r.isMe ? ' class="me"' : ''}>
                <td>P${r.id}${r.isMe ? ' (you)' : ''}</td>
                <td>${r.kills}</td>
                <td>${r.deaths}</td>
            </tr>`
        ).join('');
    }

    // ─── Remote player walk animation ─────────────────────────────────────────

    _animateRemotePlayers(dt) {
        for (const rp of Object.values(this.remotePlayers)) {
            if (!rp.mesh._limbs) continue;
            const limbs = rp.mesh._limbs;
            limbs.walkTimer += dt * 6;
            const sw = Math.sin(limbs.walkTimer);
            if (limbs.legs[0]) limbs.legs[0].rotation.x =  sw * 0.5;
            if (limbs.legs[1]) limbs.legs[1].rotation.x = -sw * 0.5;
            if (limbs.arms[0]) limbs.arms[0].rotation.x = -sw * 0.4;
            if (limbs.arms[1]) limbs.arms[1].rotation.x =  sw * 0.4;
        }
    }

    // ─── Main loop ────────────────────────────────────────────────────────────

    animate() {
        requestAnimationFrame(() => this.animate());

        if (!this.isRunning) {
            if (this.renderer && this.scene && this.camera) {
                this.renderer.render(this.scene, this.camera);
            }
            return;
        }

        const dt = Math.min(this.clock.getDelta(), 0.05);

        this.shootCooldown = Math.max(0, this.shootCooldown - dt);

        this.updatePlayer(dt);
        this._updateGunBob(dt);
        this._animateRemotePlayers(dt);
        this._syncMpState(dt);
        this._renderKillFeed();
        this._updateHud();

        this.renderer.render(this.scene, this.camera);
    }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const game = new VoxelFPS();
game.init();
