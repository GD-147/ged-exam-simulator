#!/usr/bin/env python3
from pathlib import Path
import json
import re
import sys
import shutil

SRC_DIR = Path("imports/ged_exams/txt")
PDF_SRC_DIR = Path("imports/ged_exams/pdf")
OUT_DIR = Path("packs/ged/data")
PDF_OUT_DIR = Path("packs/ged/pdf")
CONFIG_PATH = Path("packs/ged/config.json")

ID_RE = re.compile(r"^GED-(RLA|MATH|SCI|SOC)(\d+)-(ER|\d{3})$")
CHOICE_RE = re.compile(r"^([A-E])\)\s*(.*)$")
DROPDOWN_RE = re.compile(r"^(D\d+)\)\s*(.*)$")
TARGET_RE = re.compile(r"^(T\d+)\)\s*(.*)$")

KEY_RE = re.compile(
    r"^(GED-(?:RLA|MATH|SCI|SOC)\d+-(?:ER|\d{3}))\s+[—–-]\s+"
    r"Correct:\s+(.*?)\s+[—–-]\s+"
    r"(?:(?:Tolerance:\s+(.*?)\s+[—–-]\s+)?)"
    r"Correct Answer:\s+(.*?)\s+[—–-]\s+"
    r"Explanation:\s+(.*)$"
)

SECTION_INFO = {
    "RLA": {
        "section_id": "rla",
        "title": "GED RLA Practice Test",
        "file": "ged_rla_exam_{n:02d}.json",
        "expected_ids": [f"{i:03d}" for i in range(1, 47)] + ["ER"],
        "expected_count": 47,
    },
    "MATH": {
        "section_id": "math",
        "title": "GED Math Practice Test",
        "file": "ged_math_exam_{n:02d}.json",
        "expected_ids": [f"{i:03d}" for i in range(1, 47)],
        "expected_count": 46,
    },
    "SCI": {
        "section_id": "science",
        "title": "GED Science Practice Test",
        "file": "ged_science_exam_{n:02d}.json",
        "expected_ids": [f"{i:03d}" for i in range(1, 35)],
        "expected_count": 34,
    },
    "SOC": {
        "section_id": "social",
        "title": "GED Social Studies Practice Test",
        "file": "ged_social_exam_{n:02d}.json",
        "expected_ids": [f"{i:03d}" for i in range(1, 36)],
        "expected_count": 35,
    },
}

TYPE_ALIASES = {
    "mcq": "mcq",
    "multiple_choice": "mcq",
    "multiple-choice": "mcq",
    "multi_select": "multi_select",
    "multiselect": "multi_select",
    "multiple_select": "multi_select",
    "select_multiple": "multi_select",
    "numeric_entry": "numeric_entry",
    "numeric": "numeric_entry",
    "number_entry": "numeric_entry",
    "dropdown": "dropdown",
    "drop_down": "dropdown",
    "drag_drop": "drag_drop",
    "dragdrop": "drag_drop",
    "drag-and-drop": "drag_drop",
    "matching": "drag_drop",
    "essay": "essay",
    "extended_response": "essay",
    "writing": "essay",
}


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", str(s).strip())


def clean_multiline(s: str) -> str:
    lines = str(s).replace("\r\n", "\n").replace("\r", "\n").split("\n")
    return "\n".join(line.rstrip() for line in lines).strip()


def comparable(s: str) -> str:
    return clean(s).lower()


def read_text(path: Path) -> str:
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    return text.replace("\r\n", "\n").replace("\r", "\n")


def split_sections(text: str):
    markers = [
        "PART B — ANSWER KEY + EXPLANATIONS",
        "PART B – ANSWER KEY + EXPLANATIONS",
        "PART B - ANSWER KEY + EXPLANATIONS",
    ]
    for marker in markers:
        if marker in text:
            return text.split(marker, 1)
    raise ValueError("Missing PART B — ANSWER KEY + EXPLANATIONS section.")


def append_field(item, field, text):
    if item.get(field):
        item[field] += "\n" + text
    else:
        item[field] = text


def parse_questions(q_text: str):
    lines = q_text.splitlines()
    starts = []

    for i, raw in enumerate(lines):
        s = raw.strip()
        if ID_RE.match(s):
            starts.append((i, s))

    items = []
    for idx, (start_i, qid) in enumerate(starts):
        end_i = starts[idx + 1][0] if idx + 1 < len(starts) else len(lines)
        block_lines = lines[start_i + 1:end_i]
        items.append(parse_question_block(qid, block_lines))

    return items


