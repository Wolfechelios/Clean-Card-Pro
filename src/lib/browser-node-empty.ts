// Browser-safe empty shim for optional Node-only imports pulled in by browser WASM bundles.
// Some third-party browser builds reference fs/path/crypto defensively; Vite warns when it externalizes them.
// This module keeps production browser builds quiet without adding Node polyfills or changing runtime behavior.

export const readFileSync = () => undefined;
export const writeFileSync = () => undefined;
export const existsSync = () => false;
export const mkdirSync = () => undefined;
export const readdirSync = () => [];
export const statSync = () => ({ isFile: () => false, isDirectory: () => false });

export const resolve = (...parts: string[]) => parts.filter(Boolean).join("/");
export const join = (...parts: string[]) => parts.filter(Boolean).join("/");
export const dirname = (value = "") => value.split("/").slice(0, -1).join("/") || ".";
export const basename = (value = "") => value.split("/").pop() || "";
export const extname = (value = "") => {
  const base = basename(value);
  const index = base.lastIndexOf(".");
  return index > 0 ? base.slice(index) : "";
};

export const randomBytes = (size = 0) => new Uint8Array(size);
export const createHash = () => ({
  update: () => ({ digest: () => "" }),
  digest: () => "",
});

export default {};
