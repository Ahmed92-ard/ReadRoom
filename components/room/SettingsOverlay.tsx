'use client';
// components/room/SettingsOverlay.tsx
// In-room settings panel rendered as an overlay so navigating to settings
// does NOT unmount RoomShell / PDF viewer / socket connections.
//
// Profile changes go through useAuth.updateDisplayName / updateAvatarUrl which:
//   1. Persist to Supabase (permanent)
//   2. Broadcast via socket profile:updated (real-time propagation to all users)
//   3. Update localStorage cache

import React, { useState, useEffect } from 'react';
import { X, LogOut, User, Bell, Palette, ArrowLeft, Shield } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useUIStore } from '@/store/uiStore';
import { usePresenceStore } from '@/store/presenceStore';
import { AvatarUpload } from '@/components/ui/AvatarUpload';
import { StorageReconciliationConsole } from '@/components/admin/StorageReconciliationConsole';

interface UserProfile {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
}

export function SettingsOverlay() {
  const router = useRouter();
  const { setSettingsOpen, theme, setTheme } = useUIStore();
  const { user, signOut, updateDisplayName, updateAvatarUrl } = useAuth();
  const { self } = usePresenceStore();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [view, setView] = useState<'settings' | 'reconciliation'>('settings');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [showUploadAvatar, setShowUploadAvatar] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await fetch('/api/user/settings');
        if (res.ok) {
          const data = await res.json();
          setProfile(data.profile);
          setNewName(data.profile?.display_name ?? '');
        }
      } catch { /* best effort */ }
      finally { setLoading(false); }
    };
    fetchProfile();
  }, []);

  const handleUpdateName = async () => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === profile?.display_name) {
      setEditingName(false);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const ok = await updateDisplayName(trimmed);
      if (ok) {
        setProfile((p) => p ? { ...p, display_name: trimmed } : p);
        setEditingName(false);
      } else {
        setSaveError('Failed to save name. Please try again.');
      }
    } catch {
      setSaveError('Failed to save name. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUploaded = async (avatarUrl: string) => {
    setProfile((p) => p ? { ...p, avatar_url: avatarUrl } : p);
    setShowUploadAvatar(false);
    // Persist to DB + broadcast via socket (centralized)
    await updateAvatarUrl(avatarUrl);
  };

  const close = () => setSettingsOpen(false);

  if (view === 'reconciliation') {
    return (
      <StorageReconciliationConsole
        onBack={() => setView('settings')}
        onExit={close}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-room-bg overflow-y-auto">
      {/* Header */}
      <header className="h-16 border-b border-room-border flex items-center px-6 gap-4 sticky top-0 bg-room-bg z-10 flex-shrink-0">
        <button
          onClick={close}
          className="p-2 hover:bg-room-hover rounded-full transition-colors text-room-muted hover:text-room-text"
          title="Close settings"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold tracking-tight text-room-text">Settings</h1>
        <button
          onClick={close}
          className="ml-auto p-2 hover:bg-room-hover rounded-full transition-colors text-room-muted hover:text-room-text"
          title="Close"
        >
          <X size={20} />
        </button>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full p-6 md:p-10">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-10 h-10 rounded-full border-2 border-room-border border-t-blue-500 animate-spin" />
          </div>
        ) : (
          <div className="space-y-10">
            {/* Profile */}
            <section>
              <h2 className="text-xs font-semibold text-room-muted uppercase tracking-wider mb-4">Profile</h2>
              <div className="bg-room-surface border border-room-border rounded-2xl p-6">
                <div className="flex items-center gap-6">
                  <div className="relative group">
                    <div className="w-20 h-20 rounded-full bg-blue-600 flex items-center justify-center text-white text-3xl font-bold overflow-hidden">
                      {profile?.avatar_url ? (
                        <img src={profile.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                      ) : (
                        profile?.email?.[0]?.toUpperCase()
                      )}
                    </div>
                    <button
                      onClick={() => setShowUploadAvatar(true)}
                      className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                      title="Change avatar"
                    >
                      <User size={20} className="text-white" />
                    </button>
                  </div>

                  <div className="flex-1 min-w-0">
                    <label className="text-xs text-room-muted uppercase tracking-wider mb-1 block">Display Name</label>
                    {editingName ? (
                      <div className="flex gap-2 flex-wrap">
                        <input
                          autoFocus
                          type="text"
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleUpdateName();
                            if (e.key === 'Escape') { setEditingName(false); setNewName(profile?.display_name ?? ''); }
                          }}
                          className="flex-1 min-w-0 bg-room-bg border border-room-border rounded-lg px-3 py-2 text-room-text outline-none focus:border-blue-500"
                          maxLength={64}
                        />
                        <button
                          onClick={handleUpdateName}
                          disabled={saving}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                        >
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          onClick={() => { setEditingName(false); setNewName(profile?.display_name ?? ''); setSaveError(null); }}
                          className="px-4 py-2 border border-room-border rounded-lg text-sm text-room-muted hover:text-room-text transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-bold text-room-text">{profile?.display_name || 'Reader'}</span>
                        <button
                          onClick={() => setEditingName(true)}
                          className="text-xs px-2 py-1 text-room-muted hover:text-room-text hover:bg-room-hover rounded transition-colors"
                        >
                          Edit
                        </button>
                      </div>
                    )}
                    {saveError && (
                      <p className="text-xs text-red-400 mt-1">{saveError}</p>
                    )}
                    <p className="text-room-muted text-sm mt-1">{profile?.email}</p>
                    <p className="text-xs text-room-muted mt-0.5">
                      Changes are saved permanently and visible to all room members instantly.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* Preferences */}
            <section>
              <h2 className="text-xs font-semibold text-room-muted uppercase tracking-wider mb-4">Preferences</h2>
              <div className="bg-room-surface border border-room-border rounded-2xl overflow-hidden">
                {/* Theme */}
                <button
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className="w-full flex items-center gap-4 px-6 py-4 hover:bg-room-hover transition-colors text-left border-b border-room-border"
                >
                  <div className="w-10 h-10 rounded-xl bg-room-bg flex items-center justify-center text-room-muted">
                    <Palette size={18} />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-medium text-room-text">Appearance</h4>
                    <p className="text-xs text-room-muted">{theme === 'dark' ? 'Dark theme' : 'Light theme'}</p>
                  </div>
                  <div className={`w-11 h-6 rounded-full flex items-center px-1 transition-colors ${theme === 'dark' ? 'bg-blue-500' : 'bg-room-border'}`}>
                    <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${theme === 'dark' ? 'translate-x-5' : 'translate-x-0'}`} />
                  </div>
                </button>
                {/* Notifications */}
                <button
                  onClick={() => setNotifications(!notifications)}
                  className="w-full flex items-center gap-4 px-6 py-4 hover:bg-room-hover transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-xl bg-room-bg flex items-center justify-center text-room-muted">
                    <Bell size={18} />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-medium text-room-text">Notifications</h4>
                    <p className="text-xs text-room-muted">Desktop notifications for messages</p>
                  </div>
                  <div className={`w-11 h-6 rounded-full flex items-center px-1 transition-colors ${notifications ? 'bg-blue-500' : 'bg-room-border'}`}>
                    <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${notifications ? 'translate-x-5' : 'translate-x-0'}`} />
                  </div>
                </button>
              </div>
            </section>

            {/* Admin Tools */}
            <section>
              <h2 className="text-xs font-semibold text-room-muted uppercase tracking-wider mb-4">Admin Tools</h2>
              <div className="bg-room-surface border border-room-border rounded-2xl overflow-hidden">
                <button
                  onClick={() => setView('reconciliation')}
                  className="w-full flex items-center gap-4 px-6 py-4 hover:bg-room-hover transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-xl bg-room-bg flex items-center justify-center text-room-muted">
                    <Shield size={18} />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-medium text-room-text">Storage Reconciliation</h4>
                    <p className="text-xs text-room-muted">Scan and clean up orphaned PDF storage files</p>
                  </div>
                </button>
              </div>
            </section>

            {/* Sign out */}
            <section className="pt-4 border-t border-room-border">
              <h2 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-4">Danger Zone</h2>
              <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="font-bold text-red-400">Sign Out</h3>
                  <p className="text-sm text-room-muted">Disconnect your account from this device.</p>
                </div>
                <button
                  onClick={() => signOut()}
                  className="flex items-center justify-center gap-2 px-6 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl font-medium transition-all"
                >
                  <LogOut size={18} />
                  Sign Out
                </button>
              </div>
            </section>
          </div>
        )}
      </main>

      {showUploadAvatar && profile && (
        <AvatarUpload
          currentUrl={profile.avatar_url}
          currentColor="#2563eb"
          currentInitials={profile.email?.[0]?.toUpperCase() ?? '?'}
          onUploaded={handleAvatarUploaded}
          onClose={() => setShowUploadAvatar(false)}
        />
      )}
    </div>
  );
}
