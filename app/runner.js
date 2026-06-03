// app/runner.js — GED-ready runner

function decodeHtmlEntitiesDeep(text = "") {
  let s = String(text);
  for (let i = 0; i < 3; i++) {
    const ta = document.createElement("textarea");
    ta.innerHTML = s;
    const decoded = ta.value;
    if (decoded === s) break;
    s = decoded;
  }
  return s;
}

function renderInlineMarkup(text = "") {
  let s = decodeHtmlEntitiesDeep(text);
  s = s.replace(/<(?!\/?(u|i|br|strong|em)\b)[^>]*>/gi, "");
  s = s.replace(/\n/g, "<br>");
  return s;
}

function qs(id) {
  return document.getElementById(id);
}

function fmtTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function cleanText(s = "") {
  return String(s).replace(/\s+/g, " ").trim();
}

function normalizeCompare(s = "") {
  return cleanText(s).toLowerCase();
}

function decodeMap(obj = {}) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    out[String(k)] = decodeHtmlEntitiesDeep(v);
  }
  return out;
}

function normalizeDropdowns(raw) {
  const out = {};
  if (!raw) return out;

  if (Array.isArray(raw)) {
    raw.forEach((entry, idx) => {
      const key = entry.id || entry.key || `D${idx + 1}`;
      const opts = entry.options || entry.choices || [];
      out[key] = opts.map(x => decodeHtmlEntitiesDeep(x));
    });
    return out;
  }

  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) {
      out[k] = v.map(x => decodeHtmlEntitiesDeep(x));
    } else if (typeof v === "string") {
      out[k] = v.split("|").map(x => decodeHtmlEntitiesDeep(x.trim())).filter(Boolean);
    }
  }
  return out;
}

function normalizeQuestion(q) {
  const rawType = String(q.itemType || q.type || "").trim().toLowerCase();

  let itemType = "mcq";
  if (["mcq", "mcq_single", "multiple_choice", "multiple-choice"].includes(rawType)) itemType = "mcq";
  else if (["multi_select", "multiselect", "multiple_select", "select_multiple"].includes(rawType)) itemType = "multi_select";
  else if (["numeric_entry", "numeric", "number_entry", "fill_in", "fill-in"].includes(rawType)) itemType = "numeric_entry";
  else if (["dropdown", "drop_down"].includes(rawType)) itemType = "dropdown";
  else if (["drag_drop", "drag-and-drop", "dragdrop", "matching"].includes(rawType)) itemType = "drag_drop";
  else if (["essay", "extended_response", "writing", "constructed_response", "constructed"].includes(rawType)) itemType = "essay";

  const choices = decodeMap(q.choices || {});
  const dropdowns = normalizeDropdowns(q.dropdowns || q.dropdownOptions || {});
  const tiles = decodeMap(q.tiles || {});
  const targets = decodeMap(q.targets || {});

  return {
    ...q,
    itemType,
    section: cleanText(q.section || ""),
    category: cleanText(q.category || ""),
    skill: cleanText(q.skill || ""),
    part: cleanText(q.part || ""),
    calculator: cleanText(q.calculator || q.Calculator || ""),
    credits: Number(q.credits ?? (itemType === "essay" ? 0 : 1)),
    prompt: decodeHtmlEntitiesDeep(q.prompt || ""),
    instruction: decodeHtmlEntitiesDeep(q.instruction || ""),
    explanation: decodeHtmlEntitiesDeep(q.explanation || ""),
    modelAnswer: decodeHtmlEntitiesDeep(q.modelAnswer || q.scoringGuidance || ""),
    scoringGuidance: decodeHtmlEntitiesDeep(q.scoringGuidance || q.modelAnswer || ""),
    rubric: decodeHtmlEntitiesDeep(q.rubric || ""),
    correct: q.correct ?? "",
    correctAnswerText: decodeHtmlEntitiesDeep(q.correctAnswerText || ""),
    tolerance: cleanText(q.tolerance || "exact"),
    choices,
    dropdowns,
    tiles,
    targets
  };
}

