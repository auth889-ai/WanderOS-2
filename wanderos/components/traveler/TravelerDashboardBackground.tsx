"use client";

import { useEffect, useState } from "react";

const BACKGROUNDS = [
  "/images/traveler-dashboard/city.jpg",
  "/images/traveler-dashboard/m4.png",
  "/images/traveler-dashboard/m6.png",
  "/images/traveler-dashboard/m5.png",
  "/images/traveler-dashboard/t_6.png"
];

const BASE_BACKGROUND = BACKGROUNDS[0];

export function TravelerDashboardBackground() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    BACKGROUNDS.forEach((src) => {
      const image = new Image();
      image.src = src;
    });
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((current) => {
        const safeCurrent = current >= BACKGROUNDS.length ? 0 : current;
        return (safeCurrent + 1) % BACKGROUNDS.length;
      });
    }, 7200);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-black">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-100 motion-safe:animate-bgZoom"
        style={{ backgroundImage: `url(${BASE_BACKGROUND})` }}
      />
      {BACKGROUNDS.map((src, imageIndex) => (
        <BackgroundLayer key={src} src={src} visible={imageIndex === index} />
      ))}
      <div className="absolute inset-0 bg-black/34" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/18 to-black/78" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_14%,rgba(255,255,255,.16),transparent_30%),radial-gradient(circle_at_86%_18%,rgba(255,176,143,.14),transparent_30%)]" />
    </div>
  );
}

function BackgroundLayer({ src, visible }: { src: string; visible: boolean }) {
  return (
    <div
      className={[
        "absolute inset-0 bg-cover bg-center transition-opacity duration-[1600ms] ease-in-out motion-safe:animate-bgZoom",
        visible ? "opacity-100" : "opacity-0"
      ].join(" ")}
      style={{ backgroundImage: `url(${src})` }}
    />
  );
}
