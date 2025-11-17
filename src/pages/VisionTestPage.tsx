import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { analyzeCardFull, FullCardAnalysis } from "@/lib/analyzeCardFull";
import CardVisionInsights from "@/components/cards/CardVisionInsights";
import { supabase } from "@/integrations/supabase/client";

export default function VisionTestPage() {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<FullCardAnalysis | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      setAnalysis(null);
    }
  };

  const handleAnalyze = async () => {
    if (!imageFile) {
      toast.error("Please select an image first");
      return;
    }

    setAnalyzing(true);
    try {
      // Get authenticated session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("You must be logged in to use this feature");
        return;
      }

      // Upload image to Supabase storage
      const fileName = `vision-test/${session.user.id}/${Date.now()}-${imageFile.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("card-images")
        .upload(fileName, imageFile, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from("card-images")
        .getPublicUrl(uploadData.path);

      // Analyze with enhanced vision
      const result = await analyzeCardFull(publicUrl);
      setAnalysis(result);
      toast.success("Analysis complete!");
    } catch (error) {
      console.error("Analysis error:", error);
      toast.error("Failed to analyze image");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Google Vision Test Lab</h1>
        <p className="text-muted-foreground mt-1">
          Test enhanced Google Vision features: labels, logos, and web detection
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upload Section */}
        <Card>
          <CardHeader>
            <CardTitle>Upload Test Image</CardTitle>
            <CardDescription>Upload a card image to analyze</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="image-upload">Select Image</Label>
              <Input
                id="image-upload"
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                disabled={analyzing}
              />
            </div>

            {imagePreview && (
              <div className="space-y-4">
                <img
                  src={imagePreview}
                  alt="Preview"
                  className="w-full max-h-96 object-contain rounded border"
                />
                <Button
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="w-full"
                >
                  {analyzing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Analyze with Google Vision
                    </>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Results Section */}
        <div className="space-y-6">
          {analysis && (
            <>
              {/* Vision Insights */}
              <CardVisionInsights
                labels={analysis.vision.labels}
                logos={analysis.vision.logos}
                webDetection={analysis.vision.web_detection}
              />

              {/* OCR Results */}
              <Card>
                <CardHeader>
                  <CardTitle>OCR Text</CardTitle>
                  <CardDescription>
                    Detected text from the image
                    {analysis.vision.ocr_locale && ` (${analysis.vision.ocr_locale})`}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="p-4 bg-muted rounded-lg max-h-48 overflow-y-auto">
                    <pre className="text-sm whitespace-pre-wrap">
                      {analysis.vision.ocr_text || "No text detected"}
                    </pre>
                  </div>
                </CardContent>
              </Card>

              {/* Condition Estimate */}
              <Card>
                <CardHeader>
                  <CardTitle>Condition Estimate</CardTitle>
                  <CardDescription>AI-powered grading analysis</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold mb-2">Grade Range</p>
                    <div className="flex items-center gap-2">
                      <div className="text-2xl font-bold">
                        {analysis.condition_estimate.raw_grade_estimate.min} - {analysis.condition_estimate.raw_grade_estimate.max}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        ({Math.round(analysis.condition_estimate.raw_grade_estimate.confidence * 100)}% confidence)
                      </div>
                    </div>
                  </div>

                  {analysis.condition_estimate.condition_notes.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold mb-2">Condition Notes</p>
                      <ul className="list-disc list-inside space-y-1 text-sm">
                        {analysis.condition_estimate.condition_notes.map((note, idx) => (
                          <li key={idx}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div>
                    <p className="text-sm font-semibold mb-2">Recommendation</p>
                    <p className="text-sm text-muted-foreground">
                      {analysis.condition_estimate.recommended_action}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {!analysis && !analyzing && (
            <Card className="p-12 text-center">
              <p className="text-muted-foreground">
                Upload and analyze an image to see results
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}