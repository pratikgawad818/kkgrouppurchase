"""Acceptance for Sales 0096-0098 on hardening_qa ONLY.
Exercises imported flat, pricing, booking, verified money, buyer file,
versioned instalments, legal-stage guards and scoped building reports.
Every synthetic record is rolled back.
"""
import json
from decimal import Decimal
from datetime import timedelta
from uuid import uuid4


def exercise_commercial(db,actor,denied,project,admin,site,foreign_director,company):
    with db() as c:
        building=c.execute("INSERT INTO buildings(project_id,code,name) VALUES(%s,'COM','Commercial Tower') RETURNING id",
                           (project,)).fetchone()[0]
        c.execute("INSERT INTO floors(building_id,name,floor_number) VALUES(%s,'Floor 1',1)",(building,))
        c.execute("INSERT INTO floors(building_id,name,floor_number) VALUES(%s,'Floor 2',2)",(building,))
        rows=[
            {"floor_number":"1","flat_number":"101","type":"2bhk",
             "carpet_area":"500","built_up_area":"600","saleable_area":"700",
             "rate":"2000","parking":"0","other":"0","gst":"5"},
            {"floor_number":"1","flat_number":"102","type":"2bhk",
             "carpet_area":"500","built_up_area":"600","saleable_area":"700",
             "rate":"2000","parking":"0","other":"0","gst":"5"},
        ]
        actor(c,foreign_director)
        denied(c,lambda:c.execute("SELECT sales_import_flat_rows(%s,%s::jsonb,true)",
                                  (building,json.dumps(rows))))
        actor(c,admin)
        preview=c.execute("SELECT sales_import_flat_rows(%s,%s::jsonb,true)",
                          (building,json.dumps(rows))).fetchone()[0]
        assert preview["created"]==0 and preview["validated"]==2
        assert c.execute("SELECT count(*) FROM units WHERE building_id=%s",(building,)).fetchone()[0]==0
        result=c.execute("SELECT sales_import_flat_rows(%s,%s::jsonb,false)",
                         (building,json.dumps(rows))).fetchone()[0]
        assert result["created"]==2
        denied(c,lambda:c.execute("SELECT sales_import_flat_rows(%s,%s::jsonb,false)",
                                  (building,json.dumps(rows))))
        assert c.execute("SELECT count(*) FROM units WHERE building_id=%s",(building,)).fetchone()[0]==2
        flat=c.execute("SELECT id FROM units WHERE building_id=%s AND unit_number='101'",
                       (building,)).fetchone()[0]
        revised=c.execute("SELECT sales_reprice_flat(%s,2200,0,0,0,5,%s)",
                          (flat,"Management-approved rate revision")).fetchone()[0]
        assert revised==Decimal("1617000.00"),revised
        assert c.execute("SELECT count(*) FROM property_unit_price_revisions WHERE unit_id=%s",
                         (flat,)).fetchone()[0]==1
        actor(c,foreign_director)
        denied(c,lambda:c.execute("SELECT sales_reprice_flat(%s,2300,0,0,0,5,%s)",
                                  (flat,"Wrong company rate revision")))
        c.execute("RESET ROLE")
        c.execute("INSERT INTO user_roles(user_id,role) VALUES(%s,'senior_sales_executive')",(site,))
        actor(c,site)
        booking=c.execute("SELECT sales_book_flat(%s,'First Buyer','9876543210',1617000)",
                          (flat,)).fetchone()[0]
        denied(c,lambda:c.execute("SELECT sales_reprice_flat(%s,2400,0,0,0,5,%s)",
                                  (flat,"Booked flat cannot reprice")))
        c.execute("SELECT sales_save_buyer_details(%s,'Main Road','Palghar','Maharashtra','401404',NULL,'pan','AB12','Customer contact')",
                  (booking,))
        assert c.execute("SELECT identification_last4 FROM property_sale_buyer_details WHERE sale_id=%s",
                         (booking,)).fetchone()[0]=="AB12"
        denied(c,lambda:c.execute("SELECT sales_save_buyer_details(%s,'',NULL,NULL,NULL,NULL,'pan','1234567890',NULL)",
                                  (booking,)))
        actor(c,admin)
        # Keep QA instalments relative to this freshly created synthetic
        # booking. A hard-coded 2026-11-21 date broke the daily CI after
        # that day passed, despite no production sales workflow regression.
        booked_on=c.execute("SELECT booked_on FROM property_sales WHERE id=%s",(booking,)).fetchone()[0]
        booking_due=booked_on.isoformat()
        agreement_due=(booked_on+timedelta(days=30)).isoformat()
        milestones=[
            {"label":"Booking","due_on":booking_due,"amount":"17000"},
            {"label":"Agreement","due_on":agreement_due,"amount":"1600000"}
        ]
        denied(c,lambda:c.execute("SELECT sales_set_payment_plan(%s,%s::jsonb,'Wrong sum')",
                                  (booking,json.dumps([{"label":"Booking","due_on":booking_due,"amount":"1"}]))))
        assert c.execute("SELECT sales_set_payment_plan(%s,%s::jsonb,'Agreed sale schedule')",
                         (booking,json.dumps(milestones))).fetchone()[0]==1
        assert c.execute("SELECT count(*) FROM sales_current_milestones(%s)",(booking,)).fetchone()[0]==2
        c.execute("SELECT sales_set_payment_plan(%s,%s::jsonb,'Revised payment schedule')",
                  (booking,json.dumps(milestones)))
        assert c.execute("SELECT count(*) FROM property_sale_payment_plans WHERE sale_id=%s",
                         (booking,)).fetchone()[0]==2
        actor(c,site)
        receipt=c.execute("SELECT sales_report_receipt(%s,10000,current_date,'upi','COMM-REC-01')",
                          (booking,)).fetchone()[0]
        actor(c,admin)
        c.execute("SELECT sales_review_receipt(%s,true)",(receipt,))
        credited=c.execute("SELECT credited FROM sales_current_milestones(%s) ORDER BY sequence LIMIT 1",
                           (booking,)).fetchone()[0]
        assert credited==Decimal(10000),credited

        # Storage policies must allow the authorized uploader, then only
        # authorized project colleagues to view a linked document.
        actor(c,site)
        path=f"{company}/{booking}/{site}/{uuid4()}.pdf"
        c.execute("INSERT INTO storage.objects(bucket_id,name) VALUES('sales-documents',%s)",(path,))
        document=c.execute("SELECT sales_link_document(%s,'booking_form',%s,'booking.pdf')",
                           (booking,path)).fetchone()[0]
        assert document
        assert c.execute("SELECT count(*) FROM storage.objects WHERE bucket_id='sales-documents' AND name=%s",
                         (path,)).fetchone()[0]==1
        actor(c,foreign_director)
        denied(c,lambda:c.execute("SELECT sales_link_document(%s,'buyer_id',%s,'foreign.pdf')",
                                  (booking,path)))
        assert c.execute("SELECT count(*) FROM storage.objects WHERE name=%s",(path,)).fetchone()[0]==0

        actor(c,admin)
        c.execute("SELECT sales_set_stage(%s,'agreement_pending')",(booking,))
        denied(c,lambda:c.execute("SELECT sales_set_stage(%s,'agreement_done')",(booking,)))
        c.execute("SELECT sales_save_legal_details(%s,'AGR-001',current_date,NULL,NULL,NULL,'Agreement signed')",
                  (booking,))
        c.execute("SELECT sales_set_stage(%s,'agreement_done')",(booking,))
        denied(c,lambda:c.execute("SELECT sales_set_stage(%s,'registered')",(booking,)))
        c.execute("SELECT sales_save_legal_details(%s,'AGR-001',current_date,'REG-001',current_date,'Palghar Office','Registered')",
                  (booking,))
        c.execute("SELECT sales_set_stage(%s,'registered')",(booking,))
        denied(c,lambda:c.execute(
            "SELECT sales_correct_erroneous_stage(%s,%s,%s)",
            (booking,"This sale was not really registered","I_CONFIRM_STAGE_ENTERED_IN_ERROR")))
        report=c.execute("SELECT flats,available,active_bookings,contracted_value,verified_collections "
                         "FROM sales_project_report(%s) WHERE building_id=%s",
                         (project,building)).fetchone()
        assert report==(2,1,1,Decimal("1617000.00"),Decimal("10000.00")),report
        actor(c,foreign_director)
        assert c.execute("SELECT count(*) FROM sales_project_report(%s)",(project,)).fetchone()[0]==0
        c.rollback()
    print("PASS commercial sales 0096-0098: dry run, atomic import, price audit, buyer, plan, private docs, legal guards, project report")
