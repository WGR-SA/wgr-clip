export interface DropZoneRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface DropZoneBounds {
  id: string
  rect: DropZoneRect
}

// Tauri reports drag positions in physical pixels; DOM rects are logical.
export function pickDropTarget(
  position: { x: number, y: number },
  devicePixelRatio: number,
  zones: readonly DropZoneBounds[]
): string | null {
  const dpr = devicePixelRatio || 1
  const px = position.x / dpr
  const py = position.y / dpr
  for (const z of zones) {
    const r = z.rect
    if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) return z.id
  }
  return null
}
