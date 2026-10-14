#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Mechanical checks for an SCI paper draft or a reviewer-response letter.

Reads Markdown (.md), LaTeX (.tex), Word (.docx, text only) or plain text and
reports the defects that are easy to miss when re-reading your own draft:

- gap markers: empty/vague [MISSING] markers, non-standard placeholders
  (TODO, TBD, [citation needed] ...), markers not listed in the gap notes;
- structure: title, abstract and core sections (full manuscripts), abstract
  and title word limits, citations inside the abstract;
- cross-references: figures, tables and equations cited but not defined,
  defined but never cited, cited out of order, positional references
  ("the figure above"), mixed numbering styles, missing panels, undefined
  LaTeX labels;
- citations: keys or numbers missing from the reference list / .bib,
  references never cited, entries without a year;
- acronyms used before their definition or never defined;
- claim strength: priority/superlative claims, "significant" without
  statistics, absolute wording, percentage differences written as relative
  percentages, leakage of the DR_CAN teaching examples, numbers glued to units;
- consistency: numbers in the Abstract/Conclusion that the body never states,
  Conclusion/Abstract sentences copied from Results/Discussion;
- paper layer: drafting/verification remarks inside the paper text, boundary
  overload (disclaimer runs, an Abstract or Conclusion spent on limitations),
  over-long gap markers, Methods settings listed without a stated purpose,
  implementation conventions crowding core method text;
- positioning: descriptions that restate a method's name as its function,
  related-work paragraphs that list cited methods without any comparison;
- submission stage (--final): any remaining marker is an error; --export-gaps
  writes a fill-in template for fill_gaps.py;
- evidence ledger (--ledger): salient numbers in the paper that no ledger entry
  records (at the precision written);
- response letters: completed-tense claims next to missing changes, missing
  Comment/Response/Changes/Location fields, skipped comment numbers,
  thanks-only responses, other reviewers' agreement used as the answer.

Usage:
    python check_paper_draft.py draft.md
    python check_paper_draft.py paper.tex --bib refs.bib --abstract-words 250
    python check_paper_draft.py response.md --mode response
    python check_paper_draft.py draft.md --notes gaps.md --json report.json
    python check_paper_draft.py draft.md --final
    python check_paper_draft.py draft.md --export-gaps gaps.json
    python check_paper_draft.py paper.tex --ledger evidence.json

Exit code 1 when any ERROR is found, otherwise 0. Warnings are heuristics that
need a human judgement; they are not automatically wrong. Passing the checker
says nothing about whether the research is true.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from dataclasses import asdict, dataclass, field
from pathlib import Path
from xml.etree import ElementTree

# --------------------------------------------------------------------------- #
# Report
# --------------------------------------------------------------------------- #

LEVELS = ("ERROR", "WARN", "INFO")


@dataclass
class Finding:
    level: str
    code: str
    where: str
    message: str


@dataclass
class Report:
    path: str = ""
    fmt: str = ""
    mode: str = ""
    findings: list[Finding] = field(default_factory=list)

    def add(self, level: str, code: str, where: str, message: str) -> None:
        self.findings.append(Finding(level, code, where, message))

    def error(self, code: str, where: str, message: str) -> None:
        self.add("ERROR", code, where, message)

    def warn(self, code: str, where: str, message: str) -> None:
        self.add("WARN", code, where, message)

    def info(self, code: str, where: str, message: str) -> None:
        self.add("INFO", code, where, message)

    def count(self, level: str) -> int:
        return sum(1 for f in self.findings if f.level == level)

    def codes(self) -> set[str]:
        return {f.code for f in self.findings}


# --------------------------------------------------------------------------- #
# Document model
# --------------------------------------------------------------------------- #

SECTION_KINDS = [
    ("abstract", r"abstract|摘要"),
    ("references", r"references?|bibliography|works cited|literature cited|参考文献"),
    ("notes", r"材料缺口|主要修改|待核验事项|待核验|中文说明|gap notes|gaps|missing information|notes for authors"),
    ("nomenclature", r"nomenclature|abbreviations?|notations?|list of symbols|symbols|符号说明|符号表"),
    ("acknowledgements", r"acknowledge?ments?|致谢|funding|author contributions?|conflicts? of interest|"
                         r"competing interests?|data availability|declarations?|ethics"),
    ("appendix", r"appendix|appendices|supplementary|附录"),
    ("introduction", r"introduction|引言|绪论|前言"),
    ("related", r"related work|literature review|background|prior work|相关工作|文献综述|研究现状"),
    ("methods", r"experimental (?:setup|set-up|design|procedure|settings?|details)|implementation details|"
                r"simulation (?:setup|settings?)|materials and methods"),
    ("results", r"results?|findings|experiments?|experimental results|numerical results|simulation results|"
                r"evaluation|experimental evaluation|performance evaluation|case stud(?:y|ies)|实验结果|结果"),
    ("discussion", r"discussions?|讨论"),
    ("conclusion", r"conclusions?|concluding remarks|summary|结论|总结"),
    ("methods", r"methods?|methodology|materials|(?:the )?proposed|approach|model(?:ing|ling)?|framework|"
                r"formulation|problem (?:statement|formulation|definition)|preliminar(?:y|ies)|system|algorithms?|"
                r"theory|theoretical|analysis|data(?:sets?)?|study (?:area|design|site)|方法|模型|理论|实验"),
]
ANYWHERE_KINDS = ("abstract", "references", "introduction", "results", "discussion", "conclusion")
CORE_KINDS = ("introduction", "methods", "results", "discussion", "conclusion")
NON_BODY = {"title", "references", "notes", "latex_preamble", "nomenclature", "acknowledgements", "yaml"}
NUMBERING_RE = re.compile(r"^\s*(?:(?:\d+(?:\.\d+)*|[IVXLC]+|[A-Z])[\.)]\s*|\d+(?:\.\d+)*\s+)")
STRICT_SECTION_RE = re.compile(
    r"(?:abstract|introduction|related work|literature review|background|methods?|methodology|materials and methods|"
    r"experiments?|experimental setup|results?|results and discussions?|discussions?|conclusions?|"
    r"conclusions and future work|references|acknowledge?ments?|nomenclature|appendix|摘要|引言|方法|结果|讨论|结论|"
    r"参考文献|致谢)",
    re.I)


def clean_heading(text: str) -> str:
    clean = re.sub(r"[*_`#]", "", text).strip()
    clean = NUMBERING_RE.sub("", clean).strip().rstrip(":：.").strip()
    return clean


def classify_heading(text: str) -> str:
    low = clean_heading(text).lower()
    for kind, pattern in SECTION_KINDS:
        if re.match(rf"(?:{pattern})(?![a-z])", low):
            return kind
    if len(low) <= 60:
        for kind, pattern in SECTION_KINDS:
            if kind in ANYWHERE_KINDS and re.search(rf"(?<![a-z])(?:{pattern})(?![a-z])", low):
                return kind
    return "other"


def is_section_name(text: str) -> bool:
    return bool(STRICT_SECTION_RE.fullmatch(clean_heading(text)))


@dataclass
class Line:
    no: int            # 1-based line number in the source
    raw: str           # original text (after comment stripping)
    prose: str         # text with math, code, URLs and markup removed
    kind: str = "other"
    section: str = ""  # heading text of the enclosing section
    heading: bool = False
    caption: bool = False
    src: str = ""      # "file line N" when the line comes from an \input/\include file


@dataclass
class Document:
    path: Path
    fmt: str
    lines: list[Line]
    title: str | None = None
    title_line: int | None = None
    labels: dict[str, int] = field(default_factory=dict)       # LaTeX label -> line
    label_refs: list[tuple[str, int]] = field(default_factory=list)
    bib_keys: set[str] | None = None
    bib_missing_year: list[str] = field(default_factory=list)
    has_proof_context: bool = False
    origins: list[str] | None = None  # per flattened line: where it came from (multi-file LaTeX)
    missing_inputs: list[tuple[str, int]] = field(default_factory=list)

    def loc(self, no: int | None) -> str:
        if no is not None and self.origins and 0 < no <= len(self.origins):
            return self.origins[no - 1]
        return f"line {no}"

    def text_of(self, kinds: set[str] | None = None, exclude: set[str] | None = None,
                prose: bool = True, skip_headings: bool = True) -> list[Line]:
        out = []
        for ln in self.lines:
            if skip_headings and ln.heading:
                continue
            if kinds is not None and ln.kind not in kinds:
                continue
            if exclude is not None and ln.kind in exclude:
                continue
            out.append(ln)
        return out

    def kinds_present(self) -> set[str]:
        return {ln.kind for ln in self.lines if ln.heading} | {ln.kind for ln in self.lines if ln.kind == "abstract"}


def where(ln: Line | None) -> str:
    if ln is None:
        return "-"
    name = ln.section if len(ln.section) <= 28 else ln.section[:27] + "…"
    sec = f" [{name}]" if name else ""
    return f"{ln.src or f'line {ln.no}'}{sec}"


# ---------------------------- readers ------------------------------------- #

def read_docx(path: Path) -> list[str]:
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    with zipfile.ZipFile(path) as z:
        root = ElementTree.fromstring(z.read("word/document.xml"))
    out: list[str] = []
    for p in root.iter(f"{{{ns['w']}}}p"):
        style = p.find("w:pPr/w:pStyle", ns)
        sid = style.get(f"{{{ns['w']}}}val", "") if style is not None else ""
        text = "".join(t.text or "" for t in p.iter(f"{{{ns['w']}}}t"))
        m = re.match(r"(?i)heading\s*(\d)|^(\d)$", sid)
        if sid.lower() == "title" and text.strip():
            out.append(f"# {text.strip()}")
        elif m and text.strip():
            level = int(m.group(1) or m.group(2))
            out.append("#" * min(level + 1, 6) + " " + text.strip())
        else:
            out.append(text)
        out.append("")
    return out


PLAIN_HEADING_RE = re.compile(
    r"^\s*(?:(?:\d+(?:\.\d+)*|[IVX]+)\.?\s+)?"
    r"(abstract|introduction|related work|literature review|background|methods?|methodology|"
    r"materials and methods|experiments?|experimental setup|results?|results and discussion|discussion|"
    r"conclusions?|references|acknowledge?ments?|nomenclature|摘要|引言|方法|结果|讨论|结论|参考文献)\s*[:：]?\s*$",
    re.I,
)


def promote_plain_headings(raw: list[str]) -> list[str]:
    out = []
    for s in raw:
        if not s.lstrip().startswith("#") and PLAIN_HEADING_RE.match(s):
            num = re.match(r"^\s*(\d+(?:\.\d+)*)", s)
            depth = len(num.group(1).split(".")) if num else 1
            out.append("#" * min(1 + depth, 6) + " " + s.strip())
        else:
            out.append(s)
    return out


# ---------------------------- prose cleaning ------------------------------ #

INLINE_MATH_RE = re.compile(r"(?<!\\)\$(?!\$)(?:\\.|[^$\\])+\$")
URL_RE = re.compile(r"https?://\S+|www\.\S+|\b10\.\d{4,9}/\S+")


def clean_md_inline(s: str) -> str:
    s = re.sub(r"`[^`]*`", " ", s)
    s = INLINE_MATH_RE.sub(" ", s)
    s = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", s)      # images -> alt text
    s = re.sub(r"\[([^\]]+)\]\((?:[^)]*)\)", r"\1", s)    # links -> text
    s = URL_RE.sub(" ", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"[*_]{1,3}", "", s)
    return s


