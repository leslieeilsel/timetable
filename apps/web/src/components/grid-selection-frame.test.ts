import { describe, expect, it } from "vitest"
import {
  getGridSelectionLines,
  type GridSelectionBounds,
  type GridSelectionCellGeometry,
} from "./grid-selection-frame"

const twoByTwoBounds: GridSelectionBounds = {
  minRow: 0,
  maxRow: 1,
  minColumn: 0,
  maxColumn: 1,
}

function cell(row: number, column: number): GridSelectionCellGeometry {
  return {
    row,
    column,
    left: column * 100,
    top: row * 100,
    right: (column + 1) * 100,
    bottom: (row + 1) * 100,
  }
}

describe("getGridSelectionLines", () => {
  it("keeps a single perimeter cell's entire 2px stroke inside the grid", () => {
    expect(getGridSelectionLines([cell(0, 0)], twoByTwoBounds)).toEqual([
      { orientation: "horizontal", position: 1, start: 1, end: 100 },
      { orientation: "horizontal", position: 100, start: 1, end: 100 },
      { orientation: "vertical", position: 1, start: 1, end: 100 },
      { orientation: "vertical", position: 100, start: 1, end: 100 },
    ])
  })

  it("merges a rectangular selection into continuous pixel-aligned grid lines", () => {
    expect(
      getGridSelectionLines([cell(0, 0), cell(0, 1), cell(1, 0), cell(1, 1)], twoByTwoBounds),
    ).toEqual([
      { orientation: "horizontal", position: 1, start: 1, end: 199 },
      { orientation: "horizontal", position: 100, start: 1, end: 199 },
      { orientation: "horizontal", position: 199, start: 1, end: 199 },
      { orientation: "vertical", position: 1, start: 1, end: 199 },
      { orientation: "vertical", position: 100, start: 1, end: 199 },
      { orientation: "vertical", position: 199, start: 1, end: 199 },
    ])
  })

  it("preserves every edge and sealed intersection in an irregular selection", () => {
    const lines = getGridSelectionLines([cell(0, 0), cell(0, 1), cell(1, 0)], twoByTwoBounds)

    expect(lines).toContainEqual({
      orientation: "horizontal",
      position: 100,
      start: 1,
      end: 199,
    })
    expect(lines).toContainEqual({
      orientation: "vertical",
      position: 100,
      start: 1,
      end: 199,
    })
    expect(lines).toContainEqual({
      orientation: "horizontal",
      position: 199,
      start: 1,
      end: 100,
    })
  })

  it("does not close the empty cells between diagonally disjoint selections", () => {
    const lines = getGridSelectionLines([cell(0, 0), cell(1, 1)], twoByTwoBounds)

    expect(lines).toContainEqual({
      orientation: "horizontal",
      position: 1,
      start: 1,
      end: 100,
    })
    expect(lines).toContainEqual({
      orientation: "horizontal",
      position: 199,
      start: 100,
      end: 199,
    })
    expect(lines).not.toContainEqual({
      orientation: "horizontal",
      position: 1,
      start: 1,
      end: 199,
    })
  })
})
