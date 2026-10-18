import {access} from 'node:fs/promises';

// Availability is a read-time view. Keep library/task metadata for file restoration.
export async function availableAssets(assets, check = access) {
  const present = await Promise.all(assets.map(async asset => {
    try { await check(asset.path); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }));
  return assets.filter((_asset, index) => present[index]);
}

export function tasksWithAvailableAssets(tasks, library) {
  const available = new Map(library.map(asset => [asset.id, asset]));
  return tasks.map(task => {
    const results = (task.results || []).filter(image => available.has(image.id))
      .map(image => ({...image, name: available.get(image.id).name || image.name}));
    return {...task, results, isTrashed: task.status === 'completed' &&
      (task.results || []).length > 0 && results.length === 0};
  });
}
