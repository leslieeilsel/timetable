import { keepPreviousData, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  isAfter,
  isBefore,
  isSameMonth,
  parseISO,
  endOfWeek,
  startOfMonth,
  startOfWeek,
} from "date-fns"
import { zhCN } from "date-fns/locale"
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  LogOut,
  RefreshCw,
} from "lucide-react"
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router"

import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu"
import { api, apiMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { lessonStartHint, lessonTiming, rowStatus } from "@/lib/timetable"
import type {
  TeacherClasses,
  TeacherClassTimetable,
  TeacherTimetable,
  TimetableDay,
  TimetableRow,
} from "@/lib/types"
import { cn } from "@/lib/utils"

const weekdayShort = ["一", "二", "三", "四", "五", "六", "日"]
type ScheduleMode = "day" | "week"
type SwipeDirection = -1 | 1
type DateRange = { from: string; to: string }

const CALENDAR_CACHE_TIME = 5 * 60_000

type SwipeGesture = {
  pointerId: number | null
  axis: "horizontal" | "vertical" | null
  startX: number
  startY: number
  baseOffset: number
  lastX: number
  lastTime: number
  velocityX: number
}

function emptySwipeGesture(): SwipeGesture {
  return {
    pointerId: null,
    axis: null,
    startX: 0,
    startY: 0,
    baseOffset: 0,
    lastX: 0,
    lastTime: 0,
    velocityX: 0,
  }
}

function calendarGestureAxis(distanceX: number, distanceY: number): SwipeGesture["axis"] {
  const horizontal = Math.abs(distanceX)
  const vertical = Math.abs(distanceY)
  if (horizontal >= 6 && horizontal >= vertical * 0.7) return "horizontal"
  if (vertical >= 12 && vertical > horizontal * 1.45) return "vertical"
  return null
}

function useInterruptibleSwipePager({
  pageKey,
  previousDisabled,
  nextDisabled,
  onMove,
  onInteractionChange,
}: {
  pageKey: string
  previousDisabled: boolean
  nextDisabled: boolean
  onMove: (direction: SwipeDirection) => void
  onInteractionChange: (active: boolean) => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const moveRef = useRef(onMove)
  const interactionRef = useRef(onInteractionChange)
  const previousDisabledRef = useRef(previousDisabled)
  const nextDisabledRef = useRef(nextDisabled)
  const movePending = useRef(false)
  const interacting = useRef(false)
  const animationRef = useRef<Animation | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const interactionReleaseFrameRef = useRef<number | null>(null)
  const offsetRef = useRef(0)
  const pendingOffsetRef = useRef(0)
  const gestureRef = useRef<SwipeGesture>(emptySwipeGesture())
  const resetRef = useRef<() => void>(() => undefined)
  const goRef = useRef<(direction: SwipeDirection) => void>(() => undefined)
  moveRef.current = onMove
  interactionRef.current = onInteractionChange
  previousDisabledRef.current = previousDisabled
  nextDisabledRef.current = nextDisabled

  const setInteraction = useCallback((active: boolean) => {
    if (interacting.current === active) return
    interacting.current = active
    interactionRef.current(active)
  }, [])

  useLayoutEffect(() => {
    resetRef.current()
  }, [pageKey])

  useEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport || !track) return
    let suppressClickUntil = 0
    let touchStart: { identifier: number; x: number; y: number } | null = null
    let touchAxis: SwipeGesture["axis"] = null
    let viewportWidth = viewport.clientWidth

    function width() {
      return viewportWidth
    }

    function transformForOffset(offset: number) {
      return `translate3d(${offset - width()}px, 0, 0)`
    }

    function writeOffset(offset: number) {
      offsetRef.current = offset
      pendingOffsetRef.current = offset
      if (track) track.style.transform = transformForOffset(offset)
    }

    function flushPendingOffset() {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      writeOffset(pendingOffsetRef.current)
      return offsetRef.current
    }

    function queueOffset(offset: number) {
      pendingOffsetRef.current = offset
      if (animationFrameRef.current !== null) return
      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null
        writeOffset(pendingOffsetRef.current)
      })
    }

    function renderedOffset() {
      if (!track || !animationRef.current) return offsetRef.current
      const transform = window.getComputedStyle(track).transform
      if (transform === "none") return offsetRef.current
      try {
        return new DOMMatrixReadOnly(transform).m41 + width()
      } catch {
        return offsetRef.current
      }
    }

    function cancelAnimationAtCurrentPosition() {
      const currentOffset = renderedOffset()
      const animation = animationRef.current
      animationRef.current = null
      animation?.cancel()
      if (track) track.dataset.settling = "false"
      writeOffset(currentOffset)
      return currentOffset
    }

    function blocked(direction: SwipeDirection) {
      return (
        (direction === -1 && previousDisabledRef.current) ||
        (direction === 1 && nextDisabledRef.current)
      )
    }

    function completeSettle(direction: SwipeDirection | null, targetOffset: number) {
      const animation = animationRef.current
      animationRef.current = null
      if (track) {
        track.style.transform = transformForOffset(targetOffset)
        track.dataset.settling = "false"
      }
      animation?.cancel()
      offsetRef.current = targetOffset
      pendingOffsetRef.current = targetOffset
      if (direction) {
        movePending.current = true
        moveRef.current(direction)
      } else {
        setInteraction(false)
      }
    }

    function settle(direction: SwipeDirection | null, velocityX: number) {
      const viewportWidth = width()
      if (!viewportWidth) return
      const currentOffset = flushPendingOffset()
      const targetOffset = direction ? -direction * viewportWidth : 0
      const distance = Math.abs(targetOffset - currentOffset)
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches

      if (distance < 0.5 || reducedMotion) {
        completeSettle(direction, targetOffset)
        return
      }

      setInteraction(true)
      if (track) track.dataset.settling = "true"
      const speed = Math.max(Math.abs(velocityX), direction ? 0.9 : 0.7)
      const rawDuration = distance / speed
      const duration = Math.round(
        Math.min(direction ? 220 : 190, Math.max(direction ? 150 : 130, rawDuration)),
      )
      const fromTransform = transformForOffset(currentOffset)
      const toTransform = transformForOffset(targetOffset)
      const easing = window
        .getComputedStyle(viewport as HTMLDivElement)
        .getPropertyValue("--page-slide-ease")
        .trim()
      const animation = track?.animate([{ transform: fromTransform }, { transform: toTransform }], {
        duration,
        easing: easing || "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "forwards",
      })
      if (!animation) {
        completeSettle(direction, targetOffset)
        return
      }
      animationRef.current = animation
      animation.onfinish = () => {
        if (animationRef.current !== animation) return
        completeSettle(direction, targetOffset)
      }
    }

    function releasePointer(pointerId: number) {
      if (viewport?.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId)
    }

    function handleTouchStart(event: TouchEvent) {
      const touch = event.touches.length === 1 ? event.touches[0] : null
      touchStart = touch
        ? { identifier: touch.identifier, x: touch.clientX, y: touch.clientY }
        : null
      touchAxis = null
    }

    function handleTouchMove(event: TouchEvent) {
      if (!touchStart || event.touches.length !== 1) return
      const touch = event.touches[0]
      if (touch.identifier !== touchStart.identifier) return
      touchAxis ??= calendarGestureAxis(touch.clientX - touchStart.x, touch.clientY - touchStart.y)
      // Pointer capture alone cannot stop a mobile browser from taking over vertical scrolling.
      if (touchAxis === "horizontal" && event.cancelable) event.preventDefault()
    }

    function handleTouchEnd() {
      touchStart = null
      touchAxis = null
    }

    function handlePointerDown(event: PointerEvent) {
      if (!event.isPrimary || event.button !== 0 || movePending.current) return
      if (interactionReleaseFrameRef.current !== null) {
        window.cancelAnimationFrame(interactionReleaseFrameRef.current)
        interactionReleaseFrameRef.current = null
      }
      gestureRef.current = {
        pointerId: event.pointerId,
        axis: null,
        startX: event.clientX,
        startY: event.clientY,
        baseOffset: offsetRef.current,
        lastX: event.clientX,
        lastTime: event.timeStamp,
        velocityX: 0,
      }
    }

    function handlePointerMove(event: PointerEvent) {
      const gesture = gestureRef.current
      if (gesture.pointerId !== event.pointerId) return
      const coalesced = event.getCoalescedEvents?.() ?? []
      const point = coalesced.at(-1) ?? event
      const distanceX = point.clientX - gesture.startX
      const distanceY = point.clientY - gesture.startY

      if (!gesture.axis) {
        gesture.axis = calendarGestureAxis(distanceX, distanceY)
        if (gesture.axis !== "horizontal") return
        gesture.baseOffset = cancelAnimationAtCurrentPosition()
        viewport?.setPointerCapture(event.pointerId)
        if (viewport) viewport.dataset.dragging = "true"
        setInteraction(true)
      }
      if (gesture.axis !== "horizontal") return
      if (event.cancelable) event.preventDefault()

      const elapsed = Math.max(1, point.timeStamp - gesture.lastTime)
      const instantVelocity = (point.clientX - gesture.lastX) / elapsed
      gesture.velocityX = gesture.velocityX * 0.62 + instantVelocity * 0.38
      gesture.lastX = point.clientX
      gesture.lastTime = point.timeStamp

      const viewportWidth = width()
      const rawOffset = gesture.baseOffset + point.clientX - gesture.startX
      const direction: SwipeDirection = rawOffset > 0 ? -1 : 1
      const resistedOffset = blocked(direction)
        ? Math.sign(rawOffset) * Math.min(64, Math.abs(rawOffset) * 0.28)
        : Math.max(-viewportWidth * 1.06, Math.min(viewportWidth * 1.06, rawOffset))
      queueOffset(resistedOffset)
    }

    function finishPointer(event: PointerEvent, cancelled: boolean) {
      const gesture = gestureRef.current
      if (gesture.pointerId !== event.pointerId) return
      releasePointer(event.pointerId)
      if (viewport) viewport.dataset.dragging = "false"
      gestureRef.current = emptySwipeGesture()
      if (gesture.axis !== "horizontal") return

      suppressClickUntil = performance.now() + 350
      const currentOffset = flushPendingOffset()
      if (cancelled) {
        settle(null, 0)
        return
      }

      const viewportWidth = width()
      const projectedOffset = currentOffset + gesture.velocityX * 170
      const direction: SwipeDirection = projectedOffset > 0 ? -1 : 1
      const shouldMove =
        !blocked(direction) &&
        (Math.abs(currentOffset) >= viewportWidth * 0.22 || Math.abs(gesture.velocityX) >= 0.35)
      settle(shouldMove ? direction : null, gesture.velocityX)
    }

    function handleClick(event: MouseEvent) {
      if (performance.now() >= suppressClickUntil && !animationRef.current) return
      event.preventDefault()
      event.stopPropagation()
    }

    function handlePointerUp(event: PointerEvent) {
      finishPointer(event, false)
    }

    function handlePointerCancel(event: PointerEvent) {
      finishPointer(event, true)
    }

    function reset() {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      const animation = animationRef.current
      animationRef.current = null
      animation?.cancel()
      gestureRef.current = emptySwipeGesture()
      movePending.current = false
      if (viewport) {
        viewport.dataset.dragging = "false"
      }
      if (track) {
        track.dataset.settling = "false"
        track.style.transform = transformForOffset(0)
      }
      offsetRef.current = 0
      pendingOffsetRef.current = 0
      if (interactionReleaseFrameRef.current !== null) {
        window.cancelAnimationFrame(interactionReleaseFrameRef.current)
      }
      interactionReleaseFrameRef.current = window.requestAnimationFrame(() => {
        interactionReleaseFrameRef.current = null
        setInteraction(false)
      })
    }

    resetRef.current = reset
    goRef.current = (direction) => {
      if (movePending.current || blocked(direction)) return
      const currentOffset = cancelAnimationAtCurrentPosition()
      pendingOffsetRef.current = currentOffset
      settle(direction, 0)
    }

    viewport.addEventListener("touchstart", handleTouchStart, { passive: true })
    viewport.addEventListener("touchmove", handleTouchMove, { passive: false })
    viewport.addEventListener("touchend", handleTouchEnd)
    viewport.addEventListener("touchcancel", handleTouchEnd)
    viewport.addEventListener("pointerdown", handlePointerDown)
    viewport.addEventListener("pointermove", handlePointerMove)
    viewport.addEventListener("pointerup", handlePointerUp)
    viewport.addEventListener("pointercancel", handlePointerCancel)
    viewport.addEventListener("click", handleClick, true)
    const resizeObserver = new ResizeObserver(() => {
      const nextWidth = viewport.clientWidth
      // Expanding the calendar changes its height every frame, but not the swipe distance.
      if (nextWidth === viewportWidth) return
      viewportWidth = nextWidth
      if (!animationRef.current && gestureRef.current.pointerId === null) writeOffset(0)
    })
    resizeObserver.observe(viewport)
    return () => {
      resizeObserver.disconnect()
      viewport.removeEventListener("touchstart", handleTouchStart)
      viewport.removeEventListener("touchmove", handleTouchMove)
      viewport.removeEventListener("touchend", handleTouchEnd)
      viewport.removeEventListener("touchcancel", handleTouchEnd)
      viewport.removeEventListener("pointerdown", handlePointerDown)
      viewport.removeEventListener("pointermove", handlePointerMove)
      viewport.removeEventListener("pointerup", handlePointerUp)
      viewport.removeEventListener("pointercancel", handlePointerCancel)
      viewport.removeEventListener("click", handleClick, true)
      if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current)
      if (interactionReleaseFrameRef.current !== null) {
        window.cancelAnimationFrame(interactionReleaseFrameRef.current)
      }
      animationRef.current?.cancel()
      resetRef.current = () => undefined
      goRef.current = () => undefined
    }
  }, [setInteraction])

  function go(direction: SwipeDirection) {
    goRef.current(direction)
  }

  return { viewportRef, trackRef, go }
}

