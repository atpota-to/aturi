'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Command as CommandIcon, Keyboard, RotateCcw } from 'lucide-react';
import { useKeyboardShortcuts } from '@/components/KeyboardShortcutsProvider';
import Toggle from '../Toggle';
import Kbd, { KbdList } from '@/components/Kbd';
import {
  COMMAND_GROUPS,
  bindingConflicts,
  eventToStep,
  normalizeBinding,
  type CommandId,
  type Platform,
} from '@/lib/keybindings';

/** Auto-commit a recorded chord after this idle gap (ms). */
const RECORD_COMMIT_MS = 900;

/**
 * Keyboard settings — enable/disable shortcuts, toggle navigation chords, and
 * rebind every command. Bindings are browser-local (not synced to the PDS):
 * they're a per-device, per-layout choice, so they live in localStorage like
 * the theme / font-scale / accessibility toggles.
 */
export default function KeyboardTab() {
  const {
    state,
    platform,
    commands,
    setEnabled,
    setChords,
    resetAll,
    openPalette,
    openHelp,
  } = useKeyboardShortcuts();

  const conflicts = bindingConflicts(state);
  const anyCustomized = Object.keys(state.overrides).length > 0;

  return (
    <>
      <section className="settings-card">
        <div className="settings-card-head">
          <h2 className="settings-card-title">Keyboard shortcuts</h2>
          <p className="settings-card-sub">
            Fast keyboard access for desktop. Press{' '}
            <kbd className="kbd">?</kbd> anywhere for the cheat sheet, or open the
            command palette with <Kbd binding="mod+k" platform={platform} />.
            These bindings are saved in this browser, not synced to your PDS —
            keyboards and layouts differ per device.
          </p>
        </div>

        <div className="kb-launchers">
          <button type="button" className="kb-launch-button" onClick={openPalette}>
            <CommandIcon size={15} aria-hidden />
            <span>Open command palette</span>
          </button>
          <button type="button" className="kb-launch-button" onClick={openHelp}>
            <Keyboard size={15} aria-hidden />
            <span>Show all shortcuts</span>
          </button>
        </div>

        <Toggle
          id="keyboard-enabled"
          label="Enable keyboard shortcuts"
          description="Master switch. When off, no global shortcut fires (the settings below are kept for when you turn it back on)."
          checked={state.enabled}
          onChange={setEnabled}
        />
        <Toggle
          id="keyboard-chords"
          label="Navigation chords"
          description="Two-key sequences like “g then e” to jump around. Turn off if you'd rather only use single-key and modifier shortcuts."
          checked={state.chords}
          onChange={setChords}
          disabled={!state.enabled}
        />
      </section>

      <section
        className="settings-card"
        style={state.enabled ? undefined : { opacity: 0.55 }}
      >
        <div className="settings-card-head">
          <h2 className="settings-card-title">Bindings</h2>
          <p className="settings-card-sub">
            Click <em>Edit</em> and press the keys you want. Chords are supported
            — press one key, then another. <kbd className="kbd">Enter</kbd> saves,{' '}
            <kbd className="kbd">Esc</kbd> cancels, <kbd className="kbd">⌫</kbd>{' '}
            removes the last key.
          </p>
        </div>

        {COMMAND_GROUPS.map((group) => {
          const rows = commands.filter((c) => c.meta.group === group.id);
          if (rows.length === 0) return null;
          return (
            <div key={group.id} className="kb-group">
              <h3 className="kb-group-label">{group.label}</h3>
              <ul className="kb-rows">
                {rows.map((cmd) => (
                  <BindingRow
                    key={cmd.meta.id}
                    id={cmd.meta.id}
                    icon={cmd.icon}
                    label={cmd.meta.label}
                    description={cmd.meta.description}
                    bindings={cmd.bindings}
                    requiresAuth={Boolean(cmd.meta.requiresAuth)}
                    available={cmd.available}
                    platform={platform}
                    chords={state.chords}
                    customized={state.overrides[cmd.meta.id] !== undefined}
                    conflictLabels={conflictLabelsFor(cmd.meta.id, cmd.bindings, conflicts, commands)}
                    disabled={!state.enabled}
                  />
                ))}
              </ul>
            </div>
          );
        })}

        <div className="kb-reset-all">
          <button
            type="button"
            className="kb-text-button"
            onClick={resetAll}
            disabled={!anyCustomized}
          >
            <RotateCcw size={13} aria-hidden />
            <span>Reset all to defaults</span>
          </button>
        </div>
      </section>
    </>
  );
}

/** Labels of the *other* commands a binding collides with. */
function conflictLabelsFor(
  id: CommandId,
  bindings: string[],
  conflicts: Map<string, CommandId[]>,
  commands: { meta: { id: CommandId; label: string } }[],
): string[] {
  const labels = new Set<string>();
  for (const binding of bindings) {
    const ids = conflicts.get(binding);
    if (!ids) continue;
    for (const other of ids) {
      if (other === id) continue;
      const meta = commands.find((c) => c.meta.id === other)?.meta;
      if (meta) labels.add(meta.label);
    }
  }
  return [...labels];
}

