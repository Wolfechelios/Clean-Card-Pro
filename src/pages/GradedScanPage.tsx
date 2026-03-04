import { useState, useRef, useCallback, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { insertCardDual } from "@/lib/localCards";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Camera, Upload, Shield, CheckCircle2, XCircle, ExternalLink, RefreshCw, Award, Focus, Package, ScanLine } from "lucide-react";
import { getMaxQualityStream, captureMaxQualityPhoto, triggerFastFocus } from "@/lib/camera-optimizations";
import { ScrollArea } from "@/components/ui/scroll-area";
import QrScanner from "react-qr-scanner";

interface GradedCard {
  id: string;
  card_name: string;
  card_set: string | null;
  card_number: string | null;
  condition: string | null;
  image_url: string;
  current_price_raw: number | null;
  notes: string | null;
  created_at: string;
}

interface GradedCardData {
  gradingCompany: "PSA" | "CGC" | "Beckett" | null;
  certNumber: string;
  grade: string;
  cardName: string;
  cardSet: string;
  cardNumber: string;
  year: string;
  verified: boolean | null;
  verificationUrl: string;
  imageUrl: string;
}

const GRADING_COMPANIES = [
  { id: "PSA", name: "PSA", color: "bg-destructive", description: "Professional Sports Authenticator" },
  { id: "CGC", name: "CGC", color: "bg-primary", description: "Certified Guaranty Company" },
  { id: "Beckett", name: "Beckett", color: "bg-warning", description: "Beckett Grading Services" },
];

