# Pumpkin Collector — Game Context & Development Reference

> **Purpose**: This file is the single source of truth for all future development and enhancements of the Pumpkin Collector game. Keep it updated as new features are added.

---

## Project Overview

**Title**: Pumpkin Collector — Minecraft Style Adventure  
**Genre**: First-person 3D browser game  
**Engine**: Three.js r128 (CDN)  
**Language**: Vanilla JavaScript (single class, no bundler)  
**Entry point**: `index.html` → loads `game.js` as a `<script>` tag  
**Multiplayer server**: `ws_server.js` (Node.js, WebSocket, port 8765)

### Core Game Loop
Collect pumpkins scattered across a procedurally generated world, steal them from guards, defend villagers from predators, sell pumpkins for coins, and upgrade weapons — all in real-time 3D.

---

## File Structure

```
pumpkin-collector-claude/
├── index.html              # UI shell: HUD, shop, blocker, touch controls, CSS
├── game.js                 # All game logic — 3094 lines, single class
├── ws_server.js            # Multiplayer WebSocket server (Node.js, 111 lines)
├── background-score.mp3    # Background music (looped, 0.3 volume)
├── leopard-attack.mp3      # Predator attack SFX
├── pistal-shoot.mp3        # Pistol SFX
├── rifle-gunshot.mp3       # All non-pistol guns SFX
├── walking-sound.mp3       # Looped footstep SFX
├── package.json            # npm: requires "ws"
└── CLAUDE.md               # Problem-solving rules for AI assistant
```

---

## Architecture

### Main Class: `PumpkinCollectorGame`

The **entire game** lives in a single ES6 class instantiated as the global `const game = new PumpkinCollectorGame()` at the bottom of `game.js`. There is no module system, bundler, or framework.

#### Constructor State (`this.*`)

| Property | Type | Purpose |
|---|---|---|
| `scene` | THREE.Scene | Three.js scene graph |
| `camera` | THREE.PerspectiveCamera | FPS camera (FOV 75) |
| `renderer` | THREE.WebGLRenderer | Shadow-enabled renderer |
| `clock` | THREE.Clock | Frame delta timing |
| `noise` | SimplexNoise | Terrain generation (seed 42) |
| `weaponDefs` | Array[5] | Weapon definitions (see Weapons section) |
| `sfx` | Object | Audio elements (pistol, rifle, walking, leopard, bgScore) |
| `difficultyProfiles` | Object | easy / normal / hard configs |
| `difficulty` | String | Active difficulty key |
| `activeDifficulty` | Object | Active difficulty config object |
| `player` | Object | All player state (see Player State section) |
| `bullets` | Array | Active projectile meshes + metadata |
| `worldSize` | 200 | Half-size of world in units |
| `chunkSize` | 16 | Unused (reserved) |
| `terrainResolution` | 1 | Segment density of terrain geometry |
| `keys` | Object | Keyboard state map (e.code → bool) |
| `yaw` / `pitch` | Number | Camera rotation (radians) |
| `isLocked` | Bool | Pointer lock active |
| `terrainMesh` | Mesh | The single terrain plane mesh |
| `heightMap` | Array | Unused (height computed per-frame via noise) |
| `biomeMap` | Array | Unused |
| `pumpkins` | Array | Active pumpkin group objects |
| `guards` | Array | Guard group objects |
| `animals` | Array | Animals (rabbit, goat, cow) |
| `predators` | Array | Wolf-like predator groups |
| `villagers` | Array | Villager groups |
| `predatorAttackArrows` | Map | villager/guard → ArrowHelper (danger indicators) |
| `particles` | Array | Collection burst particles |
| `trees` | Array | Tree group objects |
| `huts` | Array | Hut objects `{ group, position }` |
| `fields` | Array | Farm field groups |
| `herbs` | Array | Medicinal herb groups |
| `mp` | Object | Multiplayer state (see Multiplayer section) |
| `shopOpen` | Bool | Shop panel visibility |
| `isRunning` | Bool | Game active flag |
| `gravity` | -25 | Gravity constant |
| `touch` | Object | Touch/mobile input state |

