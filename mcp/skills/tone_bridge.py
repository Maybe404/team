#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""team-mcp 与 less-ai-tone 之间的桥接。

detect.py 本身是整篇统计工具（要求 ≥500 汉字），任务描述、评论这类短文本用不了。
这里只复用它的逐句规则定义（REGEX_HITS、CHAR_HITS），对任意长度的文本逐行扫描，
输出 JSON 供 team-mcp 的规范闸门使用。规则本身不在这里维护，升级 skill 即可更新。

用法：python3 tone_bridge.py < 文本      输出 {"hanzi": n, "hits": [...], "chars": {...}}
     python3 tone_bridge.py --full 文件   原样调用 detect.py 输出整篇报告（≥500 汉字）
"""
import json
import re
import subprocess
import sys
from pathlib import Path

SKILL = Path(__file__).resolve().parent / "less-ai-tone"
sys.path.insert(0, str(SKILL / "scripts"))
from detect import CHAR_HITS, REGEX_HITS  # noqa: E402

FENCE = re.compile(r"^\s{0,3}```")
HEADING = re.compile(r"^\s{0,3}#{1,6}\s")
LIST = re.compile(r"^\s{0,3}(?:[-*+]|\d+[.、)])\s")
TABLE = re.compile(r"^\s{0,3}\|")
QUOTE = re.compile(r"^\s{0,3}>")
INLINE_CODE = re.compile(r"`[^`\n]*`")

# SKILL.md「不改」里点名的场景：小标题、列表项内部、引文、表格
SKIP_IN_STRUCTURE = {"提示语冒号", "顿号并列≥3"}


def scan(text: str):
    hits = []
    in_fence = False
    for no, raw in enumerate(text.splitlines(), 1):
        if FENCE.match(raw):
            in_fence = not in_fence
            continue
        if in_fence or QUOTE.match(raw) or TABLE.match(raw):
            continue
        line = INLINE_CODE.sub(lambda m: " " * len(m.group(0)), raw)
        structural = bool(HEADING.match(line) or LIST.match(line))
        for level, name, pat, ref, advice in REGEX_HITS:
            if structural and name in SKIP_IN_STRUCTURE:
                continue
            if name.startswith("序数词小标题"):
                continue
            for m in re.finditer(pat, line):
                hits.append({"level": level, "rule": name, "line": no, "excerpt": m.group(0)[:60], "advice": advice, "ref": ref})
    chars = {name: text.count(ch) for _, name, ch, *_ in CHAR_HITS}
    return {"hanzi": len(re.findall(r"[一-鿿]", text)), "hits": hits, "chars": chars}


def main():
    if len(sys.argv) >= 3 and sys.argv[1] == "--full":
        r = subprocess.run([sys.executable, "-I", str(SKILL / "scripts" / "detect.py"), sys.argv[2]], capture_output=True, text=True)
        sys.stdout.write(r.stdout or r.stderr)
        sys.exit(r.returncode)
    print(json.dumps(scan(sys.stdin.read()), ensure_ascii=False))


if __name__ == "__main__":
    main()