function dateString(date: Date) {
  return format(date, "yyyy-MM-dd")
}

function rangeQuery(range: DateRange | null) {
  return range ? `?from=${range.from}&to=${range.to}` : ""
}

function splitRange(range: DateRange | null, semester: DateRange | null) {
  if (!range || !semester) return []

  const chunks: Array<{ from: string; to: string }> = []
  const requestedStart = parseISO(range.from)
  const requestedEnd = parseISO(range.to)
  const semesterEnd = parseISO(semester.to)
  let cursor = parseISO(semester.from)

  while (!isAfter(cursor, semesterEnd)) {
    const candidateTo = addDays(cursor, 13)
    const chunkTo = isAfter(candidateTo, semesterEnd) ? semesterEnd : candidateTo
    if (!isBefore(chunkTo, requestedStart) && !isAfter(cursor, requestedEnd)) {
      chunks.push({ from: dateString(cursor), to: dateString(chunkTo) })
    }
    cursor = addDays(chunkTo, 1)
  }

  return chunks
}

function weekRangeForDate(target: Date, semesterStart: string, semesterEnd: string): DateRange {
  const start = parseISO(semesterStart)
  const end = parseISO(semesterEnd)
  const boundedTarget = isBefore(target, start) ? start : isAfter(target, end) ? end : target
  const calendarFrom = startOfWeek(boundedTarget, { weekStartsOn: 1 })
  const calendarTo = endOfWeek(boundedTarget, { weekStartsOn: 1 })

  return {
    from: dateString(isBefore(calendarFrom, start) ? start : calendarFrom),
    to: dateString(isAfter(calendarTo, end) ? end : calendarTo),
  }
}

