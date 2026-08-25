import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

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
