"""Disposable end-to-end supplier challan -> GRN -> issued/returned building stock.

Unlike the simpler 0015 test this starts with EMPTY warehouse stock.
Actual functions are extracted from source migrations 0003, 0014, 0015
without copying their bodies. Simulated baseline tables and helpers do NOT
replace a full staging migration rehearsal or authenticated browser testing.
"""
from __future__ import annotations
import json
import os
import re
from decimal import Decimal
from pathlib import Path
from uuid import UUID
import psycopg

ROOT=Path(__file__).resolve().parents[2]
DSN=os.getenv("MATERIAL_GRN_QA_DSN")
ADMIN_A="10000000-0000-4000-8000-000000000001"
ADMIN_B="10000000-0000-4000-8000-000000000011"
PROJECT_A="20000000-0000-4000-8000-000000000001"
TOWER_A="30000000-0000-4000-8000-000000000001"
TOWER_B="30000000-0000-4000-8000-000000000002"
STORE_A="40000000-0000-4000-8000-000000000001"
STORE_B="40000000-0000-4000-8000-000000000011"
CEMENT="60000000-0000-4000-8000-000000000001"
PO_A="71000000-0000-4000-8000-000000000001"
PO_B="71000000-0000-4000-8000-000000000011"
PO_ITEM_A="74000000-0000-4000-8000-000000000001"

def db():
    if os.getenv("CI")!="true" or not DSN:
        raise RuntimeError("GRN tests are permitted only in isolated CI")
    c=psycopg.connect(DSN,application_name="challan-grn-material-qa")
    if c.execute("SELECT current_database()").fetchone()[0]!="grn_material_qa":
        c.close()
        raise RuntimeError("Not permitted outside grn_material_qa")
    c.commit()
    return c

def actual_function(migration: str,name: str) -> str:
    source=(ROOT/"drizzle/migrations"/migration).read_text()
    start=f"CREATE OR REPLACE FUNCTION public.{name}("
    if source.count(start)!=1:
        raise AssertionError(f"Expected exactly one {name} function in {migration}")
    tail=source[source.index(start):]
    match=re.search(r"END \$\$;",tail)
    if not match:
        raise AssertionError(f"Unterminated source function {name}")
    result=tail[:match.end()]
    if f"public.{name}(" not in result:
        raise AssertionError("SQL extraction failed")
    return result

def setup():
    with db() as c:
        c.autocommit=True
        c.execute((ROOT/"scripts/db/fixtures/material_0015_disposable.sql").read_text())
        c.execute((ROOT/"scripts/db/fixtures/grn_material_qa_extension.sql").read_text())
        # Actual Phase 4 post-to-stock and GRN apply functions.
        c.execute(actual_function("0003_phase4_completion.sql","post_stock_x"))
        c.execute(actual_function("0003_phase4_completion.sql","grn_apply"))
        # Supplier delivery evidence and receipt registration from migration 0014.
        c.execute(actual_function("0014_vendor_delivery_challans.sql","register_vendor_delivery_challan"))
        c.execute(actual_function("0014_vendor_delivery_challans.sql","create_goods_receipt"))
        # Actual material issue / return schema, security, report and stock code.
        c.execute((ROOT/"drizzle/migrations/0015_project_material_issues_returns.sql").read_text())
        # The real migrations have internal-only privileges on stock helpers.
        # Enforce no direct invocation of post_stock_x from authenticated clients.
        c.execute("REVOKE ALL ON FUNCTION public.post_stock_x("
          "uuid,public.inventory_tx_type,uuid,uuid,uuid,uuid,numeric,numeric,numeric,"
          "uuid,uuid,uuid,uuid,text) FROM PUBLIC,authenticated")
        assert not c.execute("SELECT has_function_privilege('authenticated',"
          "'public.post_stock_x(uuid,public.inventory_tx_type,uuid,uuid,uuid,uuid,numeric,numeric,"
          "numeric,uuid,uuid,uuid,uuid,text)','EXECUTE')").fetchone()[0]

