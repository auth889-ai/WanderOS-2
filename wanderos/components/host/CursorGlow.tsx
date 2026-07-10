"use client";

import { useEffect, useState } from "react";

/** A soft light that follows the cursor — the subtle premium touch from travelmate's host shell. */
export function CursorGlow() {
  const [pos, setPos] = useState({ x: -400, y: -400 });
  useEffect(() => {
    const move = (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", move);
    return () => window.removeEventListener("mousemove", move);
  }, []);
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0"
      style={{ background: `radial-gradient(600px at ${pos.x}px ${pos.y}px, rgba(255,255,255,0.06), transparent 60%)` }}
    />
  );
}
