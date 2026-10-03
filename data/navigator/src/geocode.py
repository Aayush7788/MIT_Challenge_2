"""Module B: postal address -> legal jurisdiction (Census Geocoder, public, no key). Cached. Run once; never live in the demo.
Usage: python3 src/geocode.py        # fills data/geocode_cache.json for all sample addresses (~500 calls, ~5 min)
"""
import json, os, sys, time, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
from engine import Stack
from pack import load_addresses
CACHE = os.path.join(os.path.dirname(__file__), "..", "data", "geocode_cache.json")
_cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}

def one_line(a): return f"{a['street_address']}, {a['postal_city']}, {a['state']} {a['zip']}"

def census(addr: str):
    if addr in _cache: return _cache[addr]
    url = ("https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?" +
           urllib.parse.urlencode({"address": addr, "benchmark": "Public_AR_Current", "vintage": "Current_Current", "format": "json"}))
    try:
        with urllib.request.urlopen(url, timeout=25) as r: js = json.load(r)
        m = js["result"]["addressMatches"]
        if not m: _cache[addr] = None
        else:
            g = m[0]["geographies"]
            place = (g.get("Incorporated Places") or g.get("Census Places") or [{}])[0].get("BASENAME")
            county = (g.get("Counties") or [{}])[0].get("BASENAME")
            _cache[addr] = {"state": m[0]["addressComponents"]["state"], "county": county, "city": place, "matched": m[0]["matchedAddress"]}
    except Exception as e:
        _cache[addr] = {"error": str(e)}
    json.dump(_cache, open(CACHE, "w"), indent=1)
    return _cache[addr]

def stack_for(a: dict) -> Stack:
    c = _cache.get(one_line(a)) or {}
    city = c.get("city") if c and "error" not in c else None
    if not city:   # fallback: postal city, flagged. README says this is NOT always the legal city.
        city = a["postal_city"]
    return Stack(state=a["state"], county=c.get("county") if c else None, city=city)

if __name__ == "__main__":
    rows = load_addresses()
    for i, a in enumerate(rows):
        census(one_line(a)); time.sleep(0.3)
        if i % 50 == 0: print(i, "geocoded")
    bad = [k for k, v in _cache.items() if not v or "error" in v]
    print(f"done. {len(_cache)} cached, {len(bad)} unmatched/errored -> fallback to postal city for those")
