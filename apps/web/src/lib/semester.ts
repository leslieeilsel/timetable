import { useParams } from "react-router"
import { useSchoolContext } from "@/lib/queries"

export function useResolvedSemesterId() {
  const params = useParams()
  const context = useSchoolContext()
  const routeId = params.semesterId ? Number(params.semesterId) : null
  return { semesterId: routeId ?? context.data?.current_semester?.id ?? null, context }
}
