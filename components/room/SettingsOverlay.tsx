'use client';
// components/room/SettingsOverlay.tsx
// In-room settings panel rendered as an overlay so navigating to settings
// does NOT unmount RoomShell / PDF viewer / socket connections.

import React, { useState, useEffect } from 'react';
import { X, LogOut, User, Shield, Bell, Palette, Globe, ArrowLeft } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useUIStore } from '@/store/uiStore';
import { usePresenceStore } from '@/store/presenceStore';
import { AvatarUpload } from '@/components/ui/AvatarUpload';
import { getSocket } from '@/lib/socket/client';

interface UserProfile {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
}

export function SettingsOverlay() {
  const { setSettingsOpen } = useUIStore();
  const { theme, setTheme } = useUIStore();
  const { user, signOut } = useAuth();
  const { self, updateSelf } = usePresenceStore();
  const { getState } = useUIStore;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [showUploadAvatar, setShowUploadAvatar] = useState(false);
  const [notifications, setNotifications] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await fetch('/api/user/settings');
        if (res.ok) {
          const data = await res.json();
          setProfile(data.profile);
          setNewName(data.profile.display_name);
        }
      } catch { /* best effort */ }
      finally { setLoading(false); }
    };
    fetchProfile();
  }, []);

  const handleUpdateName = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: newName.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setProfile(data.profile);
        setEditingName(false);
        try {
          localStorage.setItem('readroom_user_name', data.profile.display_name);
          localStorage.setItem('readroom_name_update_ts', Date.now().toString());
        } catch {}
      }
    } catch { /* best effort */ }
    finally { setSaving(false); }
  };

  const params = useParams();
  const roomId = params.id as string;

  const handleAvatarUploaded = (avatarUrl: string) => {
    setProfile((p) => p ? { ...p, avatar_url: avatarUrl } : p);
    setShowUploadAvatar(false);
    // Persist for presence sync
    try { localStorage.setItem('readroom:avatar-url', avatarUrl); } catch {}
    // Update self in room immediately
    updateSelf({ avatarUrl });
    
    // Broadcast to other users in the room
    const currentSelf = usePresenceStore.getState().self;
    if (currentSelf && roomId) {
      getSocket().emit('presence:update', {
        roomId,
        user: { ...currentSelf, avatarUrl },
      });
    }
  };

  const close = () => setSettingsOpen(false);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-room-bg overflow-y-auto">
      {/* Header */}
      <header className="h-16 border-b border-room-border flex items-center px-6 gap-4 sticky top-0 bg-room-bg/90 backdrop-blur-md z-10 flex-shrink-0">
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
                          onKeyDown={(e) => { if (e.key === 'Enter') handleUpdateName(); if (e.key === 'Escape') setEditingName(false); }}
                          className="flex-1 min-w-0 bg-room-bg border border-room-border rounded-lg px-3 py-2 text-room-text outline-none focus:border-blue-500"
                        />
                        <button onClick={handleUpdateName} disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">Save</button>
                        <button onClick={() => { setEditingName(false); setNewName(profile?.display_name || ''); }} className="px-4 py-2 border border-room-border rounded-lg text-sm text-room-muted hover:text-room-text transition-colors">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-bold text-room-text">{profile?.display_name || 'Reader'}</span>
                        <button onClick={() => setEditingName(true)} className="text-xs px-2 py-1 text-room-muted hover:text-room-text hover:bg-room-hover rounded transition-colors">Edit</button>
                      </div>
                    )}
                    <p className="text-room-muted text-sm mt-1">{profile?.email}</p>
                  </div>
                </div>
              </div>
            </section>

            {/* App Settings */}
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
