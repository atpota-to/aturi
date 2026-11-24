'use client';

import { useId } from 'react';
import { DialogField } from './SpaceDialog';
import {
  formatAllowList,
  isValidManagingApp,
  parseAllowList,
  type AppAccessDraft,
  type PolicyDraft,
} from '@/utils/atproto/simpleSpaceConfig';

/**
 * The two rules every simplespace has, as a pair of pickers. Shared by the
 * create form and the manage form so a space cannot be describable one way when
 * it is made and another way afterwards.
 *
 * Both unions are open, so a rule this build doesn't recognise gets an option
 * of its own rather than being folded into the nearest familiar one. It is
 * selectable — that is how someone leaves it — but choosing anything else is a
 * replacement, not an edit, and the note under the picker says so. See
 * `simpleSpaceConfig.ts` for why the alternative is worse than an ugly dropdown.
 */
export default function SpaceConfigFields({
  policy,
  onPolicyChange,
  appAccess,
  onAppAccessChange,
  disabled,
}: {
  policy: PolicyDraft;
  onPolicyChange: (next: PolicyDraft) => void;
  appAccess: AppAccessDraft;
  onAppAccessChange: (next: AppAccessDraft) => void;
  disabled?: boolean;
}) {
  const policyId = useId();
  const policyHintId = useId();
  const managingAppId = useId();
  const managingAppHintId = useId();
  const appAccessId = useId();
  const appAccessHintId = useId();
  const allowedId = useId();
  const allowedHintId = useId();

  const managingAppInvalid =
    policy.kind === 'managingApp' &&
    policy.managingApp.trim().length > 0 &&
    !isValidManagingApp(policy.managingApp);

  return (
    <>
      <DialogField
        label="User access"
        htmlFor={policyId}
        hintId={policyHintId}
        hint={POLICY_HINTS[policy.kind]}
      >
        <select
          id={policyId}
          className="explore-input"
          aria-describedby={policyHintId}
          disabled={disabled}
          value={policy.kind}
          onChange={(e) => {
            const kind = e.target.value as PolicyDraft['kind'];
            if (kind === 'managingApp') {
              onPolicyChange({
                kind: 'managingApp',
                managingApp: policy.kind === 'managingApp' ? policy.managingApp : '',
              });
            } else if (kind === 'public' || kind === 'memberList') {
              onPolicyChange({ kind });
            }
          }}
        >
          <option value="memberList">Member list</option>
          <option value="public">Anyone</option>
          <option value="managingApp">An application decides</option>
          {policy.kind === 'unknown' && (
            <option value="unknown">
              {policy.type ? `Unrecognised (${policy.type})` : 'Unrecognised'}
            </option>
          )}
        </select>
      </DialogField>

      {policy.kind === 'managingApp' && (
        <DialogField
          label="Managing application"
          htmlFor={managingAppId}
          hintId={managingAppHintId}
          hint={
            managingAppInvalid
              ? 'Not a DID. Use a DID, optionally with a service fragment: did:web:example.com#forum.'
              : 'A DID, optionally with a service fragment: did:web:example.com#forum.'
          }
        >
          <input
            id={managingAppId}
            className="explore-input fx-sp-mono"
            aria-describedby={managingAppHintId}
            aria-invalid={managingAppInvalid || undefined}
            disabled={disabled}
            placeholder="did:web:example.com#forum"
            value={policy.managingApp}
            onChange={(e) => onPolicyChange({ kind: 'managingApp', managingApp: e.target.value })}
          />
        </DialogField>
      )}

      <DialogField
        label="Application access"
        htmlFor={appAccessId}
        hintId={appAccessHintId}
        hint={APP_ACCESS_HINTS[appAccess.kind]}
      >
        <select
          id={appAccessId}
          className="explore-input"
          aria-describedby={appAccessHintId}
          disabled={disabled}
          value={appAccess.kind}
          onChange={(e) => {
            const kind = e.target.value as AppAccessDraft['kind'];
            if (kind === 'allowList') {
              onAppAccessChange({
                kind: 'allowList',
                allowed: appAccess.kind === 'allowList' ? appAccess.allowed : [],
              });
            } else if (kind === 'open') {
              onAppAccessChange({ kind: 'open' });
            }
          }}
        >
          <option value="open">Open</option>
          <option value="allowList">Allow list</option>
          {appAccess.kind === 'unknown' && (
            <option value="unknown">
              {appAccess.type ? `Unrecognised (${appAccess.type})` : 'Unrecognised'}
            </option>
          )}
        </select>
      </DialogField>

      {appAccess.kind === 'allowList' && (
        <DialogField
          label="Allowed client IDs"
          htmlFor={allowedId}
          hintId={allowedHintId}
          hint="One OAuth client ID per line. aturi.to can never be attested, so an allow list stops this explorer reading the space. You can still administer it here."
        >
          <textarea
            id={allowedId}
            className="explore-input explore-textarea"
            aria-describedby={allowedHintId}
            disabled={disabled}
            rows={3}
            placeholder="https://example.com/client-metadata.json"
            value={formatAllowList(appAccess.allowed)}
            onChange={(e) =>
              onAppAccessChange({ kind: 'allowList', allowed: parseAllowList(e.target.value) })
            }
          />
        </DialogField>
      )}

      {(policy.kind === 'unknown' || appAccess.kind === 'unknown') && (
        <p className="fx-sp-dialog-note fx-sp-dialog-warn">
          This space has a rule this build doesn’t recognise. It stays as is
          unless you change it, and changing it replaces the whole rule.
        </p>
      )}
    </>
  );
}

const POLICY_HINTS: Record<PolicyDraft['kind'], string> = {
  memberList: 'Only members you add can access the Space.',
  public: 'Anyone who knows the address can access the Space.',
  managingApp: 'Your server asks the application named below about each user.',
  unknown: 'Whatever rule this is, this build makes no assumption about what it allows.',
};

const APP_ACCESS_HINTS: Record<AppAccessDraft['kind'], string> = {
  open: 'Any application an authorized user signs into may access the Space.',
  allowList: 'Only the applications listed below may access the Space.',
  unknown: 'Whatever rule this is, this build makes no assumption about what it allows.',
};
