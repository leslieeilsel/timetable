import { useState } from "react"
import { useQueries, useQuery } from "@tanstack/react-query"
import { Link } from "react-router"
import { ArrowLeftRightIcon, CheckIcon } from "lucide-react"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useResolvedSemesterId } from "@/lib/semester"
import { semesterPhase, useSchoolToday } from "@/lib/semester-phase"
import type { AcademicYear, Semester } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

export function SemesterSwitcher() {
  const [open, setOpen] = useState(false)
  const { user } = useAuth()
  const { semesterId, context } = useResolvedSemesterId()
  const today = useSchoolToday(context.data?.timezone)
  const years = useQuery({
    queryKey: ["academic-years"],
    queryFn: () => api<AcademicYear[]>("/api/v1/academic-years"),
    enabled: open,
  })
  const yearItems = years.data?.data ?? []
  const semesters = useQueries({
    queries: yearItems.map((year) => ({
      queryKey: ["semesters", year.id],
      queryFn: async () =>
        (await api<Semester[]>(`/api/v1/academic-years/${year.id}/semesters`)).data,
      enabled: open,
    })),
  })
  const isLoading = years.isLoading || semesters.some((query) => query.isLoading)
  const hasError = years.isError || semesters.some((query) => query.isError)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" className="shrink-0" />}>
        <ArrowLeftRightIcon />
        切换学期
      </DialogTrigger>
      <DialogContent className="flex max-h-[calc(100svh-2rem)] flex-col gap-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b p-6 pr-14">
          <DialogTitle>切换学期</DialogTitle>
          <DialogDescription className="sr-only">选择要进入的学期工作台</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-6 overflow-y-auto p-6">
          {isLoading && (
            <p className="text-sm text-muted-foreground" role="status">
              正在载入学期…
            </p>
          )}
          {hasError && (
            <Button
              variant="outline"
              onClick={() => {
                void years.refetch()
                semesters.forEach((query) => void query.refetch())
              }}
            >
              载入失败，点击重试
            </Button>
          )}
          {!isLoading && !hasError && yearItems.length === 0 && (
            <p className="text-sm text-muted-foreground">尚未创建学年学期</p>
          )}
          {yearItems.map((year, index) => (
            <section key={year.id} aria-label={year.name}>
              <h3 className="mb-3 text-sm font-medium">{year.name}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {semesters[index].data?.map((item) => (
                  <Link
                    key={item.id}
                    to={`/semesters/${item.id}/dashboard`}
                    aria-current={item.id === semesterId ? "true" : undefined}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "rounded-lg border p-4 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring",
                      item.id === semesterId &&
                        "border-blue-300 bg-blue-50/70 hover:bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 dark:hover:bg-blue-950/50",
                    )}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-medium">{item.name}</span>
                      {item.id === semesterId && (
                        <CheckIcon
                          className="size-4 shrink-0 text-blue-600 dark:text-blue-400"
                          aria-label="当前选择"
                        />
                      )}
                    </span>
                    <span className="mt-2 block text-xs text-muted-foreground">
                      {item.start_date} 至 {item.end_date}
                    </span>
                    <span className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5",
                          semesterPhase(item, today).value === "teaching"
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                            : semesterPhase(item, today).value === "upcoming"
                              ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                              : "bg-muted text-muted-foreground",
                        )}
                      >
                        {semesterPhase(item, today).label}
                      </span>
                      {item.status === "closed" && <span>已关闭</span>}
                    </span>
                  </Link>
                ))}
              </div>
              {semesters[index].isSuccess && semesters[index].data?.length === 0 && (
                <p className="text-sm text-muted-foreground">暂无学期</p>
              )}
            </section>
          ))}
        </div>
        {(user?.role !== "viewer" ||
          (context.data?.current_semester && context.data.current_semester.id !== semesterId)) && (
          <DialogFooter className="border-t px-6 py-4 sm:justify-between">
            {context.data?.current_semester && context.data.current_semester.id !== semesterId && (
              <Button
                variant="ghost"
                nativeButton={false}
                render={
                  <Link
                    to={`/semesters/${context.data.current_semester.id}/dashboard`}
                    onClick={() => setOpen(false)}
                  />
                }
              >
                返回默认学期
              </Button>
            )}
            {user?.role !== "viewer" && (
              <Button
                variant="ghost"
                className="sm:ml-auto"
                nativeButton={false}
                render={<Link to="/years" onClick={() => setOpen(false)} />}
              >
                管理学年学期
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
