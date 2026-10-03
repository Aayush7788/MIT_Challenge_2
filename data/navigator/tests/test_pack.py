"""T1–T5 straight from pack/dev/change_tests.json, run on toy rules in the pack's own schema.
Swap TOY for out/rules.json + data/test_rule_map.json once extraction is done."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from engine import Stack, lookup_address, run_change_tests, rule_applies, status_as_of, validate_rule, UNKNOWN
H = os.path.dirname(__file__)
RULES = json.load(open(os.path.join(H, "toy_rules.json")))["rules"]
TESTS = json.load(open(os.path.join(H, "..", "pack", "dev", "change_tests.json")))
CANON = {"CA-ALG-01": RULES[0], "HOB-ALG-01": RULES[1], "JC-ALG-01": RULES[2], "NJ-ALG-01": RULES[3],
         "MA-ALG-P1": RULES[4], "MA-ALG-P2": RULES[5], "MA-RENT-P1": RULES[6]}
ADDR = [{"address_id": "A1", "state": "NJ", "c": "Jersey City"}, {"address_id": "A2", "state": "NJ", "c": "Hoboken"}, {"address_id": "A3", "state": "NJ", "c": "Newark"},
        {"address_id": "A4", "state": "MA", "c": "Boston"}, {"address_id": "A5", "state": "MA", "c": "Cambridge"}, {"address_id": "A6", "state": "CA", "c": "Los Angeles"}, {"address_id": "A7", "state": "CA", "c": "San Francisco"}]
STACKS = {a["address_id"]: Stack(a["state"], None, a["c"]) for a in ADDR}
FACTS = {a["address_id"]: {"units": 20, "year_built": 1960} for a in ADDR}
def T(i): return next(t for t in TESTS if t["test_id"] == i)
def run(i): return run_change_tests([T(i)], CANON, ADDR, STACKS, FACTS)[i]

def test_T1_ca_effective_date():
    r = CANON["CA-ALG-01"]
    assert status_as_of(r, "2025-12-31") == "not_yet_effective" and status_as_of(r, "2026-01-02") == "in_force"
    assert set(run("T1")["affected_address_ids"]) == {"A6", "A7"}
    la = lookup_address(ADDR[5], STACKS["A6"], FACTS["A6"], RULES, "2025-12-31")
    assert any(x["team_rule_id"] == "r-0001" and x["result"] == "not_yet_effective" for x in la)

def test_T2_city_boundaries():
    aff = run("T2")["affected_address_ids"]
    assert "A1" in aff and "A2" in aff and "A3" not in aff
    hob = lookup_address(ADDR[1], STACKS["A2"], FACTS["A2"], RULES)
    assert any(x["team_rule_id"] == "r-0002" for x in hob) and not any(x["team_rule_id"] == "r-0003" for x in hob)

def test_T3_fair_act_dates_and_conflict():
    r = run("T3")
    assert set(r["affected_address_ids"]) == {"A1", "A2", "A3"}
    assert set(r["conflict_flag_address_ids"]) == {"A1", "A2"}       # JC + Hoboken, not Newark
    jc_now = lookup_address(ADDR[0], STACKS["A1"], FACTS["A1"], RULES, "2026-10-01")
    assert any(x["team_rule_id"] == "r-0004" and x["result"] == "not_yet_effective" for x in jc_now)
    jc_later = lookup_address(ADDR[0], STACKS["A1"], FACTS["A1"], RULES, "2027-07-02")
    assert any(x["team_rule_id"] == "r-0004" and x["result"] == "applies" and x["conflict_flag"] for x in jc_later)

def test_T4_pending_bills():
    r = run("T4")
    assert set(r["affected_address_ids"]) == {"A4", "A5"}
    bos = lookup_address(ADDR[3], STACKS["A4"], FACTS["A4"], RULES)
    assert all(x["result"] == "pending" for x in bos if x["team_rule_id"] in ("r-0005", "r-0006"))

def test_T5_struck_ballot_no_rent_cap():
    r = run("T5")
    assert r["affected_address_ids"] == []
    for aid, idx in (("A4", 3), ("A5", 4)):
        out = lookup_address(ADDR[idx], STACKS[aid], FACTS[aid], RULES)
        assert not any(x["team_rule_id"] == "r-0007" for x in out)            # failed measure never reported
        caps = [x for x in out if x["team_rule_id"] == "r-0008"]              # c.40P §4 itself is reported as the governing state rule
        assert caps and caps[0]["result"] == "applies"

def test_unknown_co_cutoff_year():
    sf = CANON and RULES[8]
    assert rule_applies(sf, {"year_built": None})[0] == UNKNOWN
    assert rule_applies(sf, {"year_built": 1979})[0] == UNKNOWN              # cutoff year -> unknown (README 4.1)
    assert rule_applies(sf, {"year_built": 1985})[0] is False               # built after cutoff -> exempt -> left out
    assert rule_applies(sf, {"year_built": 1960})[0] is True

def test_span_validation_skips_header_and_rejects_paraphrase():
    src = "SOURCE: https://x\nRETRIEVED: 2026-10-01\n\nNo city or town may enact, maintain or enforce rent control of any kind, except that"
    ok = dict(RULES[7]); bad = dict(RULES[7], quoted_span="cities and towns cannot have rent control of any kind at all")
    assert validate_rule(ok, src) == [] and validate_rule(bad, src)