---

## Terrain System

### Height Generation (`getHeight(x, z)`)
- Uses `SimplexNoise` (seed 42), seeded Lehmer RNG
- **70% of world is plains** (`flatness < 0.4`) — gentle rolling, max ~2 units height
- **30% is varied** (hills, mountains, water valleys) up to ~40 units
- `flatness` determined by noise at scale `0.005`

### Biomes (`getBiome(x, z)`)
| Biome | Condition | Terrain Color |
|---|---|---|
| `water` | height < -5 | Blue-grey |
| `mountain` | flatness ≥ 0.4 AND h > 18 | Stone / snow (h > 28) |
| `forest` | moisture > 0.2 (plains) or 0.3 (hills) | Dark green |
| `field` | moisture < -0.3 (plains) or -0.2 | Sandy yellow |
| `plains` | flatness < 0.4, neutral moisture | Bright green |
| `grassland` | Transition zone | Medium green |

- Moisture noise at scale `0.01` (offset +500)
- Colors applied as vertex colors with `flatShading: true`

### Water
- Flat plane at `y = -5`, `color: 0x3366aa`, opacity 0.7
- Player treated as at water level if below `y = -5 + height`, preventing sinking

---

## World Generation (`generateWorld()`)

Called once at game start. Order matters:

1. `generateTerrain()` — PlaneGeometry with per-vertex heightmap + biome colors
2. `generateWater()` — Single flat plane at y=-5
3. `generateTrees()` — 400 attempts, spawns in forest / some in grassland / rare in plains
4. `generateHuts()` — 15 huts, minimum 20 units apart, not in water/mountain
5. `generateFields()` — 10 fields, in field/grassland biomes
6. `spawnGuards()` — Count from `activeDifficulty.guardCount`
7. `spawnPumpkins()` — Count from `activeDifficulty.initialPumpkinCount`
8. `spawnAnimals()` — 35 animals (ratio: 3 rabbits : 2 goats : 2 cows)
9. `spawnPredators()` — Count from `activeDifficulty.predatorCount`
10. `spawnVillagers()` — 15 villagers, not in water/mountain
11. `spawnHerbs()` — 20 medicinal herbs

---

## Difficulty System

```javascript
this.difficultyProfiles = {
    easy:   { guardCount:8,  predatorCount:5,  initialPumpkinCount:46, pumpkinRespawnDelayMs:20000, guardDetectionMultiplier:0.8,  guardChaseMultiplier:0.85, guardSpotPenalty:1, guardHitPenalty:3,  guardCatchHpLoss:10, predatorDamageMultiplier:0.8  },
    normal: { guardCount:12, predatorCount:8,  initialPumpkinCount:35, pumpkinRespawnDelayMs:30000, guardDetectionMultiplier:1,    guardChaseMultiplier:1,    guardSpotPenalty:2, guardHitPenalty:5,  guardCatchHpLoss:15, predatorDamageMultiplier:1    },
    hard:   { guardCount:16, predatorCount:12, initialPumpkinCount:26, pumpkinRespawnDelayMs:42000, guardDetectionMultiplier:1.2,  guardChaseMultiplier:1.2,  guardSpotPenalty:3, guardHitPenalty:7,  guardCatchHpLoss:22, predatorDamageMultiplier:1.35 }
};
```

- Selected before `startGame()` via difficulty buttons (`.difficulty-btn[data-difficulty]`)
- Applied at `_proceedGameStart()` to `this.activeDifficulty`

---

## Player State

