/**
 * Sellar 소싱 엑셀 필터 — 브라우저에서만 처리 (엑셀/프리셋 파일은 사용자 디스크)
 * 헤더는 줄바꿈/공백 정규화 후 매칭합니다. localStorage 미사용.
 */
(function () {
  const COL = {
    shopping: "쇼핑성키워드",
    season: "계절성",
    lastYearVol: "작년검색량",
    peakMonth: "작년최대검색월",
    peakVol: "작년최대검색월검색량",
    naverOver: "네이버해외배송비율",
    naverPrice: "네이버평균가",
    coupOver: "쿠팡해외배송비율",
    coupPrice: "쿠팡평균가",
    coupReviews: "쿠팡총리뷰수",
  };

  const PRESET_EXPORT_FORMAT = "sellar-filter-presets";

  /** @type {string[][]} */
  let rawRows = [];
  /** @type {string[]} */
  let headers = [];
  /** @type {Record<string, number>} */
  let col = {};
  let filteredRows = [];
  let activePreset = 0;

  function normHeader(h) {
    return String(h ?? "")
      .replace(/\r?\n/g, "")
      .replace(/\s+/g, "")
      .trim();
  }

  function defaultPreset(i) {
    return {
      name: "프리셋 " + (i + 1),
      shopping: "all",
      season: "all",
      lyMin: 0,
      lyMax: 0,
      peakMonths: [],
      peakMin: 0,
      peakMax: 0,
      nvOverMin: 0,
      nvOverMax: 0,
      nvPriceMin: 0,
      nvPriceMax: 0,
      cpOverMin: 0,
      cpOverMax: 0,
      cpPriceMin: 0,
      cpPriceMax: 0,
      cpRevMin: 0,
      cpRevMax: 0,
    };
  }

  function normalizeImportedPreset(p, i) {
    const d = defaultPreset(i);
    if (!p || typeof p !== "object") return d;
    const peakMonths = Array.isArray(p.peakMonths)
      ? p.peakMonths.map((m) => parseInt(String(m), 10)).filter((m) => m >= 1 && m <= 12)
      : [];
    return {
      ...d,
      ...p,
      name: typeof p.name === "string" && p.name.trim() ? p.name.trim() : d.name,
      shopping: ["all", "O", "X"].includes(p.shopping) ? p.shopping : d.shopping,
      season: ["all", "O", "X"].includes(p.season) ? p.season : d.season,
      peakMonths,
    };
  }

  function initialPresets() {
    return Array.from({ length: 5 }, (_, i) => defaultPreset(i));
  }

  let presets = initialPresets();

  function parseNum(v) {
    if (v === "" || v === null || v === undefined) return NaN;
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    const s = String(v).replace(/,/g, "").trim();
    if (s === "") return NaN;
    const n = Number(s);
    return n;
  }

  function buildColIndex(headerRow) {
    const m = {};
    headerRow.forEach((h, i) => {
      const k = normHeader(h);
      if (k && m[k] === undefined) m[k] = i;
    });
    return m;
  }

  function missingCols(m) {
    const need = Object.values(COL);
    return need.filter((k) => m[k] === undefined);
  }

  function getVal(row, key) {
    const i = col[key];
    if (i === undefined) return "";
    return row[i];
  }

  function rangeActive(min, max) {
    return (parseNum(min) || 0) > 0 || (parseNum(max) || 0) > 0;
  }

  function inRange(val, min, max) {
    const lo = parseNum(min) || 0;
    const hi = parseNum(max) || 0;
    if (!rangeActive(lo, hi)) return true;
    const n = parseNum(val);
    if (Number.isNaN(n)) return false;
    if (lo > 0 && n < lo) return false;
    if (hi > 0 && n > hi) return false;
    return true;
  }

  function inRangePercentRatio(val, minPct, maxPct) {
    const lo = parseNum(minPct) || 0;
    const hi = parseNum(maxPct) || 0;
    if (!rangeActive(lo, hi)) return true;
    const n = parseNum(val);
    if (Number.isNaN(n)) return false;
    if (lo > 0 && n < lo / 100) return false;
    if (hi > 0 && n > hi / 100) return false;
    return true;
  }

  function rowPasses(row, p) {
    const shop = String(getVal(row, COL.shopping) ?? "")
      .trim()
      .toUpperCase();
    if (p.shopping === "O" && shop !== "O") return false;
    if (p.shopping === "X" && shop !== "X") return false;

    const seasonRaw = String(getVal(row, COL.season) ?? "").trim();
    if (p.season === "O" && seasonRaw !== "있음") return false;
    if (p.season === "X" && seasonRaw !== "없음") return false;

    if (!inRange(getVal(row, COL.lastYearVol), p.lyMin, p.lyMax)) return false;

    if (p.peakMonths && p.peakMonths.length > 0) {
      const m = parseInt(String(getVal(row, COL.peakMonth) ?? "").trim(), 10);
      if (Number.isNaN(m) || !p.peakMonths.includes(m)) return false;
    }

    if (!inRange(getVal(row, COL.peakVol), p.peakMin, p.peakMax)) return false;

    if (!inRangePercentRatio(getVal(row, COL.naverOver), p.nvOverMin, p.nvOverMax)) return false;
    if (!inRange(getVal(row, COL.naverPrice), p.nvPriceMin, p.nvPriceMax)) return false;

    if (!inRangePercentRatio(getVal(row, COL.coupOver), p.cpOverMin, p.cpOverMax)) return false;
    if (!inRange(getVal(row, COL.coupPrice), p.cpPriceMin, p.cpPriceMax)) return false;
    if (!inRange(getVal(row, COL.coupReviews), p.cpRevMin, p.cpRevMax)) return false;

    return true;
  }

  function readUiToPreset() {
    const p = { ...presets[activePreset] };
    p.name = document.getElementById("presetName").value.trim() || "프리셋 " + (activePreset + 1);
    p.shopping = document.querySelector('input[name="shopping"]:checked').value;
    p.season = document.querySelector('input[name="season"]:checked').value;
    p.lyMin = parseNum(document.getElementById("lyMin").value) || 0;
    p.lyMax = parseNum(document.getElementById("lyMax").value) || 0;
    p.peakMin = parseNum(document.getElementById("peakMin").value) || 0;
    p.peakMax = parseNum(document.getElementById("peakMax").value) || 0;
    p.nvOverMin = parseNum(document.getElementById("nvOverMin").value) || 0;
    p.nvOverMax = parseNum(document.getElementById("nvOverMax").value) || 0;
    p.nvPriceMin = parseNum(document.getElementById("nvPriceMin").value) || 0;
    p.nvPriceMax = parseNum(document.getElementById("nvPriceMax").value) || 0;
    p.cpOverMin = parseNum(document.getElementById("cpOverMin").value) || 0;
    p.cpOverMax = parseNum(document.getElementById("cpOverMax").value) || 0;
    p.cpPriceMin = parseNum(document.getElementById("cpPriceMin").value) || 0;
    p.cpPriceMax = parseNum(document.getElementById("cpPriceMax").value) || 0;
    p.cpRevMin = parseNum(document.getElementById("cpRevMin").value) || 0;
    p.cpRevMax = parseNum(document.getElementById("cpRevMax").value) || 0;
    p.peakMonths = [];
    for (let m = 1; m <= 12; m++) {
      const el = document.getElementById("month" + m);
      if (el && el.checked) p.peakMonths.push(m);
    }
    return p;
  }

  function setRadioChecked(name, value) {
    const allowed = name === "shopping" ? ["all", "O", "X"] : ["all", "O", "X"];
    const v = allowed.includes(value) ? value : "all";
    const el = document.querySelector(`input[name="${name}"][value="${v}"]`);
    if (el) {
      el.checked = true;
      return;
    }
    const fallback = document.querySelector(`input[name="${name}"][value="all"]`);
    if (fallback) fallback.checked = true;
  }

  function presetToUi(p) {
    document.getElementById("presetName").value = p.name;
    setRadioChecked("shopping", p.shopping);
    setRadioChecked("season", p.season);
    document.getElementById("lyMin").value = p.lyMin || 0;
    document.getElementById("lyMax").value = p.lyMax || 0;
    document.getElementById("peakMin").value = p.peakMin || 0;
    document.getElementById("peakMax").value = p.peakMax || 0;
    document.getElementById("nvOverMin").value = p.nvOverMin ?? 0;
    document.getElementById("nvOverMax").value = p.nvOverMax ?? 0;
    document.getElementById("nvPriceMin").value = p.nvPriceMin || 0;
    document.getElementById("nvPriceMax").value = p.nvPriceMax || 0;
    document.getElementById("cpOverMin").value = p.cpOverMin ?? 0;
    document.getElementById("cpOverMax").value = p.cpOverMax ?? 0;
    document.getElementById("cpPriceMin").value = p.cpPriceMin || 0;
    document.getElementById("cpPriceMax").value = p.cpPriceMax || 0;
    document.getElementById("cpRevMin").value = p.cpRevMin || 0;
    document.getElementById("cpRevMax").value = p.cpRevMax || 0;
    const months = new Set(p.peakMonths || []);
    for (let m = 1; m <= 12; m++) {
      const el = document.getElementById("month" + m);
      if (el) el.checked = months.has(m);
    }
    document.getElementById("activePresetTitle").textContent = p.name;
  }

  function syncPresetFromUi() {
    presets[activePreset] = readUiToPreset();
  }

  function renderTabs() {
    const nav = document.getElementById("presetTabs");
    nav.innerHTML = "";
    for (let i = 0; i < 5; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "preset-tab" + (i === activePreset ? " active" : "");
      b.textContent = presets[i].name || "프리셋 " + (i + 1);
      b.addEventListener("click", () => {
        syncPresetFromUi();
        activePreset = i;
        presetToUi(presets[activePreset]);
        renderTabs();
        refreshPresetPreview();
      });
      nav.appendChild(b);
    }
  }

  function buildMonthChecks() {
    const host = document.getElementById("monthChecks");
    host.innerHTML = "";
    for (let m = 1; m <= 12; m++) {
      const lab = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = "month" + m;
      cb.value = String(m);
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(m + "월"));
      host.appendChild(lab);
    }
  }

  let previewTimer = null;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function refreshPresetPreview() {
    const sec = document.getElementById("presetPreviewSection");
    const wrap = document.getElementById("presetPreviewTable");
    if (!sec || !wrap) return;
    if (!rawRows.length || !headers.length) {
      sec.hidden = true;
      wrap.innerHTML = "";
      return;
    }
    syncPresetFromUi();
    const miss = missingCols(col);
    sec.hidden = false;
    if (miss.length) {
      wrap.innerHTML =
        "<p class=\"warn\">다음 열이 없어 미리보기·필터를 쓸 수 없습니다: " +
        escapeHtml(miss.join(", ")) +
        "</p>";
      return;
    }
    const total = rawRows.length;
    const counts = [0, 0, 0, 0, 0];
    for (let r = 0; r < rawRows.length; r++) {
      const row = rawRows[r];
      for (let i = 0; i < 5; i++) {
        if (rowPasses(row, presets[i])) counts[i]++;
      }
    }
    let html =
      "<table class=\"preview-table\"><thead><tr><th>프리셋</th><th>예상 통과</th><th>비율</th></tr></thead><tbody>";
    for (let i = 0; i < 5; i++) {
      const c = counts[i];
      const pct = total ? ((c / total) * 100).toFixed(1) : "0.0";
      html +=
        "<tr><td>" +
        escapeHtml(presets[i].name || "프리셋 " + (i + 1)) +
        "</td><td>" +
        c.toLocaleString() +
        "</td><td>" +
        pct +
        "%</td></tr>";
    }
    html += "</tbody></table>";
    wrap.innerHTML = html;
  }

  function schedulePresetPreview() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      previewTimer = null;
      refreshPresetPreview();
    }, 400);
  }

  function onFile(file) {
    document.getElementById("fileName").textContent = file.name;
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const sheetName = wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        if (!rows.length) throw new Error("빈 시트입니다.");
        headers = rows[0].map((h) => String(h));
        rawRows = rows.slice(1);
        col = buildColIndex(headers);
        const miss = missingCols(col);
        if (miss.length) {
          document.getElementById("sheetInfo").textContent =
            "경고: 다음 열을 찾지 못했습니다 — " + miss.join(", ") + " (첫 시트: " + sheetName + ")";
        } else {
          document.getElementById("sheetInfo").textContent =
            "시트: " + sheetName + " / " + rawRows.length.toLocaleString() + "행, " + headers.length + "열";
        }
        document.getElementById("resultsSection").hidden = true;
        const sk0 = document.getElementById("sampleKeywords");
        if (sk0) sk0.innerHTML = "";
        refreshPresetPreview();
      } catch (err) {
        document.getElementById("sheetInfo").textContent = "읽기 실패: " + err.message;
        rawRows = [];
        headers = [];
        col = {};
        refreshPresetPreview();
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function applyFilter() {
    syncPresetFromUi();
    renderTabs();

    if (!rawRows.length || !headers.length) {
      alert("먼저 엑셀 파일을 업로드하세요.");
      return;
    }
    const miss = missingCols(col);
    if (miss.length) {
      alert("필수 열이 없어 필터를 적용할 수 없습니다: " + miss.join(", "));
      return;
    }

    const p = presets[activePreset];
    filteredRows = rawRows.filter((row) => rowPasses(row, p));

    const sec = document.getElementById("resultsSection");
    sec.hidden = false;
    document.getElementById("resultStats").textContent =
      "조건에 맞는 행: " +
      filteredRows.length.toLocaleString() +
      " / 전체 " +
      rawRows.length.toLocaleString() +
      " (프리셋: " +
      p.name +
      ")";
    const sk = document.getElementById("sampleKeywords");
    if (sk) {
      const ki = col["키워드"];
      if (ki !== undefined && filteredRows.length) {
        const parts = filteredRows
          .slice(0, 5)
          .map((r) => String(r[ki] ?? "").trim())
          .filter(Boolean);
        sk.innerHTML =
          parts.length > 0
            ? "<strong>샘플 키워드</strong> (최대 5개): " + parts.map(escapeHtml).join(", ")
            : "";
      } else {
        sk.innerHTML = "";
      }
    }
    refreshPresetPreview();
  }

  function columnIndicesFor(kind) {
    const common = [];
    const naver = [];
    const coupang = [];
    headers.forEach((h, i) => {
      const n = normHeader(h);
      if (n.startsWith("네이버")) naver.push(i);
      else if (n.startsWith("쿠팡")) coupang.push(i);
      else common.push(i);
    });
    if (kind === "all") return headers.map((_, i) => i);
    if (kind === "naver") return [...common, ...naver];
    return [...common, ...coupang];
  }

  function sliceRows(indices) {
    return filteredRows.map((row) => indices.map((i) => row[i]));
  }

  function headerSlice(indices) {
    return indices.map((i) => headers[i]);
  }

  function downloadExcel() {
    if (!filteredRows.length) {
      alert("먼저 '필터 적용'으로 결과를 만드세요.");
      return;
    }
    const p = presets[activePreset];
    const safe = (p.name || "export").replace(/[\\/:*?"<>|]/g, "_");

    const idxAll = columnIndicesFor("all");
    const idxNv = columnIndicesFor("naver");
    const idxCp = columnIndicesFor("coupang");

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([headerSlice(idxAll), ...sliceRows(idxAll)]),
      "필터전체"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([headerSlice(idxNv), ...sliceRows(idxNv)]),
      "네이버"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([headerSlice(idxCp), ...sliceRows(idxCp)]),
      "쿠팡"
    );

    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safe + "_필터결과.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPresetsJson() {
    syncPresetFromUi();
    const payload = {
      format: PRESET_EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      presets: presets.map((p) => ({ ...p, peakMonths: [...(p.peakMonths || [])] })),
    };
    const text = JSON.stringify(payload, null, 2);
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sellar-filter-presets.json";
    a.click();
    URL.revokeObjectURL(url);
    renderTabs();
    refreshPresetPreview();
  }

  function importPresetsFromText(text) {
    const data = JSON.parse(text);
    let list = null;
    if (data && data.format === PRESET_EXPORT_FORMAT && Array.isArray(data.presets)) {
      list = data.presets;
    } else if (Array.isArray(data) && data.length === 5) {
      list = data;
    } else if (data && Array.isArray(data.presets) && data.presets.length === 5) {
      list = data.presets;
    }
    if (!list) {
      throw new Error("형식이 맞지 않습니다. 보내기로 만든 .json 또는 presets 배열(길이 5)이어야 합니다.");
    }
    presets = list.map((p, i) => normalizeImportedPreset(p, i));
    activePreset = Math.min(activePreset, 4);
    presetToUi(presets[activePreset]);
    renderTabs();
    refreshPresetPreview();
  }

  document.getElementById("fileInput").addEventListener("change", function (ev) {
    const f = ev.target.files && ev.target.files[0];
    if (f) onFile(f);
  });

  const dropZone = document.getElementById("dropZone");
  ["dragenter", "dragover"].forEach((ev) => {
    dropZone.addEventListener(ev, function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    dropZone.addEventListener(ev, function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove("dragover");
    });
  });
  dropZone.addEventListener("drop", function (e) {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && /\.xlsx?$/i.test(f.name)) onFile(f);
  });

  document.getElementById("btnApply").addEventListener("click", applyFilter);
  document.getElementById("btnDownload").addEventListener("click", downloadExcel);
  document.getElementById("btnExportPresets").addEventListener("click", exportPresetsJson);

  const filterPanel = document.getElementById("filterPanel");
  if (filterPanel) {
    filterPanel.addEventListener("input", schedulePresetPreview);
    filterPanel.addEventListener("change", schedulePresetPreview);
  }

  document.getElementById("presetImportInput").addEventListener("change", function (ev) {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        importPresetsFromText(String(reader.result));
      } catch (err) {
        alert("프리셋 가져오기 실패: " + err.message);
      }
      ev.target.value = "";
    };
    reader.readAsText(f, "utf-8");
  });

  buildMonthChecks();
  presetToUi(presets[activePreset]);
  renderTabs();
})();
