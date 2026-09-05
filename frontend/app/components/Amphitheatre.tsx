"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * A Roman amphitheatre drawn entirely in lines, generated in code.
 *
 * The reference site ships three compressed .glb models for this. Generating
 * the geometry instead keeps the repo binary-free and lets the same mesh
 * serve the loader (drawing in) and the hero (idling), which is the only
 * reason it is worth the ~90 lines.
 */

type Props = {
  /** 0–1. Below 1 the structure is still drawing itself in. */
  progress?: number;
  /** Radians per second of idle rotation. */
  spin?: number;
  /** Camera tilt — low reads as an elevation drawing, high as a plan view. */
  tilt?: number;
  /** Cursor parallax. Off for the loader, on for a hero. */
  parallax?: boolean;
  /** Camera distance. Further back fits the whole structure in frame. */
  distance?: number;
  className?: string;
};

const TIERS = 4;
const COLUMNS = 64;
const ARCH_STEPS = 9;

/** Every vertex pair of the structure, ordered outside-in so that revealing
 *  a prefix of the buffer draws the building from its outer wall inward. */
function buildPositions() {
  const pts: number[] = [];
  const push = (a: THREE.Vector3, b: THREE.Vector3) =>
    pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
  const at = (r: number, a: number, y: number) =>
    new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);

  for (let t = 0; t < TIERS; t++) {
    const inner = t === TIERS - 1;
    const r = 10 - t * 0.55;
    const y0 = -4.4 + t * 2.35;
    const y1 = y0 + (inner ? 1.35 : 1.95);
    const cols = inner ? COLUMNS : Math.round(COLUMNS * 0.62);

    // Floor and ceiling rings of the tier.
    for (const y of [y0, y1]) {
      for (let i = 0; i < cols; i++) {
        push(at(r, (i / cols) * Math.PI * 2, y), at(r, ((i + 1) / cols) * Math.PI * 2, y));
      }
    }

    // The top tier is a solid attic wall: verticals only, no arcade.
    if (inner) {
      for (let i = 0; i < COLUMNS; i++) {
        const a = (i / COLUMNS) * Math.PI * 2;
        push(at(r, a, y0), at(r, a, y1));
      }
      continue;
    }

    // Arcade: a pier either side, then a semicircular arch between them.
    const span = (Math.PI * 2) / cols;
    for (let i = 0; i < cols; i++) {
      const a0 = i * span + span * 0.16;
      const a1 = i * span + span * 0.84;
      const springLine = y0 + (y1 - y0) * 0.5;

      push(at(r, a0, y0), at(r, a0, springLine));
      push(at(r, a1, y0), at(r, a1, springLine));

      // A Roman arch is a true semicircle: its rise equals half the span it
      // crosses. Deriving the rise from the chord (rather than filling the
      // tier height) is the difference between an arcade and a gothic lancet.
      const rise = (r * (a1 - a0)) / 2;
      let prev = at(r, a0, springLine);
      for (let s = 1; s <= ARCH_STEPS; s++) {
        const k = s / ARCH_STEPS;
        const ang = a0 + (a1 - a0) * k;
        const next = at(r, ang, springLine + Math.sin(k * Math.PI) * rise);
        push(prev, next);
        prev = next;
      }
    }

    // Radial ties into the next ring in — the depth cue that stops the
    // whole thing reading as a flat stack of circles.
    if (t < TIERS - 1) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        push(at(r, a, y1), at(r - 0.55, a, y1));
      }
    }
  }

  // The arena floor: a slack ellipse plus its long axis.
  for (let i = 0; i < 96; i++) {
    const a0 = (i / 96) * Math.PI * 2;
    const a1 = ((i + 1) / 96) * Math.PI * 2;
    push(
      new THREE.Vector3(Math.cos(a0) * 5.1, -4.3, Math.sin(a0) * 3.6),
      new THREE.Vector3(Math.cos(a1) * 5.1, -4.3, Math.sin(a1) * 3.6),
    );
  }

  return new Float32Array(pts);
}

export default function Amphitheatre({
  progress = 1,
  spin = 0.085,
  tilt = 0.28,
  parallax = false,
  distance = 23,
  className = "",
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const target = useRef(progress);
  target.current = progress;

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    camera.position.set(0, 9.5 * tilt + 1.4, distance);
    camera.lookAt(0, -0.4, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    Object.assign(renderer.domElement.style, { width: "100%", height: "100%", display: "block" });

    const positions = buildPositions();
    const total = positions.length / 3;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const group = new THREE.Group();
    group.rotation.x = tilt;
    scene.add(group);

    group.add(
      new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({ color: 0x0031f5, transparent: true, opacity: 0.62 }),
      ),
    );
    // A second, brighter pass on a fraction of the vertices reads as the
    // structural edges catching light.
    const accent = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: 0x0031f5, transparent: true, opacity: 0.95 }),
    );
    accent.scale.setScalar(1.001);
    group.add(accent);

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let mx = 0, my = 0, cx = 0, cy = 0;
    const onMove = (e: PointerEvent) => {
      mx = (e.clientX / innerWidth - 0.5) * 2;
      my = (e.clientY / innerHeight - 0.5) * 2;
    };
    if (parallax) addEventListener("pointermove", onMove, { passive: true });

    let shown = 0;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      // Ease the drawn-in fraction toward the target rather than snapping,
      // so a jumpy progress feed still draws smoothly.
      shown += (target.current - shown) * Math.min(dt * 3.4, 1);
      geometry.setDrawRange(0, Math.max(2, Math.floor(total * shown)));

      group.rotation.y += spin * dt;
      if (parallax) {
        cx += (mx - cx) * Math.min(dt * 2.6, 1);
        cy += (my - cy) * Math.min(dt * 2.6, 1);
        group.rotation.x = tilt + cy * 0.11;
        camera.position.x = cx * 2.6;
        camera.lookAt(0, -0.4, 0);
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (parallax) removeEventListener("pointermove", onMove);
      geometry.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [spin, tilt, parallax, distance]);

  return <div ref={host} className={className} aria-hidden />;
}
