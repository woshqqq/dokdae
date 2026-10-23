import { Tokens } from "@/components/ui/token";

export function BalanceChange({ balance, delta, label }: { balance: number; delta: number; label: string }) {
  const after = balance - delta;
  const short = after < 0;
  return (
    <dl className="grid grid-cols-3 items-center rounded-2xl bg-sunken px-4 py-3 text-center">
      <div>
        <dt className="text-xs text-muted">현재 잔액</dt>
        <dd className="mt-1">
          <Tokens amount={balance} className="text-lg" />
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted">{label}</dt>
        <dd className="mt-1 text-lg font-semibold tabular-nums">−{delta}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted">이후 잔액</dt>
        <dd className={short ? "mt-1 text-lg font-bold text-danger" : "mt-1"}>
          {short ? "부족" : <Tokens amount={after} className="text-lg" />}
        </dd>
      </div>
    </dl>
  );
}
