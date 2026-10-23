/** "12분", "1시간 5분" 같은 남은 시간 표기. 이미 지났으면 "곧" */
export function formatRemaining(untilIso: string, now = Date.now()) {
  const minutes = Math.ceil((new Date(untilIso).getTime() - now) / 60_000);
  if (minutes <= 0) return "곧";
  if (minutes < 60) return `${minutes}분`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 24) return m ? `${h}시간 ${m}분` : `${h}시간`;
  return `${Math.floor(h / 24)}일`;
}

export function formatTime(iso: string) {
  return new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(iso));
}
