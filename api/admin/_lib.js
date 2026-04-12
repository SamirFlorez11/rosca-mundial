/**
 * _lib.js — Utilidades compartidas para todas las rutas /api/admin/*
 * Importar con: const { sb, requireAdmin, ok, err } = require("./_lib");
 */

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_SECRET  = process.env.ADMIN_SECRET; // Token que el panel envía en header X-Admin-Token

// ─── Cliente Supabase (REST puro, sin SDK para mantener zero-deps) ────────────
async function sb(table, { method = "GET", body, params = {} } = {}) {
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  const qs = new URLSearchParams(params).toString();
  if (qs) url += "?" + qs;

  const res = await fetch(url, {
    method,
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": method === "POST" ? "return=representation" : "return=minimal",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { data, status: res.status, ok: res.ok };
}

// ─── RPC (stored procedures) ──────────────────────────────────────────────────
async function rpc(fn, params = {}) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/${fn}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { data, status: res.status, ok: res.ok };
}

// ─── Auth guard ───────────────────────────────────────────────────────────────
function requireAdmin(req) {
  const token = req.headers["x-admin-token"];
  if (!ADMIN_SECRET) return false; // Si no está seteado, bloquear todo
  return token === ADMIN_SECRET;
}

// ─── CORS helpers ─────────────────────────────────────────────────────────────
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://roscamundial.com");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Admin-Token");
}

// ─── Response helpers ─────────────────────────────────────────────────────────
const ok  = (res, data, status = 200) => res.status(status).json({ ok: true,  ...data });
const err = (res, msg,  status = 400) => res.status(status).json({ ok: false, error: msg });

module.exports = { sb, rpc, requireAdmin, setCORS, ok, err };