```javascript
this.player = {
    position: THREE.Vector3,    // World position (starts at terrain + 3)
    velocity: THREE.Vector3,    // Current velocity
    onGround: Boolean,          // Terrain contact flag
    hp: 100, maxHp: 100,
    pumpkins: 0,                // Carried pumpkins
    coins: 0,                   // Shop currency
    totalCoinsEarned: 0,        // Game-over display stat
    currentWeapon: 1,           // Index into weaponDefs (0-4)
    weaponLevel: 1,             // Sword upgrade level (affects melee damage + range)
    weaponRange: 40,            // Updated on weapon switch
    speed: 8,                   // Walk speed
    sprintSpeed: 14,            // Sprint speed (Shift or touch sprint)
    jumpForce: 12,
    isSprinting / isAttacking / isShooting: Boolean,
    attackCooldown: 0,          // Seconds remaining
    height: 1.7,                // Player eye height
    radius: 0.4,                // Collision cylinder radius
    walkBob: 0                  // Head-bob timer accumulator
};
```

### Player Physics
- Gravity: `-25` units/s²
- deltaTime capped at `0.05` to prevent tunneling
- Terrain collision: player Y snapped to `max(terrainH, -5) + height`
- Cylinder push-out against: trees (r=0.6), huts (r=3.0), guards (r=0.6), villagers (r=0.5), predators (r=0.7)
- World bounds: `±(worldSize - 5)` = ±195
- Slow HP regen: `+0.5 HP/s` when below max

### Camera / Look
- `yaw` (Y-axis), `pitch` (X-axis) — both updated from mouse or touch
- Applied via `THREE.Euler(pitch, yaw, 0, 'YXZ')`
- Pointer lock on desktop; right-half touch area on mobile
- Head bob: ±0.05 units walk, ±0.08 sprint

---

## Weapons System

### `this.weaponDefs` Array

| ID | Key | Name | Type | Damage | Range | Cooldown | Cost |
|---|---|---|---|---|---|---|---|
| 0 | `Digit0` | Sword | melee | 15 + level×3 | 3 + level×0.5 | 0.5s | Free |
| 1 | `Digit1` | Pistol | gun | 12 | 40 | 0.4s | Free |
| 2 | `Digit2` | Shotgun | gun | 8 (×5 pellets) | 20 | 0.8s | 30c |
| 3 | `Digit3` | Rifle | gun | 25 | 80 | 0.7s | 60c |
| 4 | `Digit4` | Sniper | gun | 50 | 150 | 1.5s | 100c |

- **Pistol** uses `pistal-shoot.mp3`; all other guns use `rifle-gunshot.mp3`
- Shotgun fires 5 pellets simultaneously with `spread: 0.1`
- Bullets: yellow sphere (`SphereGeometry 0.06r`, `MeshBasicMaterial 0xFFFF00`)
- Muzzle flash: yellow sphere on camera at `(0.25, -0.15, -0.8)`, lasts 60ms

### Weapon Visuals (`buildXxxVisual()`)
Each weapon is a `THREE.Group` attached to `this.camera`. They all have a `userData.basePos` for bob reference.

- `buildSwordVisual()` — blade length grows with `weaponLevel`
- `buildPistolVisual()`, `buildShotgunVisual()`, `buildRifleVisual()`, `buildSniperVisual()`
- Rebuilt via `rebuildWeaponVisual()` whenever weapon switches
- Sword animates with rotation on attack; guns animate recoil on shoot

### Combat Penalties
- **Hit guard** (melee or bullet): `-guardHitPenalty` pumpkins, guard goes alert for 12s
- **Caught by guard**: `-guardSpotPenalty` pumpkins, `-guardCatchHpLoss` HP, knocked back
- **Hit predator**: HP damage; on death → 30s respawn timer

---

## Entity System

All entities are `THREE.Group` objects created by builder methods and stored in arrays. They use `mesh.userData` for state and `mesh._limbs` for animation.

### Entity Builders

