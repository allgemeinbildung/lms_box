/**
 * bulkFreigabe.js
 * ───────────────
 * Handles the "Alle freigeben / zurückziehen" panel in liveview.html.
 *
 * The panel sits in the header and lets the teacher choose which parts to
 * release (Punkte, Kurzbericht, Ausführlich) and then apply that to ALL
 * student cards that have a .publish-panel visible.
 */

import { publishFeedback } from './api.js';

// ─── Internal helpers ──────────────────────────────────────────────────────

/**
 * Collect all student cards that currently have a publish-panel
 * (meaning they have feedback loaded).
 */
const getCardsWithPanel = () =>
    Array.from(document.querySelectorAll('.student-card')).filter(card =>
        card.querySelector('.publish-panel')
    );

/**
 * Reads the current release-settings from a single card's publish-panel.
 */
const getSettingsFromCard = (card) => {
    const panel = card.querySelector('.publish-panel');
    if (!panel) return null;
    return {
        kurzbericht: panel.querySelector('.release-check-kurz')?.checked ?? true,
        ausfuehrlich: panel.querySelector('.release-check-detail')?.checked ?? true,
        punkte: panel.querySelector('.release-check-punkte')?.checked ?? true,
        loesung: panel.querySelector('.release-check-loesung')?.checked ?? false,
    };
};

/**
 * Applies bulk settings to a single card's publish-panel checkboxes
 * and syncs the toggle-button state.
 */
const applySettingsToCard = (card, settings, released) => {
    const panel = card.querySelector('.publish-panel');
    if (!panel) return;

    const kurzCb = panel.querySelector('.release-check-kurz');
    const detailCb = panel.querySelector('.release-check-detail');
    const punkteCb = panel.querySelector('.release-check-punkte');
    const btn = panel.querySelector('.release-toggle-btn');
    const statusEl = panel.querySelector('.release-status');

    if (kurzCb) kurzCb.checked = settings.kurzbericht;
    if (detailCb) detailCb.checked = settings.ausfuehrlich;
    if (punkteCb) punkteCb.checked = settings.punkte;

    if (btn) {
        btn.style.background = released ? '#dc2626' : '#16a34a';
        btn.textContent = released ? '🔒 Zurückziehen' : '🔓 Freigeben';
    }
    if (statusEl) {
        statusEl.textContent = released ? '✓ Freigegeben' : '✓ Zurückgezogen';
    }
};

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Sets up the bulk-freigabe button and the floating panel.
 *
 * @param {HTMLButtonElement} triggerBtn  – The "🔓 Klasse freigeben" button in the header
 * @param {function(): string} getAssId  – Returns the currently selected assignment ID
 */
