import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api.js';
import { useLogin } from '../lib/auth.js';
import { AuthLayout, Field } from './AuthForm.js';

export function LoginRoute() {
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFieldErrors({});
    setFormError(null);

    const data = new FormData(e.currentTarget);
    try {
      await login.mutateAsync({
        email: String(data.get('email') ?? ''),
        password: String(data.get('password') ?? ''),
      });
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors());
        setFormError(err.problem.detail ?? err.problem.title);
      } else {
        setFormError('Could not reach the server. Check your connection.');
      }
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Your leagues, your rules."
      onSubmit={onSubmit}
      error={formError}
      submitting={login.isPending}
      submitLabel="Sign in"
      footer={
        <>
          No account yet? <Link to="/register">Create one</Link>
        </>
      }
    >
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        error={fieldErrors.email}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        error={fieldErrors.password}
      />
    </AuthLayout>
  );
}