| Builder | Entity | Storage | userData key fields |
|---|---|---|---|
| `createGuard(x,z)` | Guard NPC | `this.guards` | alertLevel, patrolCenter/Radius/Angle/Speed, chaseSpeed, detectionRange, pumpkinsToSteal, hp/maxHp |
| `createPredator(x,z)` | Wolf | `this.predators` | hp/maxHp, damage, speed, aggroRange, attackRange, state, target, huntingVillager, huntingGuard |
| `createVillager(x,z)` | Villager | `this.villagers` | hp/maxHp, wanderTarget, speed, fleeSpeed, beingAttacked, attacker, saved |
| `createAnimal(x,z,type)` | Rabbit/Goat/Cow | `this.animals` | animalType, wanderTarget, speed, fleeSpeed, fleeing, fleeTimer |
| `createPumpkin(x,z)` | Collectible | `this.pumpkins` | collected (bool) |
| `createHerb(x,z)` | Medicinal herb | `this.herbs` | collected (bool) |
| `createTree(x,z)` | Decoration | `this.trees` | — |
| `createHut(x,z)` | Structure | `this.huts` | Returns `{ group, position }` |
| `createField(x,z)` | Farm | `this.fields` | — |

### Shared Humanoid Builder (`createHumanoid(colors, headColor)`)
Returns a group with:
- Body (1.2H), Head (0.6 cube at y=2.1), 2 Arms, 2 Legs
- `group._limbs = { body, legs, arms, walkTimer }` for walk-cycle animation
- Used by: guard, villager, remote players

### Guard Colors
- Guard body: `0x444488`, legs: `0x333366`; helmet `0x888888`, spear visible
- Carries pumpkin crate decal (`0x8B7355`)

### Guard AI (`updateGuards(dt)`)
Three-state FSM stored in `userData.alertLevel`:

| alertLevel | State | Behavior |
|---|---|---|
| 0 | Patrol | Circular patrol around `patrolCenter`, radius 5-10u, speed 1.5 |
| 1 | Suspicious | Face player, escalate to chase if player too close |
| 2 | Alerted/Chase | Chase player at `chaseSpeed`; times out after `stateTimer` secs or if player > 35u away |

Guards are **only alerted** when:
1. Player collects pumpkin in their FoV (dot > 0.3) within `detectionRange`
2. Player tries to steal from guard and is facing-side caught
3. Player hits guard with a weapon

### Predator AI (`updatePredators(dt)`)
Three states: `roaming`, `hunting`, `attacking`

**Forced attack schedule**: timer fires every 25-40s, picks a random target (villager, guard, or player) within 60u AND a nearby predator attacker. One hunt at a time.

**Priority logic** (evaluated each frame):
1. Player within `aggroRange × 0.7` → always hunt player
2. Already hunting committed target → continue unless give-up range exceeded
3. Nearest villager / guard within `aggroRange` → switch to hunt
4. Otherwise → roam

**Attack**: On reaching target within `attackRange` (2u), 1.5s cooldown, plays leopard SFX. Deals `damage × predatorDamageMultiplier` to target. Kills villagers/guards removing them from arrays; guards killed by predators permanently reduce guard count.

**Player saves**:  
- Killing predator hunting villager → +5 pumpkins, `villager.userData.saved = true`
- Killing predator hunting guard → +8 pumpkins

**Danger Compass HUD**: Live `#danger-compass` div showing directional arrows to threatened villagers/guards with urgency color (🔴🟡🟢) and estimated seconds until attack.

**Attack Arrows**: `THREE.ArrowHelper` objects pointing downward (red for villager, orange for guard) bob above targets being hunted. Cleaned up when no longer hunted.

### Predator Respawn
Defeated predators respawn after 30s at a random world position.

---

## Pumpkin System

### Spawning
- `spawnSinglePumpkin(minGuardDist=20, minPumpkinDist=14, maxAttempts=80)`
- Validates: not too close to any guard, not clustered with other pumpkins
- `spawnPumpkins()` calls this `initialPumpkinCount` times at start

