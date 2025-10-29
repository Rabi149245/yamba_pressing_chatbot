import fs from 'fs';
import path from 'path';
import { sendToMakeWebhook } from './makeService.js';

const dataDir = path.resolve('./data');
const userStatePath = path.join(dataDir, 'user_states.json');

// ---------------------------
// Lecture / écriture locale (simple et fiable)
// ---------------------------
async function readUserStates() {
  try {
    if (!fs.existsSync(userStatePath)) return {};
    const raw = await fs.promises.readFile(userStatePath, 'utf-8');
    return JSON.parse(raw || '{}');
  } catch (err) {
    console.error('[UserService] ❌ Erreur lecture user_states.json :', err.message);
    return {};
  }
}

async function writeUserStates(states) {
  try {
    await fs.promises.mkdir(dataDir, { recursive: true });
    await fs.promises.writeFile(userStatePath, JSON.stringify(states, null, 2));
  } catch (err) {
    console.error('[UserService] ❌ Erreur écriture user_states.json :', err.message);
  }
}

// ---------------------------
// 🔹 Obtenir l'état d'un utilisateur
// ---------------------------
export async function getUserState(phone) {
  if (!phone || typeof phone !== 'string' || phone.trim().length === 0) {
    console.warn('[UserService] ⚠️ getUserState appelé avec un téléphone invalide');
    return {};
  }
  
  const states = await readUserStates();
  return states[phone] || {};
}

// ---------------------------
// 🔹 Sauvegarder / mettre à jour l'état utilisateur
// ---------------------------
export async function saveUserState(phone, newState) {
  if (!phone || typeof phone !== 'string' || phone.trim().length === 0) {
    console.warn('[UserService] ⚠️ saveUserState appelé avec un téléphone invalide');
    return;
  }

  const states = await readUserStates();
  states[phone] = { ...(states[phone] || {}), ...newState };
  await writeUserStates(states);
}

// ---------------------------
// 🔹 Effacer complètement l'état utilisateur
// ---------------------------
export async function clearUserState(phone) {
  if (!phone || typeof phone !== 'string' || phone.trim().length === 0) {
    console.warn('[UserService] ⚠️ clearUserState appelé avec un téléphone invalide');
    return;
  }

  const states = await readUserStates();
  delete states[phone];
  await writeUserStates(states);
}

// ---------------------------
// 🔹 Historique de message (via Make)
// ---------------------------
export async function getUserLastMessage(phone) {
  if (!phone || typeof phone !== 'string' || phone.trim().length === 0) {
    console.warn('[UserService] ⚠️ getUserLastMessage appelé avec un téléphone invalide');
    return null;
  }

  try {
    const payload = { phone };
    const response = await sendToMakeWebhook(payload, 'Users_getLastMessage');
    return response?.LastOrderAt || response?.lastMessageAt || null;
  } catch (err) {
    console.error('[UserService] ⚠️ Erreur getUserLastMessage :', err.message);
    return null;
  }
}

export async function updateUserLastMessage(phone, date) {
  if (!phone || typeof phone !== 'string' || phone.trim().length === 0) {
    console.warn('[UserService] ⚠️ updateUserLastMessage appelé avec un téléphone invalide');
    return;
  }

  try {
    await sendToMakeWebhook({ phone, lastMessageAt: date }, 'Users_updateLastMessage');
  } catch (err) {
    console.error('[UserService] ⚠️ Erreur updateUserLastMessage :', err.message);
  }
}
