// Ratio choices come only from the live model catalogue; "auto" cannot define a rectangle.
export function ratioValue(ratio) {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(ratio || ''));
  if (!match) return null;
  const value = Number(match[1]) / Number(match[2]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function commonModelRatios(models, selectedIds) {
  if (!selectedIds.length) return [];
  const selected = selectedIds.map(id => models.find(m => m.id === id));
  if (selected.some(m => !m)) return [];
  return [...new Set(selected[0].ratios || [])].filter(r => ratioValue(r) && selected.every(m => (m.ratios || []).includes(r)));
}

export function chooseTargetRatio(ratios, preferred, canvas) {
  if (ratios.includes(preferred)) return preferred;
  const value = canvas?.width > 0 && canvas?.height > 0 ? canvas.width / canvas.height : 1;
  return [...ratios].sort((a, b) => Math.abs(Math.log(ratioValue(a) / value)) - Math.abs(Math.log(ratioValue(b) / value)))[0] || null;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

export function constrainedTargetRect(start, end, canvas, ratio) {
  const r = ratioValue(ratio);
  if (!r || !canvas || ![...start, ...end].every(Number.isFinite)) return null;
  const ax = clamp(start[0], 0, canvas.width), ay = clamp(start[1], 0, canvas.height);
  const dx = end[0] - ax, dy = end[1] - ay;
  const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
  const maxWidth = sx < 0 ? ax : canvas.width - ax;
  const maxHeight = sy < 0 ? ay : canvas.height - ay;
  const width = Math.min(Math.max(Math.abs(dx), Math.abs(dy) * r), maxWidth, maxHeight * r);
  const height = width / r;
  return { x: sx < 0 ? ax - width : ax, y: sy < 0 ? ay - height : ay, width, height };
}

// Keep the selection centre and area when changing ratio; shrink uniformly at canvas bounds.
export function fitTargetRect(rect, canvas, ratio) {
  const r = ratioValue(ratio);
  if (!r || !rect || !canvas || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return null;
  const width = Math.min(Math.sqrt(rect.width * rect.height * r), canvas.width, canvas.height * r);
  const height = width / r;
  return { x: clamp(rect.x + rect.width / 2 - width / 2, 0, canvas.width - width), y: clamp(rect.y + rect.height / 2 - height / 2, 0, canvas.height - height), width, height };
}
