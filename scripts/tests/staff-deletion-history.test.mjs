import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const user = '11111111-1111-4111-8111-111111111111';
function blocks(entity, action, entityId = user) {
  const literal = value => value === null ? 'NULL' : `'${value.replaceAll("'", "''")}'`;
  const query = `select public.staff_audit_blocks_deletion(${literal(entity)},${literal(action)},${literal(entityId)},'${user}'::uuid) as blocked`;
  const result = JSON.parse(execFileSync('lovable', ['supabase', 'query', query, '--json'], { encoding: 'utf8' }));
  return result.rows[0].blocked;
}
test('own profile creation and edits do not block staff deletion', () => {
  assert.equal(blocks('profiles', 'insert'), false);
  assert.equal(blocks('profiles', 'update'), false);
});
test('own login activity does not block staff deletion', () => {
  assert.equal(blocks('auth', 'login'), false);
  assert.equal(blocks('sessions', 'signed_in'), false);
});
test('business and approval history still blocks staff deletion', () => {
  assert.equal(blocks('purchase_orders', 'update'), true);
  assert.equal(blocks('PO', 'po_approved'), true);
  assert.equal(blocks('profiles', 'update', '22222222-2222-4222-8222-222222222222'), true);
});
test('unknown and incomplete audit events are protected', () => {
  assert.equal(blocks(null, null, null), true);
  assert.equal(blocks('profiles', 'delete'), true);
});