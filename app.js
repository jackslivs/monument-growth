(() => {
  "use strict";

  const STORAGE = { clients: "mg_clients", tasks: "mg_tasks" };

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const todayStr = () => new Date().toISOString().slice(0, 10);

  const fmtMoney = (n) => "$" + (Number(n) || 0).toLocaleString();

  const fmtDate = (isoDate) => {
    if (!isoDate) return "";
    const [y, m, d] = isoDate.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  const daysUntil = (isoDate) => {
    if (!isoDate) return Infinity;
    const [y, m, d] = isoDate.split("-").map(Number);
    const target = new Date(y, m - 1, d);
    const now = new Date();
    const nowMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((target - nowMid) / 86400000);
  };

  // ---------- Data layer ----------
  function loadClients() {
    try { return JSON.parse(localStorage.getItem(STORAGE.clients)) || []; }
    catch { return []; }
  }
  function saveClients(list) { localStorage.setItem(STORAGE.clients, JSON.stringify(list)); }

  function loadTasks() {
    try { return JSON.parse(localStorage.getItem(STORAGE.tasks)) || []; }
    catch { return []; }
  }
  function saveTasks(list) { localStorage.setItem(STORAGE.tasks, JSON.stringify(list)); }

  let clients = loadClients();
  let tasks = loadTasks();
  let editingTags = [];
  let currentClientId = null;

  // ---------- Tab navigation ----------
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(tab.dataset.view + "-view").classList.add("active");
      if (tab.dataset.view === "dashboard") renderDashboard();
      if (tab.dataset.view === "clients") renderClients();
      if (tab.dataset.view === "tasks") renderTasks();
    });
  });

  // ---------- Dashboard ----------
  function renderDashboard() {
    const active = clients.filter(c => c.status === "active");
    const mrr = active.reduce((sum, c) => sum + (Number(c.monthlyAmount) || 0), 0);
    const overdue = clients.filter(c => c.status !== "churned" && c.nextFollowUp && daysUntil(c.nextFollowUp) < 0);
    const openTasks = tasks.filter(t => !t.completed);

    document.getElementById("statActiveClients").textContent = active.length;
    document.getElementById("statMRR").textContent = fmtMoney(mrr);
    document.getElementById("statOverdue").textContent = overdue.length;
    document.getElementById("statTasks").textContent = openTasks.length;

    const list = clients
      .filter(c => c.status !== "churned" && c.nextFollowUp)
      .sort((a, b) => daysUntil(a.nextFollowUp) - daysUntil(b.nextFollowUp))
      .slice(0, 8);

    const container = document.getElementById("followupList");
    container.innerHTML = "";

    if (!list.length) {
      container.innerHTML = `<div class="empty-state">No upcoming follow-ups scheduled. Add a follow-up date to a client to see them here.</div>`;
      return;
    }

    list.forEach(c => {
      const d = daysUntil(c.nextFollowUp);
      const cls = d < 0 ? "overdue" : d <= 3 ? "soon" : "";
      const label = d < 0 ? `${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"} overdue`
        : d === 0 ? "Today"
        : d === 1 ? "Tomorrow"
        : `In ${d} days`;

      const row = document.createElement("div");
      row.className = "followup-row " + cls;
      row.innerHTML = `
        <div class="followup-main">
          <span class="followup-name">${escapeHtml(c.name)}</span>
          <span class="followup-date">${label} · ${fmtDate(c.nextFollowUp)}</span>
        </div>
        <div class="followup-actions">
          <button class="btn btn-ghost" data-snooze="7">+7d</button>
          <button class="btn btn-ghost" data-snooze="30">+30d</button>
          <button class="btn btn-primary" data-open>Open</button>
        </div>
      `;
      row.querySelector("[data-open]").addEventListener("click", () => openClientModal(c.id));
      row.querySelectorAll("[data-snooze]").forEach(btn => {
        btn.addEventListener("click", () => {
          const days = Number(btn.dataset.snooze);
          const base = new Date();
          base.setDate(base.getDate() + days);
          c.nextFollowUp = base.toISOString().slice(0, 10);
          saveClients(clients);
          renderDashboard();
        });
      });
      container.appendChild(row);
    });
  }

  // ---------- Clients ----------
  function renderClients() {
    const search = document.getElementById("clientSearch").value.trim().toLowerCase();
    const statusFilter = document.getElementById("statusFilter").value;

    const filtered = clients.filter(c => {
      if (statusFilter && c.status !== statusFilter) return false;
      if (!search) return true;
      const hay = [c.name, c.plan, c.contactPerson, ...(c.tags || [])].join(" ").toLowerCase();
      return hay.includes(search);
    });

    filtered.sort((a, b) => a.name.localeCompare(b.name));

    const container = document.getElementById("clientList");
    container.innerHTML = "";

    if (!filtered.length) {
      container.innerHTML = `<div class="empty-state">No clients yet. Click "+ Add Client" to get started.</div>`;
      return;
    }

    filtered.forEach(c => {
      const d = c.nextFollowUp ? daysUntil(c.nextFollowUp) : null;
      const fCls = d === null ? "" : d < 0 ? "overdue" : d <= 3 ? "soon" : "";
      const fLabel = d === null ? "No follow-up set" : `Follow up ${fmtDate(c.nextFollowUp)}`;

      const card = document.createElement("div");
      card.className = "client-card";
      card.innerHTML = `
        <div class="client-main">
          <div class="client-name-row">
            <span class="status-dot status-${c.status}"></span>
            <span class="client-name">${escapeHtml(c.name)}</span>
          </div>
          ${c.plan ? `<div class="client-plan">${escapeHtml(c.plan)}</div>` : ""}
          <div class="client-tags">${(c.tags || []).map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("")}</div>
        </div>
        <div class="client-side">
          <div class="client-amount">${fmtMoney(c.monthlyAmount)}/mo</div>
          <div class="client-followup ${fCls}">${fLabel}</div>
        </div>
      `;
      card.addEventListener("click", () => openClientModal(c.id));
      container.appendChild(card);
    });
  }

  document.getElementById("clientSearch").addEventListener("input", renderClients);
  document.getElementById("statusFilter").addEventListener("change", renderClients);

  // ---------- Client modal ----------
  const modal = document.getElementById("clientModal");
  const clientForm = document.getElementById("clientForm");

  function openClientModal(id) {
    currentClientId = id || null;
    const c = id ? clients.find(x => x.id === id) : null;

    document.getElementById("modalTitle").textContent = c ? "Edit Client" : "Add Client";
    document.getElementById("clientId").value = c ? c.id : "";
    document.getElementById("clientName").value = c ? c.name : "";
    document.getElementById("clientContact").value = c ? c.contactPerson || "" : "";
    document.getElementById("clientStatus").value = c ? c.status : "active";
    document.getElementById("clientEmail").value = c ? c.email || "" : "";
    document.getElementById("clientPhone").value = c ? c.phone || "" : "";
    document.getElementById("clientAmount").value = c ? c.monthlyAmount || "" : "";
    document.getElementById("clientFollowUp").value = c ? c.nextFollowUp || "" : "";
    document.getElementById("clientPlan").value = c ? c.plan || "" : "";
    document.getElementById("deleteClientBtn").style.display = c ? "inline-block" : "none";

    editingTags = c ? [...(c.tags || [])] : [];
    renderTagChips();

    renderNotesLog(c ? c.notes || [] : []);
    document.getElementById("noteInput").value = "";

    modal.classList.remove("hidden");
  }

  function closeClientModal() {
    modal.classList.add("hidden");
    currentClientId = null;
  }

  document.getElementById("addClientBtn").addEventListener("click", () => openClientModal(null));
  document.getElementById("closeModalBtn").addEventListener("click", closeClientModal);
  document.getElementById("cancelModalBtn").addEventListener("click", closeClientModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeClientModal(); });

  function renderTagChips() {
    const box = document.getElementById("tagChips");
    box.innerHTML = "";
    editingTags.forEach((tag, i) => {
      const chip = document.createElement("span");
      chip.className = "tag-chip removable";
      chip.innerHTML = `${escapeHtml(tag)} <span data-i="${i}">&times;</span>`;
      chip.querySelector("span[data-i]").addEventListener("click", () => {
        editingTags.splice(i, 1);
        renderTagChips();
      });
      box.appendChild(chip);
    });
  }

  document.getElementById("tagInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const val = e.target.value.trim();
      if (val && !editingTags.includes(val)) {
        editingTags.push(val);
        renderTagChips();
      }
      e.target.value = "";
    }
  });

  function renderNotesLog(notes) {
    const box = document.getElementById("notesLog");
    box.innerHTML = "";
    if (!notes.length) {
      box.innerHTML = `<div class="empty-state" style="padding:8px;">No notes yet.</div>`;
      return;
    }
    [...notes].reverse().forEach(n => {
      const item = document.createElement("div");
      item.className = "note-item";
      item.innerHTML = `<div class="note-date">${fmtDate(n.date)}</div><div>${escapeHtml(n.text)}</div>`;
      box.appendChild(item);
    });
  }

  document.getElementById("addNoteBtn").addEventListener("click", () => {
    const input = document.getElementById("noteInput");
    const text = input.value.trim();
    if (!text) return;

    if (!currentClientId) {
      alert("Save the client first, then add notes.");
      return;
    }
    const c = clients.find(x => x.id === currentClientId);
    c.notes = c.notes || [];
    c.notes.push({ id: uid(), date: todayStr(), text });
    saveClients(clients);
    renderNotesLog(c.notes);
    input.value = "";
  });

  clientForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = document.getElementById("clientId").value || uid();
    const existing = clients.find(x => x.id === id);

    const data = {
      id,
      name: document.getElementById("clientName").value.trim(),
      contactPerson: document.getElementById("clientContact").value.trim(),
      status: document.getElementById("clientStatus").value,
      email: document.getElementById("clientEmail").value.trim(),
      phone: document.getElementById("clientPhone").value.trim(),
      monthlyAmount: Number(document.getElementById("clientAmount").value) || 0,
      nextFollowUp: document.getElementById("clientFollowUp").value || null,
      plan: document.getElementById("clientPlan").value.trim(),
      tags: [...editingTags],
      notes: existing ? existing.notes || [] : [],
      createdAt: existing ? existing.createdAt : Date.now(),
    };

    if (existing) {
      Object.assign(existing, data);
    } else {
      clients.push(data);
    }
    saveClients(clients);
    closeClientModal();
    renderClients();
    renderDashboard();
    populateTaskClientSelect();
  });

  document.getElementById("deleteClientBtn").addEventListener("click", () => {
    if (!currentClientId) return;
    if (!confirm("Delete this client? This cannot be undone.")) return;
    clients = clients.filter(c => c.id !== currentClientId);
    saveClients(clients);
    closeClientModal();
    renderClients();
    renderDashboard();
    populateTaskClientSelect();
  });

  // ---------- Tasks ----------
  function populateTaskClientSelect() {
    const sel = document.getElementById("taskClientSelect");
    const current = sel.value;
    sel.innerHTML = `<option value="">No client</option>`;
    clients.filter(c => c.status !== "churned").forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      sel.appendChild(opt);
    });
    sel.value = current;
  }

  function clientName(id) {
    const c = clients.find(x => x.id === id);
    return c ? c.name : "";
  }

  function renderTasks() {
    const open = tasks.filter(t => !t.completed).sort((a, b) => b.createdAt - a.createdAt);
    const done = tasks.filter(t => t.completed).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

    const openBox = document.getElementById("openTasks");
    openBox.innerHTML = "";
    if (!open.length) {
      openBox.innerHTML = `<div class="empty-state">Nothing on your plate. Add a task above.</div>`;
    }
    open.forEach(t => openBox.appendChild(buildTaskRow(t)));

    document.getElementById("completedCount").textContent = `${done.length} completed`;
    const doneBox = document.getElementById("completedTasks");
    doneBox.innerHTML = "";
    done.forEach(t => doneBox.appendChild(buildTaskRow(t)));
  }

  function buildTaskRow(t) {
    const row = document.createElement("div");
    row.className = "task-row" + (t.completed ? " done" : "");
    row.innerHTML = `
      <span class="task-dot"></span>
      <span class="task-text-wrap">
        <span class="task-text">${escapeHtml(t.text)}</span>
        ${t.clientId && clientName(t.clientId) ? `<span class="task-client-tag">${escapeHtml(clientName(t.clientId))}</span>` : ""}
      </span>
      <button class="task-delete" title="Delete task">&times;</button>
    `;
    row.querySelector(".task-dot").addEventListener("click", () => toggleTask(t.id, row));
    row.querySelector(".task-delete").addEventListener("click", () => {
      tasks = tasks.filter(x => x.id !== t.id);
      saveTasks(tasks);
      renderTasks();
      renderDashboard();
    });
    return row;
  }

  function toggleTask(id, row) {
    const t = tasks.find(x => x.id === id);
    t.completed = !t.completed;
    t.completedAt = t.completed ? Date.now() : null;
    saveTasks(tasks);

    row.classList.add("removing");
    setTimeout(() => {
      renderTasks();
      renderDashboard();
    }, 220);
  }

  document.getElementById("taskForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("taskInput");
    const text = input.value.trim();
    if (!text) return;
    const clientId = document.getElementById("taskClientSelect").value || null;

    tasks.push({ id: uid(), text, completed: false, clientId, createdAt: Date.now(), completedAt: null });
    saveTasks(tasks);
    input.value = "";
    renderTasks();
    renderDashboard();
  });

  document.getElementById("completedToggle").addEventListener("click", (e) => {
    const box = document.getElementById("completedTasks");
    box.classList.toggle("collapsed");
    e.currentTarget.classList.toggle("open");
  });

  // ---------- Export / Import ----------
  document.getElementById("exportBtn").addEventListener("click", () => {
    const payload = { clients, tasks, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `monument-growth-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("importInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.clients) || !Array.isArray(data.tasks)) throw new Error("bad format");
        if (!confirm("Import will replace your current data with this backup. Continue?")) return;
        clients = data.clients;
        tasks = data.tasks;
        saveClients(clients);
        saveTasks(tasks);
        renderDashboard();
        renderClients();
        renderTasks();
        populateTaskClientSelect();
        alert("Import complete.");
      } catch {
        alert("Couldn't read that file. Make sure it's a Monument Growth backup JSON file.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  // ---------- Utils ----------
  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[m]));
  }

  // ---------- Init ----------
  populateTaskClientSelect();
  renderDashboard();
  renderClients();
  renderTasks();
})();
