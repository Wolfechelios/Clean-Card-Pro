import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MobileCameraScanner } from "@/components/scanner/MobileCameraScanner";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function MobileScanPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id || null);
      setLoading(false);
    };
    getUser();
  }, []);

  const handleImageCaptured = async (imageFile: File) => {
    try {
      console.log("Image captured:", imageFile.name, imageFile.size);

      const { fileToDataUrl } = await import("@/lib/local/fileToDataUrl");
      const publicUrl = await fileToDataUrl(imageFile);

      console.log("Image stored locally:", publicUrl.slice(0, 64) + "…");
      toast.success("Image captured! Processing...");

      // TODO: Trigger card identification here
    } catch (error: any) {
      console.error("Error handling captured image:", error);
      toast.error("Failed to process image");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background p-4 text-center">
        <div>
          <p className="text-muted-foreground mb-4">Please log in to scan cards</p>
          <a href="/auth" className="text-primary underline">Go to Login</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <MobileCameraScanner userId={userId} onImageCaptured={handleImageCaptured} />
    </div>
  );
}
