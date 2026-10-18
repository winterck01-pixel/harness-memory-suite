// Small bounded-cache helpers shared by browser plugin entry points.
export function pruneMap(map, limit, keep = () => false) {
  if (map.size <= limit) return;
  for (const [key, value] of map) {
    if (map.size <= limit) break;
    if (!keep(value, key)) map.delete(key);
  }
}

// Evict aliases and their cached value together so stale identities cannot
// pin idle cache records indefinitely or point at a removed record.
export function pruneAliasedMap(map, aliases, limit, keep = () => false) {
  if (map.size <= limit) return;
  for (const [key, value] of map) {
    if (map.size <= limit) break;
    if (keep(value, key)) continue;
    const valueKeys = new Set([...map].filter(([, candidate]) => candidate === value).map(([candidateKey]) => candidateKey));
    for (const valueKey of valueKeys) map.delete(valueKey);
    for (const [alias, target] of aliases) if (valueKeys.has(target)) aliases.delete(alias);
  }
}

export function pruneObject(object, limit, keep = () => false) {
  const keys = Object.keys(object);
  let excess = keys.length - limit;
  if (excess <= 0) return object;
  for (const key of keys) {
    if (excess <= 0) break;
    if (!keep(object[key], key)) {
      delete object[key];
      excess--;
    }
  }
  return object;
}
