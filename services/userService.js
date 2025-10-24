// src/services/userService.js
import fs from 'fs';
import path from 'path';
import { sendToMakeWebhook } from './makeService.js';

const dataDir = path.resolve('./data');
const userStatePath = path.join(dataDir, 'user_states.json');

// ---------------------------
// Lecture / écriture locale (simple et fiable)
// ---------------------------
async function readUserStates() {
  if (!fs.existsSync(userStatePath)) return {};
  const raw = await fs.promises.readFile(userStatePath, 'utf-8');
  return JSON.parse(raw || '{}');
}

async function writeUserStates(states) {
  await fs.promises.mkdir(dataDir, { recursive: true });
  await fs.promises.writeFile(userStatePath, JSON.stringify(states, null, 2));
}

// ---------------------------
// 🔹 Obtenir l'état d'un utilisateur
// ---------------------------
export async function getUserState(phone) {
  const states = await readUserStates();
  return states[phone] || {};
}

// ---------------------------
// 🔹 Sauvegarder / mettre à jour l'état utilisateur
// ---------------------------
export async function saveUserState(phone, newState) {
  const states = await readUserStates();
  states[phone] = { ...(states[phone] || {}), ...newState };
  await writeUserStates(states);
}

// ---------------------------
// 🔹 Effacer complètement l'état utilisateur
// ---------------------------
export async function clearUserState(phone) {
  const states = await readUserStates();
  delete states[phone];
  await writeUserStates(states);
}

// ---------------------------
// 🔹 Historique de message (via Make)
// ---------------------------
export async function getUserLastMessage(phone) {
  try {
    const payload = { phone };
    const response = await sendToMakeWebhook(payload, 'Users_getLastMessage');
    return response?.LastOrderAt || null;
  } catch (err) {
    console.error('getUserLastMessage error:', err);
    return null;
  }
}

export async function updateUserLastMessage(phone, date) {
  try {
    await sendToMakeWebhook({ phone, lastMessageAt: date }, 'Users_updateLastMessage');
  } catch (err) {
    console.error('updateUserLastMessage error:', err);
  }
}
