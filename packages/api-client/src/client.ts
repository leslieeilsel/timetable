import createClient from "openapi-fetch"
import type { paths } from "./generated-types"

export function createApiClient() {
  return createClient<paths>({ baseUrl: "/", credentials: "include" })
}
