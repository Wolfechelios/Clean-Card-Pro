import { ChangeEvent, useEffect, useMemo, useState } from "react";
import localforage from "localforage";
import { Archive, Download, HardDrive, RefreshCw, RotateCcw, Trash2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { getAllCards, upsertCardsLocal } from "@/lib/localCards";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

type BackupRecord = {
  id: string;
  userId: string;
  createdAt: string;
  label: string;
  count: number;
  source: "supabase" | "local" | "import";
  cards: any[];
};

type BackupFile = {
  app: "Clean-Card-Pro";
  version: 1;
  exportedAt: string;
  userId: string;
  count: number;
  cards: any[];
};

const backupDb = localforage.createInstance({ name: "card-scout", storeName: "collection-backups" });
const PAGE_SIZE = 1000;
const MAX_LOCAL_BACKUPS = 10;

function nowStamp() {
  return new Date().toISOString();
}

function fileSafeDate() {
  return nowStamp().replace(/[:.]/g, "-");
}

function normalizeCards(cards: any[], userId: string) {
  return (cards || [])
    .filter((card) => card && typeof card === "object")
    .map((card) => ({ ...card, user_id: card.user_id || userId }));
}

async function fetchAllSupabaseCards(userId: string) {
  const cards: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await (supabase as any)
      .from("cards")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw error;
    const page = data || [];
    cards.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return cards;
}

async function listBackups(userId: string) {
  const rows: BackupRecord[] = [];
  await backupDb.iterate((value) => {
    const backup = value as BackupRecord;
    if (backup?.userId === userId) rows.push(backup);
  });
  rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return rows;
}

async function saveBackup(backup: BackupRecord) {
  await backupDb.setItem(backup.id, backup);
  const backups = await listBackups(backup.userId);
  await Promise.all(backups.slice(MAX_LOCAL_BACKUPS).map((old) => backupDb.removeItem(old.id)));
}

function downloadBackup(backup: BackupRecord) {
  const payload: BackupFile = {
    app: "Clean-Card-Pro",
    version: 1,
    exportedAt: nowStamp(),
    userId: backup.userId,
    count: backup.cards.length,
    cards: backup.cards,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `clean-card-pro-backup-${fileSafeDate()}-${backup.cards.length}-cards.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function restoreCards(cards: any[], userId: string) {
  const safeCards = normalizeCards(cards, userId);
  if (!safeCards.length) throw new Error("Backup contains no cards to restore");

  for (let i = 0; i < safeCards.length; i += 250) {
    const chunk = safeCards.slice(i, i + 250);
    const { error } = await (supabase as any).from("cards").upsert(chunk, { onConflict: "id" });
    if (error) throw error;
  }

  await upsertCardsLocal(safeCards as any);
  return safeCards.length;
}

export default function DeviceBackupPage() {
  const { userId } = useAuth();
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [cloudCount, setCloudCount] = useState(0);
  const [localCount, setLocalCount] = useState(0);
  const [busy, setBusy] = useState(false);

  const latest = useMemo(() => backups[0] || null, [backups]);

  const refresh = async () => {
    if (!userId) return;
    try {
      const [cloudCards, localCards, saved] = await Promise.all([
        fetchAllSupabaseCards(userId),
        getAllCards(),
        listBackups(userId),
      ]);
      setCloudCount(cloudCards.length);
      setLocalCount(localCards.length);
      setBackups(saved);
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || "Could not refresh backup status");
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const createSnapshot = async (source: "supabase" | "local" = "supabase") => {
    if (!userId) return;
    setBusy(true);
    try {
      const cards = source === "supabase" ? await fetchAllSupabaseCards(userId) : await getAllCards();
      const safeCards = normalizeCards(cards, userId);
      const backup: BackupRecord = {
        id: `backup-${Date.now()}`,
        userId,
        createdAt: nowStamp(),
        label: `${source === "supabase" ? "Cloud" : "Local"} snapshot — ${safeCards.length} cards`,
        count: safeCards.length,
        source,
        cards: safeCards,
      };
      await saveBackup(backup);
      setBackups(await listBackups(userId));
      toast.success(`Saved on-device backup with ${safeCards.length.toLocaleString()} cards`);
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || "Backup failed");
    } finally {
      setBusy(false);
    }
  };

  const restoreBackup = async (backup: BackupRecord) => {
    if (!userId) return;
    setBusy(true);
    try {
      const count = await restoreCards(backup.cards, userId);
      toast.success(`Restored ${count.toLocaleString()} cards to Supabase and this device`);
      await refresh();
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || "Restore failed");
    } finally {
      setBusy(false);
    }
  };

  const deleteBackup = async (backup: BackupRecord) => {
    if (!userId) return;
    setBusy(true);
    try {
      await backupDb.removeItem(backup.id);
      setBackups(await listBackups(userId));
      toast.success("Backup deleted from this device");
    } catch (error: any) {
      toast.error(error?.message || "Could not delete backup");
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!userId) return;
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const parsed = JSON.parse(await file.text()) as BackupFile | BackupRecord | any;
      const cards = Array.isArray(parsed?.cards) ? parsed.cards : [];
      if (!cards.length) throw new Error("That file does not contain a Clean Card backup");
      const backup: BackupRecord = {
        id: `import-${Date.now()}`,
        userId,
        createdAt: nowStamp(),
        label: `Imported file — ${cards.length} cards`,
        count: cards.length,
        source: "import",
        cards: normalizeCards(cards, userId),
      };
      await saveBackup(backup);
      setBackups(await listBackups(userId));
      toast.success(`Imported backup with ${cards.length.toLocaleString()} cards. Use Restore to put them back.`);
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <HardDrive className="h-7 w-7 text-primary" />
            Device Backup
          </h1>
          <p className="text-muted-foreground">
            Local recovery for deleted cards. Save snapshots on this Mac/browser, export JSON files, and restore cards back into Supabase.
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={busy}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Cards in Supabase</p>
            <p className="text-2xl font-bold">{cloudCount.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Cards cached on device</p>
            <p className="text-2xl font-bold">{localCount.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Saved backups</p>
            <p className="text-2xl font-bold">{backups.length.toLocaleString()}</p>
            {latest && <p className="text-xs text-muted-foreground">Latest: {new Date(latest.createdAt).toLocaleString()}</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Archive className="h-5 w-5" />Create / Export Backup</CardTitle>
          <CardDescription>
            Best move before using delete tools: make a cloud snapshot, then download it. Belt and suspenders; the empire sleeps better.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={() => createSnapshot("supabase")} disabled={busy}>
            <HardDrive className="h-4 w-4 mr-2" />
            Save Cloud Snapshot On Device
          </Button>
          <Button variant="outline" onClick={() => createSnapshot("local")} disabled={busy}>
            <HardDrive className="h-4 w-4 mr-2" />
            Save Local Cache Snapshot
          </Button>
          <Button variant="outline" onClick={() => latest && downloadBackup(latest)} disabled={busy || !latest}>
            <Download className="h-4 w-4 mr-2" />
            Download Latest JSON
          </Button>
          <label className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer">
            <Upload className="h-4 w-4 mr-2" />
            Import Backup JSON
            <input type="file" accept="application/json,.json" className="hidden" onChange={handleImport} disabled={busy} />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Saved On-Device Backups</CardTitle>
          <CardDescription>Latest {MAX_LOCAL_BACKUPS} snapshots are kept on this device. Restore does an upsert, so existing cards update and deleted cards come back.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!backups.length ? (
            <div className="rounded-lg border p-4 text-sm text-muted-foreground">No backups saved yet.</div>
          ) : (
            backups.map((backup) => (
              <div key={backup.id} className="rounded-lg border p-4 space-y-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{backup.label}</p>
                      <Badge variant="secondary">{backup.source}</Badge>
                      <Badge>{backup.count.toLocaleString()} cards</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{new Date(backup.createdAt).toLocaleString()}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => restoreBackup(backup)} disabled={busy}>
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Restore
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => downloadBackup(backup)} disabled={busy}>
                      <Download className="h-4 w-4 mr-2" />
                      Download
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => deleteBackup(backup)} disabled={busy}>
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Backup
                    </Button>
                  </div>
                </div>
                <Separator />
                <p className="text-xs text-muted-foreground">
                  Restore target: Supabase cards table + local IndexedDB cache. This does not permanently delete anything.
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
