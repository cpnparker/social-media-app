/**
 * A PER-TURN BUDGET FOR MEETING TRANSCRIPTS.
 *
 * THE INCIDENT, 2026-09-28 (thread 8479ea99). Asked for a weekly summary, a
 * grok-4.7 turn opened five meetings with meeting_details, and every one came
 * back with its whole transcript: 2,138, 42,516, 2,507, 47,538 and 37,787
 * characters — 132,486 in all, three of them client calls it only needed the
 * outcome of. The round that received them was the one the platform killed at
 * 300s. A weekly summary needs what was DECIDED in a meeting, which is what
 * the summary, next steps and tasks already hold; the transcript is for the
 * question that is about one meeting.
 *
 * MEASURED, not guessed — meetingbrain.processed_meeting, every meeting since
 * 2026-07-01 (4,629 rows, 1,369 with a transcript of 1,000+ characters),
 * read-only:
 *     transcript chars  p25 3,125  p50 5,107  p75 6,723  p90 8,482
 *                       p99 24,068  max 51,760
 *     the notes that replace it (summary + next_steps + insights + key_topics
 *     + external_summary): p50 695, p90 3,592
 * So 60,000 characters admits about seven typical meetings in full, or the
 * p99 meeting twice over, and bites only on a turn that reaches for several
 * of the long recorded client calls — the incident's shape. Once it is spent
 * a further meeting comes back as its notes, which are an order of magnitude
 * smaller and carry what a summary is made of.
 *
 * THE FIRST TRANSCRIPT OF A TURN IS ALWAYS WHOLE, whatever its size — a turn
 * that opens one meeting can always read all of it. That alone does NOT make
 * "ask for it and it will be read" true: a turn asked for one meeting's
 * transcript often opens another first (the wrong candidate, while working
 * out which meeting was meant), and the one the user named then came back as
 * notes, with a notice telling them to do exactly what they had just done.
 * Comparing two long client calls was impossible for the same reason.
 *
 * So A TRANSCRIPT ASKED FOR BY NAME IS NOT HELD BACK BY THE ALLOWANCE:
 * meeting_details takes `full_transcript: true`, which the tool description
 * tells the model to set only when the user asked for the transcript itself.
 * Explicit reads still count toward the allowance (so a summary opened after
 * them is notes), and are capped at EXPLICIT_TRANSCRIPTS_PER_TURN, because a
 * model that sets the flag on everything would otherwise restore the incident
 * exactly. Past that cap an explicit ask falls back to the ordinary rule. The
 * 100,000-character cap in queryMeetingBrain is still the ceiling on any one.
 *
 * OUR limit, never the source's. A withheld transcript is described to the
 * model with the same two clauses every refusal in lib/ai/tool-loop-guard.ts
 * carries, because the failure this repo has already paid for is a model
 * turning a refusal it cannot see into "(no recording)" about a meeting with a
 * 28,563-character transcript. Here the model is told the transcript EXISTS
 * and how long it is, and the user is told deterministically at the end of
 * the turn which meetings were read from notes — the model is not trusted to
 * relay that, for the same reason the cut-short notice is not left to it.
 *
 * Imports only the wording, so a check can drive it with its own numbers.
 */
import { DO_NOT_BLAME_THE_SOURCE, OUR_LIMIT_CUT_IT_SHORT } from "./tool-loop-guard";

export const TRANSCRIPT_TURN_BUDGET_CHARS = 60_000;

/** Transcripts one turn may read past the allowance because they were asked
 *  for by name: enough to compare three calls, and a bound on a model that
 *  sets the flag without being asked. */
export const EXPLICIT_TRANSCRIPTS_PER_TURN = 3;

export interface WithheldTranscript {
  title: string;
  chars: number;
}

export interface TranscriptBudget {
  /**
   * May a full transcript of `chars` characters be returned? Charges the
   * budget when it may. The first transcript of a turn is always admitted,
   * and so is one asked for by name (`explicit`) while fewer than
   * EXPLICIT_TRANSCRIPTS_PER_TURN have been.
   */
  admit(chars: number, explicit?: boolean): boolean;
  /** Record a meeting returned as its notes instead. */
  withhold(title: string, chars: number): void;
  /** Characters of full transcript returned so far this turn. */
  used(): number;
  /** Transcripts admitted past the allowance because they were asked for. */
  explicitUsed(): number;
  /** The meetings returned as notes, in the order they were asked for. */
  withheld(): WithheldTranscript[];
  readonly limit: number;
}

