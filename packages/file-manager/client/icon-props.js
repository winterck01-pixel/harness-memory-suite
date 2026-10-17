


export function fileIconProps(entry) {
  if (entry?.dir === true) return { kind: 'folder' }
  return { path: typeof entry?.path === 'string' ? entry.path : '' }
}
