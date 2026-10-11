"""Actual 0015 SQL acceptance: building-wise material issues/returns in isolated PG.

This is NOT a live DB migration or full goods-receipt process. Stock starts
with a synthetic 700-bag opening balance, then genuine migrated issue/return
RPCs and ledger writes are exercised.
"""
from __future__ import annotations
import json
import os
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import psycopg

ROOT=Path(__file__).resolve().parents[2]
DSN=os.getenv("MATERIAL_QA_DSN")
ADMIN_A="10000000-0000-4000-8000-000000000001"
ADMIN_B="10000000-0000-4000-8000-000000000011"
SITE_A="10000000-0000-4000-8000-000000000002"
VIEWER_A="10000000-0000-4000-8000-000000000003"
PROJECT_A="20000000-0000-4000-8000-000000000001"
PROJECT_B="20000000-0000-4000-8000-000000000011"
TOWER_A="30000000-0000-4000-8000-000000000001"
TOWER_B="30000000-0000-4000-8000-000000000002"
OTHER_TOWER="30000000-0000-4000-8000-000000000011"
STORE_A="40000000-0000-4000-8000-000000000001"
STORE_B="40000000-0000-4000-8000-000000000011"
CEMENT="60000000-0000-4000-8000-000000000001"

def db():
    if os.getenv("CI")!="true" or not DSN:
        raise RuntimeError("Material 0015 tests require CI=true and an isolated QA DSN")
    conn=psycopg.connect(DSN,application_name="material-0015-disposable-qa")
    if conn.execute("SELECT current_database()").fetchone()[0]!="material_qa":
        conn.close()
        raise RuntimeError("Refusing to touch any DB except material_qa")
    conn.commit()
    return conn

def setup():
    with db() as c:
        c.autocommit=True
        c.execute((ROOT/"scripts/db/fixtures/material_0015_disposable.sql").read_text())
        # Execute the real SQL, not copies of its stock or report functions.
        c.execute((ROOT/"drizzle/migrations/0015_project_material_issues_returns.sql").read_text())
        assert c.execute(
          "SELECT has_function_privilege('authenticated',"
          "'public.record_material_issue(uuid,uuid,uuid,text,text,jsonb)','EXECUTE')"
        ).fetchone()[0]
        assert not c.execute(
          "SELECT has_function_privilege('authenticated',"
          "'public.post_material_stock(text,uuid,uuid,uuid,uuid,uuid,numeric,numeric,uuid,uuid,uuid,uuid,numeric)','EXECUTE')"
        ).fetchone()[0]

def actor(c,user):
    c.execute("SET LOCAL ROLE authenticated")
    c.execute("SELECT set_config('qa.actor',%s,true)",(user,))

def denied(c,action):
    c.execute("SAVEPOINT expected_error")
    try:
        action()
    except psycopg.Error:
        c.execute("ROLLBACK TO SAVEPOINT expected_error")
        c.execute("RELEASE SAVEPOINT expected_error")
        return
    c.execute("ROLLBACK TO SAVEPOINT expected_error")
    c.execute("RELEASE SAVEPOINT expected_error")
    raise AssertionError("Expected DB permission, scope or stock guard to reject request")

def issue(c,building,qty,project=PROJECT_A,store=STORE_A,material=CEMENT):
    return c.execute(
      "SELECT public.record_material_issue(%s::uuid,%s::uuid,%s::uuid,%s,%s,%s::jsonb)",
      (store,project,building,"Site Supervisor","Site cement distribution",
       json.dumps([{"material_id":material,"quantity":qty}]))
    ).fetchone()[0]

def return_from_issue(c,issue_id,quantity):
    item_id=c.execute(
      "SELECT id FROM public.material_issue_items WHERE issue_id=%s::uuid",
      (issue_id,)
    ).fetchone()[0]
    return c.execute(
      "SELECT public.record_material_return(%s::uuid,%s,%s,%s::jsonb)",
      (issue_id,"Store Supervisor","Unused cement returned to store",
       json.dumps([{"issue_item_id":str(item_id),"quantity":quantity}]))
    ).fetchone()[0]