def clean_tex_inline(s: str) -> str:
    s = INLINE_MATH_RE.sub(" ", s)
    s = re.sub(r"\\\(.*?\\\)", " ", s)
    s = re.sub(r"\\(?:cite[a-z]*|[cC]?ref|eqref|autoref|label|url|href|includegraphics|input|include)\*?"
               r"(?:\[[^\]]*\])*\{[^}]*\}", " ", s)
    s = URL_RE.sub(" ", s)
    s = re.sub(r"\\[a-zA-Z]+\*?(?:\[[^\]]*\])?", " ", s)
    s = s.replace("{", "").replace("}", "").replace("~", " ")
    return s


def strip_tex_comment(s: str) -> str:
    return re.sub(r"(?<!\\)%.*$", "", s)


# ---------------------------- parsing ------------------------------------- #

TEX_INPUT_RE = re.compile(r"\\(?:input|include|subfile)\s*\{([^}]+)\}")


def read_tex_tree(main: Path) -> tuple[list[str], list[str], list[tuple[str, int]]]:
    r"""Inline \input, \include and \subfile files, resolved against the main file's folder as LaTeX does.

    Returns the flattened lines, the origin of each line ("sections/methods.tex line 12"; lines of
    the main file keep "line N") and the inputs that could not be found (name, flattened line).
    """
    main = main.resolve()
    root = main.parent
    out: list[str] = []
    origins: list[str] = []
    missing: list[tuple[str, int]] = []

    def visit(path: Path, stack: tuple[Path, ...]) -> None:
        rel = path.relative_to(root).as_posix() if path.is_relative_to(root) else path.name
        for no, s in enumerate(path.read_text(encoding="utf-8-sig", errors="replace").splitlines(), start=1):
            out.append(s)
            origins.append(f"line {no}" if path == main else f"{rel} line {no}")
            for m in TEX_INPUT_RE.finditer(strip_tex_comment(s)):
                name = m.group(1).strip()
                child = root / name
                if not child.suffix or not child.exists():
                    child = child.with_name(child.name + ".tex") if not child.name.endswith(".tex") else child
                child = child.resolve()
                if not child.exists():
                    missing.append((name, len(out)))
                elif child not in stack and len(stack) < 10:
                    visit(child, stack + (child,))

    visit(main, (main,))
    return out, origins, missing


def load_document(path: Path, fmt: str | None = None) -> Document:
    suffix = path.suffix.lower()
    fmt = fmt or {".tex": "tex", ".md": "md", ".markdown": "md", ".docx": "docx"}.get(suffix, "txt")
    origins: list[str] | None = None
    missing: list[tuple[str, int]] = []
    if fmt == "docx":
        raw = read_docx(path)
        fmt_eff = "md"
    elif fmt == "tex":
        raw, origins, missing = read_tex_tree(path)
        fmt_eff = fmt
        if not any(" line " in o for o in origins):
            origins = None  # nothing was inlined: plain "line N" positions
    else:
        raw = path.read_text(encoding="utf-8-sig", errors="replace").splitlines()
        fmt_eff = fmt
    if fmt in ("txt", "docx"):
        raw = promote_plain_headings(raw)
        fmt_eff = "md"
    doc = parse_tex(path, raw) if fmt_eff == "tex" else parse_md(path, raw)
    doc.fmt = fmt
    doc.missing_inputs = missing
    if origins:
        doc.origins = origins
        for ln in doc.lines:
            if origins[ln.no - 1] != f"line {ln.no}":
                ln.src = origins[ln.no - 1]
    return doc


def parse_md(path: Path, raw: list[str]) -> Document:
    lines: list[Line] = []
    in_fence = in_math = in_comment = False
    stack: list[tuple[int, str]] = []
    kind, section = "preamble", ""
    title = None
    title_line = None
    abstract_para = False
    yaml_end = 0
    if raw and raw[0].strip() == "---":
        yaml_end = next((j + 1 for j in range(1, len(raw)) if raw[j].strip() in ("---", "...")), 0)
        for j in range(1, max(yaml_end - 1, 1)):
            t = re.match(r"^title:\s*(.+)$", raw[j])
            if t and title is None:
                title, title_line = t.group(1).strip().strip("'\""), j + 1
    for i, s in enumerate(raw, start=1):
        if i <= yaml_end:  # pandoc/JOSS YAML metadata block
            lines.append(Line(i, "", "", "yaml", ""))
            continue
        text = s
        # HTML comments (possibly multi-line)
        if in_comment:
            if "-->" in text:
                text = text.split("-->", 1)[1]
                in_comment = False
            else:
                lines.append(Line(i, "", "", kind, section))
                continue
        text = re.sub(r"<!--.*?-->", " ", text)
        if "<!--" in text:
            text = text.split("<!--", 1)[0]
            in_comment = True
        if re.match(r"^\s*(```|~~~)", text):
            in_fence = not in_fence
            lines.append(Line(i, "", "", kind, section))
            continue
        if in_fence:
            lines.append(Line(i, "", "", kind, section))
            continue
        # display math $$ ... $$
        prose_src = text
        if in_math:
            if "$$" in text:
                in_math = False
                prose_src = text.split("$$", 1)[1]
            else:
                lines.append(Line(i, text, "", kind, section))
                continue
        while "$$" in prose_src:
            before, rest = prose_src.split("$$", 1)
            if "$$" in rest:
                prose_src = before + " " + rest.split("$$", 1)[1]
            else:
                prose_src = before
                in_math = True
        h = re.match(r"^(#{1,6})\s+(.*?)\s*#*\s*$", text)
        if h:
            level, htext = len(h.group(1)), h.group(2).strip()
            k = classify_heading(htext)
            while stack and stack[-1][0] >= level:
                stack.pop()
            if level == 1 and title is None and not lines_have_heading(lines) and not is_section_name(htext):
                title, title_line = clean_md_inline(htext).strip(), i
                k = "title"
            elif k == "other" and stack and stack[-1][1] not in ("title", "preamble"):
                k = stack[-1][1]
            stack.append((level, k))
            kind, section = k, clean_md_inline(htext).strip()
            abstract_para = False
            lines.append(Line(i, text, clean_md_inline(htext), kind, section, heading=True))
            continue
        # "Abstract: ..." / "**Abstract**—..." paragraph without a heading
        if re.match(r"^\s*(?:\*\*|__)?\s*Abstract\s*(?:\*\*|__)?\s*[:.\u2014\u2013-]", text, re.I) and kind in (
                "preamble", "title"):
            abstract_para = True
        if abstract_para and not text.strip():
            abstract_para = False
        k = "abstract" if abstract_para else kind
        lines.append(Line(i, text, clean_md_inline(prose_src), k, "Abstract" if abstract_para else section))
    return Document(path=path, fmt="md", lines=lines, title=title, title_line=title_line)


def lines_have_heading(lines: list[Line]) -> bool:
    return any(ln.heading for ln in lines)


def balanced_arg(text: str, start: int) -> tuple[str, int]:
    """Return the content of the {...} group starting at text[start] == '{'."""
    depth, j = 0, start
    while j < len(text):
        c = text[j]
        if c == "{" and (j == 0 or text[j - 1] != "\\"):
            depth += 1
        elif c == "}" and (j == 0 or text[j - 1] != "\\"):
            depth -= 1
            if depth == 0:
                return text[start + 1:j], j
        j += 1
    return text[start + 1:], len(text)


def parse_tex(path: Path, raw: list[str]) -> Document:
    stripped = [strip_tex_comment(s) for s in raw]
    full = "\n".join(stripped)
    doc_start = next((i for i, s in enumerate(stripped) if "\\begin{document}" in s), -1)
    lines: list[Line] = []
    kind, section = ("latex_preamble" if doc_start >= 0 else "preamble"), ""
    stack: list[tuple[int, str]] = []
    in_abs = in_bib = in_math = False
    math_envs = r"equation|align|gather|multline|eqnarray|displaymath|math|split|alignat|flalign"
    levels = {"part": 0, "chapter": 0, "section": 1, "subsection": 2, "subsubsection": 3}
    for i, s in enumerate(stripped, start=1):
        if i - 1 == doc_start:
            kind = "preamble"
        if re.search(r"\\begin\{abstract\}", s):
            in_abs = True
        if re.search(r"\\begin\{thebibliography\}", s):
            in_bib = True
        if re.search(rf"\\begin\{{(?:{math_envs})\*?\}}", s) or re.match(r"^\s*\\\[", s):
            in_math = True
        sec = re.search(r"\\(part|chapter|section|subsection|subsubsection)\*?\s*(?:\[[^\]]*\])?\s*\{", s)
        prose = "" if in_math else clean_tex_inline(s)
        if sec:
            htext, _ = balanced_arg(s, sec.end() - 1)
            level = levels[sec.group(1)]
            k = classify_heading(clean_tex_inline(htext))
            while stack and stack[-1][0] >= level:
                stack.pop()
            if k == "other" and stack:
                k = stack[-1][1]
            stack.append((level, k))
            kind, section = k, clean_tex_inline(htext).strip()
            lines.append(Line(i, s, clean_tex_inline(htext), kind, section, heading=True))
        else:
            k = "abstract" if in_abs else ("references" if in_bib else kind)
            lines.append(Line(i, s, prose, k, "Abstract" if in_abs else ("References" if in_bib else section)))
        if re.search(r"\\end\{abstract\}", s):
            in_abs = False
        if re.search(r"\\end\{thebibliography\}", s):
            in_bib = False
        if re.search(rf"\\end\{{(?:{math_envs})\*?\}}", s) or re.search(r"\\\]\s*$", s):
            in_math = False
    doc = Document(path=path, fmt="tex", lines=lines)
    t = re.search(r"\\title\s*(?:\[[^\]]*\])?\s*\{", full)
    if t:
        ttext, _ = balanced_arg(full, t.end() - 1)
        doc.title = re.sub(r"\s+", " ", clean_tex_inline(ttext.replace("\\\\", " "))).strip()
        doc.title_line = full[:t.start()].count("\n") + 1
    for m in re.finditer(r"\\label\{([^}]+)\}", full):
        doc.labels.setdefault(m.group(1).strip(), full[:m.start()].count("\n") + 1)
    for m in re.finditer(r"\\(?:[cC]ref|ref|eqref|autoref|pageref|vref|nameref)\*?\{([^}]+)\}", full):
        for key in m.group(1).split(","):
            doc.label_refs.append((key.strip(), full[:m.start()].count("\n") + 1))
    return doc


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def paragraphs(lines: list[Line]) -> list[list[Line]]:
    """Group lines into paragraphs: a blank line, a heading or a jump in line numbers ends one."""
    paras: list[list[Line]] = []
    cur: list[Line] = []
    last_no = None
    for ln in lines:
        breaks = (last_no is not None and ln.no != last_no + 1) or ln.heading or not ln.prose.strip()
        if breaks and cur:
            paras.append(cur)
            cur = []
        if not ln.heading and ln.prose.strip():
            cur.append(ln)
        last_no = ln.no
    if cur:
        paras.append(cur)
    return paras


ABBREV_PROTECT = ["Fig.", "Figs.", "Eq.", "Eqs.", "et al.", "e.g.", "i.e.", "vs.", "Ref.", "Refs.", "No.",
                  "approx.", "resp.", "cf.", "Dr.", "Prof.", "Sec.", "Tab.", "etc.)"]


def sentences(text: str) -> list[str]:
    t = text
    for a in ABBREV_PROTECT:
        t = t.replace(a, a.replace(".", "§"))
    parts = re.split(r"(?<=[.!?。！？])\s+(?=[A-Z\[(\"“0-9])|(?<=[。！？])", t)
    return [p.replace("§", ".").strip() for p in parts if p.strip()]


