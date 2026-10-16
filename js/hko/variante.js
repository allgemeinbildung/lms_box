//
//  js/hko/variante.js — welche Variante (3J/4J/2J) gilt für die angemeldete Person (Plan §2.4).
//
//    students/{uid}.classId (Roster, von js/auth.js schon gelesen) → classes/{classId} (DB hko)
//
//  Formativ und im Client fälschbar (P1-E3): die Rules prüfen nur, dass `variante` einer der drei
//  Werte ist und zu `nur_variante` passt. Die LP-Ansicht rechnet selbst nach.
//
import { lehreText } from './util.js';

export const TEXTE = Object.freeze({
    klasseFehlt: 'Ihre Klasse ist für diese Einheiten noch nicht erfasst. Melden Sie das Ihrer Lehrperson.',
    klasseInaktiv: 'Ihre Klasse ist für diese Einheiten zurzeit nicht freigeschaltet. Melden Sie das Ihrer Lehrperson.',
    fehler: 'Ihre Klasse konnte nicht geladen werden. Prüfen Sie Ihre Internetverbindung und laden Sie die Seite neu.',
    einheitFremd: 'Diese Einheit ist für Ihre Lehre nicht vorgesehen.',
    blockFremd: (nur) => `Dieser Auftrag gilt für die ${lehreText(nur)}.`,
});

const VARIANTEN = ['3J', '4J', '2J'];

/**
 * @returns {Promise<{ fall: 'ok'|'klasse-fehlt'|'klasse-inaktiv'|'fehler', classId: string,
 *                     variante: string|null, lehrjahr: number|null, mehrere: boolean, text: string }>}
 */
export async function ermittleVariante(student, api) {
    const ids = Array.isArray(student?.classIds) ? student.classIds.filter((c) => typeof c === 'string' && c) : [];
    const classId = (typeof student?.classId === 'string' && student.classId) || ids[0] || '';
    const base = { classId, variante: null, lehrjahr: null, mehrere: false };
    if (!classId) return { ...base, fall: 'klasse-fehlt', text: TEXTE.klasseFehlt };

    const andere = [...new Set(ids)].filter((c) => c !== classId).slice(0, 5);
    let cls;
    let weitere = [];
    try {
        [cls, ...weitere] = await Promise.all([api.getClass(classId), ...andere.map((c) => api.getClass(c).catch(() => null))]);
    } catch (error) {
        console.error('[hko] classes nicht lesbar:', error);
        return { ...base, fall: 'fehler', text: TEXTE.fehler };
    }
    if (!cls || !VARIANTEN.includes(cls.variante)) return { ...base, fall: 'klasse-fehlt', text: TEXTE.klasseFehlt };
    if (cls.aktiv !== true) return { ...base, fall: 'klasse-inaktiv', text: TEXTE.klasseInaktiv };

    const varianten = new Set(weitere.filter((c) => c && VARIANTEN.includes(c.variante)).map((c) => c.variante));
    varianten.delete(cls.variante);
    const mehrere = varianten.size > 0;
    if (mehrere) {
        console.warn(`[hko] Die Person ist in Klassen mit verschiedenen Varianten; es gilt die erste Klasse (${classId}, ${cls.variante}).`);
    }
    return { fall: 'ok', classId, variante: cls.variante, lehrjahr: cls.lehrjahr ?? null, mehrere, text: '' };
}

/**
 * Darf die Person diesen Block der Einheit bearbeiten?
 * @returns {{ speicherbar: boolean, fall: string, text: string }}
 *   fall: 'ok' | 'klasse-fehlt' | 'klasse-inaktiv' | 'einheit-variante' | 'block-variante'
 */
export function pruefeBlock(v, unit, block) {
    if (v.fall !== 'ok') return { speicherbar: false, fall: v.fall, text: v.text };
    const varianten = unit?.varianten && typeof unit.varianten === 'object' ? Object.keys(unit.varianten) : [];
    if (!varianten.includes(v.variante)) return { speicherbar: false, fall: 'einheit-variante', text: TEXTE.einheitFremd };
    const nur = block?.nur_variante ?? null;
    if (nur && nur !== v.variante) return { speicherbar: false, fall: 'block-variante', text: TEXTE.blockFremd(nur) };
    return { speicherbar: true, fall: 'ok', text: '' };
}
