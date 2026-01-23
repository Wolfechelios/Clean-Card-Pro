export function useNativeCamera(): {
  isNative: boolean;
  takePhoto: () => Promise<{ blob: Blob } | null>;
} {
  const isNative = false;

  return {
    isNative,
    takePhoto: async () => null,
  };
}
