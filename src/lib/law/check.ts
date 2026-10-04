import { lookup, type Building, type Evaluation } from "./engine";
import type { Category, RuleRecord } from "./schema";

// Answers questions like "can my landlord raise the rent 20% next month?" using
// only the engine's results. If a cap applies and it's lower, the answer is no.
// If we can't pin the cap down (a missing fact, a CPI formula, a figure we can't
// parse), the answer is "can't tell". We never suggest ways around a rule.

export type ProposalKind = "rent_increase_pct" | "deposit_months" | "application_fee_usd";
export type Proposal = { kind: ProposalKind; amount: number };
export type Verdict = "over_limit" | "within_limit" | "cant_tell" | "no_cap_found";

export type CheckLine = { team_rule_id: string; citation: string; title: string; key_value: string | null; text: string };
export type CheckResult = {
  verdict: Verdict;
  headline: string;
  blocking: CheckLine[];
  within: CheckLine[];
  unsettled: CheckLine[];
  could_change: CheckLine[];
  context: CheckLine[];
  as_of: string;
  limit: number | null; // the cap that blocks it, when one does
  unsettled_count: number;
};

export const PROPOSAL_CATEGORY: Record<ProposalKind, Category> = {
  rent_increase_pct: "rent_increase_limits",
  deposit_months: "security_deposits",
  application_fee_usd: "application_screening_fees",
};

export const UNIT: Record<ProposalKind, (n: number) => string> = {
  rent_increase_pct: (n) => `${n}%`,
  deposit_months: (n) => (n === 1 ? "1 month's rent" : `${n} months' rent`),
  application_fee_usd: (n) => `$${n}`,
};

// Pull the max (and whether it moves with CPI) out of a rule's key_value text.
export type Bound = { max: number | null; floor: number | null; cpi: boolean; why?: string };

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, "one and one-half": 1.5, "one and a half": 1.5, "one-half": 0.5 };

// "A landlord can only require first month's rent, last month's rent, a security
// deposit and a lock fee": a closed list of move-in payments with no application
// fee on it allows no application fee (M.G.L. c. 186 § 15B(1)(b)).
const CLOSED_LIST = /\b(?:can|may) only (?:require|charge|collect)\b|\bin excess of the following\b/i;

export function readBound(kind: ProposalKind, kv: string | null, requirement = "", asOf?: string): Bound | null {
  if (kind === "application_fee_usd" && !/\$\s*\d/.test(kv ?? "") && CLOSED_LIST.test(requirement) && /first month/i.test(requirement) && !/application|screening/i.test(`${kv ?? ""} ${requirement}`)) {
    return { max: 0, floor: null, cpi: false, why: `Allows only ${kv ?? "the payments it lists"} at or before move-in, and an application fee is not on that list.` };
  }
  if (!kv) return null;
  const text = kv.replace(/\s+/g, " ");
  const cpi = /\bCPI\b|consumer price/i.test(text);
  if (kind === "rent_increase_pct") {
    // A published figure for a period that covers the query date ("2.87% for
    // 2026-09-01 to 2027-08-31") is the cap on that date, CPI formula or not.
    for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*%\s*(?:for|from)\s*(\d{4}-\d{2}-\d{2})\s*(?:to|through|-)\s*(\d{4}-\d{2}-\d{2})/gi)) {
      if (asOf && m[2] <= asOf && asOf <= m[3]) return { max: Number(m[1]), floor: Number(m[1]), cpi: false };
    }
    const nums: number[] = [];
    let floor: number | null = null;
    for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
      const after = text.slice((m.index ?? 0) + m[0].length);
      if (/^\s*of\b/i.test(after)) continue; // "80% of CPI" is a multiplier, not a cap
      if (/^\s*(?:if|when)\b/i.test(after)) continue; // "0% if CPI is negative" is a special case, not the cap
      if (/^\s*(?:additional|surcharge)/i.test(after)) continue;
      if (/^\s*(?:\+|plus)\s*(?:the\s+)?(?:regional\s+|local\s+)?(?:CPI|change in)/i.test(after)) {
        floor = Number(m[1]);
        continue;
      }
      nums.push(Number(m[1]));
    }
    if (!nums.length) return null;
    if (nums.length > 1 && !/lesser|lower|max|cap|not (?:to )?exceed/i.test(text)) return null;
    return { max: Math.min(...nums), floor, cpi };
  }
  if (kind === "deposit_months") {
    const m = text.match(/(\d+(?:\.\d+)?)\s*months?/i) ?? text.match(/\b(one and one-half|one and a half|one-half|one|two|three)\s+months?/i);
    if (!m) return null;
    const n = Number.isFinite(Number(m[1])) ? Number(m[1]) : WORD_NUM[m[1].toLowerCase()];
    return n != null ? { max: n, floor: null, cpi: false } : null;
  }
  const m = text.match(/\$\s*(\d+(?:\.\d+)?)/);
  // A fee "adjusted annually" for CPI from a base year: the dollar figure is the base,
  // and today's cap is higher by an amount our sources may not give.
  if (m && cpi && /\b(?:since|from|adjusted)\b/i.test(text)) return { max: null, floor: Number(m[1]), cpi };
  return m ? { max: Number(m[1]), floor: null, cpi } : null;
}

const LIMIT_WORDS = /\b(caps?|capped|limits?|limited|maximum|max|not (?:to )?exceed|no more than|allowable)\b/i;
// "No state cap" or "No local rent control" isn't a limit, so we show it as context.
const NO_CAP = /\bno\b[^.;]{0,30}\b(cap|rent control|limit)|\bbars?\b[^.;]{0,30}rent control|\bprohibit\w*\b[^.;]{0,30}rent control/i;

