import type { ChangeEvent, ReactNode } from 'react';
import { useEffect, useId, useState } from 'react';
import { ApiError } from '../lib/api';
import { money, paise, rupees } from '../lib/format';
import type { ErrorAction } from '../lib/types';

/* ---------- Layout ---------- */

export function Screen({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  return <div className={narrow ? 'screen screen-narrow' : 'screen'}>{children}</div>;
}

export function Card({
  children,
  title,
  action,
  flush,
}: {
  children: ReactNode;
  title?: string;
  action?: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className={flush ? 'card card-flush' : 'card'}>
      {title ? (
        <div className="card-title" style={flush ? { padding: '16px 16px 0' } : undefined}>
          <h3>{title}</h3>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export const SectionHeading = ({ children }: { children: ReactNode }) => (
  <div className="section-heading">{children}</div>
);

/* ---------- Feedback ---------- */

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading-block">
      <div className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function Empty({
  icon = '📭',
  title,
  hint,
  action,
}: {
  icon?: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {hint ? <p>{hint}</p> : null}
      {action}
    </div>
  );
}

export function Banner({
  tone = 'info',
  icon,
  children,
  actions,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  icon?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={`banner ${tone}`}>
      {icon ? <span aria-hidden>{icon}</span> : null}
      <div className="grow">
        {children}
        {actions ? <div className="banner-actions">{actions}</div> : null}
      </div>
    </div>
  );
}

/**
 * Shows a failure the way the shop owner should read it: one sentence, plus
 * the buttons the server suggested for getting out of it.
 */
export function ErrorNotice({
  error,
  onRetry,
  onAction,
}: {
  error: Error | ApiError | null;
  onRetry?: () => void;
  onAction?: (action: ErrorAction) => void;
}) {
  if (!error) return null;
  const actions = error instanceof ApiError ? error.actions : [];
  const tone = error instanceof ApiError && error.isOffline ? 'warning' : 'danger';
  return (
    <Banner
      tone={tone}
      icon={tone === 'warning' ? '📴' : '⚠️'}
      actions={
        <>
          {actions.map((action) =>
            onAction ? (
              <button key={action.action} type="button" className="btn btn-sm btn-outline" onClick={() => onAction(action)}>
                {action.label}
              </button>
            ) : null,
          )}
          {onRetry ? (
            <button type="button" className="btn btn-sm btn-secondary" onClick={onRetry}>
              Try Again
            </button>
          ) : null}
        </>
      }
    >
      {error.message}
    </Banner>
  );
}

/* ---------- Form fields ---------- */

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="field">
      {label ? <label>{label}</label> : null}
      {children}
      {hint && !error ? <span className="hint">{hint}</span> : null}
      {error ? <span className="error-text">{error}</span> : null}
    </div>
  );
}

interface TextFieldProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  type?: 'text' | 'tel' | 'email' | 'number' | 'date' | 'password';
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email';
  maxLength?: number;
  autoFocus?: boolean;
  disabled?: boolean;
}

export function TextField({ label, value, onChange, hint, error, ...rest }: TextFieldProps) {
  return (
    <Field label={label} hint={hint} error={error}>
      <input
        className="input"
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        {...rest}
      />
    </Field>
  );
}

/** Money is typed in rupees and kept in paise, so no float ever reaches the API. */
export function MoneyField({
  label,
  valuePaise,
  onChange,
  hint,
  error,
  placeholder = '0',
  autoFocus,
  disabled,
}: {
  label?: string;
  valuePaise: number;
  onChange: (paise: number) => void;
  hint?: string;
  error?: string | null;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const [text, setText] = useState(valuePaise ? String(rupees(valuePaise)) : '');

  useEffect(() => {
    const current = paise(text || 0);
    if (current !== valuePaise) setText(valuePaise ? String(rupees(valuePaise)) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuePaise]);

  return (
    <Field label={label} hint={hint} error={error}>
      <input
        className="input input-money"
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value.replace(/[^\d.]/g, '');
          setText(next);
          onChange(paise(next || 0));
        }}
      />
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  hint,
  error,
  allowDecimal = true,
  placeholder = '0',
  autoFocus,
}: {
  label?: string;
  value: number;
  onChange: (value: number) => void;
  hint?: string;
  error?: string | null;
  allowDecimal?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(value ? String(value) : '');

  useEffect(() => {
    if (Number(text || 0) !== value) setText(value ? String(value) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Field label={label} hint={hint} error={error}>
      <input
        className="input"
        inputMode={allowDecimal ? 'decimal' : 'numeric'}
        value={text}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(event) => {
          const cleaned = event.target.value.replace(allowDecimal ? /[^\d.]/g : /[^\d]/g, '');
          setText(cleaned);
          onChange(Number(cleaned || 0));
        }}
      />
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
  error,
  placeholder,
}: {
  label?: string;
  value: T | '';
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  hint?: string;
  error?: string | null;
  placeholder?: string;
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      <select className="select" value={value} onChange={(event) => onChange(event.target.value as T)}>
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <textarea className="textarea" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function SwitchRow({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="switch-row">
      <div className="switch-label">
        <strong id={id}>{title}</strong>
        {description ? <span>{description}</span> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        disabled={disabled}
        className={checked ? 'switch on' : 'switch'}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

/* ---------- Chips, badges, rows ---------- */

export function ChipRow<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="chip-row">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? 'chip active' : 'chip'}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export const Badge = ({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'blue' | 'grey' | 'teal'; children: ReactNode }) => (
  <span className={`badge ${tone}`}>{children}</span>
);

export function ListRow({
  avatar,
  title,
  subtitle,
  amount,
  note,
  onClick,
  right,
}: {
  avatar?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  amount?: ReactNode;
  note?: ReactNode;
  onClick?: () => void;
  right?: ReactNode;
}) {
  const content = (
    <>
      {avatar ? <div className="avatar">{avatar}</div> : null}
      <div className="li-main">
        <div className="li-title">{title}</div>
        {subtitle ? <div className="li-sub">{subtitle}</div> : null}
      </div>
      {right ?? (
        <div className="li-right">
          {amount !== undefined ? <div className="li-amount">{amount}</div> : null}
          {note ? <div className="li-sub">{note}</div> : null}
        </div>
      )}
    </>
  );
  if (!onClick) return <div className="list-item">{content}</div>;
  return (
    <button type="button" className="list-item" onClick={onClick}>
      {content}
    </button>
  );
}

export function StatTile({
  label,
  value,
  note,
  accent,
  onClick,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  accent?: boolean;
  onClick?: () => void;
}) {
  return (
    <div className={accent ? 'stat accent' : 'stat'} onClick={onClick} role={onClick ? 'button' : undefined}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note ? <div className="stat-note">{note}</div> : null}
    </div>
  );
}

/* ---------- Sheet & confirm ---------- */

export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <div className="sheet-handle" />
        {title ? (
          <div className="sheet-title">
            <h2>{title}</h2>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

export function ConfirmSheet({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet open={open} title={title} onClose={onCancel}>
      <div className="stack">
        <p>{message}</p>
        <button
          type="button"
          className={danger ? 'btn btn-danger btn-block btn-lg' : 'btn btn-block btn-lg'}
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? 'Please wait…' : confirmLabel}
        </button>
        <button type="button" className="btn btn-secondary btn-block" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}

/* ---------- Numeric keypad ---------- */

/** Big keys for entering an amount without the on-screen keyboard. */
export function NumberPad({
  value,
  onChange,
  allowDecimal = true,
}: {
  value: string;
  onChange: (value: string) => void;
  allowDecimal?: boolean;
}) {
  const press = (key: string) => {
    if (key === '⌫') {
      onChange(value.slice(0, -1));
      return;
    }
    if (key === '.') {
      if (!allowDecimal || value.includes('.')) return;
      onChange((value || '0') + '.');
      return;
    }
    onChange(value === '0' ? key : value + key);
  };

  return (
    <div className="keypad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', allowDecimal ? '.' : '', '0', '⌫'].map((key, index) =>
        key ? (
          <button key={key} type="button" onClick={() => press(key)}>
            {key}
          </button>
        ) : (
          <span key={`gap-${index}`} />
        ),
      )}
    </div>
  );
}

/* ---------- Money helpers used across screens ---------- */

export const Money = ({ value, exact }: { value: number; exact?: boolean }) => <>{money(value, { exact })}</>;

export function TotalsRow({ label, value, grand }: { label: string; value: ReactNode; grand?: boolean }) {
  return (
    <div className={grand ? 'totals-row grand' : 'totals-row'}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