function activeRows(rows: TimetableRow[]) {
  return rows.filter((row) => row.duty_status !== "removed" && !row.is_cancelled)
}

function combineCalendarDays(queries: Array<{ data?: TeacherTimetable | TeacherClassTimetable }>) {
  return queries.flatMap((query) => query.data?.days ?? [])
}

export function TimetablePage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      setNow(new Date())
      timer = setTimeout(refresh, 60_000 - (Date.now() % 60_000))
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh()
    }
    refresh()
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [])
  const [context, setContext] = useState("mine")
  const [mode, setMode] = useState<ScheduleMode>("day")
  const [range, setRange] = useState<DateRange | null>(null)
  const [calendarRange, setCalendarRange] = useState<DateRange | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const weekSwipeStart = useRef<{ x: number; y: number } | null>(null)

  const myTimetable = useQuery({
    queryKey: ["teacher-timetable", range],
    queryFn: () => api<TeacherTimetable>(`/api/v1/teacher/me/timetable${rangeQuery(range)}`),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: CALENDAR_CACHE_TIME,
  })
  const classes = useQuery({
    queryKey: ["teacher-classes", range],
    queryFn: () => api<TeacherClasses>(`/api/v1/teacher/me/classes${rangeQuery(range)}`),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: CALENDAR_CACHE_TIME,
  })
  const classTimetable = useQuery({
    queryKey: ["teacher-class-timetable", context, range],
    queryFn: () =>
      api<TeacherClassTimetable>(
        `/api/v1/teacher/me/classes/${context}/timetable${rangeQuery(range)}`,
      ),
    enabled: context !== "mine",
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: CALENDAR_CACHE_TIME,
  })
  const semester =
    myTimetable.data?.semester ?? classes.data?.semester ?? classTimetable.data?.semester
  const calendarQueryRanges = useMemo(
    () =>
      splitRange(
        calendarRange,
        semester ? { from: semester.start_date, to: semester.end_date } : null,
      ),
    [calendarRange, semester?.end_date, semester?.start_date],
  )
  const monthScheduleDays = useQueries({
    queries: calendarQueryRanges.map((monthRange) => ({
      queryKey: ["teacher-month-timetable", context, monthRange.from, monthRange.to],
      queryFn: () => {
        const endpoint =
          context === "mine"
            ? "/api/v1/teacher/me/timetable"
            : `/api/v1/teacher/me/classes/${context}/timetable`
        return api<TeacherTimetable | TeacherClassTimetable>(`${endpoint}${rangeQuery(monthRange)}`)
      },
      retry: false,
      staleTime: CALENDAR_CACHE_TIME,
    })),
    combine: combineCalendarDays,
  })

  const availableClasses = classes.data?.classes ?? []
  useEffect(() => {
    if (range || !myTimetable.data) return
    const week = weekRangeForDate(
      new Date(),
      myTimetable.data.semester.start_date,
      myTimetable.data.semester.end_date,
    )
    if (week.from !== myTimetable.data.from || week.to !== myTimetable.data.to) {
      setRange(week)
    }
  }, [myTimetable.data, range])

  useEffect(() => {
    if (
      context !== "mine" &&
      classes.data &&
      !availableClasses.some((item) => String(item.id) === context)
    ) {
      setContext("mine")
      setSelectedDate(null)
    }
  }, [availableClasses, classes.data, context])

  const timetable = context === "mine" ? myTimetable.data : classTimetable.data
  const scheduleDays = useMemo(
    () => [...monthScheduleDays, ...(timetable?.days ?? [])],
    [monthScheduleDays, timetable?.days],
  )
  const rangeData = timetable ?? (context === "mine" ? myTimetable.data : classes.data)
  const today = dateString(now)
  const selectedDay =
    timetable?.days.find((day) => day.date === selectedDate) ??
    timetable?.days.find((day) => day.date === today) ??
    timetable?.days[0]
  const upcomingRange = nextRangeForEmptyDay(timetable, selectedDay, mode, context)
  const upcomingTimetable = useQuery({
    queryKey: ["teacher-upcoming-timetable", upcomingRange],
    queryFn: () =>
      api<TeacherTimetable>(`/api/v1/teacher/me/timetable${rangeQuery(upcomingRange)}`),
    enabled: Boolean(upcomingRange),
    retry: false,
  })
  const currentClass = availableClasses.find((item) => String(item.id) === context)
  const currentLabel = context === "mine" ? "我的课表" : (currentClass?.name ?? "班级课表")
  const teacherName = rangeData?.teacher.name ?? user?.teacher?.name ?? user?.name ?? "教师"
  const teacherInitial = teacherName.slice(0, 1)
  const loading = context === "mine" ? myTimetable.isLoading : classTimetable.isLoading
  const error = context === "mine" ? myTimetable.error : classes.error || classTimetable.error
  const fetching =
    context === "mine" ? myTimetable.isFetching : classes.isFetching || classTimetable.isFetching
  const adjacentWeekRanges = useMemo(() => {
    if (!rangeData) return []
    const anchor = parseISO(selectedDay?.date ?? rangeData.from)
    return ([-7, 7] as const).map((offset) =>
      weekRangeForDate(
        addDays(anchor, offset),
        rangeData.semester.start_date,
        rangeData.semester.end_date,
      ),
    )
  }, [
    rangeData?.from,
    rangeData?.semester.end_date,
    rangeData?.semester.start_date,
    selectedDay?.date,
  ])

  useEffect(() => {
    for (const preloadRange of adjacentWeekRanges) {
      void queryClient.prefetchQuery({
        queryKey: ["teacher-timetable", preloadRange],
        queryFn: () =>
          api<TeacherTimetable>(`/api/v1/teacher/me/timetable${rangeQuery(preloadRange)}`),
        retry: false,
        staleTime: CALENDAR_CACHE_TIME,
      })
      void queryClient.prefetchQuery({
        queryKey: ["teacher-classes", preloadRange],
        queryFn: () => api<TeacherClasses>(`/api/v1/teacher/me/classes${rangeQuery(preloadRange)}`),
        retry: false,
        staleTime: CALENDAR_CACHE_TIME,
      })
      if (context !== "mine") {
        void queryClient.prefetchQuery({
          queryKey: ["teacher-class-timetable", context, preloadRange],
          queryFn: () =>
            api<TeacherClassTimetable>(
              `/api/v1/teacher/me/classes/${context}/timetable${rangeQuery(preloadRange)}`,
            ),
          retry: false,
          staleTime: CALENDAR_CACHE_TIME,
        })
      }
    }
  }, [adjacentWeekRanges, context, queryClient])

  function moveRange(days: number) {
    if (!rangeData) return
    const currentAnchor = parseISO(selectedDay?.date ?? rangeData.from)
    const target = addDays(currentAnchor, days)
    const nextRange = weekRangeForDate(
      target,
      rangeData.semester.start_date,
      rangeData.semester.end_date,
    )
    const boundedTarget = isBefore(target, parseISO(rangeData.semester.start_date))
      ? parseISO(rangeData.semester.start_date)
      : isAfter(target, parseISO(rangeData.semester.end_date))
        ? parseISO(rangeData.semester.end_date)
        : target
    setRange(nextRange)
    setSelectedDate(dateString(boundedTarget))
  }

  function chooseDate(date: string) {
    if (!rangeData) return
    const target = parseISO(date)
    const semesterStart = parseISO(rangeData.semester.start_date)
    const semesterEnd = parseISO(rangeData.semester.end_date)
    if (isBefore(target, semesterStart) || isAfter(target, semesterEnd)) return

    const currentFrom = parseISO(rangeData.from)
    const currentTo = parseISO(rangeData.to)
    if (!isBefore(target, currentFrom) && !isAfter(target, currentTo)) {
      setSelectedDate(date)
      return
    }

    setRange(weekRangeForDate(target, rangeData.semester.start_date, rangeData.semester.end_date))
    setSelectedDate(date)
  }

  function openDay(date: string) {
    chooseDate(date)
    setMode("day")
  }

  function endWeekSwipe(clientX: number, clientY: number) {
    const start = weekSwipeStart.current
    weekSwipeStart.current = null
    if (!start || mode !== "week") return
    const distanceX = clientX - start.x
    const distanceY = clientY - start.y
    if (Math.abs(distanceX) < 64 || Math.abs(distanceX) <= Math.abs(distanceY) * 1.15) return
    moveRange(distanceX > 0 ? -7 : 7)
  }

  function changeContext(value: string) {
    setContext(value)
    setSelectedDate(null)
  }

  async function signOut() {
    await logout()
    void navigate("/login", { replace: true })
  }

  if (loading && !rangeData) return <TimetableLoading />

  return (
    <main className="teacher-page">
      <div className="teacher-shell timetable-shell">
        <header className="schedule-header">
          <span className="header-balance" aria-hidden="true" />
          {availableClasses.length ? (
            <Menu>
              <MenuTrigger
                className="context-trigger"
                aria-label={`当前查看：${currentLabel}，点击切换`}
              >
                <span>{currentLabel}</span>
                <ChevronDown />
              </MenuTrigger>
              <MenuContent className="context-menu" align="center" sideOffset={7}>
                <MenuLabel>切换查看范围</MenuLabel>
                <ContextItem active={context === "mine"} onClick={() => changeContext("mine")}>
                  我的课表
                </ContextItem>
                <MenuSeparator />
                {availableClasses.map((schoolClass) => (
                  <ContextItem
                    key={schoolClass.id}
                    active={context === String(schoolClass.id)}
                    onClick={() => changeContext(String(schoolClass.id))}
                  >
                    {schoolClass.name}
                  </ContextItem>
                ))}
              </MenuContent>
            </Menu>
          ) : (
            <strong className="context-label">{currentLabel}</strong>
          )}

          <Menu>
            <MenuTrigger className="avatar-trigger" aria-label="打开教师账户菜单">
              {teacherInitial}
            </MenuTrigger>
            <MenuContent className="account-menu" align="end" sideOffset={7}>
              <MenuLabel className="account-summary">
                <span className="account-avatar">{teacherInitial}</span>
                <span>
                  <strong>{teacherName}老师</strong>
                  <small>教师账号</small>
                </span>
              </MenuLabel>
              <MenuSeparator />
              <MenuItem onClick={() => void navigate("/change-password")}>
                <KeyRound />
                修改密码
              </MenuItem>
              <MenuItem className="danger-menu-item" onClick={() => void signOut()}>
                <LogOut />
                退出登录
              </MenuItem>
            </MenuContent>
          </Menu>
        </header>

        {rangeData ? (
          <DateControls
            from={rangeData.from}
            to={rangeData.to}
            semesterStart={rangeData.semester.start_date}
            semesterEnd={rangeData.semester.end_date}
            days={timetable?.days ?? daysFromRange(rangeData.from, rangeData.to)}
            scheduleDays={scheduleDays}
            selectedDate={selectedDate}
            selectedDay={selectedDay}
            today={today}
            mode={mode}
            showCourseMarkers={context === "mine"}
            onModeChange={setMode}
            onSelectDate={chooseDate}
            onMoveRange={moveRange}
            onMonthRangeChange={setCalendarRange}
          />
        ) : null}

        <section
          className={cn("schedule-content", mode === "week" && "week-mode")}
          onTouchStart={(event) => {
            if (mode !== "week") return
            const touch = event.changedTouches[0]
            weekSwipeStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null
          }}
          onTouchEnd={(event) => {
            const touch = event.changedTouches[0]
            if (touch) endWeekSwipe(touch.clientX, touch.clientY)
          }}
        >
          {fetching && rangeData ? <RefreshCw className="fetching-indicator spin" /> : null}
          {error ? (
            <ErrorState
              error={error}
              retry={() => {
                void classes.refetch()
                if (context === "mine") void myTimetable.refetch()
                else void classTimetable.refetch()
              }}
            />
          ) : timetable ? (
            mode === "day" ? (
              <DaySchedule
                day={selectedDay}
                days={[...timetable.days, ...(upcomingTimetable.data?.days ?? [])]}
                context={context}
                today={today}
                now={now}
              />
            ) : (
              <WeekSchedule
                days={timetable.days}
                context={context}
                today={today}
                now={now}
                onSelectDay={openDay}
              />
            )
          ) : null}
        </section>
      </div>
    </main>
  )
}