def roman_to_int(s: str) -> int | None:
    vals = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100}
    if not re.fullmatch(r"[IVXLC]+", s):
        return None
    total, prev = 0, 0
    for c in reversed(s):
        v = vals[c]
        total = total - v if v < prev else total + v
        prev = max(prev, v)
    return total


def expand_number_list(spec: str) -> list[int]:
    nums: list[int] = []
    for part in re.split(r"\s*(?:,|;|\band\b|&)\s*", spec):
        part = part.strip()
        if not part:
            continue
        rng = re.match(r"^(\d+)\s*(?:[-–—]|to)\s*(\d+)$", part)
        if rng:
            a, b = int(rng.group(1)), int(rng.group(2))
            if 0 < b - a < 200:
                nums.extend(range(a, b + 1))
            else:
                nums.extend([a, b])
        elif part.isdigit():
            nums.append(int(part))
    return nums


def norm_num(token: str) -> str | None:
    try:
        v = float(token.replace(",", ""))
    except ValueError:
        return None
    return f"{v:.6g}"


def group_key_findings(report: Report, level: str, code: str, hits: list[tuple[str, Line]], template: str) -> None:
    """One finding per distinct phrase: first location + count."""
    grouped: dict[str, list[tuple[str, Line]]] = {}
    for phrase, ln in hits:
        grouped.setdefault(phrase.lower(), []).append((phrase, ln))
    for items in grouped.values():
        extra = f" ({len(items)} occurrences)" if len(items) > 1 else ""
        report.add(level, code, where(items[0][1]), template.format(phrase=items[0][0]) + extra)


# --------------------------------------------------------------------------- #
# Checks: gap markers and placeholders
# --------------------------------------------------------------------------- #

MISSING_RE = re.compile(r"\[MISSING(?P<colon>\s*[:：])?(?P<body>[^\]]*)\]", re.I)
VAGUE_MISSING = {"", "details", "detail", "info", "information", "data", "tbd", "todo", "xxx", "...", "…",
                 "missing", "to be added", "n/a", "value", "values", "citation", "ref", "reference"}
PLACEHOLDER_RE = re.compile(
    r"\bTODO\b|\bTBD\b|\bXXX+\b|\?\?+|\[citation needed\]|\[(?:REF|CITE|cite|ref|\?)\]|\(Author,?\s*Year\)|"
    r"【待补充[^】]*】|待补充|lorem ipsum|\bINSERT\s+[A-Z]+\b",
    re.I,
)


def check_gaps(doc: Document, report: Report, notes_text: str | None) -> list[str]:
    markers: list[tuple[str, Line]] = []
    for ln in doc.lines:
        if ln.kind == "notes":
            continue
        for m in MISSING_RE.finditer(ln.raw):
            body = m.group("body").strip()
            if not m.group("colon") or body.lower().strip(" .") in VAGUE_MISSING or len(body) < 4:
                report.error("G01", where(ln), f"Gap marker '{m.group(0)}' is empty or vague; write "
                                               f"[MISSING: <exactly what the author must supply>].")
            elif len(body.split()) > 15:
                report.warn("G06", where(ln), f"Gap marker has {len(body.split())} words: name the missing item "
                                              f"only; why it is missing and what was searched go in the memo.")
            markers.append((body, ln))
        scan = MISSING_RE.sub(" ", ln.raw)
        for m in PLACEHOLDER_RE.finditer(scan):
            report.warn("G02", where(ln), f"Non-standard placeholder '{m.group(0)}'; use "
                                          f"[MISSING: specific information] so gaps are tracked.")
    if markers:
        listing = "; ".join(f"{ln.src or f'line {ln.no}'}: {b[:60]}" for b, ln in markers[:12])
        more = f"; … {len(markers) - 12} more" if len(markers) > 12 else ""
        report.info("G03", "-", f"{len(markers)} gap marker(s) — {listing}{more}")
        in_front = [(b, ln) for b, ln in markers if ln.kind in ("abstract", "title")]
        if in_front:
            report.info("G05", where(in_front[0][1]), f"{len(in_front)} gap marker(s) in the Title/Abstract: "
                                                      f"acceptable only in a provisional abstract.")
        if notes_text is None:
            report.info("G04", "-", "No gap notes found (section '材料缺口'/'Gaps' or --notes); list every "
                                    "marker there, quoting its text.")
        else:
            norm_notes = re.sub(r"\s+", " ", notes_text.lower())
            seen = set()
            for body, ln in markers:
                key = re.sub(r"\s+", " ", body.lower()).strip()
                if not key or key in seen:
                    continue
                seen.add(key)
                if key not in norm_notes:
                    report.warn("G04", where(ln), f"Marker '[MISSING: {body[:60]}]' is not listed in the gap "
                                                  f"notes (quote the marker text there).")
    return [b for b, _ in markers]


def check_final(doc: Document, report: Report) -> None:
    """Submission stage: every remaining marker or provisional label is an error."""
    for ln in doc.lines:
        if ln.kind == "notes":
            continue
        for m in MISSING_RE.finditer(ln.raw):
            report.error("G07", where(ln), f"Unresolved gap marker in a submission draft: {m.group(0)[:90]}")
        if re.search(r"Provisional abstract|暂定草稿", ln.raw, re.I):
            report.error("G07", where(ln), "Provisional-abstract label in a submission draft; rewrite the abstract "
                                           "from the finished body.")


def export_gaps(doc: Document, path: Path) -> int:
    """Write a fill-in template: one entry per distinct marker, with the lines where it occurs."""
    entries: dict[str, dict] = {}
    for ln in doc.lines:
        if ln.kind == "notes":
            continue
        for m in MISSING_RE.finditer(ln.raw):
            e = entries.setdefault(m.group(0), {"marker": m.group(0), "lines": [], "section": ln.section, "value": ""})
            e["lines"].append(ln.no)
    path.write_text(json.dumps({"draft": str(doc.path), "instructions": "Fill each 'value' with the real "
                                "information (leave empty to keep the marker), then run fill_gaps.py.",
                                "gaps": list(entries.values())}, ensure_ascii=False, indent=2), encoding="utf-8")
    return len(entries)


def notes_from_doc(doc: Document) -> str | None:
    lines = [ln.raw for ln in doc.lines if ln.kind == "notes"]
    return "\n".join(lines) if lines else None


# --------------------------------------------------------------------------- #
# Checks: structure
# --------------------------------------------------------------------------- #

def word_count(text: str) -> int:
    latin = re.findall(r"[A-Za-z0-9]+(?:[-'’][A-Za-z0-9]+)*", text)
    cjk = re.findall(r"[\u4e00-\u9fff]", text)
    return len(latin) + len(cjk)


def check_structure(doc: Document, report: Report, args: argparse.Namespace) -> None:
    kinds = doc.kinds_present()
    abstract_lines = [ln for ln in doc.lines if ln.kind == "abstract" and not ln.heading]
    abstract_text = " ".join(ln.prose for ln in abstract_lines)
    abstract_text = re.sub(r"^\s*Abstract\s*[:.\u2014\u2013-]\s*", "", abstract_text, flags=re.I)
    if not doc.title:
        report.warn("S01", "-", "No title found (Markdown: first '# ' heading; LaTeX: \\title{}).")
    if not abstract_lines:
        report.warn("S02", "-", "No abstract found (heading 'Abstract', an 'Abstract:' paragraph, or "
                                "\\begin{abstract}).")
    missing = []
    if "introduction" not in kinds:
        missing.append("Introduction")
    if "methods" not in kinds:
        missing.append("Methods")
    if "results" not in kinds and "discussion" not in kinds:
        missing.append("Results/Discussion")
    if "conclusion" not in kinds and "discussion" not in kinds:
        missing.append("Conclusion (or Discussion)")
    if missing:
        report.warn("S03", "-", "Core section(s) not found: " + ", ".join(missing) +
                    ". Ignore if the journal uses other names or this is a partial draft (--mode section).")
    if abstract_lines:
        n = word_count(abstract_text)
        if args.abstract_words and n > args.abstract_words:
            report.error("S04", where(abstract_lines[0]), f"Abstract has {n} words; limit is {args.abstract_words} "
                                                          f"(counted as Latin word tokens + CJK characters).")
        else:
            report.info("S04", where(abstract_lines[0]), f"Abstract length: {n} words.")
        for ln in abstract_lines:
            if re.search(r"\[\d+(?:\s*[-–,]\s*\d+)*\](?!\()|\\cite|\[@", ln.raw):
                report.warn("S06", where(ln), "Citation inside the Abstract; most journals do not allow it.")
                break
    if doc.title:
        n = word_count(doc.title)
        if args.title_words and n > args.title_words:
            report.error("S05", doc.loc(doc.title_line), f"Title has {n} words; limit is {args.title_words}.")


# --------------------------------------------------------------------------- #
# Checks: figures, tables, equations, LaTeX labels
# --------------------------------------------------------------------------- #

FIG_CAPTION_RE = re.compile(
    r"^\s*(?:[>|]\s*)?(?:\*\*|__|\*|_)?\s*(?:Figure|Fig\.)\s*(\d+)\s*(?:\*\*|__|\*|_)?\s*(?:[.:|\u2014\u2013-]|$)",
    re.I)
TAB_CAPTION_RE = re.compile(
    r"^\s*(?:[>|]\s*)?(?:\*\*|__|\*|_)?\s*Table\s+(\d+|[IVXLC]+)\s*(?:\*\*|__|\*|_)?\s*(?:[.:|\u2014\u2013-]|$)")
IMG_ALT_RE = re.compile(r"!\[\s*(?:Figure|Fig\.)\s*(\d+)\b", re.I)
FIG_WORD_RE = re.compile(r"\b(?:Figures?|Figs?\.|Fig)\s*~?\s*(?=\d)", re.I)
TAB_WORD_RE = re.compile(r"\b[Tt]ables?\s*~?\s*(?=\d|[IVXLC]+\b)")
EQ_WORD_RE = re.compile(r"\b(?:Eqs?\.|Equations?|Eqn?s?\.)\s*~?\s*(?=\(?\d)", re.I)
SEP_RE = re.compile(r"\s*(,|;|and|&|[-–—]|to)\s*", re.I)
VAGUE_REF_RE = re.compile(
    r"\b(?:the\s+)?(?:above|below|following|preceding|previous|left|right|upper|lower)\s+(?:figure|table|graph|"
    r"chart|plot|image)s?\b|\b(?:figure|table)s?\s+(?:above|below|on the (?:left|right))\b|"
    r"\bas shown (?:above|below)\b|上图|下图|左图|右图|上表|下表|如下图|如上图",
    re.I)