def actor(c,user):
    c.execute("SET LOCAL ROLE authenticated")
    c.execute("SELECT set_config('qa.actor',%s,true)",(user,))

def denied(c,work):
    c.execute("SAVEPOINT qa_reject")
    try: work()
    except psycopg.Error:
        c.execute("ROLLBACK TO SAVEPOINT qa_reject")
        c.execute("RELEASE SAVEPOINT qa_reject")
        return
    c.execute("ROLLBACK TO SAVEPOINT qa_reject")
    c.execute("RELEASE SAVEPOINT qa_reject")
    raise AssertionError("Expected server-side rejection")

def challan(c,po=PO_A,qty=700,number="DC-700"):
    header={"challan_number":number,"challan_date":str(c.execute("SELECT public.ist_today()").fetchone()[0])}
    items=[{"po_item_id":PO_ITEM_A,"quantity":qty}]
    return c.execute("SELECT public.register_vendor_delivery_challan(%s::uuid,%s::jsonb,%s::jsonb)",
      (po,json.dumps(header),json.dumps(items))).fetchone()[0]

def receive(c,dc,po=PO_A,store=STORE_A,qty=700,post=True):
    header={"challan_id":str(dc),"received_date":str(c.execute("SELECT public.ist_today()").fetchone()[0])}
    items=[{"po_item_id":PO_ITEM_A,"received_quantity":qty,"damaged_quantity":0,"rejected_quantity":0}]
    return c.execute(
      "SELECT public.create_goods_receipt(%s::uuid,%s::uuid,%s::jsonb,%s::jsonb,%s)",
      (po,store,json.dumps(header),json.dumps(items),post)
    ).fetchone()[0]

def issue(c,building,qty):
    return c.execute(
      "SELECT public.record_material_issue(%s::uuid,%s::uuid,%s::uuid,%s,%s,%s::jsonb)",
      (STORE_A,PROJECT_A,building,"Site Supervisor","Cement distribution to site",
       json.dumps([{"material_id":CEMENT,"quantity":qty}]))
    ).fetchone()[0]

def return_unused(c,issue_id,qty):
    line_id=c.execute("SELECT id FROM public.material_issue_items WHERE issue_id=%s::uuid",
      (issue_id,)).fetchone()[0]
    return c.execute("SELECT public.record_material_return(%s::uuid,%s,%s,%s::jsonb)",
      (issue_id,"Store Supervisor","Unused cement bags returned",
       json.dumps([{"issue_item_id":str(line_id),"quantity":qty}]))
    ).fetchone()[0]