function ContextItem({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <MenuItem className={cn(active && "active-context-item")} onClick={onClick}>
      <span>{children}</span>
      {active ? <Check className="context-check" /> : null}
    </MenuItem>
  )
}

type CalendarMonthPanel = {
  month: Date
  days: Date[]
  compactRow: number
  monthRow: number
  monthRowCount: number
}

const CalendarMonthPanels = memo(function CalendarMonthPanels({
  calendarMonths,
  expanded,
  scheduleByDate,
  selected,
  today,
  semesterStart,
  semesterEnd,
  showCourseMarkers,
  onSelectDate,
}: {
  calendarMonths: CalendarMonthPanel[]
  expanded: boolean
  scheduleByDate: Map<string, TimetableRow[]>
  selected: string
  today: string
  semesterStart: string
  semesterEnd: string
  showCourseMarkers: boolean
  onSelectDate: (date: string) => void
}) {
  const semesterStartDate = parseISO(semesterStart)
  const semesterEndDate = parseISO(semesterEnd)
  return calendarMonths.map((calendarMonth, panelIndex) => (
    <div
      className="month-days"
      key={panelIndex}
      style={
        {
          "--compact-row": calendarMonth.compactRow,
          "--month-row": calendarMonth.monthRow,
        } as React.CSSProperties
      }
      aria-hidden={panelIndex !== 1}
      inert={panelIndex !== 1}
    >
      {calendarMonth.days.map((date, dayIndex) => {
        const firstRow = expanded ? calendarMonth.monthRow : calendarMonth.compactRow
        const rowCount = expanded ? calendarMonth.monthRowCount : 2
        const hidden = dayIndex < firstRow * 7 || dayIndex >= (firstRow + rowCount) * 7
        const value = dateString(date)
        const rows = scheduleByDate.get(value)
        const { morning, afternoon } = lessonGroups(rows ?? [])
        const disabled = isBefore(date, semesterStartDate) || isAfter(date, semesterEndDate)
        const lessonSummary = [
          morning.length ? `上午${morning.length}节` : null,
          afternoon.length ? `下午${afternoon.length}节` : null,
        ]
          .filter(Boolean)
          .join("，")
        const dateLabel = format(date, "M月d日 EEEE", { locale: zhCN })
        return (
          <button
            type="button"
            key={value}
            className={cn(
              "month-day",
              value === selected && "selected",
              value === today && "today",
              !isSameMonth(date, calendarMonth.month) && "outside-month",
            )}
            aria-label={`${value === today ? "今天，" : ""}${dateLabel}${rows ? (lessonSummary ? `，${lessonSummary}` : "，无课") : ""}`}
            aria-current={value === today ? "date" : undefined}
            aria-pressed={value === selected}
            aria-hidden={hidden || undefined}
            inert={hidden}
            disabled={disabled}
            onClick={() => onSelectDate(value)}
          >
            <strong>{format(date, "d")}</strong>
            {showCourseMarkers && rows ? <CourseMarkers rows={rows} /> : null}
          </button>
        )
      })}
    </div>
  ))
})

