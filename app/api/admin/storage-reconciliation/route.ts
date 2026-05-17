// app/api/admin/storage-reconciliation/route.ts
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { PDF_BUCKET, PDF_TABLE } from '@/lib/backend/readroom';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

interface StorageObject {
  name: string;
  path: string;
  size: number;
  updated_at: string;
}

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    status: 'online',
    message: 'Supabase Storage Reconciliation API is online and secure.',
    user: { id: user.id, email: user.email },
  });
}

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = createAdminClient() ?? supabase;
  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun !== false; // defaults to true

  const logs: string[] = [];
  const addLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    logs.push(`[${timestamp}] ${msg}`);
  };

  addLog(`Reconciliation audit initiated (dryRun: ${dryRun}) by ${user.email}`);

  try {
    // 1. Fetch active PDF records from the database
    addLog(`Fetching active PDF records from database table '${PDF_TABLE}'...`);
    const { data: dbPdfs, error: dbError } = await db
      .from(PDF_TABLE)
      .select('id, storage_path, filename, size_bytes, room_id');

    if (dbError) {
      addLog(`[Error] Database query failed: ${dbError.message}`);
      return NextResponse.json({ error: dbError.message, logs }, { status: 500 });
    }

    addLog(`Successfully retrieved ${dbPdfs?.length ?? 0} active PDF records.`);

    // Map active paths for constant time lookups (normalize casing and trim)
    const activePathsMap = new Map<string, any>();
    dbPdfs?.forEach((pdf) => {
      if (pdf.storage_path) {
        activePathsMap.set(pdf.storage_path.trim().toLowerCase(), pdf);
      }
    });

    // 2. Scan Supabase Storage recursively
    addLog(`Scanning storage bucket '${PDF_BUCKET}' recursively...`);
    const allStorageFiles: StorageObject[] = [];

    // List library level folders
    const { data: libraries, error: libError } = await db.storage.from(PDF_BUCKET).list('');
    if (libError) {
      addLog(`[Error] Failed to list root storage bucket contents: ${libError.message}`);
      return NextResponse.json({ error: libError.message, logs }, { status: 500 });
    }

    addLog(`Found ${libraries?.length ?? 0} root library directories. Drilling down...`);

    for (const lib of libraries ?? []) {
      // In Supabase storage, folders have no metadata or id
      if (lib.id === undefined || lib.id === null || !lib.metadata) {
        addLog(`Scanning library directory: '${lib.name}'...`);
        const { data: rooms, error: roomError } = await db.storage.from(PDF_BUCKET).list(lib.name);
        if (roomError) {
          addLog(`[Warning] Failed to list rooms inside library '${lib.name}': ${roomError.message}`);
          continue;
        }

        for (const room of rooms ?? []) {
          if (room.id === undefined || room.id === null || !room.metadata) {
            const roomPath = `${lib.name}/${room.name}`;
            const { data: files, error: fileError } = await db.storage.from(PDF_BUCKET).list(roomPath, { limit: 1000 });
            if (fileError) {
              addLog(`[Warning] Failed to list files inside room '${roomPath}': ${fileError.message}`);
              continue;
            }

            let fileCount = 0;
            for (const file of files ?? []) {
              if (file.id && file.metadata) {
                fileCount++;
                allStorageFiles.push({
                  name: file.name,
                  path: `${roomPath}/${file.name}`,
                  size: file.metadata.size ?? 0,
                  updated_at: file.updated_at || file.created_at || new Date().toISOString(),
                });
              }
            }
            if (fileCount > 0) {
              addLog(`  -> Found ${fileCount} PDF files inside room '${room.name}'`);
            }
          }
        }
      }
    }

    addLog(`Storage scan complete. Scanned ${allStorageFiles.length} files in total.`);

    // 3. Compare scanned files with active database paths
    const orphans: StorageObject[] = [];
    const protectedRecent: StorageObject[] = [];
    let reclaimableBytes = 0;
    let protectedRecentBytes = 0;

    const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;

    for (const file of allStorageFiles) {
      const normalizedPath = file.path.trim().toLowerCase();
      if (!activePathsMap.has(normalizedPath)) {
        // Safe check: Active Upload Protection (uploaded in the last 15 minutes)
        const uploadTime = new Date(file.updated_at).getTime();
        const isRecent = uploadTime > fifteenMinutesAgo;

        if (isRecent) {
          protectedRecent.push(file);
          protectedRecentBytes += file.size;
        } else {
          orphans.push(file);
          reclaimableBytes += file.size;
        }
      }
    }

    addLog(`Analysis Summary:`);
    addLog(`  - Total Storage Files Scanned: ${allStorageFiles.length}`);
    addLog(`  - Matches with Active DB PDFs: ${allStorageFiles.length - orphans.length - protectedRecent.length}`);
    addLog(`  - Protected Recent Uploads (last 15m): ${protectedRecent.length} (${formatBytes(protectedRecentBytes)})`);
    addLog(`  - Orphaned Storage Files Identified: ${orphans.length} (${formatBytes(reclaimableBytes)})`);

    // 4. If not dryRun, execute deletion
    let deletedCount = 0;
    let deletionError: string | null = null;

    if (!dryRun && orphans.length > 0) {
      addLog(`Live deletion mode active! Initiating deletion of ${orphans.length} orphaned files...`);
      const pathsToDelete = orphans.map((o) => o.path);

      // Delete in chunks of 50 to avoid any URL/payload size limits
      const chunkSize = 50;
      for (let i = 0; i < pathsToDelete.length; i += chunkSize) {
        const chunk = pathsToDelete.slice(i, i + chunkSize);
        addLog(`Deleting chunk ${Math.floor(i / chunkSize) + 1} (${chunk.length} files)...`);

        const { data: deleteData, error: deleteError } = await db.storage
          .from(PDF_BUCKET)
          .remove(chunk);

        if (deleteError) {
          addLog(`[Error] Failed to delete file chunk: ${deleteError.message}`);
          deletionError = deleteError.message;
          break;
        }

        deletedCount += deleteData?.length ?? chunk.length;
      }

      if (!deletionError) {
        addLog(`Live deletion complete! Safely removed ${deletedCount} unreferenced PDF files from Supabase Storage.`);
      }
    } else if (orphans.length === 0) {
      addLog(`Zero orphaned storage files found. Storage is perfectly in sync with the database!`);
    } else {
      addLog(`Dry-run mode active. No physical storage files were deleted. Re-run with dryRun: false to clean up.`);
    }

    return NextResponse.json({
      success: !deletionError,
      dryRun,
      stats: {
        totalScanned: allStorageFiles.length,
        activeMatches: allStorageFiles.length - orphans.length - protectedRecent.length,
        protectedRecent: protectedRecent.length,
        protectedRecentSize: formatBytes(protectedRecentBytes),
        protectedRecentSizeBytes: protectedRecentBytes,
        orphans: orphans.length,
        orphansSize: formatBytes(reclaimableBytes),
        orphansSizeBytes: reclaimableBytes,
        deleted: deletedCount,
      },
      orphans,
      protectedRecentList: protectedRecent,
      logs,
      error: deletionError,
    });

  } catch (err: any) {
    addLog(`[Error] Unhandled exception occurred: ${err?.message || err}`);
    return NextResponse.json({
      success: false,
      error: err?.message || 'Unknown server error',
      logs,
    }, { status: 500 });
  }
}
