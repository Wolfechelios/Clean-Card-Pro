import { useCallback } from "react";
import { toast } from "sonner";

const MAX_SIZE = 500 * 1024 * 1024; // 500MB

interface UseFileUploadOptions {
  onSingleFile: (file: File) => void;
  onMultipleFiles: (files: File[]) => void;
}

export function useFileUpload({ onSingleFile, onMultipleFiles }: UseFileUploadOptions) {
  const validateFiles = useCallback((files: File[]): boolean => {
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    
    if (totalSize > MAX_SIZE) {
      toast.error("Total file size exceeds 500MB limit");
      return false;
    }
    
    const imageFiles = files.filter(f => f.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      toast.error("Please select image files only");
      return false;
    }
    
    return true;
  }, []);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    if (!validateFiles(fileArray)) return;

    if (fileArray.length === 1) {
      onSingleFile(fileArray[0]);
    } else {
      onMultipleFiles(fileArray);
    }
  }, [onSingleFile, onMultipleFiles, validateFiles]);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files).filter(f => f.type.startsWith("image/"));
    
    if (!validateFiles(files)) return;

    if (files.length === 1) {
      onSingleFile(files[0]);
    } else {
      onMultipleFiles(files);
    }
  }, [onSingleFile, onMultipleFiles, validateFiles]);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
  }, []);

  return {
    handleFileSelect,
    handleDrop,
    handleDragOver,
  };
}
