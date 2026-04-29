/**
 * game2/assets.js
 * Minecraft-styled character factory functions using Three.js BoxGeometry.
 * All functions return a THREE.Group. THREE must be available as a global.
 *
 * Exports (on window.GameAssets):
 *   createMalePlayer()
 *   createFemalePlayer()
 *   createRabbit()
 *   createDeer()
 *   createWolf()
 */

(function (global) {
    'use strict';

    // ------------------------------------------------------------------ //
    //  Internal helper – mirrors game.js createBox
    // ------------------------------------------------------------------ //
    function box(w, h, d, color) {
        const geo = new THREE.BoxGeometry(w, h, d);
        const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
    }

    // ------------------------------------------------------------------ //
    //  MALE PLAYER  (Steve-style)
    //  Total height ≈ 2.1 units.  Origin at feet.
    // ------------------------------------------------------------------ //
    function createMalePlayer() {
        const group = new THREE.Group();

        const SKIN   = 0xDEB887;
        const SHIRT  = 0x3B6FAC;   // blue tunic
        const PANTS  = 0x1C3A6E;   // dark navy
        const BOOT   = 0x2B1B0E;   // dark brown
        const HAIR   = 0x3B2506;   // dark brown

        // --- Boots ---
        const bootL = box(0.25, 0.18, 0.32, BOOT);
        bootL.position.set(-0.135, 0.09, 0.02);
        group.add(bootL);

        const bootR = box(0.25, 0.18, 0.32, BOOT);
        bootR.position.set( 0.135, 0.09, 0.02);
        group.add(bootR);

        // --- Legs ---
        const legMeshes = [];
        for (const sx of [-1, 1]) {
            const leg = box(0.25, 0.72, 0.26, PANTS);
            leg.position.set(sx * 0.135, 0.54, 0);
            group.add(leg);
            legMeshes.push(leg);
        }

        // --- Body / chest ---
        const body = box(0.52, 0.76, 0.30, SHIRT);
        body.position.set(0, 1.28, 0);
        group.add(body);

        // Belt detail
        const belt = box(0.54, 0.08, 0.32, 0x7B5533);
        belt.position.set(0, 0.96, 0);
        group.add(belt);

        // --- Arms ---
        const armMeshes = [];
        for (const sx of [-1, 1]) {
            const upper = box(0.26, 0.70, 0.26, SHIRT);
            upper.position.set(sx * 0.39, 1.28, 0);
            group.add(upper);

            const lower = box(0.24, 0.34, 0.24, SKIN);
            lower.position.set(sx * 0.39, 0.78, 0);
            group.add(lower);

            armMeshes.push(upper, lower);
        }

        // --- Head ---
        const head = box(0.60, 0.60, 0.60, SKIN);
        head.position.set(0, 1.96, 0);
        group.add(head);

        // Face – eyes
        for (const sx of [-1, 1]) {
            const eye = box(0.10, 0.08, 0.04, 0x2B2B2B);
            eye.position.set(sx * 0.14, 2.00, 0.31);
            group.add(eye);

            // White highlight
            const shine = box(0.04, 0.04, 0.04, 0xFFFFFF);
            shine.position.set(sx * 0.17, 2.03, 0.33);
            group.add(shine);
        }

        // Nose
        const nose = box(0.08, 0.06, 0.05, 0xC8986A);
        nose.position.set(0, 1.93, 0.32);
        group.add(nose);

        // Mouth
        const mouth = box(0.18, 0.04, 0.04, 0x8B5E3C);
        mouth.position.set(0, 1.87, 0.31);
        group.add(mouth);

        // --- Hair (cap-style) ---
        const hairTop = box(0.62, 0.10, 0.62, HAIR);
        hairTop.position.set(0, 2.31, 0);
        group.add(hairTop);

        const hairFront = box(0.62, 0.28, 0.08, HAIR);
        hairFront.position.set(0, 2.14, 0.31);
        group.add(hairFront);

        const hairBack = box(0.62, 0.30, 0.08, HAIR);
        hairBack.position.set(0, 2.12, -0.32);
        group.add(hairBack);

        for (const sx of [-1, 1]) {
            const hairSide = box(0.08, 0.30, 0.60, HAIR);
            hairSide.position.set(sx * 0.32, 2.14, 0);
            group.add(hairSide);
        }

        group._limbs = { legs: legMeshes, arms: armMeshes, walkTimer: 0 };
        group._assetType = 'malePlayer';
        return group;
    }

    // ------------------------------------------------------------------ //
    //  FEMALE PLAYER  (Alex-style)
    //  Total height ≈ 2.1 units.  Origin at feet.
    // ------------------------------------------------------------------ //
    function createFemalePlayer() {
        const group = new THREE.Group();

        const SKIN   = 0xF4C17C;   // lighter skin
        const SHIRT  = 0x5D8A3C;   // green tunic
        const PANTS  = 0x7B4F2A;   // brown trousers
        const BOOT   = 0x1A0F00;   // near-black boots
        const HAIR   = 0xB85C1A;   // auburn/orange

        // --- Boots ---
        for (const sx of [-1, 1]) {
            const boot = box(0.23, 0.18, 0.30, BOOT);
            boot.position.set(sx * 0.125, 0.09, 0.02);
            group.add(boot);
        }

        // --- Legs ---
        const legMeshes = [];
        for (const sx of [-1, 1]) {
            const leg = box(0.23, 0.72, 0.24, PANTS);
            leg.position.set(sx * 0.125, 0.54, 0);
            group.add(leg);
            legMeshes.push(leg);
        }

        // --- Body / tunic (slightly flared at bottom) ---
        const body = box(0.50, 0.80, 0.28, SHIRT);
        body.position.set(0, 1.28, 0);
        group.add(body);

        // Tunic hem flare
        const hem = box(0.56, 0.10, 0.32, SHIRT);
        hem.position.set(0, 0.93, 0);
        group.add(hem);

        // --- Arms (slimmer – Alex's 3-pixel arms) ---
        const armMeshes = [];
        for (const sx of [-1, 1]) {
            const upper = box(0.20, 0.72, 0.22, SHIRT);
            upper.position.set(sx * 0.37, 1.28, 0);
            group.add(upper);

            const lower = box(0.18, 0.34, 0.20, SKIN);
            lower.position.set(sx * 0.37, 0.78, 0);
            group.add(lower);

            armMeshes.push(upper, lower);
        }

        // --- Head ---
        const head = box(0.58, 0.58, 0.58, SKIN);
        head.position.set(0, 1.96, 0);
        group.add(head);

        // Eyes (green-ish)
        for (const sx of [-1, 1]) {
            const eye = box(0.10, 0.08, 0.04, 0x3A6B3A);
            eye.position.set(sx * 0.13, 2.00, 0.30);
            group.add(eye);

            const shine = box(0.04, 0.04, 0.04, 0xFFFFFF);
            shine.position.set(sx * 0.16, 2.03, 0.32);
            group.add(shine);
        }

        // Nose (smaller / button)
        const nose = box(0.06, 0.05, 0.05, 0xDBA86A);
        nose.position.set(0, 1.93, 0.31);
        group.add(nose);

        // Mouth (smile)
        for (const sx of [-1, 1]) {
            const mCorner = box(0.06, 0.04, 0.04, 0xC08050);
            mCorner.position.set(sx * 0.07, 1.86, 0.30);
            group.add(mCorner);
        }
        const mMid = box(0.10, 0.04, 0.04, 0xC08050);
        mMid.position.set(0, 1.84, 0.30);
        group.add(mMid);

        // --- Hair ---
        // Top
        const hairTop = box(0.60, 0.12, 0.60, HAIR);
        hairTop.position.set(0, 2.31, 0);
        group.add(hairTop);

        // Front fringe
        const fringe = box(0.58, 0.14, 0.08, HAIR);
        fringe.position.set(0, 2.20, 0.31);
        group.add(fringe);

        // Back – long hair flowing down
        const hairBack = box(0.58, 0.70, 0.08, HAIR);
        hairBack.position.set(0, 1.90, -0.32);
        group.add(hairBack);

        // Sides – long strands beside face
        for (const sx of [-1, 1]) {
            const strand = box(0.08, 0.80, 0.58, HAIR);
            strand.position.set(sx * 0.32, 1.86, 0);
            group.add(strand);
        }

        group._limbs = { legs: legMeshes, arms: armMeshes, walkTimer: 0 };
        group._assetType = 'femalePlayer';
        return group;
    }

    // ------------------------------------------------------------------ //
    //  RABBIT
    //  Height ≈ 0.9 units.  Origin at ground level.
    // ------------------------------------------------------------------ //
    function createRabbit() {
        const group = new THREE.Group();

        const FUR     = 0xE8E0CE;   // off-white
        const FUR_D   = 0xCFC4AE;   // darker belly / shading
        const EAR_IN  = 0xF2A0A0;   // pink inner ear
        const EYE     = 0x2B1B1B;
        const NOSE    = 0xFF8888;

        // --- Hind feet ---
        for (const sx of [-1, 1]) {
            const foot = box(0.14, 0.10, 0.28, FUR_D);
            foot.position.set(sx * 0.10, 0.05, 0.05);
            group.add(foot);
        }

        // --- Body ---
        const body = box(0.34, 0.36, 0.50, FUR);
        body.position.set(0, 0.38, 0);
        group.add(body);

        // Belly patch
        const belly = box(0.20, 0.26, 0.12, 0xFAF5EC);
        belly.position.set(0, 0.36, 0.22);
        group.add(belly);

        // --- Neck ---
        const neck = box(0.22, 0.16, 0.20, FUR);
        neck.position.set(0, 0.62, 0.14);
        group.add(neck);

        // --- Head ---
        const head = box(0.30, 0.28, 0.28, FUR);
        head.position.set(0, 0.76, 0.18);
        group.add(head);

        // Cheek puffs
        for (const sx of [-1, 1]) {
            const cheek = box(0.08, 0.12, 0.10, FUR);
            cheek.position.set(sx * 0.16, 0.72, 0.24);
            group.add(cheek);
        }

        // Nose
        const nose = box(0.06, 0.04, 0.04, NOSE);
        nose.position.set(0, 0.74, 0.32);
        group.add(nose);

        // Eyes
        for (const sx of [-1, 1]) {
            const eye = box(0.06, 0.06, 0.04, EYE);
            eye.position.set(sx * 0.10, 0.80, 0.30);
            group.add(eye);
        }

        // --- Ears (tall, upright) ---
        for (const sx of [-1, 1]) {
            const outerEar = box(0.10, 0.46, 0.08, FUR);
            outerEar.position.set(sx * 0.09, 1.10, 0.14);
            group.add(outerEar);

            const innerEar = box(0.05, 0.34, 0.04, EAR_IN);
            innerEar.position.set(sx * 0.09, 1.10, 0.16);
            group.add(innerEar);
        }

        // --- Tail ---
        const tail = box(0.14, 0.14, 0.14, 0xFFFFFF);
        tail.position.set(0, 0.40, -0.28);
        group.add(tail);

        // --- Front paws ---
        for (const sx of [-1, 1]) {
            const paw = box(0.10, 0.10, 0.16, FUR_D);
            paw.position.set(sx * 0.10, 0.10, 0.20);
            group.add(paw);
        }

        group._assetType = 'rabbit';
        return group;
    }

    // ------------------------------------------------------------------ //
    //  DEER
    //  Height ≈ 2.0 units (antlers included).  Origin at ground.
    // ------------------------------------------------------------------ //
    function createDeer() {
        const group = new THREE.Group();

        const BROWN   = 0x8B5A2B;   // body
        const BROWN_D = 0x6B3F1A;   // darker legs / markings
        const CREAM   = 0xF5E6C8;   // belly / throat
        const ANTLER  = 0x7B5533;
        const EYE     = 0x1A1A0A;
        const NOSE    = 0x2B1010;

        // --- Hooves ---
        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
                const hoof = box(0.14, 0.12, 0.14, 0x1A1A1A);
                hoof.position.set(sx * 0.22, 0.06, sz * 0.32);
                group.add(hoof);
            }
        }

        // --- Legs (four, long) ---
        const legMeshes = [];
        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
                const leg = box(0.15, 0.70, 0.15, BROWN_D);
                leg.position.set(sx * 0.22, 0.47, sz * 0.32);
                group.add(leg);
                legMeshes.push(leg);
            }
        }

        // --- Body ---
        const body = box(0.60, 0.55, 1.10, BROWN);
        body.position.set(0, 1.05, 0);
        group.add(body);

        // Belly cream patch
        const belly = box(0.30, 0.30, 0.80, CREAM);
        belly.position.set(0, 0.92, 0.10);
        group.add(belly);

        // --- Neck (angled forward) ---
        const neck = box(0.28, 0.48, 0.26, BROWN);
        neck.position.set(0, 1.34, 0.44);
        neck.rotation.x = -0.45;
        group.add(neck);

        // Throat cream
        const throat = box(0.14, 0.36, 0.12, CREAM);
        throat.position.set(0, 1.28, 0.54);
        throat.rotation.x = -0.45;
        group.add(throat);

        // --- Head ---
        const head = box(0.38, 0.32, 0.46, BROWN);
        head.position.set(0, 1.64, 0.70);
        group.add(head);

        // Snout / muzzle
        const snout = box(0.26, 0.20, 0.28, CREAM);
        snout.position.set(0, 1.56, 0.88);
        group.add(snout);

        // Nose
        const nose = box(0.10, 0.06, 0.05, NOSE);
        nose.position.set(0, 1.60, 1.01);
        group.add(nose);

        // Eyes
        for (const sx of [-1, 1]) {
            const eye = box(0.08, 0.08, 0.05, EYE);
            eye.position.set(sx * 0.15, 1.70, 0.88);
            group.add(eye);

            const shine = box(0.03, 0.03, 0.04, 0xFFFFFF);
            shine.position.set(sx * 0.17, 1.72, 0.90);
            group.add(shine);
        }

        // Ears
        for (const sx of [-1, 1]) {
            const ear = box(0.18, 0.10, 0.24, BROWN);
            ear.position.set(sx * 0.26, 1.78, 0.64);
            ear.rotation.z = sx * 0.4;
            group.add(ear);

            const earIn = box(0.10, 0.06, 0.16, 0xDBA080);
            earIn.position.set(sx * 0.26, 1.78, 0.66);
            earIn.rotation.z = sx * 0.4;
            group.add(earIn);
        }

        // --- White rump patch ---
        const rump = box(0.36, 0.28, 0.10, CREAM);
        rump.position.set(0, 1.08, -0.56);
        group.add(rump);

        // --- Tail ---
        const tail = box(0.12, 0.18, 0.08, 0xFFFFFF);
        tail.position.set(0, 1.18, -0.60);
        group.add(tail);

        // --- Antlers ---
        for (const sx of [-1, 1]) {
            const base = box(0.08, 0.30, 0.08, ANTLER);
            base.position.set(sx * 0.14, 1.96, 0.66);
            group.add(base);

            const fork1 = box(0.24, 0.08, 0.08, ANTLER);
            fork1.position.set(sx * 0.24, 2.18, 0.64);
            group.add(fork1);

            const fork2 = box(0.08, 0.28, 0.08, ANTLER);
            fork2.position.set(sx * 0.16, 2.24, 0.64);
            group.add(fork2);

            const tine1 = box(0.06, 0.18, 0.06, ANTLER);
            tine1.position.set(sx * 0.30, 2.18, 0.58);
            tine1.rotation.z = sx * 0.5;
            group.add(tine1);

            const tine2 = box(0.06, 0.18, 0.06, ANTLER);
            tine2.position.set(sx * 0.16, 2.46, 0.58);
            group.add(tine2);
        }

        group._limbs = { legs: legMeshes, walkTimer: 0 };
        group._assetType = 'deer';
        return group;
    }

    // ------------------------------------------------------------------ //
    //  WOLF
    //  Height ≈ 1.6 units.  Origin at ground.
    // ------------------------------------------------------------------ //
    function createWolf() {
        const group = new THREE.Group();

        const GREY    = 0x7A7A7A;
        const GREY_D  = 0x4A4A4A;
        const GREY_L  = 0xB0B0A8;
        const EYE     = 0xFFCC00;
        const NOSE    = 0x111111;
        const TONGUE  = 0xFF6680;

        // --- Paws ---
        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
                const paw = box(0.14, 0.10, 0.18, GREY_D);
                paw.position.set(sx * 0.20, 0.05, sz * 0.36);
                group.add(paw);
            }
        }

        // --- Legs ---
        const legMeshes = [];
        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
                const leg = box(0.16, 0.50, 0.16, GREY);
                leg.position.set(sx * 0.20, 0.37, sz * 0.36);
                group.add(leg);
                legMeshes.push(leg);
            }
        }

        // --- Body ---
        const body = box(0.58, 0.52, 1.10, GREY);
        body.position.set(0, 0.80, 0);
        group.add(body);

        const saddle = box(0.46, 0.12, 0.80, GREY_D);
        saddle.position.set(0, 1.07, -0.04);
        group.add(saddle);

        const belly = box(0.28, 0.26, 0.80, GREY_L);
        belly.position.set(0, 0.68, 0.10);
        group.add(belly);

        // --- Neck ---
        const neck = box(0.30, 0.38, 0.28, GREY);
        neck.position.set(0, 1.04, 0.46);
        neck.rotation.x = -0.30;
        group.add(neck);

        // --- Head ---
        const head = box(0.42, 0.36, 0.42, GREY);
        head.position.set(0, 1.20, 0.76);
        group.add(head);

        const mask = box(0.44, 0.14, 0.10, GREY_D);
        mask.position.set(0, 1.28, 0.96);
        group.add(mask);

        for (const sx of [-1, 1]) {
            const cheek = box(0.10, 0.20, 0.20, GREY_L);
            cheek.position.set(sx * 0.22, 1.14, 0.84);
            group.add(cheek);
        }

        const snout = box(0.24, 0.18, 0.30, GREY_L);
        snout.position.set(0, 1.12, 0.96);
        group.add(snout);

        const nose = box(0.10, 0.07, 0.05, NOSE);
        nose.position.set(0, 1.18, 1.11);
        group.add(nose);

        const tongue = box(0.08, 0.04, 0.10, TONGUE);
        tongue.position.set(0, 1.04, 1.08);
        tongue.rotation.x = 0.3;
        group.add(tongue);

        for (const sx of [-1, 1]) {
            const eye = box(0.09, 0.09, 0.05, EYE);
            eye.position.set(sx * 0.13, 1.28, 0.97);
            group.add(eye);

            const pupil = box(0.04, 0.05, 0.04, 0x111111);
            pupil.position.set(sx * 0.13, 1.27, 0.99);
            group.add(pupil);
        }

        for (const sx of [-1, 1]) {
            const earBase = box(0.14, 0.08, 0.12, GREY);
            earBase.position.set(sx * 0.16, 1.43, 0.72);
            group.add(earBase);

            const earTip = box(0.10, 0.18, 0.08, GREY_D);
            earTip.position.set(sx * 0.16, 1.57, 0.70);
            group.add(earTip);

            const earIn = box(0.06, 0.12, 0.05, 0xCC9988);
            earIn.position.set(sx * 0.16, 1.55, 0.72);
            group.add(earIn);
        }

        const tailBase = box(0.14, 0.14, 0.44, GREY);
        tailBase.position.set(0, 0.94, -0.64);
        tailBase.rotation.x = 0.5;
        group.add(tailBase);

        const tailMid = box(0.18, 0.18, 0.30, GREY_D);
        tailMid.position.set(0, 1.10, -0.86);
        tailMid.rotation.x = 0.9;
        group.add(tailMid);

        const tailTip = box(0.14, 0.14, 0.16, GREY_L);
        tailTip.position.set(0, 1.28, -0.98);
        tailTip.rotation.x = 1.1;
        group.add(tailTip);

        group._limbs = { legs: legMeshes, tail: tailBase, walkTimer: 0 };
        group._assetType = 'wolf';
        return group;
    }

    // ------------------------------------------------------------------ //
    //  Public API
    // ------------------------------------------------------------------ //
    global.GameAssets = {
        createMalePlayer,
        createFemalePlayer,
        createRabbit,
        createDeer,
        createWolf,
    };

}(window));
