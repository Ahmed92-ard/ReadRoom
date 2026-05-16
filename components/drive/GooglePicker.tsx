'use client';

// LocalFilePicker.tsx (exported as GooglePicker for drop-in compatibility)
// Local device upload dialog — supports:
//   A. Single or multiple PDF files
//   B. Entire folders (webkitdirectory) with full nested hierarchy preserved
//
// Folder hierarchy is preserved exactly:
//   FolderA/Physics/notes1.pdf  → creates FolderA → Physics → uploads notes1.pdf inside
//   FolderA/Math/notes2.pdf     → reuses FolderA → creates Math → uploads notes2.pdf inside
//
// The folderCache Map ensures each folder path is only created once per upload session.

import React, { useCallback, useRef, useState } from 'react';
import { Upload, X, FolderPlus, File as FileIcon, AlertCircle } from 'lucide-react';

interface LocalFilePickerProps {
  onClose: () => void;
  libraryId?: string;
  channelId?: string;
  /** Called after each PDF is successfully uploaded — receives the serialized PDF */
  onLocalUploaded?: (pdf: any) => void | Promise<void>;
  initialFolderId?: string | null;
  // Legacy props kept for drop-in compat — not used
  onSelect?: (pdf: any) => void | Promise<void>;
  mode?: 'replace' | 'add';
}

interface UploadProgress {
  total: number;
  done: number;
  current: string;
}

interface UploadItem {
  file: File;
  relativePath: string;
}