def test_700_500_200_exact_stock_flow():
    with db() as c:
        actor(c,ADMIN_A)
        ia=issue(c,TOWER_A,300)
        ib=issue(c,TOWER_B,230)
        returned=return_from_issue(c,ib,30)
        assert UUID(str(ia)) and UUID(str(ib)) and UUID(str(returned))
        stock=c.execute("SELECT quantity_on_hand,weighted_avg_cost,total_value "
          "FROM public.warehouse_stock WHERE warehouse_id=%s::uuid AND material_id=%s::uuid",
          (STORE_A,CEMENT)).fetchone()
        assert stock==(Decimal("200.000"),Decimal("300.0000"),Decimal("60000.00")),stock

        details=c.execute("""
          SELECT building_name,issued_quantity,returned_quantity,net_quantity,
                 issued_value,returned_value,net_value
          FROM public.project_material_consumption(%s::uuid)
          ORDER BY building_name
        """,(PROJECT_A,)).fetchall()
        assert len(details)==2,details
        assert details[0][:4]==("Tower A",Decimal(300),Decimal(0),Decimal(300))
        assert details[1][:4]==("Tower B",Decimal(230),Decimal(30),Decimal(200))
        assert details[0][6]==Decimal("90000.00")
        assert details[1][6]==Decimal("60000.00")
        assert sum(row[3] for row in details)==Decimal(500)
        assert sum(row[6] for row in details)==Decimal(150000)

        ledger=c.execute("""
          SELECT tx_type::text,quantity_in,quantity_out,balance_after,
                 material_issue_item_id IS NOT NULL,
                 material_return_item_id IS NOT NULL
          FROM public.inventory_transactions
          WHERE company_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid
          ORDER BY balance_after DESC
        """).fetchall()
        assert len(ledger)==4,ledger
        assert [row[3] for row in ledger]==[700,400,200,170] or \
          sorted([row[3] for row in ledger])==[170,200,400,700],ledger
        assert sum(row[1] for row in ledger)==Decimal(730)
        assert sum(row[2] for row in ledger)==Decimal(530)
        assert sum(1 for row in ledger if row[4])==2
        assert sum(1 for row in ledger if row[5])==1
        assert c.execute("SELECT count(*) FROM public.qa_events").fetchone()[0]==3

        denied(c,lambda:issue(c,TOWER_A,201))
        denied(c,lambda:return_from_issue(c,ib,201))
        denied(c,lambda:issue(c,OTHER_TOWER,1))
        denied(c,lambda:issue(c,TOWER_B,1,project=PROJECT_B))
        denied(c,lambda:issue(c,TOWER_B,1,store=STORE_B))
        denied(c,lambda:c.execute("UPDATE public.material_issues SET purpose='ALTERED' WHERE id=%s::uuid",(ia,)))
        denied(c,lambda:c.execute("DELETE FROM public.material_return_items"))
        assert c.execute("SELECT quantity_on_hand FROM public.warehouse_stock "
          "WHERE warehouse_id=%s::uuid AND material_id=%s::uuid",(STORE_A,CEMENT)).fetchone()[0]==Decimal(200)
        assert c.execute("SELECT count(*) FROM public.inventory_transactions").fetchone()[0]==4
    print("PASS: 700 opening, 530 issued, 30 returned, 500 consumed, 200 on hand; ledger and immutable source")

def test_permissions_and_company_boundary():
    with db() as c:
        actor(c,VIEWER_A)
        report=c.execute("SELECT building_name,net_quantity FROM public.project_material_consumption(NULL)").fetchall()
        assert sorted((x[0],int(x[1])) for x in report)==[("Tower A",300),("Tower B",200)]
        denied(c,lambda:issue(c,TOWER_A,1))
    with db() as c:
        actor(c,ADMIN_B)
        assert c.execute("SELECT count(*) FROM public.material_issues").fetchone()[0]==0
        assert c.execute("SELECT count(*) FROM public.material_returns").fetchone()[0]==0
        assert c.execute("SELECT count(*) FROM public.inventory_transactions").fetchone()[0]==0
        assert c.execute("SELECT count(*) FROM public.project_material_consumption(NULL)").fetchone()[0]==0
        denied(c,lambda:issue(c,TOWER_A,1))
    with db() as c:
        actor(c,SITE_A)
        assert c.execute("SELECT count(*) FROM public.project_material_consumption(%s::uuid)",
          (PROJECT_B,)).fetchone()[0]==0
        denied(c,lambda:issue(c,TOWER_A,1,project=PROJECT_B))
    print("PASS: viewer cannot mutate; company and project boundaries block access")

if __name__=="__main__":
    setup()
    test_700_500_200_exact_stock_flow()
    test_permissions_and_company_boundary()
    print("PASS: genuine migration 0015 source on isolated synthetic PostgreSQL")
