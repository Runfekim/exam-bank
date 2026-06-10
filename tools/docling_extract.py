#!/usr/bin/env python3
# ============================================================
# docling_extract.py — PDF → 페이지별 레이아웃 블록 JSON
# ------------------------------------------------------------
# docling(https://github.com/docling-project/docling, vendor/docling 클론)의
# 레이아웃 분석 + OCR(macOS Vision)로 PDF를 블록 단위로 분해한다.
# 스캔 PDF(텍스트 레이어 없음)도 OCR로 텍스트·좌표를 얻는다.
#
# 출력 좌표계는 pdftotext -bbox 와 동일: PDF pt, 원점 좌상단(y 아래로 증가).
# build.mjs(exam-db-builder)가 이 JSON을 읽어 문항을 검출한다.
#
# 사용:
#   tools/.venv/bin/python tools/docling_extract.py <in.pdf> [--out out.json]
#       [--ocr on|off]      OCR 수행 여부 (기본 on — 비트맵 영역만 OCR되므로 안전)
#       [--max-pages N]     앞 N페이지만 (검증용)
#
# 출력 JSON:
#   { "engine":"docling", "doclingVersion":"...", "ocr":true,
#     "pages":[ { "no":1, "width":595.0, "height":841.0,
#                 "blocks":[ {"kind":"text","text":"...","x":l,"y":t,"x2":r,"y2":b} ] } ] }
# blocks 순서 = docling 읽기 순서(reading order). kind 는 DocItemLabel 값
# (text, section_header, list_item, formula, caption, picture, table, page_header, ...).
# ============================================================
import argparse
import json
import os
import sys
from pathlib import Path

# 출력 JSON 스키마 버전 — 형식이 바뀌면 올린다. build.mjs 가 캐시 유효성 판정에 쓴다.
SCHEMA_VERSION = 2


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--out", default=None, help="출력 JSON 경로(기본: stdout)")
    ap.add_argument("--ocr", choices=["on", "off"], default="on")
    ap.add_argument("--max-pages", type=int, default=None)
    args = ap.parse_args()

    pdf = Path(args.pdf)
    if not pdf.exists():
        print(f"✖ PDF 없음: {pdf}", file=sys.stderr)
        return 1
    if args.out:
        out_dir = Path(args.out).resolve().parent
        if not out_dir.is_dir():
            # 무거운 변환을 다 끝낸 뒤 쓰기에서 죽지 않도록 미리 검증
            print(f"✖ 출력 디렉터리 없음: {out_dir}", file=sys.stderr)
            return 1

    # docling import 는 무겁다(torch) — 인자 검증 후에 한다.
    from docling.datamodel.base_models import ConversionStatus, InputFormat
    from docling.datamodel.pipeline_options import OcrMacOptions, PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    opts = PdfPipelineOptions()
    opts.do_table_structure = False  # 문항 분해에는 불필요 — 속도 우선
    opts.do_ocr = args.ocr == "on"
    if opts.do_ocr:
        # macOS Vision OCR — 한국어 시험지 기준
        opts.ocr_options = OcrMacOptions(lang=["ko-KR", "en-US"])

    converter = DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)}
    )
    kw = {}
    if args.max_pages:
        kw["page_range"] = (1, args.max_pages)
    # raises_on_error 기본값(True)이면 FAILURE 가 ConversionError 로 raise 되어
    # 아래 진단 경로가 죽은 코드가 된다 — False 로 받아서 직접 처리한다.
    from docling.exceptions import ConversionError

    try:
        result = converter.convert(pdf, raises_on_error=False, **kw)
    except (ConversionError, StopIteration) as e:
        print(f"✖ 변환 실패: {e}", file=sys.stderr)
        return 2
    if result.status not in (ConversionStatus.SUCCESS, ConversionStatus.PARTIAL_SUCCESS):
        print(f"✖ 변환 실패: {result.status}", file=sys.stderr)
        for err in getattr(result, "errors", []) or []:
            print(f"  - {err}", file=sys.stderr)
        return 2
    partial = result.status == ConversionStatus.PARTIAL_SUCCESS
    if partial:
        print("⚠️  일부 페이지 변환 실패(PARTIAL_SUCCESS) — 해당 페이지 문항은 검출되지 않습니다:", file=sys.stderr)
        for err in getattr(result, "errors", []) or []:
            print(f"  - {err}", file=sys.stderr)

    doc = result.document
    pages = {
        no: {"no": no, "width": p.size.width, "height": p.size.height, "blocks": []}
        for no, p in sorted(doc.pages.items())
    }

    # furniture(페이지 헤더/푸터)도 포함 — 시험지 그룹 판정(예: "미적분" 헤더)에 필요.
    # kind(page_header/page_footer)로 구분되므로 소비측에서 걸러 쓴다.
    from docling_core.types.doc import ContentLayer

    layers = {ContentLayer.BODY, ContentLayer.FURNITURE}
    for item, _level in doc.iterate_items(included_content_layers=layers):
        provs = getattr(item, "prov", None)
        if not provs:
            continue
        text = (getattr(item, "text", "") or "").strip()
        label = getattr(item, "label", None)
        kind = getattr(label, "value", str(label)) if label is not None else "text"
        # 한 아이템이 여러 페이지/영역에 걸칠 수 있다 — prov 별로 기록.
        # 멀티-prov 면 charspan 으로 해당 영역의 텍스트만 슬라이스(전문 중복 방지).
        for prov in provs:
            pg = pages.get(prov.page_no)
            if pg is None:
                continue
            btxt = text
            span = getattr(prov, "charspan", None)
            if len(provs) > 1 and span and len(span) == 2:
                try:
                    btxt = text[span[0]:span[1]].strip() or text
                except Exception:
                    btxt = text
            bb = prov.bbox.to_top_left_origin(pg["height"])
            pg["blocks"].append({
                "kind": kind,
                "text": btxt,
                "x": round(bb.l, 2), "y": round(bb.t, 2),
                "x2": round(bb.r, 2), "y2": round(bb.b, 2),
            })

    from importlib.metadata import PackageNotFoundError, version
    try:
        docling_version = version("docling-slim")
    except PackageNotFoundError:
        try:
            docling_version = version("docling")
        except PackageNotFoundError:
            docling_version = "unknown"

    nos = sorted(pages)
    contiguous = nos == list(range(nos[0], nos[-1] + 1)) if nos else True
    if not contiguous:
        print(f"⚠️  페이지 비연속: {nos} — 누락 페이지의 문항은 검출되지 않습니다", file=sys.stderr)

    out = {
        "engine": "docling",
        "schemaVersion": SCHEMA_VERSION,
        "doclingVersion": docling_version,
        "status": "partial_success" if partial else "success",
        "ocr": opts.do_ocr,
        "pdf": str(pdf),
        "pages": [pages[k] for k in nos],
    }
    payload = json.dumps(out, ensure_ascii=False)
    if args.out:
        # 원자적 쓰기 — 중단 시 잘린 JSON 이 신선한 캐시로 남지 않게 한다
        out_path = Path(args.out)
        tmp = out_path.with_name(out_path.name + ".tmp")
        tmp.write_text(payload, encoding="utf-8")
        os.replace(tmp, out_path)
        nblocks = sum(len(p["blocks"]) for p in out["pages"])
        print(f"✅ {pdf.name} → {args.out} ({len(out['pages'])}p, {nblocks} blocks)")
    else:
        print(payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
