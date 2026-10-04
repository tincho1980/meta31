import { fieldErrors, type Property, type PropertyCreate, propertyCreate, propertyUpdate } from '@meta31/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { Field } from '../components/Field';
import { columnLabel, enumLabel, errorMessage, t, tableLabel } from '../glossary';

const COUNTRIES = ['AR', 'UY'] as const;
const CURRENCIES = ['ARS', 'USD', 'UYU'] as const;
const KEY = ['properties'];

type FormState = { name: string; country: string; currency: string };

export function Properties() {
  const list = useQuery({ queryKey: KEY, queryFn: () => api<Property[]>('GET', '/api/properties') });

  return (
    <section className="page">
      <h1>{tableLabel('property', true)}</h1>
      <CreateProperty />
      {list.isPending && <p className="muted">{t('loading')}</p>}
      {list.isError && <p className="warning">{errorMessage(list.error)}</p>}
      {list.data &&
        (list.data.length === 0 ? (
          <p className="muted">{t('empty_list')}</p>
        ) : (
          <ul className="rows">
            {list.data.map((p) => (
              <PropertyRow key={p.id} property={p} />
            ))}
          </ul>
        ))}
    </section>
  );
}

/** Name, country and currency: the same fields to create and to edit. */
function PropertyFields({ form, setForm, errors }: { form: FormState; setForm: (f: FormState) => void; errors: Record<string, string> }) {
  return (
    <>
      <Field label={columnLabel('property', 'name')} error={errors.name}>
        {(p) => <input {...p} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
      </Field>
      <Field label={columnLabel('property', 'country')} error={errors.country}>
        {(p) => (
          <select {...p} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {enumLabel('country', c)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={columnLabel('property', 'currency')} error={errors.currency}>
        {(p) => (
          <select {...p} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {enumLabel('currency', c)}
              </option>
            ))}
          </select>
        )}
      </Field>
    </>
  );
}

function CreateProperty() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>({ name: '', country: 'AR', currency: 'ARS' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: (input: PropertyCreate) => api<Property>('POST', '/api/properties', input),
    onSuccess: () => {
      setForm((f) => ({ ...f, name: '' }));
      return queryClient.invalidateQueries({ queryKey: KEY });
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.reset(); // a new attempt clears the previous server error
    const parsed = propertyCreate.safeParse(form);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    create.mutate(parsed.data);
  };

  return (
    <form className="card form-inline" onSubmit={submit} noValidate>
      <PropertyFields form={form} setForm={setForm} errors={errors} />
      <button type="submit" className="primary" disabled={create.isPending}>
        {create.isPending ? t('saving') : t('add')}
      </button>
      {create.isError && <p className="warning form-error">{errorMessage(create.error)}</p>}
    </form>
  );
}

function PropertyRow({ property }: { property: Property }) {
  const queryClient = useQueryClient();
  const initial = { name: property.name, country: property.country, currency: property.currency };
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const update = useMutation({
    mutationFn: (input: Partial<FormState> & { active?: boolean }) =>
      api<Property>('PATCH', `/api/properties/${property.id}`, input),
    onSuccess: () => {
      setEditing(false);
      return queryClient.invalidateQueries({ queryKey: KEY });
    },
  });

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    update.reset(); // a new attempt clears the previous server error
    const parsed = propertyUpdate.safeParse(form);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    update.mutate(parsed.data);
  };

  if (editing) {
    return (
      <li className="row">
        <form className="form-inline grow" onSubmit={save} noValidate>
          <PropertyFields form={form} setForm={setForm} errors={errors} />
          <button type="submit" className="primary" disabled={update.isPending}>
            {t('save')}
          </button>
          <button type="button" className="secondary" onClick={() => { setEditing(false); setForm(initial); }}>
            {t('cancel')}
          </button>
          {update.isError && <p className="warning form-error">{errorMessage(update.error)}</p>}
        </form>
      </li>
    );
  }

  return (
    <li className={`row${property.active ? '' : ' inactive'}`}>
      <span className="grow">
        {property.name}
        <span className="note">
          {enumLabel('country', property.country)} · {property.currency}
        </span>
        {!property.active && <span className="note">{t('inactive')}</span>}
      </span>
      <span className="actions">
        <button type="button" className="link" onClick={() => setEditing(true)}>
          {t('edit')}
        </button>
        <button type="button" className="link" disabled={update.isPending} onClick={() => update.mutate({ active: !property.active })}>
          {property.active ? t('deactivate') : t('activate')}
        </button>
      </span>
      {update.isError && <p className="warning form-error">{errorMessage(update.error)}</p>}
    </li>
  );
}
