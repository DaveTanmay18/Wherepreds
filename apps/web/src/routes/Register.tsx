import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api.js';
import { useRegister } from '../lib/auth.js';
import { AuthLayout, Field } from './AuthForm.js';

export function RegisterRoute() {
  const register = useRegister();
  const navigate = useNavigate();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFieldErrors({});
    setFormError(null);

    const data = new FormData(e.currentTarget);
    try {
      await register.mutateAsync({
        email: String(data.get('email') ?? ''),
        username: String(data.get('username') ?? ''),
        password: String(data.get('password') ?? ''),
      });
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        // The API reports every invalid field at once, so show them all
        // rather than making the user resubmit to find the next one.
        setFieldErrors(err.fieldErrors());
        setFormError(err.problem.detail ?? err.problem.title);
      } else {
        setFormError('Could not reach the server. Check your connection.');
      }
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Your leagues, your rules."
      onSubmit={onSubmit}
      error={formError}
      submitting={register.isPending}
      submitLabel="Create account"
      footer={
        <>
          Already have an account? <Link to="/login">Sign in</Link>
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
        label="Username"
        name="username"
        autoComplete="username"
        error={fieldErrors.username}
        hint="Letters, numbers and underscores"
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        error={fieldErrors.password}
        hint="At least 10 characters"
      />
    </AuthLayout>
  );
}
