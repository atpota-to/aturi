'use client';

import { useEffect, useState } from 'react';
import { getPlcDocument, type PlcDocument } from '@/utils/atproto/plc';
import type { IdentityBundle } from '@/utils/atproto/identity';

export default function IdentityTab({ identity }: { identity: IdentityBundle }) {
  const { did } = identity;
  const isPlc = did.startsWith('did:plc:');
  const [doc, setDoc] = useState<PlcDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPlc) return undefined;
    let cancelled = false;
    setDoc(null);
    setError(null);
    getPlcDocument(did)
      .then((d) => {
        if (!cancelled) setDoc(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [did, isPlc]);

  if (!isPlc) {
    return (
      <p className="explore-placeholder">
        <code>{did}</code> isn&rsquo;t a <code>did:plc:</code>. PLC directory data isn&rsquo;t
        available for this method.
      </p>
    );
  }
  if (error) return <p className="explore-error">{error}</p>;
  if (!doc) return <p className="explore-placeholder">Loading identity…</p>;

  const akas = doc.alsoKnownAs || [];
  const services = doc.service || [];
  const verifications = doc.verificationMethod || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <Section title="Also known as">
        <ul className="explore-identity-list">
          {akas.length === 0 && <li className="explore-muted">—</li>}
          {akas.map((a) => (
            <li key={a}>
              <code>{a}</code>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Services">
        <ul className="explore-identity-list">
          {services.length === 0 && <li className="explore-muted">—</li>}
          {services.map((s) => (
            <li key={s.id || s.type} className="explore-identity-card">
              <div>
                <code style={{ color: 'var(--text-primary)' }}>{s.id}</code>
              </div>
              <div className="explore-id-row">
                <span className="explore-small-caps">type</span>
                <code>{s.type}</code>
              </div>
              <div className="explore-id-row">
                <span className="explore-small-caps">endpoint</span>
                <code>{s.serviceEndpoint}</code>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Verification methods">
        <ul className="explore-identity-list">
          {verifications.length === 0 && <li className="explore-muted">—</li>}
          {verifications.map((v) => (
            <li key={v.id || v.publicKeyMultibase} className="explore-identity-card">
              <div>
                <code style={{ color: 'var(--text-primary)' }}>{v.id}</code>
              </div>
              <div className="explore-id-row">
                <span className="explore-small-caps">type</span>
                <code>{v.type}</code>
              </div>
              {v.publicKeyMultibase && (
                <div className="explore-id-row">
                  <span className="explore-small-caps">key</span>
                  <code style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>
                    {v.publicKeyMultibase}
                  </code>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <details className="explore-raw-details">
        <summary>Raw DID document</summary>
        <pre className="explore-json">{JSON.stringify(doc, null, 2)}</pre>
      </details>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="explore-small-caps" style={{ marginBottom: '0.5rem' }}>
        {title}
      </h3>
      {children}
    </section>
  );
}
