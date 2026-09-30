/**
 * وضعیت احراز هویت — zustand
 * توکن CSRF فقط در حافظه (از طریق api.ts) نگه داشته می‌شود.
 */
import { create } from "zustand";
import { api, ApiError, setCsrfToken } from "@/lib/api";
import type { LoginResponse, MfaVerifyResponse, SessionResponse, User } from "@/lib/types";

export type AuthStatus = "loading" | "guest" | "pending_mfa" | "authenticated";

export interface AuthState {
  status: AuthStatus;
  user: User | null;
  /** پیام خطای نشست اولیه (مثلاً قطع ارتباط) برای امکان تلاش دوباره */
  sessionError: string | null;

  fetchSession: () => Promise<void>;
  login: (username: string, password: string) => Promise<ApiError | null>;
  verifyMfa: (code: string) => Promise<ApiError | null>;
  logout: () => Promise<void>;
  acceptInvite: (
    code: string,
    displayName: string,
    password: string,
  ) => Promise<ApiError | null>;
}

function toAuthError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  return new ApiError({
    code: "unavailable",
    message: "ارتباط با سرور برقرار نشد؛ اتصال خود را بررسی کنید و دوباره تلاش کنید.",
    retryable: true,
    status: 0,
  });
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "loading",
  user: null,
  sessionError: null,

  fetchSession: async () => {
    set({ sessionError: null });
    try {
      const res = await api.get<SessionResponse>("/auth/session");
      if (typeof res.csrf === "string" && res.csrf) setCsrfToken(res.csrf);
      if (res.user) {
        set({ user: res.user, status: "authenticated" });
      } else {
        set({ user: null, status: "guest" });
      }
    } catch (err) {
      setCsrfToken(null);
      if (err instanceof ApiError && err.status === 401) {
        set({ user: null, status: "guest", sessionError: null });
      } else {
        set({
          user: null,
          status: "guest",
          sessionError: toAuthError(err).message,
        });
      }
    }
  },

  login: async (username, password) => {
    try {
      const res = await api.post<LoginResponse>("/auth/login", {
        username,
        password,
      });
      if (typeof res.csrf === "string" && res.csrf) setCsrfToken(res.csrf);
      set({
        user: res.user,
        status: res.pending_mfa ? "pending_mfa" : "authenticated",
        sessionError: null,
      });
      return null;
    } catch (err) {
      return toAuthError(err);
    }
  },

  verifyMfa: async (code) => {
    try {
      const res = await api.post<MfaVerifyResponse>("/auth/mfa/verify", { code });
      if (typeof res.csrf === "string" && res.csrf) setCsrfToken(res.csrf);
      set({ user: res.user, status: "authenticated", sessionError: null });
      return null;
    } catch (err) {
      return toAuthError(err);
    }
  },

  logout: async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      /* خروج محلی همیشه انجام شود */
    }
    setCsrfToken(null);
    set({ user: null, status: "guest", sessionError: null });
  },

  acceptInvite: async (code, displayName, password) => {
    try {
      const res = await api.post<{ user: User; csrf?: string }>(
        "/auth/accept-invite",
        { code, display_name: displayName, password },
      );
      if (typeof res.csrf === "string" && res.csrf) setCsrfToken(res.csrf);
      set({ user: res.user, status: "authenticated", sessionError: null });
      return null;
    } catch (err) {
      return toAuthError(err);
    }
  },
}));
