import { signOut } from "@/app/actions/auth";
import { getAuthContext, getCurrentUser } from "@/lib/auth/session";

export async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) return null;
  const { kind } = await getAuthContext();
  return (
    <form action={signOut} className="flex items-center gap-2">
      <span className="max-w-32 truncate text-sm text-muted">
        {kind === "test" ? "테스트: " : kind === "mock" ? "데모: " : ""}
        {user.displayName}
      </span>
      <button type="submit" className="min-h-9 rounded-lg px-2.5 text-sm font-semibold hover:bg-sunken">
        {kind === "test" ? "사용자 전환" : "로그아웃"}
      </button>
    </form>
  );
}