export const setupBulkFreigabe = (triggerBtn, getAssId) => {

    // ── Build the floating dropdown panel ──────────────────────────────────
    const dropdown = document.createElement('div');
    dropdown.id = 'bulk-freigabe-panel';
    dropdown.style.cssText = `
        display: none;
        position: absolute;
        z-index: 1500;
        background: #fff;
        border: 1px solid #fed7aa;
        border-radius: 10px;
        padding: 16px 20px;
        box-shadow: 0 8px 30px rgba(0,0,0,0.18);
        min-width: 320px;
        font-size: 0.88em;
        font-family: inherit;
    `;

    dropdown.innerHTML = `
        <div style="font-weight:700; color:#92400e; margin-bottom:12px; font-size:1.05em;">
            🔓 Klassen-Freigabe
        </div>

        <div style="color:#555; margin-bottom:10px; line-height:1.5;">
            Wählen Sie, was für <strong>alle Schüler*innen</strong> freigegeben werden soll:
        </div>

        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:14px;">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" id="bulk-check-punkte" checked
                    style="width:16px; height:16px; accent-color:#f59e0b;">
                <span>📊 <strong>Punkte</strong></span>
            </label>
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" id="bulk-check-kurz" checked
                    style="width:16px; height:16px; accent-color:#f59e0b;">
                <span>💬 <strong>Kurzbericht</strong> (kurzes Feedback)</span>
            </label>
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" id="bulk-check-detail" checked
                    style="width:16px; height:16px; accent-color:#f59e0b;">
                <span>📄 <strong>Ausführlich</strong> (detailliertes Feedback)</span>
            </label>
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" id="bulk-check-loesung"
                    style="width:16px; height:16px; accent-color:#f59e0b;">
                <span>🔑 <strong>Lösungsschlüssel</strong></span>
            </label>
        </div>

        <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button id="bulk-release-btn"
                style="flex:1; padding:8px 14px; border-radius:6px; border:none; cursor:pointer;
                       font-weight:700; font-size:0.95em; background:#16a34a; color:white;">
                🔓 Alle freigeben
            </button>
            <button id="bulk-withdraw-btn"
                style="flex:1; padding:8px 14px; border-radius:6px; border:none; cursor:pointer;
                       font-weight:700; font-size:0.95em; background:#dc2626; color:white;">
                🔒 Alle zurückziehen
            </button>
        </div>

        <div id="bulk-freigabe-status"
            style="margin-top:10px; font-size:0.85em; color:#666; min-height:1.4em; text-align:center;">
        </div>
    `;

    // Position the dropdown below the trigger button
    document.body.appendChild(dropdown);

    const positionDropdown = () => {
        const rect = triggerBtn.getBoundingClientRect();
        dropdown.style.top = `${rect.bottom + window.scrollY + 6}px`;
        dropdown.style.left = `${rect.left + window.scrollX}px`;
    };

    // ── Toggle panel on button click ───────────────────────────────────────
    triggerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = dropdown.style.display !== 'none';
        if (isOpen) {
            dropdown.style.display = 'none';
        } else {
            positionDropdown();
            dropdown.style.display = 'block';
        }
    });

    // Close panel when clicking outside
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && e.target !== triggerBtn) {
            dropdown.style.display = 'none';
        }
    });

    // ── Helpers to read panel settings ────────────────────────────────────
    const getBulkSettings = () => ({
        punkte: document.getElementById('bulk-check-punkte').checked,
        kurzbericht: document.getElementById('bulk-check-kurz').checked,
        ausfuehrlich: document.getElementById('bulk-check-detail').checked,
        loesung: document.getElementById('bulk-check-loesung').checked,
    });

    const statusEl = dropdown.querySelector('#bulk-freigabe-status');

    const showStatus = (msg, color = '#666') => {
        statusEl.style.color = color;
        statusEl.textContent = msg;
    };

    // ── Core bulk action ──────────────────────────────────────────────────
    const runBulkAction = async (released) => {
        const assId = getAssId();
        if (!assId) {
            showStatus('⚠️ Keine Aufgabe ausgewählt.', '#b45309');
            return;
        }

        const cards = getCardsWithPanel();
        if (cards.length === 0) {
            showStatus('⚠️ Keine Schüler mit bewertetem Feedback gefunden.', '#b45309');
            return;
        }

        const settings = getBulkSettings();
        const releaseBtn = dropdown.querySelector('#bulk-release-btn');
        const withdrawBtn = dropdown.querySelector('#bulk-withdraw-btn');

        releaseBtn.disabled = true;
        withdrawBtn.disabled = true;
        showStatus(`⏳ 0 / ${cards.length} verarbeitet...`, '#6b7280');

        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < cards.length; i++) {
            const card = cards[i];
            const studentKey = card.dataset.studentKey;
            if (!studentKey) { errorCount++; continue; }

            // Grab the feedbackData that was stored on the card's publish-panel
            // The panel's release button closure has it; we reconstruct it from
            // the card's _feedbackData property set by the renderer.
            const feedbackData = card._feedbackData;
            if (!feedbackData) { errorCount++; continue; }

            try {
                // Use the same publishFeedback API as individual panels
                let feedbackItem;
                if (feedbackData.history && Array.isArray(feedbackData.history) && feedbackData.history.length > 0) {
                    feedbackItem = feedbackData.history[feedbackData.history.length - 1];
                } else {
                    feedbackItem = { results: feedbackData.results, date_str: feedbackData.date_str };
                }

                const result = await publishFeedback(studentKey, assId, feedbackItem, settings, released);

                if (result.status === 'success') {
                    successCount++;
                    // Sync the individual card's publish-panel UI
                    applySettingsToCard(card, settings, released);
                } else {
                    errorCount++;
                }
            } catch (err) {
                errorCount++;
                console.error(`Bulk freigabe error for ${card.dataset.studentName}:`, err);
            }

            showStatus(
                `⏳ ${i + 1} / ${cards.length} verarbeitet...`,
                '#6b7280'
            );
        }

        releaseBtn.disabled = false;
        withdrawBtn.disabled = false;

        if (errorCount === 0) {
            const action = released ? 'freigegeben' : 'zurückgezogen';
            showStatus(`✅ ${successCount} Schüler*innen ${action}.`, '#16a34a');
        } else {
            showStatus(`⚠️ ${successCount} OK, ${errorCount} Fehler.`, '#b45309');
        }
    };

    // ── Button handlers ────────────────────────────────────────────────────
    dropdown.querySelector('#bulk-release-btn').addEventListener('click', () => runBulkAction(true));
    dropdown.querySelector('#bulk-withdraw-btn').addEventListener('click', () => runBulkAction(false));
};
