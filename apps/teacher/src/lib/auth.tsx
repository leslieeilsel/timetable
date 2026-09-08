import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createContext, useContext, useEffect, type ReactNode } from "react"
import { useLocation } from "react-router"

import { api, ApiError } from "@/lib/api"
import type { User } from "@/lib/types"

interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<User>
  logout: () => Promise<void>
  refresh: () => Promise<unknown>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const { pathname } = useLocation()
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api<User>("/api/v1/me")
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null
        throw error
      }
    },
    enabled: pathname !== "/login",
    retry: false,
    staleTime: 30_000,
  })

  useEffect(() => {
    const invalidate = () => {
      client.setQueryData(["me"], null)
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" })
    }
    window.addEventListener("auth:invalid", invalidate)
    return () => window.removeEventListener("auth:invalid", invalidate)
  }, [client])

  const value: AuthContextValue = {
    user: me.data ?? null,
    loading: me.isLoading,
    login: async (email, password) => {
      const user = await api<User>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      })
      if (user.role !== "teacher") {
        await api("/api/v1/auth/logout", { method: "POST" })
        throw new ApiError("请使用教师账号登录", 403, "TEACHER_ACCOUNT_REQUIRED", {})
      }
      client.setQueryData(["me"], user)
      return user
    },
    logout: async () => {
      await api("/api/v1/auth/logout", { method: "POST" })
      client.setQueryData(["me"], null)
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" })
    },
    refresh: () => me.refetch(),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth must be used inside AuthProvider")
  return value
}