function getPartLabel(q) {
  const parts = [];
  if (q.category) parts.push(q.category);
  if (q.skill) parts.push(q.skill);
  if (q.calculator) parts.push(q.calculator);
  if (q.part) parts.push(`Part ${q.part}`);
  return parts.join(" — ");
}

function getDefaultInstruction(q) {
  if (q.itemType === "multi_select") return "Select all required answers.";
  if (q.itemType === "numeric_entry") return "Type your answer in the box.";
  if (q.itemType === "dropdown") return "Choose the best option for each dropdown.";
  if (q.itemType === "drag_drop") return "Match each target with the correct tile.";
  if (q.itemType === "essay") return "Write your response in the box. This response is not auto-scored.";
  return "Select one answer choice.";
}

function practiceCursorKey(examId, sectionId) {
  return `practiceCursor_${examId}_${sectionId}`;
}

function getPracticeSlice(allQs, chunkSize, examId, sectionId) {
  const key = practiceCursorKey(examId, sectionId);
  let cursor = parseInt(localStorage.getItem(key) || "0", 10);
  if (!Number.isFinite(cursor) || cursor >= allQs.length) cursor = 0;

  const start = cursor;
  const end = Math.min(cursor + chunkSize, allQs.length);
  const slice = allQs.slice(start, end);

  cursor = end;
  if (cursor >= allQs.length) cursor = 0;
  localStorage.setItem(key, String(cursor));

  return { slice, start, end, total: allQs.length };
}

function answerDraftKey(examId, sectionId, qid) {
  return `draft_${examId}_${sectionId}_${qid}`;
}

