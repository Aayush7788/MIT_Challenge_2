"""Module A runner: Claude over every corpus document with text -> validated rule records -> out/rules.json
Env: ANTHROPIC_API_KEY. Optional MODEL (default claude-sonnet-4-5).
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from engine import validate_rule
from pack import load_corpus

PROMPT = open(os.path.join(os.path.dirname(__file__), "..", "data", "extraction_prompt.md")).read()

def call_claude(system: str, user: str) -> str:
    import anthropic
    client = anthropic.Anthropic()
    msg = client.messages.create(model=os.environ.get("MODEL", "claude-sonnet-4-5"), max_tokens=8000, temperature=0,
                                 system=system, messages=[{"role": "user", "content": user}])
    return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")

def parse_array(s: str):
    s = s.strip()
    if "```" in s: s = s.split("```")[1]; s = s[s.find("["):]
    return json.loads(s[s.find("["): s.rfind("]") + 1])

def user_msg(d):
    body = d["text"][:180000]
    return (f"Document id: {d['doc_id']}\nSource URL: {d['url']}\nRetrieval date: {d['retrieved_at']}\nJurisdiction per manifest: {d['jurisdictions']}\n\n"
            f"<document>\n{body}\n</document>\n\nExtract the rule records as specified. Output only the JSON array.")

def main(only=None):
    docs = [d for d in load_corpus() if d["text"]]
    if only: docs = [d for d in docs if d["doc_id"] in only]
    rules, rejected, log, n = [], [], [], 1
    for d in docs:
        try:
            recs = parse_array(call_claude(PROMPT, user_msg(d)))
        except Exception as e:
            log.append({"doc": d["doc_id"], "error": str(e)}); continue
        kept = 0
        for r in recs:
            r["source_doc_id"] = d["doc_id"]; r["source_url"] = d["url"]; r.setdefault("overrides", [])
            probs = validate_rule(r, d["text"])
            if probs: rejected.append({**r, "_problems": probs}); continue
            r["team_rule_id"] = f"r-{n:04d}"; n += 1; rules.append(r); kept += 1
        log.append({"doc": d["doc_id"], "jurisdiction": d["jurisdictions"], "extracted": len(recs), "kept": kept})
        print(d["doc_id"], d["jurisdictions"], "extracted", len(recs), "kept", kept)
    os.makedirs("out", exist_ok=True)
    json.dump({"rules": rules}, open("out/rules.json", "w"), indent=1)
    json.dump(rejected, open("out/rejected.json", "w"), indent=1)
    json.dump(log, open("out/extraction_log.json", "w"), indent=1)
    print(f"\nkept {len(rules)} rules, rejected {len(rejected)}. Read out/rejected.json with Gulnur.")

if __name__ == "__main__":
    main(set(sys.argv[1:]) or None)
