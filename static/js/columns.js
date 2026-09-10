(() => {
  const els = {
    statusMessage: document.getElementById("statusMessage"),
    tableWrap: document.getElementById("columnTableWrap"),
    tbody: document.getElementById("columnTableBody"),
    emptyColumns: document.getElementById("emptyColumns"),
    createDialog: document.getElementById("createDialog"),
    createForm: document.getElementById("createForm"),
    createLabel: document.getElementById("createLabel"),
    createType: document.getElementById("createType"),
    createError: document.getElementById("createError"),
    openCreateBtn: document.getElementById("openCreateBtn"),
    openCreateBtnSecondary: document.getElementById("openCreateBtnSecondary"),
  };

  let columns = [];
  let sortable = null;

  function showStatus(message, isError = true) {
    if (!message) {
      els.statusMessage.hidden = true;
      els.statusMessage.textContent = "";
      els.statusMessage.classList.remove("status-ok");
      return;
    }
    els.statusMessage.hidden = false;
    els.statusMessage.textContent = message;
    els.statusMessage.classList.toggle("status-ok", !isError);
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

  function typeLabel(type) {
    if (type === "number") return "数値";
    if (type === "file") return "ファイル";
    if (type === "textarea") return "複数行";
    return "テキスト";
  }

  function makeColumnKey(label) {
    let base = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!/^[a-z]/.test(base)) {
      base = `col_${Date.now().toString(36)}`;
    }
    const existing = new Set(columns.map((c) => c.key));
    if (!existing.has(base)) return base;
    let n = 2;
    while (existing.has(`${base}_${n}`)) n += 1;
    return `${base}_${n}`;
  }

  function renderLabelCell(td, label) {
    td.textContent = "";
    td.className = "cell-editable";
    td.title = "クリックして編集";
    td.textContent = label || "";
  }

  function makeEditable(td, rowIndex) {
    if (td.classList.contains("is-editing")) return;
    const col = columns[rowIndex];
    if (!col) return;

    const savedVal = String(col.label || "");
    td.classList.add("is-editing");
    td.textContent = "";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "inline-input";
    input.value = savedVal;
    td.appendChild(input);
    input.focus();
    input.select();

    let committed = false;

    async function confirmEdit() {
      if (committed) return;
      committed = true;
      const next = input.value.trim();
      td.classList.remove("is-editing");

      if (!next) {
        showStatus("名称は必須です");
        renderLabelCell(td, savedVal);
        return;
      }
      if (next === savedVal) {
        renderLabelCell(td, savedVal);
        return;
      }

      try {
        const updated = await api(`/api/columns/${encodeURIComponent(col.key)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: next }),
        });
        columns[rowIndex] = updated;
        renderLabelCell(td, updated.label);
        showStatus(`「${updated.label}」を保存しました`, false);
      } catch (err) {
        showStatus(err.message);
        renderLabelCell(td, savedVal);
      }
    }

    function cancelEdit() {
      if (committed) return;
      committed = true;
      td.classList.remove("is-editing");
      renderLabelCell(td, savedVal);
    }

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        confirmEdit();
      } else if (e.key === "Escape") {
        cancelEdit();
      }
    });
    input.addEventListener("blur", confirmEdit);
  }

  function renderList() {
    if (sortable) {
      sortable.destroy();
      sortable = null;
    }

    if (!columns.length) {
      els.tbody.innerHTML = "";
      els.emptyColumns.hidden = false;
      return;
    }
    els.emptyColumns.hidden = true;

    els.tbody.textContent = "";
    columns.forEach((col, rowIndex) => {
      const tr = document.createElement("tr");
      tr.dataset.key = col.key;

      const handleTd = document.createElement("td");
      handleTd.className = "col-handle";
      const handle = document.createElement("span");
      handle.className = "column-handle";
      handle.setAttribute("aria-hidden", "true");
      handle.title = "ドラッグして並べ替え";
      handle.textContent = "⠿";
      handleTd.appendChild(handle);

      const labelTd = document.createElement("td");
      labelTd.dataset.rowIdx = String(rowIndex);
      renderLabelCell(labelTd, col.label);

      const typeTd = document.createElement("td");
      typeTd.className = "cell-readonly";
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = typeLabel(col.type);
      typeTd.appendChild(pill);

      const keyTd = document.createElement("td");
      keyTd.className = "cell-readonly";
      keyTd.textContent = col.key;

      const actionTd = document.createElement("td");
      actionTd.className = "col-actions";
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn-danger";
      delBtn.dataset.action = "delete";
      delBtn.textContent = "削除";
      actionTd.appendChild(delBtn);

      tr.append(handleTd, labelTd, typeTd, keyTd, actionTd);
      els.tbody.appendChild(tr);
    });

    initSortable();
  }

  function initSortable() {
    if (typeof Sortable === "undefined" || !columns.length) return;
    sortable = Sortable.create(els.tbody, {
      handle: ".column-handle",
      ghostClass: "is-ghost",
      animation: 150,
      draggable: "tr",
      onEnd: async () => {
        const keys = [...els.tbody.querySelectorAll("tr")].map((el) => el.dataset.key);
        try {
          const data = await api("/api/columns", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ keys }),
          });
          columns = data.columns;
          showStatus("並び順を保存しました", false);
          renderList();
        } catch (err) {
          showStatus(err.message);
          await loadColumns();
        }
      },
    });
  }

  async function loadColumns() {
    const data = await api("/api/columns");
    columns = data.columns || [];
    renderList();
  }

  async function deleteColumn(key, label) {
    if (
      !confirm(
        `カラム「${label}」を削除しますか？\n各部品からの割り当て・値・添付ファイルも削除されます。`
      )
    ) {
      return;
    }
    await api(`/api/columns/${encodeURIComponent(key)}`, { method: "DELETE" });
    columns = columns.filter((c) => c.key !== key);
    showStatus(`「${label}」を削除しました`, false);
    renderList();
  }

  function showCreateError(message) {
    if (!message) {
      els.createError.hidden = true;
      els.createError.textContent = "";
      return;
    }
    els.createError.hidden = false;
    els.createError.textContent = message;
  }

  function openCreateModal() {
    showCreateError("");
    els.createLabel.value = "";
    els.createType.value = "text";
    els.createDialog.showModal();
    requestAnimationFrame(() => els.createLabel.focus());
  }

  function closeCreateModal() {
    showCreateError("");
    if (els.createDialog.open) {
      els.createDialog.close();
    }
  }

  els.openCreateBtn.addEventListener("click", openCreateModal);
  els.openCreateBtnSecondary.addEventListener("click", openCreateModal);

  // 画面外（backdrop）クリックで閉じる
  els.createDialog.addEventListener("click", (e) => {
    if (e.target === els.createDialog) {
      closeCreateModal();
    }
  });

  els.tbody.addEventListener("click", async (e) => {
    const delBtn = e.target.closest('[data-action="delete"]');
    if (delBtn) {
      const tr = delBtn.closest("tr");
      if (!tr) return;
      const key = tr.dataset.key;
      const col = columns.find((c) => c.key === key);
      try {
        await deleteColumn(key, col ? col.label : key);
      } catch (err) {
        showStatus(err.message);
      }
      return;
    }

    const td = e.target.closest("td.cell-editable");
    if (!td || td.classList.contains("is-editing")) return;
    const rowIdx = Number(td.dataset.rowIdx);
    makeEditable(td, rowIdx);
  });

  els.createForm.addEventListener("submit", async (e) => {
    const submitter = e.submitter;
    if (!submitter || submitter.value !== "ok") {
      showCreateError("");
      // method=dialog のキャンセルはブラウザに任せる。念のため明示的に閉じる
      closeCreateModal();
      e.preventDefault();
      return;
    }
    e.preventDefault();
    const label = els.createLabel.value.trim();
    const type = els.createType.value;
    if (!label) {
      showCreateError("名称を入力してください");
      return;
    }
    try {
      const column = await api("/api/columns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: makeColumnKey(label), label, type }),
      });
      columns = columns.concat(column);
      closeCreateModal();
      showStatus(`「${column.label}」を作成しました`, false);
      renderList();
    } catch (err) {
      showCreateError(err.message);
    }
  });

  loadColumns().catch((err) => showStatus(err.message));
})();
