import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const user = '11111111-1111-4111-8111-111111111111';
// Evaluate the deployed SQL expression without widening access to the private helper.
const definition = JSON.parse(execFileSync('lovable', ['supabase', 'query', "select pg_get_functiondef('public.staff_audit_blocks_deletion(text,text,text,uuid)'::regprocedure) as definition", '--json'], { encoding: 'utf8' })).rows[0].definition;
const body = definition.match(/AS \$function\$([\s\S]*?)\$function\$/)?.[1];
assert.ok(body, 'deployed history classifier has a SQL body');
function blocks(entity, action, entityId = user) {
  const literal = value => value === null ? 'NULL' : `'${value.replaceAll("'", "''")}'`;
  const values = { _entity: literal(entity), _action: literal(action), _entity_id: literal(entityId), _user_id: `'${user}'::uuid` };
  const expression = body.trim().replace(/;$/, '').replace(/\b(_entity_id|_user_id|_entity|_action)\b/g, key => values[key]);
  const query = `select result.* from (${expression}) as result(blocked)`;
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