export function GooglePicker({
  onClose,
  libraryId,
  channelId,
  onLocalUploaded,
  onSelect,
  initialFolderId = null,
}: LocalFilePickerProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const stopBrowserDrop = useCallback((e: DragEvent | React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const uploadFilename = (file: File, relativePath?: string) => {
    relativePath = relativePath || ((file as any).webkitRelativePath as string | undefined);
    return relativePath?.split('/').pop() || file.name;
  };

  // ── Upload a single file to the server ───────────────────────────────────
  const uploadFile = async (file: File, folderId: string | null, relativePath?: string): Promise<any> => {
    if (!libraryId || !channelId) throw new Error('Room context required for upload');
    const formData = new FormData();
    formData.append('file', file, uploadFilename(file, relativePath));
    if (folderId) formData.append('folderId', folderId);

    const res = await fetch(
      `/api/libraries/${libraryId}/channels/${channelId}/pdfs/upload`,
      { method: 'POST', body: formData }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
    return data.pdf;
  };

  // ── Create a folder in the room, return its id ────────────────────────────
  const createFolder = async (name: string, parentId: string | null): Promise<string> => {
    if (!libraryId || !channelId) throw new Error('Room context required');
    const res = await fetch(
      `/api/libraries/${libraryId}/channels/${channelId}/folders`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parentId }),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to create folder');
    return data.folder.id;
  };

  // ── Resolve folder id for a relative path, creating folders as needed ────
  // folderCache: "FolderA/Physics" → folderId
  // This ensures each unique path is only created once per upload batch.
  const resolveFolderPath = async (
    relativePath: string,
    folderCache: Map<string, string>
  ): Promise<string | null> => {
    // relativePath: "FolderA/Physics/notes.pdf" or "notes.pdf"
    const parts = relativePath.split('/');
    if (parts.length <= 1) return initialFolderId; // selected folder or root

    const folderParts = parts.slice(0, -1); // strip filename
    let parentId: string | null = initialFolderId;

    for (let i = 0; i < folderParts.length; i++) {
      const pathKey = `${initialFolderId ?? 'root'}:${folderParts.slice(0, i + 1).join('/')}`;
      if (folderCache.has(pathKey)) {
        parentId = folderCache.get(pathKey)!;
      } else {
        const folderId = await createFolder(folderParts[i], parentId);
        folderCache.set(pathKey, folderId);
        parentId = folderId;
      }
    }
    return parentId;
  };

  const readDirectoryEntries = (reader: any): Promise<any[]> => (
    new Promise((resolve, reject) => reader.readEntries(resolve, reject))
  );

  const collectEntryFiles = async (entry: any, pathPrefix = ''): Promise<UploadItem[]> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
      return [{ file, relativePath: `${pathPrefix}${file.name}` }];
    }
    if (!entry.isDirectory) return [];

    const reader = entry.createReader();
    const batches: any[] = [];
    for (;;) {
      const entries = await readDirectoryEntries(reader);
      if (entries.length === 0) break;
      batches.push(...entries);
    }

    const nested = await Promise.all(
      batches.map((child) => collectEntryFiles(child, `${pathPrefix}${entry.name}/`))
    );
    return nested.flat();
  };

  const getDroppedItems = async (dataTransfer: DataTransfer): Promise<UploadItem[]> => {
    const entries = Array.from(dataTransfer.items ?? [])
      .map((item) => (item as any).webkitGetAsEntry?.())
      .filter(Boolean);

    if (entries.length === 0) {
      return Array.from(dataTransfer.files).map((file) => ({ file, relativePath: (file as any).webkitRelativePath || file.name }));
    }

    const collected = await Promise.all(entries.map((entry) => collectEntryFiles(entry)));
    return collected.flat();
  };

  // ── Main upload handler ───────────────────────────────────────────────────
  const handleFiles = useCallback(async (files: FileList | UploadItem[] | null) => {
    if (!files || files.length === 0) return;
    setError(null);

    const items: UploadItem[] = Array.isArray(files)
      ? files
      : Array.from(files).map((file) => ({ file, relativePath: (file as any).webkitRelativePath || file.name }));

    const pdfs = items.filter(
      ({ file }) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    );

    if (pdfs.length === 0) {
      setError('No PDF files found. Please select PDF files or a folder containing PDFs.');
      return;
    }

    setUploading(true);
    setProgress({ total: pdfs.length, done: 0, current: '' });

    // Shared folder cache for this entire upload batch
    // Prevents duplicate folder creation when multiple files share the same parent
    const folderCache = new Map<string, string>();

    try {
      for (let i = 0; i < pdfs.length; i++) {
        const { file, relativePath } = pdfs[i];
        setProgress({ total: pdfs.length, done: i, current: file.name });

        // webkitRelativePath is set when using webkitdirectory input
        // e.g. "MyFolder/SubFolder/notes.pdf"
        // Falls back to just the filename for single-file uploads
        const folderId = await resolveFolderPath(relativePath, folderCache);

        const pdf = await uploadFile(file, folderId, relativePath);

        if (onLocalUploaded) {
          await onLocalUploaded(pdf);
        } else if (onSelect) {
          await onSelect({
            fileId: pdf.driveId,
            filename: pdf.filename,
            owner: 'Local Upload',
            thumbnail: null,
            totalPages: null,
            url: pdf.url,
          });
        }
      }

      setProgress({ total: pdfs.length, done: pdfs.length, current: '' });
      // Brief success pause before closing
      setTimeout(onClose, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setUploading(false);
      setProgress(null);
    }
  }, [libraryId, channelId, onLocalUploaded, onSelect, onClose, initialFolderId]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    stopBrowserDrop(e);
    handleFiles(await getDroppedItems(e.dataTransfer));
  }, [handleFiles, stopBrowserDrop]);

  React.useEffect(() => {
    window.addEventListener('dragover', stopBrowserDrop);
    window.addEventListener('drop', stopBrowserDrop);
    return () => {
      window.removeEventListener('dragover', stopBrowserDrop);
      window.removeEventListener('drop', stopBrowserDrop);
    };
  }, [stopBrowserDrop]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onDragEnter={stopBrowserDrop}
      onDragOver={stopBrowserDrop}
      onDrop={handleDrop}
    >
      <div className="relative w-full max-w-md rounded-2xl bg-room-surface border border-room-border shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <Upload size={20} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-room-text">Add PDFs</h2>
              <p className="text-xs text-room-muted">
                {initialFolderId ? 'Upload files into the selected folder' : 'Upload files or an entire folder'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={uploading}
            className="p-2 rounded-lg text-room-muted hover:text-room-text hover:bg-room-hover transition-colors disabled:opacity-40"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-4">
          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragEnter={stopBrowserDrop}
            onDragOver={stopBrowserDrop}
            onClick={() => !uploading && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
              uploading
                ? 'border-blue-500/50 bg-blue-500/5 cursor-wait'
                : 'border-room-border hover:border-blue-500/50 hover:bg-blue-500/5 cursor-pointer'
            }`}
          >
            {uploading && progress ? (
              <div className="space-y-3">
                <div className="animate-spin w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full mx-auto" />
                <p className="text-sm text-blue-400 font-medium">
                  {progress.done}/{progress.total} — {progress.current || 'Uploading…'}
                </p>
                <div className="w-full bg-room-border rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-room-muted">Please wait — do not close this dialog</p>
              </div>
            ) : (
              <>
                <Upload size={32} className="text-room-muted mx-auto mb-3" />
                <p className="text-sm font-medium text-room-text mb-1">Drop PDF files or folders here</p>
                <p className="text-xs text-room-muted">or click to browse your device</p>
                <p className="text-xs text-room-muted mt-1">Max 100 MB per file</p>
              </>
            )}
          </div>

          {/* Hidden inputs */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.currentTarget.value = '';
            }}
          />
          {/* webkitdirectory: selects the entire folder including all subfolders */}
          <input
            ref={folderInputRef}
            type="file"
            // @ts-ignore — non-standard but supported in all major desktop browsers
            webkitdirectory=""
            directory=""
            multiple
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.currentTarget.value = '';
            }}
          />

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => !uploading && fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-wait transition-colors min-h-[44px]"
            >
              <FileIcon size={16} />
              Select Files
            </button>
            <button
              onClick={() => !uploading && folderInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-medium bg-room-bg border border-room-border text-room-text hover:bg-room-hover disabled:opacity-50 disabled:cursor-wait transition-colors min-h-[44px]"
              title="Upload an entire folder — subfolders are preserved"
            >
              <FolderPlus size={16} />
              Select Folder
            </button>
          </div>

          <p className="text-xs text-room-muted text-center">
            {initialFolderId
              ? 'Selected files will be added to this folder.'
              : 'Folder picker support varies by browser; drag multiple folders here together for multi-folder uploads.'}
          </p>
        </div>
      </div>
    </div>
  );
}