function FlippingDatePart({
  value,
  order,
  part,
}: {
  value: string
  order: string
  part: "year" | "month"
}) {
  const [flip, setFlip] = useState({ value, order, previous: "", direction: 1, delay: 0 })

  if (flip.order !== order) {
    setFlip({
      value,
      order,
      previous: value !== flip.value ? flip.value : "",
      direction: order > flip.order ? 1 : -1,
      delay: part === "month" && order.slice(0, 4) !== flip.order.slice(0, 4) ? 120 : 0,
    })
  }

  return (
    <span
      className="month-title-part"
      data-part={part}
      data-flipping={Boolean(flip.previous)}
      style={
        {
          "--flip-direction": flip.direction,
          "--flip-delay": `${flip.delay}ms`,
        } as React.CSSProperties
      }
      aria-hidden="true"
    >
      {flip.previous ? (
        <span key={`${flip.value}-out`} className="month-title-out">
          {flip.previous}
        </span>
      ) : null}
      <span
        key={flip.value}
        className="month-title-in"
        onAnimationEnd={() =>
          setFlip((current) => (current.value === value ? { ...current, previous: "" } : current))
        }
      >
        {value}
      </span>
    </span>
  )
}

function FlippingMonthTitle({ month }: { month: Date }) {
  const order = format(month, "yyyy-MM")
  return (
    <strong className="month-title-flip" aria-label={format(month, "yyyy年M月")}>
      <FlippingDatePart part="year" value={format(month, "yyyy")} order={order} />
      <span aria-hidden="true">年</span>
      <FlippingDatePart part="month" value={format(month, "M")} order={order} />
      <span aria-hidden="true">月</span>
    </strong>
  )
}

