import { signOut } from "@/app/actions/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { getDataSource } from "@/lib/config";

export async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <form action={signOut} className="flex items-center gap-2">
      <span className="max-w-32 truncate text-sm text-muted">
        {getDataSource() === "mock" ? "데모: " : ""}
        {user.displayName}
      </span>
      <button type="submit" className="min-h-9 rounded-lg px-2.5 text-sm font-semibold hover:bg-sunken">
        로그아웃
      </button>
    </form>
  );
}