function BindingRow({
  id,
  icon: Icon,
  label,
  description,
  bindings,
  requiresAuth,
  available,
  platform,
  chords,
  customized,
  conflictLabels,
  disabled,
}: {
  id: CommandId;
  icon: React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
  label: string;
  description: string;
  bindings: string[];
  requiresAuth: boolean;
  available: boolean;
  platform: Platform;
  chords: boolean;
  customized: boolean;
  conflictLabels: string[];
  disabled: boolean;
}) {
  const { setBinding, resetBinding, unbind, setCaptureActive } = useKeyboardShortcuts();
  const [editing, setEditing] = useState(false);

  function startEditing() {
    if (disabled) return;
    setEditing(true);
  }
  function stopEditing() {
    setEditing(false);
  }

  return (
    <li className="kb-row">
      <span className="kb-row-icon" aria-hidden>
        <Icon size={15} aria-hidden />
      </span>
      <span className="kb-row-main">
        <span className="kb-row-label">
          {label}
          {requiresAuth && !available && (
            <span className="kb-row-note"> · requires sign-in</span>
          )}
        </span>
        <span className="kb-row-desc">{description}</span>
        {conflictLabels.length > 0 && (
          <span className="kb-row-conflict">
            Also bound to {conflictLabels.join(', ')}
          </span>
        )}
      </span>

      <span className="kb-row-keys">
        {editing ? (
          <BindingRecorder
            platform={platform}
            chords={chords}
            onStart={() => setCaptureActive(true)}
            onStop={() => setCaptureActive(false)}
            onCommit={(binding) => {
              setBinding(id, binding);
              stopEditing();
            }}
            onCancel={stopEditing}
          />
        ) : (
          <KbdList bindings={bindings} platform={platform} />
        )}
      </span>

      <span className="kb-row-actions">
        {editing ? (
          <button type="button" className="kb-text-button" onClick={stopEditing}>
            Cancel
          </button>
        ) : (
          <>
            <button
              type="button"
              className="kb-edit-button"
              onClick={startEditing}
              disabled={disabled}
            >
              Edit
            </button>
            {customized && (
              <button
                type="button"
                className="kb-text-button"
                onClick={() => resetBinding(id)}
                disabled={disabled}
                title="Reset to default"
              >
                Reset
              </button>
            )}
            {bindings.length > 0 && (
              <button
                type="button"
                className="kb-text-button"
                onClick={() => unbind(id)}
                disabled={disabled}
                title="Remove binding"
              >
                Clear
              </button>
            )}
          </>
        )}
      </span>
    </li>
  );
}

/**
 * Captures a new binding. While mounted it flips the global listener off (via
 * onStart/onStop) so recorded keys aren't also handled as live shortcuts. Each
 * accepted key pushes a chord step; a short idle gap (or Enter) commits, Esc
 * cancels, Backspace drops the last step.
 */
function BindingRecorder({
  platform,
  chords,
  onStart,
  onStop,
  onCommit,
  onCancel,
}: {
  platform: Platform;
  chords: boolean;
  onStart: () => void;
  onStop: () => void;
  onCommit: (binding: string) => void;
  onCancel: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the latest steps reachable from the timer without re-arming effects.
  const stepsRef = useRef<string[]>([]);
  stepsRef.current = steps;

  useEffect(() => {
    onStart();
    boxRef.current?.focus();
    return () => {
      onStop();
      if (commitTimer.current) clearTimeout(commitTimer.current);
    };
    // Run once for the lifetime of the recorder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function commit(list: string[]) {
    if (commitTimer.current) {
      clearTimeout(commitTimer.current);
      commitTimer.current = null;
    }
    const binding = normalizeBinding(list.join(' '));
    if (binding) onCommit(binding);
    else onCancel();
  }

  function armCommit() {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => commit(stepsRef.current), RECORD_COMMIT_MS);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      onCancel();
      return;
    }
    if (e.key === 'Enter') {
      if (stepsRef.current.length > 0) commit(stepsRef.current);
      else onCancel();
      return;
    }
    if (e.key === 'Backspace') {
      if (commitTimer.current) clearTimeout(commitTimer.current);
      setSteps((prev) => prev.slice(0, -1));
      return;
    }

    const step = eventToStep(e.nativeEvent, platform);
    if (!step) return; // bare modifier — wait for the real key

    if (!chords) {
      // Single-step mode: the first key is the whole binding.
      commit([step]);
      return;
    }
    setSteps((prev) => {
      const next = [...prev, step];
      return next;
    });
    armCommit();
  }

  return (
    <div className="kb-recorder">
      <div
        ref={boxRef}
        className="kb-recorder-box"
        role="textbox"
        aria-label="Press keys to set the shortcut"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onBlur={onCancel}
      >
        {steps.length === 0 ? (
          <span className="kb-recorder-hint">Press keys…</span>
        ) : (
          <Kbd binding={steps.join(' ')} platform={platform} />
        )}
      </div>
      <span className="kb-recorder-help">Enter saves · Esc cancels</span>
    </div>
  );
}
