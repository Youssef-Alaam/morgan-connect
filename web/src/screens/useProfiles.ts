import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listPeople,
  listPresets,
  profilesOf,
  type Mode,
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

/** What is being edited per action type: the choice waiting to be saved, else the person. */
export interface Editing {
  choice: Choice;
  target: string;
  modes: Record<string, Mode>;
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
  // Only the newest preview may land: a slow reply to an older choice is dropped.
  const asked = useRef(0);
  const pick = (choice: Choice, target: string) => {
    fail(undefined);
    const mine = ++asked.current;
    void previewProfile(choice).then((answer) => {
      if (asked.current !== mine) return;
      if (answer.ok) setPending({ choice, target, preview: answer.data });
      else fail(answer.error);
    });
  };
  const save = () => {
    if (pending === undefined || saving) return; // one save at a time
    setSaving(true);
    asked.current += 1;
    void saveProfile(pending.choice).then((answer) => {
      setSaving(false);
      if (!answer.ok) {
        fail(answer.error); // the change stays, so the admin can try again
        return;
      }
      setPending(undefined);
      reload(pending.choice.userId);
    });
  };
  const cancel = () => {
    asked.current += 1;
    setPending(undefined);
  };
  return { pending, saving, pick, save, cancel };
}

/** One row of the page: the person (no device) or one of their chats, with its display name. */
export interface Focus {
  deviceId?: string;
  target: string;
}

/** The pending choice's modes: its own, else its preset's. */
function pendingEditing(pending: Pending, presets: PresetRow[]): Editing | undefined {
  const { choice, target } = pending;
  const modes = choice.modes ?? presets.find((row) => row.preset === choice.preset)?.modes;
  return modes === undefined ? undefined : { choice, target, modes };
}

/** What applies now to the focused row: the person, or one of their chats. */
function focusEditing(userId: string, shown: Shown, focus: Focus): Editing | undefined {
  const { deviceId, target } = focus;
  const row =
    deviceId === undefined ? shown.person : shown.devices.find((d) => d.deviceId === deviceId);
  if (row === undefined) return undefined;
  const device = deviceId === undefined ? {} : { deviceId };
  return { choice: { userId, preset: row.preset, ...device }, target, modes: row.modes };
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
  // Which row the per-action table edits; it stays there after a save.
  const [focus, setFocus] = useState<Focus>();
  const choosePerson = (id: string) => {
    change.cancel();
    setShown(undefined);
    setFocus(undefined);
    setWho(id);
  };
  const edit = (next: Focus) => {
    change.cancel();
    setFocus(next);
  };
  const pick = (choice: Choice, target: string) => {
    setFocus(choice.deviceId === undefined ? { target } : { deviceId: choice.deviceId, target });
    change.pick(choice, target);
  };
  const person = people?.find((one) => one.id === who);
  const name = person?.email ?? '';
  const editing =
    change.pending !== undefined
      ? pendingEditing(change.pending, presets)
      : person && shown && focusEditing(person.id, shown, focus ?? { target: name });
  const failed = error ?? loadError;
  return { people, who, shown, focus, editing, error: failed, choosePerson, edit, ...change, pick };
}
