(() => {
  const PAGE_SIZE = 40;
  const STORAGE_VISIBLE = "device_db.visibleColumns";
  const STORAGE_ORDER = "device_db.columnOrder";

  const state = {
    columns: [],
    visibleKeys: [],
    columnOrder: [],
    items: [],
    total: 0,
    offset: 0,
    hasMore: false,
    loading: false,
    query: "",
    filters: {},
    sort: "updated_at",
    order: "desc",
    selectedId: null,
    editing: null,
    mode: "edit",
  };

  const els = {
    searchInput: document.getElementById("searchInput"),
    newPartBtn: document.getElementById("newPartBtn"),
    columnSettingsBtn: document.getElementById("columnSettingsBtn"),
    statusMessage: document.getElementById("statusMessage"),
    tableWrap: document.getElementById("tableWrap"),
    headerRow: document.getElementById("headerRow"),
    filterRow: document.getElementById("filterRow"),
    partsBody: document.getElementById("partsBody"),
    emptyState: document.getElementById("emptyState"),
    loadingMore: document.getElementById("loadingMore"),
    sideSheet: document.getElementById("sideSheet"),
    sheetBackdrop: document.getElementById("sheetBackdrop"),
    sheetTitle: document.getElementById("sheetTitle"),
    sheetBody: document.getElementById("sheetBody"),
    closeSheetBtn: document.getElementById("closeSheetBtn"),
    cancelSheetBtn: document.getElementById("cancelSheetBtn"),
    savePartBtn: document.getElementById("savePartBtn"),
    deletePartBtn: document.getElementById("deletePartBtn"),
    columnDialog: document.getElementById("columnDialog"),
    columnChecks: document.getElementById("columnChecks"),
    columnForm: document.getElementById("columnForm"),
  };

  function showStatus(message) {
    if (!message) {
      els.statusMessage.hidden = true;
      els.statusMessage.textContent = "";
      return;
    }
    els.statusMessage.hidden = false;
    els.statusMessage.textContent = message;
  }

  async function api(path, options = {}) {
    const res = await fetch(path, options);
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text || "応答の解析に失敗しました" };
    }
    if (!res.ok) {
      throw new Error((data && data.error) || `リクエスト失敗 (${res.status})`);
    }
    return data;
  }

  function defaultVisibleKeys(columns) {
    return columns
      .filter((c) => ["manufacturer", "part_number", "category", "design_examples"].includes(c.key))
      .map((c) => c.key);
  }

  function loadVisibleKeys(columns) {
    try {
      const raw = localStorage.getItem(STORAGE_VISIBLE);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter((key) => columns.some((c) => c.key === key));
        }
      }
    } catch {
      /* ignore */
    }
    return defaultVisibleKeys(columns);
  }

  function loadColumnOrder(columns) {
    const catalogKeys = columns.map((c) => c.key);
    try {
      const raw = localStorage.getItem(STORAGE_ORDER);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const known = parsed.filter((key) => catalogKeys.includes(key));
          const missing = catalogKeys.filter((key) => !known.includes(key));
          return known.concat(missing);
        }
      }
    } catch {
      /* ignore */
    }
    // 旧データ移行: 表示中カラムの順を先頭にする
    try {
      const raw = localStorage.getItem(STORAGE_VISIBLE);
      if (raw) {
        const visible = JSON.parse(raw);
        if (Array.isArray(visible)) {
          const known = visible.filter((key) => catalogKeys.includes(key));
          const missing = catalogKeys.filter((key) => !known.includes(key));
          return known.concat(missing);
        }
      }
    } catch {
      /* ignore */
    }
    return catalogKeys;
  }

  function saveColumnPrefs(visibleKeys, columnOrder) {
    state.visibleKeys = visibleKeys;
    state.columnOrder = columnOrder;
    localStorage.setItem(STORAGE_VISIBLE, JSON.stringify(visibleKeys));
    localStorage.setItem(STORAGE_ORDER, JSON.stringify(columnOrder));
  }

  function buildQueryParams({ append = false } = {}) {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(append ? state.offset : 0));
    params.set("sort", state.sort);
    params.set("order", state.order);
    if (state.query) params.set("q", state.query);
    Object.entries(state.filters).forEach(([key, value]) => {
      if (value) params.set(`filter_${key}`, value);
    });
    return params;
  }

  async function fetchParts({ append = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    els.loadingMore.hidden = !append;
    showStatus("");
    try {
      const data = await api(`/api/parts?${buildQueryParams({ append })}`);
      const newItems = data.items || [];
      state.items = append ? state.items.concat(newItems) : newItems;
      state.total = data.total;
      state.offset = data.offset + newItems.length;
      state.hasMore = data.has_more;
      if (append) {
        appendRows(newItems);
      } else {
        renderTable();
      }
    } catch (err) {
      showStatus(err.message);
    } finally {
      state.loading = false;
      els.loadingMore.hidden = true;
    }
  }

  function visibleColumns() {
    const byKey = Object.fromEntries(state.columns.map((c) => [c.key, c]));
    return state.columnOrder
      .filter((key) => state.visibleKeys.includes(key))
      .map((key) => byKey[key])
      .filter(Boolean);
  }

  // 一覧の固定カラム（常時表示・サイドシートでは編集不可）
  const FIXED_COLUMNS = [
    { key: "name", label: "名称", type: "text", fixed: true, stickyClass: "col-fixed col-fixed-name" },
    {
      key: "updated_at",
      label: "更新日",
      type: "text",
      fixed: true,
      stickyClass: "col-fixed col-fixed-updated",
      readonly: true,
    },
  ];

  function displayColumns() {
    return [...FIXED_COLUMNS, ...visibleColumns()];
  }

  function stickyClass(column) {
    return column.stickyClass || "";
  }

  function formatUpdatedAt(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
      d.getMinutes()
    )}`;
  }

  function sortMark(key) {
    if (state.sort !== key) return "";
    return state.order === "asc" ? "▲" : "▼";
  }

  function syncHeaderStickyOffset() {
    const height = els.headerRow.getBoundingClientRect().height;
    if (height > 0) {
      els.tableWrap.style.setProperty("--header-row-height", `${Math.ceil(height)}px`);
    }
  }

  function renderHeaders() {
    const cols = displayColumns();
    els.headerRow.innerHTML = cols
      .map(
        (c) =>
          `<th class="${stickyClass(c)}" data-sort="${c.key}">${escapeHtml(c.label)}<span class="sort-mark">${sortMark(
            c.key
          )}</span></th>`
      )
      .join("");

    els.filterRow.innerHTML = cols
      .map((c) => {
        const value = state.filters[c.key] || "";
        return `<th class="${stickyClass(c)}">
          <input class="filter-input" data-filter-key="${c.key}" value="${escapeAttr(value)}" placeholder="Enterで絞り込み" />
        </th>`;
      })
      .join("");

    requestAnimationFrame(syncHeaderStickyOffset);
  }

  function cellDisplay(part, column) {
    if (column.key === "name") return escapeHtml(part.name || "");
    if (column.key === "updated_at") {
      return escapeHtml(formatUpdatedAt(part.updated_at));
    }
    const value = part[column.key];
    if (column.type === "file") {
      const count = Array.isArray(value) ? value.length : 0;
      return count ? `<span class="file-count">📎 ${count}</span>` : "";
    }
    if (value === undefined || value === null || value === "") return "";
    return escapeHtml(String(value));
  }

  function rowHtml(part, cols) {
    const active = part.id === state.selectedId ? "active" : "";
    const tds = cols
      .map((c) => `<td class="${stickyClass(c)}">${cellDisplay(part, c)}</td>`)
      .join("");
    return `<tr data-id="${part.id}" class="${active}">${tds}</tr>`;
  }

  function appendRows(parts) {
    if (!parts.length) return;
    els.emptyState.hidden = true;
    const cols = displayColumns();
    els.partsBody.insertAdjacentHTML("beforeend", parts.map((p) => rowHtml(p, cols)).join(""));
  }

  function renderTable() {
    renderHeaders();
    const cols = displayColumns();
    if (!state.items.length) {
      els.partsBody.innerHTML = "";
      els.emptyState.hidden = false;
      return;
    }
    els.emptyState.hidden = true;
    els.partsBody.innerHTML = state.items.map((part) => rowHtml(part, cols)).join("");
  }

  function openSheet() {
    els.sideSheet.classList.add("open");
    els.sideSheet.setAttribute("aria-hidden", "false");
    els.sheetBackdrop.hidden = false;
  }

  function closeSheet() {
    els.sideSheet.classList.remove("open");
    els.sideSheet.setAttribute("aria-hidden", "true");
    els.sheetBackdrop.hidden = true;
    state.editing = null;
    setActiveRow(null);
  }

  function getAssignedKeys(part) {
    const catalogKeys = new Set(state.columns.map((c) => c.key));
    if (Array.isArray(part.assigned)) {
      return part.assigned.filter((key) => catalogKeys.has(key));
    }
    return state.columns.filter((c) => part[c.key] !== undefined).map((c) => c.key);
  }

  function assignedColumns(part) {
    const byKey = Object.fromEntries(state.columns.map((c) => [c.key, c]));
    return getAssignedKeys(part).map((key) => byKey[key]).filter(Boolean);
  }

  function renderField(part, col) {
    if (col.type === "file") {
      const files = part[col.key] || [];
      const list = files
        .map(
          (f) => `<div class="file-item">
            <a href="/api/parts/${part.id}/files/${col.key}/${f.id}" target="_blank" rel="noopener">${escapeHtml(
              f.original_name
            )}</a>
            <button type="button" class="btn" data-delete-file="${col.key}:${f.id}">削除</button>
          </div>`
        )
        .join("");
      return `<div class="field" data-file-field="${col.key}">
        <label>${escapeHtml(col.label)}</label>
        <div class="file-list">${list || "<span class=\"file-count\">ファイルなし</span>"}</div>
        <input type="file" accept=".pdf,.png,application/pdf,image/png" data-upload-key="${col.key}" ${
          state.mode === "create" ? "disabled" : ""
        } />
        ${
          state.mode === "create"
            ? "<p class=\"hint\">保存後にファイルを添付できます。</p>"
            : "<p class=\"hint\">PDF / PNG、1ファイル 10MB まで</p>"
        }
      </div>`;
    }

    const value = part[col.key] ?? "";
    if (col.type === "textarea") {
      return `<div class="field">
      <label for="field-${col.key}">${escapeHtml(col.label)}</label>
      <textarea id="field-${col.key}" name="${col.key}" rows="5">${escapeHtml(String(value))}</textarea>
    </div>`;
    }
    const inputType = col.type === "number" ? "number" : "text";
    return `<div class="field">
      <label for="field-${col.key}">${escapeHtml(col.label)}</label>
      <input id="field-${col.key}" name="${col.key}" type="${inputType}" value="${escapeAttr(
      value
    )}" step="any" />
    </div>`;
  }

  function unassignedColumns(part) {
    const assigned = new Set(getAssignedKeys(part));
    return state.columns.filter((c) => !assigned.has(c.key));
  }

  function renderAssignBox(part) {
    const existingOptions = unassignedColumns(part)
      .map(
        (c) =>
          `<option value="${escapeAttr(c.key)}">${escapeHtml(c.label)} (${c.type})</option>`
      )
      .join("");

    return `<div class="add-column-box">
      <h4>項目を割り当て</h4>
      <div class="field">
        <label>割り当て方法</label>
        <select id="assignMode">
          <option value="existing">既存カラムを追加</option>
          <option value="create">新規カラムを作成して追加</option>
        </select>
      </div>
      <div id="assignExistingFields" class="assign-pane">
        <div class="field">
          <label>既存カラム</label>
          <select id="existingColKey" ${existingOptions ? "" : "disabled"}>
            ${
              existingOptions ||
              '<option value="">割り当て可能なカラムがありません</option>'
            }
          </select>
        </div>
      </div>
      <div id="assignCreateFields" class="assign-pane" hidden>
        <div class="field">
          <label>表示名</label>
          <input id="newColLabel" placeholder="例: フットプリント" />
        </div>
        <div class="field">
          <label>型</label>
          <select id="newColType">
            <option value="text">text</option>
            <option value="textarea">textarea（複数行）</option>
            <option value="number">number</option>
            <option value="file">file</option>
          </select>
        </div>
      </div>
      <button type="button" class="btn" id="assignColumnBtn">追加</button>
    </div>`;
  }

  function renderSheet() {
    const part = state.editing || { name: "", assigned: [] };
    if (!Array.isArray(part.assigned)) {
      part.assigned = getAssignedKeys(part);
    }
    state.editing = part;

    els.sheetTitle.textContent = state.mode === "create" ? "新規部品" : "部品詳細";
    els.deletePartBtn.hidden = state.mode === "create";

    const fields = [
      `<div class="field">
        <label for="field-name">名称（必須）</label>
        <input id="field-name" name="name" value="${escapeAttr(part.name || "")}" required />
      </div>`,
    ];

    if (state.mode === "edit") {
      fields.push(`<div class="readonly-meta">
        <div class="field">
          <label>更新日</label>
          <div class="readonly-value">${escapeHtml(formatUpdatedAt(part.updated_at))}</div>
        </div>
      </div>`);
    }

    const assigned = assignedColumns(part);
    if (!assigned.length) {
      fields.push(`<p class="hint">割り当て済みの項目はまだありません。下のフォームから追加してください。</p>`);
    } else {
      assigned.forEach((col) => fields.push(renderField(part, col)));
    }

    fields.push(renderAssignBox(part));
    els.sheetBody.innerHTML = fields.join("");
    openSheet();
  }

  function collectFormPayload() {
    const part = state.editing || { assigned: [] };
    const payload = {
      assigned: getAssignedKeys(part),
    };
    const nameInput = els.sheetBody.querySelector("#field-name");
    payload.name = nameInput ? nameInput.value.trim() : "";
    assignedColumns(part).forEach((col) => {
      if (col.type === "file") return;
      const input = els.sheetBody.querySelector(`[name="${col.key}"]`);
      if (!input) return;
      const value = input.value;
      payload[col.key] = value === "" ? null : value;
    });
    return payload;
  }

  function syncEditingFromForm() {
    if (!state.editing) return;
    const payload = collectFormPayload();
    state.editing = {
      ...state.editing,
      ...payload,
      assigned: payload.assigned,
    };
  }

  async function persistAssignedIfSaved() {
    if (state.mode !== "edit" || !state.selectedId) return;
    const payload = collectFormPayload();
    const updated = await api(`/api/parts/${state.selectedId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.editing = updated;
    await fetchParts();
  }

  function makeColumnKey(label) {
    let base = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!/^[a-z]/.test(base)) {
      base = `col_${Date.now().toString(36)}`;
    }
    const existing = new Set(state.columns.map((c) => c.key));
    if (!existing.has(base)) return base;
    let n = 2;
    while (existing.has(`${base}_${n}`)) n += 1;
    return `${base}_${n}`;
  }

  async function assignColumn() {
    syncEditingFromForm();
    const mode = document.getElementById("assignMode")?.value || "existing";
    try {
      let key = "";
      if (mode === "create") {
        const label = document.getElementById("newColLabel").value.trim();
        const type = document.getElementById("newColType").value;
        if (!label) {
          showStatus("表示名を入力してください");
          return;
        }
        key = makeColumnKey(label);
        const column = await api("/api/columns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, label, type }),
        });
        state.columns = await api("/api/columns").then((d) => d.columns);
        if (!state.columnOrder.includes(column.key)) {
          state.columnOrder = state.columnOrder.concat(column.key);
        }
        if (!state.visibleKeys.includes(column.key) && column.type !== "file") {
          state.visibleKeys = state.visibleKeys.concat(column.key);
        }
        saveColumnPrefs(state.visibleKeys, state.columnOrder);
        key = column.key;
      } else {
        key = document.getElementById("existingColKey")?.value || "";
        if (!key) {
          showStatus("追加する既存カラムを選んでください");
          return;
        }
      }

      const assigned = getAssignedKeys(state.editing);
      if (assigned.includes(key)) {
        showStatus("すでに割り当て済みです");
        return;
      }
      state.editing.assigned = assigned.concat(key);
      await persistAssignedIfSaved();
      showStatus("");
      renderSheet();
      if (mode === "create") renderTable();
    } catch (err) {
      showStatus(err.message);
    }
  }

  function setActiveRow(id) {
    state.selectedId = id;
    els.partsBody.querySelectorAll("tr.active").forEach((tr) => tr.classList.remove("active"));
    if (!id) return;
    const row = els.partsBody.querySelector(`tr[data-id="${id}"]`);
    if (row) row.classList.add("active");
  }

  async function openPart(id) {
    try {
      const part = await api(`/api/parts/${id}`);
      state.mode = "edit";
      state.editing = part;
      setActiveRow(id);
      renderSheet();
    } catch (err) {
      showStatus(err.message);
    }
  }

  function openNew() {
    state.mode = "create";
    state.editing = { name: "", assigned: [] };
    setActiveRow(null);
    renderSheet();
  }

  async function savePart() {
    const payload = collectFormPayload();
    if (!payload.name) {
      showStatus("名称は必須です");
      return;
    }
    try {
      if (state.mode === "create") {
        const created = await api("/api/parts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        state.mode = "edit";
        state.selectedId = created.id;
        state.editing = created;
        await fetchParts();
        renderSheet();
      } else {
        const updated = await api(`/api/parts/${state.selectedId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        state.editing = updated;
        await fetchParts();
        renderSheet();
      }
      showStatus("");
    } catch (err) {
      showStatus(err.message);
    }
  }

  async function deletePart() {
    if (state.mode === "create" || !state.selectedId) return;
    if (!confirm("この部品を削除しますか？添付ファイルも削除されます。")) return;
    try {
      await api(`/api/parts/${state.selectedId}`, { method: "DELETE" });
      closeSheet();
      await fetchParts();
    } catch (err) {
      showStatus(err.message);
    }
  }

  async function uploadFile(columnKey, file) {
    if (!state.selectedId || !file) return;
    const body = new FormData();
    body.append("file", file);
    try {
      await api(`/api/parts/${state.selectedId}/files/${columnKey}`, {
        method: "POST",
        body,
      });
      await openPart(state.selectedId);
      await fetchParts();
    } catch (err) {
      showStatus(err.message);
    }
  }

  async function deleteFile(columnKey, fileId) {
    if (!state.selectedId) return;
    if (!confirm("このファイルを削除しますか？")) return;
    try {
      await api(`/api/parts/${state.selectedId}/files/${columnKey}/${fileId}`, {
        method: "DELETE",
      });
      await openPart(state.selectedId);
      await fetchParts();
    } catch (err) {
      showStatus(err.message);
    }
  }

  function orderedColumnsForSettings() {
    const byKey = Object.fromEntries(state.columns.map((c) => [c.key, c]));
    return state.columnOrder.map((key) => byKey[key]).filter(Boolean);
  }

  let columnSortable = null;

  function renderColumnSettingsList() {
    const cols = orderedColumnsForSettings();
    els.columnChecks.innerHTML = cols
      .map((c) => {
        const checked = state.visibleKeys.includes(c.key) ? "checked" : "";
        return `<div class="column-row" data-key="${escapeAttr(c.key)}">
          <span class="column-handle" aria-hidden="true" title="ドラッグして並べ替え">⠿</span>
          <label>
            <input type="checkbox" value="${escapeAttr(c.key)}" ${checked} />
            <span>${escapeHtml(c.label)} <span class="file-count">(${c.type})</span></span>
          </label>
        </div>`;
      })
      .join("");
  }

  function initColumnSortable() {
    if (columnSortable) {
      columnSortable.destroy();
      columnSortable = null;
    }
    if (typeof Sortable === "undefined") {
      showStatus("並べ替えライブラリの読み込みに失敗しました");
      return;
    }
    columnSortable = Sortable.create(els.columnChecks, {
      handle: ".column-handle",
      ghostClass: "is-ghost",
      animation: 150,
      draggable: ".column-row",
    });
  }

  function openColumnSettings() {
    renderColumnSettingsList();
    els.columnDialog.showModal();
    initColumnSortable();
  }

  function closeColumnSettings() {
    if (columnSortable) {
      columnSortable.destroy();
      columnSortable = null;
    }
    if (els.columnDialog.open) {
      els.columnDialog.close();
    }
  }

  function applyFiltersFromInputs() {
    const next = {};
    els.filterRow.querySelectorAll("[data-filter-key]").forEach((input) => {
      const value = input.value.trim();
      if (value) next[input.dataset.filterKey] = value;
    });
    state.filters = next;
    fetchParts();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replaceAll("'", "&#39;");
  }

  function bindEvents() {
    window.addEventListener("resize", () => requestAnimationFrame(syncHeaderStickyOffset));

    els.searchInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      state.query = els.searchInput.value.trim();
      fetchParts();
    });

    els.newPartBtn.addEventListener("click", openNew);
    els.columnSettingsBtn.addEventListener("click", openColumnSettings);

    els.columnDialog.addEventListener("click", (e) => {
      if (e.target === els.columnDialog) {
        closeColumnSettings();
      }
    });
    els.closeSheetBtn.addEventListener("click", closeSheet);
    els.cancelSheetBtn.addEventListener("click", closeSheet);
    els.sheetBackdrop.addEventListener("click", closeSheet);
    els.savePartBtn.addEventListener("click", savePart);
    els.deletePartBtn.addEventListener("click", deletePart);

    els.headerRow.addEventListener("click", (e) => {
      const th = e.target.closest("th[data-sort]");
      if (!th) return;
      const key = th.dataset.sort;
      if (state.sort === key) {
        state.order = state.order === "asc" ? "desc" : "asc";
      } else {
        state.sort = key;
        state.order = "asc";
      }
      fetchParts();
    });

    els.filterRow.addEventListener("keydown", (e) => {
      const input = e.target.closest("[data-filter-key]");
      if (!input) return;
      if (e.key !== "Enter") return;
      e.preventDefault();
      applyFiltersFromInputs();
    });

    els.partsBody.addEventListener("click", (e) => {
      const row = e.target.closest("tr[data-id]");
      if (!row) return;
      openPart(row.dataset.id);
    });

    els.tableWrap.addEventListener("scroll", () => {
      if (!state.hasMore || state.loading) return;
      const nearBottom =
        els.tableWrap.scrollTop + els.tableWrap.clientHeight >= els.tableWrap.scrollHeight - 80;
      if (nearBottom) fetchParts({ append: true });
    });

    els.sheetBody.addEventListener("change", (e) => {
      if (e.target && e.target.id === "assignMode") {
        const create = e.target.value === "create";
        const existingPane = document.getElementById("assignExistingFields");
        const createPane = document.getElementById("assignCreateFields");
        if (existingPane) existingPane.hidden = create;
        if (createPane) createPane.hidden = !create;
        return;
      }
      const upload = e.target.closest("[data-upload-key]");
      if (upload && upload.files && upload.files[0]) {
        uploadFile(upload.dataset.uploadKey, upload.files[0]);
        upload.value = "";
      }
    });

    els.sheetBody.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-delete-file]");
      if (btn) {
        const [columnKey, fileId] = btn.dataset.deleteFile.split(":");
        deleteFile(columnKey, fileId);
        return;
      }
      if (e.target.id === "assignColumnBtn") assignColumn();
    });

    els.columnForm.addEventListener("submit", (e) => {
      const submitter = e.submitter;
      if (submitter && submitter.value === "ok") {
        const order = [...els.columnChecks.querySelectorAll(".column-row")].map((el) => el.dataset.key);
        const visible = [...els.columnChecks.querySelectorAll("input[type=checkbox]:checked")].map(
          (el) => el.value
        );
        const visibleOrdered = order.filter((key) => visible.includes(key));
        saveColumnPrefs(visibleOrdered, order);
        renderTable();
      }
      if (columnSortable) {
        columnSortable.destroy();
        columnSortable = null;
      }
    });
  }

  async function init() {
    bindEvents();
    try {
      const data = await api("/api/columns");
      state.columns = data.columns;
      state.columnOrder = loadColumnOrder(state.columns);
      state.visibleKeys = loadVisibleKeys(state.columns).filter((key) =>
        state.columnOrder.includes(key)
      );
      // visibleKeys も order に合わせて並べる
      state.visibleKeys = state.columnOrder.filter((key) => state.visibleKeys.includes(key));
      await fetchParts();
    } catch (err) {
      showStatus(err.message);
    }
  }

  init();
})();
