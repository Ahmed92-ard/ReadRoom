// components/drive/GooglePicker.tsx
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, X } from 'lucide-react';
import type { PDFMeta, GoogleDriveFile } from '@/types';

interface GooglePickerProps {
  driveToken: string | null;
  onRequestAccess: () => void;
  onSelect: (pdf: PDFMeta) => void | Promise<void>;
  onClose: () => void;
  mode?: 'replace' | 'add'; // 'replace' for single PDF, 'add' for multiple
}

declare global {
  interface Window { gapi?: any; google?: any; }
}

const DEVELOPER_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY!;
const APP_ID = process.env.NEXT_PUBLIC_GOOGLE_APP_ID!;

export function GooglePicker({ driveToken, onRequestAccess, onSelect, onClose, mode = 'replace' }: GooglePickerProps) {
  const [gapiReady, setGapiReady] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const pickerRef = useRef<any>(null);
  const hasAutoOpened = useRef(false);

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

  const openPicker = useCallback(() => {
    if (!gapiReady || !driveToken) return;
    setPickerError(null);

    const view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
      .setMimeTypes('application/pdf')
      .setMode(window.google.picker.DocsViewMode.LIST)
      .setIncludeFolders(true);

    const pickerBuilder = new window.google.picker.PickerBuilder()
      .setAppId(APP_ID)
      .setOAuthToken(driveToken)
      .setDeveloperKey(DEVELOPER_KEY)
      .addView(view)
      .addView(new window.google.picker.DocsView().setMimeTypes('application/pdf').setLabel('Shared with me'))
      .setTitle(mode === 'add' ? 'Select one or more PDFs' : 'Select a PDF to share');

    if (window.google.picker.Feature?.MULTI_SELECT_ENABLED) {
      pickerBuilder.enableFeature(window.google.picker.Feature.MULTI_SELECT_ENABLED);
    }

    const picker = pickerBuilder.setCallback(async (data: any) => {
      if (data.action !== window.google.picker.Action.PICKED) return;
      const files: GoogleDriveFile[] = data.docs ?? [];

      // Close the modal dialog immediately — upload continues in background
      onClose();
      setPickerOpen(false);

      try {
        for (const file of files) {
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
        }
      } catch (err) {
        setPickerError(err instanceof Error ? err.message : String(err));
        return;
      }
    }).build();

    pickerRef.current = picker;
    picker.setVisible(true);
    setPickerOpen(true);
  }, [gapiReady, driveToken, mode, onSelect]);

  // No auto-open: the "Choose PDF from Drive" button in the dialog calls openPicker() directly.

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-md mx-4 rounded-2xl bg-room-surface border border-room-border shadow-2xl p-8">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-lg text-room-muted hover:text-room-text hover:bg-room-hover transition-colors"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <FolderOpen size={20} className="text-blue-400" />
            </div>
            <h2 className="text-lg font-semibold text-room-text">
              {mode === 'add' ? 'Add PDFs to this channel' : 'Open from Google Drive'}
            </h2>
          </div>
          <p className="text-sm text-room-muted">
            {mode === 'add'
              ? 'Select one or more PDFs to add to this channel. A private room copy is created so members can read it without their own Drive access.'
              : 'Select a PDF to load it into this reading room.'
            }
          </p>
        </div>

        <div className="mb-6 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <p className="text-xs text-amber-300">
            <strong>Privacy:</strong> Room PDFs are copied into private shared storage and served only to room members.
          </p>
        </div>

        {pickerError && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {pickerError}
          </div>
        )}

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
          <button
            onClick={openPicker}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium text-sm bg-blue-600 text-white hover:bg-blue-500 active:bg-blue-700 transition-all min-h-[44px]"
          >
            <FolderOpen size={18} />
            Choose PDF from Drive
          </button>
        )}
      </div>
    </div>
  );
}
