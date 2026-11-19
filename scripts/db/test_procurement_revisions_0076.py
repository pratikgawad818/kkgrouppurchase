#!/usr/bin/env python3
"""Exercise migration 0076 on a disposable PostgreSQL database (never production).

This fixture deliberately provides a minimal typed schema; it runs the exact
migration SQL, then tests the real revision RPC bodies and financial totals.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

DSN = os.environ["PROCUREMENT_REVISIONS_QA_DSN"]
if not any(marker in DSN for marker in ("procurement_revisions_qa", "localhost")):
    raise SystemExit("Refusing a non-disposable PostgreSQL destination")

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "drizzle/migrations/0076_procurement_in_place_revisions.sql"

SCHEMA = """
DO $$ BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE service_role NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.actor',true),'')::uuid
$$;
CREATE TABLE companies(id uuid PRIMARY KEY);
CREATE TABLE profiles(id uuid PRIMARY KEY,company_id uuid);
CREATE TABLE projects(id uuid PRIMARY KEY,company_id uuid);
CREATE TABLE purchase_requests(
  id uuid PRIMARY KEY,company_id uuid,project_id uuid,requested_by uuid,status text,
  updated_at timestamptz,purpose text
);
CREATE TABLE purchase_request_items(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_request_id uuid,line_no integer,material_id uuid,description text,
  quantity numeric,unit_id uuid,estimated_rate numeric,required_by date,notes text
);
CREATE TABLE vendors(id uuid PRIMARY KEY,company_id uuid,status text);
CREATE TABLE rfqs(
  id uuid PRIMARY KEY,company_id uuid,purchase_request_id uuid,project_id uuid,
  status text,response_due_date date,remarks text,updated_at timestamptz
);
CREATE TABLE rfq_items(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),rfq_id uuid,pr_item_id uuid,
  line_no integer,material_id uuid,description text,requested_quantity numeric,
  unit_id uuid,target_rate numeric,required_by date
);
CREATE TABLE rfq_vendors(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),rfq_id uuid,vendor_id uuid,status text DEFAULT 'pending'
);
CREATE TABLE vendor_quotations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),rfq_id uuid);
CREATE TABLE vendor_selections(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),rfq_id uuid);
CREATE TABLE warehouses(id uuid PRIMARY KEY,company_id uuid,status text);
CREATE TABLE purchase_orders(
  id uuid PRIMARY KEY,company_id uuid,project_id uuid,rfq_id uuid,status text,
  updated_at timestamptz,delivery_warehouse_id uuid,expected_delivery_date date,
  payment_terms text,delivery_terms text,remarks text,
  freight_tax_amount numeric DEFAULT 0,other_charges_tax_amount numeric DEFAULT 0,
  freight numeric DEFAULT 0,other_charges numeric DEFAULT 0,subtotal numeric DEFAULT 0,
  discount_total numeric DEFAULT 0,tax_total numeric DEFAULT 0,grand_total numeric DEFAULT 0
);
CREATE TABLE purchase_order_items(
  id uuid PRIMARY KEY,po_id uuid,description text,
  ordered_quantity numeric,rate numeric,discount_amount numeric,
  tax_type text,tax_rate_percent numeric,received_quantity numeric DEFAULT 0,
  taxable_amount numeric,tax_amount numeric,line_total numeric
);
CREATE TABLE goods_receipt_notes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),po_id uuid);
CREATE TABLE vendor_delivery_challans(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),po_id uuid);
CREATE TABLE vendor_invoices(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),po_id uuid);

