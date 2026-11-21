"""Live sales SQL acceptance executed only from disposable hardening_qa.

The caller provides CI-guarded QA connection and actor/denial fixtures.
Every synthetic booking, receipt, refund and bulk-flat operation rolls back.
"""
from decimal import Decimal


def exercise_sales(db, actor, denied, company_project, admin, sales_staff, foreign_director):
    with db() as c:
        building = c.execute(
            "INSERT INTO buildings(project_id,code,name) VALUES(%s,'QA-SALES','Sales Tower') RETURNING id",
            (company_project,)).fetchone()[0]
        first_floor = c.execute(
            "INSERT INTO floors(building_id,name,floor_number) VALUES(%s,'Floor 1',1) RETURNING id",
            (building,)).fetchone()[0]
        second_floor = c.execute(
            "INSERT INTO floors(building_id,name,floor_number) VALUES(%s,'Floor 2',2) RETURNING id",
            (building,)).fetchone()[0]
        c.execute("INSERT INTO user_roles(user_id,role) VALUES(%s,'senior_sales_executive')",(sales_staff,))
        actor(c,admin)
        args = (building,[first_floor,second_floor],3,1,2,"","2bhk",
                500,600,700,2000,0,0,5)
        q = "SELECT sales_bulk_add_flats(%s,%s::uuid[],%s,%s,%s,%s,%s::unit_type,%s,%s,%s,%s,%s,%s,%s)"
        assert c.execute(q,args).fetchone()[0] == 6
        assert [row[0] for row in c.execute(
            "SELECT unit_number FROM units WHERE building_id=%s ORDER BY unit_number",
            (building,))] == ["101","102","103","201","202","203"]
        denied(c,lambda:c.execute(q,args))
        assert c.execute("SELECT count(*) FROM units WHERE building_id=%s",
                         (building,)).fetchone()[0]==6
        unit=c.execute("SELECT id FROM units WHERE building_id=%s AND unit_number='101'",
                       (building,)).fetchone()[0]
        actor(c,sales_staff)
        sale=c.execute("SELECT sales_book_flat(%s,'Buyer One','9876543210',1600000)",
                       (unit,)).fetchone()[0]
        denied(c,lambda:c.execute("SELECT sales_book_flat(%s,'Duplicate Buyer','9876543211',1600000)",(unit,)))
        receipt=c.execute("SELECT sales_report_receipt(%s,10000,current_date,'upi','QA-PAID-001')",
                          (sale,)).fetchone()[0]
        denied(c,lambda:c.execute("SELECT sales_cancel_booking(%s,'Customer requested cancellation',0)",(sale,)))
        actor(c,admin)
        denied(c,lambda:c.execute("SELECT sales_cancel_booking(%s,'Customer requested cancellation',0)",(sale,)))
        c.execute("SELECT sales_review_receipt(%s,true)",(receipt,))
        denied(c,lambda:c.execute("SELECT sales_set_stage(%s,'cancelled','Unsafe legacy path')",(sale,)))
        denied(c,lambda:c.execute("SELECT sales_cancel_booking(%s,'Customer requested cancellation',15000)",(sale,)))
        actor(c,foreign_director)
        denied(c,lambda:c.execute("SELECT sales_cancel_booking(%s,'Not my company booking cancellation',0)",(sale,)))
        actor(c,admin)
        cancellation=c.execute("SELECT sales_cancel_booking(%s,'Customer requested cancellation',1000)",
                               (sale,)).fetchone()[0]
        assert c.execute("SELECT status FROM units WHERE id=%s",(unit,)).fetchone()[0] == "available"
        assert c.execute("SELECT status FROM property_sales WHERE id=%s",(sale,)).fetchone()[0] == "cancelled"
        assert c.execute("SELECT verified_received,cancellation_fee,refund_due "
                         "FROM property_sale_cancellations WHERE id=%s",
                         (cancellation,)).fetchone()==(Decimal(10000),Decimal(1000),Decimal(9000))
        c.execute("SELECT sales_record_refund(%s,4000,current_date,'upi','QA-REF-001')",(sale,))
        denied(c,lambda:c.execute("SELECT sales_record_refund(%s,4000,current_date,'upi','QA-REF-001')",(sale,)))
        denied(c,lambda:c.execute("SELECT sales_record_refund(%s,6000,current_date,'upi','QA-REF-003')",(sale,)))
        c.execute("SELECT sales_record_refund(%s,5000,current_date,'upi','QA-REF-002')",(sale,))
        assert c.execute("SELECT sum(amount) FROM property_sale_refunds WHERE cancellation_id=%s",
                         (cancellation,)).fetchone()[0]==Decimal(9000)
        actor(c,sales_staff)
        assert c.execute("SELECT amount FROM property_sale_receipts WHERE id=%s",
                         (receipt,)).fetchone()[0]==Decimal(10000)
        second=c.execute("SELECT sales_book_flat(%s,'Buyer Two','9876543211',1600000)",
                         (unit,)).fetchone()[0]
        request=c.execute("SELECT sales_request_cancellation(%s,'Buyer Two requested cancellation')",
                          (second,)).fetchone()[0]
        denied(c,lambda:c.execute("SELECT sales_cancel_booking(%s,'Not authorized cancellation',0)",(second,)))
        actor(c,admin)
        c.execute("SELECT sales_cancel_booking(%s,'Buyer Two requested cancellation',0)",(second,))
        assert c.execute("SELECT status FROM property_sale_cancel_requests WHERE id=%s",
                         (request,)).fetchone()[0]=="approved"
        summary=c.execute("SELECT sales_overview(%s,%s)",(company_project,building)).fetchone()[0]
        assert int(summary["total_flats"])==6 and int(summary["available_flats"])==6,summary
        assert int(summary["cancelled_sales"])==2 and int(summary["active_sales"])==0,summary
        assert Decimal(str(summary["refund_pending"]))==Decimal(0),summary
        c.rollback()
    print("PASS Sales 0093/0094: 6-flat bulk, duplicate rollback, staff permissions, real collections, cancellation, refund ledger, rebooking")
