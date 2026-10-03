"""Navigator engine — matched to the RealPage participant pack (schema/rule_record.schema.json,
submission_templates/*.json, dev/change_tests.json). Deterministic; no network.

Result values (README §5): applies | unknown | superseded | not_yet_effective | pending
Rules that do not apply are left out of lookups.
"""
from __future__ import annotations
import json, datetime as dt
from dataclasses import dataclass

UNKNOWN = "unknown"
DEFAULT_AS_OF = "2026-10-01"

# ---------------- Module A: validation ----------------
def _norm(s: str) -> str:
    return " ".join(s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"').replace(" ", " ").split())

def validate_rule(rule: dict, source_text: str) -> list[str]:
    p = []
    span = (rule.get("quoted_span") or "").strip()
    body = source_text.split("\n", 3)[-1] if source_text.startswith("SOURCE:") else source_text  # skip SOURCE/RETRIEVED header
    if len(span) < 20: p.append("quoted_span shorter than 20 chars")
    elif _norm(span) not in _norm(body): p.append("quoted_span not verbatim in source body — rejected")
    if rule.get("status") not in ("in_force", "not_yet_effective", "pending", "failed"): p.append(f"bad status {rule.get('status')}")
    if rule.get("level") not in ("state", "city"): p.append(f"bad level {rule.get('level')}")
    if rule.get("status") in ("in_force", "not_yet_effective") and not rule.get("effective_date") and rule.get("status") == "not_yet_effective":
        p.append("not_yet_effective without effective_date")
    cc = rule.get("coverage_conditions")
    if isinstance(cc, dict):
        for pr in cc.get("all", []) + cc.get("none", []):
            if not {"field", "op", "value"} <= set(pr): p.append(f"malformed predicate {pr}")
    return p

# ---------------- Module B: coverage ----------------
def _cmp(a, op, b):
    ops = {"==": lambda: a == b, "!=": lambda: a != b, ">=": lambda: a >= b, "<=": lambda: a <= b,
           ">": lambda: a > b, "<": lambda: a < b, "in": lambda: a in b, "not_in": lambda: a not in b}
    try: return bool(ops[op]())
    except (TypeError, KeyError): return UNKNOWN

def eval_predicate(p: dict, facts: dict) -> bool | str:
    f, op, v = p["field"], p["op"], p["value"]
    if f == "certificate_of_occupancy_date":
        # README 4.1: year built != certificate of occupancy. Infer only where it is safe; cutoff year -> unknown.
        yb = facts.get("year_built")
        if yb is None: return UNKNOWN
        cutoff_year = int(str(v)[:4])
        if yb > cutoff_year:  return _cmp("1", op, "0") if op in (">", ">=", "!=") else _cmp("0", op, "1")  # CO necessarily after cutoff
        if yb == cutoff_year: return UNKNOWN
        # built before cutoff year: CO very likely before cutoff (flagged in explanation as inferred)
        return _cmp("0", op, "1") if op in (">", ">=", "!=") else _cmp("1", op, "0")
    if f == "new_construction_years":
        yb = facts.get("year_built")
        if yb is None: return UNKNOWN
        return _cmp(int(facts.get("_as_of_year", 2026)) - yb, op, v)
    if f not in facts or facts[f] is None: return UNKNOWN
    return _cmp(facts[f], op, v)

def rule_applies(rule: dict, facts: dict) -> tuple[bool | str, list[str]]:
    """(True/False/'unknown', missing_fact_names)"""
    cc = rule.get("coverage_conditions")
    if not isinstance(cc, dict):  # free-text coverage -> cannot test -> unknown unless no conditions stated
        return (True, []) if not cc else (UNKNOWN, ["coverage_conditions is free text"])
    missing = []
    cov = []
    for p in cc.get("all", []):
        r = eval_predicate(p, facts); cov.append(r)
        if r == UNKNOWN: missing.append(p["field"])
    if any(c is False for c in cov): return False, []
    ex = []
    for p in cc.get("none", []):
        r = eval_predicate(p, facts); ex.append(r)
        if r == UNKNOWN: missing.append(p["field"])
    if any(e is True for e in ex): return False, []
    if any(c == UNKNOWN for c in cov) or any(e == UNKNOWN for e in ex): return UNKNOWN, sorted(set(missing))
    return True, []

# ---------------- Module C: status as of a date ----------------
def status_as_of(rule: dict, as_of: str) -> str:
    s, eff = rule["status"], rule.get("effective_date")
    if s in ("in_force", "not_yet_effective"):
        if eff and len(eff) == 10:
            return "in_force" if eff <= as_of else "not_yet_effective"
        return s  # no usable date: trust the recorded status (as of 2026-10-01)
    return s  # pending, failed

# ---------------- Jurisdiction + precedence ----------------
@dataclass
class Stack:
    state: str
    county: str | None
    city: str | None   # legal incorporated place, from the geocoder

def rules_for_stack(rules, st: Stack):
    out = []
    for r in rules:
        j = r["jurisdiction"]
        if r["level"] == "state" and j == st.state: out.append(r)
        elif r["level"] == "city" and st.city and j.lower() == f"{st.city}, {st.state}".lower(): out.append(r)
    return out

# Legal logic per state, written by counsel. Applied after coverage.
PRECEDENCE = {
    "MA": {"rent_increase_limits": "state_preempts_local"},     # M.G.L. c. 40P § 4
    "CA": {"rent_increase_limits": "stricter_local_supersedes_state", "just_cause_eviction": "stricter_local_supersedes_state"},  # AB 1482 yields to local
    "NJ": {"algorithmic_rent_setting": "state_and_local_conflict"},  # FAIR Act § 6(b) vs JC/Hoboken ordinances
}

def apply_precedence(state: str, recs: list[dict]) -> list[dict]:
    """recs: [{rule, result, ...}] for one address. Mutates result/conflict_flag per declared precedence."""
    for cat, mode in PRECEDENCE.get(state, {}).items():
        same = [x for x in recs if x["rule"]["category"] == cat and x["result"] in ("applies", "unknown", "not_yet_effective")]
        local = [x for x in same if x["rule"]["level"] == "city"]
        st = [x for x in same if x["rule"]["level"] == "state"]
        if mode == "state_preempts_local":
            for x in local:
                x["result"] = "superseded"; x["conflict_flag"] = True
                x["explanation"] += " Local rent control is preempted by state law (M.G.L. c. 40P § 4)."
        elif mode == "stricter_local_supersedes_state" and local and st:
            for x in st:
                if any(l["result"] == "applies" for l in local):
                    x["result"] = "superseded"
                    x["explanation"] += " A local ordinance governs this category at this address; the statewide rule is superseded where the local rule is stricter."
        elif mode == "state_and_local_conflict" and local and st:
            for x in local + st:
                x["conflict_flag"] = True
                x["explanation"] += " Possible conflict between the statewide act and the local ordinance; human review."
    return recs

# ---------------- Lookup (README §5 shape) ----------------
def lookup_address(addr: dict, st: Stack, facts: dict, rules: list[dict], as_of: str = DEFAULT_AS_OF) -> list[dict]:
    recs = []
    for r in rules_for_stack(rules, st):
        s = status_as_of(r, as_of)
        if s == "failed": continue                    # never report a failed measure as applying (T5)
        ap, missing = rule_applies(r, {**facts, "_as_of_year": int(as_of[:4])})
        if ap is False: continue                      # README: leave out rules that don't apply
        if ap == UNKNOWN:
            result = "unknown"; expl = f"Coverage depends on facts not in the data: {', '.join(missing)}."
        elif s == "in_force":
            result = "applies"; expl = f"{r['title']} ({r['citation']}); in force as of {as_of}."
        elif s == "not_yet_effective":
            result = "not_yet_effective"; expl = f"Enacted; effective {r.get('effective_date')}, after {as_of}."
        else:
            result = "pending"; expl = f"{r['title']} is a bill/proposal, not law, as of {as_of}."
        if r.get("conflict_note") and "inferred" in str(r.get("conflict_note")): expl += f" Note: {r['conflict_note']}."
        recs.append({"rule": r, "team_rule_id": r["team_rule_id"], "result": result, "explanation": expl,
                     "conflict_flag": bool(r.get("conflict_flag", False)), "source_doc_id": r.get("source_doc_id"), "quoted_span": r.get("quoted_span")})
    recs = apply_precedence(st.state, recs)
    return [{k: v for k, v in x.items() if k != "rule"} for x in recs]

# ---------------- Change cases (dev/change_tests.json) ----------------
def run_change_tests(tests: list[dict], rules_by_canonical: dict, addresses: list[dict], stacks: dict, facts: dict) -> dict:
    """rules_by_canonical: {'CA-ALG-01': rule, ...} mapping the test ids to our extracted records."""
    out = {}
    for t in tests:
        tid = t["test_id"]; notes = []
        rule_objs = [rules_by_canonical.get(rid) for rid in t["rule_ids"]]
        if any(r is None for r in rule_objs):
            out[tid] = {"affected_address_ids": [], "conflict_flag_address_ids": [], "notes": f"missing rule mapping for {[rid for rid,r in zip(t['rule_ids'],rule_objs) if r is None]}"}; continue
        dates = [t.get("as_of_after") or t.get("as_of")]
        before = t.get("as_of_before")
        affected, conflicts = set(), set()
        for a in addresses:
            st = stacks[a["address_id"]]; f = facts[a["address_id"]]
            for r in rule_objs:
                if r not in rules_for_stack([r], st): continue
                ap, _ = rule_applies(r, {**f, "_as_of_year": int(dates[0][:4])})
                s_after = status_as_of(r, dates[0])
                if t["type"] == "pending":
                    if s_after == "pending" and ap is not False: affected.add(a["address_id"])
                elif t["type"] == "negative":
                    if s_after != "failed" and ap is True: affected.add(a["address_id"])  # should stay empty
                else:
                    if s_after == "in_force" and ap is True: affected.add(a["address_id"])
                if t.get("conflict_with"):
                    for cid in t["conflict_with"]:
                        c = rules_by_canonical.get(cid)
                        if c and c in rules_for_stack([c], st): conflicts.add(a["address_id"])
        if before:
            sb = {rid: status_as_of(rules_by_canonical[rid], before) for rid in t["rule_ids"]}
            sa = {rid: status_as_of(rules_by_canonical[rid], dates[0]) for rid in t["rule_ids"]}
            notes.append(f"status on {before}: {sb}; on {dates[0]}: {sa}")
        if t["type"] == "negative":
            notes.append("measure recorded as failed; no rent cap reported" if not affected else "ERROR: failed measure reported as applying")
        out[tid] = {"affected_address_ids": sorted(affected), "conflict_flag_address_ids": sorted(conflicts), "notes": "; ".join(notes) or t["expected_behavior"]}
    return out
