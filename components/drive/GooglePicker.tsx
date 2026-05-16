'use client';

// GooglePicker.tsx — Unified import dialog supporting:
//   A. Google Drive (single PDFs or entire folders)
//   B. Local device storage (desktop + mobile)

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, Upload, X, HardDrive, FolderPlus } from 'lucide-react';
import type { PDFMeta, GoogleDriveFile } from '@/types';

interface GooglePickerProps {
  driveToken: string | null;
  onRequestAccess: () => void;
  onSelect: (pdf: PDFMeta) => void | Promise<void>;
  /** Called when a local file is selected — receives the File object */
  onLocalFile?: (file: File) => void | Promise<void>;
  onClose: () => void;
  mode?: 'replace' | 'add';
  /** libraryId + channelId needed for local upload endpoint */
  libraryId?: string;
  channelId?: string;
}

declare global {
  interface Window { gapi?: any; google?: any; }
}

const DEVELOPER_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY!;
const APP_ID = process.env.NEXT_PUBLIC_GOOGLE_APP_ID!;

type ImportTab = 'drive' | 'local';

export function GooglePicker({
  driveToken,
  onRequestAccess,
  onSelect,
  onLocalFile,
  onClose,
  mode = 'replace',
  libraryId,
  channelId,
}: GooglePickerProps) {
  const [gapiReady, setGapiReady] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ImportTab>('drive');
  const [localUploading, setLocalUploading] = useState(false);
  const [localProgress, setLocalProgress] = useState<string | null>(null);
  const pickerRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load Google API scripts
  useEffect(() => {
    const loadScript = (src: string) =>
      new Promise<void>((resolve) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.defer = true;
        s.onload = () => resolve();
        document.body.appendChild(s);
      });

    loadScript('https://apis.google.com/js/api.js').then(() => {
      const waitForGapi = () => {
        if (window.gapi?.load) {
          window.gapi.load('picker', () => setGapiReady(true));
        } else {
          setTimeout(waitForGapi, 100);
        }
      };
      waitForGapi();
    });
  }, []);

  // ── Google Drive picker ───────────────────────────────────────────────────
  const openDrivePicker = useCallback(() => {
    if (!gapiReady || !driveToken) return;
    setPickerError(null);

    // PDF files view
    const pdfView = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
      .setMimeTypes('application/pdf')
      .setMode(window.google.picker.DocsViewMode.LIST)
      .setIncludeFolders(true);

    // Folder view — lets users pick an entire folder
    const folderView = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
      .setSelectFolderEnabled(true)
      .setLabel('Select a folder');

    const pickerBuilder = new window.google.picker.PickerBuilder()
      .setAppId(APP_ID)
      .setOAuthToken(driveToken)
      .setDeveloperKey(DEVELOPER_KEY)
      .addView(pdfView)
      .addView(new window.google.picker.DocsView().setMimeTypes('application/pdf').setLabel('Shared with me'))
      .addView(folderView)
      .setTitle(mode === 'add' ? 'Select PDFs or a folder' : 'Select a PDF to share');

    if (window.google.picker.Feature?.MULTI_SELECT_ENABLED) {
      pickerBuilder.enableFeature(window.google.picker.Feature.MULTI_SELECT_ENABLED);
    }

    const picker = pickerBuilder.setCallback(async (data: any) => {
      if (data.action !== window.google.picker.Action.PICKED) return;
      const docs: GoogleDriveFile[] = data.docs ?? [];

      // Close dialog immediately — processing continues in background
      onClose();

      try {
        for (const doc of docs) {
          // If a folder was selected, list its PDF contents
          if (doc.mimeType === 'application/vnd.google-apps.folder') {
            await importDriveFolder(doc.id, doc.name);
          } else {
            await importDriveFile(doc);
          }
        }
      } catch (err) {
        setPickerError(err instanceof Error ? err.message : String(err));
      }
    }).build();

    pickerRef.current = picker;
    picker.setVisible(true);
  }, [gapiReady, driveToken, mode, onSelect, onClose]);

  const importDriveFile = async (file: GoogleDriveFile) => {
    let thumbnail: string | null = null;
    try {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}?fields=thumbnailLink,owners`,
        { headers: { Authorization: `Bearer ${driveToken}` } }
      );
      const meta = await res.json();
      thumbnail = meta.thumbnailLink ?? null;
      file.owners = meta.owners;
    } catch { /* thumbnail optional */ }

    await onSelect({
      fileId: file.id,
      filename: file.name,
      owner: file.owners?.[0]?.emailAddress ?? 'Unknown',
      thumbnail,
      totalPages: null,
    });
  };

  const importDriveFolder = async (folderId: string, folderName: string) => {
    if (!driveToken) return;
    // List all PDFs in the folder (up to 100)
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents and mimeType='application/pdf' and trashed=false`)}&fields=files(id,name,thumbnailLink,owners)&pageSize=100`,
      { headers: { Authorization: `Bearer ${driveToken}` } }
    );
    if (!res.ok) throw new Error(`Failed to list folder "${folderName}"`);
    const data = await res.json();
    const files: GoogleDriveFile[] = data.files ?? [];

    for (const file of files) {
      await onSelect({
        fileId: file.id,
        filename: file.name,
        owner: file.owners?.[0]?.emailAddress ?? 'Unknown',
        thumbnail: file.thumbnailLink ?? null,
        totalPages: null,
      });
    }
  };

  // ── Local file upload ─────────────────────────────────────────────────────
  const handleLocalFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setPickerError(null);
    setLocalUploading(true);

    const pdfs = Array.from(files).filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );

    if (pdfs.length === 0) {
      setPickerError('Please select PDF files only.');
      setLocalUploading(false);
      return;
    }

    try {
      for (let i = 0; i < pdfs.length; i++) {
        const file = pdfs[i];
        setLocalProgress(`Uploading ${i + 1}/${pdfs.length}: ${file.name}`);

        if (onLocalFile) {
          // Caller handles the upload
          await onLocalFile(file);
        } else if (libraryId && channelId) {
          // Upload directly to the channel via the local upload endpoint
          const formData = new FormData();
          formData.append('file', file);

          const res = await fetch(
            `/api/libraries/${libraryId}/channels/${channelId}/pdfs/upload`,
            { method: 'POST', body: formData }
          );
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Upload failed');

          // Notify parent via onSelect with a synthetic PDFMeta
          await onSelect({
            fileId: data.pdf.driveId,
            filename: data.pdf.filename,
            owner: 'Local Upload',
            thumbnail: null,
            totalPages: null,
            url: data.pdf.url,
          });
        }
      }
      onClose();
    } catch (err) {
      setPickerError(err instanceof Error ? err.message : String(err));
    } finally {
      setLocalUploading(false);
      setLocalProgress(null);
    }
  }, [onLocalFile, onSelect, onClose, libraryId, channelId]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    handleLocalFiles(e.dataTransfer.files);
  }, [handleLocalFiles]);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-md mx-4 rounded-2xl bg-room-surface border border-room-border shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <FolderOpen size={20} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-room-text">
                {mode === 'add' ? 'Add PDFs to this room' : 'Open a PDF'}
              </h2>
              <p className="text-xs text-room-muted">Google Drive or local device</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-room-muted hover:text-room-text hover:bg-room-hover transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-room-border mx-6">
          <button
            onClick={() => setActiveTab('drive')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'drive'
                ? 'border-blue-400 text-blue-400'
                : 'border-transparent text-room-muted hover:text-room-text'
            }`}
          >
            <FolderOpen size={15} />
            Google Drive
          </button>
          <button
            onClick={() => setActiveTab('local')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'local'
                ? 'border-blue-400 text-blue-400'
                : 'border-transparent text-room-muted hover:text-room-text'
            }`}
          >
            <HardDrive size={15} />
            Local Device
          </button>
        </div>

        <div className="p-6">
          {pickerError && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {pickerError}
            </div>
          )}

          {/* ── Google Drive tab ── */}
          {activeTab === 'drive' && (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <p className="text-xs text-amber-300">
                  <strong>Privacy:</strong> PDFs are copied into private shared storage and served only to room members. Folder imports add all PDFs inside the folder.
                </p>
              </div>

              {!driveToken ? (
                <button
                  onClick={onRequestAccess}
                  className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl font-medium text-sm bg-white text-gray-900 hover:bg-gray-100 active:bg-gray-200 transition-all min-h-[44px]"
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                    <path d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z" fill="#4285F4"/>
                    <path d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z" fill="#34A853"/>
                    <path d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z" fill="#FBBC05"/>
                    <path d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z" fill="#EA4335"/>
                  </svg>
                  Authorize Drive Access
                </button>
              ) : !gapiReady ? (
                <div className="flex items-center justify-center gap-2 py-3 text-room-muted text-sm">
                  <span className="animate-spin w-4 h-4 border-2 border-room-muted border-t-transparent rounded-full" />
                  Loading Google Picker…
                </div>
              ) : (
                <div className="space-y-2">
                  <button
                    onClick={openDrivePicker}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium text-sm bg-blue-600 text-white hover:bg-blue-500 active:bg-blue-700 transition-all min-h-[44px]"
                  >
                    <FolderOpen size={18} />
                    Choose PDFs from Drive
                  </button>
                  <p className="text-center text-xs text-room-muted">
                    You can select individual PDFs or an entire folder
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Local device tab ── */}
          {activeTab === 'local' && (
            <div className="space-y-4">
              {/* Drop zone */}
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onClick={() => !localUploading && fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                  localUploading
                    ? 'border-blue-500/50 bg-blue-500/5 cursor-wait'
                    : 'border-room-border hover:border-blue-500/50 hover:bg-blue-500/5'
                }`}
              >
                {localUploading ? (
                  <div className="space-y-2">
                    <div className="animate-spin w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full mx-auto" />
                    <p className="text-sm text-blue-400 font-medium">{localProgress ?? 'Uploading…'}</p>
                  </div>
                ) : (
                  <>
                    <Upload size={32} className="text-room-muted mx-auto mb-3" />
                    <p className="text-sm font-medium text-room-text mb-1">
                      Drop PDF files here
                    </p>
                    <p className="text-xs text-room-muted">
                      or click to browse your device
                    </p>
                    <p className="text-xs text-room-muted mt-2">
                      Supports multiple files • Max 100 MB each
                    </p>
                  </>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                className="hidden"
                onChange={(e) => handleLocalFiles(e.target.files)}
              />

              <button
                onClick={() => !localUploading && fileInputRef.current?.click()}
                disabled={localUploading}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium text-sm bg-room-bg border border-room-border text-room-text hover:bg-room-hover disabled:opacity-50 disabled:cursor-wait transition-all min-h-[44px]"
              >
                <HardDrive size={18} />
                Browse Files
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
