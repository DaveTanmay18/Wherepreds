import type { FormEvent, ReactNode } from 'react';

/**
 * Shared shell for sign in / sign up. Mobile-first: single column, generous
 * targets, one primary action per screen (§14.1).
 */
export function AuthLayout(props: {
  title: string;
  subtitle: string;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  error?: string | null;
  submitting: boolean;
  submitLabel: string;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--s4)',
        background: 'var(--surface)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 380 }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', margin: '0 0 var(--s1)' }}>WherePreds</h1>
        <p style={{ color: 'var(--text-muted)', margin: '0 0 var(--s5)' }}>{props.subtitle}</p>

        <form
          onSubmit={props.onSubmit}
          noValidate
          style={{
            background: 'var(--surface-raised)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--s5)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 var(--s4)' }}>{props.title}</h2>

          {props.error && (
            <p
              role="alert"
              style={{
                color: 'var(--negative)',
                fontSize: 'var(--text-sm)',
                margin: '0 0 var(--s4)',
              }}
            >
              {props.error}
            </p>
          )}

          {props.children}

          <button
            type="submit"
            disabled={props.submitting}
            style={{
              width: '100%',
              minHeight: 48,
              marginTop: 'var(--s4)',
              background: 'var(--accent)',
              color: 'var(--accent-text)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-base)',
              fontWeight: 600,
              cursor: props.submitting ? 'wait' : 'pointer',
              opacity: props.submitting ? 0.7 : 1,
            }}
          >
            {props.submitting ? 'Please wait…' : props.submitLabel}
          </button>
        </form>

        <p
          style={{
            textAlign: 'center',
            marginTop: 'var(--s4)',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-muted)',
          }}
        >
          {props.footer}
        </p>
      </div>
    </main>
  );
}

export function Field(props: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  error?: string;
  hint?: string;
}) {
  const id = `f-${props.name}`;
  const describedBy = props.error ? `${id}-err` : props.hint ? `${id}-hint` : undefined;

  return (
    <div style={{ marginBottom: 'var(--s3)' }}>
      <label
        htmlFor={id}
        style={{ display: 'block', fontSize: 'var(--text-sm)', marginBottom: 'var(--s1)' }}
      >
        {props.label}
      </label>
      <input
        id={id}
        name={props.name}
        type={props.type ?? 'text'}
        autoComplete={props.autoComplete}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy}
        style={{
          width: '100%',
          minHeight: 44,
          padding: '0 var(--s3)',
          // 16px stops iOS zooming the page on focus (§14.5).
          fontSize: '16px',
          color: 'var(--text)',
          background: 'var(--bg)',
          border: `1px solid ${props.error ? 'var(--negative)' : 'var(--border)'}`,
          borderRadius: 'var(--radius-md)',
        }}
      />
      {props.error ? (
        <span id={`${id}-err`} style={{ color: 'var(--negative)', fontSize: 'var(--text-xs)' }}>
          {props.error}
        </span>
      ) : props.hint ? (
        <span id={`${id}-hint`} style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
          {props.hint}
        </span>
      ) : null}
    </div>
  );
}
