import { useEffect, useMemo, useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { SimpleSelect } from "@/components/simple-select"
import { Button } from "@/components/ui/button"

const defaultPageSizeOptions = [20, 50, 100]

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
  unit = "条",
  pageSizeOptions = defaultPageSizeOptions,
  onPageChange,
  onPageSizeChange,
}: {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
  unit?: string
  pageSizeOptions?: number[]
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}) {
  const [jumpValue, setJumpValue] = useState(String(page))
  useEffect(() => setJumpValue(String(page)), [page])
  if (totalItems === 0) return null

  const pages = paginationPages(page, totalPages)
  const rangeStart = Math.min(totalItems, (page - 1) * pageSize + 1)
  const rangeEnd = Math.min(totalItems, page * pageSize)
  const jump = () => {
    const target = Math.max(1, Math.min(totalPages, Number(jumpValue) || page))
    setJumpValue(String(target))
    if (target !== page) onPageChange(target)
  }

  return (
    <div className="flex flex-col gap-3 border-t px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-medium text-foreground/75">
          共 {totalItems} {unit}
        </span>
        <span className="h-4 w-px bg-border" aria-hidden="true" />
        <span className="tabular-nums">
          第 {rangeStart}–{rangeEnd} {unit}
        </span>
        <span className="h-4 w-px bg-border" aria-hidden="true" />
        <div className="flex items-center gap-2">
          <SimpleSelect
            label="每页条数"
            className="w-auto text-foreground"
            value={String(pageSize)}
            onValueChange={(value) => onPageSizeChange(Number(value))}
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                每页 {size} {unit}
              </option>
            ))}
          </SimpleSelect>
        </div>
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
            <span key={`ellipsis-${index}`} className="flex size-8 items-center justify-center">
              …
            </span>
          ) : (
            <Button
              key={item}
              size="icon-sm"
              variant={item === page ? "default" : "ghost"}
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
        {totalPages > 1 && (
          <label className="ml-2 flex items-center gap-1.5 whitespace-nowrap">
            <span>跳至</span>
            <input
              value={jumpValue}
              type="number"
              min={1}
              max={totalPages}
              inputMode="numeric"
              aria-label="跳转页码"
              className="h-8 w-14 rounded-md border bg-background px-2 text-center text-foreground outline-none transition-[border-color,box-shadow] focus:border-ring focus:ring-3 focus:ring-ring/20"
              onChange={(event) => setJumpValue(event.target.value)}
              onBlur={jump}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  jump()
                }
              }}
            />
            <span>页</span>
          </label>
        )}
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
