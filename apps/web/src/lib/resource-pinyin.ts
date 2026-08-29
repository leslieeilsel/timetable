import { pinyin } from "pinyin-pro"

export function resourcePinyin(value: string) {
  const full = pinyin(value, { toneType: "none" })
  const compact = full.replaceAll(" ", "")
  const initials = pinyin(value, {
    toneType: "none",
    pattern: "first",
    separator: "",
  })
  return `${full} ${compact} ${initials}`
}
