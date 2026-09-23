import { CheckIcon } from "lucide-react"
import type { Course } from "@/lib/types"
import {
  courseColorName,
  courseColors,
  courseColorStyle,
  recommendCourseColor,
} from "@/lib/course-colors"
import { Button } from "@/components/ui/button"

export function CourseColorPicker({
  value,
  onChange,
  courseId,
  name,
  courses,
}: {
  value: string
  onChange: (color: string) => void
  courseId?: number
  name: string
  courses: Course[]
}) {
  const others = courses.filter((course) => course.id !== courseId && course.is_active)
  const color = value || recommendCourseColor(others)
  const shared = others.filter((course) => course.color === color)
  return (
    <fieldset className="min-w-0 space-y-3">
      <legend className="text-sm font-medium">
        课表颜色{" "}
        <span className="ml-2 font-normal text-muted-foreground">{courseColorName(color)}</span>
      </legend>
      <div className="flex flex-wrap gap-2">
        {courseColors.map((item) => (
          <label key={item.value} className="relative cursor-pointer" title={item.label}>
            <input
              type="radio"
              className="peer sr-only"
              name="course-color"
              value={item.value}
              aria-label={item.label}
              checked={color === item.value}
              onChange={() => onChange(item.value)}
            />
            <span
              className="course-color-dot flex size-8 items-center justify-center rounded-full border-4 border-background text-white ring-1 ring-border peer-checked:ring-2 peer-checked:ring-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring"
              style={courseColorStyle({ color: item.value })}
            >
              {color === item.value && <CheckIcon aria-hidden="true" className="size-3.5" />}
            </span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <div
          className="course-color-card timetable-lesson min-w-0 flex-1 text-sm"
          style={courseColorStyle({ color })}
        >
          <span className="block truncate font-medium">{name.trim() || "课程名称"}</span>
          <span className="text-xs text-muted-foreground">课表显示预览</span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange(courseId ? recommendCourseColor(others) : "")}
        >
          自动推荐
        </Button>
      </div>
      <p className="text-xs leading-5 text-muted-foreground" role="status">
        {shared.length
          ? `此颜色也用于${shared.map((course) => `“${course.name}”`).join("、")}。可以保留，或选择其他颜色。`
          : value
            ? "所有课表视图使用同一颜色，修改名称后保持不变。"
            : "保存时自动分配，优先使用尚未占用的颜色。"}
      </p>
    </fieldset>
  )
}