def parse_question_block(qid: str, block_lines):
    item = {
        "id": qid,
        "section": "",
        "type": "",
        "itemType": "",
        "category": "",
        "skill": "",
        "calculator": "",
        "prompt": "",
        "choices": {},
        "dropdowns": {},
        "tiles": {},
        "targets": {},
        "correct": "",
        "correctAnswerText": "",
        "tolerance": "exact",
        "explanation": "",
        "modelAnswer": "",
        "scoringGuidance": "",
        "rubric": "",
        "credits": 1,
    }

    current_field = None
    current_choice = None
    current_collection = None
    current_collection_key = None

    simple_fields = {
        "Section:": "section",
        "Type:": "type",
        "Category:": "category",
        "Skill:": "skill",
        "Calculator:": "calculator",
    }

    for raw in block_lines:
        line = raw.rstrip()
        stripped = line.strip()

        if not stripped:
            if current_field == "prompt":
                item["prompt"] += "\n"
            elif current_choice:
                item["choices"][current_choice] += "\n"
            elif current_collection and current_collection_key:
                item[current_collection][current_collection_key] += "\n"
            continue

        matched = False
        for label, field in simple_fields.items():
            if stripped.startswith(label):
                item[field] = stripped.split(":", 1)[1].strip()
                current_field = None
                current_choice = None
                current_collection = None
                current_collection_key = None
                matched = True
                break
        if matched:
            continue

        if stripped == "Prompt:":
            current_field = "prompt"
            current_choice = None
            current_collection = None
            current_collection_key = None
            continue

        if stripped == "Dropdowns:":
            current_field = None
            current_choice = None
            current_collection = "dropdowns"
            current_collection_key = None
            continue

        if stripped == "Tiles:":
            current_field = None
            current_choice = None
            current_collection = "tiles"
            current_collection_key = None
            continue

        if stripped == "Targets:":
            current_field = None
            current_choice = None
            current_collection = "targets"
            current_collection_key = None
            continue

        if current_collection == "dropdowns":
            dm = DROPDOWN_RE.match(stripped)
            if dm:
                key, value = dm.groups()
                item["dropdowns"][key] = [clean(x) for x in value.split("|") if clean(x)]
                current_collection_key = key
                continue

        if current_collection == "tiles":
            cm = CHOICE_RE.match(stripped)
            if cm:
                key, value = cm.groups()
                item["tiles"][key] = value.strip()
                current_collection_key = key
                continue

        if current_collection == "targets":
            tm = TARGET_RE.match(stripped)
            if tm:
                key, value = tm.groups()
                item["targets"][key] = value.strip()
                current_collection_key = key
                continue

        cm = CHOICE_RE.match(stripped)
        if cm and current_collection is None:
            letter, value = cm.groups()
            item["choices"][letter] = value.strip()
            current_choice = letter
            current_field = None
            continue

        if current_choice:
            item["choices"][current_choice] += "\n" + stripped
        elif current_collection and current_collection_key:
            if current_collection == "dropdowns":
                item[current_collection][current_collection_key].append(clean(stripped))
            else:
                item[current_collection][current_collection_key] += "\n" + stripped
        elif current_field == "prompt":
            append_field(item, "prompt", stripped)

    for k in ["section", "type", "category", "skill", "calculator", "explanation", "modelAnswer", "scoringGuidance", "rubric"]:
        item[k] = clean(item.get(k, ""))

    item["prompt"] = clean_multiline(item.get("prompt", ""))
    item["choices"] = {k: clean_multiline(v) for k, v in item["choices"].items()}
    item["tiles"] = {k: clean_multiline(v) for k, v in item["tiles"].items()}
    item["targets"] = {k: clean_multiline(v) for k, v in item["targets"].items()}

    raw_type = item["type"].strip().lower()
    item_type = TYPE_ALIASES.get(raw_type, raw_type)
    item["type"] = item_type
    item["itemType"] = item_type

    return item


def parse_key(k_text: str):
    key = {}

    for raw in k_text.splitlines():
        line = raw.strip()
        if not line:
            continue

        m = KEY_RE.match(line)
        if not m:
            continue

        qid, correct, tolerance, correct_answer, explanation = m.groups()
        key[qid] = {
            "correct": clean(correct),
            "tolerance": clean(tolerance or "exact"),
            "correctAnswerText": clean(correct_answer),
            "explanation": clean(explanation),
        }

    return key


def parse_key_values(s: str):
    out = {}
    for part in str(s).split(";"):
        part = part.strip()
        if not part:
            continue
        if "=" not in part:
            continue
        k, v = part.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def expected_ids(section_code, exam_no):
    return [f"GED-{section_code}{exam_no}-{suffix}" for suffix in SECTION_INFO[section_code]["expected_ids"]]


