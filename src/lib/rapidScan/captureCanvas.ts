export type CameraRotation = 0 | 90 | 180 | 270;

export function prepareCameraCaptureCanvases(
  video: HTMLVideoElement,
  originalCanvas: HTMLCanvasElement,
  previewCanvas: HTMLCanvasElement,
  rotation: CameraRotation,
): void {
  const sourceWidth = video.videoWidth || 1920;
  const sourceHeight = video.videoHeight || 1080;
  originalCanvas.width = sourceWidth;
  originalCanvas.height = sourceHeight;

  const originalContext = originalCanvas.getContext("2d");
  if (!originalContext) throw new Error("Capture canvas unavailable");
  originalContext.drawImage(video, 0, 0, sourceWidth, sourceHeight);

  const rotatedSideways = rotation === 90 || rotation === 270;
  previewCanvas.width = rotatedSideways ? sourceHeight : sourceWidth;
  previewCanvas.height = rotatedSideways ? sourceWidth : sourceHeight;

  const previewContext = previewCanvas.getContext("2d");
  if (!previewContext) throw new Error("Preview canvas unavailable");

  previewContext.save();
  if (rotation === 90) {
    previewContext.translate(previewCanvas.width, 0);
    previewContext.rotate(Math.PI / 2);
  } else if (rotation === 180) {
    previewContext.translate(previewCanvas.width, previewCanvas.height);
    previewContext.rotate(Math.PI);
  } else if (rotation === 270) {
    previewContext.translate(0, previewCanvas.height);
    previewContext.rotate((3 * Math.PI) / 2);
  }
  previewContext.drawImage(
    originalCanvas,
    0,
    0,
    sourceWidth,
    sourceHeight,
  );
  previewContext.restore();
}
