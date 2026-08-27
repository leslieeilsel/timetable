import { useLayoutEffect, useRef, useState } from "react"

export interface GridSelectionCellGeometry {
  row: number
  column: number
  left: number
  top: number
  right: number
  bottom: number
}

export interface GridSelectionBounds {
  minRow: number
  maxRow: number
  minColumn: number
  maxColumn: number
}

export interface GridSelectionLine {
  orientation: "horizontal" | "vertical"
  position: number
  start: number
  end: number
}

interface SelectionGeometry {
  width: number
  height: number
  lines: GridSelectionLine[]
}

const EMPTY_GEOMETRY: SelectionGeometry = { width: 0, height: 0, lines: [] }
const GRID_PERIMETER_INSET = 1

function pixel(value: number) {
  return Math.round(value)
}

function mergeCollinearLines(lines: GridSelectionLine[]) {
  const groups = new Map<string, GridSelectionLine[]>()
  for (const line of lines) {
    const key = `${line.orientation}:${line.position}`
    groups.set(key, [...(groups.get(key) ?? []), line])
  }

  const merged: GridSelectionLine[] = []
  for (const group of groups.values()) {
    const sorted = group.sort((a, b) => a.start - b.start || a.end - b.end)
    let current = { ...sorted[0] }
    for (const line of sorted.slice(1)) {
      if (line.start <= current.end) {
        current.end = Math.max(current.end, line.end)
      } else {
        merged.push(current)
        current = { ...line }
      }
    }
    merged.push(current)
  }

  return merged.sort(
    (a, b) =>
      a.orientation.localeCompare(b.orientation) || a.position - b.position || a.start - b.start,
  )
}

export function getGridSelectionLines(
  cells: GridSelectionCellGeometry[],
  bounds: GridSelectionBounds,
) {
  const lines: GridSelectionLine[] = []

  for (const cell of cells) {
    const left = pixel(cell.left + (cell.column === bounds.minColumn ? GRID_PERIMETER_INSET : 0))
    const right = pixel(cell.right - (cell.column === bounds.maxColumn ? GRID_PERIMETER_INSET : 0))
    const top = pixel(cell.top + (cell.row === bounds.minRow ? GRID_PERIMETER_INSET : 0))
    const bottom = pixel(cell.bottom - (cell.row === bounds.maxRow ? GRID_PERIMETER_INSET : 0))

    lines.push(
      { orientation: "horizontal", position: top, start: left, end: right },
      { orientation: "horizontal", position: bottom, start: left, end: right },
      { orientation: "vertical", position: left, start: top, end: bottom },
      { orientation: "vertical", position: right, start: top, end: bottom },
    )
  }

  return mergeCollinearLines(lines)
}

export function GridSelectionOverlay({ selectionKey }: { selectionKey: string }) {
  const overlayRef = useRef<SVGSVGElement>(null)
  const [geometry, setGeometry] = useState<SelectionGeometry>(EMPTY_GEOMETRY)

  useLayoutEffect(() => {
    const overlay = overlayRef.current
    const root = overlay?.parentElement
    if (!overlay || !root) return

    let frame = 0
    let disposed = false

    const measure = () => {
      if (disposed) return
      const rootRect = root.getBoundingClientRect()
      const elements = Array.from(root.querySelectorAll<HTMLElement>("[data-grid-selection-cell]"))
      const indexed = elements
        .map((element) => ({
          element,
          row: Number(element.dataset.gridRow),
          column: Number(element.dataset.gridColumn),
        }))
        .filter((cell) => Number.isFinite(cell.row) && Number.isFinite(cell.column))

      if (!indexed.length) {
        setGeometry(EMPTY_GEOMETRY)
        return
      }

      const rows = indexed.map((cell) => cell.row)
      const columns = indexed.map((cell) => cell.column)
      const bounds: GridSelectionBounds = {
        minRow: Math.min(...rows),
        maxRow: Math.max(...rows),
        minColumn: Math.min(...columns),
        maxColumn: Math.max(...columns),
      }
      const selected = indexed
        .filter((cell) => cell.element.dataset.gridSelected === "true")
        .map<GridSelectionCellGeometry>((cell) => {
          const rect = cell.element.getBoundingClientRect()
          return {
            row: cell.row,
            column: cell.column,
            left: rect.left - rootRect.left,
            top: rect.top - rootRect.top,
            right: rect.right - rootRect.left,
            bottom: rect.bottom - rootRect.top,
          }
        })

      setGeometry({
        width: pixel(Math.max(root.scrollWidth, rootRect.width)),
        height: pixel(Math.max(root.scrollHeight, rootRect.height)),
        lines: getGridSelectionLines(selected, bounds),
      })
    }
    const scheduleMeasure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }

    measure()
    const observer = new ResizeObserver(scheduleMeasure)
    observer.observe(root)
    const table = root.querySelector("table")
    if (table) observer.observe(table)
    void document.fonts.ready.then(scheduleMeasure)

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [selectionKey])

  return (
    <svg
      ref={overlayRef}
      data-slot="grid-selection-overlay"
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 z-[5] overflow-visible"
      width={geometry.width}
      height={geometry.height}
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      shapeRendering="crispEdges"
    >
      {geometry.lines.map((line) => (
        <line
          key={`${line.orientation}:${line.position}:${line.start}:${line.end}`}
          x1={line.orientation === "horizontal" ? line.start : line.position}
          y1={line.orientation === "horizontal" ? line.position : line.start}
          x2={line.orientation === "horizontal" ? line.end : line.position}
          y2={line.orientation === "horizontal" ? line.position : line.end}
          stroke="var(--primary)"
          strokeWidth="2"
          strokeLinecap="square"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  )
}