def parse_ref_items(text: str, pos: int, kind: str) -> list[tuple[int, list[str], str]]:
    """Parse '2', '2a', '2(a)-(c)', '2 and 3', '2-4', 'II', '(3)-(5)' starting at text[pos]."""
    if kind == "fig":
        item_re = re.compile(r"(\d+)((?:[a-z](?![a-z])|\s?\([a-z]\))(?:\s*[-–,]\s*\(?[a-z]\)?(?![a-z]))*)?")
    elif kind == "tab":
        item_re = re.compile(r"(\d+|[IVXLC]+\b)")
    else:
        item_re = re.compile(r"\(?(\d+)\)?")
    items: list[tuple[int, list[str], str]] = []
    pending_range = False
    while True:
        m = item_re.match(text, pos)
        if not m:
            break
        tok = m.group(1)
        num = int(tok) if tok.isdigit() else roman_to_int(tok)
        style = "arabic" if tok.isdigit() else "roman"
        panels: list[str] = []
        if kind == "fig" and m.group(2):
            letters = re.findall(r"[a-z]", m.group(2))
            if re.search(r"[-–]", m.group(2)) and len(letters) == 2:
                letters = [chr(c) for c in range(ord(letters[0]), ord(letters[1]) + 1)]
            panels = letters
        if num is None:
            break
        if pending_range and items and items[-1][0] < num <= items[-1][0] + 200:
            for n in range(items[-1][0] + 1, num):
                items.append((n, [], style))
        items.append((num, panels, style))
        pos = m.end()
        sep = SEP_RE.match(text, pos)
        if not sep or not item_re.match(text, sep.end()):
            break
        pending_range = sep.group(1) in ("-", "–", "—", "to")
        pos = sep.end()
    return items


def caption_defs(doc: Document) -> tuple[dict[int, Line], dict[int, Line], dict[str, int]]:
    figs: dict[int, Line] = {}
    tabs: dict[int, Line] = {}
    tab_styles = {"arabic": 0, "roman": 0}
    prev: Line | None = None
    for ln in doc.lines:
        para_start = prev is None or not prev.raw.strip() or prev.heading or prev.raw.lstrip().startswith(("!", "|"))
        prev = ln
        if ln.kind in ("references", "notes", "latex_preamble") or ln.heading:
            continue
        img = IMG_ALT_RE.search(ln.raw)
        m = FIG_CAPTION_RE.match(ln.raw) if para_start else None
        if img or m:
            figs.setdefault(int((m or img).group(1)), ln)
            ln.caption = True
            continue
        m = TAB_CAPTION_RE.match(ln.raw) if para_start else None
        if m:
            tok = m.group(1)
            num = int(tok) if tok.isdigit() else roman_to_int(tok)
            if num:
                tabs.setdefault(num, ln)
                tab_styles["arabic" if tok.isdigit() else "roman"] += 1
            ln.caption = True
    return figs, tabs, tab_styles


def ref_occurrences(doc: Document, kind: str) -> list[tuple[int, Line, list[str], str]]:
    word_re = {"fig": FIG_WORD_RE, "tab": TAB_WORD_RE, "eq": EQ_WORD_RE}[kind]
    out = []
    for ln in doc.lines:
        if ln.kind in ("references", "notes", "latex_preamble") or ln.heading:
            continue
        text = ln.raw
        if ln.caption:
            # drop the defining label at the start of a caption line
            text = re.sub(r"^\s*(?:[>|]\s*)?(?:\*\*|__|\*|_)?\s*(?:Figure|Fig\.|Table)\s*[0-9IVXLC]+", " ", text,
                          flags=re.I)
            text = IMG_ALT_RE.sub(" ", text)
        text = MISSING_RE.sub(" ", text)
        if kind != "eq":
            text = INLINE_MATH_RE.sub(" ", text)
        for m in word_re.finditer(text):
            for num, panels, style in parse_ref_items(text, m.end(), kind):
                out.append((num, ln, panels, style))
    return out


def check_crossrefs(doc: Document, report: Report, mode: str) -> None:
    if doc.fmt == "tex":
        check_latex_labels(doc, report)
        return
    figs, tabs, tab_styles = caption_defs(doc)
    fig_refs = ref_occurrences(doc, "fig")
    tab_refs = ref_occurrences(doc, "tab")

    for name, defs, refs in (("Fig.", figs, fig_refs), ("Table", tabs, tab_refs)):
        cited: dict[int, Line] = {}
        for n, ln, _, _ in refs:
            cited.setdefault(n, ln)
        if refs and not defs:
            lvl = "warn" if mode == "manuscript" else "info"
            getattr(report, lvl)("F01", where(refs[0][1]),
                                 f"{name} numbers are cited but no captions were found ('Figure N.'/'Table N.' "
                                 f"starting a paragraph), so they cannot be verified.")
            continue
        if not defs:
            continue
        for n, ln in sorted(cited.items()):
            if n not in defs:
                report.error("F01", where(ln), f"{name} {n} is cited but no caption defines it.")
        for n, ln in sorted(defs.items()):
            if n not in cited:
                report.warn("F02", where(ln), f"{name} {n} has a caption but is never cited in the text.")
        nums = sorted(defs)
        if nums != list(range(1, len(nums) + 1)):
            report.warn("F03", where(defs[nums[0]]), f"{name} numbers are not consecutive from 1: {nums}.")
        order: list[int] = []
        for n, _, _, _ in refs:
            if n not in order:
                order.append(n)
        if order != sorted(order):
            bad = next(i for i in range(1, len(order)) if order[i] < max(order[:i]))
            report.warn("F03", where(cited[order[bad]]),
                        f"{name} first cited out of numerical order {order}; most journals number figures and "
                        f"tables in order of first citation.")
    styles = {st for _, _, _, st in tab_refs}
    if (tab_styles["arabic"] and tab_styles["roman"]) or styles == {"arabic", "roman"}:
        report.warn("F05", where(tab_refs[0][1]) if tab_refs else "-",
                    "Tables are numbered with both Arabic and Roman numerals; follow one journal style.")
    for n, ln, panels, _ in fig_refs:
        if n in figs and panels:
            cap_panels = set(re.findall(r"\(([a-z])\)", figs[n].raw))
            for p in panels:
                if cap_panels and p not in cap_panels:
                    report.warn("F06", where(ln), f"Fig. {n}({p}) is cited but the caption of Fig. {n} only "
                                                  f"describes panels {sorted(cap_panels)}.")
    for ln in doc.lines:
        if ln.kind in ("references", "notes") or ln.heading:
            continue
        for m in VAGUE_REF_RE.finditer(ln.prose):
            report.warn("F04", where(ln), f"Positional reference '{m.group(0)}'; cite the figure/table by number.")
    check_equations(doc, report, mode)


def check_equations(doc: Document, report: Report, mode: str) -> None:
    defs: dict[int, Line] = {}
    in_math = False
    has_env = False
    for ln in doc.lines:
        s = ln.raw
        if "$$" in s or in_math:
            for m in re.finditer(r"\\tag\{(\d+)\}", s):
                defs.setdefault(int(m.group(1)), ln)
            m = re.search(r"(?:\$\$|\\q?quad)\s*\((\d+)\)\s*$", s)
            if m:
                defs.setdefault(int(m.group(1)), ln)
            if s.count("$$") % 2 == 1:
                in_math = not in_math
        if re.search(r"\\begin\{(?:equation|align)", s):
            has_env = True
    refs = [(n, ln) for n, ln, _, _ in ref_occurrences(doc, "eq")]
    if not refs:
        return
    if not defs:
        if has_env:
            report.info("E01", where(refs[0][1]), "Equations use LaTeX environments; numbers cannot be verified here.")
        else:
            lvl = "warn" if mode == "manuscript" else "info"
            getattr(report, lvl)("E01", where(refs[0][1]),
                                 "Equation numbers are cited but no numbered equations were found "
                                 "(use \\tag{n} inside $$…$$ or a trailing (n)).")
        return
    for n, ln in refs:
        if n not in defs:
            report.error("E01", where(ln), f"Eq. ({n}) is cited but no displayed equation carries that number.")


def check_latex_labels(doc: Document, report: Report) -> None:
    referenced = {k for k, _ in doc.label_refs}
    for key, line in doc.label_refs:
        if key not in doc.labels:
            report.error("L01", doc.loc(line), f"\\ref{{{key}}} points to an undefined label.")
    for key, line in doc.labels.items():
        if re.match(r"(?:fig|tab|table|figure)[:_-]", key, re.I) and key not in referenced:
            report.warn("L02", doc.loc(line), f"Label '{key}' is never referenced; every figure/table should be "
                                               f"cited in the text.")
    for ln in doc.lines:
        if ln.kind in ("references", "notes", "latex_preamble"):
            continue
        for m in VAGUE_REF_RE.finditer(ln.prose):
            report.warn("F04", where(ln), f"Positional reference '{m.group(0)}'; cite the figure/table by number.")


# --------------------------------------------------------------------------- #
# Checks: citations
# --------------------------------------------------------------------------- #

NUM_CITE_RE = re.compile(r"(?<![\w!\]])\[(\d+(?:\s*[-–—,]\s*\d+)*)\](?![(:\[])")
KEY_CITE_RE = re.compile(r"(?<![\w!])\[([A-Z]{1,4}\d{1,3}(?:\s*,\s*[A-Z]{1,4}\d{1,3})*)\](?![(:])")
PANDOC_CITE_RE = re.compile(r"\[([^\]]*@[\w:.\-]+[^\]]*)\]")
TEX_CITE_RE = re.compile(r"\\(?:cite|citep|citet|citealp|citeauthor|citeyear|autocite|parencite|textcite|"
                         r"footcite|supercite|nocite)\*?(?:\[[^\]]*\])*\{([^}]*)\}")


def parse_bib(path: Path) -> tuple[set[str], list[str]]:
    text = path.read_text(encoding="utf-8", errors="replace")
    keys, no_year = set(), []
    for m in re.finditer(r"@(\w+)\s*\{\s*([^,\s]+)\s*,", text):
        if m.group(1).lower() in ("comment", "preamble", "string"):
            continue
        key = m.group(2)
        keys.add(key)
        nxt = text.find("\n@", m.end())
        body = text[m.end(): nxt if nxt != -1 else len(text)]
        if not re.search(r"\b(?:year|date)\s*=", body, re.I):
            no_year.append(key)
    return keys, no_year


