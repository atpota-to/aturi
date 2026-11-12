'use client';

import { useId, useState } from 'react';
import { Plus } from 'lucide-react';
import { Segmented } from '@/components/explore/lexicons/primitives';
import { isParamName, type XrpcParamSpec, type XrpcParamValues } from '@/lib/tools/xrpc';

/**
 * The parameter form of the XRPC console: one field per parameter, shaped by
 * what the lexicon says the parameter is.
 *
 * Values are held as lists of strings whatever the type (XrpcParamValues),
 * because that is what a query string carries; the field's job is only to
 * make the right thing easy to type. Nothing is refused here. A value the
 * lexicon would reject is sent as typed and the host's own error is shown,
 * which is more use to someone debugging a client than a form that will not
 * submit.
 */

type BooleanChoice = 'unset' | 'true' | 'false';

const BOOLEAN_OPTIONS: { value: BooleanChoice; label: string }[] = [
  { value: 'unset', label: 'Not set' },
  { value: 'true', label: 'True' },
  { value: 'false', label: 'False' },
];

/** What a parameter is, in a few words: `string, at-identifier`, `integer, 1 to 100`. */
function typeLine(spec: XrpcParamSpec, lexiconKnown: boolean): string {
  if (spec.extra) return lexiconKnown ? 'not in the lexicon' : '';
  const parts: string[] = [];
  if (spec.kind === 'array') parts.push(`list of ${spec.itemKind === 'unknown' || !spec.itemKind ? 'values' : spec.itemKind}`);
  else if (spec.kind !== 'unknown') parts.push(spec.kind);
  if (spec.format) parts.push(spec.format);
  if (spec.minimum !== undefined && spec.maximum !== undefined) parts.push(`${spec.minimum} to ${spec.maximum}`);
  else if (spec.minimum !== undefined) parts.push(`at least ${spec.minimum}`);
  else if (spec.maximum !== undefined) parts.push(`at most ${spec.maximum}`);
  if (spec.kind === 'array' && spec.maxLength !== undefined) parts.push(`up to ${spec.maxLength}`);
  return parts.join(', ');
}

function ParamField({
  spec,
  values,
  onChange,
  lexiconKnown,
}: {
  spec: XrpcParamSpec;
  values: string[];
  onChange: (values: string[]) => void;
  lexiconKnown: boolean;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const single = values[0] ?? '';
  const hint = typeLine(spec, lexiconKnown);
  const placeholder = spec.defaultValue !== undefined ? `Default: ${spec.defaultValue}` : '';
  const describedBy = spec.description ? noteId : undefined;

  let control;
  if (spec.kind === 'boolean') {
    const choice: BooleanChoice = single === 'true' ? 'true' : single === 'false' ? 'false' : 'unset';
    control = (
      <Segmented
        ariaLabel={spec.name}
        options={BOOLEAN_OPTIONS}
        value={choice}
        onChange={(next) => onChange(next === 'unset' ? [] : [next])}
      />
    );
  } else if (spec.kind === 'array') {
    control = (
      <textarea
        id={id}
        className="fn-tool-textarea fn-tool-xrpc-list"
        rows={3}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        placeholder="One value per line"
        aria-describedby={describedBy}
        value={values.join('\n')}
        onChange={(event) => onChange(event.target.value.split('\n'))}
      />
    );
  } else if (spec.enumValues) {
    control = (
      <span className="fx-field fn-tool-xrpc-field">
        <select
          id={id}
          aria-describedby={describedBy}
          value={single}
          onChange={(event) => onChange(event.target.value ? [event.target.value] : [])}
        >
          <option value="">{spec.defaultValue !== undefined ? `Default (${spec.defaultValue})` : 'Not set'}</option>
          {spec.enumValues.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </span>
    );
  } else {
    control = (
      <span className="fx-field fn-tool-xrpc-field">
        <input
          id={id}
          type="text"
          inputMode={spec.kind === 'integer' ? 'numeric' : undefined}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={placeholder}
          aria-describedby={describedBy}
          aria-required={spec.required || undefined}
          value={single}
          onChange={(event) => onChange(event.target.value ? [event.target.value] : [])}
        />
      </span>
    );
  }

  return (
    <div className="fn-tool-xrpc-param">
      <div className="fn-tool-xrpc-param-head">
        {/* A segmented control labels itself; everything else is a field this names. */}
        {spec.kind === 'boolean' ? (
          <span className="fn-tool-xrpc-param-name">{spec.name}</span>
        ) : (
          <label htmlFor={id} className="fn-tool-xrpc-param-name">
            {spec.name}
          </label>
        )}
        {spec.required && (
          <span className="fn-tool-pill" data-tone="outline">
            Required
          </span>
        )}
        {hint && <span className="fn-tool-xrpc-param-type">{hint}</span>}
      </div>
      {control}
      {spec.description && (
        <p id={noteId} className="fn-tool-note">
          {spec.description}
        </p>
      )}
      {spec.knownValues && spec.kind !== 'array' && (
        <div className="fn-tool-xrpc-known">
          {spec.knownValues.map((value) => (
            <button
              key={value}
              type="button"
              className="fn-chip"
              aria-pressed={single === value}
              onClick={() => onChange(single === value ? [] : [value])}
            >
              {value}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A name to add as a parameter, for a method whose lexicon could not be
 * found: with no list of parameters to draw, this is the only way to send
 * one.
 */
function AddParam({ taken, onAdd }: { taken: string[]; onAdd: (name: string) => void }) {
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const usable = isParamName(trimmed) && !taken.includes(trimmed);

  function add() {
    if (!usable) return;
    onAdd(trimmed);
    setName('');
  }

  return (
    <div className="fn-tool-xrpc-add">
      <span className="fx-field fn-tool-xrpc-field">
        <input
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Name of a parameter to add"
          placeholder="Parameter name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            // Enter here adds the field; it must not send the request.
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
      </span>
      <button type="button" className="fx-btn fx-btn-sm" disabled={!usable} onClick={add}>
        <Plus size={13} aria-hidden /> Add
      </button>
    </div>
  );
}

export default function XrpcConsoleParams({
  specs,
  values,
  onChange,
  lexiconKnown,
}: {
  /** The fields to draw: the method's parameters, then any extras (withExtraParams). */
  specs: XrpcParamSpec[];
  values: XrpcParamValues;
  onChange: (name: string, values: string[]) => void;
  /** The lexicon was found. Without it, parameters can be added by name. */
  lexiconKnown: boolean;
}) {
  return (
    <div className="fn-tool-xrpc-params">
      {specs.length === 0 && lexiconKnown && <p className="fn-tool-note">This method takes no parameters.</p>}
      {specs.map((spec) => (
        <ParamField
          key={spec.name}
          spec={spec}
          values={values[spec.name] ?? []}
          onChange={(next) => onChange(spec.name, next)}
          lexiconKnown={lexiconKnown}
        />
      ))}
      {!lexiconKnown && (
        <AddParam taken={specs.map((spec) => spec.name)} onAdd={(name) => onChange(name, [''])} />
      )}
    </div>
  );
}