### Collection (`interact()`)
Range: 4 units. Checks in order:
1. **Herbs** → +20 HP, herb removed and respawns after 60s
2. **Wild pumpkins** → +1 pumpkin, guard alert check, respawn after `pumpkinRespawnDelayMs`
3. **Guard steal** (from behind: dot < 0.3) → +`pumpkinsToSteal` (8), guard refills after 30s
   - Caught stealing (front: dot ≥ 0.3) → -3 pumpkins, guard alerted

### Bob Animation
Pumpkins and herbs bob with `Math.sin(Date.now() * 0.003 + p.position.x) * 0.15` and slow `rotation.y` spin every frame.

---

## Shop System

Opened with `B` key or touch shop button. Pauses pointer lock.

| Item | Action | Cost |
|---|---|---|
| Sell Pumpkins | `sellPumpkins()` | Earn `pumpkins × 5` coins |
| Upgrade Sword Range | `upgradeWeapon()` | `weaponLevel × 20` coins; increments `weaponLevel` |
| Shotgun | `buyGun(2)` | 30 coins |
| Rifle | `buyGun(3)` | 60 coins |
| Sniper | `buyGun(4)` | 100 coins |
| Health Potion | `buyHealthPotion()` | 15 coins; restores full HP |

Guns set `weaponDef.owned = true` permanently in the session (not persisted).

---

## Multiplayer System

Optional feature. Attempts WebSocket connection to `ws://localhost:8765` on game start with 1500ms timeout — if server unavailable, game proceeds in solo mode.

### Client State (`this.mp`)
```javascript
{
    enabled: false,
    ws: WebSocket,
    roomCode: String,       // 5-digit room code
    playerId: Number,       // 1 = host, 2+ = joiners
    remotePlayers: {},      // id → { mesh, walkTimer, snatchHp, pumpkins, cooldown }
    syncTimer: 0
}
```

### WebSocket Message Types (Client → Server)
| Type | Payload | Description |
|---|---|---|
| `create` | — | Create a new room |
| `join` | `code` | Join existing room by 5-digit code |
| `state` | `{x, y, z, yaw, hp, pumpkins}` | Position broadcast (max 20 fps) |
| `snatch` | `{targetId, amount}` | PvP pumpkin steal notification |

### WebSocket Message Types (Server → Client)
| Type | Payload | Description |
|---|---|---|
| `created` | `{code, playerId:1}` | Room created confirmation |
| `joined` | `{code, playerId}` | Room joined confirmation |
| `existingPlayers` | `{playerIds:[]}` | IDs of already-connected players |
| `playerJoined` | `{playerId}` | New player notification |
| `playerState` | `{playerId, data:{x,y,z,yaw,pumpkins}}` | Remote player position update |
| `playerLeft` | `{playerId}` | Disconnection notification |
| `snatched` | `{fromId, amount}` | PvP: you lost pumpkins |
| `error` | `{msg}` | e.g. room not found, room full |

### PvP Mechanics
- Each remote player has a `snatchHp` pool (60 HP) separate from real HP
- Shooting/meleeing a remote player drains `snatchHp`; at 0 → snatch up to 20 pumpkins
- After a snatch: 10-second truce (`rp.cooldown`) during which that player cannot be targeted
- PvP truce also triggered when you are snatched from (10s protection against attacker)

### Server (`ws_server.js`)
- Room capacity: 10 players max
- Players get color-coded meshes (11 preset palette colors)
- Floating canvas sprite label "P{id}" above each remote player head
- Room codes are 5-digit numbers (10000-99999)
- Rooms auto-delete when last player leaves

---

## Audio System

| Key | File | Loop | Volume | Usage |
|---|---|---|---|---|
| `sfx.pistol` | `pistal-shoot.mp3` | No | 0.7 | Pistol fire |
| `sfx.rifle` | `rifle-gunshot.mp3` | No | 0.8 | Shotgun / Rifle / Sniper fire |
| `sfx.walking` | `walking-sound.mp3` | Yes | 0.4 | Moving on ground |
| `sfx.leopard` | `leopard-attack.mp3` | No | 0.9 | Predator attacks; rate-limited 2.5s |
| `sfx.bgScore` | `background-score.mp3` | Yes | 0.3 | Background music; starts with game |

