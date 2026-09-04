import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LoginInput, RegisterInput, SessionUserDto } from '@wp/shared/dto/auth';
import { api, ApiError } from './api.js';

const SESSION_KEY = ['auth', 'session'] as const;

/**
 * The session query is the app's source of truth for "who am I".
 * staleTime Infinity because it only changes through the mutations below,
 * which invalidate it explicitly (§13.2).
 */
export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async (): Promise<SessionUserDto | null> => {
      try {
        const { user } = await api.get<{ user: SessionUserDto }>('/auth/session');
        return user;
      } catch (e) {
        // 401 is the normal signed-out answer, not an error worth retrying.
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: Infinity,
    retry: false,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.post<{ user: SessionUserDto }>('/auth/login', input),
    onSuccess: ({ user }) => qc.setQueryData(SESSION_KEY, user),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) =>
      api.post<{ user: SessionUserDto }>('/auth/register', input),
    onSuccess: ({ user }) => qc.setQueryData(SESSION_KEY, user),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSuccess: () => {
      qc.setQueryData(SESSION_KEY, null);
      // Nothing cached should survive a sign-out — another user may be next.
      qc.clear();
    },
  });
}
