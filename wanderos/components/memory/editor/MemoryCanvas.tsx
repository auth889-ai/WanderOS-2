"use client";

import { useEffect, useRef } from "react";
import { Stage, Layer as KLayer, Rect, Text, Image as KImage, Transformer } from "react-konva";
import useImage from "use-image";
import type Konva from "konva";
import { useEditor, type Side } from "@/lib/memory/editorStore";
import { PAGE_W, PAGE_H, type Layer } from "@/lib/memory/types";

const GUTTER = 24;
const FULL_W = PAGE_W * 2 + GUTTER;
const DISPLAY_W = 940;
const SCALE = DISPLAY_W / FULL_W;

const THEME_BG: Record<string, string> = {
  vintage: "#f1e6d2", "cherry-blossom": "#fbe7ec", "whimsical-dream": "#ece4f8", "sunset-coast": "#fbe5d3", "mono-minimal": "#f5f4f2"
};

type RefSetter = (node: Konva.Node | null) => void;

function PhotoNode({ src, setRef, ...rest }: { src?: string; setRef: RefSetter } & Record<string, unknown>) {
  const [img] = useImage(src || "", "anonymous");
  return <KImage image={img} ref={setRef as never} {...rest} />;
}

function LayerNode({ layer, side, originX, onSelect, setRef }: { layer: Layer; side: Side; originX: number; onSelect: () => void; setRef: RefSetter }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const pos = { x: originX + layer.x, y: layer.y, rotation: layer.rotation || 0 };
  const handlers = {
    draggable: true,
    onClick: onSelect,
    onTap: onSelect,
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => updateLayer(side, layer.id, { x: e.target.x() - originX, y: e.target.y() }),
    onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
      const n = e.target;
      const sx = n.scaleX(), sy = n.scaleY();
      n.scaleX(1); n.scaleY(1);
      updateLayer(side, layer.id, { x: n.x() - originX, y: n.y(), w: Math.max(20, layer.w * sx), h: Math.max(20, layer.h * sy), rotation: n.rotation() });
    }
  };

  if (layer.kind === "photo")
    return <PhotoNode src={layer.src} setRef={setRef} {...pos} width={layer.w} height={layer.h} cornerRadius={layer.variant === "full-bleed" ? 6 : 2} stroke="#ffffff" strokeWidth={layer.variant === "polaroid" ? 10 : 4} {...handlers} />;

  if (layer.kind === "sticker")
    return <Text ref={setRef as never} {...pos} text={layer.text || "⭐"} width={layer.w} fontSize={Math.min(layer.h, layer.w) * 0.8} {...handlers} />;

  if (layer.kind === "decoration")
    return <Rect ref={setRef as never} {...pos} width={layer.w} height={layer.h} fill="rgba(150,120,80,0.32)" cornerRadius={4} {...handlers} />;

  const fs = layer.role === "title" ? 52 : layer.role === "quote" ? 32 : layer.role === "date" ? 20 : layer.role === "photo-caption" ? 18 : layer.role === "caption" ? 22 : 26;
  return (
    <Text
      ref={setRef as never} {...pos} text={layer.text || "Double-click to edit"} width={layer.w} fontSize={fs}
      fontFamily="Georgia, serif" fontStyle={layer.role === "quote" ? "italic" : layer.role === "title" ? "bold" : "normal"} fill="#3a2f25" lineHeight={1.4}
      onDblClick={() => { const v = window.prompt("Edit text", layer.text || ""); if (v != null) updateLayer(side, layer.id, { text: v }); }}
      {...handlers}
    />
  );
}

/** The react-konva spread editor — two pages side by side, drag/resize/rotate via a Transformer. */
export function MemoryCanvas() {
  const doc = useEditor((s) => s.doc);
  const activeSpread = useEditor((s) => s.activeSpread);
  const selected = useEditor((s) => s.selected);
  const select = useEditor((s) => s.select);
  const trRef = useRef<Konva.Transformer>(null);
  const nodes = useRef<Record<string, Konva.Node>>({});

  const spread = doc.spreads[activeSpread];

  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = selected ? nodes.current[selected.id] : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selected, activeSpread, doc]);

  if (!spread) return <div className="grid h-64 place-items-center text-white/40">No spread.</div>;
  const theme = spread.theme || doc.theme || "vintage";
  const bg = THEME_BG[theme] || THEME_BG.vintage;

  const renderPage = (side: Side, originX: number) => {
    const page = side === "left" ? spread.leftPage : spread.rightPage;
    return (
      <>
        <Rect x={originX} y={0} width={PAGE_W} height={PAGE_H} fill={bg} shadowBlur={24} shadowColor="rgba(0,0,0,0.25)" shadowOffsetX={side === "left" ? -2 : 2} />
        {page.layers.map((l) => (
          <LayerNode key={l.id} layer={l} side={side} originX={originX} onSelect={() => select({ side, id: l.id })}
            setRef={(node) => { if (node) nodes.current[l.id] = node; else delete nodes.current[l.id]; }} />
        ))}
      </>
    );
  };

  return (
    <div className="overflow-auto rounded-xl bg-black/25 p-3">
      <Stage
        width={FULL_W * SCALE} height={PAGE_H * SCALE} scaleX={SCALE} scaleY={SCALE}
        onMouseDown={(e) => { if (e.target === e.target.getStage()) select(null); }}
        onTouchStart={(e) => { if (e.target === e.target.getStage()) select(null); }}
      >
        <KLayer>
          {renderPage("left", 0)}
          {renderPage("right", PAGE_W + GUTTER)}
          <Transformer ref={trRef} rotateEnabled keepRatio={false} anchorSize={10} borderStroke="#ef6d5b" anchorStroke="#ef6d5b"
            boundBoxFunc={(oldB, newB) => (newB.width < 20 || newB.height < 20 ? oldB : newB)} />
        </KLayer>
      </Stage>
    </div>
  );
}
