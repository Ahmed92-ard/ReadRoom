'use client';
// components/ui/AvatarUpload.tsx
import React, { useRef, useState, useCallback } from 'react';
import { Camera, X, Upload, Loader2 } from 'lucide-react';

interface AvatarUploadProps {
  currentUrl?: string | null;
  currentColor: string;
  currentInitials: string;
  onUploaded: (url: string) => void;
  onClose: () => void;
}

const ACCEPTED = 'image/jpeg,image/png,image/webp,image/gif';
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export function AvatarUpload({ currentUrl, currentColor, currentInitials, onUploaded, onClose }: AvatarUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(currentUrl ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback((f: File) => {
    setError(null);
    if (!f.type.startsWith('image/')) {
      setError('Please select an image file (JPEG, PNG, WebP, GIF).');
      return;
    }
    if (f.size > MAX_BYTES) {
      setError('Image must be smaller than 5 MB.');
      return;
    }
    setFile(f);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(f);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/user/avatar', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      const url = data.profile?.avatar_url;
      if (!url) throw new Error('No URL returned from server');
      onUploaded(url);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-sm mx-4 rounded-2xl bg-room-surface border border-room-border shadow-2xl p-6">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-room-muted hover:text-room-text hover:bg-room-hover transition-colors"
          aria-label="Close"
        >
          <X size={16} />
        </button>

        <h2 className="text-base font-semibold text-room-text mb-4">Edit Profile Photo</h2>

        {/* Preview */}
        <div
          className="mx-auto mb-4 w-24 h-24 rounded-full overflow-hidden flex items-center justify-center ring-4 ring-blue-500/30 cursor-pointer"
          style={preview ? {} : { backgroundColor: currentColor }}
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          title="Click to select photo"
        >
          {preview ? (
            <img src={preview} alt="Preview" className="w-full h-full object-cover" />
          ) : (
            <span className="text-2xl font-bold text-white select-none">{currentInitials}</span>
          )}
        </div>

        {/* Drop zone */}
        <div
          className="border-2 border-dashed border-room-border rounded-xl p-4 text-center cursor-pointer hover:border-blue-500/50 hover:bg-blue-500/5 transition-colors mb-4"
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          <Camera size={20} className="mx-auto mb-1 text-room-muted" />
          <p className="text-xs text-room-muted">
            Click or drag &amp; drop to select<br />
            <span className="text-[10px]">JPEG, PNG, WebP, GIF · max 5 MB</span>
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={handleInputChange}
        />

        {error && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium text-room-muted border border-room-border hover:bg-room-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {uploading ? (
              <><Loader2 size={14} className="animate-spin" /> Uploading…</>
            ) : (
              <><Upload size={14} /> Save Photo</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
