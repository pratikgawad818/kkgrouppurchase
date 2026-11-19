import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const staffEditor = readFileSync(
  new URL("../../src/routes/_authenticated/_shell/settings.users.tsx", import.meta.url),
  "utf8",
);
const projectAccess = readFileSync(
  new URL("../../src/components/erp/staff-project-assignments.tsx", import.meta.url),
  "utf8",
);

test("staff dialog has one-column shell, independently scrollable body and always-visible actions", () => {
  assert.match(staffEditor, /<DialogContent className="flex max-h-\[min\(90dvh,860px\)\]/);
  assert.match(staffEditor, /min-h-0 flex-1 space-y-5 overflow-y-auto/);
  assert.match(staffEditor, /shrink-0 border-t bg-background/);
  assert.match(staffEditor, /Save staff details/);
  assert.doesNotMatch(projectAccess, /sm:col-span-2/);
});

test("project access remains independently saved and permission-controlled", () => {
  assert.match(projectAccess, /\.from\("user_project_assignments"\)/);
  assert.match(projectAccess, /\.insert\(\{ user_id: staffId, project_id: projectId \}\)/);
  assert.match(projectAccess, /\.delete\(\)/);
  assert.match(projectAccess, /onChange=\{\(event\) => update\.mutate/);
  assert.match(projectAccess, /Changes save automatically/);
  assert.match(staffEditor, /Project changes save immediately/);
});

test("project listing supports readable rows, search and responsive form labels", () => {
  assert.match(projectAccess, /Search by project name or code/);
  assert.match(projectAccess, /assignedCount/);
  assert.match(projectAccess, /min-h-14/);
  for (const field of ["phone", "department", "designation", "role"]) {
    assert.match(staffEditor, new RegExp(`staff-edit-${field}`));
  }
});
