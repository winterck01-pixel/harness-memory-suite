import { multiply, fromTranslation, fromScale, transformBounds } from './matrix.js';

export const SCALE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function layerBounds(layers, assets) {
  const boxes = layers.map(layer => {
    const asset = assets.find(a => a.id === layer.assetId);
    return asset ? transformBounds(layer.matrix, asset.width, asset.height) : null;
  }).filter(Boolean);
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y };
}

export function scaleSelection(bbox, handle, start, end, canvas, keepAspect) {
  if (!bbox || !canvas || !SCALE_HANDLES.includes(handle) || ![...start, ...end, bbox.x, bbox.y, bbox.width, bbox.height].every(Number.isFinite) || bbox.width <= 0 || bbox.height <= 0) return null;
  const west = handle.includes('w'), east = handle.includes('e');
  const north = handle.includes('n'), south = handle.includes('s');
  const hx = bbox.x + (west ? 0 : east ? bbox.width : bbox.width / 2);
  const hy = bbox.y + (north ? 0 : south ? bbox.height : bbox.height / 2);
  const px = bbox.x + (west ? bbox.width : east ? 0 : bbox.width / 2);
  const py = bbox.y + (north ? bbox.height : south ? 0 : bbox.height / 2);
  const vx = hx - px, vy = hy - py;
  const ex = vx + end[0] - start[0], ey = vy + end[1] - start[1];
  let sx = vx ? ex / vx : 1, sy = vy ? ey / vy : 1;
  const maxFor = (lo, hi, pivot, limit) => Math.min(lo < pivot ? pivot / (pivot - lo) : Infinity, hi > pivot ? (limit - pivot) / (hi - pivot) : Infinity);
  const maxX = maxFor(bbox.x, bbox.x + bbox.width, px, canvas.width);
  const maxY = maxFor(bbox.y, bbox.y + bbox.height, py, canvas.height);
  const minX = Math.min(1, 8 / bbox.width), minY = Math.min(1, 8 / bbox.height);
  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
  if (keepAspect) {
    const min = Math.max(minX, minY), max = Math.min(maxX, maxY);
    if (max < min) return null;
    sx = sy = clamp((ex * vx + ey * vy) / (vx * vx + vy * vy), min, max);
  } else {
    if ((vx && maxX < minX) || (vy && maxY < minY)) return null;
    sx = vx ? clamp(sx, minX, maxX) : 1;
    sy = vy ? clamp(sy, minY, maxY) : 1;
  }
  const matrix = multiply(multiply(fromTranslation(px, py), fromScale(sx, sy)), fromTranslation(-px, -py));
  return { matrix, bounds: {x:px+(bbox.x-px)*sx,y:py+(bbox.y-py)*sy,width:bbox.width*sx,height:bbox.height*sy}, scaleX: sx, scaleY: sy };
}