export function createTranscriptBudget(limit: number = TRANSCRIPT_TURN_BUDGET_CHARS): TranscriptBudget {
  let spent = 0;
  let admitted = 0;
  let explicitAdmitted = 0;
  const held: WithheldTranscript[] = [];
  return {
    limit,
    admit(chars: number, explicit?: boolean): boolean {
      const n = Math.max(0, Math.floor(chars || 0));
      const within = admitted === 0 || spent + n <= limit;
      if (!within) {
        if (!explicit || explicitAdmitted >= EXPLICIT_TRANSCRIPTS_PER_TURN) return false;
        explicitAdmitted++;
      }
      admitted++;
      spent += n;
      return true;
    },
    withhold(title: string, chars: number): void {
      held.push({ title: String(title || "Untitled meeting"), chars: Math.max(0, Math.floor(chars || 0)) });
    },
    used(): number {
      return spent;
    },
    explicitUsed(): number {
      return explicitAdmitted;
    },
    withheld(): WithheldTranscript[] {
      return held.slice();
    },
  };
}

/**
 * What the model is told alongside a meeting returned as its notes. States
 * that the transcript exists and its size — the fact a refusal hides — and
 * how the user gets it.
 *
 * `explicitRefused`: this call already asked for the transcript by name and
 * the turn had used its EXPLICIT_TRANSCRIPTS_PER_TURN, so the flag is not
 * offered again — a new message is the way to it.
 */
export function transcriptWithheldHint(title: string, chars: number, usedChars: number, explicitRefused: boolean = false): string {
  const how = explicitRefused
    ? `This turn has already read ${EXPLICIT_TRANSCRIPTS_PER_TURN} transcripts asked for by name, the most one turn reads, so do not ask for it again this turn: tell the user the full transcript of "${title}" can be read by asking for it by name in a new message.`
    : `Only if the user asked for the TRANSCRIPT ITSELF — to read, quote or compare it — call meeting_details for this meeting again with full_transcript: true; a transcript asked for that way is not held back by this allowance. Otherwise answer from the notes and tell the user the full transcript of "${title}" can be asked for by name.`;
  return (
    `TRANSCRIPT NOT INCLUDED — THIS TURN'S ALLOWANCE IS SPENT. This meeting HAS a full transcript ` +
    `(${chars.toLocaleString("en-GB")} characters); it was left out only because this turn has already read ` +
    `${usedChars.toLocaleString("en-GB")} characters of meeting transcripts. What is above is its summary, next steps, ` +
    `insights and tasks — answer from those. ${OUR_LIMIT_CUT_IT_SHORT} ${DO_NOT_BLAME_THE_SOURCE} ${how}`
  );
}

/**
 * The end-of-turn line naming the meetings read from their notes. Empty when
 * nothing was withheld. It says what IS true of the code — a transcript asked
 * for by name is not held back by this allowance — rather than promising that
 * any particular next turn will read it.
 */
export function summarisedTranscriptsNotice(budget: TranscriptBudget | null | undefined): string {
  const held = budget ? budget.withheld() : [];
  if (!held.length) return "";
  const names: string[] = [];
  for (let i = 0; i < held.length; i++) {
    const t = `“${held[i].title}”`;
    if (names.indexOf(t) < 0) names.push(t);
  }
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, names.length - 1).join(", ")} and ${names[names.length - 1]}`;
  const one = names.length === 1;
  return (
    `\n\n---\n\n📝 **Read from ${one ? "its" : "their"} notes, not ${one ? "its" : "their"} transcript${one ? "" : "s"}:** ${list}. ` +
    `This turn had already read its allowance of meeting transcripts — a limit at this end, not a gap in the recording. ` +
    `To read ${one ? "that" : "a"} full transcript, ask for it by name: a transcript asked for directly is not held back by this allowance.`
  );
}
