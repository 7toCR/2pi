#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Replace [MISSING: ...] markers in a draft with author-supplied values.

Workflow:
    python check_paper_draft.py draft.md --export-gaps gaps.json   # template, one entry per marker
    # the authors fill in each "value" with the real information
    python fill_gaps.py draft.md gaps.json                          # writes draft.filled.md
    python check_paper_draft.py draft.filled.md --final             # any marker left is an ERROR

The values file is either the exported template ({"gaps": [{"marker": ..., "value": ...}]})
or a plain mapping {"[MISSING: ...]" or "...marker text...": "value"}.

- Only markers with a non-empty value are replaced; the others stay and are listed.
- Replacement is exact: the marker text must match (whitespace-insensitive).
- In the Chinese notes, lines under 材料缺口 that quote a filled marker are removed;
  the rest of the notes is kept unchanged. A separate notes file (one that starts with
  the notes headings) is filled with the same values file and loses the line of every
  marker given a value.
- Line endings of the input are kept.
- The input file is never overwritten unless --in-place is given.

After filling, re-read every sentence that contains a new value — and any sentence
that depends on it (Abstract numbers, captions, the Limitations paragraph).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

MISSING_RE = re.compile(r"\[MISSING\s*[:：]\s*(?P<body>[^\]]*)\]", re.I)
NOTES_HEADING_RE = re.compile(r"^\s*(?:#+\s*|\*\*)\s*(?:材料缺口|待核验事项|待核验|主要修改|中文说明)")
GAP_HEADING_RE = re.compile(r"^\s*(?:#+\s*|\*\*)\s*材料缺口")
ANY_HEADING_RE = re.compile(r"^\s*(?:#+\s+|\*\*[^*]+\*\*\s*$)")


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def load_values(path: Path) -> dict[str, str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    pairs: list[tuple[str, str]] = []
    if isinstance(data, dict) and isinstance(data.get("gaps"), list):
        pairs = [(g.get("marker", ""), g.get("value", "")) for g in data["gaps"]]
    elif isinstance(data, dict):
        pairs = list(data.items())
    else:
        raise SystemExit("error: values file must be the exported template or a {marker: value} mapping")
    values: dict[str, str] = {}
    for marker, value in pairs:
        if not isinstance(value, str) or not value.strip():
            continue
        m = MISSING_RE.fullmatch(marker.strip())
        key = norm(m.group("body")) if m else norm(marker)
        values[key] = value.strip()
    return values


def fill(text: str, values: dict[str, str]) -> tuple[str, int, set[str], list[str]]:
    lines = text.splitlines(keepends=True)
    notes_start = next((i for i, ln in enumerate(lines) if NOTES_HEADING_RE.match(ln)), len(lines))
    replaced = 0
    filled: set[str] = set()

    def sub(m: re.Match) -> str:
        nonlocal replaced
        key = norm(m.group("body"))
        if key in values:
            replaced += 1
            filled.add(key)
            return values[key]
        return m.group(0)

    body = [MISSING_RE.sub(sub, ln) for ln in lines[:notes_start]]
    if notes_start == 0:
        # A separate notes file (it starts with the notes headings): drop the line of every marker
        # given a value. Pass only values whose markers were actually filled in the manuscript.
        filled = set(values)
    notes: list[str] = []
    in_gap_section = False
    for ln in lines[notes_start:]:
        if ANY_HEADING_RE.match(ln) or NOTES_HEADING_RE.match(ln):
            in_gap_section = bool(GAP_HEADING_RE.match(ln))
        if in_gap_section and any(norm(m.group("body")) in filled for m in MISSING_RE.finditer(ln)):
            continue
        notes.append(ln)
    out = "".join(body + notes)
    remaining = [m.group(0) for m in MISSING_RE.finditer("".join(body))]
    return out, replaced, filled, remaining


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Fill [MISSING: ...] markers with author-supplied values.")
    ap.add_argument("draft", type=Path)
    ap.add_argument("values", type=Path, help="Exported gaps template or {marker: value} JSON")
    ap.add_argument("-o", "--output", type=Path, help="Output file (default: <draft>.filled<suffix>)")
    ap.add_argument("--in-place", action="store_true", help="Overwrite the draft (only when the author agrees)")
    args = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        pass
    # newline="" keeps the draft's own line endings (no LF -> CRLF rewrite on Windows).
    with open(args.draft, encoding="utf-8", newline="") as fh:
        text = fh.read()
    values = load_values(args.values)
    out_text, replaced, filled, remaining = fill(text, values)
    out = args.draft if args.in_place else (args.output or args.draft.with_name(
        f"{args.draft.stem}.filled{args.draft.suffix}"))
    with open(out, "w", encoding="utf-8", newline="") as fh:
        fh.write(out_text)
    unused = sorted(set(values) - filled)
    print(f"Filled {len(filled)} marker(s) ({replaced} occurrence(s)) -> {out}")
    if unused:
        print(f"{len(unused)} value(s) matched no marker in the paper text:")
        for key in unused:
            print(f"  - [MISSING: {key[:80]}]")
    if remaining:
        print(f"{len(remaining)} marker(s) still open:")
        for marker in dict.fromkeys(remaining):
            print(f"  - {marker[:100]}")
    else:
        print("No markers left. Run check_paper_draft.py --final before submission.")
    print("Re-read each filled sentence and anything that depends on it (Abstract, captions, Limitations).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
