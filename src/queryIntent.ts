/** A date alone is not enough to route a knowledge question into the calendar. */
export function isCalendarIntent(
  text: string,
  remainingTerms: string,
): boolean {
  if (!remainingTerms.trim()) return true;
  if (
    /(?:日程|日历|行程|事项|待办|安排|预约|提醒|\b(?:calendar|agenda|schedule|appointments?)\b)/i.test(
      text,
    )
  )
    return true;
  if (
    /(?:文档|记录|纪要|发布说明|版本|原理|如何|为什么|检索|文献|说明书)/.test(
      text,
    )
  )
    return false;
  return /(?:会议|开会|评审|面试|培训|活动|\bmeetings?\b)/i.test(text);
}
