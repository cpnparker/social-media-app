/**
 * The single entry point the chat tool calls, and the formatter that renders
 * its result for the model.
 *
 * `queryResourcing()` NEVER THROWS. That is the whole point of it existing
 * separately from reports.ts. The four provider executors each wrap their tool
 * call in a try/catch that pushes a bare `"... error: <message>"` string, which
 * bypasses the formatter entirely — so a thrown error arrives in the model's
 * context with no provenance header, no units line, and none of the "do not
 * invent figures" framing. The single most likely production failure here is a
 * renamed Airtable column, which assertFields raises as a throw. Left
 * unhandled, the most likely failure would get the worst possible presentation.
 */
import {
  capacityReport,
  horizonReport,
  clientPlanVsActualReport,
  contractHealthReport,
  monthlyOutlookReport,
  type ReportResult,
} from "./reports";
import { airtableConfigured } from "./client";

export const RESOURCING_REPORTS = ["capacity", "monthly_outlook", "horizon", "client_plan_vs_actual", "contract_health"] as const;
export type ResourcingReport = (typeof RESOURCING_REPORTS)[number];

export interface ResourcingArgs {
  report?: string;
  month?: string;
  person?: string;
  client?: string;
  ending_within_days?: number;
  include_ended?: boolean;
  /** capacity: which allocation plan. horizon: which demand basis. */
  basis?: string;
  /** horizon: how many months ahead. */
  months?: number;
}

export type ResourcingOutcome =
  | { ok: true; result: ReportResult<unknown> }
  | { ok: false; error: string; kind: "config" | "input" | "schema" | "infra" };

type FailureKind = "config" | "input" | "schema" | "infra";

/** Classify a failure so the formatter can say what to do about it. */
function classify(message: string): FailureKind {
  if (/is missing expected field|no longer exists in the base|unexpected type/i.test(message)) return "schema";
  // "The plan has no row for March 2028" is a fact about the data, not a
  // fault. Classified as infra it was rendered to the model as "the resourcing
  // base could not be reached" — turning a correct, specific answer into a
  // false report that a healthy system was down.
  if (
    /not a month I can resolve|Nobody matching|No contract matching|has no ".*" option|has no row for|No figures are available/i.test(
      message
    )
  ) {
    return "input";
  }
  return "infra";
}

export async function queryResourcing(args: ResourcingArgs): Promise<ResourcingOutcome> {
  if (!airtableConfigured()) {
    return {
      ok: false,
      kind: "config",
      error: "The resourcing base is not connected on this server (AIRTABLE_PAT / AIRTABLE_RESOURCING_BASE are unset).",
    };
  }

  // String(), not .trim() on a possibly-non-string. The tool arguments are
  // model output parsed from JSON, so `report` can arrive as a number, null,
  // or an object, and `args` itself can be a non-object. `(args.report ||
  // "").trim()` threw a TypeError on all of those — straight out of a function
  // the four executors deliberately left unguarded on the strength of the
  // promise above.
  const report = String((args as ResourcingArgs | null)?.report ?? "").trim() as ResourcingReport;
  if (!RESOURCING_REPORTS.includes(report)) {
    return {
      ok: false,
      kind: "input",
      error: `Unknown report "${report || "(none given)"}". Available: ${RESOURCING_REPORTS.join(", ")}.`,
    };
  }

  try {
    switch (report) {
      case "capacity":
        return {
          ok: true,
          result: await capacityReport({
            month: args.month,
            person: args.person,
            // undefined for anything unrecognised, which lets the report derive
            // the plan from the month — the correct default, since neither plan
            // carries a month and only one of them describes any given one.
            basis: (["live", "scenario", "compare"] as const).find(
              (b) => b === String(args.basis ?? "").toLowerCase()
            ),
          }),
        };
      case "horizon": {
        const b = String(args.basis ?? "").toLowerCase();
        return {
          ok: true,
          result: await horizonReport({
            months: typeof args.months === "number" ? args.months : undefined,
            // An unrecognised basis falls back to forecast, not pipeline:
            // forecast is the weighted plan, pipeline is an unweighted ceiling
            // that would overstate every shortfall.
            basis: (["booked", "forecast", "pipeline"] as const).find((x) => x === b) ?? "forecast",
          }),
        };
      }
      case "monthly_outlook":
        return { ok: true, result: await monthlyOutlookReport({ month: args.month }) };
      case "client_plan_vs_actual":
        return { ok: true, result: await clientPlanVsActualReport({ month: args.month, client: args.client }) };
      case "contract_health":
        return {
          ok: true,
          result: await contractHealthReport({
            endingWithinDays: args.ending_within_days,
            client: args.client,
            includeEnded: args.include_ended,
          }),
        };
    }
  } catch (err: any) {
    const message = String(err?.message || err);
    return { ok: false, kind: classify(message), error: message };
  }
}

/* ─────────────── Formatting for the model ─────────────── */

const PROVENANCE =
  "Source: the TCE operations & resourcing base (Airtable). These are PLAN figures — what was sold, booked and budgeted. " +
  "Engine holds what was actually delivered. All volumes are Content Units (CUs) unless a field says hours.";

/**
 * The non-comparability rule, stated where the model cannot miss it.
 *
 * Airtable books one contract's CUs against every discipline that touches it;
 * Engine attributes each task's CUs to exactly one assignee. So Airtable demand
 * exceeds Engine delivery structurally, company-wide. Differencing them at
 * person grain produces a number that looks like over- or under-delivery and
 * measures neither.
 */
const PERSON_GRAIN_WARNING =
  "IMPORTANT: Airtable books the same contract CU against every discipline that touches it, while Engine attributes " +
  "each task CU to one assignee. At person level these two are NOT a plan and its actual — do not subtract them or " +
  "describe the difference as over- or under-delivery.";

export function formatResourcingResult(outcome: ResourcingOutcome): string {
  if (!outcome.ok) {
    const advice: Record<string, string> = {
      config: "Tell the user the resourcing base is not connected, and that a workspace admin can check it in Administration → Integrations.",
      input: "Tell the user exactly this, and ask them to rephrase. Do NOT retry with a guessed value.",
      schema: "A column in the Airtable base was renamed or retyped. Tell the user the report needs updating — do NOT substitute a different field or estimate the figures.",
      infra: "Tell the user briefly that the resourcing base could not be reached.",
    };
    return [
      `Resourcing query failed: ${outcome.error}`,
      advice[outcome.kind],
      "Do NOT invent, estimate or recall figures instead.",
    ].join("\n");
  }

  const { report, data, warnings, fetchedAt } = outcome.result;
  const lines: string[] = [PROVENANCE, `Report: ${report}. Fetched ${fetchedAt}.`];

  if (report === "capacity") lines.push(PERSON_GRAIN_WARNING);

  if (warnings.length) {
    lines.push("", "⚠ INCOMPLETE OR QUALIFIED — you must pass these caveats on to the user:");
    for (const w of warnings) lines.push(`  • ${w}`);
  }

  lines.push("", JSON.stringify(data, null, 1));
  lines.push(
    "",
    "A null figure means NOT KNOWN — a missing plan row, or a value the base could not give unambiguously. " +
      "It never means zero. Say so rather than reporting a null as 0."
  );

  return lines.join("\n");
}