def check_citations(doc: Document, report: Report, bib: Path | None) -> None:
    cites: list[tuple[str, Line]] = []
    if doc.fmt == "tex":
        bibitems = set(re.findall(r"\\bibitem\s*(?:\[[^\]]*\])?\{([^}]+)\}", "\n".join(ln.raw for ln in doc.lines)))
        keys = {k.strip() for k in bibitems}
        bibs: list[Path] = [bib] if bib else []
        if not bibs:
            for ln in doc.lines:
                for m in re.finditer(r"\\(?:bibliography|addbibresource)\{([^}]+)\}", ln.raw):
                    for name in m.group(1).split(","):
                        p = doc.path.parent / name.strip()
                        p = p if p.suffix == ".bib" else p.with_suffix(".bib")
                        if p.exists():
                            bibs.append(p)
        bib_cited_only = set()
        for b in bibs:
            k, no_year = parse_bib(b)
            keys |= k
            bib_cited_only |= k
            for key in no_year:
                report.warn("C04", b.name, f"Bib entry '{key}' has no year/date; verify the record.")
        for ln in doc.lines:
            if ln.kind == "latex_preamble":
                continue
            for m in TEX_CITE_RE.finditer(ln.raw):
                for key in m.group(1).split(","):
                    if key.strip():
                        cites.append((key.strip(), ln))
        if not keys:
            if cites:
                report.info("C01", "-", "No .bib file or \\bibitem entries found; citation keys not verified "
                                        "(pass --bib refs.bib).")
            return
        cited_keys = {k for k, _ in cites}
        for key, ln in cites:
            if key not in keys and key != "*":
                report.error("C01", where(ln), f"Citation key '{key}' is not in the bibliography.")
        # A .bib file may legitimately hold unused entries (BibTeX prints only cited ones);
        # \bibitem entries are printed whether cited or not.
        for key in sorted(keys - cited_keys - bib_cited_only):
            report.warn("C02", "-", f"Reference '{key}' (\\bibitem) is never cited.")
        return

    # Markdown / text
    entries: dict[str, tuple[Line, str]] = {}
    for ln in doc.lines:
        if ln.kind != "references" or ln.heading:
            continue
        m = (re.match(r"^\s*(?:[-*]\s+)?\[(\d+|[A-Za-z][\w:.\-]*)\]\s*(.*)", ln.raw) or
             re.match(r"^\s*(\d+)\.\s+(.*)", ln.raw))
        if m:
            entries.setdefault(m.group(1), (ln, m.group(2)))
    bib_keys: set[str] = set()
    if bib:
        bib_keys, no_year = parse_bib(bib)
        for key in no_year:
            report.warn("C04", bib.name, f"Bib entry '{key}' has no year/date; verify the record.")
    for ln in doc.lines:
        if ln.kind in ("references", "notes"):
            continue
        text = MISSING_RE.sub(" ", ln.raw)
        text = re.sub(r"`[^`]*`", " ", text)
        text = INLINE_MATH_RE.sub(" ", text)
        for m in NUM_CITE_RE.finditer(text):
            nums = expand_number_list(m.group(1).replace("—", "-"))
            lead = text[max(0, m.start() - 18):m.start()].lower()
            if 0 in nums or re.search(r"(?:\bin|range|within|between|interval|∈|from|to)\s*$", lead):
                continue  # an interval such as [0, 1], not a citation
            for n in nums:
                cites.append((str(n), ln))
        for m in KEY_CITE_RE.finditer(text):
            for key in m.group(1).split(","):
                cites.append((key.strip(), ln))
        for m in PANDOC_CITE_RE.finditer(text):
            for key in re.findall(r"@([\w:.\-]+)", m.group(1)):
                cites.append((key.rstrip("."), ln))
    if not cites and not entries:
        return
    known = set(entries) | bib_keys
    if not known:
        report.info("C01", where(cites[0][1]) if cites else "-",
                    "No reference list found (section 'References' with '[n] …' entries, or --bib); "
                    "citations not verified.")
        return
    cited = {}
    for key, ln in cites:
        cited.setdefault(key, ln)
    for key, ln in cited.items():
        if key not in known:
            report.error("C01", where(ln), f"Citation [{key}] has no entry in the reference list.")
    for key, (ln, _) in entries.items():
        if key not in cited:
            report.warn("C02", where(ln), f"Reference [{key}] is never cited in the text.")
    numeric = [int(k) for k, _ in cites if k.isdigit()]
    order = []
    for n in numeric:
        if n not in order:
            order.append(n)
    if order and order != sorted(order):
        report.info("C03", "-", f"Numeric citations are not in order of first appearance ({order[:10]}…); "
                                f"required by numeric styles such as IEEE/Vancouver.")
    for key, (ln, body) in entries.items():
        if "[MISSING" in body.upper():
            continue
        if not re.search(r"\b(?:19|20)\d{2}[a-z]?\b", body):
            report.warn("C04", where(ln), f"Reference [{key}] has no year; verify the bibliographic record.")


# --------------------------------------------------------------------------- #
# Checks: acronyms
# --------------------------------------------------------------------------- #

ACRONYM_RE = re.compile(r"\b([A-Z][A-Z0-9]*[A-Z][A-Z0-9]*)(s?)\b")
COMMON_ACRONYMS = {
    "AI", "CPU", "GPU", "TPU", "RAM", "ROM", "USB", "PDF", "URL", "HTTP", "HTTPS", "API", "IEEE", "ACM", "ISO", "SI",
    "USA", "UK", "EU", "UN", "WHO", "DNA", "RNA", "PCR", "MRI", "CT", "ECG", "EEG", "LED", "GPS", "ID", "OK", "PC",
    "TV", "SCI", "SCIE", "SSCI", "EI", "DOI", "ISBN", "ISSN", "CO2", "H2O", "NOX", "PM2", "PM10", "MISSING", "TODO",
    "TBD", "XXX", "NOTE", "AND", "OR", "NOT", "IF", "THE", "A", "B", "C", "D", "E", "MATLAB", "LaTeX", "ASCII",
    "UTF", "JSON", "XML", "HTML", "CSS", "SQL", "OS", "IOS", "PH", "AC", "DC", "RGB", "UAV", "IT", "ICASSP", "CVPR",
    "ICCV", "ECCV", "NIPS", "ICML", "ICLR", "AAAI", "IJCAI", "KDD", "ACL", "EMNLP", "NAACL", "MICCAI",
}


def check_acronyms(doc: Document, report: Report) -> None:
    stream = [ln for ln in doc.lines if ln.kind not in NON_BODY and not ln.heading]
    nomen = " ".join(ln.prose for ln in doc.lines if ln.kind == "nomenclature")
    defined_in_nomen = set(ACRONYM_RE.findall(nomen))
    defined_in_nomen = {a for a, _ in defined_in_nomen}
    first_use: dict[str, tuple[int, Line]] = {}
    first_def: dict[str, int] = {}
    pos = 0
    for ln in stream:
        text = MISSING_RE.sub(" ", ln.prose)
        text = re.sub(r"\[[^\]]*\]", " ", text)
        for m in ACRONYM_RE.finditer(text):
            acr = m.group(1)
            if acr in COMMON_ACRONYMS or roman_to_int(acr) or len(acr) > 8 or acr.isdigit():
                continue
            if re.fullmatch(r"[A-Z]\d+|\d+[A-Z]+", acr):
                continue
            idx = pos + m.start()
            first_use.setdefault(acr, (idx, ln))
            before = text[:m.start()]
            after = text[m.end():]
            # "Long Form (ACR)" or "ACR (long form)"
            if re.search(r"\(\s*$", before) and re.match(r"s?\s*[),;]", after):
                first_def.setdefault(acr, idx)
            elif re.match(r"s?\s*\(\s*[a-z]", after):
                first_def.setdefault(acr, idx)
        pos += len(text) + 1
    for acr, (idx, ln) in sorted(first_use.items(), key=lambda kv: kv[1][0]):
        if acr in defined_in_nomen:
            continue
        if acr not in first_def:
            report.warn("A02", where(ln), f"Acronym '{acr}' is never defined; spell it out at first use "
                                          f"(or add it to a Nomenclature/Abbreviations list).")
        elif idx < first_def[acr]:
            report.warn("A01", where(ln), f"Acronym '{acr}' is used before its definition.")


# --------------------------------------------------------------------------- #
# Checks: wording and claim strength
# --------------------------------------------------------------------------- #

PRIORITY_RE = re.compile(
    r"\bfor the first time\b|\b(?:the )?first (?:study|work|attempt|paper|method|approach|framework|system|report|"
    r"demonstration|to)\b|\bnovel\b|\bunprecedented\b|\bstate[- ]of[- ]the[- ]art\b|\bSOTA\b|"
    r"\boutperform(?:s|ed|ing)? (?:all|every|existing)\b|\bsuperior to (?:all|every|existing)\b|"
    r"\bno (?:prior|previous|existing|other) (?:work|study|studies|research|method|methods)\b|"
    r"\bha(?:s|ve) never been\b|\b(?:fill|fills|filled|bridge|bridges|bridged) (?:the|this|a|an) (?:\w+ )?gap\b|"
    r"\bbreakthrough\b|\bgroundbreaking\b|\brevolutionary\b|\bbest[- ]in[- ]class\b|\bthe best\b|"
    r"首次|国际领先|国内领先|世界领先|填补.{0,6}空白",
    re.I)
SIGNIF_RE = re.compile(r"\b(?:statistically )?significan(?:t|tly|ce)\b|显著", re.I)
STATS_RE = re.compile(
    r"\bp\s*[<>=≤≥]|\bp-values?\b|\bP\s*=|\bt-tests?\b|\bANOVA\b|Wilcoxon|Mann[- ]Whitney|chi-squared?|χ\s*[2²]|"
    r"confidence intervals?|\bCI\b|±|\+/-|standard deviations?|standard errors?|\bSD\b|\bSEM?\b|bootstrap|"
    r"permutation test|Kruskal|Friedman|McNemar|effect sizes?|Cohen|Bonferroni|Holm|\bF\(\d|"
    r"\bz-tests?\b|regression coefficients?|p值|置信区间|标准差",
    re.I)
ABSOLUTE_RE = re.compile(
    r"\bguarantee[sd]?\b|\bnever fail(?:s|ed)?\b|\bcompletely (?:eliminat|solv|remov|avoid|prevent)\w*|"
    r"\bfully (?:solv|eliminat)\w*|\bperfect(?:ly)?\b|\bconclusively\b|\bundoubtedly\b|\bunquestionabl\w*|"
    r"\balways\b|\b100\s*% (?:accura|reliab|effectiv|success)\w*|保证|彻底|完全解决|毫无疑问",
    re.I)
PROVE_RE = re.compile(r"\bprov(?:e|es|ed|en|ing)\b|证明了", re.I)
TEACHING_RE = re.compile(
    r"World Cup|世界杯|国足|national (?:football|soccer) team|Chinese (?:football|soccer)|61\.78|7\.11\s*%|"
    r"NAMIMO|ram[- ]air|AlphaGo|DR[_ ]?CAN|Bilibili|B站粉丝",
    re.I)
UNIT_GLUE_RE = re.compile(
    r"(?<![\w.])(\d+(?:\.\d+)?)(Hz|kHz|MHz|GHz|THz|dB|dBm|dBi|ms|μs|µs|ns|ps|mm|cm|km|nm|μm|µm|kg|mg|mV|kV|mA|mW|kW|"
    r"MW|GW|kJ|MJ|kPa|MPa|GPa|mL|mol|rpm|bps|kbps|Mbps|Gbps|KB|MB|GB|TB|°C)\b")
CHANGE_RE = re.compile(
    r"(?:\bby|\bof|提高了?|降低了?|提升了?|增加了?|减少了?)\s*(\d+(?:\.\d+)?)\s*%|"
    r"(\d+(?:\.\d+)?)\s*%\s+(?:higher|lower|better|worse|more|less|improvement|increase|decrease|reduction|gain|drop)",
    re.I)
PERCENT_RE = re.compile(r"(\d+(?:\.\d+)?)\s*%")


