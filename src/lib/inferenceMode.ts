export async function isLocalLLMAvailable() {
  try {
    const res = await fetch("http://localhost:11434");
    return res.ok;
  } catch {
    return false;
  }
}

export function isOnline() {
  return navigator.onLine;
}
