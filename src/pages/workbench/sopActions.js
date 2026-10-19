// SOP Library list actions (make inactive, reorder, starter categories) — used by SopLibrary.jsx.
import { S } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { SOP_LEVELS, STARTER_CATEGORIES } from '../../lib/sops';
import { confirmDialog } from '../../components/shared/Dialog';

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
