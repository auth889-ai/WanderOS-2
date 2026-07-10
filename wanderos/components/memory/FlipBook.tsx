"use client";

import { forwardRef } from "react";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - react-pageflip ships loose types
import HTMLFlipBook from "react-pageflip";
import { PageContent } from "./SpreadRenderer";
import { PAGE_W, PAGE_H, type MemoryBookDoc, type Page } from "@/lib/memory/types";

/** One book page sized for the flipbook (forwardRef is required by react-pageflip). */
const PageCard = forwardRef<HTMLDivElement, { page: Page; theme?: string; width: number }>(({ page, theme, width }, ref) => {
  const scale = width / PAGE_W;
  return (
    <div ref={ref} className="memory-page" style={{ width, height: Math.round(width * (PAGE_H / PAGE_W)), overflow: "hidden", background: "#fff" }}>
      <div style={{ width: PAGE_W, height: PAGE_H, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <PageContent page={page} theme={theme} />
      </div>
    </div>
  );
});
PageCard.displayName = "PageCard";

const Book = HTMLFlipBook as unknown as React.ComponentType<Record<string, unknown>>;

/** A real flippable book — drag a corner / click edges to turn pages. */
export function FlipBook({ doc, width = 520 }: { doc: MemoryBookDoc; width?: number }) {
  const pages: { page: Page; theme?: string }[] = [];
  for (const s of doc.spreads) {
    pages.push({ page: s.leftPage, theme: s.theme || doc.theme });
    pages.push({ page: s.rightPage, theme: s.theme || doc.theme });
  }
  const height = Math.round(width * (PAGE_H / PAGE_W));

  return (
    <div className="book-shell">
      <Book
        width={width} height={height} size="fixed"
        minWidth={width} maxWidth={width} minHeight={height} maxHeight={height}
        usePortrait={false} startPage={0}
        drawShadow maxShadowOpacity={0.5} showCover={false} flippingTime={650} mobileScrollSupport useMouseEvents
        className="memory-flipbook" style={{}}
      >
        {pages.map((p, i) => <PageCard key={i} page={p.page} theme={p.theme} width={width} />)}
      </Book>
      <div className="book-spine" />
    </div>
  );
}