function line(e: Evaluation, text: string): CheckLine {
  const r: RuleRecord = e.rule;
  return { team_rule_id: r.team_rule_id, citation: r.citation, title: r.title, key_value: r.key_value, text };
}

export function checkProposal(rules: RuleRecord[], b: Building, asOf: string, p: Proposal): CheckResult {
  const cat = PROPOSAL_CATEGORY[p.kind];
  const amount = UNIT[p.kind](p.amount);
  const evals = lookup(rules, b, asOf).filter((e) => e.rule.category === cat);
  const blocking: CheckLine[] = [];
  const within: CheckLine[] = [];
  const unsettled: CheckLine[] = [];
  const could_change: CheckLine[] = [];
  const context: CheckLine[] = [];
  const show = (n: number | null) => (n == null ? "?" : UNIT[p.kind](n));

  for (const e of evals) {
    if (e.result === "pending" || e.result === "not_yet_effective") {
      could_change.push(line(e, e.result === "pending" ? "Pending proposal, not law." : `Enacted, takes effect ${e.rule.effective_date ?? "later"}.`));
      continue;
    }
    if (e.result === "superseded") continue; // a stricter local rule governs; it is evaluated on its own
    if (e.figure_from) {
      unsettled.push(line(e, `Limits increases here, but the figure in force on ${asOf} is not in our sources (${e.rule.key_value ?? "the figure on this card"} starts ${e.figure_from}).`));
      continue;
    }
    const bound = readBound(p.kind, e.rule.key_value, e.rule.requirement, asOf);
    if (!bound && NO_CAP.test(`${e.rule.key_value ?? ""} ${e.rule.title}`)) {
      context.push(line(e, e.rule.requirement));
      continue;
    }
    if (!bound) {
      // Notice and procedure rules have no number to compare, so skip them. A local
      // rent ordinance still limits increases even if this year's figure isn't in our sources.
      const localRent = p.kind === "rent_increase_pct" && e.rule.level === "city";
      if (localRent || LIMIT_WORDS.test(`${e.rule.requirement} ${e.rule.key_value ?? ""}`)) {
        unsettled.push(line(e, `${e.result === "unknown" ? "May apply here. " : ""}Sets a limit, but the figure is not stated in a form we can compare (${e.rule.key_value ?? "no figure in the source"}).`));
      }
      continue;
    }
    const over = bound.max != null && p.amount > bound.max;
    const surelyUnder = bound.cpi ? bound.floor != null && p.amount <= bound.floor : bound.max != null && p.amount <= bound.max;
    if (e.result === "applies") {
      if (over) blocking.push(line(e, bound.why ? `${bound.why} ${amount} is not allowed.` : `Caps this at ${show(bound.max)} here; ${amount} is above it.`));
      else if (surelyUnder) within.push(line(e, `${amount} is within this limit (${e.rule.key_value}).`));
      else if (bound.max == null) unsettled.push(line(e, `The limit is ${e.rule.key_value}: it moves with the CPI, and the current figure is not in our sources.`));
      else unsettled.push(line(e, `The limit is ${e.rule.key_value}: it depends on the regional CPI, which is not in our sources, and is never more than ${show(bound.max)}.`));
    } else if (e.result === "unknown") {
      const why = e.explanation.match(/Unknown: [^;)]*/)?.[0]?.replace("Unknown: ", "") ?? "a fact the public data does not have";
      if (surelyUnder) within.push(line(e, `If it covers this unit, ${amount} is within its limit (${e.rule.key_value}).`));
      else unsettled.push(line(e, `${bound.max == null ? `Would limit this (${e.rule.key_value})` : `Would cap this at ${show(bound.max)}`} if it covers the unit; that depends on this: ${why}.`));
    }
  }

  let verdict: Verdict;
  let headline: string;
  if (blocking.length) {
    verdict = "over_limit";
    const first = evals.find((e) => e.rule.team_rule_id === blocking[0].team_rule_id)!;
    const cap = readBound(p.kind, first.rule.key_value, first.rule.requirement, asOf)?.max ?? null;
    headline = cap === 0 ? `No. ${blocking[0].citation} does not allow this at this address on ${asOf}.` : `No. ${blocking[0].citation} limits this to ${show(cap)} at this address on ${asOf}.`;
  } else if (unsettled.length) {
    verdict = "cant_tell";
    headline = `Can't tell from public data. ${unsettled.length === 1 ? "One rule" : `${unsettled.length} rules`} could limit ${amount}; see what would settle it below.`;
  } else if (within.length) {
    verdict = "within_limit";
    headline = `${amount} is within every limit that could apply to this address on ${asOf}.`;
  } else {
    verdict = "no_cap_found";
    headline = `We found no rule in our sources that limits this at this address on ${asOf}.${context.length ? ` ${context[0].citation}: ${context[0].key_value ?? context[0].title}.` : ""} Other rules, such as notice periods, may still apply.`;
  }
  const top = blocking.length ? evals.find((e) => e.rule.team_rule_id === blocking[0].team_rule_id) : undefined;
  const limit = top ? (readBound(p.kind, top.rule.key_value, top.rule.requirement, asOf)?.max ?? null) : null;
  return { verdict, headline, blocking, within, unsettled, could_change, context, as_of: asOf, limit, unsettled_count: unsettled.length };
}
