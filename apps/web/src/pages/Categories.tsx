import { type Category, type CategoryCreate, categoryCreate, categoryUpdate, fieldErrors } from '@meta31/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { Field } from '../components/Field';
import { columnLabel, enumLabel, errorMessage, t, tableLabel } from '../glossary';

const KINDS = ['income', 'expense'] as const;
const KEY = ['categories'];

export function Categories() {
  const list = useQuery({ queryKey: KEY, queryFn: () => api<Category[]>('GET', '/api/categories') });

  return (
    <section className="page">
      <h1>{tableLabel('category', true)}</h1>
      <CreateCategory />
      {list.isPending && <p className="muted">{t('loading')}</p>}
      {list.isError && <p className="warning">{errorMessage(list.error)}</p>}
      {list.data &&
        KINDS.map((kind) => {
          const items = list.data.filter((c) => c.kind === kind);
          return (
            <div key={kind} className="group">
              <h2>{enumLabel('category_kind', kind)}</h2>
              {items.length === 0 ? (
                <p className="muted">{t('empty_list')}</p>
              ) : (
                <ul className="rows">
                  {items.map((c) => (
                    <CategoryRow key={c.id} category={c} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
    </section>
  );
}

function CreateCategory() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<{ name: string; kind: string }>({ name: '', kind: 'expense' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: (input: CategoryCreate) => api<Category>('POST', '/api/categories', input),
    onSuccess: () => {
      setForm((f) => ({ ...f, name: '' }));
      return queryClient.invalidateQueries({ queryKey: KEY });
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.reset(); // a new attempt clears the previous server error
    const parsed = categoryCreate.safeParse(form);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    create.mutate(parsed.data);
  };

  return (
    <form className="card form-inline" onSubmit={submit} noValidate>
      <Field label={columnLabel('category', 'name')} error={errors.name}>
        {(p) => <input {...p} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
      </Field>
      <Field label={columnLabel('category', 'kind')} error={errors.kind}>
        {(p) => (
          <select {...p} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {enumLabel('category_kind', k)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <button type="submit" className="primary" disabled={create.isPending}>
        {create.isPending ? t('saving') : t('add')}
      </button>
      {create.isError && <p className="warning form-error">{errorMessage(create.error)}</p>}
    </form>
  );
}

function CategoryRow({ category }: { category: Category }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [error, setError] = useState<string | undefined>();
  const update = useMutation({
    mutationFn: (input: { name?: string; active?: boolean }) =>
      api<Category>('PATCH', `/api/categories/${category.id}`, input),
    onSuccess: () => {
      setEditing(false);
      return queryClient.invalidateQueries({ queryKey: KEY });
    },
  });

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    update.reset(); // a new attempt clears the previous server error
    const parsed = categoryUpdate.safeParse({ name });
    if (!parsed.success) return setError(fieldErrors(parsed.error).name);
    setError(undefined);
    update.mutate(parsed.data);
  };

  if (editing) {
    return (
      <li className="row">
        <form className="form-inline grow" onSubmit={save} noValidate>
          <Field label={columnLabel('category', 'name')} error={error}>
            {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}
          </Field>
          <button type="submit" className="primary" disabled={update.isPending}>
            {t('save')}
          </button>
          <button type="button" className="secondary" onClick={() => { setEditing(false); setName(category.name); }}>
            {t('cancel')}
          </button>
          {update.isError && <p className="warning form-error">{errorMessage(update.error)}</p>}
        </form>
      </li>
    );
  }

  return (
    <li className={`row${category.active ? '' : ' inactive'}`}>
      <span className="grow">
        {category.name}
        {!category.active && <span className="badge">{t('inactive')}</span>}
        {category.system && (
          <span className="badge" title={t('system_category_help')}>
            {t('system')}
          </span>
        )}
      </span>
      {!category.system && (
        <span className="actions">
          <button type="button" className="link" onClick={() => setEditing(true)}>
            {t('edit')}
          </button>
          <button type="button" className="link" disabled={update.isPending} onClick={() => update.mutate({ active: !category.active })}>
            {category.active ? t('deactivate') : t('activate')}
          </button>
        </span>
      )}
      {update.isError && <p className="warning form-error">{errorMessage(update.error)}</p>}
    </li>
  );
}
