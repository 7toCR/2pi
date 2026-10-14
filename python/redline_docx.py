#!/usr/bin/env python3
"""Write a DOCX whose changes are Word tracked revisions (w:ins / w:del), with optional comments.

Input JSON:
  {"title": str, "author": str, "date": "2026-10-10T12:00:00Z",
   "sections": [{"heading": str,
                 "paragraphs": [{"segments": [{"op": "=" | "+" | "-", "text": str}],
                                 "comment": str (optional)}]}]}

Opening the file in Word shows every change in revision mode, so a reviewer can accept or reject
each one; comments carry the reason for a change. Standard library only.
"""

from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
</Types>"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

DOC_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>
</Relationships>"""

STYLES = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/><w:sz w:val="24"/><w:lang w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:ind w:firstLineChars="200" w:firstLine="480"/><w:jc w:val="both"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:ind w:firstLine="0"/><w:spacing w:after="240"/></w:pPr><w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:jc w:val="center"/><w:ind w:firstLine="0"/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:sz w:val="28"/></w:rPr></w:style>
</w:styles>"""

SETTINGS = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="{W}"><w:trackRevisions/></w:settings>"""


def text_runs(text: str, deleted: bool) -> str:
    """One run per line; deleted text uses w:delText, as Word requires inside w:del."""
    tag = "w:delText" if deleted else "w:t"
    pieces = text.split("\n")
    inner = "<w:br/>".join(f'<{tag} xml:space="preserve">{escape(p)}</{tag}>' for p in pieces)
    return f"<w:r>{inner}</w:r>"


class Writer:
    def __init__(self, author: str, date: str) -> None:
        self.author = escape(author)
        self.date = escape(date)
        self.revision = 0
        self.comments: list[str] = []

    def rev_attrs(self) -> str:
        self.revision += 1
        return f'w:id="{self.revision}" w:author="{self.author}" w:date="{self.date}"'

    def paragraph(self, segments: list[dict], comment: str | None = None, style: str | None = None) -> str:
        runs = []
        for seg in segments:
            text = str(seg.get("text", ""))
            if not text:
                continue
            op = seg.get("op", "=")
            if op == "+":
                runs.append(f"<w:ins {self.rev_attrs()}>{text_runs(text, False)}</w:ins>")
            elif op == "-":
                runs.append(f"<w:del {self.rev_attrs()}>{text_runs(text, True)}</w:del>")
            else:
                runs.append(text_runs(text, False))
        body = "".join(runs)
        if comment:
            cid = len(self.comments)
            self.comments.append(
                f'<w:comment w:id="{cid}" w:author="{self.author}" w:date="{self.date}" w:initials="2pi">'
                f'<w:p><w:r><w:t xml:space="preserve">{escape(comment)}</w:t></w:r></w:p></w:comment>'
            )
            body = (f'<w:commentRangeStart w:id="{cid}"/>{body}<w:commentRangeEnd w:id="{cid}"/>'
                    f'<w:r><w:commentReference w:id="{cid}"/></w:r>')
        ppr = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
        return f"<w:p>{ppr}{body}</w:p>"


def build(data: dict) -> dict[str, str]:
    writer = Writer(data.get("author") or "2pi", data.get("date") or "2026-01-01T00:00:00Z")
    parts = [writer.paragraph([{"op": "=", "text": data.get("title", "修订稿")}], style="Title")]
    for section in data.get("sections", []):
        if section.get("heading"):
            parts.append(writer.paragraph([{"op": "=", "text": section["heading"]}], style="Heading1"))
        for para in section.get("paragraphs", []):
            parts.append(writer.paragraph(para.get("segments", []), para.get("comment")))
    document = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="{W}"><w:body>'
                + "".join(parts)
                + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" '
                  'w:left="1440" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body></w:document>')
    comments = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments xmlns:w="{W}">'
                + "".join(writer.comments) + "</w:comments>")
    return {
        "[Content_Types].xml": CONTENT_TYPES,
        "_rels/.rels": ROOT_RELS,
        "word/_rels/document.xml.rels": DOC_RELS,
        "word/document.xml": document,
        "word/styles.xml": STYLES,
        "word/settings.xml": SETTINGS,
        "word/comments.xml": comments,
    }


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: redline_docx.py input.json output.docx", file=sys.stderr)
        return 2
    data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    out = Path(sys.argv[2])
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in build(data).items():
            archive.writestr(name, content)
    revisions = sum(1 for s in data.get("sections", []) for p in s.get("paragraphs", []) for g in p.get("segments", [])
                    if g.get("op") in ("+", "-") and g.get("text"))
    print(json.dumps({"output": str(out), "revisions": revisions}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
