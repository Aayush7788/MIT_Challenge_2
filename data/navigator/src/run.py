"""Write the three submission files in the pack's exact shapes.
   python3 src/run.py [as_of]   (default 2026-10-01). Needs out/rules.json, data/geocode_cache.json, data/test_rule_map.json
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from engine import lookup_address, run_change_tests, DEFAULT_AS_OF
from pack import load_addresses, facts_of
from geocode import stack_for

def main(as_of=DEFAULT_AS_OF):
    rules = json.load(open("out/rules.json"))["rules"]
    addrs = load_addresses()
    stacks = {a["address_id"]: stack_for(a) for a in addrs}
    facts = {a["address_id"]: facts_of(a, stacks[a["address_id"]]) for a in addrs}
    lookups = {a["address_id"]: lookup_address(a, stacks[a["address_id"]], facts[a["address_id"]], rules, as_of) for a in addrs}
    json.dump({"as_of": as_of, "lookups": lookups}, open("out/lookups.json", "w"), indent=1)
    m = json.load(open("data/test_rule_map.json"))
    by_id = {r["team_rule_id"]: r for r in rules}
    canon = {k: by_id.get(v["team_rule_id"]) for k, v in m.items() if not k.startswith("_")}
    tests = json.load(open("pack/dev/change_tests.json"))
    changes = run_change_tests(tests, canon, addrs, stacks, facts)
    json.dump(changes, open("out/changes.json", "w"), indent=1)
    audit = {"as_of": as_of, "rules": len(rules), "addresses": len(addrs), "geocoded_legal_city": sum(1 for a in addrs if stacks[a['address_id']].county),
             "engine": "navigator-0.2", "precedence": "src/engine.py PRECEDENCE", "disclaimer": "Informational output from public sources. Not legal advice."}
    json.dump(audit, open("out/audit.json", "w"), indent=1)
    print(json.dumps({k: {"affected": len(v["affected_address_ids"]), "conflicts": len(v["conflict_flag_address_ids"]), "notes": v["notes"][:120]} for k, v in changes.items()}, indent=1))

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_AS_OF)
