import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { createInvite, listInvites, revokeInvite, type PendingInvite } from '../api.ts';
import { Button } from '../components/Button.tsx';
import { Table } from '../components/Table.tsx';
import { TextInput } from '../components/TextInput.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { Copyable } from './Copyable.tsx';
import { ErrorBanner, typed } from './ErrorBanner.tsx';
import { limitOf } from './limit.ts';

const K = 'users.invites';
const DEFAULT_HOURS = '72';
const MAX_HOURS = 720;

/** A moment as `year-month-day hour:minute`, UTC, the same wherever the admin is. */
const when = (iso: string): string => iso.slice(0, 16).replace('T', ' ');

interface ListProps {
  invites: PendingInvite[];
  onRevoke: (invite: PendingInvite) => void;
}

function InviteList({ invites, onRevoke }: ListProps) {
  const { t } = useTranslation();
  if (invites.length === 0) return <p>{t(`${K}.none`)}</p>;
  return (
    <Table
      caption={t(`${K}.caption`)}
      columns={[t(`${K}.limit`), t(`${K}.expires`), t(`${K}.actions`)]}
      rows={invites.map((invite) => ({
        key: invite.id,
        cells: [
          invite.monthlyLimitUsd === undefined ? t(`${K}.noLimit`) : String(invite.monthlyLimitUsd),
          when(invite.expiresAt),
          <Button
            key="revoke"
            variant="secondary"
            aria-label={t(`${K}.revokeNamed`, { when: when(invite.expiresAt) })}
            onClick={() => {
              onRevoke(invite);
            }}
          >
            {t(`${K}.revoke`)}
          </Button>,
        ],
      }))}
    />
  );
}

interface AskProps {
  asking: PendingInvite | undefined;
  onConfirm: (id: string) => void;
  onCancel: () => void;
}

/** The question before an invite is revoked: it names when the link expires. */
function AskRevoke({ asking, onConfirm, onCancel }: AskProps) {
  const { t } = useTranslation();
  if (asking === undefined) return null;
  return (
    <ConfirmDialog
      title={t(`${K}.confirmRevoke`)}
      message={t(`${K}.confirmRevokeText`, { when: when(asking.expiresAt) })}
      confirmLabel={t(`${K}.revoke`)}
      onConfirm={() => {
        onConfirm(asking.id);
      }}
      onCancel={onCancel}
    />
  );
}

interface FormProps {
  onMade: (link: string) => void;
  onError: (error: string | undefined) => void;
}

/** The limit and how long the link lasts; the link it makes is handed up, never kept here. */
function InviteForm({ onMade, onError }: FormProps) {
  const { t } = useTranslation();
  const [limit, setLimit] = useState('');
  const [hours, setHours] = useState(DEFAULT_HOURS);
  const [hoursError, setHoursError] = useState(false);
  const create = (event: SyntheticEvent) => {
    event.preventDefault();
    onError(undefined);
    const lasts = Number(hours);
    const valid = /^\d+$/.test(hours.trim()) && lasts >= 1 && lasts <= MAX_HOURS;
    setHoursError(!valid);
    if (!valid) return;
    void createInvite(limitOf(limit), lasts).then((answer) => {
      if (answer.ok) onMade(`${window.location.origin}/join#token=${answer.data.token}`);
      else onError(answer.error);
    });
  };
  return (
    <form className="screen-form" onSubmit={create}>
      <TextInput
        label={t(`${K}.limit`)}
        hint={t(`${K}.limitHint`)}
        inputMode="decimal"
        value={limit}
        onChange={typed(setLimit)}
      />
      <TextInput
        label={t(`${K}.hours`)}
        inputMode="numeric"
        {...(hoursError ? { error: t(`${K}.hoursInvalid`) } : {})}
        value={hours}
        onChange={typed(setHours)}
      />
      <Button type="submit">{t(`${K}.create`)}</Button>
    </form>
  );
}

/** The open invites, and revoking one; `setError` is the page's, so a failed call shows in its banner. */
function useInvites(setError: (error: string | undefined) => void) {
  const [invites, setInvites] = useState<PendingInvite[]>();
  const load = useCallback(() => {
    void listInvites().then((answer) => {
      if (answer.ok) setInvites(answer.data.invites);
      else setError(answer.error);
    });
  }, [setError]);
  useEffect(load, [load]);
  const revoke = (id: string) => {
    setError(undefined);
    void revokeInvite(id).then((answer) => {
      if (!answer.ok) setError(answer.error);
      load();
    });
  };
  return { invites, load, revoke };
}

// Invite links: make one (its link shows once, with a copy button), see the open ones, revoke one.
export function Invites() {
  const { t } = useTranslation();
  const [link, setLink] = useState<string>();
  const [error, setError] = useState<string>();
  const [asking, setAsking] = useState<PendingInvite>();
  const { invites, load, revoke } = useInvites(setError);
  return (
    <section aria-labelledby="invites-title" className="screen-form">
      <h3 id="invites-title">{t(`${K}.title`)}</h3>
      <ErrorBanner error={error} />
      {invites === undefined ? null : <InviteList invites={invites} onRevoke={setAsking} />}
      <AskRevoke
        asking={asking}
        onConfirm={(id) => {
          setAsking(undefined);
          revoke(id);
        }}
        onCancel={() => {
          setAsking(undefined);
        }}
      />
      <InviteForm
        onError={(next) => {
          setError(next);
          setLink(undefined);
        }}
        onMade={(made) => {
          setLink(made);
          load();
        }}
      />
      {link === undefined ? null : (
        <Copyable
          label={t(`${K}.link`)}
          hint={t(`${K}.linkHint`)}
          value={link}
          copyLabel={t(`${K}.copy`)}
          copiedLabel={t(`${K}.copied`)}
        />
      )}
    </section>
  );
}
