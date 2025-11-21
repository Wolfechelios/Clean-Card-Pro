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
      
      // Upload to storage
      const fileExt = imageFile.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
      const filePath = `cards/${fileName}`;

      const { error: uploadError, data } = await supabase.storage
        .from('card-images')
        .upload(filePath, imageFile, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        console.error("Upload error:", uploadError);
        toast.error("Failed to upload image");
        return;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('card-images')
        .getPublicUrl(filePath);

      console.log("Image uploaded:", publicUrl);
      toast.success("Image uploaded! Processing...");
      
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
