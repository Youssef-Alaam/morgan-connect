import { useCallback, useEffect, useRef, useState } from 'react';
import { listAudit, type AuditFilters, type AuditRow } from '../api.ts';

const NO_FILTERS: AuditFilters = {
  person: '',
  action: '',
  decision: '',
  outcome: '',
  from: '',
  to: '',
};

/** The audit rows for the chosen filters, newest first, with "older" paging. */
export function useAudit() {
  const [filters, setFilters] = useState(NO_FILTERS);
  const [rows, setRows] = useState<AuditRow[]>();
  const [more, setMore] = useState(false);
  const [actions, setActions] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const latest = useRef(0);
  const load = useCallback((now: AuditFilters, before?: string) => {
    latest.current += 1;
    const mine = latest.current;
    void listAudit(now, before).then((answer) => {
      // A slower answer to an earlier choice must not overwrite a newer one.
      if (mine !== latest.current) return;
      if (!answer.ok) {
        setError(answer.error);
        return;
      }
      setError(undefined);
      setRows((shown) =>
        before === undefined ? answer.data.rows : [...(shown ?? []), ...answer.data.rows],
      );
      setMore(answer.data.more);
      setActions(answer.data.actions);
    });
  }, []);
  useEffect(() => {
    load(filters);
  }, [filters, load]);
  const older = () => {
    const last = rows?.at(-1);
    if (last !== undefined) load(filters, last.id);
  };
  return {
    filters,
    setFilters,
    rows,
    more,
    actions,
    error,
    older,
    reload: () => {
      load(filters);
    },
  };
}
