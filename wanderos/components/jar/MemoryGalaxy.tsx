"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { X } from "lucide-react";

/** Memory Galaxy — the traveler's photos as a glowing 3D constellation. Drag to orbit, scroll to zoom. Raw Three.js (free). */
export function MemoryGalaxy({ photos, onClose }: { photos: string[]; onClose: () => void }) {
  const mount = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    let W = el.clientWidth, H = el.clientHeight;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0614, 0.018);
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 1000);
    camera.position.z = 20;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    el.appendChild(renderer.domElement);

    // star field
    const starGeo = new THREE.BufferGeometry();
    const N = 1400, pos = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) pos[i] = (Math.random() - 0.5) * 140;
    starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffe9c8, size: 0.16, transparent: true, opacity: 0.8 }));
    scene.add(stars);

    // nebula glow
    const glow = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 32), new THREE.MeshBasicMaterial({ color: 0x3a2566, transparent: true, opacity: 0.12, side: THREE.BackSide }));
    scene.add(glow);

    // photo planes on a sphere (golden-spiral distribution)
    const group = new THREE.Group();
    scene.add(group);
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    const list = photos.slice(0, 48);
    list.forEach((url, i) => {
      const k = list.length > 1 ? i / (list.length - 1) : 0.5;
      const phi = Math.acos(1 - 2 * k);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const r = 11;
      const x = r * Math.sin(phi) * Math.cos(theta), y = r * Math.sin(phi) * Math.sin(theta), z = r * Math.cos(phi);
      const mat = new THREE.MeshBasicMaterial({ color: 0x4a3a66, side: THREE.DoubleSide, transparent: true });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.8), mat);
      mesh.position.set(x, y, z);
      mesh.lookAt(0, 0, 0);
      group.add(mesh);
      loader.load(url, (tex) => { mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true; }, undefined, () => {});
    });

    // controls — drag to orbit, wheel to zoom
    let dragging = false, px = 0, py = 0, rotX = 0.1, rotY = 0, autoY = 0;
    const down = (e: PointerEvent) => { dragging = true; px = e.clientX; py = e.clientY; };
    const move = (e: PointerEvent) => { if (!dragging) return; rotY += (e.clientX - px) * 0.005; rotX += (e.clientY - py) * 0.005; px = e.clientX; py = e.clientY; };
    const up = () => { dragging = false; };
    const wheel = (e: WheelEvent) => { camera.position.z = Math.min(34, Math.max(8, camera.position.z + e.deltaY * 0.02)); };
    renderer.domElement.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    renderer.domElement.addEventListener("wheel", wheel, { passive: true });

    let raf = 0;
    const animate = () => {
      autoY += 0.0008;
      group.rotation.y = rotY + autoY;
      group.rotation.x = rotX;
      stars.rotation.y += 0.0003;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    const onResize = () => { W = el.clientWidth; H = el.clientHeight; camera.aspect = W / H; camera.updateProjectionMatrix(); renderer.setSize(W, H); };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
    };
  }, [photos]);

  return createPortal(
    <div className="fixed inset-0 z-[2000] bg-[#0a0614]">
      <div ref={mount} className="h-full w-full cursor-grab active:cursor-grabbing" />
      <div className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 text-center">
        <p className="text-lg font-bold tracking-wide text-[#f3e3c0]" style={{ fontFamily: "Georgia, serif" }}>Memory Galaxy</p>
        <p className="text-xs text-white/55">drag to orbit · scroll to zoom · {photos.length} memories</p>
      </div>
      <button onClick={onClose} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-white/10 text-white backdrop-blur hover:bg-white/20"><X size={18} /></button>
    </div>,
    document.body
  );
}
