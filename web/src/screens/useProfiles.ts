import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listPeople,
  listPresets,
  profilesOf,
  type Person,
  type PresetRow,
  type Profiles as Shown,
} from '../api.ts';

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

/** What the access page shows: the people, the presets, and the profiles of the chosen person. */
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
  const choosePerson = (id: string) => {
    setShown(undefined);
    setWho(id);
  };
  return { people, presets, who, shown, error: error ?? loadError, choosePerson };
}