- Walking sound plays when `horizSpeed > 0.5 && onGround`, pauses otherwise
- Leopard sound has `_leopardCooldown` to prevent spam

---

## UI / HUD (index.html)

### Elements
| ID | Purpose |
|---|---|
| `#blocker` | Full-screen start/pause overlay with instructions |
| `#hud` | Top HUD bar (pumpkins, coins, weapon, HP, MP info) |
| `#crosshair` | Center `+` or contextual hint text (`[ E ] Collect`, etc.) |
| `#health-bar-container` | Bottom-center HP bar (green/yellow/red) |
| `#danger-compass` | Top-center dynamic danger cards for threatened NPCs |
| `#message` | Center-screen info text (yellow, 2.5s fade) |
| `#alert-message` | Center-screen warning text (red, 3s fade) |
| `#shop-panel` | Shop overlay (fixed, centered, 400px min-width) |
| `#game-over` | End screen with stats and restart button |
| `#touch-controls` | Mobile overlay (joystick + action buttons) |
| `#rotate-overlay` | Portrait-mode warning on mobile |
| `#mp-hud` | Multiplayer: player number + room code chip |
| `#mp-status` | Connection status text during lobby |
| `#room-code-input` | 5-digit room code input field |

### Difficulty Selector
- Buttons: `[data-difficulty="easy|normal|hard"]`
- JS: `setupDifficultySelector()` — click sets `this.difficulty` and `activeDifficulty`

### Mobile / Touch Controls
- Enabled if `ontouchstart` in window OR `navigator.maxTouchPoints >= 1`
- Left virtual joystick (130px base, 42px max radius)
- Right action buttons: `#btn-attack` (⚔️), `#btn-jump` (⬆️), `#btn-sprint` (🏃 hold), `#btn-collect` (🎃), `#btn-shop` (🏪)
- Touch camera look: any touch on right 45%+ of screen that is not the joystick
- `screen.orientation.lock('landscape')` called on mobile start
- Fullscreen requested on mobile start

---

## Visual Effects

### Particle System (`spawnCollectionEffect`, `updateParticles`)
- On pumpkin collect: 14 box particles burst outward in orange/gold/red/green/yellow
- Physics: gravity `-14`, scale fades over `0.5–0.95s` lifetime

### Floating Text (`createFloatingText`)
- Canvas → `THREE.Sprite` (CanvasTexture)
- Rises 2 units/s, fades over 2s, then removes itself

### Skybox / Day-Night (`updateSkybox`)
- `scene.background` and `scene.fog.color` shift slowly via `Math.sin(Date.now() * 0.00005)`
- Subtle: `r: 0.3–0.5`, `g: 0.5–0.8`, `b: 0.7–0.9`

### Lighting
- `AmbientLight(0x6688cc, 0.5)` — cool blue-purple ambient
- `DirectionalLight(0xffeedd, 1.0)` — warm sun with shadow (2048² shadow map, ±100 frustum)
- `HemisphereLight(0x88bbff sky, 0x445522 ground, 0.4)`

### Fog
- `THREE.Fog(0x87CEEB, near=60, far=150)`

---

## Game Loop (`animate()`)

Called each frame via `requestAnimationFrame`. When `isRunning`:

```
updatePlayer(dt)         → movement, physics, collision, camera bob
updateGuards(dt)         → guard FSM, patrol, chase, catch, walk animation
updateAnimals(dt)        → flee/wander, walk animation, rabbit hop
updatePredators(dt)      → hunt/attack FSM, forced attacks, danger compass, wolf animation
updateVillagers(dt)      → flee/wander, save reward, walk animation
updateBullets(dt)        → move bullets, terrain/range check, hit detection
updateParticles(dt)      → collection burst physics and fade
updateHerbs(dt)          → (proximity handled in updateProximityHints)
updateWeaponVisual(dt)   → bob, swing, recoil animation
updateSkybox(dt)         → day/night color tint
updateProximityHints()   → crosshair text based on nearest interactable
updateHUD()              → refresh DOM display values
_syncMpState(dt)         → broadcast own state (WebSocket, max 20 fps)
[remote player walk anim] → animate remote player limbs
[pumpkin/herb bob]       → per-frame Y offset + Y rotation spin
[death check]            → gameOver() if hp ≤ 0
renderer.render(scene, camera)
```