def check_wording(doc: Document, report: Report, mode: str, masked: set[int]) -> None:
    body = [ln for ln in doc.lines if ln.kind not in ("references", "notes", "latex_preamble", "nomenclature")
            and ln.no not in masked]
    prio, absolute, prove, teach, glue = [], [], [], [], []
    for ln in body:
        text = MISSING_RE.sub(" ", ln.prose)
        for m in PRIORITY_RE.finditer(text):
            prio.append((m.group(0), ln))
        if ln.kind in ("abstract", "results", "discussion", "conclusion", "title", "other", "preamble"):
            for m in ABSOLUTE_RE.finditer(text):
                absolute.append((m.group(0), ln))
        if not doc.has_proof_context:
            for m in PROVE_RE.finditer(text):
                prove.append((m.group(0), ln))
        for m in TEACHING_RE.finditer(ln.raw):
            teach.append((m.group(0), ln))
        for m in UNIT_GLUE_RE.finditer(text):
            glue.append((m.group(0), ln))
    group_key_findings(report, "WARN", "W01", prio,
                       "Priority/superlative claim '{phrase}': needs a documented literature search and a fair "
                       "comparison, otherwise state the specific, scoped contribution.")
    group_key_findings(report, "WARN", "W03", absolute,
                       "Absolute wording '{phrase}': make sure the evidence supports it, or weaken it.")
    group_key_findings(report, "WARN", "W03", prove,
                       "'{phrase}': experiments support or indicate; 'prove' needs a formal proof.")
    group_key_findings(report, "WARN", "W05", teach,
                       "'{phrase}' looks like a DR_CAN teaching example; teaching examples are not research facts "
                       "(ignore if this really is your topic).")
    if glue:
        examples = ", ".join(sorted({g for g, _ in glue})[:5])
        report.warn("N01", where(glue[0][1]), f"Number written without a space before the unit ({examples}); SI "
                                              f"style is '10 Hz' ({len(glue)} occurrence(s)).")

    # "significant" without statistics, per paragraph
    stat_kinds = {"abstract", "results", "discussion", "conclusion", "other", "preamble"}
    for para in paragraphs([ln for ln in body if ln.kind in stat_kinds]):
        text = " ".join(ln.prose for ln in para)
        if not SIGNIF_RE.search(text) or STATS_RE.search(text):
            continue
        for sent in sentences(text):
            m = SIGNIF_RE.search(sent)
            if not m:
                continue
            if re.search(r"\b(?:not|no|without|untested|cannot|neither|nor|whether)\b|未|没有", sent[:m.start()], re.I):
                continue  # "has not been tested for significance" is the honest statement
            if m.group(0).lower().endswith("significance") and re.match(
                    r"\W*(?:\w+\s+){0,4}?(?:was|were|is|are|has|have|had)\s+(?:not|never)\s+(?:been\s+)?"
                    r"(?:assessed|tested|evaluated|examined|established|computed|determined|analy[sz]ed|performed)\b",
                    sent[m.end():], re.I):
                continue  # "statistical significance was not assessed" says the same thing
            ln = next((ln for ln in para if SIGNIF_RE.search(ln.prose)), para[0])
            report.warn("W02", where(ln), "'significant(ly)' without a statistical test in this paragraph: report "
                                          "the test (p-value, CI) or use 'substantially'/'markedly' with the numbers.")
            break

    # percentage points vs relative percent
    for para in paragraphs(body):
        sents = sentences(" ".join(ln.prose for ln in para))
        for i, s in enumerate(sents):
            for m in CHANGE_RE.finditer(s):
                x = float(m.group(1) or m.group(2))
                if re.search(r"percentage points?|个百分点|pp\b", s[m.end():m.end() + 25], re.I):
                    continue
                context = (sents[i - 1] + " " if i else "") + s
                others = [float(v) for v in PERCENT_RE.findall(context)]
                others_wo = [v for v in others if abs(v - x) > 1e-9] or others
                hit = None
                for a in others_wo:
                    for b in others_wo:
                        if b > a and abs((b - a) - x) < 0.051:
                            rel = (b - a) / a * 100 if a else None
                            if rel is None or abs(rel - x) > 0.051:
                                hit = (a, b, rel)
                                break
                    if hit:
                        break
                if hit:
                    a, b, rel = hit
                    ln = next((ln for ln in para if m.group(0).split()[-1] in ln.prose), para[0])
                    rel_txt = f" or the relative change ({rel:.3g}%)" if rel is not None else ""
                    report.warn("W04", where(ln), f"'{m.group(0).strip()}' equals the absolute difference between "
                                                  f"{a:g}% and {b:g}%: write '{x:g} percentage points'{rel_txt}.")


# --------------------------------------------------------------------------- #
# Checks: paper layer (drafting remarks, boundary budget, purpose before procedure)
# --------------------------------------------------------------------------- #

AUDIT_RE = re.compile(
    r"\b(?:this|the present|the current) (?:draft|write-?up|writing (?:trial|exercise|session|process))\b|"
    r"\bwriting (?:trial|exercise)\b|"
    r"\b(?:supplied|provided|available|submitted|given) (?:materials?|records?|files?|notes|logs|documents)\b|"
    r"\bauthor-?(?:supplied|provided|reported)\b|"
    r"\b(?:could|can) ?not be (?:confirmed|verified|determined|established|checked) (?:from|in|against) (?:the )?"
    r"(?:\w+ )?(?:materials?|records?|files?|logs?|repository|code(?:base)?|notes|documents)\b|"
    r"\b(?:could not|cannot|were unable to|was not possible to) (?:confirm|verify|determine|establish|check) "
    r"(?:from|in|against) (?:the )?(?:\w+ )?(?:materials?|records?|files?|logs?|repository|code(?:base)?|notes|"
    r"documents)\b|"
    r"\bnot (?:re-?computed|re-?run|regenerated|re-?generated|re-?executed) (?:here|in this|for this)\b|"
    r"\b(?:working|work) tree\b|\buncommitted changes?\b|"
    r"\bin this (?:draft|writing|write-?up|version of the manuscript)\b|"
    r"\b(?:the|these|this) (?:materials?|records|logs) (?:do|does|did) not (?:state|specify|record|show|include|"
    r"indicate)\b|"
    r"\b(?:it is|it was|remains) unclear from the (?:materials?|records?|files?|logs?)\b|"
    r"本稿|本次写作|写作试验|提供的材料|所给材料|素材中|工作树",
    re.I)
DISCLAIM_RE = re.compile(
    r"\bwe (?:do|did) not (?:claim|treat|assert|suggest|argue|compare|evaluate|measure|test|establish|examine|"
    r"address|consider|attempt|investigate)\b|"
    r"\b(?:does|do|did|can|could|should|would) not (?:establish|imply|show|prove|demonstrate|measure|indicate|"
    r"guarantee|support|allow|identify|determine|isolate)\b|"
    r"\bcannot (?:establish|be attributed|be established|identify|determine|show|confirm|rule out|separate|"
    r"distinguish|isolate|be generali[sz]ed)\b|"
    r"\bis not intended to\b|\bshould not be (?:interpreted|read|taken|understood)\b|"
    r"\bare not (?:claimed|intended|evaluated|measured)\b|\bno claim is made\b|"
    r"\b(?:beyond|outside) the scope\b|"
    r"\bremains? (?:unverified|untested|unknown|unmeasured|to be (?:verified|tested|confirmed|linked|established))\b|"
    r"\b(?:has|have|was|were) not (?:yet )?(?:been )?(?:tested|verified|evaluated|measured|confirmed|linked)\b|"
    r"不能证明|无法确定|尚未验证|并不意味着|不能说明",
    re.I)
LIMIT_HEAD_RE = re.compile(r"\blimitations?\b|\blimits\b|\bcaveats?\b|threats? to validity|局限", re.I)
RATIONALE_RE = re.compile(
    r"\b(?:so that|because|since|in order to|so as to|ensur\w*|to (?:avoid|prevent|keep|ensure|reduce|limit|"
    r"preserve|allow|make|balance|match|capture|suppress|guarantee)|aim\w*|purpose|goal|motivat\w*|rationale|"
    r"designed to|intended to|needed to|required to|which (?:keeps|makes|lets|allows|prevents|avoids)|"
    r"otherwise|trade-?off)\b|为了|以便|从而|避免",
    re.I)
SETTING_NUM_RE = re.compile(r"(?<![\w.\-\[])\d+(?:\.\d+)?(?![\w\]])")


CONVENTION_RE = re.compile(
    r"\b(?:falls? back|fall-?back|offset|mid-?point|at least \d+|at most \d+|no more than \d+|no fewer than \d+|"
    r"(?:maximum|minimum) of \d+|\d+[\s-]*(?:characters?|tokens?|words?)\b|truncated to|padded to|rounded to|"
    r"clipped to|defaults? to|appended (?:to|at)|prepended)",
    re.I)
IMPL_SECTION_RE = re.compile(r"implementation|details|set-?up|settings?|configuration|appendix|supplement", re.I)
NAME_PRED_RE = re.compile(
    r"((?:[A-Z][a-z]+(?:-[A-Za-z]+)?\s+){1,5}[A-Z][a-z]+(?:-[A-Za-z]+)?)"
    r"(?:\s*\([A-Za-z0-9\-]{2,12}\))?(?:\s*\[[^\]]+\])?\s+([a-z][a-z\-]+(?:\s+[a-z][a-z\-]+){0,6})")
NAME_LEAD_WORDS = {"The", "In", "This", "These", "Those", "Our", "We", "A", "An", "For", "To", "On", "With", "By",
                   "As", "At", "From", "Unlike", "Like", "However", "Moreover", "Section", "Table", "Figure", "Fig",
                   "Both", "Each", "All", "Such", "When", "While", "Here", "Then", "Thus", "Finally", "First",
                   "Second", "Third"}
PRED_STOP = {"that", "this", "with", "from", "into", "which", "their", "these", "those", "also", "then", "than",
             "have", "been", "were", "while", "when", "over", "under", "each", "such", "more", "most", "only",
             "both", "using", "uses", "based"}
STEM_SUFFIXES = ("ization", "isation", "ations", "ation", "ables", "able", "ibles", "ible", "ings", "ing", "ers",
                 "er", "ed", "es", "s", "ive", "ion", "al")
CITE_TOKEN_RE = re.compile(r"\[(\d+(?:\s*[-–,]\s*\d+)*|@[^\]]+|[A-Z]{1,4}\d{1,3})\]|\\cite[a-z]*\*?(?:\[[^\]]*\])*\{([^}]*)\}")
CONTRAST_RE = re.compile(
    r"\b(?:whereas|unlike|in contrast|by contrast|however|while|but|instead|rather than|compared (?:with|to)|"
    r"differs?|different|both|neither|in common|similarly|likewise|our|we|this paper|this work)\b",
    re.I)


def crude_stem(word: str) -> str:
    w = word.lower().strip("-")
    for suf in STEM_SUFFIXES:
        if len(w) > len(suf) + 3 and w.endswith(suf):
            w = w[:-len(suf)]
            break
    return w[:5]


def name_restating(sentence: str) -> str | None:
    """Return the offending phrase when a sentence describes a method by restating its name."""
    for m in NAME_PRED_RE.finditer(sentence):
        name_words = m.group(1).split()
        while name_words and name_words[0] in NAME_LEAD_WORDS:
            name_words = name_words[1:]
        if len(name_words) < 2:
            continue
        pred = [w for w in re.split(r"[\s-]+", m.group(2)) if len(w) >= 4 and w.lower() not in PRED_STOP][:4]
        if len(pred) < 2:
            continue
        stems = {crude_stem(w) for part in name_words for w in part.split("-")}
        overlap = sum(1 for w in pred if crude_stem(w) in stems)
        if overlap >= 2 and overlap / len(pred) >= 0.5:
            return f"{' '.join(name_words)} {m.group(2)}"
    return None


