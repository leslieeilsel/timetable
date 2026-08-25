import { useEffect, useMemo, useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const pageSizeOptions = [10, 20, 50]

export function useTablePagination<T>(items?: readonly T[] | null, initialPageSize = 20) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const totalItems = items?.length ?? 0
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pagedItems = useMemo(
    () => (items ?? []).slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [currentPage, items, pageSize],
  )

  useEffect(() => {
    setPage((value) => Math.min(value, totalPages))
  }, [totalPages])

  return {
    items: pagedItems,
    page: currentPage,
    pageSize,
    totalItems,
    totalPages,
    onPageChange: setPage,
    onPageSizeChange: (value: number) => {
      setPageSize(value)
      setPage(1)
    },
  }
}

export function TablePagination({
  page,
  pageSize,
  totalItems,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}) {
  if (totalItems === 0) return null

  const pages = paginationPages(page, totalPages)

  return (
    <div className="flex flex-col gap-3 border-t px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-medium text-foreground/75">共 {totalItems} 条</span>
        <span className="h-4 w-px bg-border" aria-hidden="true" />
        <label className="flex items-center gap-2">
          <select
            aria-label="每页条数"
            className="h-9 rounded-lg border-0 bg-transparent px-2 text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/20"
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                每页 {size} 条
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-1.5 self-end sm:self-auto">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="上一页"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeftIcon />
        </Button>
        {pages.map((item, index) =>
          item === "ellipsis" ? (
            <span key={`ellipsis-${index}`} className="flex size-9 items-center justify-center">
              …
            </span>
          ) : (
            <Button
              key={item}
              size="icon-sm"
              variant={item === page ? "outline" : "ghost"}
              className={cn(item === page && "border-primary text-primary")}
              aria-label={`第 ${item} 页`}
              aria-current={item === page ? "page" : undefined}
              onClick={() => onPageChange(item)}
            >
              {item}
            </Button>
          ),
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="下一页"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRightIcon />
        </Button>
      </div>
    </div>
  )
}

function paginationPages(page: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, index) => index + 1)
  if (page <= 3) return [1, 2, 3, "ellipsis", totalPages]
  if (page >= totalPages - 2) return [1, "ellipsis", totalPages - 2, totalPages - 1, totalPages]
  return [1, "ellipsis", page, "ellipsis", totalPages]
}
