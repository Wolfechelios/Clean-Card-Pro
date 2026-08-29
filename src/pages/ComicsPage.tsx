import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Book, Camera, Loader2, Plus, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

import { runComicCoverOcr } from "@/lib/comics/comicOcr";
import { getComicVineKey, lookupComic, setComicVineKey } from "@/lib/comics/comicLookup";
import {
  comicValue,
  deleteComic,
  listComics,
  saveComic,
  storeComicCover,
} from "@/lib/comics/comicStore";
import type { ComicRecord } from "@/lib/local/db";
import { getImageURL } from "@/lib/local/images";
import {
  applySharpnessConstraints,
  getCameraStreamWithFallback,
} from "@/lib/camera/cameraPolicy";

type DraftComic = {
  title: string;
  issueNumber: string;
  year: string;
  publisher: string;
  grade: string;
  gradedBy: string;
  condition: string;
  valueRaw: string;
  quantity: string;
  notes: string;
};

const EMPTY_DRAFT: DraftComic = {
  title: "",
  issueNumber: "",
  year: "",
  publisher: "",
  grade: "",
  gradedBy: "",
  condition: "",
  valueRaw: "",
  quantity: "1",
  notes: "",
};

const currency = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0);

function ComicCover({ comic }: { comic: ComicRecord }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const id = comic.thumbId || comic.imageId;
    if (!id) return;
    void getImageURL(id).then((next) => {
      if (active) setUrl(next);
    });
    return () => {
      active = false;
    };
  }, [comic.thumbId, comic.imageId]);

  return (
    <div className="aspect-[2/3] w-full overflow-hidden rounded-md bg-muted">
      {url ? (
        <img
          src={url}
          alt={`${comic.title} issue ${comic.issueNumber ?? ""} cover`}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          <Book className="h-8 w-8" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

export default function ComicsPage() {
  const [comics, setComics] = useState<ComicRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [draft, setDraft] = useState<DraftComic>(EMPTY_DRAFT);
  const [coverBlob, setCoverBlob] = useState<Blob | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [vineKey, setVineKey] = useState(getComicVineKey() ?? "");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      setComics(await listComics());
    } catch (error) {
      console.error("[Comics] load failed", error);
      toast.error("Could not load your comics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const stats = useMemo(
    () => ({
      issues: comics.length,
      copies: comics.reduce((sum, comic) => sum + (comic.quantity || 1), 0),
      value: comics.reduce((sum, comic) => sum + comicValue(comic), 0),
    }),
    [comics],
  );

  async function startCamera() {
    try {
      const { stream } = await getCameraStreamWithFallback(navigator.mediaDevices);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      await applySharpnessConstraints(stream.getVideoTracks()[0] ?? null);
      setCameraOn(true);
      setStatus("Camera live — fill the frame with the cover, then capture");
    } catch (error) {
      console.error("[Comics] camera failed", error);
      toast.error("Camera unavailable. Upload a cover photo instead.");
    }
  }

  function setCover(blob: Blob) {
    setCoverBlob(blob);
    setCoverPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return URL.createObjectURL(blob);
    });
  }

  async function captureCover() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92),
    );
    if (!blob) {
      toast.error("Capture failed. Try again.");
      return;
    }
    setCover(blob);
    stopCamera();
    await identifyCover(blob);
  }

  async function identifyCover(blob: Blob) {
    setBusy(true);
    setStatus("Reading the cover…");
    try {
      const ocr = await runComicCoverOcr(blob);
      const match = await lookupComic({
        title: ocr.title,
        issueNumber: ocr.issueNumber,
        year: ocr.year,
        publisher: ocr.publisher,
      });

      setDraft((prev) => ({
        ...prev,
        title: match.title || ocr.title || prev.title,
        issueNumber: match.issueNumber || ocr.issueNumber || prev.issueNumber,
        year: String(match.year ?? ocr.year ?? prev.year ?? ""),
        publisher: match.publisher || ocr.publisher || prev.publisher,
        valueRaw:
          match.valueRaw != null && match.valueRaw > 0 ? String(match.valueRaw) : prev.valueRaw,
        notes: prev.notes || ocr.rawText.slice(0, 400),
      }));
      setStatus(match.note ?? "Cover read. Check the details before saving.");
    } catch (error) {
      console.error("[Comics] OCR failed", error);
      setStatus("Could not read the cover. Fill in the details manually.");
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setCover(file);
    await identifyCover(file);
  }

  async function save() {
    if (!draft.title.trim()) {
      toast.error("Enter a comic title first");
      return;
    }
    setBusy(true);
    try {
      let imageId: string | undefined;
      let thumbId: string | undefined;
      if (coverBlob) {
        const stored = await storeComicCover(coverBlob);
        imageId = stored.imageId;
        thumbId = stored.thumbId;
      }
      const value = Number(draft.valueRaw);
      await saveComic({
        title: draft.title.trim(),
        issueNumber: draft.issueNumber.trim() || undefined,
        year: Number(draft.year) || undefined,
        publisher: draft.publisher.trim() || undefined,
        condition: draft.condition.trim() || undefined,
        grade: draft.grade.trim() || undefined,
        gradedBy: draft.gradedBy.trim() || undefined,
        valueRaw: Number.isFinite(value) && value > 0 ? value : undefined,
        quantity: Math.max(1, Number(draft.quantity) || 1),
        notes: draft.notes.trim() || undefined,
        imageId,
        thumbId,
        priceSource: "manual",
        priceUpdatedAt: Date.now(),
      });
      toast.success(`${draft.title.trim()} saved to your comics`);
      setDraft(EMPTY_DRAFT);
      setCoverBlob(null);
      setCoverPreview((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return null;
      });
      setStatus("");
      await refresh();
    } catch (error) {
      console.error("[Comics] save failed", error);
      toast.error("Could not save this comic");
    } finally {
      setBusy(false);
    }
  }

  async function remove(comic: ComicRecord) {
    try {
      await deleteComic(comic.id);
      await refresh();
      toast.success("Comic removed");
    } catch {
      toast.error("Could not remove that comic");
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Comics</h1>
        <p className="text-sm text-muted-foreground">
          Scan comic covers, store them locally, and track what the collection is worth.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="shadow-card">
          <CardHeader className="pb-2">
            <CardDescription>Issues</CardDescription>
            <CardTitle className="text-2xl">{stats.issues}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="shadow-card">
          <CardHeader className="pb-2">
            <CardDescription>Copies</CardDescription>
            <CardTitle className="text-2xl">{stats.copies}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="shadow-card">
          <CardHeader className="pb-2">
            <CardDescription>Collection value</CardDescription>
            <CardTitle className="text-2xl">{currency(stats.value)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>Add a comic</CardTitle>
          <CardDescription>
            Capture the cover to auto-fill the title, issue number and year, then confirm the value.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-black">
                {cameraOn ? (
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full object-cover"
                    aria-label="Comic cover camera preview"
                  />
                ) : coverPreview ? (
                  <img src={coverPreview} alt="Captured comic cover" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
                    <Book className="h-10 w-10" aria-hidden="true" />
                    <span className="text-sm">No cover yet</span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {cameraOn ? (
                  <>
                    <Button onClick={captureCover} disabled={busy} className="flex-1">
                      <Camera className="mr-2 h-4 w-4" />
                      Capture cover
                    </Button>
                    <Button variant="outline" onClick={stopCamera}>
                      <X className="mr-2 h-4 w-4" />
                      Stop
                    </Button>
                  </>
                ) : (
                  <>
                    <Button onClick={startCamera} disabled={busy} className="flex-1">
                      <Camera className="mr-2 h-4 w-4" />
                      Scan cover
                    </Button>
                    <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
                      <Upload className="mr-2 h-4 w-4" />
                      Upload
                    </Button>
                  </>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void handleFile(e.target.files?.[0])}
                />
              </div>

              {(busy || status) && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {status}
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="comic-title">Title</Label>
                <Input
                  id="comic-title"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="Amazing Spider-Man"
                />
              </div>
              <div>
                <Label htmlFor="comic-issue">Issue #</Label>
                <Input
                  id="comic-issue"
                  value={draft.issueNumber}
                  onChange={(e) => setDraft({ ...draft, issueNumber: e.target.value })}
                  placeholder="300"
                />
              </div>
              <div>
                <Label htmlFor="comic-year">Year</Label>
                <Input
                  id="comic-year"
                  inputMode="numeric"
                  value={draft.year}
                  onChange={(e) => setDraft({ ...draft, year: e.target.value })}
                  placeholder="1988"
                />
              </div>
              <div>
                <Label htmlFor="comic-publisher">Publisher</Label>
                <Input
                  id="comic-publisher"
                  value={draft.publisher}
                  onChange={(e) => setDraft({ ...draft, publisher: e.target.value })}
                  placeholder="Marvel"
                />
              </div>
              <div>
                <Label htmlFor="comic-condition">Condition</Label>
                <Input
                  id="comic-condition"
                  value={draft.condition}
                  onChange={(e) => setDraft({ ...draft, condition: e.target.value })}
                  placeholder="NM"
                />
              </div>
              <div>
                <Label htmlFor="comic-grader">Graded by</Label>
                <Input
                  id="comic-grader"
                  value={draft.gradedBy}
                  onChange={(e) => setDraft({ ...draft, gradedBy: e.target.value })}
                  placeholder="CGC"
                />
              </div>
              <div>
                <Label htmlFor="comic-grade">Grade</Label>
                <Input
                  id="comic-grade"
                  value={draft.grade}
                  onChange={(e) => setDraft({ ...draft, grade: e.target.value })}
                  placeholder="9.8"
                />
              </div>
              <div>
                <Label htmlFor="comic-value">Value (USD)</Label>
                <Input
                  id="comic-value"
                  inputMode="decimal"
                  value={draft.valueRaw}
                  onChange={(e) => setDraft({ ...draft, valueRaw: e.target.value })}
                  placeholder="125.00"
                />
              </div>
              <div>
                <Label htmlFor="comic-qty">Copies</Label>
                <Input
                  id="comic-qty"
                  inputMode="numeric"
                  value={draft.quantity}
                  onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="comic-notes">Notes</Label>
                <Textarea
                  id="comic-notes"
                  rows={3}
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  placeholder="Variant cover, key first appearance, defects…"
                />
              </div>
              <div className="sm:col-span-2 flex gap-2">
                <Button onClick={save} disabled={busy} className="flex-1">
                  <Plus className="mr-2 h-4 w-4" />
                  Save comic
                </Button>
                <Button variant="outline" onClick={() => setDraft(EMPTY_DRAFT)} disabled={busy}>
                  Clear
                </Button>
              </div>
            </div>
          </div>

          <Separator />

          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <Label htmlFor="comicvine-key">Comic Vine API key (optional)</Label>
              <Input
                id="comicvine-key"
                type="password"
                value={vineKey}
                onChange={(e) => setVineKey(e.target.value)}
                placeholder="Only used if you provide it"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Free cover OCR always runs first. Paid AI research services are never called.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setComicVineKey(vineKey || null);
                toast.success(vineKey ? "Comic Vine key saved on this device" : "Comic Vine key cleared");
              }}
            >
              Save key
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Your comics</CardTitle>
            <CardDescription>Stored on this device only.</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void refresh()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading comics…
            </div>
          ) : comics.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No comics yet. Scan a cover above to start the collection.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {comics.map((comic) => (
                <li key={comic.id} className="space-y-2 rounded-lg border border-border p-2">
                  <ComicCover comic={comic} />
                  <div className="space-y-1">
                    <p className="truncate text-sm font-medium" title={comic.title}>
                      {comic.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {comic.issueNumber ? `#${comic.issueNumber}` : "No issue #"}
                      {comic.year ? ` · ${comic.year}` : ""}
                    </p>
                    <div className="flex flex-wrap items-center gap-1">
                      {comic.publisher && (
                        <Badge variant="secondary" className="text-[10px]">
                          {comic.publisher}
                        </Badge>
                      )}
                      {comic.grade && (
                        <Badge variant="outline" className="text-[10px]">
                          {comic.gradedBy ? `${comic.gradedBy} ` : ""}
                          {comic.grade}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm font-semibold">{currency(comicValue(comic))}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={() => void remove(comic)}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
