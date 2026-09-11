import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { SYSTEM_NAME } from "@/lib/brand"

export interface SchoolContext {
  timezone: string
  current_semester: null | {
    id: number
    name: string
    status: "draft" | "open" | "closed"
    academic_year: { id: number; name: string }
  }
}

export function useSchoolContext() {
  return useQuery({
    queryKey: ["context"],
    queryFn: async () => (await api<SchoolContext>("/api/v1/context")).data,
  })
}

export interface SystemBranding {
  system_name: string
  system_tagline: string | null
}

export function useSystemBranding() {
  const branding = useQuery({
    queryKey: ["branding"],
    queryFn: async () => (await api<SystemBranding>("/api/v1/branding")).data,
    staleTime: 60_000,
  })
  return branding.data ?? { system_name: SYSTEM_NAME, system_tagline: null }
}

export function useSystemName() {
  return useSystemBranding().system_name
}
