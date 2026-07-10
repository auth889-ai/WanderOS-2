import { DollarSign, TrendingUp } from "lucide-react";

type BudgetLine = {
  category: string;
  amount: number;
  reason?: string;
};

function asBudgetLines(context: Record<string, unknown>): BudgetLine[] {
  const plan = context.budgetPlan as { allocations?: BudgetLine[] } | undefined;
  return Array.isArray(plan?.allocations) ? plan.allocations : [];
}

function budgetFit(context: Record<string, unknown>) {
  const plan = context.budgetPlan as { budgetFit?: string; totalEstimate?: number; currency?: string } | undefined;
  return {
    fit: plan?.budgetFit || "unknown",
    total: Number(plan?.totalEstimate || 0),
    currency: plan?.currency || "USD"
  };
}

export function BudgetPanel({ context }: { context: Record<string, unknown> }) {
  const lines = asBudgetLines(context);
  const summary = budgetFit(context);
  const max = Math.max(...lines.map((line) => Number(line.amount || 0)), 1);

  return (
    <section className="rounded-[8px] border border-[#f2cfb0] bg-[#fffaf2]/95 p-4 text-[#4b4038] shadow-[0_18px_40px_rgba(50,31,18,0.18)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d87562]">Budget</p>
          <h2 className="mt-1 text-lg font-semibold text-[#4a4038]">{summary.total ? `${summary.currency} ${summary.total.toLocaleString()}` : "Estimate pending"}</h2>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-[#f2cfb0] bg-[#fff3e6]">
          <DollarSign className="h-4 w-4 text-[#d87562]" />
        </div>
      </div>
      <p className="mt-2 inline-flex items-center gap-2 rounded-[8px] border border-[#f2cfb0] bg-[#fff3e6] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#8b6d58]">
        <TrendingUp className="h-3.5 w-3.5" /> {summary.fit.replace("_", " ")}
      </p>
      <div className="mt-4 space-y-3">
        {lines.map((line) => {
          const amount = Number(line.amount || 0);
          return (
            <div key={line.category}>
              <div className="flex items-center justify-between text-sm">
                <span className="capitalize text-[#806958]">{line.category}</span>
                <span className="font-semibold text-[#4a4038]">{amount.toLocaleString()}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#f5dfcc]">
                <div className="h-full rounded-full bg-[#ff806e]" style={{ width: `${Math.max(5, (amount / max) * 100)}%` }} />
              </div>
            </div>
          );
        })}
        {!lines.length ? <p className="text-sm text-[#856b59]">Budget lines appear after the planner finishes.</p> : null}
      </div>
    </section>
  );
}