async function loadQuestionsForSection(examId, section) {
  const files = (section.examFiles && section.examFiles.length)
    ? section.examFiles
    : [];

  const all = [];
  if (!files.length) return all;
  for (const f of files) {
    const path = `../packs/${examId}/data/${f}`;
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Missing question file: ${path}`);

    const raw = await res.json();
    const rawQuestions = Array.isArray(raw)
      ? raw
      : (Array.isArray(raw.questions) ? raw.questions : []);

    all.push({
      file: f,
      title: raw.title || f,
      questions: rawQuestions.map(normalizeQuestion)
    });
  }
  return all;
}

function selectedLettersEqual(userArr, correctString) {
  const user = Array.isArray(userArr) ? userArr.map(String) : [];
  const correct = String(correctString || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

  if (user.length !== correct.length) return false;

  const a = [...user].sort().join(",");
  const b = [...correct].sort().join(",");
  return a === b;
}

function parseKeyValueCorrect(correct) {
  if (correct && typeof correct === "object" && !Array.isArray(correct)) return correct;

  const out = {};
  String(correct || "")
    .split(";")
    .map(x => x.trim())
    .filter(Boolean)
    .forEach(pair => {
      const m = pair.match(/^([^=]+)=(.+)$/);
      if (m) out[m[1].trim()] = m[2].trim();
    });
  return out;
}

function parseTolerance(tolerance) {
  const t = String(tolerance || "exact").trim();
  if (t.toLowerCase() === "exact") return null;
  const m = t.match(/([0-9]*\.?[0-9]+)/);
  return m ? Number(m[1]) : null;
}

function isPlainNumber(s) {
  return /^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(String(s).trim());
}

function numericCorrect(user, correct, tolerance) {
  const u = cleanText(user);
  const c = cleanText(correct);

  const tol = parseTolerance(tolerance);
  if (tol !== null && isPlainNumber(u) && isPlainNumber(c)) {
    return Math.abs(Number(u) - Number(c)) <= tol + 1e-12;
  }

  if (isPlainNumber(u) && isPlainNumber(c)) {
    return Math.abs(Number(u) - Number(c)) < 1e-12;
  }

  return normalizeCompare(u) === normalizeCompare(c);
}

function dropdownCorrect(userObj, correct) {
  const user = userObj && typeof userObj === "object" ? userObj : {};
  const corr = parseKeyValueCorrect(correct);

  const keys = Object.keys(corr);
  if (!keys.length) return false;

  return keys.every(k => normalizeCompare(user[k]) === normalizeCompare(corr[k]));
}

function dragDropCorrect(userObj, correct) {
  const user = userObj && typeof userObj === "object" ? userObj : {};
  const corr = parseKeyValueCorrect(correct);

  const keys = Object.keys(corr);
  if (!keys.length) return false;

  return keys.every(k => normalizeCompare(user[k]) === normalizeCompare(corr[k]));
}

function isAutoScorable(q) {
  return q.itemType !== "essay";
}

function isCorrect(q, answer) {
  if (q.itemType === "mcq") return String(answer || "") === String(q.correct || "");
  if (q.itemType === "multi_select") return selectedLettersEqual(answer, q.correct);
  if (q.itemType === "numeric_entry") return numericCorrect(answer, q.correct, q.tolerance);
  if (q.itemType === "dropdown") return dropdownCorrect(answer, q.correct);
  if (q.itemType === "drag_drop") return dragDropCorrect(answer, q.correct);
  return false;
}

function formatUserAnswer(q, answer) {
  if (answer == null || answer === "") return "(no answer)";

  if (q.itemType === "multi_select") {
    return Array.isArray(answer) && answer.length ? answer.join(",") : "(no answer)";
  }

  if (q.itemType === "dropdown" || q.itemType === "drag_drop") {
    const obj = answer && typeof answer === "object" ? answer : {};
    const keys = Object.keys(obj);
    if (!keys.length) return "(no answer)";
    return keys.map(k => `${k}=${obj[k]}`).join("; ");
  }

  return String(answer);
}

function formatCorrectAnswer(q) {
  if (q.correctAnswerText) return q.correctAnswerText;

  if (q.itemType === "mcq") {
    return `${q.correct}${q.choices[q.correct] ? ". " + q.choices[q.correct] : ""}`;
  }

  if (q.itemType === "multi_select") {
    return String(q.correct || "");
  }

  if (q.itemType === "numeric_entry") {
    return String(q.correct || "");
  }

  if (q.itemType === "dropdown") {
    return String(q.correct || "");
  }

  if (q.itemType === "drag_drop") {
    const corr = parseKeyValueCorrect(q.correct);
    const pieces = [];
    Object.entries(corr).forEach(([target, tileLetter]) => {
      pieces.push(`${target}=${q.tiles[tileLetter] || tileLetter}`);
    });
    return pieces.join("; ");
  }

  if (q.itemType === "essay") return "Not auto-scored";
  return String(q.correct || "");
}

(async function () {
  const examId = getExamFromUrl();

  if (!isAccessGranted(examId)) {
    goToWelcome(examId);
    return;
  }

  const cfg = await loadConfig(examId);
  applyTheme(cfg.theme || "dark");
  qs("brand").textContent = cfg.brandName;
  qs("logo").src = cfg.logoPath;

  const params = new URLSearchParams(window.location.search);
  const sectionId = params.get("section");
  const mode = params.get("mode");

  const section = cfg.sections.find(s => s.id === sectionId);
  if (!section) {
    qs("title").textContent = "Error";
    qs("desc").textContent = "Unknown section.";
    return;
  }

  let examSets = [];
  try {
    examSets = await loadQuestionsForSection(examId, section);
  } catch (err) {
    qs("title").textContent = "Question file error";
    qs("desc").textContent = err.message;
    return;
  }

  const pooledQs = examSets.flatMap(s => s.questions || []);

  if (!pooledQs.length) {
    qs("title").textContent = "No questions available";
    qs("desc").textContent = "No imported GED questions were found for this section yet.";
    return;
  }

  let sessionQs = [];
  let metaText = "";

  if (mode === "practice") {
    const info = getPracticeSlice(pooledQs, cfg.practiceChunkSize || 10, examId, sectionId);
    sessionQs = info.slice;
    metaText = `Practice block: ${info.start + 1}–${info.end} of ${info.total}`;
  } else {
    const rotKey = `examRotation_${examId}_${sectionId}`;
    let rot = parseInt(localStorage.getItem(rotKey) || "0", 10);
    if (!Number.isFinite(rot) || rot < 0 || rot >= examSets.length) rot = 0;

    const chosen = examSets[rot];
    localStorage.setItem(rotKey, String((rot + 1) % examSets.length));

    const n = Math.min(section.examQuestions || chosen.questions.length, chosen.questions.length);
    sessionQs = chosen.questions.slice(0, n);
    metaText = `Loaded set: ${chosen.file}`;
  }

  let idx = 0;
  const answers = {};
  const startTime = Date.now();

  let timerInterval = null;
  let finished = false;
  let remaining = (section.timeMin || 0) * 60;

  function ensureObjectAnswer(q) {
    if (!answers[q.id] || typeof answers[q.id] !== "object" || Array.isArray(answers[q.id])) {
      answers[q.id] = {};
    }
    return answers[q.id];
  }

  function renderMcq(q, box) {
    ["A", "B", "C", "D"].forEach(letter => {
      if (!q.choices || q.choices[letter] == null) return;

      const row = document.createElement("label");
      row.className = "choice";

      const input = document.createElement("input");
      input.type = "radio";
      input.name = `choice_${q.id}`;
      input.value = letter;
      input.checked = answers[q.id] === letter;

      input.addEventListener("change", () => {
        answers[q.id] = letter;
      });

      const span = document.createElement("span");
      span.className = "choiceText";
      span.innerHTML = `${letter}. ${renderInlineMarkup(q.choices[letter])}`;

      row.appendChild(input);
      row.appendChild(span);
      box.appendChild(row);
    });
  }

  function renderMultiSelect(q, box) {
    const letters = Object.keys(q.choices || {}).sort();

    if (!Array.isArray(answers[q.id])) answers[q.id] = [];

    letters.forEach(letter => {
      const row = document.createElement("label");
      row.className = "choice";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = `choice_${q.id}`;
      input.value = letter;
      input.checked = answers[q.id].includes(letter);

      input.addEventListener("change", () => {
        const set = new Set(answers[q.id]);
        if (input.checked) set.add(letter);
        else set.delete(letter);
        answers[q.id] = [...set].sort();
      });

      const span = document.createElement("span");
      span.className = "choiceText";
      span.innerHTML = `${letter}. ${renderInlineMarkup(q.choices[letter])}`;

      row.appendChild(input);
      row.appendChild(span);
      box.appendChild(row);
    });
  }

  function renderNumeric(q, box) {
    const wrap = document.createElement("div");
    wrap.className = "constructedWrap";

    const input = document.createElement("input");
    input.className = "select";
    input.type = "text";
    input.placeholder = "Type your answer";
    input.value = answers[q.id] || "";

    input.addEventListener("input", () => {
      answers[q.id] = input.value;
    });

    wrap.appendChild(input);
    box.appendChild(wrap);
  }

  function renderDropdown(q, box) {
    const wrap = document.createElement("div");
    wrap.className = "constructedWrap";

    const ans = ensureObjectAnswer(q);
    Object.entries(q.dropdowns || {}).forEach(([key, options]) => {
      const label = document.createElement("label");
      label.className = "label";
      label.textContent = key;

      const select = document.createElement("select");
      select.className = "select";

      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "Choose...";
      select.appendChild(empty);

      options.forEach(opt => {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        select.appendChild(o);
      });

      select.value = ans[key] || "";
      select.addEventListener("change", () => {
        ans[key] = select.value;
        answers[q.id] = ans;
      });

      wrap.appendChild(label);
      wrap.appendChild(select);
    });

    box.appendChild(wrap);
  }

  function renderDragDrop(q, box) {
    const wrap = document.createElement("div");
    wrap.className = "constructedWrap";

    const ans = ensureObjectAnswer(q);
    Object.entries(q.targets || {}).forEach(([targetKey, targetText]) => {
      const label = document.createElement("label");
      label.className = "label";
      label.innerHTML = `${targetKey}. ${renderInlineMarkup(targetText)}`;

      const select = document.createElement("select");
      select.className = "select";

      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "Choose tile...";
      select.appendChild(empty);

      Object.entries(q.tiles || {}).forEach(([tileKey, tileText]) => {
        const o = document.createElement("option");
        o.value = tileKey;
        o.textContent = `${tileKey}. ${tileText}`;
        select.appendChild(o);
      });

      select.value = ans[targetKey] || "";
      select.addEventListener("change", () => {
        ans[targetKey] = select.value;
        answers[q.id] = ans;
      });

      wrap.appendChild(label);
      wrap.appendChild(select);
    });

    box.appendChild(wrap);
  }

  function renderEssay(q, box) {
    const wrap = document.createElement("div");
    wrap.className = "constructedWrap";

    const label = document.createElement("label");
    label.className = "label";
    label.textContent = "Your Response";

    const textarea = document.createElement("textarea");
    textarea.className = "essayBox";
    textarea.placeholder = "Start writing here...";

    const draftKey = answerDraftKey(examId, sectionId, q.id);
    const saved = answers[q.id] ?? localStorage.getItem(draftKey) ?? "";
    textarea.value = saved;
    answers[q.id] = saved;

    const helper = document.createElement("p");
    helper.className = "helper";

    function updateHelper() {
      const words = textarea.value.trim() ? textarea.value.trim().split(/\s+/).length : 0;
      helper.textContent = `Word count: ${words}. Saved automatically in this browser.`;
    }

    textarea.addEventListener("input", () => {
      answers[q.id] = textarea.value;
      localStorage.setItem(draftKey, textarea.value);
      updateHelper();
    });

    updateHelper();

    wrap.appendChild(label);
    wrap.appendChild(textarea);
    wrap.appendChild(helper);
    box.appendChild(wrap);
  }

  function render() {
    const q = sessionQs[idx];

    qs("title").textContent = `${section.label} — ${mode === "practice" ? "Practice Mode" : "Exam Mode"}`;
    qs("desc").textContent = mode === "practice"
      ? `${cfg.practiceChunkSize || 10}-question practice block.`
      : `Timed full section: ${sessionQs.length} item${sessionQs.length === 1 ? "" : "s"} in ${section.timeMin} minutes.`;

    qs("metaLine").textContent = metaText;
    qs("progress").textContent = `Question ${idx + 1} of ${sessionQs.length}`;

    const partEl = qs("itemPart");
    if (partEl) partEl.textContent = getPartLabel(q);

    const instructionEl = qs("itemInstruction");
    if (instructionEl) instructionEl.textContent = q.instruction || getDefaultInstruction(q);

    qs("prompt").innerHTML = renderInlineMarkup(q.prompt);

    const box = qs("choices");
    box.innerHTML = "";

    if (q.itemType === "multi_select") renderMultiSelect(q, box);
    else if (q.itemType === "numeric_entry") renderNumeric(q, box);
    else if (q.itemType === "dropdown") renderDropdown(q, box);
    else if (q.itemType === "drag_drop") renderDragDrop(q, box);
    else if (q.itemType === "essay") renderEssay(q, box);
    else renderMcq(q, box);

    qs("prevBtn").disabled = idx === 0;
    qs("nextBtn").disabled = idx === sessionQs.length - 1;
  }

  function finish() {
    if (finished) return;
    finished = true;

    if (timerInterval) clearInterval(timerInterval);

    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);

    const autoQs = sessionQs.filter(isAutoScorable);
    const essayQs = sessionQs.filter(q => q.itemType === "essay");

    let correct = 0;
    autoQs.forEach(q => {
      if (isCorrect(q, answers[q.id])) correct++;
    });

    const pct = autoQs.length ? Math.round((correct / autoQs.length) * 100) : 0;

    qs("runnerPanel").classList.add("hidden");
    qs("essayPanel").classList.add("hidden");
    qs("essayResultsPanel").classList.add("hidden");
    qs("resultsPanel").classList.remove("hidden");

    qs("scoreLine").textContent =
      `Auto-scored items: ${pct}% (${correct}/${autoQs.length} correct). ` +
      `Extended Response / essay items: ${essayQs.length} not auto-scored.`;

    qs("timeLine").textContent = `Time used: ${fmtTime(elapsedSec)}`;

    const review = qs("review");
    review.innerHTML = "";

    sessionQs.forEach((q, i) => {
      const auto = isAutoScorable(q);
      const ok = auto && isCorrect(q, answers[q.id]);
      const user = formatUserAnswer(q, answers[q.id]);

      const block = document.createElement("div");
      block.className = "reviewBlock";

      const num = document.createElement("div");
      num.className = auto ? (ok ? "qnum qnum-ok" : "qnum qnum-bad") : "qnum";
      num.textContent = `Q${i + 1}`;

      const text = document.createElement("div");
      text.className = "reviewText";

      const part = document.createElement("div");
      part.className = "reviewAns";
      part.textContent = getPartLabel(q);

      const p = document.createElement("div");
      p.className = "reviewPrompt";
      p.innerHTML = renderInlineMarkup(q.prompt);

      text.appendChild(part);
      text.appendChild(p);

      const a = document.createElement("div");
      a.className = "reviewAns";

      if (q.itemType === "essay") {
        a.textContent = `Your response: ${user}`;

        const guidance = document.createElement("div");
        guidance.className = "reviewExp";
        guidance.innerHTML =
          `<strong>This response is not auto-scored.</strong><br>` +
          (q.modelAnswer || q.scoringGuidance
            ? renderInlineMarkup(q.modelAnswer || q.scoringGuidance)
            : "Review whether your response makes a clear claim, uses evidence, explains reasoning, and maintains formal organization and language.");

        const rubric = document.createElement("div");
        rubric.className = "reviewExp";
        rubric.innerHTML =
          `<strong>Rubric / self-review criteria:</strong><br>` +
          (q.rubric
            ? renderInlineMarkup(q.rubric)
            : "Check focus, evidence, development, organization, sentence control, grammar, and conventions.");

        text.appendChild(a);
        text.appendChild(guidance);
        text.appendChild(rubric);
      } else {
        a.textContent = `Your answer: ${user}    |    Correct: ${formatCorrectAnswer(q)}`;

        const ex = document.createElement("div");
        ex.className = "reviewExp";
        ex.textContent = q.explanation || "";

        text.appendChild(a);
        text.appendChild(ex);
      }

      block.appendChild(num);
      block.appendChild(text);
      review.appendChild(block);
    });
  }

  if (mode !== "practice") {
    const timerEl = qs("timer");
    if (timerEl) {
      timerEl.classList.remove("hidden");
      timerEl.textContent = fmtTime(remaining);
    }

    timerInterval = setInterval(() => {
      remaining--;
      if (timerEl) timerEl.textContent = fmtTime(Math.max(0, remaining));
      if (remaining <= 0) finish();
    }, 1000);
  } else {
    const timerEl = qs("timer");
    if (timerEl) timerEl.classList.add("hidden");
  }

  qs("prevBtn").addEventListener("click", () => {
    if (idx > 0) {
      idx--;
      render();
    }
  });

  qs("nextBtn").addEventListener("click", () => {
    if (idx < sessionQs.length - 1) {
      idx++;
      render();
    }
  });

  qs("finishBtn").addEventListener("click", finish);

  qs("backLink").addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = `app.html?exam=${encodeURIComponent(examId)}`;
  });

  qs("homeBtn").addEventListener("click", () => {
    window.location.href = `app.html?exam=${encodeURIComponent(examId)}`;
  });

  render();
})();