def check_paper_layer(doc: Document, report: Report, mode: str, masked: set[int]) -> None:
    excluded = {"references", "notes", "latex_preamble", "nomenclature", "acknowledgements", "yaml"}
    body = [ln for ln in doc.lines if ln.kind not in excluded and ln.no not in masked]
    for ln in body:
        phrases = [m.group(0) for m in AUDIT_RE.finditer(MISSING_RE.sub(" ", ln.prose))]
        if phrases:
            quoted = ", ".join(f"'{p}'" for p in dict.fromkeys(phrases))
            report.warn("W06", where(ln), f"Drafting/verification remark in the paper text ({quoted}): what was "
                                          f"supplied, checked or could not be confirmed belongs in the memo "
                                          f"(待核验事项), not in the paper.")
    if mode == "response":
        return

    def disclaim_sentences(lines: list[Line]) -> list[str]:
        out = []
        for para in paragraphs(lines):
            for sent in sentences(" ".join(ln.prose for ln in para)):
                if DISCLAIM_RE.search(MISSING_RE.sub(" ", sent)):
                    out.append(sent)
        return out

    for kind, label, limit in (("abstract", "Abstract", 2), ("conclusion", "Conclusion", 2)):
        lines = [ln for ln in body if ln.kind == kind]
        found = disclaim_sentences(lines)
        if len(found) >= limit and lines:
            report.warn("W07", where(lines[0]), f"{label} has {len(found)} limitation/disclaimer sentences "
                                                f"('{found[0][:60]}…'); keep at most one there and gather the "
                                                f"rest in the Discussion's Limitations paragraph.")
    for para in paragraphs([ln for ln in body if ln.kind not in ("abstract", "conclusion")]):
        if LIMIT_HEAD_RE.search(para[0].section):
            continue
        sents = sentences(" ".join(ln.prose for ln in para))
        if not sents or LIMIT_HEAD_RE.search(sents[0]):
            continue  # the consolidated Limitations paragraph is where boundaries belong
        found = [x for x in sents if DISCLAIM_RE.search(MISSING_RE.sub(" ", x))]
        if len(found) >= 3:
            report.warn("W07", where(para[0]), f"{len(found)} disclaimer sentences in one paragraph; state what "
                                               f"the paper does, keep each boundary once at its claim, and gather "
                                               f"the rest in a Limitations paragraph.")
    for para in paragraphs([ln for ln in body if ln.kind == "methods" and not ln.caption]):
        text = MISSING_RE.sub(" ", " ".join(ln.prose for ln in para))
        text = re.sub(r"\b(?:Figs?\.|Figures?|Tables?|Eqs?\.|Equations?|Sections?|Sec\.)\s*\(?\d+\)?", " ", text)
        if len(SETTING_NUM_RE.findall(text)) >= 4 and not RATIONALE_RE.search(text):
            report.info("M01", where(para[0]), "Several settings in this Methods paragraph but no stated purpose; "
                                               "say why the component or rule exists before listing its values.")
        if not IMPL_SECTION_RE.search(para[0].section):
            conv_sents = [x for x in sentences(text) if CONVENTION_RE.search(x)]
            n_hits = len(CONVENTION_RE.findall(text))
            if len(conv_sents) >= 2 or n_hits >= 3:
                report.info("M02", where(para[0]), f"{n_hits} implementation conventions (fallbacks, offsets, "
                                                   f"limits) in core method text; keep the rules readers need to "
                                                   f"understand the component and move the rest to an "
                                                   f"implementation-details paragraph or the supplement.")

    # W08: descriptions that restate a method's name
    for para in paragraphs([ln for ln in body if ln.kind in ("introduction", "related", "methods", "discussion",
                                                               "other", "preamble")]):
        for sent in sentences(" ".join(ln.prose for ln in para)):
            phrase = name_restating(sent)
            if phrase:
                report.warn("W08", where(para[0]), f"'{phrase[:70]}' restates the method's name as its function; "
                                                   f"say what it does differently (input, mechanism, condition).")
    # W09: related-work catalogue without comparison
    for para in paragraphs([ln for ln in body if ln.kind in ("introduction", "related")]):
        raw = MISSING_RE.sub(" ", " ".join(ln.raw for ln in para))
        sents = sentences(raw)
        cited = [x for x in sents if CITE_TOKEN_RE.search(x)]
        keys = {m.group(0) for m in CITE_TOKEN_RE.finditer(raw)}
        if len(cited) >= 3 and len(keys) >= 3 and not CONTRAST_RE.search(raw):
            report.info("W09", where(para[0]), f"{len(cited)} cited methods introduced one after another with no "
                                               f"comparison; organise by design axis and say what each does "
                                               f"relative to this paper.")


# --------------------------------------------------------------------------- #
# Checks: consistency between Abstract/Conclusion and body
# --------------------------------------------------------------------------- #

NUM_TOKEN_RE = re.compile(r"(?<![\w.\-\[])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(\s*%)?")


def salient_numbers(text: str) -> list[str]:
    text = re.sub(r"\b(?:Figs?\.|Figures?|Tables?|Eqs?\.|Equations?|Sections?|Sec\.|Ref\.|Refs\.)\s*~?\(?\d+\)?"
                  r"(?:\s*[-–,and]+\s*\(?\d+\)?)*", " ", text)
    text = re.sub(r"\[[^\]]*\]", " ", text)
    out = []
    for m in NUM_TOKEN_RE.finditer(text):
        tok, pct = m.group(1), m.group(2)
        val = tok.replace(",", "")
        if re.fullmatch(r"(?:19|20)\d{2}", val) and not pct:
            continue
        if "." in val or pct or (val.isdigit() and int(val) >= 10):
            out.append(tok)
    return out


NUMBER_WORDS = {w: i for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen "
    "seventeen eighteen nineteen".split())}
NUMBER_WORDS.update({w: 10 * (i + 2) for i, w in enumerate(
    "twenty thirty forty fifty sixty seventy eighty ninety".split())})
NUMBER_WORDS.update({"hundred": 100, "thousand": 1000})
WORD_NUM_RE = re.compile(r"\b(" + "|".join(NUMBER_WORDS) + r")(?:[- ](one|two|three|four|five|six|seven|eight|nine))?\b",
                         re.I)


def word_numbers(text: str) -> set[str]:
    """Numbers written as words in the body ("Twenty participants", "twenty-five"), normalised like digits."""
    out = set()
    for m in WORD_NUM_RE.finditer(text):
        value = NUMBER_WORDS[m.group(1).lower()] + (NUMBER_WORDS[m.group(2).lower()] if m.group(2) else 0)
        out.add(norm_num(str(value)))
    return out


def check_consistency(doc: Document, report: Report) -> None:
    body_kinds = {"methods", "results", "discussion", "other", "related", "introduction", "appendix"}
    body_text = " ".join(ln.prose + " " + ln.raw for ln in doc.lines if ln.kind in body_kinds)
    if not any(ln.kind in ("results", "discussion") for ln in doc.lines):
        return
    body_nums = {norm_num(t) for t in re.findall(r"\d[\d,]*(?:\.\d+)?", body_text)}
    # The body may spell a number the Abstract writes in digits ("Twenty participants" / "20 listeners").
    body_nums |= word_numbers(body_text)
    for kind, label in (("abstract", "Abstract"), ("conclusion", "Conclusion")):
        lines = [ln for ln in doc.lines if ln.kind == kind and not ln.heading]
        missing: dict[str, Line] = {}
        for ln in lines:
            for tok in salient_numbers(MISSING_RE.sub(" ", ln.prose)):
                if norm_num(tok) not in body_nums:
                    missing.setdefault(tok, ln)
        for tok, ln in missing.items():
            report.warn("D01", where(ln), f"{label} states '{tok}', which does not appear in the body; "
                                          f"{label.lower()} numbers must come from the Results (state derived "
                                          f"values there too).")
    # copied sentences
    def shingles(s: str) -> set[tuple[str, ...]]:
        w = re.findall(r"[a-z0-9]+", s.lower())
        return {tuple(w[i:i + 4]) for i in range(len(w) - 3)}

    def sents_of(kinds: set[str]) -> list[tuple[str, Line]]:
        out = []
        for para in paragraphs([ln for ln in doc.lines if ln.kind in kinds]):
            for s in sentences(" ".join(ln.prose for ln in para)):
                if len(s.split()) >= 10:
                    out.append((s, para[0]))
        return out

    src = sents_of({"results", "discussion"})
    concl = sents_of({"conclusion"})
    abstr = sents_of({"abstract"})
    for targets, sources, label in ((concl, src, "Conclusion"), (abstr, concl, "Abstract")):
        src_sh = [(shingles(s), s) for s, _ in sources]
        for s, ln in targets:
            sh = shingles(s)
            if not sh:
                continue
            for o, _ in src_sh:
                if o and len(sh & o) / len(sh) >= 0.6:
                    report.warn("D02", where(ln), f"{label} sentence largely copies an earlier section: "
                                                  f"'{s[:70]}…'. Rewrite at a higher level instead of copying.")
                    break


# --------------------------------------------------------------------------- #
# Checks: evidence ledger (--ledger)
# --------------------------------------------------------------------------- #

