#!/usr/bin/env python3
"""Turn a source paper into material an agent can read completely.

Writes into OUTDIR:
  paper.md      full text; every page starts with a line "[[page N]]"
  pages/        PNG renderings of selected pages (figures, tables, page 1)
  figures/      embedded images (DOCX/LaTeX/Markdown inputs)
  ingest.json   index: outline with line numbers, figure/table captions, disclosure clues

Prints the index as JSON on stdout. Backends, in order: PyMuPDF, pypdf + Poppler, Poppler only.
Standard library only, apart from those optional PDF backends.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path
from typing import Any

CAPTION = re.compile(r"^\s*(fig\.?|figure|图|table|表|algorithm|算法)\s*([0-9]+|[A-Z]\.?[0-9]*)\s*[:.：．]?\s*(.*)$", re.I)
HEADING = re.compile(
    r"^\s*(?:(?:[0-9]+(?:\.[0-9]+){0,2}|[IVX]+|[A-H])\.?\s+[A-Z\u4e00-\u9fff][^.]{2,80}"
    r"|abstract|introduction|related work|background|method(?:s|ology)?|approach|experiments?|results|"
    r"discussion|conclusions?|references|appendix|acknowledg(?:e)?ments?|摘要|引言|相关工作|方法|实验|结论|参考文献|附录)\s*$",
    re.I,
)
DISCLOSURE = [
    ("arxiv", re.compile(r"arXiv:\s*\d{4}\.\d{4,5}(?:v\d+)?", re.I)),
    ("doi", re.compile(r"\b(?:doi:\s*|https?://doi\.org/)?10\.\d{4,9}/[^\s,;]+", re.I)),
    ("venue", re.compile(r"(published (?:in|as)|accepted (?:at|to|by|for)|to appear in|proceedings of|in press|"
                         r"conference on|journal of|transactions on|workshop|preprint|under review|camera[- ]ready)", re.I)),
    ("copyright", re.compile(r"(©|copyright\s+(?:\(c\)\s*)?\d{4})", re.I)),
    ("code", re.compile(r"(github\.com/[\w.-]+/[\w.-]+|gitlab\.com/[\w.-]+/[\w.-]+|huggingface\.co/[\w.-]+/[\w.-]+)", re.I)),
    ("date", re.compile(r"\b(?:received|accepted|published|submitted)\s*(?:on)?\s*[:：]?\s*\d{1,2}?\s*[A-Za-z]*\.?\s*\d{4}", re.I)),
]


def parse_page_spec(spec: str, count: int) -> list[int]:
    pages: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start, end = part.split("-", 1)
            pages.update(range(int(start), int(end) + 1))
        else:
            pages.add(int(part))
    return sorted(p for p in pages if 1 <= p <= count)


# ---------------------------------------------------------------------------
# Extraction backends
# ---------------------------------------------------------------------------

def pdf_pages_text(pdf: Path, warnings: list[str]) -> tuple[list[str], str]:
    try:
        import fitz  # type: ignore  # PyMuPDF

        with fitz.open(str(pdf)) as doc:
            return [page.get_text("text", sort=True) for page in doc], "pymupdf"
    except ImportError:
        pass
    try:
        from pypdf import PdfReader  # type: ignore

        reader = PdfReader(str(pdf))
        warnings.append("未安装 PyMuPDF，使用 pypdf 提取文本（版式与公式可能较差）。建议：pip install pymupdf")
        return [page.extract_text() or "" for page in reader.pages], "pypdf"
    except ImportError:
        pass
    if shutil.which("pdftotext"):
        out = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", str(pdf), "-"],
                             capture_output=True, timeout=300, check=True).stdout.decode("utf-8", "replace")
        warnings.append("未安装 PyMuPDF，使用 pdftotext 提取文本。建议：pip install pymupdf")
        pages = out.split("\f")
        if pages and not pages[-1].strip():
            pages.pop()  # pdftotext ends every page, including the last, with a form feed
        return pages, "pdftotext"
    raise RuntimeError("无法读取 PDF：请安装 PyMuPDF（pip install pymupdf）或 Poppler（pdftotext/pdftoppm）。")


def render_pdf_pages(pdf: Path, pages: list[int], out_dir: Path, dpi: int, warnings: list[str]) -> list[dict[str, Any]]:
    if not pages:
        return []
    out_dir.mkdir(parents=True, exist_ok=True)
    rendered: list[dict[str, Any]] = []
    try:
        import fitz  # type: ignore

        with fitz.open(str(pdf)) as doc:
            for number in pages:
                path = out_dir / f"page-{number:03d}.png"
                doc[number - 1].get_pixmap(dpi=dpi).save(str(path))
                rendered.append({"page": number, "path": str(path)})
        return rendered
    except ImportError:
        pass
    if shutil.which("pdftoppm"):
        for number in pages:
            prefix = out_dir / f"page-{number:03d}"
            result = subprocess.run(["pdftoppm", "-r", str(dpi), "-png", "-singlefile", "-f", str(number), "-l",
                                     str(number), str(pdf), str(prefix)], capture_output=True, timeout=300)
            if result.returncode == 0 and prefix.with_suffix(".png").exists():
                rendered.append({"page": number, "path": str(prefix.with_suffix(".png"))})
            else:
                warnings.append(f"第 {number} 页渲染失败：{result.stderr.decode('utf-8', 'replace').strip()[:200]}")
        return rendered
    warnings.append("无法渲染页面图像（缺 PyMuPDF 与 pdftoppm），看不到论文原图。建议：pip install pymupdf")
    return rendered


def docx_text(path: Path, figures_dir: Path) -> tuple[list[str], list[str]]:
    with zipfile.ZipFile(path) as archive:
        xml = archive.read("word/document.xml").decode("utf-8", "replace")
        images = []
        for name in archive.namelist():
            if name.startswith("word/media/"):
                figures_dir.mkdir(parents=True, exist_ok=True)
                target = figures_dir / Path(name).name
                target.write_bytes(archive.read(name))
                images.append(str(target))
    paragraphs = []
    for para in re.findall(r"<w:p[ >].*?</w:p>", xml, flags=re.S):
        text = "".join(re.findall(r"<w:t(?: [^>]*)?>(.*?)</w:t>", para, flags=re.S))
        text = text.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&").replace("&quot;", '"')
        paragraphs.append(text)
    return ["\n".join(paragraphs)], images


def latex_text(path: Path, seen: set[Path] | None = None) -> str:
    """Inline \\input/\\include files next to the main .tex so the whole source reads as one text."""
    seen = seen or set()
    seen.add(path.resolve())
    text = path.read_text(encoding="utf-8", errors="replace")

    def inline(match: re.Match[str]) -> str:
        name = match.group(2).strip()
        child = (path.parent / name).with_suffix(".tex") if not name.endswith(".tex") else path.parent / name
        if child.exists() and child.resolve() not in seen:
            return f"\n% ---- {child.name} ----\n" + latex_text(child, seen)
        return match.group(0)

    return re.sub(r"\\(input|include)\{([^}]+)\}", inline, text)


def collect_local_images(source: Path, text: str, figures_dir: Path, dpi: int, warnings: list[str]) -> list[str]:
    refs = re.findall(r"\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}", text) + re.findall(r"!\[[^\]]*\]\(([^)\s]+)", text)
    found: list[str] = []
    for ref in refs:
        base = source.parent / ref
        candidates = [base] + [base.with_suffix(ext) for ext in (".png", ".jpg", ".jpeg", ".pdf", ".eps")]
        hit = next((c for c in candidates if c.exists() and c.is_file()), None)
        if not hit:
            continue
        figures_dir.mkdir(parents=True, exist_ok=True)
        if hit.suffix.lower() == ".pdf":
            rendered = render_pdf_pages(hit, [1], figures_dir / hit.stem, dpi, warnings)
            found.extend(item["path"] for item in rendered)
        elif hit.suffix.lower() in (".png", ".jpg", ".jpeg"):
            target = figures_dir / hit.name
            shutil.copyfile(hit, target)
            found.append(str(target))
    return found


# ---------------------------------------------------------------------------
# Indexing
# ---------------------------------------------------------------------------

def build_markdown(pages: list[str], paged: bool) -> tuple[str, list[int]]:
    """Return the text and, for paged input, the 1-based line where each page starts."""
    lines: list[str] = []
    starts: list[int] = []
    for number, text in enumerate(pages, start=1):
        if paged:
            if lines:
                lines.append("")
            starts.append(len(lines) + 1)
            lines.append(f"[[page {number}]]")
        lines.extend(text.replace("\r\n", "\n").replace("\r", "\n").rstrip().split("\n"))
    return "\n".join(lines) + "\n", starts


def page_of(line_no: int, starts: list[int]) -> int | None:
    page = None
    for index, start in enumerate(starts, start=1):
        if start <= line_no:
            page = index
    return page


def index_text(markdown: str, starts: list[int]) -> dict[str, Any]:
    outline, captions, clues = [], [], []
    seen_clues: set[tuple[str, str]] = set()
    for line_no, raw in enumerate(markdown.split("\n"), start=1):
        line = raw.strip()
        if not line or line.startswith("[[page "):
            continue
        tex_section = re.match(r"\\(section|subsection|subsubsection)\*?\{(.+?)\}", line)
        if tex_section:
            outline.append({"line": line_no, "title": tex_section.group(2)})
        elif len(line) <= 90 and HEADING.match(line):
            outline.append({"line": line_no, "page": page_of(line_no, starts), "title": line})
        tex_caption = re.search(r"\\caption\{(.{0,200})", line)
        caption = CAPTION.match(line)
        if caption and len(caption.group(3)) >= 3:
            kind = caption.group(1).lower().rstrip(".")
            kind = {"fig": "figure", "图": "figure", "表": "table", "算法": "algorithm"}.get(kind, kind)
            captions.append({"kind": kind, "label": f"{caption.group(1)} {caption.group(2)}", "line": line_no,
                             "page": page_of(line_no, starts), "caption": line[:200]})
        elif tex_caption:
            captions.append({"kind": "caption", "label": "", "line": line_no, "caption": tex_caption.group(1)})
        for kind, pattern in DISCLOSURE:
            for match in pattern.finditer(line):
                key = (kind, match.group(0).lower())
                if key in seen_clues:
                    continue
                seen_clues.add(key)
                clues.append({"kind": kind, "line": line_no, "page": page_of(line_no, starts), "text": line[:160]})
    return {"outline": outline[:120], "captions": captions[:200], "disclosure_clues": clues[:40]}


# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest a paper for drafting.")
    parser.add_argument("source", type=Path)
    parser.add_argument("-o", "--out-dir", type=Path, required=True)
    parser.add_argument("--pages", default="auto", help="auto | all | none | page list such as 1,3-5")
    parser.add_argument("--dpi", type=int, default=110)
    parser.add_argument("--max-render", type=int, default=40)
    args = parser.parse_args()

    source: Path = args.source
    if not source.exists():
        print(json.dumps({"error": f"文件不存在：{source}"}, ensure_ascii=False))
        return 2
    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    warnings: list[str] = []
    suffix = source.suffix.lower()
    page_images: list[dict[str, Any]] = []
    figure_files: list[str] = []
    backend = "text"

    if suffix == ".pdf":
        pages, backend = pdf_pages_text(source, warnings)
        markdown, starts = build_markdown(pages, paged=True)
        index = index_text(markdown, starts)
        count = len(pages)
        if args.pages == "all":
            selected = list(range(1, count + 1))
        elif args.pages == "none":
            selected = []
        elif args.pages == "auto":
            caption_pages = {c["page"] for c in index["captions"] if c.get("page")}
            selected = sorted({1} | caption_pages) if count > 12 else list(range(1, count + 1))
        else:
            selected = parse_page_spec(args.pages, count)
        if len(selected) > args.max_render:
            warnings.append(f"选中 {len(selected)} 页，只渲染前 {args.max_render} 页；其余页可用 pages 参数单独渲染。")
            selected = selected[: args.max_render]
        page_images = render_pdf_pages(source, selected, out_dir / "pages", args.dpi, warnings)
        if sum(len(p.strip()) for p in pages) < 200 * max(1, count) * 0.2:
            warnings.append("提取到的文字很少，可能是扫描版 PDF。请查看页面图像，必要时让用户提供文字版。")
    elif suffix == ".docx":
        pages, figure_files = docx_text(source, out_dir / "figures")
        markdown, starts = build_markdown(pages, paged=False)
        index = index_text(markdown, starts)
        count = 1
    elif suffix in (".tex", ".md", ".markdown", ".txt", ".rst"):
        text = latex_text(source) if suffix == ".tex" else source.read_text(encoding="utf-8", errors="replace")
        figure_files = collect_local_images(source, text, out_dir / "figures", args.dpi, warnings)
        markdown, starts = build_markdown([text], paged=False)
        index = index_text(markdown, starts)
        count = 1
    else:
        print(json.dumps({"error": f"不支持的格式：{suffix}。支持 PDF、DOCX、TeX、Markdown、TXT。"}, ensure_ascii=False))
        return 2

    text_path = out_dir / "paper.md"
    text_path.write_text(markdown, encoding="utf-8")
    result = {
        "source": str(source.resolve()),
        "backend": backend,
        "text_path": str(text_path),
        "pages": count,
        "lines": markdown.count("\n"),
        "chars": len(markdown),
        "page_images": page_images,
        "figure_files": figure_files,
        **index,
        "warnings": warnings,
    }
    (out_dir / "ingest.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
