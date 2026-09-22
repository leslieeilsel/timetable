// UI latency only: these values never delay the server, tools, or model execution.
const maxDisplayLag = 420
const defaultRate = 0.06 // UTF-16 units per millisecond, before arrival samples exist.
const words = new Intl.Segmenter("zh", { granularity: "word" })
const graphemes = new Intl.Segmenter("zh", { granularity: "grapheme" })

type Arrival = { end: number; deadline: number }

function lastBoundary(offsets: number[], limit: number, start: number) {
  let low = 0
  let high = offsets.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (offsets[middle]! <= limit) low = middle + 1
    else high = middle
  }
  return Math.max(start, offsets[low - 1] ?? start)
}

/** Pace received text against arrival deadlines, not a fraction of the remaining text. */
export class TextPlayback {
  private text: string
  private position: number
  private arrivals: Arrival[] = []
  private rate = defaultRate
  private lastArrival: number | undefined
  private lastTick = 0
  private credit = 0
  private wordEnds: number[] = []
  private graphemeEnds: number[] = []
  private blockEnds: number[] = []

  constructor(initial: string) {
    this.text = initial
    this.position = initial.length
  }

  get visible() {
    return this.text.slice(0, this.position)
  }

  get pending() {
    return this.position < this.text.length
  }

  reset(text: string) {
    this.text = text
    this.position = text.length
    this.arrivals = []
    this.credit = 0
    this.lastArrival = undefined
    this.rate = defaultRate
  }

  pause() {
    // Time spent folding the process is not time spent presenting the answer.
    // On reveal, enqueue the accumulated text with fresh display deadlines.
    this.reset(this.visible)
  }

  receive(text: string, now: number) {
    if (text === this.text) return
    if (!text.startsWith(this.text)) this.reset("")
    const added = text.length - this.text.length
    if (!added) return
    if (!this.pending) {
      this.lastTick = now
      this.credit = 0
    }
    if (this.lastArrival !== undefined) {
      const gap = now - this.lastArrival
      if (gap > 0 && gap < 1000) {
        const observed = Math.min(1.2, added / gap)
        this.rate = this.rate * 0.75 + observed * 0.25
      } else if (gap >= 1000) this.rate = defaultRate
    }
    this.lastArrival = now
    const duration = Math.min(maxDisplayLag, Math.max(32, added / this.rate))
    this.arrivals.push({
      end: text.length,
      deadline: Math.max(this.arrivals.at(-1)?.deadline ?? now, now + duration),
    })
    this.text = text
    this.segmentPendingText()
  }

  advance(now: number) {
    if (!this.pending) return
    const elapsed = Math.max(0, now - this.lastTick)
    let rate = this.rate
    let due = this.position
    for (const arrival of this.arrivals) {
      if (arrival.deadline <= now) due = arrival.end
      else rate = Math.max(rate, (arrival.end - this.position) / (arrival.deadline - this.lastTick))
    }
    this.lastTick = now
    this.credit += rate * elapsed
    const limit = Math.min(this.text.length, Math.max(due, this.position + Math.floor(this.credit)))
    if (limit <= this.position) return

    // Bursts prefer sentence/line boundaries; smaller updates prefer Chinese words.
    let end =
      limit - this.position >= 80
        ? lastBoundary(this.blockEnds, limit, this.position)
        : this.position
    if (end === this.position) end = lastBoundary(this.wordEnds, limit, this.position)
    if (end === this.position) end = lastBoundary(this.graphemeEnds, limit, this.position)
    // Never strand a long word or a complete Markdown span past its display budget.
    if (end < due) end = this.graphemeEnds.find((offset) => offset >= due) ?? this.text.length
    if (end <= this.position) return
    this.credit = Math.max(0, this.credit - (end - this.position))
    this.position = end
    this.arrivals = this.arrivals.filter((arrival) => arrival.end > end)
    if (!this.pending) this.credit = 0
  }

  private segmentPendingText() {
    const start = this.position
    const pending = this.text.slice(start)
    const protectedSpans: { start: number; end: number }[] = []
    // Keep complete, reasonably sized inline Markdown intact when it arrives in a burst.
    // The source text stays untouched; incomplete markup is still handled by Markdown.
    for (const match of pending.matchAll(
      /!?\[[^\]\n]*\]\([^)\n]*\)|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~/g,
    )) {
      if (match[0].length <= 160)
        protectedSpans.push({
          start: start + match.index,
          end: start + match.index + match[0].length,
        })
    }
    for (const match of pending.matchAll(/[*_~`]{2,}/g))
      protectedSpans.push({
        start: start + match.index,
        end: start + match.index + match[0].length,
      })
    const safe = (offset: number) =>
      !protectedSpans.some((span) => offset > span.start && offset < span.end)
    this.graphemeEnds = Array.from(
      graphemes.segment(pending),
      (part) => start + part.index + part.segment.length,
    ).filter(safe)
    const graphemeSet = new Set(this.graphemeEnds)
    this.wordEnds = Array.from(
      words.segment(pending),
      (part) => start + part.index + part.segment.length,
    ).filter((offset) => graphemeSet.has(offset))
    this.blockEnds = Array.from(
      pending.matchAll(/[。！？!?；;](?:[”’」』）)]*)\s*|\n+/g),
      (match) => start + match.index + match[0].length,
    ).filter((offset) => graphemeSet.has(offset))
  }
}
