/**
 * Text Expander — Popup Logic
 *
 * Full CRUD for shortcuts:
 *  - List with search/filter
 *  - Add new shortcut (modal)
 *  - Edit existing shortcut (modal)
 *  - Delete with confirmation
 *  - Import / Export as JSON
 */

(function () {
  'use strict';

  // ─── State ─────────────────────────────────────────────────────
  let shortcuts = {};
  let editingCode = null; // null → adding, string → editing

  // ─── DOM References ────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  const shortcutList  = $('shortcutList');
  const shortcutCount = $('shortcutCount');
  const searchInput   = $('searchInput');
  const clearSearch   = $('clearSearch');
  const emptyState    = $('emptyState');
  const addBtn        = $('addBtn');
  const importBtn     = $('importBtn');
  const exportBtn     = $('exportBtn');

  // Modal
  const modalOverlay = $('modalOverlay');
  const modalTitle   = $('modalTitle');
  const modalClose   = $('modalClose');
  const modalCancel  = $('modalCancel');
  const modalSave    = $('modalSave');
  const codeInput    = $('shortcutCode');
  const textInput    = $('shortcutText');
  const formError    = $('formError');

  // Delete
  const deleteOverlay = $('deleteOverlay');
  const deleteCodeEl  = $('deleteCode');
  const deleteCancel  = $('deleteCancel');
  const deleteConfirm = $('deleteConfirm');

  // Toast
  const toastEl      = $('toast');
  const toastIcon    = $('toastIcon');
  const toastMessage = $('toastMessage');

  let deleteTarget = null;
  let toastTimer   = null;

  // ─── Init ──────────────────────────────────────────────────────

  async function init() {
    await loadShortcuts();
    renderList();
    bindEvents();
    searchInput.focus();
  }

  // ─── Storage ───────────────────────────────────────────────────

  function loadShortcuts() {
    return new Promise((resolve) => {
      chrome.storage.local.get('shortcuts', (data) => {
        shortcuts = data.shortcuts || {};
        resolve();
      });
    });
  }

  function saveShortcuts() {
    return new Promise((resolve) => {
      chrome.storage.local.set({ shortcuts }, resolve);
    });
  }

  // ─── Render ────────────────────────────────────────────────────

  function renderList(filter = '') {
    const entries = Object.entries(shortcuts)
      .filter(([code, text]) => {
        if (!filter) return true;
        const q = filter.toLowerCase();
        return code.toLowerCase().includes(q) || text.toLowerCase().includes(q);
      })
      .sort((a, b) => a[0].localeCompare(b[0], 'es'));

    shortcutCount.textContent = Object.keys(shortcuts).length;

    if (entries.length === 0) {
      shortcutList.innerHTML = '';
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');

    shortcutList.innerHTML = entries
      .map(
        ([code, text], i) => `
      <div class="shortcut-item"
           style="animation-delay:${Math.min(i * 15, 400)}ms"
           data-code="${esc(code)}">
        <span class="shortcut-code">${esc(code)}</span>
        <span class="shortcut-text">${esc(text)}</span>
        <div class="shortcut-actions">
          <button class="action-btn edit" title="Editar" data-code="${esc(code)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="action-btn delete" title="Eliminar" data-code="${esc(code)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>`
      )
      .join('');
  }

  /** Escape HTML entities to prevent XSS */
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ─── Toast ─────────────────────────────────────────────────────

  function showToast(message, icon = '✓') {
    if (toastTimer) clearTimeout(toastTimer);

    toastMessage.textContent = message;
    toastIcon.textContent = icon;
    toastEl.classList.remove('hidden', 'toast-out');

    toastTimer = setTimeout(() => {
      toastEl.classList.add('toast-out');
      setTimeout(() => toastEl.classList.add('hidden'), 300);
    }, 2500);
  }

  // ─── Add / Edit Modal ─────────────────────────────────────────

  function openModal(code = null) {
    editingCode = code;
    formError.classList.add('hidden');

    if (code) {
      modalTitle.textContent = 'Editar Atajo';
      codeInput.value = code;
      textInput.value = shortcuts[code] || '';
    } else {
      modalTitle.textContent = 'Agregar Atajo';
      codeInput.value = '';
      textInput.value = '';
    }

    codeInput.disabled = false;
    modalOverlay.classList.remove('hidden');
    setTimeout(() => (code ? textInput : codeInput).focus(), 100);
  }

  function closeModal() {
    modalOverlay.classList.add('hidden');
    editingCode = null;
  }

  async function handleSave() {
    const code = codeInput.value.trim();
    const text = textInput.value; // preserve leading/trailing whitespace intentionally

    // ── Validation ──
    if (!code) {
      return showError('El código del atajo no puede estar vacío');
    }
    if (!text.trim()) {
      return showError('El texto expandido no puede estar vacío');
    }
    if (/\s/.test(code)) {
      return showError('El código no puede contener espacios');
    }
    if (editingCode !== code && shortcuts.hasOwnProperty(code)) {
      return showError(`El atajo "${code}" ya existe`);
    }

    // If code was renamed, remove old key
    if (editingCode && editingCode !== code) {
      delete shortcuts[editingCode];
    }

    shortcuts[code] = text;
    await saveShortcuts();

    closeModal();
    renderList(searchInput.value);
    showToast(editingCode !== null ? 'Atajo actualizado' : 'Atajo agregado', '✓');
  }

  function showError(msg) {
    formError.textContent = msg;
    formError.classList.remove('hidden');
  }

  // ─── Delete Modal ──────────────────────────────────────────────

  function openDeleteModal(code) {
    deleteTarget = code;
    deleteCodeEl.textContent = code;
    deleteOverlay.classList.remove('hidden');
  }

  function closeDeleteModal() {
    deleteOverlay.classList.add('hidden');
    deleteTarget = null;
  }

  async function handleDelete() {
    if (!deleteTarget) return;

    delete shortcuts[deleteTarget];
    await saveShortcuts();

    closeDeleteModal();
    renderList(searchInput.value);
    showToast('Atajo eliminado', '🗑️');
  }

  // ─── Import / Export ───────────────────────────────────────────

  function handleExport() {
    const blob = new Blob([JSON.stringify(shortcuts, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'shortcuts.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Atajos exportados', '📥');
  }

  function handleImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const raw = await file.text();
        const imported = JSON.parse(raw);

        if (typeof imported !== 'object' || Array.isArray(imported)) {
          return showToast('Formato de archivo inválido', '⚠️');
        }

        let count = 0;
        for (const [code, expansion] of Object.entries(imported)) {
          if (typeof expansion === 'string') {
            shortcuts[code] = expansion;
            count++;
          }
        }

        await saveShortcuts();
        renderList(searchInput.value);
        showToast(`${count} atajos importados`, '📤');
      } catch {
        showToast('Error al leer el archivo', '⚠️');
      }
    };

    input.click();
  }

  // ─── Event Binding ─────────────────────────────────────────────

  function bindEvents() {
    // Search
    searchInput.addEventListener('input', () => {
      clearSearch.classList.toggle('hidden', !searchInput.value);
      renderList(searchInput.value);
    });

    clearSearch.addEventListener('click', () => {
      searchInput.value = '';
      clearSearch.classList.add('hidden');
      renderList();
      searchInput.focus();
    });

    // Add
    addBtn.addEventListener('click', () => openModal());

    // Import / Export
    importBtn.addEventListener('click', handleImport);
    exportBtn.addEventListener('click', handleExport);

    // Modal chrome
    modalClose.addEventListener('click', closeModal);
    modalCancel.addEventListener('click', closeModal);
    modalSave.addEventListener('click', handleSave);
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeModal();
    });

    // Delete chrome
    deleteCancel.addEventListener('click', closeDeleteModal);
    deleteConfirm.addEventListener('click', handleDelete);
    deleteOverlay.addEventListener('click', (e) => {
      if (e.target === deleteOverlay) closeDeleteModal();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!deleteOverlay.classList.contains('hidden')) return closeDeleteModal();
        if (!modalOverlay.classList.contains('hidden')) return closeModal();
      }
      // Ctrl+Enter to save in modal
      if (e.key === 'Enter' && e.ctrlKey && !modalOverlay.classList.contains('hidden')) {
        handleSave();
      }
    });

    // List delegation (edit / delete buttons)
    shortcutList.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.action-btn.edit');
      if (editBtn) return openModal(editBtn.dataset.code);

      const delBtn = e.target.closest('.action-btn.delete');
      if (delBtn) return openDeleteModal(delBtn.dataset.code);
    });
  }

  // ─── Boot ──────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);
})();
