import { Suspense } from "react";
import { NoAccess } from "@/components/dd/no-access";
import { QuestionsEditor } from "@/components/dd/questions-editor";
import { PageHeader, PageSkeleton } from "@/components/page";
import { defaultNumbers, getMyQuestions } from "@/lib/dd/queries";
import { getViewer } from "@/lib/dd/session";

export default function QuestionsPage({ params }: PageProps<"/room/[roomId]/questions">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Questions params={params} />
    </Suspense>
  );
}

async function Questions({ params }: Pick<PageProps<"/room/[roomId]/questions">, "params">) {
  const { roomId } = await params;
  const viewer = await getViewer(roomId);
  if (!viewer) return <NoAccess />;
  const data = await getMyQuestions(viewer);
  const numbers = defaultNumbers(data.questions);
  return (
    <div className="space-y-6">
      <PageHeader title="질문과 답변" back={{ href: `/room/${roomId}`, label: "방으로" }} />
      <QuestionsEditor
        roomId={roomId}
        total={data.total}
        min={data.min_questions}
        ready={data.ready}
        questions={data.questions.map((q) => ({ ...q, number: numbers.get(q.id) }))}
      />
    </div>
  );
}
