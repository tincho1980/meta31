import { type QueryKey, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { errorMessage, t } from '../glossary';

type Props = { path: string; name: string; queryKey: QueryKey };

/**
 * Deletes a rule loaded by mistake, after confirming. The API refuses once something of it is
 * stored (`has_stored_commitments`): then the message says to cancel it from the month view.
 */
export function DeleteButton({ path, name, queryKey }: Props) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api<void>('DELETE', path),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
  const onClick = () => {
    remove.reset();
    if (window.confirm(t('confirm_delete', { name }))) remove.mutate();
  };
  return (
    <>
      <button type="button" className="link danger" disabled={remove.isPending} onClick={onClick}>
        {t('delete')}
      </button>
      {remove.isError && <span className="warning form-error">{errorMessage(remove.error)}</span>}
    </>
  );
}
