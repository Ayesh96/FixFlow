import json, sys
CASES = [  # (label, substring of the error title)
    ("Unknown key (guard removed): KeyError", "KeyError: 'bogus'"),
    ("Volume up (typo'd name): NameError", "VOLUME_STP"),
    ("Open browser (None.rstrip): AttributeError", "NoneType"),
    ("No Accessibility permission: HTTPException", "assistive access"),
    ("osascript hangs: TimeoutExpired", "TimeoutExpired"),
    ("pmset fails, logged as a message", "display sleep failed"),
    ("Test message, info", "fixflow test from MacRemote"),
    ("'hello world ping', debug", "hello world ping"),
    ("'Failed to ping the database', info", "Failed to ping"),
    ("'sentry test please ignore', sent as error", "sentry test please ignore"),
    ("KeyError at warning level", "customer_id"),
    ("Exception created, never raised", "created but never raised"),
]
def load(d, phase): return json.load(open(f"{d}/results-{phase}.json"))
def find(rows, needle): return next((r for r in rows if needle in r["title"]), None)
def tags(r): return ", ".join(r["tags"]) if r else "-"
def filed(r): return "-" if not r else ("not filed" if not r["filed"] else "FILED" + (f" [{', '.join(r['labels'])}]" if r["labels"] else ""))
def run(before, after, phase, out):
    b, a = load(before, phase), load(after, phase)
    changed = 0
    out.append(f"| Case | Tags before | Tags after | Filing before | Filing after |\n|---|---|---|---|---|")
    for label, needle in CASES:
        rb, ra = find(b, needle), find(a, needle)
        diff = (tags(rb), filed(rb)) != (tags(ra), filed(ra))
        changed += diff
        mark = "**" if diff else ""
        out.append(f"| {label} | {tags(rb)} | {mark}{tags(ra)}{mark} | {filed(rb)} | {mark}{filed(ra)}{mark} |")
    out.append(f"\n{changed} of {len(CASES)} cases changed.\n")
    return changed
if __name__ == "__main__":
    lines = []; run(sys.argv[1], sys.argv[2], sys.argv[3], lines); print("\n".join(lines))
