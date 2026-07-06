// Local-first replacement for cloud storage uploads.
// Converts a File/Blob to a persistent data URL that can be stored in
// the local card record as `image_url`. No network I/O.

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}
