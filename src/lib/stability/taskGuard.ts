
let busy = false;
export async function guardedTask<T>(task: () => Promise<T>) {
  if (busy) return;
  busy = true;
  try { return await task(); }
  finally { busy = false; }
}
