import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const outputRoot = path.join(rootDir, "public", "ocr-assets");
const ortSource = path.join(rootDir, "node_modules", "onnxruntime-web", "dist");
const modelSource = path.join(rootDir, "node_modules", "@gutenye", "ocr-models");
const ortOutput = path.join(outputRoot, "ort");
const modelOutput = path.join(outputRoot, "models");

const requiredModels = [
  "ch_PP-OCRv4_det_infer.onnx",
  "ch_PP-OCRv4_rec_infer.onnx",
  "ppocr_keys_v1.txt",
];

const requiredOrtAssets = [
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
];

async function assertDirectory(directory) {
  const info = await stat(directory).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(`Required OCR dependency directory is missing: ${directory}`);
  }
}

async function assertBinaryMagic(filePath, expectedBytes, label) {
  const data = await readFile(filePath);
  if (data.length < expectedBytes.length) {
    throw new Error(`${label} is empty or truncated: ${filePath}`);
  }
  for (let index = 0; index < expectedBytes.length; index += 1) {
    if (data[index] !== expectedBytes[index]) {
      throw new Error(`${label} has invalid binary header: ${filePath}`);
    }
  }
}

async function walkFiles(directory) {
  const results = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkFiles(fullPath)));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
}

async function findRequiredFile(root, filename) {
  const files = await walkFiles(root);
  const exact = files.find((file) => path.basename(file) === filename);
  if (exact) return exact;

  const available = files
    .filter((file) => /\.(?:onnx|txt)$/i.test(file))
    .map((file) => path.relative(root, file))
    .sort();

  throw new Error(
    [
      `Required OCR model asset was not found anywhere inside ${root}: ${filename}`,
      "Available OCR package files:",
      ...available.map((file) => `  - ${file}`),
    ].join("\n"),
  );
}

async function copyOrtAssets() {
  const entries = await readdir(ortSource, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /^ort-wasm.*\.(?:wasm|mjs)$/.test(entry.name))
    .map((entry) => entry.name);

  for (const required of requiredOrtAssets) {
    if (!files.includes(required)) {
      throw new Error(`Required ONNX Runtime asset is missing: ${required}`);
    }
  }

  await mkdir(ortOutput, { recursive: true });
  for (const filename of files) {
    await cp(path.join(ortSource, filename), path.join(ortOutput, filename));
  }

  await assertBinaryMagic(
    path.join(ortOutput, "ort-wasm-simd-threaded.wasm"),
    [0x00, 0x61, 0x73, 0x6d],
    "WebAssembly runtime",
  );
}

async function copyModelAssets() {
  await mkdir(modelOutput, { recursive: true });

  for (const filename of requiredModels) {
    const source = await findRequiredFile(modelSource, filename);
    const sourceInfo = await stat(source).catch(() => null);
    if (!sourceInfo?.isFile() || sourceInfo.size === 0) {
      throw new Error(`Required OCR model asset is missing or empty: ${source}`);
    }
    await cp(source, path.join(modelOutput, filename));
    console.log(`Copied OCR model: ${path.relative(modelSource, source)} -> ${filename}`);
  }

  for (const filename of requiredModels.filter((name) => name.endsWith(".onnx"))) {
    const data = await readFile(path.join(modelOutput, filename));
    const prefix = data.subarray(0, 32).toString("utf8").trimStart().toLowerCase();
    if (prefix.startsWith("<!doctype") || prefix.startsWith("<html")) {
      throw new Error(`OCR model resolved to HTML instead of ONNX data: ${filename}`);
    }
  }
}

await assertDirectory(ortSource);
await assertDirectory(modelSource);
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await copyOrtAssets();
await copyModelAssets();

console.log(`OCR runtime and model assets synced to ${outputRoot}`);
