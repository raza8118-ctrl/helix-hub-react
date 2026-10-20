// SOP Library list actions (make inactive, reorder, starter categories/software, client copy) — used by SopLibrary.jsx / SopPage.jsx.
import { S } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { SOP_LEVELS, STARTER_CATEGORIES } from '../../lib/sops';
import { SNAPSHOT_KEYS } from '../../lib/sopVersions';
import { confirmDialog, alertDialog } from '../../components/shared/Dialog';

const now = () => new Date().toISOString();
const nameOf = (level, row) => row?.[SOP_LEVELS[level].nameKey] ?? '';

/** Make inactive / reactivate (nothing is ever deleted). Returns true when changed. */
export async function toggleSopActive(level, row, user) {
  const cfg = SOP_LEVELS[level];
  const deactivating = row.active !== false;
  const below = { category: ' Its software, tasks and SOPs will be hidden too.', software: ' Its tasks and SOPs will be hidden too.', task: ' Its SOPs will be hidden too.' }[level] ?? '';
  if (!await confirmDialog(deactivating
    ? { title: `Make this ${cfg.one.toLowerCase()} inactive?`, message: `“${nameOf(level, row)}” will be hidden.${below} Nothing is deleted — you can reactivate it.`, tone: 'warning', confirmText: 'Make Inactive' }
    : { title: `Reactivate this ${cfg.one.toLowerCase()}?`, message: `“${nameOf(level, row)}” will show again.`, confirmText: 'Reactivate' })) return false;
  const ok = await S.update(cfg.table, { active: !deactivating, updated_by: user.emp_id, updated_at: now() }, { id: row.id });
  if (!ok) return false;
  logAudit({ actor: user, action: `${cfg.entity}_${deactivating ? 'deactivate' : 'activate'}`, entityType: cfg.entity, entityId: row.id });
  return true;
}

/** Move an item one place up (-1) or down (+1) among its siblings; renumbers the list. */
export async function moveSopItem(level, list, index, dir, user) {
  const target = index + dir;
  if (target < 0 || target >= list.length) return false;
  const order = [...list];
  [order[index], order[target]] = [order[target], order[index]];
  const cfg = SOP_LEVELS[level];
  const changes = order.map((r, i) => ({ r, sort_order: i + 1 })).filter(c => c.r.sort_order !== c.sort_order);
  await Promise.all(changes.map(c => S.update(cfg.table, { sort_order: c.sort_order }, { id: c.r.id })));
  logAudit({ actor: user, action: `${cfg.entity}_reorder`, entityType: cfg.entity, entityId: list[index].id });
  return true;
}

/** Adds the standard categories that are missing (for added companies, whose tables start empty). */
export async function addStarterCategories(lib, user) {
  const have = new Set(lib.categories.map(c => c.name.toLowerCase()));
  const missing = STARTER_CATEGORIES.filter(n => !have.has(n.toLowerCase()));
  if (!missing.length) return false;
  if (!await confirmDialog({ title: 'Add the standard categories?', message: missing.join(', '), confirmText: 'Add' })) return false;
  const start = Math.max(0, ...lib.categories.map(c => c.sort_order ?? 0));
  const rows = missing.map((name, i) => ({ name, sort_order: start + i + 1, active: true, created_by: user.emp_id, updated_by: user.emp_id }));
  const result = await S.set('sop_categories', rows);
  if (!result?.length) return false;
  logAudit({ actor: user, action: 'sop_category_add', entityType: 'sop_category', details: { count: result.length } });
  return true;
}

/**
 * "Make a client copy" (3.4): copies a common SOP's working copy into a new DRAFT for one client,
 * under the same task. Returns the new SOP row, or null.
 */
export async function makeClientCopy(sop, client, lib, user) {
  const title = `${sop.title} (${client.name})`;
  if (lib.sops.some(s => s.task_id === sop.task_id && s.active !== false && s.title.toLowerCase() === title.toLowerCase())) {
    await alertDialog({ title: 'Already exists', message: `There is already an SOP called “${title}” under this task.`, tone: 'warning' });
    return null;
  }
  if (!await confirmDialog({
    title: `Make a copy for ${client.name}?`,
    message: `A new draft “${title}” is created with the same content. Edit it for the client, then publish it.`,
    confirmText: 'Make Copy',
  })) return null;
  const content = Object.fromEntries(SNAPSHOT_KEYS.filter(k => k in sop && k !== 'title').map(k => [k, sop[k]]));
  const max = Math.max(0, ...lib.sops.filter(s => s.task_id === sop.task_id).map(s => s.sort_order ?? 0));
  const rows = await S.set('sops', {
    ...content, title, task_id: sop.task_id, owner: sop.owner ?? null, client_id: client.id, copied_from: sop.id,
    status: 'draft', sort_order: max + 1, active: true, created_by: user.emp_id, updated_by: user.emp_id,
  });
  if (!rows?.length) return null;
  logAudit({ actor: user, action: 'sop_client_copy', entityType: 'sop', entityId: rows[0].id, details: { copied_from: sop.id, client_id: client.id } });
  return rows[0];
}

/**
 * Adds the picked standard software (3.7) under their standard categories. A missing category is created
 * with its standard name. Returns the number of software rows added (0 on failure).
 */
export async function addStarterSoftware(lib, picked, user) {
  const findCat = name => lib.categories.find(c => c.active !== false && c.name.trim().toLowerCase() === name.toLowerCase());
  const catIds = {};
  let nextCatOrder = Math.max(0, ...lib.categories.map(c => c.sort_order ?? 0));
  for (const name of [...new Set(picked.map(p => p.category))]) {
    const existing = findCat(name);
    if (existing) { catIds[name] = existing.id; continue; }
    const rows = await S.set('sop_categories', {
      name, sort_order: ++nextCatOrder, active: true, created_by: user.emp_id, updated_by: user.emp_id,
    });
    if (!rows?.length) return 0;
    catIds[name] = rows[0].id;
    logAudit({ actor: user, action: 'sop_category_add', entityType: 'sop_category', entityId: rows[0].id });
  }
  const orderIn = {};
  const rows = picked.map(p => {
    const categoryId = catIds[p.category];
    orderIn[categoryId] ??= Math.max(0, ...lib.software.filter(sw => sw.category_id === categoryId).map(sw => sw.sort_order ?? 0));
    return {
      category_id: categoryId, name: p.name, vendor: p.vendor ?? null, notes: p.notes ?? null, portal_url: null,
      sort_order: ++orderIn[categoryId], active: true, created_by: user.emp_id, updated_by: user.emp_id,
    };
  });
  const saved = await S.set('sop_software', rows);
  if (!saved?.length) return 0;
  logAudit({ actor: user, action: 'sop_software_add', entityType: 'sop_software', details: { count: saved.length, standard: true } });
  return saved.length;
}
