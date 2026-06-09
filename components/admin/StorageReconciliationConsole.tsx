'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Shield,
  Trash2,
  Play,
  Terminal,
  Database,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Clock,
  HardDrive,
  X
} from 'lucide-react';

interface StorageStats {
  totalScanned: number;
  activeMatches: number;
  protectedRecent: number;
  protectedRecentSize: string;
  protectedRecentSizeBytes: number;
  orphans: number;
  orphansSize: string;
  orphansSizeBytes: number;
  deleted: number;
}

interface OrphanFile {
  name: string;
  path: string;
  size: number;
  updated_at: string;
}

interface StorageReconciliationConsoleProps {
  onBack: () => void;
  onExit?: () => void;
}

export function StorageReconciliationConsole({ onBack, onExit }: StorageReconciliationConsoleProps) {
  const [dryRun, setDryRun] = useState(true);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [orphans, setOrphans] = useState<OrphanFile[]>([]);
  const [protectedRecentList, setProtectedRecentList] = useState<OrphanFile[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean | null>(null);

  const consoleEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLogs([
      `[${new Date().toLocaleTimeString()}] Console initialized. Ready to scan storage.`
    ]);
  }, []);

  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const executeReconciliation = async (forceDelete = false) => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    const targetDryRun = !forceDelete;

    const newLogs = [
      ...logs,
      `[${new Date().toLocaleTimeString()}] Requesting server audit (dryRun: ${targetDryRun})...`
    ];
    setLogs(newLogs);

    try {
      const res = await fetch('/api/admin/storage-reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: targetDryRun })
      });

      const data = await res.json();

      if (data.logs) {
        setLogs((prev) => [...prev, ...data.logs]);
      }

      if (!res.ok) {
        throw new Error(data.error || 'Server rejected reconciliation request.');
      }

      setStats(data.stats);
      setOrphans(data.orphans || []);
      setProtectedRecentList(data.protectedRecentList || []);
      setSuccess(data.success);

      if (data.success) {
        setLogs((prev) => [
          ...prev,
          `[${new Date().toLocaleTimeString()}] Action complete! Status: SUCCESS.`
        ]);
      } else if (data.error) {
        setError(data.error);
        setLogs((prev) => [
          ...prev,
          `[${new Date().toLocaleTimeString()}] Action completed with errors: ${data.error}`
        ]);
      }
    } catch (err: any) {
      const errMsg = err?.message || 'Failed to execute storage reconciliation.';
      setError(errMsg);
      setLogs((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] [Fatal Error] ${errMsg}`
      ]);
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-room-bg overflow-y-auto text-room-text font-sans">
      {/* Header */}
      <header className="h-16 border-b border-room-border flex items-center px-6 gap-4 sticky top-0 bg-room-bg z-10 flex-shrink-0">
        <button
          onClick={onBack}
          className="p-2 hover:bg-room-hover rounded-full transition-colors text-room-muted hover:text-room-text"
          title="Back"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex items-center gap-2">
          <Shield size={20} className="text-blue-500" />
          <h1 className="text-xl font-bold tracking-tight">Storage Reconciliation Console</h1>
        </div>
        {onExit && (
          <button
            onClick={onExit}
            className="ml-auto p-2 hover:bg-room-hover rounded-full transition-colors text-room-muted hover:text-room-text"
            title="Exit"
          >
            <X size={20} />
          </button>
        )}
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full p-6 md:p-10 space-y-8">
        {/* Intro */}
        <div className="bg-room-surface border border-room-border rounded-2xl p-6 shadow-sm flex flex-col md:flex-row gap-6 items-start md:items-center">
          <div className="p-4 rounded-2xl bg-blue-500/10 text-blue-400">
            <HardDrive size={36} />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-room-text">Storage Audit & Orphan Clean Up</h2>
            <p className="text-sm text-room-muted mt-1 leading-relaxed">
              When PDF documents are deleted inside rooms or workspaces, database records are removed. However, physical storage files in the Supabase bucket may become orphaned over time. This console identifies and deletes orphaned PDF storage files safely.
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="grid md:grid-cols-3 gap-6">
          {/* Mode Selector Panel */}
          <div className="bg-room-surface border border-room-border rounded-2xl p-6 flex flex-col justify-between shadow-sm">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-room-muted mb-2">Reconciliation Mode</h3>
              <p className="text-xs text-room-muted leading-relaxed">
                Choose whether to safely scan files or execute physical deletions.
              </p>
            </div>
            <div className="mt-6 flex flex-col gap-3">
              <button
                onClick={() => setDryRun(true)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium transition-all ${
                  dryRun
                    ? 'bg-blue-600/10 border-blue-500/40 text-blue-400'
                    : 'bg-transparent border-room-border hover:bg-room-hover text-room-muted'
                }`}
              >
                <span>Dry-Run Mode (Safe)</span>
                <span className={`w-2 h-2 rounded-full ${dryRun ? 'bg-blue-500 animate-ping' : 'bg-room-muted'}`} />
              </button>
              <button
                onClick={() => setDryRun(false)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium transition-all ${
                  !dryRun
                    ? 'bg-red-500/10 border-red-500/40 text-red-400'
                    : 'bg-transparent border-room-border hover:bg-room-hover text-room-muted'
                }`}
              >
                <span>Live Deletion Mode</span>
                <span className={`w-2 h-2 rounded-full ${!dryRun ? 'bg-red-500 animate-ping' : 'bg-room-muted'}`} />
              </button>
            </div>
          </div>

          {/* Trigger Scan Panel */}
          <div className="bg-room-surface border border-room-border rounded-2xl p-6 flex flex-col justify-between shadow-sm">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-room-muted mb-2">Safe Audit Scanner</h3>
              <p className="text-xs text-room-muted leading-relaxed">
                Queries all active room PDFs and does a full recursive scan of storage to identify orphans.
              </p>
            </div>
            <div className="mt-6">
              <button
                onClick={() => executeReconciliation(false)}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition-all shadow-lg shadow-blue-500/20 active:scale-95 disabled:opacity-50"
              >
                {loading ? <RefreshCw size={18} className="animate-spin" /> : <Play size={18} />}
                <span>Scan and Audit</span>
              </button>
            </div>
          </div>

          {/* Clean Up Action Panel */}
          <div className="bg-room-surface border border-room-border rounded-2xl p-6 flex flex-col justify-between shadow-sm border-red-500/10">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-red-400 mb-2">Permanent Cleanup</h3>
              <p className="text-xs text-room-muted leading-relaxed">
                Deletes all identified orphans permanently from Supabase Storage. This action is irreversible.
              </p>
            </div>
            <div className="mt-6">
              <button
                onClick={() => executeReconciliation(true)}
                disabled={loading || dryRun || orphans.length === 0}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-medium transition-all shadow-lg shadow-red-500/20 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                title={dryRun ? 'Toggle Deletion Mode to enable' : 'Clean up orphans'}
              >
                <Trash2 size={18} />
                <span>Delete All Orphans</span>
              </button>
            </div>
          </div>
        </div>

        {/* Stats Section */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <StatCard
              icon={<Database className="text-room-muted" />}
              label="Scanned Storage Files"
              value={stats.totalScanned}
            />
            <StatCard
              icon={<CheckCircle2 className="text-emerald-400" />}
              label="Active Database Matches"
              value={stats.activeMatches}
            />
            <StatCard
              icon={<Clock className="text-amber-400" />}
              label="Protected Active Uploads"
              value={`${stats.protectedRecent} (${stats.protectedRecentSize})`}
              subtitle="Excluded (Uploaded <15m ago)"
            />
            <StatCard
              icon={<AlertTriangle className={stats.orphans > 0 ? 'text-red-400' : 'text-room-muted'} />}
              label="Identified Orphans"
              value={`${stats.orphans} (${stats.orphansSize})`}
              highlight={stats.orphans > 0}
            />
          </div>
        )}

        {/* Terminal/Console Logs */}
        <div className="bg-[#0f172a] border border-[#1e293b] rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[320px]">
          <div className="bg-[#1e293b] px-4 py-2 flex items-center justify-between border-b border-[#334155]">
            <div className="flex items-center gap-2 text-xs font-mono text-[#94a3b8]">
              <Terminal size={14} className="text-[#38bdf8]" />
              <span>SYSTEM OUTPUT LOGS</span>
            </div>
            {loading && <div className="text-[10px] text-[#38bdf8] font-mono animate-pulse">EXECUTING RECONCILIATION...</div>}
          </div>
          <div className="flex-1 overflow-y-auto p-4 font-mono text-xs text-[#e2e8f0] space-y-2 bg-[#090d16]">
            {logs.map((log, index) => {
              let colorClass = 'text-[#e2e8f0]';
              if (log.includes('[Error]')) colorClass = 'text-red-400 font-bold';
              else if (log.includes('[Warning]')) colorClass = 'text-amber-400';
              else if (log.includes('[Success]')) colorClass = 'text-emerald-400 font-bold';
              else if (log.includes('Analysis Summary:')) colorClass = 'text-[#38bdf8] font-semibold';
              return (
                <div key={index} className={`${colorClass} break-all whitespace-pre-wrap`}>
                  {log}
                </div>
              );
            })}
            <div ref={consoleEndRef} />
          </div>
        </div>

        {/* Orphans Detailed Table */}
        {orphans.length > 0 && (
          <div className="bg-room-surface border border-room-border rounded-2xl overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-room-border flex items-center justify-between bg-room-bg">
              <div className="flex items-center gap-2">
                <FileText size={18} className="text-red-400" />
                <h3 className="font-bold text-room-text">Identified Storage Orphans ({orphans.length})</h3>
              </div>
              <span className="text-xs font-medium bg-red-500/10 text-red-400 px-2.5 py-1 rounded-full">
                Total reclaimable space: {stats?.orphansSize}
              </span>
            </div>
            <div className="overflow-x-auto max-h-[350px]">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-room-bg border-b border-room-border text-room-muted uppercase tracking-wider text-[11px] font-semibold">
                    <th className="px-6 py-3">File Name</th>
                    <th className="px-6 py-3">Storage Path (Library/Room/PDF)</th>
                    <th className="px-6 py-3">File Size</th>
                    <th className="px-6 py-3">Uploaded Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-room-border">
                  {orphans.map((orphan, index) => (
                    <tr key={index} className="hover:bg-room-hover/30 transition-colors">
                      <td className="px-6 py-4 font-medium text-room-text truncate max-w-[200px]" title={orphan.name}>
                        {orphan.name}
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-room-muted max-w-[320px] truncate" title={orphan.path}>
                        {orphan.path}
                      </td>
                      <td className="px-6 py-4 text-room-text whitespace-nowrap">
                        {formatBytes(orphan.size)}
                      </td>
                      <td className="px-6 py-4 text-room-muted whitespace-nowrap">
                        {new Date(orphan.updated_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Protected Active Uploads Table */}
        {protectedRecentList.length > 0 && (
          <div className="bg-room-surface border border-room-border rounded-2xl overflow-hidden shadow-sm border-amber-500/10">
            <div className="px-6 py-4 border-b border-room-border flex items-center justify-between bg-amber-500/5">
              <div className="flex items-center gap-2">
                <Clock size={18} className="text-amber-400" />
                <h3 className="font-bold text-room-text">Protected Active Uploads ({protectedRecentList.length})</h3>
              </div>
              <span className="text-xs font-medium bg-amber-500/10 text-amber-400 px-2.5 py-1 rounded-full">
                Excluded: {stats?.protectedRecentSize}
              </span>
            </div>
            <div className="overflow-x-auto max-h-[220px]">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-room-bg border-b border-room-border text-room-muted uppercase tracking-wider text-[11px] font-semibold">
                    <th className="px-6 py-3">File Name</th>
                    <th className="px-6 py-3">Storage Path</th>
                    <th className="px-6 py-3">File Size</th>
                    <th className="px-6 py-3">Uploaded Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-room-border">
                  {protectedRecentList.map((file, index) => (
                    <tr key={index} className="hover:bg-room-hover/30 transition-colors">
                      <td className="px-6 py-4 font-medium text-room-text truncate max-w-[200px]" title={file.name}>
                        {file.name}
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-room-muted max-w-[320px] truncate" title={file.path}>
                        {file.path}
                      </td>
                      <td className="px-6 py-4 text-room-text whitespace-nowrap">
                        {formatBytes(file.size)}
                      </td>
                      <td className="px-6 py-4 text-amber-300 font-semibold whitespace-nowrap">
                        {new Date(file.updated_at).toLocaleTimeString()} (Recent)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      <footer className="p-10 text-center text-xs text-room-muted border-t border-room-border/40 mt-10">
        <p>© 2026 ReadRoom Admin Portal. All rights reserved.</p>
        <p className="mt-1 opacity-50">Storage Reconciliation Tool v1.0.0-stable</p>
      </footer>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  subtitle,
  highlight = false
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subtitle?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`bg-room-surface border rounded-2xl p-5 shadow-sm flex flex-col justify-between min-h-[110px] ${
      highlight ? 'border-red-500/25 bg-red-500/5' : 'border-room-border'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-room-muted font-semibold uppercase tracking-wider">{label}</span>
        <div className="p-1.5 rounded-lg bg-room-bg">{icon}</div>
      </div>
      <div>
        <h4 className={`text-xl font-bold tracking-tight ${highlight ? 'text-red-400' : 'text-room-text'}`}>
          {value}
        </h4>
        {subtitle && <p className="text-[10px] text-room-muted mt-1">{subtitle}</p>}
      </div>
    </div>
  );
}
