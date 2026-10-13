"""Build-time SEO for the docs site: FAQ structured data built from the page itself.

A page with `faq: true` in its front matter gets FAQPage JSON-LD made from its h3 questions and the
text up to the next heading, so the answers search engines read are always the ones on the page.
main.html prints `page.meta.faq_schema`.
"""

import html
import json
import re

HEADING = re.compile(r"<h([23])[^>]*>(.*?)</h\1>", re.S)


def _text(fragment: str) -> str:
    """Rendered HTML to plain text: tags and permalink anchors removed, whitespace collapsed."""
    fragment = re.sub(r'<a class="headerlink"[^>]*>.*?</a>', "", fragment, flags=re.S)
    fragment = re.sub(r"</?(p|li|ul|ol|br|div|tr|td|th|table|pre)\b[^>]*>", " ", fragment)  # blocks: a space
    text = html.unescape(re.sub(r"<[^>]+>", "", fragment))  # inline tags such as links: nothing
    return re.sub(r"\s+([.,;:!?])", r"\1", re.sub(r"\s+", " ", text)).strip()


def on_page_content(content, page, config, files):
    if not page.meta.get("faq"):
        return content
    headings = list(HEADING.finditer(content))
    questions = []
    for i, match in enumerate(headings):
        if match.group(1) != "3":
            continue
        end = headings[i + 1].start() if i + 1 < len(headings) else len(content)
        answer = _text(content[match.end():end])
        if answer:
            questions.append({
                "@type": "Question",
                "name": _text(match.group(2)),
                "acceptedAnswer": {"@type": "Answer", "text": answer},
            })
    page.meta["faq_schema"] = json.dumps(
        {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": questions},
        ensure_ascii=False,
    ).replace("</", "<\\/")
    return content