def validate_items(section_code, exam_no, items, key):
    errors = []
    info = SECTION_INFO[section_code]

    ids = [x["id"] for x in items]
    exp = expected_ids(section_code, exam_no)

    if len(items) != info["expected_count"]:
        errors.append(f"expected {info['expected_count']} items, found {len(items)}.")

    if ids != exp:
        errors.append(f"IDs must run exactly {exp[0]} through {exp[-1]}. Found: {ids}")

    for item in items:
        qid = item["id"]
        t = item["itemType"]

        if not item.get("prompt"):
            errors.append(f"{qid}: missing Prompt.")

        if qid not in key:
            errors.append(f"{qid}: missing answer-key line.")
            continue

        item["correct"] = key[qid]["correct"]
        item["tolerance"] = key[qid]["tolerance"]
        item["correctAnswerText"] = key[qid]["correctAnswerText"]
        item["explanation"] = key[qid]["explanation"]

        if t == "mcq":
            if set(item["choices"].keys()) != {"A", "B", "C", "D"}:
                errors.append(f"{qid}: mcq must have exactly A, B, C, D choices.")
            letter = item["correct"]
            if letter not in item["choices"]:
                errors.append(f"{qid}: correct letter {letter} is not a valid choice.")
            elif comparable(item["choices"][letter]) != comparable(item["correctAnswerText"]):
                errors.append(f"{qid}: Correct Answer text does not match choice {letter}.")

        elif t == "multi_select":
            if len(item["choices"]) < 4:
                errors.append(f"{qid}: multi_select must have at least four choices.")
            letters = [x.strip() for x in item["correct"].split(",") if x.strip()]
            if len(letters) < 2:
                errors.append(f"{qid}: multi_select Correct must contain at least two letters, such as A,C.")
            for letter in letters:
                if letter not in item["choices"]:
                    errors.append(f"{qid}: correct letter {letter} is not a valid choice.")
            answer_parts = [clean(x) for x in item["correctAnswerText"].split("|") if clean(x)]
            if answer_parts and len(answer_parts) != len(letters):
                errors.append(f"{qid}: Correct Answer parts do not match number of selected letters.")

        elif t == "numeric_entry":
            if not item["correct"]:
                errors.append(f"{qid}: numeric_entry missing numeric Correct value.")
            item.pop("choices", None)
            item.pop("dropdowns", None)
            item.pop("tiles", None)
            item.pop("targets", None)

        elif t == "dropdown":
            if not item["dropdowns"]:
                errors.append(f"{qid}: dropdown item missing Dropdowns.")
            kv = parse_key_values(item["correct"])
            if not kv:
                errors.append(f"{qid}: dropdown Correct must use D1=value format.")
            for dk, dv in kv.items():
                if dk not in item["dropdowns"]:
                    errors.append(f"{qid}: dropdown key {dk} not found in Dropdowns.")
                elif comparable(dv) not in [comparable(x) for x in item["dropdowns"][dk]]:
                    errors.append(f"{qid}: dropdown correct value '{dv}' is not an option for {dk}.")
            item.pop("choices", None)
            item.pop("tiles", None)
            item.pop("targets", None)

        elif t == "drag_drop":
            if not item["tiles"] or not item["targets"]:
                errors.append(f"{qid}: drag_drop item missing Tiles or Targets.")
            kv = parse_key_values(item["correct"])
            if not kv:
                errors.append(f"{qid}: drag_drop Correct must use T1=A; T2=C format.")
            for tk, tile_letter in kv.items():
                if tk not in item["targets"]:
                    errors.append(f"{qid}: target {tk} not found in Targets.")
                if tile_letter not in item["tiles"]:
                    errors.append(f"{qid}: tile {tile_letter} not found in Tiles.")
            item.pop("choices", None)
            item.pop("dropdowns", None)

        elif t == "essay":
            if "not auto-scored" not in comparable(item["correct"]):
                errors.append(f"{qid}: essay Correct must be Not auto-scored.")
            item["modelAnswer"] = item["explanation"]
            item["scoringGuidance"] = item["explanation"]
            item["rubric"] = item["correctAnswerText"] if item["correctAnswerText"] != "Not auto-scored" else item["explanation"]
            item["credits"] = 0
            item.pop("choices", None)
            item.pop("dropdowns", None)
            item.pop("tiles", None)
            item.pop("targets", None)

        else:
            errors.append(f"{qid}: unsupported Type: {t}")

    return errors


