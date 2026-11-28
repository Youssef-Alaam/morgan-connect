import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listPeople,
  listPresets,
  profilesOf,
  type Person,
  type PresetRow,
  type Profiles as Shown,
} from '../api.ts';
import { previewProfile, saveProfile, type Choice, type Preview } from '../profiles-api.ts';

/** One choice waiting to be saved, with what it would loosen. */
export interface Pending {
  choice: Choice;
  target: string;
  preview: Preview;
}

/** Who is in the workspace and what each preset allows. */
function useDirectory() {
  const [people, setPeople] = useState<Person[]>();
  const [presets, setPresets] = useState<PresetRow[]>([]);
  const [who, setWho] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    void listPeople().then((answer) => {
      if (answer.ok) {
        setPeople(answer.data.people);
        setWho(answer.data.people[0]?.id);
      } else setError(answer.error);
    });
    void listPresets().then((answer) => {
      if (answer.ok) setPresets(answer.data.presets);
      else setError(answer.error);
    });
  }, []);
  return { people, presets, who, setWho, error };
}

/** A choice awaiting its save: previewed first, saved once, and the page reloaded after. */
function useChange(reload: (id: string) => void, fail: (error: string | undefined) => void) {
  const [pending, setPending] = useState<Pending>();
  const [saving, setSaving] = useState(false);
  const pick = (choice: Choice, target: string) => {
    fail(undefined);
    void previewProfile(choice).then((answer) => {
      if (answer.ok) setPending({ choice, target, preview: answer.data });
      else fail(answer.error);
    });
  };
  const save = () => {
    if (pending === undefined || saving) return; // one save at a time
    setSaving(true);
    void saveProfile(pending.choice).then((answer) => {
      setSaving(false);
      setPending(undefined);
      if (answer.ok) reload(pending.choice.userId);
      else fail(answer.error);
    });
  };
  const cancel = () => {
    setPending(undefined);
  };
  return { pending, saving, pick, save, cancel };
}

/** What the access page shows and does: the people, the presets, one person's profiles, and a choice awaiting its save. */
export function useProfiles() {
  const { people, presets, who, setWho, error: loadError } = useDirectory();
  const [shown, setShown] = useState<Shown>();
  const [error, setError] = useState<string>();
  const latest = useRef<string | undefined>(undefined);
  const load = useCallback((id: string) => {
    latest.current = id;
    void profilesOf(id).then((answer) => {
      if (latest.current !== id) return; // another person was picked meanwhile
      if (answer.ok) setShown(answer.data);
      else setError(answer.error);
    });
  }, []);
  useEffect(() => {
    if (who !== undefined) load(who);
  }, [who, load]);
  const change = useChange(load, setError);
  const choosePerson = (id: string) => {
    change.cancel();
    setShown(undefined);
    setWho(id);
  };
  return { people, presets, who, shown, error: error ?? loadError, choosePerson, ...change };
}