def test_full_chain():
    with db() as c:
        actor(c,ADMIN_A)
        assert c.execute("SELECT count(*) FROM public.warehouse_stock").fetchone()[0]==0
        assert c.execute("SELECT count(*) FROM public.inventory_transactions").fetchone()[0]==0
        dc=challan(c)
        assert UUID(str(dc))
        assert c.execute("SELECT count(*) FROM public.inventory_transactions").fetchone()[0]==0
        assert c.execute("SELECT quantity FROM public.vendor_delivery_challan_items WHERE challan_id=%s::uuid",
          (dc,)).fetchone()[0]==Decimal(700)

        denied(c,lambda:receive(c,dc,store=STORE_B))
        denied(c,lambda:receive(c,dc,qty=701))
        denied(c,lambda:receive(c,dc,po=PO_B))
        denied(c,lambda:challan(c,qty=701,number="DC-OVER"))
        assert c.execute("SELECT count(*) FROM public.goods_receipt_notes").fetchone()[0]==0

        grn=receive(c,dc)
        assert UUID(str(grn))
        assert c.execute("SELECT status::text FROM public.goods_receipt_notes WHERE id=%s::uuid",
          (grn,)).fetchone()[0]=="posted"
        assert c.execute("SELECT status::text FROM public.purchase_orders WHERE id=%s::uuid",
          (PO_A,)).fetchone()[0]=="fully_received"
        assert c.execute("SELECT received_quantity FROM public.purchase_order_items WHERE id=%s::uuid",
          (PO_ITEM_A,)).fetchone()[0]==Decimal(700)
        assert c.execute("SELECT quantity_on_hand,weighted_avg_cost,total_value "
          "FROM public.warehouse_stock WHERE warehouse_id=%s::uuid AND material_id=%s::uuid",
          (STORE_A,CEMENT)).fetchone()==(Decimal(700),Decimal(300),Decimal(210000))
        assert c.execute("SELECT count(*) FROM public.inventory_transactions WHERE grn_id=%s::uuid",
          (grn,)).fetchone()[0]==1
        denied(c,lambda:receive(c,dc))
        denied(c,lambda:challan(c,number="DC-AFTER-RECEIPT"))
        ia=issue(c,TOWER_A,300)
        ib=issue(c,TOWER_B,230)
        mr=return_unused(c,ib,30)
        assert UUID(str(mr))
        assert c.execute("SELECT quantity_on_hand,weighted_avg_cost,total_value "
          "FROM public.warehouse_stock WHERE warehouse_id=%s::uuid AND material_id=%s::uuid",
          (STORE_A,CEMENT)).fetchone()==(Decimal(200),Decimal(300),Decimal(60000))
        by_building=c.execute("""
           SELECT building_name,issued_quantity,returned_quantity,net_quantity,net_value
           FROM public.project_material_consumption(%s::uuid)
           ORDER BY building_name
        """,(PROJECT_A,)).fetchall()
        assert by_building==[
          ("Tower A",Decimal(300),Decimal(0),Decimal(300),Decimal(90000)),
          ("Tower B",Decimal(230),Decimal(30),Decimal(200),Decimal(60000))
        ],by_building
        ledger=c.execute("""SELECT tx_type::text,quantity_in,quantity_out,balance_after,
             grn_item_id,material_issue_item_id,material_return_item_id
             FROM public.inventory_transactions
             WHERE company_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid
             ORDER BY balance_after DESC""").fetchall()
        assert len(ledger)==4,ledger
        assert sorted(x[3] for x in ledger)==[170,200,400,700]
        assert [x[0] for x in ledger].count("goods_receipt")==1
        assert [x[0] for x in ledger].count("material_issue")==2
        assert [x[0] for x in ledger].count("material_return")==1
        assert sum(x[1] for x in ledger)==Decimal(730)
        assert sum(x[2] for x in ledger)==Decimal(530)
        assert sum(x[4] is not None for x in ledger)==1
        assert sum(x[5] is not None for x in ledger)==2
        assert sum(x[6] is not None for x in ledger)==1
        denied(c,lambda:return_unused(c,ib,201))
        denied(c,lambda:issue(c,TOWER_A,201))
        assert c.execute("SELECT quantity_on_hand FROM public.warehouse_stock "
          "WHERE warehouse_id=%s::uuid AND material_id=%s::uuid",
          (STORE_A,CEMENT)).fetchone()[0]==Decimal(200)
    print("PASS: actual challan + GRN + stock-post + issue + return functions: 700/500/200")

def test_company_rls():
    with db() as c:
        actor(c,ADMIN_B)
        assert c.execute("SELECT count(*) FROM public.material_issues").fetchone()[0]==0
        assert c.execute("SELECT count(*) FROM public.goods_receipt_notes").fetchone()[0]==0
        assert c.execute("SELECT count(*) FROM public.project_material_consumption(NULL)").fetchone()[0]==0
        assert c.execute("SELECT count(*) FROM public.warehouse_stock").fetchone()[0]==1
        denied(c,lambda:receive(c,"00000000-0000-4000-8000-000000000001"))
        denied(c,lambda:challan(c,po=PO_A,number="CROSS-COMPANY"))
    print("PASS: company isolation on dispatch, receiving, stock and project report")

if __name__=="__main__":
    setup()
    test_full_chain()
    test_company_rls()
    print("PASS: isolated GRN-to-building usage integration, real source SQL functions")