def group_items(items):
    groups = {}

    for item in items:
        m = ID_RE.match(item["id"])
        if not m:
            continue
        section_code, exam_no, suffix = m.groups()
        groups.setdefault((section_code, exam_no), []).append(item)

    for key in groups:
        groups[key].sort(key=lambda x: expected_ids(key[0], key[1]).index(x["id"]) if x["id"] in expected_ids(key[0], key[1]) else 999)

    return groups


def output_name(section_code, exam_no):
    info = SECTION_INFO[section_code]
    return info["file"].format(n=int(exam_no))


def title_for(section_code, exam_no):
    info = SECTION_INFO[section_code]
    return f"{info['title']} {int(exam_no):02d}"


def write_json(section_code, exam_no, items):
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    section_id = SECTION_INFO[section_code]["section_id"]
    fname = output_name(section_code, exam_no)

    payload = {
        "title": title_for(section_code, exam_no),
        "section": section_id,
        "questions": items,
    }

    out_path = OUT_DIR / fname
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return fname, out_path


def printable_label_from_pdf(fname: str):
    stem = Path(fname).stem
    m = re.match(r"ged_(rla|math|science|social)_exam_(\d+)$", stem, re.I)
    if not m:
        return stem.replace("_", " ").title()

    section, n = m.groups()
    names = {
        "rla": "GED RLA Practice Exam",
        "math": "GED Math Practice Exam",
        "science": "GED Science Practice Exam",
        "social": "GED Social Studies Practice Exam",
    }
    return f"{names[section.lower()]} {int(n):02d}"


def sync_pdfs():
    PDF_OUT_DIR.mkdir(parents=True, exist_ok=True)

    for old in PDF_OUT_DIR.glob("*.pdf"):
        old.unlink()

    printables = []
    if not PDF_SRC_DIR.exists():
        return printables

    for src in sorted(PDF_SRC_DIR.glob("*.pdf")):
        dst = PDF_OUT_DIR / src.name
        shutil.copy2(src, dst)
        printables.append({
            "label": printable_label_from_pdf(src.name),
            "file": src.name,
        })

    return printables


def update_config(files_by_section, printables):
    if not CONFIG_PATH.exists():
        print(f"WARNING: {CONFIG_PATH} not found; config not updated.")
        return

    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))

    for section in cfg.get("sections", []):
        sid = section.get("id")
        section["examFiles"] = sorted(files_by_section.get(sid, []))

    cfg["printables"] = printables

    CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    if not SRC_DIR.exists():
        print(f"ERROR: source directory not found: {SRC_DIR}", file=sys.stderr)
        sys.exit(1)

    txt_files = sorted(SRC_DIR.glob("*.txt"))

    if not txt_files:
        print(f"No .txt files found in {SRC_DIR}. Importer is ready.")
        print("No JSON files were generated.")
        printables = sync_pdfs()
        update_config({}, printables)
        print(f"Config updated: {CONFIG_PATH}")
        return

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for old in OUT_DIR.glob("ged_*.json"):
        old.unlink()

    all_errors = []
    written = []
    files_by_section = {"rla": [], "math": [], "science": [], "social": []}

    for src in txt_files:
        try:
            text = read_text(src)
            q_text, k_text = split_sections(text)
            key = parse_key(k_text)
            items = parse_questions(q_text)

            if not items:
                all_errors.append(f"{src.name}: no GED item IDs found.")
                continue

            groups = group_items(items)

            if not groups:
                all_errors.append(f"{src.name}: no valid GED groups found.")
                continue

            for (section_code, exam_no), group in sorted(groups.items()):
                errors = validate_items(section_code, exam_no, group, key)

                if errors:
                    all_errors.extend([f"{src.name}: GED-{section_code}{exam_no}: {e}" for e in errors])
                    continue

                fname, out_path = write_json(section_code, exam_no, group)
                section_id = SECTION_INFO[section_code]["section_id"]
                files_by_section[section_id].append(fname)
                written.append(str(out_path))

        except Exception as e:
            all_errors.append(f"{src.name}: {e}")

    if all_errors:
        print("IMPORT FAILED.")
        for err in all_errors:
            print(f"- {err}")
        sys.exit(1)

    printables = sync_pdfs()
    update_config(files_by_section, printables)

    print("IMPORT OK.")
    for path in written:
        print(f"- {path}")

    if printables:
        print("")
        print("PDFs copied:")
        for item in printables:
            print(f"- {item['file']}")

    print("")
    print(f"Config updated: {CONFIG_PATH}")


if __name__ == "__main__":
    main()
