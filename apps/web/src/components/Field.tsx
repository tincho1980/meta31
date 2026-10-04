import { useId } from 'react';
import { fieldMessage } from '../glossary';

type Props = {
  label: string;
  /** Field error code (contracts `FieldCode`), translated with the glossary. */
  error?: string | undefined;
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => React.ReactNode;
};

/** Label + control + error message, with the accessibility wiring between them. */
export function Field({ label, error, children }: Props) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-invalid': Boolean(error), ...(error ? { 'aria-describedby': errorId } : {}) })}
      {error && (
        <span id={errorId} className="field-error" role="alert">
          {fieldMessage(error)}
        </span>
      )}
    </div>
  );
}
