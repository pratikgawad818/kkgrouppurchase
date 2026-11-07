import test from "node:test";
import assert from "node:assert/strict";
import {
  isReportableInvoiceStatus,
  summarizeInvoiceMaterialAllocations,
} from "../../src/lib/invoice-material-allocations.ts";

const line = (overrides = {}) => ({
  id: "l1",
  invoiceId: "inv1",
  invoiceNumber: "VI-1",
  invoiceDate: "2026-11-07",
  vendorName: "Supplier",
  status: "approved",
  source: "opening",
  projectId: "city-centre",
  projectName: "K.K. City Centre",
  buildingId: null,
  buildingName: null,
  materialId: "m40",
  materialName: "M40",
  materialCode: "M40",
  unit: "CUM",
  quantity: 7,
  taxableValue: 44100,
  remarks: null,
  ...overrides,
});

test("project invoice rollup shows M40 and M45, keeping invoice approval separate", () => {
  const groups = summarizeInvoiceMaterialAllocations([
    line(),
    line({ id: "l2", invoiceId: "inv2", status: "pending_review", quantity: 6, taxableValue: 37800 }),
    line({ id: "l3", invoiceId: "inv3", materialId: "m45", materialName: "M45", materialCode: "M45", quantity: 4, taxableValue: 27000 }),
    line({ id: "l4", invoiceId: "inv4", status: "rejected", quantity: 100 }),
  ]);
  assert.equal(groups.length, 2);
  const m40 = groups.find((group) => group.materialId === "m40");
  assert.equal(m40?.acceptedInvoiceQuantity, 7);
  assert.equal(m40?.pendingInvoiceQuantity, 6);
  assert.equal(m40?.invoiceCount, 2);
  assert.equal(m40?.acceptedInvoiceValue, 44100);
  assert.equal(m40?.pendingInvoiceValue, 37800);
  assert.equal(groups.find((group) => group.materialId === "m45")?.acceptedInvoiceQuantity, 4);
});

test("project, building and unit boundaries never merge unlike quantities", () => {
  const groups = summarizeInvoiceMaterialAllocations([
    line({ quantity: 1 }),
    line({ id: "l2", quantity: 3, projectId: "other", projectName: "Other project" }),
    line({ id: "l3", quantity: 2, buildingId: "tower-a", buildingName: "Tower A" }),
    line({ id: "l4", quantity: 50, unit: "BAG" }),
    line({ id: "l5", quantity: 1, status: "cancelled" }),
  ]);
  assert.equal(groups.length, 4);
  assert.equal(groups.find((group) => group.projectId === "city-centre" &&
    group.buildingId === null && group.unit === "CUM")?.acceptedInvoiceQuantity, 1);
  assert.equal(groups.find((group) => group.projectId === "other")?.acceptedInvoiceQuantity, 3);
  assert.equal(groups.find((group) => group.buildingId === "tower-a")?.acceptedInvoiceQuantity, 2);
  assert.equal(groups.find((group) => group.unit === "BAG")?.acceptedInvoiceQuantity, 50);
});

test("same invoice with multiple lines is counted once while quantities are combined", () => {
  const groups = summarizeInvoiceMaterialAllocations([
    line({ id: "l1", quantity: 7, taxableValue: 44000.11 }),
    line({ id: "l2", quantity: 6, taxableValue: 37000.22 }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].invoiceCount, 1);
  assert.equal(groups[0].lineCount, 2);
  assert.equal(groups[0].acceptedInvoiceQuantity, 13);
  assert.equal(groups[0].acceptedInvoiceValue, 81000.33);
});

test("free-text bill items are retained without pretending they were master-linked", () => {
  const groups = summarizeInvoiceMaterialAllocations([
    line({ materialId: null, materialCode: null, materialName: "Pump Labour", unit: "PERSON" }),
    line({ id: "l2", materialId: null, materialCode: null, materialName: "pump labour", unit: "PERSON" }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].materialId, null);
  assert.equal(groups[0].acceptedInvoiceQuantity, 14);
});

test("rejected/cancelled bills are excluded and invalid totals fail closed", () => {
  assert.equal(isReportableInvoiceStatus("rejected"), false);
  assert.equal(isReportableInvoiceStatus("cancelled"), false);
  assert.equal(isReportableInvoiceStatus("pending_review"), true);
  assert.deepEqual(summarizeInvoiceMaterialAllocations([line({ status: "rejected" })]), []);
  assert.throws(() => summarizeInvoiceMaterialAllocations([line({ quantity: NaN })]), /invalid quantity/);
});
