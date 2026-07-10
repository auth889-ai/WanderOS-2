"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { X } from "lucide-react";

/** Time-Collapse Tunnel — fly forward through a glowing wormhole of your memories, chronologically. Raw Three.js (free). */
export function TimeTunnel({ photos, onClose }: { photos: string[]; onClose: () => void }) {
  const mount = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    let W = el.clientWidth, H = el.clientHeight;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0614, 0.028);
    const camera = new THREE.PerspectiveCamera(78, W / H, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    el.appendChild(renderer.domElement);

    const SPACING = 8, R = 6, RINGS = 46;
    // glowing rings (the wormhole)
    const ringGroup = new THREE.Group();
    scene.add(ringGroup);
    for (let i = 0; i < RINGS; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(R + Math.sin(i * 0.4) * 0.6, 0.045, 8, 64),
        new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(0.78 - i * 0.006, 0.7, 0.55), transparent: true, opacity: 0.55 })
      );
      ring.position.z = -i * SPACING;
      ring.rotation.z = i * 0.12;
      ringGroup.add(ring);
    }

    // memory photos on the tunnel wall (chronological)
    const group = new THREE.Group();
    scene.add(group);
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    const list = photos.slice(0, 30);
    list.forEach((url, i) => {
      const ang = i * 1.1;
      const z = -i * SPACING - 4;
      const x = Math.cos(ang) * (R - 1.4), y = Math.sin(ang) * (R - 1.4);
      const mat = new THREE.MeshBasicMaterial({ color: 0x4a3a66, side: THREE.DoubleSide, transparent: true });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3, 2), mat);
      mesh.position.set(x, y, z);
      mesh.lookAt(0, 0, z);
      group.add(mesh);
      loader.load(url, (t) => { mat.map = t; mat.color.set(0xffffff); mat.needsUpdate = true; }, undefined, () => {});
    });

    // streaking stars
    const starGeo = new THREE.BufferGeometry();
    const N = 800, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 16; pos[i * 3 + 1] = (Math.random() - 0.5) * 16; pos[i * 3 + 2] = -Math.random() * RINGS * SPACING; }
    starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffe9c8, size: 0.08, transparent: true, opacity: 0.8 }));
    scene.add(stars);

    const total = RINGS * SPACING;
    let z = 4, raf = 0;
    const animate = () => {
      z -= 0.28;
      if (z < -total + 24) z = 4; // loop the journey
      camera.position.z = z;
      camera.rotation.z += 0.0016;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    const onResize = () => { W = el.clientWidth; H = el.clientHeight; camera.aspect = W / H; camera.updateProjectionMatrix(); renderer.setSize(W, H); };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
    };
  }, [photos]);

  return createPortal(
    <div className="fixed inset-0 z-[2000] bg-[#0a0614]">
      <div ref={mount} className="h-full w-full" />
      <div className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 text-center">
        <p className="text-lg font-bold tracking-wide text-[#f3e3c0]" style={{ fontFamily: "Georgia, serif" }}>Time-Collapse Tunnel</p>
        <p className="text-xs text-white/55">travelling through your memories…</p>
      </div>
      <button onClick={onClose} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-white/10 text-white backdrop-blur hover:bg-white/20"><X size={18} /></button>
    </div>,
    document.body
  );
}
