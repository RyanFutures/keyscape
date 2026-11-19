// "Needle in the void" visualization. A vast, dim Hilbert lattice (the whole key
// space) recedes into fog; the active search is a small luminous cluster of
// three Hilbert cubes (private key, public key, address) at the centre. Each
// checked key flares a connection triangle that fades to nothing within ~1.5 s -
// endless effort, sparks winking out. A slow auto-orbit (no mouse, for a passive
// display) parallaxes the near needle against the far void. Theme-driven: dark
// themes glow via bloom + additive blending; light themes invert to dark lines
// on a bright field with no bloom.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hilbertCurve, keyToVertexIndex } from './hilbert.js';
import { STATUS } from './checker.js';

const VERTS_PER_CONN = 6;       // triangle outline: 3 segments x 2 vertices
const CONN_LIFETIME_MS = 1600;  // a checked key flares then fades over this

export class Viz {
  constructor(container, { theme, levels = 4, maxConnections = 240, showText = false, fontUrl, keyOrientation = 'horizontal' } = {}) {
    this.levels = levels;
    this.max = maxConnections;
    this.showText = showText;
    this.fontUrl = fontUrl;
    this.keyVertical = keyOrientation === 'vertical';

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 7000);
    this.scene = new THREE.Scene();

    // Needle cubes: shared Hilbert point set (local space).
    const pts = hilbertCurve(200, levels);
    this.points = pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const curvePos = new Float32Array(pts.length * 3);
    for (let i = 0; i < pts.length; i++) { curvePos[i * 3] = pts[i][0]; curvePos[i * 3 + 1] = pts[i][1]; curvePos[i * 3 + 2] = pts[i][2]; }