LEDGER_NUM_RE = re.compile(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?")


def load_ledger(path: Path) -> list[dict]:
    """Ledger JSON: {"entries": [{"claim": ..., "numbers": [...], "class": ..., "source": ...}]} or a bare list."""
    data = json.loads(path.read_text(encoding="utf-8"))
    entries = data.get("entries", []) if isinstance(data, dict) else data
    if not isinstance(entries, list):
        raise ValueError("ledger must be a list of entries or {\"entries\": [...]}")
    return [e for e in entries if isinstance(e, dict)]


def ledger_values(entries: list[dict]) -> list[float]:
    """Numbers a paper may state. Entries classed missing/conflicting do not count: using one of their
    numbers is exactly what the ledger should catch."""
    values: list[float] = []
    for e in entries:
        if str(e.get("class", "")).lower() in ("missing", "conflicting", "missing or conflicting"):
            continue
        tokens = [str(n) for n in e.get("numbers") or []]
        if not tokens:
            tokens = LEDGER_NUM_RE.findall(" ".join(str(e.get(k, "")) for k in ("claim", "value")))
        for tok in tokens:
            try:
                values.append(float(tok.replace(",", "")))
            except ValueError:
                continue
    return values


def traced(token: str, values: list[float]) -> bool:
    """A manuscript number is traced when a ledger value equals it at the precision it is written with."""
    t = float(token.replace(",", ""))
    decimals = len(token.split(".", 1)[1]) if "." in token else 0
    return any(abs(v - t) < 1e-9 or abs(round(v, decimals) - t) < 1e-9 for v in values)


def check_ledger(doc: Document, report: Report, entries: list[dict]) -> None:
    values = ledger_values(entries)
    classes: dict[str, int] = {}
    for e in entries:
        classes[str(e.get("class", "unclassified"))] = classes.get(str(e.get("class", "unclassified")), 0) + 1
    summary = ", ".join(f"{n} {c}" for c, n in sorted(classes.items())) or "empty"
    report.info("V02", "-", f"Evidence ledger: {len(entries)} entr{'y' if len(entries) == 1 else 'ies'} ({summary}).")
    skip = {"references", "notes", "latex_preamble", "yaml"}
    untraced: dict[str, list[Line]] = {}
    for ln in doc.lines:
        if ln.heading or ln.kind in skip:
            continue
        for tok in salient_numbers(MISSING_RE.sub(" ", ln.prose)):
            if not traced(tok, values):
                untraced.setdefault(tok, []).append(ln)
    for tok, lines in untraced.items():
        extra = f" ({len(lines)} occurrences)" if len(lines) > 1 else ""
        report.warn("V01", where(lines[0]), f"'{tok}' is not in the evidence ledger{extra}: record its source "
                                            f"(or the computation that produced it), or replace it with a "
                                            f"[MISSING: ...] marker.")


# --------------------------------------------------------------------------- #
# Checks: reviewer response letters
# --------------------------------------------------------------------------- #

FIELD_RE = re.compile(r"^\s*(?:[>*_\-]\s*)*(?:\*\*|__)?\s*(Comment|Response|Reply|Answer|Changes in the manuscript|"
                      r"Changes in manuscript|Changes made|Changes|Revisions?|Location)\s*(?:\*\*|__)?\s*[:：]",
                      re.I)
REVIEWER_RE = re.compile(r"Reviewer\s*#?\s*(\d+)", re.I)
BLOCK_HDR_RE = re.compile(
    r"^\s*(?:[#>*_\s]*)(?:Reviewer\s*#?\s*(\d+)\s*(?:\*\*|__)?\s*[,;:\-–—]?\s*(?:\*\*|__)?\s*)?"
    r"(?:Comment|Point|Question|Q)\s*#?\s*(\d+)\s*(?:\*\*|__)?\s*[:：.)]?\s*(?:\*\*|__)?\s*(.*)$",
    re.I)
DONE_RE = re.compile(
    r"\bwe have (?:now |also |further |carefully )?(?:conducted|performed|added|revised|included|updated|corrected|"
    r"rewritten|clarified|expanded|run|carried out|incorporated|modified|changed|removed|provided|repeated|re-?run|"
    r"extended|completed|implemented|addressed)\b|\b(?:has|have) been (?:added|revised|included|updated|corrected|"
    r"conducted|performed|rewritten|expanded|completed|incorporated)\b|\bwas added to the (?:revised )?manuscript\b",
    re.I)
OTHER_REVIEWERS_RE = re.compile(r"\bother reviewers?\b|\bthe remaining reviewers\b|\bReviewer\s*#?\s*\d+\s+"
                                r"(?:did not|agreed|was satisfied|found|considered|praised|accepted)", re.I)


def is_response_letter(doc: Document) -> bool:
    raw = "\n".join(ln.raw for ln in doc.lines)
    return bool(REVIEWER_RE.search(raw)) and len(re.findall(r"(?im)^\s*(?:[>*_\-]\s*)*(?:\*\*)?\s*(?:Response|Reply)"
                                                             r"\s*(?:\*\*)?\s*[:：]", raw)) >= 1


def parse_response_blocks(doc: Document) -> tuple[list[dict], set[int]]:
    blocks: list[dict] = []
    reviewer = 0
    cur: dict | None = None
    field_name: str | None = None
    masked: set[int] = set()
    aliases = {"reply": "response", "answer": "response", "changes in the manuscript": "changes",
               "changes in manuscript": "changes", "changes made": "changes", "revision": "changes",
               "revisions": "changes"}
    for ln in doc.lines:
        s = ln.raw
        if ln.kind == "notes" or not s.strip():
            continue
        fm = FIELD_RE.match(s)
        if fm and cur is not None:
            name = aliases.get(fm.group(1).lower(), fm.group(1).lower())
            field_name = name
            cur["fields"].setdefault(name, []).append((s[fm.end():], ln))
            if name == "comment":
                masked.add(ln.no)
            continue
        hm = BLOCK_HDR_RE.match(s)
        if hm:
            if hm.group(1):
                reviewer = int(hm.group(1))
            cur = {"reviewer": reviewer, "comment": int(hm.group(2)), "line": ln, "fields": {}}
            blocks.append(cur)
            field_name = None
            rest = hm.group(3).strip()
            if rest:
                cur["fields"]["comment"] = [(rest, ln)]
                field_name = "comment"
                masked.add(ln.no)
            continue
        rm = REVIEWER_RE.search(s)
        if rm and (ln.heading or re.match(r"^\s*(?:\*\*|__|#+)?\s*(?:Response to\s+)?Reviewer", s, re.I)):
            reviewer = int(rm.group(1))
            cur, field_name = None, None
            continue
        if cur is not None and field_name:
            cur["fields"][field_name].append((s, ln))
            if field_name == "comment":
                masked.add(ln.no)
    return blocks, masked


def check_response(doc: Document, report: Report) -> set[int]:
    blocks, masked = parse_response_blocks(doc)
    if not blocks:
        report.warn("R02", "-", "No 'Reviewer n, Comment m' blocks found; keep the reviewers' numbering.")
        return masked
    by_reviewer: dict[int, list[int]] = {}
    for b in blocks:
        by_reviewer.setdefault(b["reviewer"], []).append(b["comment"])
        tag = f"Reviewer {b['reviewer']}, Comment {b['comment']}" if b["reviewer"] else f"Comment {b['comment']}"
        f = b["fields"]
        missing = [n for n in ("comment", "response", "changes", "location") if n not in f]
        if missing:
            report.warn("R02", where(b["line"]), f"{tag}: missing field(s) {', '.join(missing)}.")
        resp = " ".join(t for t, _ in f.get("response", []))
        changes = " ".join(t for t, _ in f.get("changes", []))
        loc = " ".join(t for t, _ in f.get("location", []))
        done = DONE_RE.search(resp + " " + changes)
        if done and (MISSING_RE.search(changes) or MISSING_RE.search(resp)):
            report.error("R01", where(b["line"]), f"{tag}: '{done.group(0)}' claims completed work, but the "
                                                  f"response/changes still contain a [MISSING] marker. Use "
                                                  f"completed tense only for changes that exist.")
        elif done and MISSING_RE.search(loc):
            report.warn("R01", where(b["line"]), f"{tag}: completed change claimed but its location is missing; "
                                                 f"verify the change exists and add the location.")
        if "response" in f:
            core = " ".join(s for s in sentences(MISSING_RE.sub(" [gap] ", resp))
                            if not re.search(r"thank|grateful|appreciate|感谢", s, re.I))
            if len(re.findall(r"[A-Za-z\u4e00-\u9fff]+", core)) < 8 and "[gap]" not in core:
                report.warn("R04", where(b["line"]), f"{tag}: the response is mostly thanks; answer the concern "
                                                     f"directly.")
            if OTHER_REVIEWERS_RE.search(resp):
                report.warn("R05", where(b["line"]), f"{tag}: other reviewers' views are cited; they can add "
                                                     f"context but do not replace a direct answer.")
    for rev, nums in by_reviewer.items():
        expected = list(range(1, max(nums) + 1))
        gaps = [n for n in expected if n not in nums]
        if gaps:
            label = f"Reviewer {rev}" if rev else "Comments"
            report.warn("R03", "-", f"{label}: comment number(s) {gaps} are skipped; every comment needs a response.")
    revs = sorted(r for r in by_reviewer if r)
    if revs and revs != list(range(1, max(revs) + 1)):
        report.warn("R03", "-", f"Reviewer numbers {revs} are not consecutive.")
    return masked


# --------------------------------------------------------------------------- #
# Driver
# --------------------------------------------------------------------------- #

def detect_mode(doc: Document) -> str:
    if is_response_letter(doc):
        return "response"
    kinds = doc.kinds_present()
    core = sum(1 for k in CORE_KINDS if k in kinds)
    if (doc.title or "abstract" in kinds) and core >= 2:
        return "manuscript"
    return "section"


def run_checks(doc: Document, args: argparse.Namespace, notes_text: str | None = None) -> Report:
    report = Report(path=str(doc.path), fmt=doc.fmt)
    mode = args.mode if args.mode != "auto" else detect_mode(doc)
    report.mode = mode
    raw_all = "\n".join(ln.raw for ln in doc.lines)
    doc.has_proof_context = bool(re.search(r"\\begin\{proof\}|\b(?:Theorem|Lemma|Proposition|Corollary)\s*\d|"
                                           r"\*\*Proof\b|^\s*Proof[.:]", raw_all, re.M))
    for name, no in doc.missing_inputs:
        report.warn("S07", doc.loc(no), f"Included file '{name}' not found; its text was not checked.")
    notes = notes_text if notes_text is not None else notes_from_doc(doc)
    check_gaps(doc, report, notes)
    if getattr(args, "final", False):
        check_final(doc, report)
    masked: set[int] = set()
    if mode == "response":
        masked = check_response(doc, report)
        check_wording(doc, report, mode, masked)
        check_paper_layer(doc, report, mode, masked)
        return report
    if mode == "manuscript":
        check_structure(doc, report, args)
    else:
        if args.abstract_words or args.title_words:
            check_structure_limits_only(doc, report, args)
    check_crossrefs(doc, report, mode)
    check_citations(doc, report, args.bib)
    check_acronyms(doc, report)
    check_wording(doc, report, mode, masked)
    check_paper_layer(doc, report, mode, masked)
    if mode == "manuscript":
        check_consistency(doc, report)
    if getattr(args, "ledger", None):
        check_ledger(doc, report, load_ledger(args.ledger))
    return report


def check_structure_limits_only(doc: Document, report: Report, args: argparse.Namespace) -> None:
    sub = Report()
    check_structure(doc, sub, args)
    for f in sub.findings:
        if f.code in ("S04", "S05") and f.level == "ERROR":
            report.findings.append(f)


def format_report(report: Report) -> str:
    order = {lvl: i for i, lvl in enumerate(LEVELS)}
    rows = sorted(report.findings, key=lambda f: (order[f.level], f.code))
    out = [f"check_paper_draft: {report.path} ({report.fmt}, {report.mode} mode)"]
    for f in rows:
        out.append(f"{f.level:<5} {f.code:<4} {f.where:<28} {f.message}")
    out.append(f"Summary: {report.count('ERROR')} error(s), {report.count('WARN')} warning(s), "
               f"{report.count('INFO')} info.")
    return "\n".join(out)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Check an SCI paper draft or reviewer-response letter.")
    p.add_argument("input", type=Path, help="Draft (.md, .tex, .docx or .txt)")
    p.add_argument("--mode", choices=["auto", "manuscript", "section", "response"], default="auto",
                   help="auto (default) detects a full manuscript, a partial section or a response letter")
    p.add_argument("--format", choices=["md", "tex", "docx", "txt"], help="Override format detection")
    p.add_argument("--bib", type=Path, help="BibTeX file with the reference keys")
    p.add_argument("--notes", type=Path, help="Separate file with the Chinese gap notes (材料缺口)")
    p.add_argument("--abstract-words", type=int, help="Abstract word limit from the journal guidelines")
    p.add_argument("--title-words", type=int, help="Title word limit from the journal guidelines")
    p.add_argument("--json", type=Path, help="Also write the report as JSON")
    p.add_argument("--final", action="store_true",
                   help="Submission stage: every remaining [MISSING] marker or provisional label is an ERROR")
    p.add_argument("--ledger", type=Path, metavar="EVIDENCE_JSON",
                   help="Evidence ledger: every salient number in the paper must be traceable to an entry (V01)")
    p.add_argument("--export-gaps", type=Path, metavar="GAPS_JSON",
                   help="Write a fill-in template of all markers for fill_gaps.py")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.input.exists():
        print(f"error: {args.input} not found", file=sys.stderr)
        return 2
    if args.bib and not args.bib.exists():
        print(f"error: {args.bib} not found", file=sys.stderr)
        return 2
    if args.ledger:
        try:
            load_ledger(args.ledger)
        except (OSError, ValueError) as exc:  # json.JSONDecodeError is a ValueError
            print(f"error: cannot read ledger {args.ledger}: {exc}", file=sys.stderr)
            return 2
    doc = load_document(args.input, args.format)
    notes_text = args.notes.read_text(encoding="utf-8", errors="replace") if args.notes else None
    report = run_checks(doc, args, notes_text)
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        pass
    print(format_report(report))
    if args.export_gaps:
        n = export_gaps(doc, args.export_gaps)
        print(f"Exported {n} distinct gap marker(s) to {args.export_gaps}")
    if args.json:
        args.json.write_text(json.dumps({"path": report.path, "format": report.fmt, "mode": report.mode,
                                         "errors": report.count("ERROR"), "warnings": report.count("WARN"),
                                         "findings": [asdict(f) for f in report.findings]},
                                        ensure_ascii=False, indent=2), encoding="utf-8")
    return 1 if report.count("ERROR") else 0


if __name__ == "__main__":
    sys.exit(main())