function DateControls({
  from,
  to,
  semesterStart,
  semesterEnd,
  days,
  scheduleDays,
  selectedDate,
  selectedDay,
  today,
  mode,
  showCourseMarkers,
  onModeChange,
  onSelectDate,
  onMoveRange,
  onMonthRangeChange,
}: {
  from: string
  to: string
  semesterStart: string
  semesterEnd: string
  days: Array<Pick<TimetableDay, "date" | "weekday" | "week_number">>
  scheduleDays: Array<Pick<TimetableDay, "date" | "rows" | "week_number">>
  selectedDate: string | null
  selectedDay?: Pick<TimetableDay, "date" | "week_number">
  today: string
  mode: ScheduleMode
  showCourseMarkers: boolean
  onModeChange: (mode: ScheduleMode) => void
  onSelectDate: (date: string) => void
  onMoveRange: (days: number) => void
  onMonthRangeChange: (range: { from: string; to: string } | null) => void
}) {
  const selected = selectedDate ?? selectedDay?.date ?? from
  const [monthCalendarOpen, setMonthCalendarOpen] = useState(false)
  const [calendarResizing, setCalendarResizing] = useState(false)
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(parseISO(selected)))
  const [compactStart, setCompactStart] = useState(() =>
    dateString(startOfWeek(parseISO(selected), { weekStartsOn: 1 })),
  )
  const lastSelected = useRef(selected)
  const [, refreshScheduleMarkers] = useState(0)
  const scheduleDaysRef = useRef(scheduleDays)
  const frozenScheduleDays = useRef(scheduleDays)
  const calendarInteracting = useRef(false)
  const selectDateRef = useRef(onSelectDate)
  const modeChangeRef = useRef(onModeChange)
  scheduleDaysRef.current = scheduleDays
  selectDateRef.current = onSelectDate
  modeChangeRef.current = onModeChange

  const handleCalendarInteraction = useCallback((active: boolean) => {
    if (calendarInteracting.current === active) return
    if (active) frozenScheduleDays.current = scheduleDaysRef.current
    calendarInteracting.current = active
    if (!active) refreshScheduleMarkers((revision) => revision + 1)
  }, [])
  const selectMonthDate = useCallback((date: string) => {
    selectDateRef.current(date)
    modeChangeRef.current("day")
  }, [])

  useEffect(() => {
    if (lastSelected.current === selected) return
    lastSelected.current = selected
    const date = parseISO(selected)
    const start = parseISO(compactStart)
    if (
      !isSameMonth(date, visibleMonth) &&
      (!monthCalendarOpen ||
        isBefore(date, startOfWeek(startOfMonth(visibleMonth), { weekStartsOn: 1 })) ||
        isAfter(date, endOfWeek(endOfMonth(visibleMonth), { weekStartsOn: 1 })))
    ) {
      setVisibleMonth(startOfMonth(date))
    }
    if (isBefore(date, start) || isAfter(date, addDays(start, 13))) {
      setCompactStart(dateString(startOfWeek(date, { weekStartsOn: 1 })))
    }
  }, [compactStart, monthCalendarOpen, selected, visibleMonth])

  const selectedScheduleDay = scheduleDays.find((day) => day.date === selected)
  const weekNumber =
    selectedScheduleDay?.week_number ?? selectedDay?.week_number ?? days[0]?.week_number
  const rangeWeekNumbers = Array.from(
    new Set(days.map((day) => day.week_number).filter((value) => value > 0)),
  ).sort((a, b) => a - b)
  const rangeWeekLabel =
    rangeWeekNumbers.length > 1
      ? `第${rangeWeekNumbers[0]}—${rangeWeekNumbers.at(-1)}周`
      : `第${rangeWeekNumbers[0] ?? weekNumber ?? "—"}周`
  const dateLabel =
    mode === "week"
      ? `${format(parseISO(from), "M月d日")}—${format(parseISO(to), "M月d日")} · ${rangeWeekLabel}`
      : `${format(parseISO(selected), "M月d日 EEE", { locale: zhCN })} · 第${weekNumber ?? "—"}周`
  const previousWeekDisabled = !isAfter(parseISO(from), parseISO(semesterStart))
  const nextWeekDisabled = !isBefore(parseISO(to), parseISO(semesterEnd))
  const calendarMonths = useMemo(
    () =>
      ([-1, 0, 1] as const).map((offset) => {
        const anchor = addDays(parseISO(compactStart), monthCalendarOpen ? 0 : offset * 7)
        const month = monthCalendarOpen
          ? addMonths(visibleMonth, offset)
          : offset === 0
            ? visibleMonth
            : startOfMonth(anchor)
        const monthStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
        const monthEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 })
        const panelStart = monthCalendarOpen && offset !== 0 ? monthStart : anchor
        // Keep both compact weeks in this same grid, including a trailing week across months.
        const gridStart = isBefore(panelStart, monthStart) ? panelStart : monthStart
        const compactEnd = addDays(panelStart, 13)
        const gridEnd = isAfter(compactEnd, monthEnd) ? compactEnd : monthEnd
        const gridDays = eachDayOfInterval({ start: gridStart, end: gridEnd })
        return {
          month,
          days: gridDays,
          compactRow: gridDays.findIndex((date) => dateString(date) === dateString(panelStart)) / 7,
          monthRow: gridDays.findIndex((date) => dateString(date) === dateString(monthStart)) / 7,
          monthRowCount: eachDayOfInterval({ start: monthStart, end: monthEnd }).length / 7,
        }
      }),
    [compactStart, monthCalendarOpen, visibleMonth],
  )
  const displayedScheduleDays = calendarInteracting.current
    ? frozenScheduleDays.current
    : scheduleDays
  const scheduleByDate = useMemo(
    () => new Map(displayedScheduleDays.map((day) => [day.date, day.rows])),
    [displayedScheduleDays],
  )
  const monthRowCount = calendarMonths[1].monthRowCount
  const visibleMonthDays = calendarMonths[1].days.slice(
    calendarMonths[1].monthRow * 7,
    (calendarMonths[1].monthRow + monthRowCount) * 7,
  )
  const calendarState = mode === "week" ? "closed" : monthCalendarOpen ? "month" : "week"
  const previousMonthDisabled = isBefore(
    endOfMonth(addMonths(visibleMonth, -1)),
    parseISO(semesterStart),
  )
  const nextMonthDisabled = isAfter(startOfMonth(addMonths(visibleMonth, 1)), parseISO(semesterEnd))
  const todayDate = parseISO(today)
  const canReturnToToday =
    !isBefore(todayDate, parseISO(semesterStart)) && !isAfter(todayDate, parseISO(semesterEnd))
  const todayInView = monthCalendarOpen
    ? visibleMonthDays.some((date) => dateString(date) === today)
    : today >= compactStart && today <= dateString(addDays(parseISO(compactStart), 13))
  const showReturnToToday = canReturnToToday && !todayInView
  const compactPreviousDisabled = !isAfter(parseISO(compactStart), parseISO(semesterStart))
  const compactNextDisabled = !isBefore(addDays(parseISO(compactStart), 13), parseISO(semesterEnd))
  const calendarPager = useInterruptibleSwipePager({
    pageKey: `${mode}:${monthCalendarOpen ? "month" : "week"}:${format(visibleMonth, "yyyy-MM")}:${compactStart}`,
    previousDisabled: monthCalendarOpen ? previousMonthDisabled : compactPreviousDisabled,
    nextDisabled: monthCalendarOpen ? nextMonthDisabled : compactNextDisabled,
    onMove: (direction) => {
      if (monthCalendarOpen) {
        const month = addMonths(visibleMonth, direction)
        setVisibleMonth(month)
        setCompactStart(
          dateString(
            startOfWeek(isSameMonth(parseISO(selected), month) ? parseISO(selected) : month, {
              weekStartsOn: 1,
            }),
          ),
        )
      } else {
        const start = addDays(parseISO(compactStart), direction * 7)
        const selectedInView =
          selected >= compactStart && selected <= dateString(addDays(parseISO(compactStart), 13))
        const moved = selectedInView ? addDays(parseISO(selected), direction * 7) : start
        const date = isBefore(moved, parseISO(semesterStart))
          ? semesterStart
          : isAfter(moved, parseISO(semesterEnd))
            ? semesterEnd
            : dateString(moved)
        const month = startOfMonth(parseISO(date))
        setCompactStart(dateString(start))
        setVisibleMonth(month)
        onSelectDate(date)
      }
    },
    onInteractionChange: handleCalendarInteraction,
  })
  const gridFrom = dateString(visibleMonthDays[0])
  const gridTo = dateString(visibleMonthDays.at(-1)!)

  useEffect(() => {
    if (!showCourseMarkers || mode !== "day") {
      onMonthRangeChange(null)
      return
    }
    const gridStart = parseISO(monthCalendarOpen ? gridFrom : compactStart)
    const gridEnd = monthCalendarOpen ? parseISO(gridTo) : addDays(gridStart, 13)
    const start = isBefore(gridStart, parseISO(semesterStart)) ? parseISO(semesterStart) : gridStart
    const end = isAfter(gridEnd, parseISO(semesterEnd)) ? parseISO(semesterEnd) : gridEnd
    onMonthRangeChange({ from: dateString(start), to: dateString(end) })
  }, [
    compactStart,
    gridFrom,
    gridTo,
    mode,
    monthCalendarOpen,
    onMonthRangeChange,
    semesterEnd,
    semesterStart,
    showCourseMarkers,
  ])

  function changeView(nextMode: ScheduleMode) {
    if (nextMode === mode) return
    const date = isBefore(todayDate, parseISO(semesterStart))
      ? semesterStart
      : isAfter(todayDate, parseISO(semesterEnd))
        ? semesterEnd
        : today
    setMonthCalendarOpen(false)
    setVisibleMonth(startOfMonth(parseISO(date)))
    setCompactStart(dateString(startOfWeek(parseISO(date), { weekStartsOn: 1 })))
    onSelectDate(date)
    onModeChange(nextMode)
  }

  function toggleMonthCalendar() {
    setCalendarResizing(true)
    setMonthCalendarOpen((open) => !open)
  }

  function returnToToday() {
    setVisibleMonth(startOfMonth(todayDate))
    setCompactStart(dateString(startOfWeek(todayDate, { weekStartsOn: 1 })))
    onSelectDate(today)
    onModeChange("day")
  }

  return (
    <section
      className={cn("date-controls", mode === "week" && "week-mode")}
      aria-label="日期和视图"
    >
      <div className="date-toolbar">
        <div className={cn("date-range-control", mode === "week" && "with-week-navigation")}>
          {mode === "week" ? (
            <button
              type="button"
              className="week-nav-button"
              aria-label="查看上一周"
              disabled={previousWeekDisabled}
              onClick={() => onMoveRange(-7)}
            >
              <ChevronLeft />
            </button>
          ) : null}
          <label className="date-picker-label">
            <strong>{dateLabel}</strong>
            <input
              type="date"
              value={selected}
              min={semesterStart}
              max={semesterEnd}
              onChange={(event) => onSelectDate(event.target.value)}
              aria-label={mode === "week" ? "选择日期并跳转到所在周" : "选择日期"}
            />
          </label>
          {mode === "week" ? (
            <button
              type="button"
              className="week-nav-button"
              aria-label="查看下一周"
              disabled={nextWeekDisabled}
              onClick={() => onMoveRange(7)}
            >
              <ChevronRight />
            </button>
          ) : null}
        </div>
        <div className="date-toolbar-actions">
          {mode === "day" && showReturnToToday ? (
            <button
              type="button"
              className="return-today-button"
              aria-label={`回到今天，${format(todayDate, "M月d日")}`}
              onClick={returnToToday}
            >
              回到今天
            </button>
          ) : null}
          <div className="view-tabs" role="tablist" aria-label="课表显示方式">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "day"}
              className={cn(mode === "day" && "active")}
              onClick={() => changeView("day")}
            >
              日
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "week"}
              className={cn(mode === "week" && "active")}
              onClick={() => changeView("week")}
            >
              周
            </button>
          </div>
        </div>
      </div>

      <div
        className="calendar-viewport t-resize"
        data-calendar-state={calendarState}
        data-resizing={calendarResizing}
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget && event.propertyName === "height")
            setCalendarResizing(false)
        }}
        style={{ "--month-row-count": monthRowCount } as React.CSSProperties}
      >
        <div
          id="teacher-month-calendar"
          className="calendar-view"
          aria-hidden={calendarState === "closed"}
          inert={calendarState === "closed"}
        >
          <div
            className="month-toolbar-clip"
            aria-hidden={!monthCalendarOpen}
            inert={!monthCalendarOpen}
          >
            <div className="month-calendar-toolbar">
              <button
                type="button"
                aria-label="查看上个月"
                disabled={previousMonthDisabled}
                onClick={() => calendarPager.go(-1)}
              >
                <ChevronLeft />
              </button>
              <div className="month-calendar-heading">
                <FlippingMonthTitle month={visibleMonth} />
                {showCourseMarkers ? (
                  <span className="course-marker-legend" aria-label="课程标记图例">
                    <span className="morning">
                      <i />
                      上午
                    </span>
                    <span className="afternoon">
                      <i />
                      下午
                    </span>
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="查看下个月"
                disabled={nextMonthDisabled}
                onClick={() => calendarPager.go(1)}
              >
                <ChevronRight />
              </button>
            </div>
          </div>
          <div className="month-weekdays" aria-hidden="true">
            {weekdayShort.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>
          <div ref={calendarPager.viewportRef} className="calendar-swipe-window month-swipe-window">
            <div ref={calendarPager.trackRef} className="calendar-swipe-track">
              <CalendarMonthPanels
                calendarMonths={calendarMonths}
                expanded={monthCalendarOpen}
                scheduleByDate={scheduleByDate}
                selected={selected}
                today={today}
                semesterStart={semesterStart}
                semesterEnd={semesterEnd}
                showCourseMarkers={showCourseMarkers}
                onSelectDate={selectMonthDate}
              />
            </div>
          </div>
        </div>
      </div>

      {mode === "day" ? (
        <button
          type="button"
          className="calendar-handle"
          data-open={monthCalendarOpen}
          aria-expanded={monthCalendarOpen}
          aria-controls="teacher-month-calendar"
          aria-label={monthCalendarOpen ? "收起月历" : "展开月历"}
          title={monthCalendarOpen ? "收起月历" : "展开月历"}
          onClick={toggleMonthCalendar}
        >
          <ChevronDown />
        </button>
      ) : null}
    </section>
  )
}

function lessonGroups(rows: TimetableRow[]) {
  const lessons = activeRows(rows).sort((a, b) => a.item_sort_order - b.item_sort_order)
  return {
    morning: lessons.filter((row) => row.start_time < "12:00:00"),
    afternoon: lessons.filter((row) => row.start_time >= "12:00:00"),
  }
}

function CourseMarkers({ rows }: { rows: TimetableRow[] }) {
  const { morning, afternoon } = lessonGroups(rows)
  if (!morning.length && !afternoon.length) return null

  return (
    <span className="course-markers" aria-hidden="true">
      {morning.length ? (
        <span className="course-marker-group morning">
          {morning.map((row) => (
            <i key={row.key} />
          ))}
        </span>
      ) : null}
      {afternoon.length ? (
        <span className="course-marker-group afternoon">
          {afternoon.map((row) => (
            <i key={row.key} />
          ))}
        </span>
      ) : null}
    </span>
  )
}

function DaySchedule({
  day,
  days,
  context,
  today,
  now,
}: {
  day?: TimetableDay & { accessible?: boolean }
  days: Array<TimetableDay & { accessible?: boolean }>
  context: string
  today: string
  now: Date
}) {
  if (!day) {
    return <EmptyState title="当天没有课程" description="可以切换日期查看其他安排" />
  }
  if (day.accessible === false) {
    return (
      <EmptyState
        title="该日期不在有效任课范围"
        description="长期任课关系已经变化，请选择仍有权限的日期"
      />
    )
  }

  const rows = [...day.rows].sort((a, b) => a.item_sort_order - b.item_sort_order)
  const actualRows = activeRows(rows)
  const isMine = context === "mine"
  const isToday = day.date === today
  const attentionRow = isMine && isToday ? nextRowForToday(actualRows, now) : undefined

  if (!rows.length) {
    const upcoming = findNextLesson(days, day.date)
    return (
      <EmptyState
        title={day.date === today ? "今天没有课程" : "当天没有课程"}
        description="可以切换日期查看其他安排"
        upcoming={upcoming}
      />
    )
  }

  return (
    <>
      <div className="schedule-summary">
        <strong>
          {isToday ? "今天" : format(parseISO(day.date), "M月d日")} 共 <b>{actualRows.length}</b> 节
        </strong>
      </div>
      <div className="lesson-list">
        {(["morning", "afternoon"] as const).map((period) => {
          const periodRows = rows.filter((row) =>
            period === "morning" ? row.start_time < "12:00:00" : row.start_time >= "12:00:00",
          )
          if (!periodRows.length) return null
          const label = period === "morning" ? "上午" : "下午"
          return (
            <section
              className={cn("lesson-period-group", period)}
              key={period}
              aria-label={`${label}课程`}
            >
              <h3 className="lesson-period-heading">
                <span>
                  <i aria-hidden="true" />
                  {label}
                </span>
              </h3>
              {periodRows.map((row) => {
                const timing = lessonTiming(row, now)
                const attention =
                  row.key === attentionRow?.key
                    ? {
                        label: timing === "ongoing" ? "正在上课" : "下一节",
                        hint: timing === "upcoming" ? lessonStartHint(row, now) : undefined,
                      }
                    : undefined
                return (
                  <LessonRow
                    key={row.key}
                    row={row}
                    showTeachers={!isMine}
                    completed={timing === "completed"}
                    attention={attention}
                  />
                )
              })}
            </section>
          )
        })}
      </div>
    </>
  )
}

function WeekSchedule({
  days,
  context,
  today,
  now,
  onSelectDay,
}: {
  days: Array<TimetableDay & { accessible?: boolean }>
  context: string
  today: string
  now: Date
  onSelectDay: (date: string) => void
}) {
  const isMine = context === "mine"
  const total = days.reduce((sum, day) => sum + activeRows(day.rows).length, 0)
  const adjusted = days.reduce(
    (sum, day) => sum + day.rows.filter((row) => rowStatus(row) !== null).length,
    0,
  )
  const visibleDays = days.filter((day) => day.rows.length > 0 || day.date === today)

  if (!visibleDays.length) {
    return <EmptyState title="本周没有课程" description="可左右滑动，或使用顶部箭头查看其他周" />
  }

  return (
    <>
      <div className="week-summary">
        <strong>
          本周共 <b>{total}</b> 节
        </strong>
        {adjusted ? (
          <span>
            调整 {adjusted} · 代课 {replacementCount(days)}
          </span>
        ) : null}
      </div>
      <div className="week-groups">
        {visibleDays.map((day) => (
          <section
            className="week-group"
            key={day.date}
            aria-label={format(parseISO(day.date), "M月d日 EEEE", { locale: zhCN })}
          >
            <button
              type="button"
              className="week-group-title"
              aria-current={day.date === today ? "date" : undefined}
              aria-label={`查看${format(parseISO(day.date), "M月d日 EEEE", { locale: zhCN })}的日课表`}
              onClick={() => onSelectDay(day.date)}
            >
              <strong>
                {format(parseISO(day.date), "EEE M月d日", { locale: zhCN })}
                {day.date === today ? <span className="week-today-label">今天</span> : null}
              </strong>
              <span className="week-group-link">
                <span>{activeRows(day.rows).length} 节</span>
                <ChevronRight />
              </span>
            </button>
            {day.accessible === false ? (
              <p className="week-no-access">该日不在有效任课范围</p>
            ) : day.rows.length ? (
              <div className="compact-lessons">
                {[...day.rows]
                  .sort((a, b) => a.item_sort_order - b.item_sort_order)
                  .map((row) => (
                    <LessonRow
                      key={row.key}
                      row={row}
                      showTeachers={!isMine}
                      completed={lessonTiming(row, now) === "completed"}
                      compact
                    />
                  ))}
              </div>
            ) : (
              <p className="week-no-access">无课程</p>
            )}
          </section>
        ))}
      </div>
    </>
  )
}

function LessonRow({
  row,
  showTeachers,
  compact = false,
  completed = false,
  attention,
}: {
  row: TimetableRow
  showTeachers: boolean
  compact?: boolean
  completed?: boolean
  attention?: { label: string; hint?: string }
}) {
  const status = rowStatus(row)
  const inactive = row.duty_status === "removed" || row.is_cancelled
  const ended = completed && !inactive
  const metadata = showTeachers
    ? `${row.teacher_names.join("、")} · ${row.room_name}`
    : `${row.target_name} · ${row.room_name}`
  return (
    <article
      className={cn(
        "lesson-row",
        compact && "compact",
        inactive && "inactive",
        ended && "completed",
        attention && "attention",
      )}
    >
      {attention ? (
        <small className="lesson-attention">
          <b>{attention.label}</b>
          {attention.hint ? <span>{attention.hint}</span> : null}
        </small>
      ) : null}
      <div className="lesson-time">
        <time>
          {row.start_time.slice(0, 5)}
          {!compact ? `–${row.end_time.slice(0, 5)}` : ""}
        </time>
        {ended ? <span className="lesson-ended">已结束</span> : null}
      </div>
      <div className="lesson-main">
        <strong>{row.course_name}</strong>
        <span>{metadata}</span>
      </div>
      {status ? <StatusTag label={status.label} /> : null}
    </article>
  )
}

function StatusTag({ label }: { label: string }) {
  const tone = label.includes("代课")
    ? "substitute"
    : label.includes("停") || label.includes("取消") || label.includes("调出")
      ? "cancelled"
      : label.includes("临时") || label.includes("调入")
        ? "temporary"
        : "adjusted"
  return <span className={`status-tag ${tone}`}>{label}</span>
}

function EmptyState({
  title,
  description,
  upcoming,
}: {
  title: string
  description: string
  upcoming?: { day: TimetableDay; row: TimetableRow }
}) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{description}</p>
      {upcoming ? (
        <div className="next-upcoming">
          <span>下一次上课</span>
          <strong>
            {format(parseISO(upcoming.day.date), "M月d日 EEE", { locale: zhCN })} ·{" "}
            {upcoming.row.start_time.slice(0, 5)}
          </strong>
          <b>{upcoming.row.course_name}</b>
          <small>
            {upcoming.row.target_name} · {upcoming.row.room_name}
          </small>
        </div>
      ) : null}
    </div>
  )
}

