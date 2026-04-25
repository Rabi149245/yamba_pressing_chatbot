import fs from 'fs';
import path from 'path';
import { callMakeAndWait, sendToMakeWebhook } from './makeService.js';

const dataDir      = path.resolve('./data');
const userStatePath = path.join(dataDir, 'user_states.json');

// ─── Lecture / Écriture locale ────────────────────────────────────────────────
async function readUserStates() {
  try {
    if (!fs.existsSync(userStatePath)) return {};
    const raw = await fs.promises.readFile(userStatePath, 'utf-8');
    return JSON.parse(raw || '{}');
  } catch (err) {
    console.error('[UserService] ❌ Lecture user_states.json :', err.message);
    return {};
  }
}

async function writeUserStates(states) {
  try {
    await fs.promises.mkdir(dataDir, { recursive: true });
    await fs.promises.writeFile(userStatePath, JSON.stringify(states, null, 2));
  } catch (err) {
    console.error('[UserService] ❌ Écriture user_states.json :', err.message);
  }
}

// ─── État conversationnel ─────────────────────────────────────────────────────

/** Retourne l'état courant de l'utilisateur (étape du menu, service choisi, etc.) */
export async function getUserState(phone) {
  if (!phone || typeof phone !== 'string') {
    console.warn('[UserService] ⚠️ getUserState : téléphone invalide');
    return {};
  }
  const states = await readUserStates();
  return states[phone] || {};
}

/** Fusionne de nouvelles propriétés dans l'état de l'utilisateur */
export async function saveUserState(phone, newState) {
  if (!phone || typeof phone !== 'string') {
    console.warn('[UserService] ⚠️ saveUserState : téléphone invalide');
    return;
  }
  const states = await readUserStates();
  states[phone] = { ...(states[phone] || {}), ...newState };
  await writeUserStates(states);
}

/** Efface complètement l'état de l'utilisateur (fin de commande, retour menu) */
export async function clearUserState(phone) {
  if (!phone || typeof phone !== 'string') {
    console.warn('[UserService] ⚠️ clearUserState : téléphone invalide');
    return;
  }
  const states = await readUserStates();
  delete states[phone];
  await writeUserStates(states);
}

// ─── Historique de messages (via Make) ───────────────────────────────────────

/**
 * Récupère la date du dernier message du client.
 * Le scénario Make "Users_getLastMessage" retourne : { lastMessageAt }
 */
export async function getUserLastMessage(phone) {
  if (!phone || typeof phone !== 'string') {
    console.warn('[UserService] ⚠️ getUserLastMessage : téléphone invalide');
    return null;
  }
  try {
    const response = await callMakeAndWait({ phone }, 'Users_getLastMessage');
    return response?.lastMessageAt || response?.LastOrderAt || null;
  } catch (err) {
    console.error('[UserService] ⚠️ getUserLastMessage :', err.message);
    return null;
  }
}

/**
 * Met à jour la date du dernier message dans Google Sheets.
 * Le scénario Make "Users_updateLastMessage" reçoit : { phone, lastMessageAt }
 */
export async function updateUserLastMessage(phone, date) {
  if (!phone || typeof phone !== 'string') {
    console.warn('[UserService] ⚠️ updateUserLastMessage : téléphone invalide');
    return;
  }
  try {
    await sendToMakeWebhook(
      { phone, lastMessageAt: date instanceof Date ? date.toISOString() : date },
      'Users_updateLastMessage'
    );
  } catch (err) {
    console.error('[UserService] ⚠️ updateUserLastMessage :', err.message);
  }
}