export default function GradedScanPage() {
  const { userId } = useAuth();
  const [scanning, setScanning] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cardData, setCardData] = useState<GradedCardData | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [autoVerify, setAutoVerify] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [gradedCards, setGradedCards] = useState<GradedCard[]>([]);
  const [loadingCards, setLoadingCards] = useState(true);
  const [qrResult, setQrResult] = useState<string>("");

  // Fetch graded cards from collection
  const fetchGradedCards = useCallback(async () => {
    if (!userId) return;
    setLoadingCards(true);
    try {
      const { data, error } = await supabase
        .from("cards")
        .select("id, card_name, card_set, card_number, condition, image_url, current_price_raw, notes, created_at")
        .eq("user_id", userId)
        .or("condition.ilike.%PSA%,condition.ilike.%CGC%,condition.ilike.%Beckett%,condition.ilike.%BGS%")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setGradedCards(data || []);
    } catch (err) {
      console.error("Error fetching graded cards:", err);
    } finally {
      setLoadingCards(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchGradedCards();
  }, [fetchGradedCards]);

  const processImage = useCallback(async (imageUrl: string) => {
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-graded-card", {
        body: { imageUrl },
      });

      if (error) throw error;

      const extractedData: GradedCardData = {
        gradingCompany: data.gradingCompany,
        certNumber: data.certNumber || "",
        grade: data.grade || "",
        cardName: data.cardName || "",
        cardSet: data.cardSet || "",
        cardNumber: data.cardNumber || "",
        year: data.year || "",
        verified: null,
        verificationUrl: "",
        imageUrl,
      };

      setCardData(extractedData);

      if (autoVerify && extractedData.certNumber && extractedData.gradingCompany) {
        await verifyCard(extractedData);
      }

      toast.success("Graded card label analyzed successfully");
    } catch (err) {
      console.error("Error analyzing graded card:", err);
      toast.error("Failed to analyze graded card label");
    } finally {
      setScanning(false);
    }
  }, [autoVerify, userId]);

  const verifyCard = async (data: GradedCardData) => {
    if (!data.certNumber || !data.gradingCompany) {
      toast.error("Missing cert number or grading company");
      return;
    }

    setVerifying(true);
    try {
      const { data: verificationResult, error } = await supabase.functions.invoke("verify-graded-card", {
        body: {
          certNumber: data.certNumber,
          gradingCompany: data.gradingCompany,
        },
      });

      if (error) throw error;

      setCardData((prev) =>
        prev
          ? {
              ...prev,
              verified: verificationResult.verified,
              verificationUrl: verificationResult.verificationUrl || "",
              cardName: verificationResult.cardName || prev.cardName,
              cardSet: verificationResult.cardSet || prev.cardSet,
              grade: verificationResult.grade || prev.grade,
            }
          : null
      );

      if (verificationResult.verified) {
        toast.success("Card verified successfully!");
      } else {
        toast.warning("Could not verify card - please check manually");
      }
    } catch (err) {
      console.error("Verification error:", err);
      toast.error("Failed to verify card");
    } finally {
      setVerifying(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;

    const previewUrl = URL.createObjectURL(file);
    setPreview(previewUrl);

    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const fileName = `cards/graded/${userId}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from("card-images")
      .upload(fileName, file, {
        contentType: file.type || "image/jpeg",
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      console.error("Graded scan upload error:", uploadError);
      toast.error(uploadError.message || "Failed to upload image");
      return;
    }

    const { data: publicUrlData } = supabase.storage
      .from("card-images")
      .getPublicUrl(fileName);
    await processImage(publicUrlData.publicUrl);
  };

  const startCamera = async () => {
    try {
      const mediaStream = await getMaxQualityStream("environment");
      setStream(mediaStream);
      setCameraActive(true);
    } catch (err) {
      console.error("Camera error:", err);
      toast.error("Failed to access camera");
    }
  };

  // Attach stream to video element when both are ready
  const attachStream = useCallback(async () => {
    if (stream && videoRef.current && !videoRef.current.srcObject) {
      videoRef.current.srcObject = stream;
      videoRef.current.setAttribute("playsinline", "true");
      videoRef.current.setAttribute("webkit-playsinline", "true");
      
      await new Promise<void>((resolve) => {
        if (!videoRef.current) return resolve();
        videoRef.current.onloadedmetadata = () => resolve();
        setTimeout(() => resolve(), 3000);
      });
      
      try {
        await videoRef.current.play();
        const settings = stream.getVideoTracks()[0]?.getSettings?.();
        console.log(`Graded scanner camera ready: ${settings?.width}x${settings?.height}`);
        toast.success(`Camera ready (${settings?.width}x${settings?.height})`);
      } catch {
        // Some browsers need user interaction
      }
    }
  }, [stream]);

  // Effect to attach stream when video element becomes available
  useEffect(() => {
    if (cameraActive && stream) {
      attachStream();
    }
  }, [cameraActive, stream, attachStream]);

  const handleTriggerFocus = async () => {
    if (stream) {
      const success = await triggerFastFocus(stream);
      if (success) toast.success("Focus triggered");
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    setCameraActive(false);
  };

  const capturePhoto = async () => {
    if (!videoRef.current || !userId) return;

    try {
      // Trigger fast focus before capture
      if (stream) {
        await triggerFastFocus(stream);
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      // Capture with anti-glare but disable OCR enhancement to avoid color issues
      const blob = await captureMaxQualityPhoto(videoRef.current, {
        applyAntiGlareFilter: true,
        enhanceOCR: false,
        quality: 0.98,
      });

      const previewUrl = URL.createObjectURL(blob);
      setPreview(previewUrl);
      stopCamera();

      const fileName = `cards/graded/${userId}/${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("card-images")
        .upload(fileName, blob, {
          contentType: "image/jpeg",
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        console.error("Graded scan upload error:", uploadError);
        toast.error(uploadError.message || "Failed to upload image");
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from("card-images")
        .getPublicUrl(fileName);
      await processImage(publicUrlData.publicUrl);
      }
    } catch (err) {
      console.error("Capture error:", err);
      toast.error("Failed to capture photo");
    }
  };

  const saveToCollection = async () => {
    if (!cardData || !userId) return;

    try {
      await insertCardDual({
        user_id: userId,
        card_name: cardData.cardName,
        card_set: cardData.cardSet,
        card_number: cardData.cardNumber,
        condition: `${cardData.gradingCompany} ${cardData.grade}`,
        image_url: cardData.imageUrl,
        notes: `Cert #: ${cardData.certNumber} | Verified: ${cardData.verified ? "Yes" : "No"}`,
        tags: [cardData.gradingCompany || "Graded", cardData.grade],
      });

      toast.success("Card saved to collection!");
      setCardData(null);
      setPreview(null);
      fetchGradedCards(); // Refresh the graded cards list
    } catch (err) {
      toast.error("Failed to save card");
    }
  };

  const resetScan = () => {
    setCardData(null);
    setPreview(null);
    stopCamera();
  };

  return (
    <div className="container max-w-4xl py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Award className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Graded Card Scanner</h1>
          <p className="text-muted-foreground">Scan PSA, CGC, and Beckett slabs with verification</p>
        </div>
      </div>

      <div className="flex gap-2">
        {GRADING_COMPANIES.map((company) => (
          <Badge key={company.id} variant="outline" className="gap-1">
            <span className={`h-2 w-2 rounded-full ${company.color}`} />
            {company.name}
          </Badge>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Capture Graded Card</CardTitle>
          <CardDescription>
            Take a photo of the graded slab label to extract cert number, grade, and card details
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Label htmlFor="auto-verify" className="flex items-center gap-2 cursor-pointer">
              <input
                id="auto-verify"
                type="checkbox"
                checked={autoVerify}
                onChange={(e) => setAutoVerify(e.target.checked)}
                className="rounded border-border"
              />
              <Shield className="h-4 w-4" />
              Auto-verify after scan
            </Label>
          </div>

          <Tabs defaultValue="upload">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="upload" className="gap-2">
                <Upload className="h-4 w-4" />
                Upload
              </TabsTrigger>
              <TabsTrigger value="camera" className="gap-2">
                <Camera className="h-4 w-4" />
                Camera
              </TabsTrigger>
              <TabsTrigger value="qr" className="gap-2">
                <ScanLine className="h-4 w-4" />
                QR / Barcode
              </TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={scanning}
                className="w-full h-32 border-2 border-dashed"
                variant="outline"
              >
                {scanning ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="h-8 w-8" />
                    <span>Click to upload slab image</span>
                  </div>
                )}
              </Button>
            </TabsContent>

            <TabsContent value="camera" className="space-y-4">
              {cameraActive ? (
                <div className="space-y-4">
                  <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 border-4 border-primary/50 rounded-lg pointer-events-none" />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={handleTriggerFocus} variant="outline" size="icon">
                      <Focus className="h-4 w-4" />
                    </Button>
                    <Button onClick={capturePhoto} className="flex-1 gap-2">
                      <Camera className="h-4 w-4" />
                      Capture
                    </Button>
                    <Button onClick={stopCamera} variant="outline">
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button onClick={startCamera} className="w-full h-32" variant="outline">
                  <div className="flex flex-col items-center gap-2">
                    <Camera className="h-8 w-8" />
                    <span>Start Camera</span>
                  </div>
                </Button>
              )}
            </TabsContent>

            <TabsContent value="qr" className="space-y-4">
              <div className="rounded-lg border overflow-hidden">
                <QrScanner
                  delay={250}
                  onError={() => {
                    // ignore noisy camera errors
                  }}
                  onScan={(data: any) => {
                    const text = data?.text || data;
                    if (!text) return;
                    const raw = String(text);
                    setQrResult(raw);
                    // Extract a cert-like number if present
                    const m = raw.match(/\b\d{6,}\b/);
                    if (m) {
                      setCardData((prev) => ({ ...prev, certNumber: m[0] }));
                      toast.success("Captured cert number");
                    } else {
                      toast.info("QR scanned — paste/confirm cert in the form");
                    }
                  }}
                  style={{ width: "100%" }}
                />
              </div>

              {qrResult && (
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="text-xs font-medium mb-1">Last scan</div>
                  <div className="text-xs text-muted-foreground break-all">{qrResult}</div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Tip: This works best on PSA/CGC/BGS slab QR codes or barcodes. If your device blocks camera access, use the Upload tab.
              </p>
            </TabsContent>
          </Tabs>

          {preview && !cameraActive && (
            <div className="relative">
              <img src={preview} alt="Captured slab" className="w-full rounded-lg" />
              {scanning && (
                <div className="absolute inset-0 bg-background/80 flex items-center justify-center rounded-lg">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {cardData && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                Extracted Information
                {cardData.verified === true && (
                  <Badge className="bg-success text-success-foreground gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Verified
                  </Badge>
                )}
                {cardData.verified === false && (
                  <Badge variant="destructive" className="gap-1">
                    <XCircle className="h-3 w-3" />
                    Not Verified
                  </Badge>
                )}
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={resetScan}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground text-sm">Grading Company</Label>
                <div className="flex items-center gap-2 mt-1">
                  {cardData.gradingCompany && (
                    <Badge className={GRADING_COMPANIES.find(c => c.id === cardData.gradingCompany)?.color}>
                      {cardData.gradingCompany}
                    </Badge>
                  )}
                </div>
              </div>
              <div>
                <Label className="text-muted-foreground text-sm">Grade</Label>
                <p className="text-xl font-bold">{cardData.grade || "—"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-sm">Cert Number</Label>
                <p className="font-mono">{cardData.certNumber || "—"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-sm">Year</Label>
                <p>{cardData.year || "—"}</p>
              </div>
            </div>

            <div className="space-y-2">
              <div>
                <Label className="text-muted-foreground text-sm">Card Name</Label>
                <Input
                  value={cardData.cardName}
                  onChange={(e) => setCardData({ ...cardData, cardName: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-muted-foreground text-sm">Set</Label>
                  <Input
                    value={cardData.cardSet}
                    onChange={(e) => setCardData({ ...cardData, cardSet: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-muted-foreground text-sm">Card Number</Label>
                  <Input
                    value={cardData.cardNumber}
                    onChange={(e) => setCardData({ ...cardData, cardNumber: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              {cardData.verified !== true && (
                <Button
                  onClick={() => verifyCard(cardData)}
                  disabled={verifying || !cardData.certNumber}
                  variant="outline"
                  className="gap-2"
                >
                  {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                  {cardData.verified === false ? "Re-verify" : "Verify Now"}
                </Button>
              )}
              {cardData.verificationUrl && (
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => window.open(cardData.verificationUrl, "_blank")}
                >
                  <ExternalLink className="h-4 w-4" />
                  View on {cardData.gradingCompany}
                </Button>
              )}
              <Button onClick={saveToCollection} className="flex-1 gap-2">
                Save to Collection
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* My Graded Cards Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              <CardTitle>My Graded Cards</CardTitle>
              <Badge variant="secondary">{gradedCards.length}</Badge>
            </div>
            <Button variant="ghost" size="sm" onClick={fetchGradedCards} disabled={loadingCards}>
              <RefreshCw className={`h-4 w-4 ${loadingCards ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          <CardDescription>
            Graded cards in your collection (PSA, CGC, Beckett)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingCards ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : gradedCards.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No graded cards in your collection yet</p>
              <p className="text-sm">Scan a graded slab above to add your first one</p>
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {gradedCards.map((card) => {
                  const graderMatch = card.condition?.match(/(PSA|CGC|Beckett|BGS)/i);
                  const grader = graderMatch?.[1]?.toUpperCase() || "GRADED";
                  const graderColor = grader === "PSA" ? "bg-destructive" : grader === "CGC" ? "bg-primary" : "bg-warning";
                  
                  return (
                    <div
                      key={card.id}
                      className="border rounded-lg overflow-hidden bg-card hover:border-primary/50 transition-colors"
                    >
                      <div className="aspect-[3/4] relative bg-muted">
                        <img
                          src={card.image_url}
                          alt={card.card_name}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = "/placeholder.svg";
                          }}
                        />
                        <Badge className={`absolute top-2 right-2 ${graderColor}`}>
                          {card.condition}
                        </Badge>
                      </div>
                      <div className="p-3 space-y-1">
                        <p className="font-medium text-sm line-clamp-1">{card.card_name}</p>
                        {card.card_set && (
                          <p className="text-xs text-muted-foreground line-clamp-1">
                            {card.card_set} {card.card_number && `#${card.card_number}`}
                          </p>
                        )}
                        {card.current_price_raw && (
                          <p className="text-sm font-semibold text-primary">
                            ${card.current_price_raw.toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}