function ErrorState({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="error-state">
      <AlertCircle />
      <h2>课表加载失败</h2>
      <p>{apiMessage(error)}</p>
      <button type="button" onClick={retry}>
        重新加载
      </button>
    </div>
  )
}

function nextRowForToday(rows: TimetableRow[], now: Date) {
  return (
    rows.find((row) => lessonTiming(row, now) === "ongoing") ??
    rows.find((row) => lessonTiming(row, now) === "upcoming")
  )
}

function findNextLesson(days: Array<TimetableDay & { accessible?: boolean }>, afterDate: string) {
  for (const day of days) {
    if (day.date <= afterDate || day.accessible === false) continue
    const row = activeRows(day.rows)[0]
    if (row) return { day, row }
  }
  return undefined
}

function replacementCount(days: TimetableDay[]) {
  return days.reduce(
    (sum, day) => sum + day.rows.filter((row) => row.duty_status === "added").length,
    0,
  )
}

function nextRangeForEmptyDay(
  timetable: TeacherTimetable | TeacherClassTimetable | undefined,
  selectedDay: (TimetableDay & { accessible?: boolean }) | undefined,
  mode: ScheduleMode,
  context: string,
) {
  if (
    !timetable ||
    !selectedDay ||
    mode !== "day" ||
    context !== "mine" ||
    selectedDay.rows.length > 0 ||
    timetable.days.some((day) => day.date > selectedDay.date && activeRows(day.rows).length > 0)
  ) {
    return null
  }

  const semesterEnd = parseISO(timetable.semester.end_date)
  const from = addDays(parseISO(timetable.to), 1)
  if (isAfter(from, semesterEnd)) return null
  const candidateTo = addDays(from, 6)
  const to = isAfter(candidateTo, semesterEnd) ? semesterEnd : candidateTo
  return { from: dateString(from), to: dateString(to) }
}

function daysFromRange(from: string, to: string) {
  return eachDayOfInterval({ start: parseISO(from), end: parseISO(to) }).map((date) => ({
    date: dateString(date),
    weekday: Number(format(date, "i")),
    week_number: 0,
  }))
}

function TimetableLoading() {
  return (
    <main className="teacher-page">
      <div className="teacher-shell timetable-shell loading-shell">
        <div className="loading-header" />
        <div className="loading-line wide" />
        <div className="loading-dates">
          {Array.from({ length: 7 }, (_, index) => (
            <span key={index} />
          ))}
        </div>
        <div className="loading-card" />
        <div className="loading-line" />
        <div className="loading-rows">
          {Array.from({ length: 3 }, (_, index) => (
            <span key={index} />
          ))}
        </div>
      </div>
    </main>
  )
}