DeltaTime is capped: `dt = Math.min(this.clock.getDelta(), 0.05)`.

---

## Proximity Hint System (`updateProximityHints`)

Runs every frame to update the `#crosshair` text:

1. Near any uncollected pumpkin (< 5u) → `[ E ] Collect` (orange)
2. Near any uncollected herb (< 5u) → `[ E ] Herb +20HP` (green)
3. Near any non-alerted guard (< 5u) → `[ E ] Steal` (red)
4. Default → `+` (white)

---

## Controls Reference

### Desktop (Keyboard + Mouse)
| Key | Action |
|---|---|
| WASD | Move |
| MOUSE | Look |
| LEFT CLICK / F | Attack / Shoot |
| SPACE | Jump |
| SHIFT | Sprint (hold) |
| E | Collect / Interact |
| 0–4 | Switch weapon |
| B | Toggle shop |
| ESC | Pause (releases pointer lock) |

### Mobile (Touch)
| Control | Action |
|---|---|
| Left joystick | Move |
| Right half drag | Look |
| ⚔️ button | Attack |
| ⬆️ button | Jump |
| 🏃 button (hold) | Sprint |
| 🎃 button | Collect |
| 🏪 button | Toggle shop |

---

## Running the Game

### Solo (no multiplayer)
```
# Just open index.html in a browser. No server required.
# Or serve statically:
npx serve .
```

### With Multiplayer
```
npm install
node ws_server.js     # starts WebSocket server on ws://localhost:8765
# Then open index.html
```

---

## Known Constraints / Design Decisions

1. **Single file game** — all game logic is in `game.js` (one class, no imports)
2. **No persistence** — coins, weapons, and pumpkins reset on page reload
3. **No save system** — `location.reload()` is the "play again" action
4. **HeightMap is computed live** — `getHeight(x,z)` calls noise every time; there is no baked heightmap array
5. **Terrain is a single mesh** — not chunked; all 200×200 world is one `PlaneGeometry`
6. **Weapons are session-owned** — `weaponDef.owned` is in-memory only
7. **No collision with terrain mesh** — player uses `getHeight()` formula, not mesh raycasting
8. **Guard detection uses dot-product FoV** — not raycasting (no occlusion)
9. **Multiplayer is position-relay only** — no server-side validation; pumpkin snatching is honor-system
10. **Audio autoplay** — rely on user interaction (click to start) to satisfy browser autoplay policy

---

## Enhancement Ideas / Future Features

> Add ideas here as they come up during development sessions.

- [ ] Persistent high-score / leaderboard (localStorage or server)
- [ ] Day/night cycle with actual scene light level changes
- [ ] More biomes (desert, snow, swamp)
- [ ] Inventory / item system
- [ ] Quest system (kill N predators, collect N pumpkins)
- [ ] Minimap implementation (canvas overlay, top-down rendering)
- [ ] Sound volume settings
- [ ] More animal types
- [ ] Predator pack behavior (wolves hunt together)
- [ ] Guard patrol vision cones (visual FoV indicator)
- [ ] Weather effects (rain particles, fog density changes)
- [ ] UI settings panel (graphics quality, sound toggles)
- [ ] Mobile weapon switching (swipe or select UI)
- [ ] Server-side multiplayer validation (anti-cheat)

---

*Last updated: 2026-03-22 — Generated from full analysis of `index.html` (457 lines) and `game.js` (3094 lines)*