CREATE FUNCTION public.is_active_user(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT true
$$;
CREATE FUNCTION public.actor_in_company(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT true
$$;
CREATE FUNCTION public.can_access_project(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT true
$$;
CREATE FUNCTION public.has_permission(uuid,text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('test.allowed',true),''),'yes')='yes'
$$;
CREATE FUNCTION public.rfq_can_view(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT true
$$;
CREATE FUNCTION public.po_can_view(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT true
$$;
CREATE FUNCTION public.save_purchase_request(
  _request_id uuid,_id uuid,_header jsonb,_items jsonb,_submit boolean,
  _expected_updated_at timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p purchase_requests; raw jsonb; i integer:=0;
BEGIN
  SELECT * INTO p FROM purchase_requests WHERE id=_id FOR UPDATE;
  IF p.status<>'draft' OR p.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'Stale or locked PR'; END IF;
  UPDATE purchase_requests
    SET purpose=_header->>'purpose',updated_at=now(),
        status=CASE WHEN _submit THEN 'pending_approval' ELSE status END
    WHERE id=_id;
  DELETE FROM purchase_request_items WHERE purchase_request_id=_id;
  FOR raw IN SELECT value FROM jsonb_array_elements(_items) LOOP
    i:=i+1;
    INSERT INTO purchase_request_items (purchase_request_id,line_no,material_id,quantity,unit_id)
    VALUES (_id,i,(raw->>'material_id')::uuid,(raw->>'quantity')::numeric,(raw->>'unit_id')::uuid);
  END LOOP;
  RETURN _id;
END $$;
GRANT SELECT ON purchase_requests,rfqs,purchase_orders TO authenticated;
"""

def rejected(conn: psycopg.Connection, sql: str, params: tuple, label: str) -> None:
    try:
        with conn.transaction():
            conn.execute(sql, params)
    except (psycopg.Error, ValueError):
        print(f"PASS blocked: {label}")
    else:
        raise AssertionError(f"Should have blocked: {label}")


def main() -> None:
    company, actor, project = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    pr, pr_item, material, unit = uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    rfq, vendor1, vendor2 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    po, po_item, warehouse = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    now = datetime.now(timezone.utc)

    with psycopg.connect(DSN, autocommit=True) as conn:
        conn.execute(SCHEMA)
        # Compile every actual statement and embedded PL/pgSQL body.
        conn.execute(MIGRATION.read_text(encoding="utf-8"))
        conn.execute("INSERT INTO companies VALUES (%s)", (company,))
        conn.execute("INSERT INTO profiles VALUES (%s,%s)", (actor, company))
        conn.execute("INSERT INTO projects VALUES (%s,%s)", (project, company))
        conn.execute("INSERT INTO purchase_requests VALUES (%s,%s,%s,%s,'draft',%s,'Original purpose')",
                     (pr, company, project, actor, now))
        conn.execute("INSERT INTO purchase_request_items(id,purchase_request_id,line_no,material_id,quantity,unit_id,estimated_rate) VALUES (%s,%s,1,%s,5,%s,100)",
                     (pr_item, pr, material, unit))
        conn.execute("INSERT INTO vendors VALUES (%s,%s,'active'),(%s,%s,'active')",
                     (vendor1, company, vendor2, company))
        conn.execute("INSERT INTO rfqs VALUES (%s,%s,%s,%s,'draft','2026-12-01','Old terms',%s)",
                     (rfq, company, pr, project, now))
        conn.execute("INSERT INTO rfq_items(rfq_id,pr_item_id,line_no,material_id,requested_quantity,unit_id) VALUES (%s,%s,1,%s,5,%s)",
                     (rfq, pr_item, material, unit))
        conn.execute("INSERT INTO rfq_vendors(rfq_id,vendor_id) VALUES (%s,%s)", (rfq, vendor1))
        conn.execute("INSERT INTO warehouses VALUES (%s,%s,'active')", (warehouse, company))
        conn.execute("INSERT INTO purchase_orders(id,company_id,project_id,status,updated_at,freight,freight_tax_amount) VALUES (%s,%s,%s,'draft',%s,50,9)",
                     (po, company, project, now))
        conn.execute("INSERT INTO purchase_order_items VALUES (%s,%s,'Cement',10,100,0,'cgst_sgst',18,0,1000,180,1180)",
                     (po_item, po))
        conn.execute("SELECT set_config('test.actor',%s,false)", (str(actor),))

        request_id = uuid.uuid4()
        pr_params = (request_id, pr, Jsonb({"purpose":"Corrected slab request"}),
                     Jsonb([{"material_id":str(material),"unit_id":str(unit),"quantity":8}]),
                     False, now, "Site measurement increased quantity")
        assert conn.execute(
            "SELECT save_purchase_request_revision(%s,%s,%s,%s,%s,%s,%s)", pr_params
        ).fetchone()[0] == pr
        assert conn.execute("SELECT quantity FROM purchase_request_items WHERE purchase_request_id=%s", (pr,)).fetchone()[0] == 8
        assert conn.execute("SELECT count(*) FROM procurement_document_revisions WHERE document_type='purchase_request'").fetchone()[0] == 1
        rejected(conn, "SELECT save_purchase_request_revision(%s,%s,%s,%s,%s,%s,%s)", (
            uuid.uuid4(),pr,Jsonb({"purpose":"stale"}),Jsonb([]),False,now,"Old version should fail"
        ), "stale purchase request edit")

        # In the real workflow an RFQ cannot exist until the PR is approved.
        # Refresh this synthetic RFQ source FK after the earlier draft PR edit.
        pr_item = conn.execute("SELECT id FROM purchase_request_items WHERE purchase_request_id=%s", (pr,)).fetchone()[0]
        conn.execute("UPDATE rfq_items SET pr_item_id=%s WHERE rfq_id=%s", (pr_item,rfq))
        rfq_params = (rfq, now, Jsonb({"response_due_date":"2026-12-05","remarks":"Corrected deadline"}),
                      Jsonb([{"pr_item_id":str(pr_item),"requested_quantity":12}]),
                      [vendor1,vendor2],"Vendor list and quantity corrected")
        assert conn.execute("SELECT revise_rfq_draft(%s,%s,%s,%s,%s,%s)",rfq_params).fetchone()[0] == rfq
        assert conn.execute("SELECT requested_quantity FROM rfq_items WHERE rfq_id=%s", (rfq,)).fetchone()[0] == 12
        assert conn.execute("SELECT count(*) FROM rfq_vendors WHERE rfq_id=%s",(rfq,)).fetchone()[0] == 2
        rejected(conn,"SELECT revise_rfq_draft(%s,%s,%s,%s,%s,%s)", (
            rfq,now,Jsonb({"response_due_date":"2026-12-06"}),Jsonb([{"pr_item_id":str(pr_item),"requested_quantity":2}]),
            [vendor1,vendor1],"Duplicated vendor list"
        ),"duplicate RFQ vendor")
        conn.execute("INSERT INTO vendor_quotations(rfq_id) VALUES (%s)", (rfq,))
        rejected(conn,"SELECT revise_rfq_draft(%s,%s,%s,%s,%s,%s)",rfq_params,"RFQ already has vendor quotation")

        po_params = (po, now,
                     Jsonb({"delivery_warehouse_id":str(warehouse),"expected_delivery_date":"2026-12-05",
                            "payment_terms":"30 days","delivery_terms":"At site","remarks":"Corrected price"}),
                     Jsonb([{"id":str(po_item),"description":"43-grade cement",
                             "ordered_quantity":9,"rate":110,"discount_amount":10,
                             "tax_type":"cgst_sgst","tax_rate_percent":18}]),
                     "Supplier corrected quoted unit rate")
        assert conn.execute("SELECT revise_po_draft(%s,%s,%s,%s,%s)",po_params).fetchone()[0] == po
        amount = conn.execute("SELECT subtotal,discount_total,tax_total,grand_total FROM purchase_orders WHERE id=%s",(po,)).fetchone()
        assert [round(float(v),2) for v in amount] == [990,10,185.4,1215.4], amount
        assert conn.execute("SELECT count(*) FROM procurement_document_revisions WHERE document_type='purchase_order'").fetchone()[0] == 1
        rejected(conn,"SELECT revise_po_draft(%s,%s,%s,%s,%s)",po_params,"PO optimistic concurrency")
        current_version = conn.execute("SELECT updated_at FROM purchase_orders WHERE id=%s",(po,)).fetchone()[0]
        conn.execute("INSERT INTO goods_receipt_notes(po_id) VALUES (%s)",(po,))
        rejected(conn,"SELECT revise_po_draft(%s,%s,%s,%s,%s)",(
            po,current_version,po_params[2],po_params[3],po_params[4]
        ),"PO with goods receipt")
        conn.execute("DELETE FROM goods_receipt_notes")
        conn.execute("UPDATE purchase_orders SET status='sent' WHERE id=%s",(po,))
        rejected(conn,"SELECT revise_po_draft(%s,%s,%s,%s,%s)",(
            po,current_version,po_params[2],po_params[3],po_params[4]
        ),"sent PO is immutable")

        conn.execute("SELECT set_config('test.allowed','no',false)")
        conn.execute("UPDATE purchase_orders SET status='draft' WHERE id=%s",(po,))
        rejected(conn,"SELECT revise_po_draft(%s,%s,%s,%s,%s)",(
            po,current_version,po_params[2],po_params[3],po_params[4]
        ),"no role permission")
        conn.execute("SELECT set_config('test.allowed','yes',false)")

        # Authenticated clients can read RLS-scoped audit history, never mutate it.
        conn.execute("SET ROLE authenticated")
        rows = conn.execute("SELECT document_type FROM procurement_document_revisions").fetchall()
        assert len(rows) == 3, rows
        rejected(conn,"DELETE FROM procurement_document_revisions",(),"audit history is append-only for staff")
        conn.execute("RESET ROLE")
    print("PASS migration 0076: PR/RFQ/PO revisions, totals, permission and downstream safety")


if __name__ == "__main__":
    main()
