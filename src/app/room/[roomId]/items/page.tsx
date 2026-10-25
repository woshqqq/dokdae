import { Suspense } from "react";
import { ItemsEditor } from "@/components/dd/items-editor";
import { NoAccess } from "@/components/dd/no-access";
import { PageHeader, PageSkeleton } from "@/components/page";
import { Card, EmptyState, Section } from "@/components/ui/card";
import { getDefaultQuestions, getMyItems, getMyTransactions, getOverview, type Transaction } from "@/lib/dd/queries";
import { getViewer } from "@/lib/dd/session";
import { formatTime } from "@/lib/format";

export default function ItemsPage({ params }: PageProps<"/room/[roomId]/items">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Items params={params} />
    </Suspense>
  );
}

const TX_LABEL: Record<Transaction["type"], string> = { initial_grant: "처음 받은 토큰", unlock_payment: "항목 열람", reward: "보상" };

async function Items({ params }: Pick<PageProps<"/room/[roomId]/items">, "params">) {
  const { roomId } = await params;
  const viewer = await getViewer(roomId);
  if (!viewer) return <NoAccess />;
  const [data, overview, transactions, questions] = await Promise.all([
    getMyItems(viewer),
    getOverview(viewer),
    getMyTransactions(viewer),
    getDefaultQuestions(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="내 항목" back={{ href: `/room/${roomId}`, label: overview.room.name }} />
      <ItemsEditor roomId={roomId} data={data} balance={overview.balance} questions={questions} />

      <Section title="토큰 내역">
        {transactions.length === 0 ? (
          <EmptyState title="아직 내역이 없어요" />
        ) : (
          <Card>
            <ul className="divide-y divide-line text-sm">
              {transactions.map((t, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="font-semibold">{TX_LABEL[t.type]}</span>
                    {t.counterpart ? <span className="text-muted"> · {t.counterpart}</span> : null}
                    <span className="block text-xs text-muted">{formatTime(t.created_at)}</span>
                  </span>
                  <span className={`shrink-0 font-bold tabular-nums ${t.direction === "in" ? "text-success" : "text-danger"}`}>
                    {t.direction === "in" ? "+" : "−"}
                    {t.amount}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Section>
    </div>
  );
}
