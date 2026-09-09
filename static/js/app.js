(() => {
  const PAGE_SIZE = 40;
  const STORAGE_KEY = "device_db.visibleColumns";

  const state = {
    columns: [],
    visibleKeys: [],
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
      const raw = localStorage.getItem(STORAGE_KEY);
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

  function saveVisibleKeys(keys) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
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
    return state.columns.filter((c) => state.visibleKeys.includes(c.key));
  }

  function displayColumns() {
    return [{ key: "name", label: "部品名称", type: "text" }, ...visibleColumns()];
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
          `<th class="${c.key === "name" ? "col-name" : ""}" data-sort="${c.key}">${escapeHtml(
            c.label
          )}<span class="sort-mark">${sortMark(c.key)}</span></th>`
      )
      .join("");

    els.filterRow.innerHTML = cols
      .map((c) => {
        const value = c.key === "name" ? state.filters.name || "" : state.filters[c.key] || "";
        return `<th class="${c.key === "name" ? "col-name" : ""}">
          <input class="filter-input" data-filter-key="${c.key}" value="${escapeAttr(value)}" placeholder="絞り込み" />
        </th>`;
      })
      .join("");

    requestAnimationFrame(syncHeaderStickyOffset);
  }

  function cellDisplay(part, column) {
    if (column.key === "name") return escapeHtml(part.name || "");
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
      .map(
        (c) =>
          `<td class="${c.key === "name" ? "col-name" : ""}">${cellDisplay(part, c)}</td>`
      )
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

  function renderSheet() {
    const part = state.editing || { name: "" };
    els.sheetTitle.textContent = state.mode === "create" ? "新規部品" : "部品詳細";
    els.deletePartBtn.hidden = state.mode === "create";

    const fields = [
      `<div class="field">
        <label for="field-name">部品名称（必須）</label>
        <input id="field-name" name="name" value="${escapeAttr(part.name || "")}" required />
      </div>`,
    ];

    state.columns.forEach((col) => {
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
        fields.push(`<div class="field" data-file-field="${col.key}">
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
        </div>`);
        return;
      }

      const value = part[col.key] ?? "";
      const inputType = col.type === "number" ? "number" : "text";
      fields.push(`<div class="field">
        <label for="field-${col.key}">${escapeHtml(col.label)}</label>
        <input id="field-${col.key}" name="${col.key}" type="${inputType}" value="${escapeAttr(
        value
      )}" step="any" />
      </div>`);
    });

    fields.push(`<div class="add-column-box">
      <h4>カラムを追加</h4>
      <div class="field">
        <label>表示名</label>
        <input id="newColLabel" placeholder="例: フットプリント" />
      </div>
      <div class="field">
        <label>キー（英小文字など）</label>
        <input id="newColKey" placeholder="例: footprint" />
      </div>
      <div class="field">
        <label>型</label>
        <select id="newColType">
          <option value="text">text</option>
          <option value="number">number</option>
          <option value="file">file</option>
        </select>
      </div>
      <button type="button" class="btn" id="addColumnBtn">カラム追加</button>
    </div>`);

    els.sheetBody.innerHTML = fields.join("");
    openSheet();
  }

  function collectFormPayload() {
    const payload = {};
    const nameInput = els.sheetBody.querySelector("#field-name");
    payload.name = nameInput ? nameInput.value.trim() : "";
    state.columns.forEach((col) => {
      if (col.type === "file") return;
      const input = els.sheetBody.querySelector(`[name="${col.key}"]`);
      if (!input) return;
      const value = input.value;
      payload[col.key] = value === "" ? null : value;
    });
    return payload;
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
    state.editing = { name: "" };
    setActiveRow(null);
    renderSheet();
  }

  async function savePart() {
    const payload = collectFormPayload();
    if (!payload.name) {
      showStatus("部品名称は必須です");
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

  async function addColumn() {
    const label = document.getElementById("newColLabel").value.trim();
    let key = document.getElementById("newColKey").value.trim();
    const type = document.getElementById("newColType").value;
    if (!key && label) {
      key = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
      if (!/^[a-z]/.test(key)) key = `col_${key || Date.now()}`;
    }
    try {
      const column = await api("/api/columns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, label, type }),
      });
      state.columns = await api("/api/columns").then((d) => d.columns);
      if (!state.visibleKeys.includes(column.key) && column.type !== "file") {
        state.visibleKeys.push(column.key);
        saveVisibleKeys(state.visibleKeys);
      }
      renderSheet();
      renderTable();
    } catch (err) {
      showStatus(err.message);
    }
  }

  function openColumnSettings() {
    els.columnChecks.innerHTML = state.columns
      .map((c) => {
        const checked = state.visibleKeys.includes(c.key) ? "checked" : "";
        return `<label><input type="checkbox" value="${escapeAttr(c.key)}" ${checked} /> ${escapeHtml(
          c.label
        )} <span class="file-count">(${c.type})</span></label>`;
      })
      .join("");
    els.columnDialog.showModal();
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  const reloadFromFilters = debounce(() => fetchParts(), 250);

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

    els.searchInput.addEventListener(
      "input",
      debounce((e) => {
        state.query = e.target.value.trim();
        fetchParts();
      }, 250)
    );

    els.newPartBtn.addEventListener("click", openNew);
    els.columnSettingsBtn.addEventListener("click", openColumnSettings);
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

    els.filterRow.addEventListener("input", (e) => {
      const input = e.target.closest("[data-filter-key]");
      if (!input) return;
      const key = input.dataset.filterKey;
      const value = input.value.trim();
      if (value) state.filters[key] = value;
      else delete state.filters[key];
      reloadFromFilters();
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
      if (e.target.id === "addColumnBtn") addColumn();
    });

    els.columnForm.addEventListener("submit", (e) => {
      const submitter = e.submitter;
      if (submitter && submitter.value === "ok") {
        const keys = [...els.columnChecks.querySelectorAll("input:checked")].map((el) => el.value);
        state.visibleKeys = keys;
        saveVisibleKeys(keys);
        renderTable();
      }
    });
  }

  async function init() {
    bindEvents();
    try {
      const data = await api("/api/columns");
      state.columns = data.columns;
      state.visibleKeys = loadVisibleKeys(state.columns);
      await fetchParts();
    } catch (err) {
      showStatus(err.message);
    }
  }

  init();
})();
