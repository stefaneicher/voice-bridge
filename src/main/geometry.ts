export interface Point {
  x: number;
  y: number;
}
export interface Size {
  width: number;
  height: number;
}
export interface Rect extends Point, Size {}

/** Popup: top-left 16 px right/below the pointer, clamped to the monitor's work area. */
export function popupPosition(cursor: Point, size: Size, workArea: Rect, offset = 16): Point {
  let x = cursor.x + offset;
  let y = cursor.y + offset;
  if (x + size.width > workArea.x + workArea.width) x = cursor.x - offset - size.width;
  if (y + size.height > workArea.y + workArea.height)
    y = workArea.y + workArea.height - size.height;
  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - size.width));
  y = Math.max(workArea.y, y);
  return { x: Math.round(x), y: Math.round(y) };
}

/** Size of the anchored part when `above` px of content are stacked on top of it. */
export function anchoredSize(size: Size, above: number): Size {
  return { width: size.width, height: Math.max(1, size.height - Math.max(0, above)) };
}

/** Moves a position of the anchored part up by the stacked content, kept inside the work area. */
export function stackAbove(pos: Point, above: number, workArea: Rect): Point {
  return { x: pos.x, y: Math.max(workArea.y, pos.y - Math.max(0, above)) };
}

/** Pill and dictate toast: centred, `marginBottom` above the bottom of the work area. */
export function bottomCenter(size: Size, workArea: Rect, marginBottom = 92): Point {
  return {
    x: Math.round(workArea.x + (workArea.width - size.width) / 2),
    y: Math.round(workArea.y + workArea.height - size.height - marginBottom),
  };
}

export function bottomRight(size: Size, workArea: Rect, margin = 24): Point {
  return {
    x: Math.round(workArea.x + workArea.width - size.width - margin),
    y: Math.round(workArea.y + workArea.height - size.height - margin),
  };
}