    // Three distinct, well-separated cubes (triangle): private key, public key,
    // address. Larger and spread apart so the one-way chain reads clearly.
    const offsets = [[-320, -90, 0], [320, -90, 0], [0, 270, 0]];
    const scales = [0.85, 0.85, 0.8];
    // All three cubes orbit their shared barycenter (the centroid of the three).
    // The orbit is applied to each cube's POSITION each frame (see update), not
    // via a rotating parent, so each cube still spins freely on its own.
    // _orbitRel holds each cube's offset from the barycenter.
    this._bc = new THREE.Vector3(
      (offsets[0][0] + offsets[1][0] + offsets[2][0]) / 3,
      (offsets[0][1] + offsets[1][1] + offsets[2][1]) / 3,
      (offsets[0][2] + offsets[1][2] + offsets[2][2]) / 3,
    );
    this._orbitRel = {
      0: new THREE.Vector3().fromArray(offsets[0]).sub(this._bc),
      1: new THREE.Vector3().fromArray(offsets[1]).sub(this._bc),
      2: new THREE.Vector3().fromArray(offsets[2]).sub(this._bc),
    };
    this.cubeMaterials = [];
    this.holders = offsets.map((off, i) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(curvePos.slice(), 3));
      const mat = new THREE.LineBasicMaterial({ transparent: true });
      this.cubeMaterials.push(mat);
      const holder = new THREE.Object3D();
      holder.scale.setScalar(scales[i]);
      holder.add(new THREE.Line(geo, mat));
      holder.position.set(off[0], off[1], off[2]);
      this.scene.add(holder);
      return holder;
    });

    // The void: a vast, dim Hilbert lattice the needle sits inside. Fewer points
    // than the needle-scale curve, large, so it reads as sparse structure.
    const vp = hilbertCurve(1900, 4);
    const voidPos = new Float32Array(vp.length * 3);
    for (let i = 0; i < vp.length; i++) { voidPos[i * 3] = vp[i][0]; voidPos[i * 3 + 1] = vp[i][1]; voidPos[i * 3 + 2] = vp[i][2]; }
    const voidGeo = new THREE.BufferGeometry();
    voidGeo.setAttribute('position', new THREE.BufferAttribute(voidPos, 3));
    this.voidMaterial = new THREE.LineBasicMaterial({ transparent: true });
    this.voidLine = new THREE.Line(voidGeo, this.voidMaterial);
    this.scene.add(this.voidLine);

    // Pooled connections (ring buffer; each flares then fades).
    this.connGeo = new THREE.BufferGeometry();
    this.connPos = new Float32Array(this.max * VERTS_PER_CONN * 3);
    this.connCol = new Float32Array(this.max * VERTS_PER_CONN * 3);
    this.connGeo.setAttribute('position', new THREE.BufferAttribute(this.connPos, 3));
    this.connGeo.setAttribute('color', new THREE.BufferAttribute(this.connCol, 3));
    this.connMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true });
    this.connLines = new THREE.LineSegments(this.connGeo, this.connMaterial);
    this.scene.add(this.connLines);

    this.slots = new Array(this.max);
    this.head = 0;
    this._scratch = new THREE.Vector3();
    this._texts = [];
    this._keyBuffer = [];       // recent keys awaiting a (staggered) rain spawn
    this._nextTextAt = 0;
    this._charGeos = null;      // per-character geometry cache (built on font load)
    this._cam = null;           // live camera spherical state { az, polar, dist }
    this._drag = null;          // active pointer drag
    this._lastInput = -Infinity; // last camera input; auto resumes 2 s after
    this.font = null;
    if (this.fontUrl) this._loadFont();

    this._clock0 = performance.now();
    this._buildComposer();      // permanent composer; applyTheme only tunes bloom
    this.applyTheme(theme);
    this._initPointer();
    window.addEventListener('resize', () => this._onResize());
  }

  // Drag to look around (mouse or touch); the automatic orbit resumes 2 s after
  // the last input, easing back from wherever it was left.
  _initPointer() {
    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    const mark = () => { this._lastInput = performance.now(); };
    el.addEventListener('pointerdown', (e) => { this._drag = { x: e.clientX, y: e.clientY }; mark(); el.setPointerCapture?.(e.pointerId); });
    el.addEventListener('pointermove', (e) => {
      if (!this._drag || !this._cam) return;
      const dx = e.clientX - this._drag.x, dy = e.clientY - this._drag.y;
      this._drag.x = e.clientX; this._drag.y = e.clientY;
      this._cam.az -= dx * 0.005;
      this._cam.polar = THREE.MathUtils.clamp(this._cam.polar - dy * 0.005, 0.12, Math.PI - 0.12);
      mark();
    });
    const end = () => { this._drag = null; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => { if (this._cam) this._cam.dist = THREE.MathUtils.clamp(this._cam.dist * (1 + e.deltaY * 0.001), 450, 3200); mark(); e.preventDefault(); }, { passive: false });
  }

  _updateCamera(t, nowMs) {
    // The automatic path, expressed in spherical coords around the scene centre.
    const rh = 1232 + Math.sin(t * 0.025) * 357;   // horizontal radius
    const hy = Math.sin(t * 0.04) * 230;            // height
    const dist = Math.hypot(rh, hy);
    const auto = { az: t * 0.06, polar: Math.acos(THREE.MathUtils.clamp(hy / dist, -1, 1)), dist };
    if (!this._cam) this._cam = { ...auto };

    if (nowMs - this._lastInput >= 2000) {
      // Idle: ease the live view back onto the automatic path.
      const k = 1 - Math.exp(-this._dt / 0.8);
      let d = (auto.az - this._cam.az) % (2 * Math.PI);
      if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
      this._cam.az += d * k;
      this._cam.polar += (auto.polar - this._cam.polar) * k;
      this._cam.dist += (auto.dist - this._cam.dist) * k;
    }
    const c = this._cam;
    this.camera.position.set(
      c.dist * Math.sin(c.polar) * Math.cos(c.az),
      c.dist * Math.cos(c.polar),
      c.dist * Math.sin(c.polar) * Math.sin(c.az),
    );
    this.camera.lookAt(0, 0, 0);
  }

  // Numeric + colour values of a theme (the things we crossfade).
  _themeValues(theme) {
    return {
      bg: new THREE.Color(theme.background),
      cubes: theme.cubes.map((c) => new THREE.Color(c)),
      lattice: new THREE.Color(theme.lattice),
      su: new THREE.Color(theme.status.unused),
      se: new THREE.Color(theme.status['used-empty']),
      sf: new THREE.Color(theme.status.funded),
      text: new THREE.Color(theme.text),
      blending: theme.blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
      nums: {
        fogDensity: theme.fogDensity,
        voidOpacity: theme.latticeOpacity,
        cubeOpacity: theme.dark ? 0.8 : 0.95,
        connOpacity: theme.dark ? 0.9 : 0.95,
        textOpacity: theme.dark ? 0.42 : 0.5,
        bloomStrength: theme.bloom ? theme.bloom.strength : 0,
        bloomRadius: theme.bloom ? theme.bloom.radius : 0.4,
        bloomThreshold: theme.bloom ? theme.bloom.threshold : 0,
      },
    };
  }

  // Switch palette, crossfading from the current colours to the new theme's over
  // ~2.5 s (instant on first construction). The discrete blending flip (additive
  // <-> normal on dark<->light) happens at the transition midpoint.
  applyTheme(theme) {
    const first = !this._live;
    this.theme = theme;
    if (first) {
      this._bg = new THREE.Color();
      this._statusColor = {
        [STATUS.UNUSED]: new THREE.Color(), [STATUS.USED_EMPTY]: new THREE.Color(), [STATUS.FUNDED]: new THREE.Color(),
      };
      if (!this._textMaterial) this._textMaterial = new THREE.MeshBasicMaterial({ transparent: true });
      this.voidMaterial.blending = THREE.NormalBlending; // void is always matte
      this.scene.fog = new THREE.FogExp2(0x000000, 0.0004);
      this._num = {};
      this._liveBlending = this._themeValues(theme).blending;
      this._live = true;
    }
    this._tStart = first ? this._themeValues(theme) : this._snapshotLive();
    this._tTarget = this._themeValues(theme);
    this._tBegin = performance.now();
    this._tDur = first ? 0 : 2500;
    this._tBlendDone = false;
    this._applyTransition(performance.now());
  }

  _snapshotLive() {
    return {
      bg: this._bg.clone(),
      cubes: this.cubeMaterials.map((m) => m.color.clone()),
      lattice: this.voidMaterial.color.clone(),
      su: this._statusColor[STATUS.UNUSED].clone(),
      se: this._statusColor[STATUS.USED_EMPTY].clone(),
      sf: this._statusColor[STATUS.FUNDED].clone(),
      text: this._textMaterial.color.clone(),
      blending: this._liveBlending,
      nums: { ...this._num },
    };
  }

  _setBlending(blend) {
    this._liveBlending = blend;
    for (const m of this.cubeMaterials) m.blending = blend;
    this.connMaterial.blending = blend;
    this._textMaterial.blending = blend;
  }

  _applyTransition(now) {
    if (this._tBegin == null) return;
    const S = this._tStart, T = this._tTarget;
    const p = this._tDur > 0 ? THREE.MathUtils.clamp((now - this._tBegin) / this._tDur, 0, 1) : 1;
    const e = p * p * (3 - 2 * p); // smoothstep
    const lerpN = (k) => S.nums[k] + (T.nums[k] - S.nums[k]) * e;

    this._bg.copy(S.bg).lerp(T.bg, e);
    this.renderer.setClearColor(this._bg, 1);
    this.scene.fog.color.copy(this._bg);
    this.scene.fog.density = lerpN('fogDensity');
    for (let i = 0; i < 3; i++) this.cubeMaterials[i].color.copy(S.cubes[i]).lerp(T.cubes[i], e);
    this.voidMaterial.color.copy(S.lattice).lerp(T.lattice, e);
    this._statusColor[STATUS.UNUSED].copy(S.su).lerp(T.su, e);
    this._statusColor[STATUS.USED_EMPTY].copy(S.se).lerp(T.se, e);
    this._statusColor[STATUS.FUNDED].copy(S.sf).lerp(T.sf, e);
    this._textMaterial.color.copy(S.text).lerp(T.text, e);

    this._num.fogDensity = this.scene.fog.density;
    this._num.voidOpacity = lerpN('voidOpacity'); this.voidMaterial.opacity = this._num.voidOpacity;
    this._num.cubeOpacity = lerpN('cubeOpacity'); for (const m of this.cubeMaterials) m.opacity = this._num.cubeOpacity;
    this._num.connOpacity = lerpN('connOpacity'); this.connMaterial.opacity = this._num.connOpacity;
    this._num.textOpacity = lerpN('textOpacity'); this._textMaterial.opacity = this._num.textOpacity;
    this._num.bloomStrength = lerpN('bloomStrength'); this.bloomPass.strength = this._num.bloomStrength;
    this._num.bloomRadius = lerpN('bloomRadius'); this.bloomPass.radius = this._num.bloomRadius;
    this._num.bloomThreshold = lerpN('bloomThreshold'); this.bloomPass.threshold = this._num.bloomThreshold;

    if (!this._tBlendDone && p >= 0.5) { this._setBlending(T.blending); this._tBlendDone = true; }

    try {
      const bg = '#' + this._bg.getHexString();
      document.documentElement.style.setProperty('--bg', bg);
      document.documentElement.style.setProperty('--fg', '#' + this._textMaterial.color.getHexString());
      document.body.style.background = bg;
    } catch { /* no DOM (test) */ }

    if (p >= 1) this._tBegin = null;
  }

  _buildComposer() {
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    // One permanent bloom pass; its strength is crossfaded (0 for light themes),
    // so switching themes never rebuilds the composer and the glow eases in/out.
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0, 0.4, 0);
    composer.addPass(this.bloomPass);
    composer.addPass(new OutputPass());
    composer.setSize(window.innerWidth, window.innerHeight);
    this.composer = composer;
  }

  addRecord(record) {
    if (this.showText) { this._keyBuffer.push(record.priv); if (this._keyBuffer.length > 60) this._keyBuffer.shift(); }
    this.slots[this.head] = {
      a: keyToVertexIndex(record.priv, this.levels),
      b: keyToVertexIndex(record.pub, this.levels),
      c: keyToVertexIndex(record.addr, this.levels),
      color: this._statusColor[record.status] || this._statusColor[STATUS.UNUSED],
      born: performance.now(),
    };
    this.head = (this.head + 1) % this.max;
  }

  _world(h, idx) { return this._scratch.copy(this.points[idx]).applyMatrix4(this.holders[h].matrixWorld); }

  _writeSeg(base, p0, p1, r, g, b) {
    const P = this.connPos, C = this.connCol;
    P[base] = p0.x; P[base + 1] = p0.y; P[base + 2] = p0.z;
    P[base + 3] = p1.x; P[base + 4] = p1.y; P[base + 5] = p1.z;
    for (let k = 0; k < 6; k += 3) { C[base + k] = r; C[base + k + 1] = g; C[base + k + 2] = b; }
  }

  _blank(base) { for (let i = 0; i < VERTS_PER_CONN * 3; i++) { this.connPos[base + i] = 0; this.connCol[base + i] = 0; } }

  update() {
    const nowMs = performance.now();
    const t = (nowMs - this._clock0) / 1000;
    this._dt = this._lastMs ? Math.min(0.1, (nowMs - this._lastMs) / 1000) : 0.016;
    this._lastMs = nowMs;

    this._applyTransition(nowMs); // crossfade colours/bloom between themes

    // Staggered rain: spawn one buffered key at a jittered cadence, decoupled
    // from the batch cadence, so keys do not fall in visible batches.
    if (this.showText && this.font && nowMs >= this._nextTextAt && this._keyBuffer.length) {
      this.spawnText(this._keyBuffer.splice(Math.floor(Math.random() * this._keyBuffer.length), 1)[0]);
      this._nextTextAt = nowMs + 150 + Math.random() * 320;
    }

    // Each cube spins freely on all three axes (independent self-rotation).
    this.holders[0].rotation.set(-t / 5, t / 3, -t / 4);
    this.holders[1].rotation.set(-t / 7, -t / 3, -t / 2);
    this.holders[2].rotation.set(t / 6, -t / 4, t / 3);
    // All three cubes orbit their shared barycenter (position only), in the
    // screen plane so the orbit is clearly visible.
    const oang = t * 0.4, ocos = Math.cos(oang), osin = Math.sin(oang);
    for (const i of [0, 1, 2]) {
      const r = this._orbitRel[i];
      this.holders[i].position.set(this._bc.x + r.x * ocos - r.y * osin, this._bc.y + r.x * osin + r.y * ocos, this._bc.z + r.z);
    }
    for (const h of this.holders) h.updateMatrixWorld(true);
    this.voidLine.rotation.y = -t / 45;
    this.voidLine.rotation.x = Math.sin(t * 0.02) * 0.12;

    const additive = this._liveBlending === THREE.AdditiveBlending;
    for (let s = 0; s < this.max; s++) {
      const slot = this.slots[s];
      const base = s * VERTS_PER_CONN * 3;
      if (!slot) { this._blank(base); continue; }
      const f = 1 - (nowMs - slot.born) / CONN_LIFETIME_MS;
      if (f <= 0) { this._blank(base); continue; }
      const pa = this._world(0, slot.a).clone();
      const pb = this._world(1, slot.b).clone();
      const pc = this._world(2, slot.c).clone();
      let r, g, b;
      if (additive) { r = slot.color.r * f; g = slot.color.g * f; b = slot.color.b * f; }
      else { r = THREE.MathUtils.lerp(this._bg.r, slot.color.r, f); g = THREE.MathUtils.lerp(this._bg.g, slot.color.g, f); b = THREE.MathUtils.lerp(this._bg.b, slot.color.b, f); }
      this._writeSeg(base, pa, pb, r, g, b);
      this._writeSeg(base + 6, pb, pc, r, g, b);
      this._writeSeg(base + 12, pc, pa, r, g, b);
    }
    this.connGeo.setDrawRange(0, this.max * VERTS_PER_CONN);
    this.connGeo.attributes.position.needsUpdate = true;
    this.connGeo.attributes.color.needsUpdate = true;

    // Camera: drag to look around, else slow auto-orbit (breathing radius/height).
    this._updateCamera(t, nowMs);

    this._updateText();
    this.composer.render();
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  // --- optional floating text (font loaded once; failure is non-fatal) ---
  _loadFont() {
    new FontLoader().load(this.fontUrl, (font) => { this.font = font; this._buildCharGeos(); }, undefined,
      (err) => { console.warn('keyscape: font load failed, text disabled', err); this.showText = false; });
  }

  // Cache one centred geometry per hex character (uppercase), for building tight
  // vertical columns by stacking them with controlled kerning.
  _buildCharGeos() {
    this._charGeos = {};
    let h = 0;
    for (const c of '0123456789ABCDEF') {
      const g = new TextGeometry(c, { font: this.font, size: 11, height: 1, curveSegments: 1 });
      g.center();
      g.computeBoundingBox();
      h = Math.max(h, g.boundingBox.max.y - g.boundingBox.min.y);
      this._charGeos[c] = g;
    }
    this._charHeight = h;
  }

  // A vertical (tategaki) key: upright characters stacked with tight kerning.
  _buildVerticalGeo(up) {
    const spacing = this._charHeight * 1.18; // tight vertical kerning
    const mat = new THREE.Matrix4();
    const parts = [];
    for (let i = 0; i < up.length; i++) {
      const cg = this._charGeos[up[i]];
      if (!cg) continue;
      const g = cg.clone();
      g.applyMatrix4(mat.makeTranslation(0, -i * spacing, 0));
      parts.push(g);
    }
    const merged = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    if (merged) merged.center();
    return merged;
  }

  // Spawn a full key that rains down from a random point above the viewport and
  // runs all the way through to below the bottom before it is removed. Keys are
  // uppercased and keep a fixed orientation (horizontal, or vertical/tategaki).
  spawnText(text) {
    if (!this.showText || !this.font || this._texts.length > 26) return;
    try {
      const up = text.toUpperCase();
      const geo = (this.keyVertical && this._charGeos) ? this._buildVerticalGeo(up) : null;
      const finalGeo = geo || (() => { const g = new TextGeometry(up, { font: this.font, size: 11, height: 1, curveSegments: 1 }); g.center(); return g; })();
      const mesh = new THREE.Mesh(finalGeo, this._textMaterial);
      // Random start: spread across the width (out to the edges), varied depth, above the view.
      mesh.position.set((Math.random() - 0.5) * 2300, 950 + Math.random() * 450, (Math.random() - 0.5) * 1000);
      mesh.userData.fall = 170 + Math.random() * 170;  // units/sec (frame-rate independent)
      this.scene.add(mesh);
      this._texts.push(mesh);
    } catch { /* cosmetic; never break the loop */ }
  }

  _updateText() {
    for (let i = this._texts.length - 1; i >= 0; i--) {
      const m = this._texts[i];
      m.position.y -= m.userData.fall * this._dt;        // rain down (time-based)
      m.quaternion.copy(this.camera.quaternion);         // face the camera, upright (vertical stacking is in the geometry)
      // Remove only well below the viewport (beyond the widest camera breath), so
      // a key always runs through to the bottom of the screen.
      if (m.position.y < -1050) { this.scene.remove(m); m.geometry.dispose(); this._texts.splice(i, 1); }
    }
  }
}
