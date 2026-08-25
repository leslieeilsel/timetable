import { createContext, useContext, useEffect, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api, ApiError, jsonBody } from "@/lib/api"
import type { User } from "@/lib/types"

interface AuthContextValue {
  user: User | null
  loading: boolean
  refresh: () => Promise<unknown>
  login: (email: string, password: string) => Promise<User>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return (await api<User>("/api/v1/me")).data
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null
        throw error
      }
    },
    retry: false,
    staleTime: 30_000,
  })

  useEffect(() => {
    const invalidateAuth = () => {
      client.setQueryData(["me"], null)
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" })
    }
    const refreshStaleData = () => {
      void client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "me" })
    }
    window.addEventListener("auth:invalid", invalidateAuth)
    window.addEventListener("data:stale", refreshStaleData)
    return () => {
      window.removeEventListener("auth:invalid", invalidateAuth)
      window.removeEventListener("data:stale", refreshStaleData)
    }
  }, [client])

  const value: AuthContextValue = {
    user: me.data ?? null,
    loading: me.isLoading,
    refresh: () => me.refetch(),
    login: async (email, password) => {
      const user = (
        await api<User>("/api/v1/auth/login", {
          method: "POST",
          body: jsonBody({ email, password }),
        })
      ).data
      client.setQueryData(["me"], user)
      return user
    },
    logout: async () => {
      await api("/api/v1/auth/logout", { method: "POST" })
      client.setQueryData(["me"], null)
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" })
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth must be used inside AuthProvider")
  return value
}
