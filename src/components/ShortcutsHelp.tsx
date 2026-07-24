'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { Settings, X } from 'lucide-react';
import { COMMAND_GROUPS, type Platform } from '@/lib/keybindings';
import { KbdList } from './Kbd';
import type { ResolvedCommand } from './KeyboardShortcutsProvider';

/**
 * The `?` keyboard-shortcuts cheat sheet — a read-only reference grouped the
 * same way as the settings tab. Actionable navigation lives in the command
 * palette; this is purely "what are the keys". Native <dialog> for the focus
 * trap + Escape, styled via globals.css `.cmdk-*` / `.shortcuts-*`.
 */
export default function ShortcutsHelp({
  open,
  onClose,
  commands,
  platform,
}: {
  open: boolean;
  onClose: () => void;
  commands: ResolvedCommand[];
  platform: Platform;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    else if (!open && dlg.open) dlg.close();
  }, [open]);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const handleClose = () => onClose();
    dlg.addEventListener('close', handleClose);
    return () => dlg.removeEventListener('close', handleClose);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-label="Keyboard shortcuts"
      className="cmdk-dialog"
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="cmdk-panel shortcuts-panel">
        <div className="shortcuts-head">
          <div>
            <h2 className="shortcuts-title">Keyboard shortcuts</h2>
            <p className="shortcuts-sub">
              Press <kbd className="kbd">?</kbd> any time to open this list.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            className="shortcuts-close"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="shortcuts-body">
          {COMMAND_GROUPS.map((group) => {
            const rows = commands.filter(
              (c) => c.meta.group === group.id && c.available,
            );
            if (rows.length === 0) return null;
            return (
              <section key={group.id} className="shortcuts-group">
                <h3 className="shortcuts-group-label">{group.label}</h3>
                <ul className="shortcuts-rows">
                  {rows.map((cmd) => {
                    const Icon = cmd.icon;
                    return (
                      <li key={cmd.meta.id} className="shortcuts-row">
                        <span className="shortcuts-row-icon">
                          <Icon size={15} aria-hidden />
                        </span>
                        <span className="shortcuts-row-label">{cmd.meta.label}</span>
                        <span className="shortcuts-row-keys">
                          <KbdList bindings={cmd.bindings} platform={platform} />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>

        <div className="shortcuts-foot">
          <Link href="/account#keyboard" className="shortcuts-customize" onClick={onClose}>
            <Settings size={14} aria-hidden />
            <span>Customize shortcuts in settings</span>
          </Link>
        </div>
      </div>
    </dialog>
  );
}
