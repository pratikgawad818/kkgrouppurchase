"""Replay the complete source chain and test new boundaries with synthetic data.

Only hardening_qa with CI=true is permitted. Auth/storage infrastructure is a
minimal fixture. pg_net HTTP is a spy: no network request or real email is sent.
"""
from __future__ import annotations
import json
import os
from pathlib import Path
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
import time
import psycopg

ROOT = Path(__file__).resolve().parents[2]
DSN = os.environ.get("HARDENING_QA_DSN")
A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"
PURCHASER = "10000000-0000-4000-8000-000000000001"
DIRECTOR = "10000000-0000-4000-8000-000000000002"
OTHER_DIRECTOR = "10000000-0000-4000-8000-000000000003"
UNASSIGNED = "10000000-0000-4000-8000-000000000004"
INACTIVE = "10000000-0000-4000-8000-000000000005"
SITE = "10000000-0000-4000-8000-000000000006"
ACCOUNTS = "10000000-0000-4000-8000-000000000007"
ADMIN = "10000000-0000-4000-8000-000000000008"
PROJECT = "20000000-0000-4000-8000-000000000001"
OTHER_PROJECT = "20000000-0000-4000-8000-000000000002"
MATERIAL = "30000000-0000-4000-8000-000000000001"
UNIT = "30000000-0000-4000-8000-000000000002"
VENDOR = "30000000-0000-4000-8000-000000000003"
FOREIGN_VENDOR = "30000000-0000-4000-8000-000000000004"
WAREHOUSE = "30000000-0000-4000-8000-000000000005"


def db():
    if os.getenv("CI") != "true" or not DSN:
        raise RuntimeError("Hardening tests require CI=true and a disposable database")
    c = psycopg.connect(DSN, application_name="go-live-hardening-qa")
    if c.execute("SELECT current_database()").fetchone()[0] != "hardening_qa":
        c.close()
        raise RuntimeError("Refusing non-disposable database")
    c.commit()
    return c


def actor(c, uid):
    c.execute("SET LOCAL ROLE authenticated")
    c.execute("SELECT set_config('qa.actor',%s,true)", (uid,))


def denied(c, action, expected=""):
    c.execute("SAVEPOINT expected_denial")
    try:
        action()
    except psycopg.Error as e:
        c.execute("ROLLBACK TO SAVEPOINT expected_denial")
        if expected:
            assert expected in str(e), (expected, str(e))
    else:
        raise AssertionError("Unsafe operation unexpectedly succeeded")
    finally:
        c.execute("RELEASE SAVEPOINT expected_denial")


def setup():
    with db() as c:
        c.autocommit = True
        c.execute("""CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN;
          CREATE ROLE service_role NOLOGIN BYPASSRLS;
          CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions; CREATE SCHEMA net;
          CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
            SELECT nullif(current_setting('qa.actor',true),'')::uuid $$;
          CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('role',true) $$;
          CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
          CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
          CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid,metadata jsonb);
          CREATE TABLE storage.buckets(id text PRIMARY KEY,name text NOT NULL,public boolean NOT NULL DEFAULT false,file_size_limit bigint,allowed_mime_types text[]);
          ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
          GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon,service_role;
          GRANT ALL ON storage.objects TO authenticated,service_role;
          CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $stub1$ SELECT string_to_array($1,'/') $stub1$;
          CREATE FUNCTION storage.filename(text) RETURNS text LANGUAGE sql IMMUTABLE AS $stub2$ SELECT split_part($1,'/',array_length(string_to_array($1,'/'),1)) $stub2$;
          CREATE PUBLICATION supabase_realtime;
          CREATE TABLE public.qa_http_requests(url text,body jsonb,headers jsonb,timeout_ms integer);
          CREATE FUNCTION net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE plpgsql AS $$
            BEGIN INSERT INTO public.qa_http_requests VALUES(url,body,headers,timeout_milliseconds); RETURN 1; END $$;
        """)
        for path in sorted((ROOT / "supabase/migrations").glob("*.sql")):
            c.execute(path.read_text())
        for path in sorted((ROOT / "drizzle/migrations").glob("*.sql")):
            sql = path.read_text()
            if path.name == "0033_web_push.sql":
                marker = "CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;"
                assert sql.count(marker) == 1
                sql = sql.replace(marker, "-- pg_net is the explicit QA HTTP spy above.")
            c.execute(sql)
        print("PASS complete foundation + migration replay through 0040 (pg_net transport is a spy)")
        c.execute("INSERT INTO companies(id,name) VALUES(%s,'QA A'),(%s,'QA B')", (A, B))
        for uid, company, role, active in [
            (PURCHASER, A, "purchase_manager", True), (DIRECTOR, A, "director", True),
            (OTHER_DIRECTOR, B, "director", True), (UNASSIGNED, A, "director", True),
            (INACTIVE, A, "director", False), (SITE, A, "site_engineer", True),
            (ACCOUNTS, A, "accounts_manager", True), (ADMIN, A, "super_admin", True),
        ]:
            c.execute("INSERT INTO profiles(id,company_id,full_name,email,is_active) VALUES(%s,%s,%s,%s,%s)",
                      (uid, company, "QA " + role, uid + "@example.invalid", active))
            c.execute("INSERT INTO user_roles(user_id,role) VALUES(%s,%s::app_role)", (uid, role))
            c.execute("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(%s,%s,now())", (uid, uid + "@example.invalid"))
        c.execute("INSERT INTO projects(id,company_id,code,name) VALUES(%s,%s,'QA-A','QA A'),(%s,%s,'QA-B','QA B')", (PROJECT,A,OTHER_PROJECT,B))
        # A restricted director has approval permission but no all-project access.
        c.execute("DELETE FROM role_permissions WHERE role='director' AND permission_code='projects.view_all'")
        for uid in (PURCHASER, DIRECTOR, INACTIVE, SITE, ACCOUNTS):
            c.execute("INSERT INTO user_project_assignments(user_id,project_id) VALUES(%s,%s)", (uid, PROJECT))
        c.execute("INSERT INTO user_project_assignments(user_id,project_id) VALUES(%s,%s)", (OTHER_DIRECTOR, OTHER_PROJECT))
        c.execute("INSERT INTO units_of_measure(id,company_id,code,name) VALUES(%s,%s,'NOS','Number')", (UNIT,A))
        category=c.execute("INSERT INTO item_categories(company_id,code,name) VALUES(%s,'QA-CAT','QA category') RETURNING id",(A,)).fetchone()[0]
        c.execute("INSERT INTO items(id,company_id,code,name,unit_id,category_id) VALUES(%s,%s,'QA-M','QA material',%s,%s)", (MATERIAL,A,UNIT,category))
        c.execute("INSERT INTO vendors(id,company_id,code,company_name) VALUES(%s,%s,'QA-V','QA vendor'),(%s,%s,'QA-F','Foreign vendor')", (VENDOR,A,FOREIGN_VENDOR,B))
        c.execute("INSERT INTO warehouses(id,company_id,code,name,project_id,warehouse_type) VALUES(%s,%s,'QA-W','QA store',%s,'project')", (WAREHOUSE,A,PROJECT))
        c.execute("INSERT INTO accounts(company_id,code,name,account_type) VALUES(%s,'1100','QA Bank','asset'),(%s,'1500','QA advance','asset')",(A,A))


def save_pr(c, token=None, doc=None, version=None, lines=None, submit=False, purpose="QA purpose"):
    header = {"project_id": PROJECT,"required_by":"2026-12-01","purpose":purpose}
    if lines is None:
        lines = [{"material_id":MATERIAL,"unit_id":UNIT,"quantity":2}]
    return str(c.execute("SELECT save_purchase_request(%s,%s,%s::jsonb,%s::jsonb,%s,%s)",
        (token or str(uuid4()),doc,json.dumps(header),json.dumps(lines),submit,version)).fetchone()[0])




def test_private_procurement_attachment_access():
    """PDF/JPG evidence is private until linked; reviewers see only their company/project."""
    with db() as c:
        project_file = f"{A}/{SITE}/{uuid4()}.pdf"
        quote_file = f"{A}/{PURCHASER}/{uuid4()}.jpg"
        wrong_file = f"{B}/{OTHER_DIRECTOR}/{uuid4()}.pdf"

        actor(c, SITE)
        pr = save_pr(c, submit=False)
        assert c.execute(
            "SELECT has_permission(auth.uid(),'purchase_request.create')"
        ).fetchone()[0] is True
        c.execute("INSERT INTO storage.objects(bucket_id,name) VALUES('procurement-attachments',%s)",(project_file,))
        denied(c, lambda: c.execute("INSERT INTO storage.objects(bucket_id,name) VALUES('procurement-attachments',%s)",(wrong_file,)))
        denied(c, lambda: c.execute(
            "SELECT set_purchase_request_attachment(%s,%s)",(pr,wrong_file)), "Upload"
        )
        c.execute("SELECT set_purchase_request_attachment(%s,%s)",(pr,project_file))
        assert c.execute("SELECT can_read_procurement_attachment(%s)",(project_file,)).fetchone()[0]
        assert c.execute(
            "SELECT count(*) FROM storage.objects WHERE name=%s",(project_file,)
        ).fetchone()[0] == 1

        actor(c, DIRECTOR)
        assert c.execute("SELECT can_read_procurement_attachment(%s)",(project_file,)).fetchone()[0]
        assert c.execute("SELECT count(*) FROM storage.objects WHERE name=%s",(project_file,)).fetchone()[0] == 1
        denied(c, lambda: c.execute(
            "SELECT set_purchase_request_attachment(%s,%s)",(pr,project_file))
        )

        actor(c, OTHER_DIRECTOR)
        assert c.execute("SELECT can_read_procurement_attachment(%s)",(project_file,)).fetchone()[0] is False
        assert c.execute("SELECT count(*) FROM storage.objects WHERE name=%s",(project_file,)).fetchone()[0] == 0

        actor(c, PURCHASER)
        c.execute("INSERT INTO storage.objects(bucket_id,name) VALUES('procurement-attachments',%s)",(quote_file,))
        assert c.execute("SELECT procurement_attachment_owned(%s,%s,%s)",(quote_file,A,PURCHASER)).fetchone()[0]
        assert c.execute("SELECT procurement_attachment_owned(%s,%s,%s)",(quote_file,A,SITE)).fetchone()[0] is False

        actor(c, SITE)
        denied(c, lambda: c.execute(
            "SELECT set_purchase_request_attachment(%s,%s)",(pr,quote_file)
        ), "Upload")

        actor(c, DIRECTOR)
        assert c.execute("SELECT can_read_procurement_attachment(%s)",(quote_file,)).fetchone()[0] is False, "Unlinked quote must be private"
        c.rollback()
    print("PASS private procurement file upload, project viewer, foreign tenant and document ownership")



def test_site_engineer_requires_project_assignment_for_pr():
    """A Site Engineer sees a project only after an authorized admin assigns it."""
    with db() as c:
        actor(c, ADMIN)
        deleted = c.execute("""
            DELETE FROM user_project_assignments
            WHERE user_id=%s AND project_id=%s
            RETURNING project_id
        """, (SITE, PROJECT)).fetchone()
        assert deleted is not None, "Expected fixture project assignment"

        actor(c, SITE)
        assert c.execute(
            "SELECT has_permission(auth.uid(),'purchase_request.create')"
        ).fetchone()[0] is True
        assert c.execute(
            "SELECT can_access_project(auth.uid(),%s::uuid)", (PROJECT,)
        ).fetchone()[0] is False
        assert c.execute(
            "SELECT count(*) FROM projects WHERE id=%s", (PROJECT,)
        ).fetchone()[0] == 0, "Unassigned project must be hidden by RLS"
        denied(c, lambda: save_pr(c), "Project is not accessible")

        actor(c, ADMIN)
        c.execute("""
            INSERT INTO user_project_assignments(user_id,project_id)
            VALUES(%s,%s)
        """, (SITE, PROJECT))

        actor(c, SITE)
        assert c.execute(
            "SELECT can_access_project(auth.uid(),%s::uuid)", (PROJECT,)
        ).fetchone()[0] is True
        assert c.execute(
            "SELECT count(*) FROM projects WHERE id=%s", (PROJECT,)
        ).fetchone()[0] == 1, "Assigned project should appear in the PR dropdown"
        assert save_pr(c), "Site Engineer should create a PR for assigned project"

        # Role alone must not permit self-assigning a cross-company project.
        denied(c, lambda: c.execute("""
            INSERT INTO user_project_assignments(user_id,project_id)
            VALUES(%s,%s)
        """, (SITE, OTHER_PROJECT)))
        c.rollback()
    print("PASS Site Engineer project assignment enables PR without widening RLS")



def test_quote_freight_gst_matches_supplier_and_po():
    """Invoice-style GST on freight must survive quotation, header edits, and PO creation."""
    with db() as c:
        actor(c, PURCHASER)
        lines = [
            {"material_id": MATERIAL, "unit_id": UNIT, "quantity": 20},
            {"material_id": MATERIAL, "unit_id": UNIT, "quantity": 8},
        ]
        request_id = save_pr(c, lines=lines, submit=True)
        actor(c, DIRECTOR)
        c.execute("SELECT pr_transition(%s,'approved','QA approved')", (request_id,))
        actor(c, PURCHASER)
        rfq = c.execute("""
            SELECT create_rfq_draft(%s,%s,%s::jsonb,%s::uuid[])
        """, (
            str(uuid4()), request_id,
            json.dumps({"response_due_date":"2026-12-01"}), [VENDOR]
        )).fetchone()[0]
        item_ids = [r[0] for r in c.execute(
            "SELECT id FROM rfq_items WHERE rfq_id=%s ORDER BY line_no", (rfq,)
        ).fetchall()]
        assert len(item_ids) == 2
        c.execute("SELECT rfq_transition(%s,'send','QA sent')", (rfq,))
        rfq_vendor_id = c.execute(
            "SELECT id FROM rfq_vendors WHERE rfq_id=%s", (rfq,)
        ).fetchone()[0]
        quote = c.execute("""
            INSERT INTO vendor_quotations(
              rfq_id,rfq_vendor_id,vendor_id,quotation_number,freight,
              freight_tax_type,freight_tax_rate_percent,created_by
            ) VALUES(%s,%s,%s,'QA-AXNOY-18NOV',3500,'cgst_sgst',18,%s)
            RETURNING id
        """, (rfq,rfq_vendor_id,VENDOR,PURCHASER)).fetchone()[0]
        line_ids = []
        for rfq_item_id,qty,rate in [
            (item_ids[0],20,1300),(item_ids[1],8,475)
        ]:
            line_ids.append(c.execute("""
                INSERT INTO vendor_quotation_items(
                    quotation_id,rfq_item_id,quoted_quantity,rate,
                    tax_type,tax_rate_percent
                ) VALUES(%s,%s,%s,%s,'cgst_sgst',18) RETURNING id
            """, (quote,rfq_item_id,qty,rate)).fetchone()[0])

        values = c.execute("""
            SELECT subtotal,discount_total,tax_total,freight,
                   freight_tax_amount,other_charges_tax_amount,grand_total
            FROM vendor_quotations WHERE id=%s
        """, (quote,)).fetchone()
        assert tuple(map(float,values)) == (29800,0,5994,3500,630,0,39294), values

        # Changing only the charge/tax header must recalculate totals too.
        c.execute("""
            UPDATE vendor_quotations SET freight=4000,
                other_charges=100,other_charges_tax_type='igst',
                other_charges_tax_rate_percent=12 WHERE id=%s
        """, (quote,))
        changed = c.execute("""
            SELECT freight_tax_amount,other_charges_tax_amount,tax_total,grand_total
            FROM vendor_quotations WHERE id=%s
        """, (quote,)).fetchone()
        assert tuple(map(float,changed)) == (720,12,6096,39996), changed

        # Reset to the quoted value before awarding and creating the PO.
        c.execute("""
            UPDATE vendor_quotations SET freight=3500,other_charges=0,
                other_charges_tax_type='none',other_charges_tax_rate_percent=0
            WHERE id=%s
        """, (quote,))
        assert float(c.execute(
            "SELECT grand_total FROM vendor_quotations WHERE id=%s", (quote,)
        ).fetchone()[0]) == 39294

        actor(c, PURCHASER)
        selections = [
            {"rfq_item_id": str(rfq_item), "quotation_item_id": str(quote_item)}
            for rfq_item,quote_item in zip(item_ids,line_ids)
        ]
        assert c.execute(
            "SELECT record_vendor_selection(%s,%s::jsonb,%s)",
            (rfq,json.dumps(selections),"Supplier quote matches landed delivery")
        ).fetchone()[0] == 2
        po = c.execute(
            "SELECT create_po_from_selection(%s,%s)", (rfq,quote)
        ).fetchone()[0]
        po_values = c.execute("""
            SELECT subtotal,tax_total,freight,freight_tax_amount,
                   freight_tax_type,freight_tax_rate_percent,grand_total
            FROM purchase_orders WHERE id=%s
        """, (po,)).fetchone()
        assert tuple(map(float,(po_values[0],po_values[1],po_values[2],po_values[3],po_values[5],po_values[6]))) == (
            29800,5994,3500,630,18,39294
        ), po_values
        assert po_values[4] == 'cgst_sgst', po_values
        assert float(c.execute(
            "SELECT sum(tax_amount) FROM purchase_order_items WHERE po_id=%s", (po,)
        ).fetchone()[0]) == 5364
        c.rollback()
    print("PASS Axnoy quotation GST on freight 39294, header updates, and PO tax sync")



def test_atomic_requests_and_rfqs():
    with db() as c:
        actor(c, PURCHASER)
        token = str(uuid4())
        doc = save_pr(c, token)
        assert save_pr(c, token) == doc
        assert c.execute("SELECT count(*) FROM purchase_requests WHERE id=%s", (doc,)).fetchone()[0] == 1
        denied(c, lambda: save_pr(c,token,purpose="changed"), "different content")
        version = c.execute("SELECT updated_at FROM purchase_requests WHERE id=%s", (doc,)).fetchone()[0]
        denied(c, lambda: save_pr(c,doc=doc,version=version,lines=[{"material_id":MATERIAL,"unit_id":UNIT,"quantity":-1}]), "positive finite")
        assert c.execute("SELECT quantity FROM purchase_request_items WHERE purchase_request_id=%s", (doc,)).fetchone()[0] == 2
        denied(c, lambda: save_pr(c,doc=doc,version="2000-01-01T00:00:00Z"), "changed since")
        denied(c, lambda: save_pr(c,submit=True,lines=[]), "Add at least one")
        assert c.execute("SELECT count(*) FROM purchase_requests").fetchone()[0] == 1
        submitted = save_pr(c,submit=True)
        c.execute("RESET ROLE")
        c.execute("SELECT set_config('qa.actor',%s,true)", (DIRECTOR,))
        c.execute("SELECT pr_transition(%s,'approved','QA approved')", (submitted,))
        actor(c,PURCHASER)
        rfq_token=str(uuid4())
        def rfq(vendors):
            return str(c.execute("SELECT create_rfq_draft(%s,%s,%s::jsonb,%s::uuid[])",
                (rfq_token,submitted,json.dumps({"response_due_date":"2026-12-01"}),vendors)).fetchone()[0])
        denied(c,lambda:rfq([VENDOR,FOREIGN_VENDOR]),"in this company")
        assert c.execute("SELECT count(*) FROM rfqs").fetchone()[0] == 0
        rid=rfq([VENDOR]); assert rfq([VENDOR]) == rid
        assert c.execute("SELECT count(*) FROM rfq_items WHERE rfq_id=%s",(rid,)).fetchone()[0] == 1
        assert c.execute("SELECT count(*) FROM rfq_vendors WHERE rfq_id=%s",(rid,)).fetchone()[0] == 1
        c.rollback()
    with db() as c:
        actor(c,OTHER_DIRECTOR)
        denied(c,lambda:save_pr(c),"Project is not accessible")
        c.rollback()
    print("PASS atomic draft saves, stale edits, retry tokens, failed-submit rollback and RFQ vendor scope")


def seed_po(c, creator=PURCHASER, requester=PURCHASER):
    actor(c,requester)
    request_id=save_pr(c,submit=True)
    actor(c,DIRECTOR)
    c.execute("SELECT pr_transition(%s,'approved','QA')",(request_id,))
    actor(c,PURCHASER)
    rfq_id=str(c.execute("SELECT create_rfq_draft(%s,%s,%s::jsonb,%s::uuid[])",
        (str(uuid4()),request_id,json.dumps({"response_due_date":"2026-12-01"}),[VENDOR])).fetchone()[0])
    c.execute("SELECT rfq_transition(%s,'send','QA')",(rfq_id,))
    c.execute("RESET ROLE")
    invitation=c.execute("SELECT id FROM rfq_vendors WHERE rfq_id=%s",(rfq_id,)).fetchone()[0]
    quotation=c.execute("""INSERT INTO vendor_quotations(rfq_id,rfq_vendor_id,vendor_id,quotation_number,created_by)
        VALUES(%s,%s,%s,'QA-QUOTE',%s) RETURNING id""",(rfq_id,invitation,VENDOR,PURCHASER)).fetchone()[0]
    # Only PO fixture construction bypasses the creation UI; its real FKs remain intact.
    c.execute("SELECT set_config('qa.actor',%s,true)",(creator,))
    return str(c.execute("""INSERT INTO purchase_orders(company_id,vendor_id,project_id,delivery_warehouse_id,created_by,
        po_number,rfq_id,quotation_id,purchase_request_id)
      VALUES(%s,%s,%s,%s,%s,'QA-'||gen_random_uuid()::text,%s,%s,%s) RETURNING id""",
        (A,VENDOR,PROJECT,WAREHOUSE,creator,rfq_id,quotation,request_id)).fetchone()[0])



def test_engineer_assigned_project_pr_po_visibility():
    """Assigned project membership grants PR/PO read, independent of creator.
    Revoking it immediately blocks both tables and PO detail access.
    """
    with db() as c:
        po_id = seed_po(c, creator=PURCHASER, requester=PURCHASER)
        c.execute("RESET ROLE")
        pr_id = c.execute(
            "SELECT purchase_request_id FROM purchase_orders WHERE id=%s",
            (po_id,),
        ).fetchone()[0]

        actor(c, SITE)
        assert c.execute(
            "SELECT count(*) FROM purchase_requests WHERE id=%s", (pr_id,)
        ).fetchone()[0] == 1, "Site Engineer should see another requester's PR in assigned project"
        assert c.execute(
            "SELECT count(*) FROM purchase_orders WHERE id=%s", (po_id,)
        ).fetchone()[0] == 1, "Site Engineer should see a Purchase Manager's PO in assigned project"
        assert c.execute(
            "SELECT po_can_view(%s::uuid)", (po_id,)
        ).fetchone()[0], "PO detail must be visible for assigned project"
        assert not c.execute(
            "SELECT has_permission(auth.uid(),'projects.view_all')"
        ).fetchone()[0], "Site Engineer must not gain global project access"

        c.execute("RESET ROLE")
        c.execute(
            "DELETE FROM user_project_assignments WHERE user_id=%s AND project_id=%s",
            (SITE, PROJECT),
        )
        actor(c, SITE)
        assert c.execute(
            "SELECT count(*) FROM purchase_requests WHERE id=%s", (pr_id,)
        ).fetchone()[0] == 0, "Removed assignment must hide the PR"
        assert c.execute(
            "SELECT count(*) FROM purchase_orders WHERE id=%s", (po_id,)
        ).fetchone()[0] == 0, "Removed assignment must hide the PO"
        assert not c.execute(
            "SELECT po_can_view(%s::uuid)", (po_id,)
        ).fetchone()[0], "Revocation must block direct PO details"

        for reviewer in (ACCOUNTS, DIRECTOR, ADMIN):
            actor(c, reviewer)
            assert c.execute(
                "SELECT count(*) FROM purchase_requests WHERE id=%s", (pr_id,)
            ).fetchone()[0] == 1
            assert c.execute(
                "SELECT count(*) FROM purchase_orders WHERE id=%s", (po_id,)
            ).fetchone()[0] == 1
        c.rollback()
    print("PASS assigned-project PR/PO visibility, creator independence, revocation and manager rights")


def test_pr_manager_received_notification():
    """A requester's notification is receipt, not Director PO approval."""
    with db() as c:
        actor(c,SITE)
        pr=save_pr(c,submit=True,purpose="QA - manager receipt notification")
        actor(c,PURCHASER)
        assert c.execute("SELECT has_role(auth.uid(),'purchase_manager')").fetchone()[0]
        assert c.execute("SELECT pr_transition(%s,'approved','Received by purchasing')",(pr,)).fetchone()[0]=='approved'
        c.execute("RESET ROLE")
        pr_number=c.execute("SELECT pr_number FROM purchase_requests WHERE id=%s",(pr,)).fetchone()[0]
        message=c.execute(
          "SELECT title FROM notifications WHERE user_id=%s AND link=%s ORDER BY created_at DESC LIMIT 1",
          (SITE,"/procurement/purchase-requests/"+pr)).fetchone()
        assert message and message[0]==f"Purchase Manager received your request • {pr_number}",message
        # Receipt of a PR does not approve any PO or create Director votes.
        assert c.execute("SELECT count(*) FROM purchase_orders WHERE purchase_request_id=%s",(pr,)).fetchone()[0]==0
        assert c.execute("SELECT count(*) FROM director_approval_votes").fetchone()[0]==0

        actor(c,DIRECTOR)
        director_pr=save_pr(c,submit=True,purpose="QA - director-origin PR fallback")
        c.execute("RESET ROLE")
        director_title=c.execute(
          "SELECT title FROM notifications WHERE user_id=%s AND link=%s ORDER BY created_at DESC LIMIT 1",
          (DIRECTOR,"/procurement/purchase-requests/"+director_pr)).fetchone()
        assert director_title and director_title[0].startswith(
          "Your purchase request was accepted for procurement • "),director_title
        assert "Purchase Manager" not in director_title[0]
        c.rollback()
    print("PASS PR receipt notifications distinguish Purchase Manager actions from Director-origin requests")


def test_director_notifications_and_names():
    with db() as c:
        # The original Site Engineer created the PR; a Purchase Manager
        # prepared the PO. Director notifications MUST identify the Engineer,
        # never silently substitute the preparer's name.
        doc=seed_po(c,requester=SITE)
        actor(c,PURCHASER)
        c.execute("SELECT po_transition(%s,'submitted','QA')",(doc,))
        denied(c,lambda:c.execute("SELECT * FROM po_notification_context(%s)",(doc,)),"permission denied")
        c.execute("RESET ROLE")
        recipients=c.execute(
            "SELECT user_id,title,body,link FROM notifications WHERE link LIKE %s",('%'+doc,)
        ).fetchall()
        assert {str(r[0]) for r in recipients}=={DIRECTOR},recipients
        assert all('kind=purchase_order&id=' in r[3] for r in recipients)
        assert all('QA site_engineer' in r[1] and 'QA A' in r[1] for r in recipients),recipients
        assert all('Requested by QA site_engineer for QA A' in r[2] for r in recipients),recipients
        assert all('QA purchase_manager' not in r[1]+r[2] for r in recipients),recipients
        po_number=c.execute('SELECT po_number FROM purchase_orders WHERE id=%s',(doc,)).fetchone()[0]
        assert all('₹' in r[2] and po_number in r[2] for r in recipients),recipients
        actor(c,PURCHASER)
        c.execute("SELECT remind_po_approvers(%s)",(doc,))
        c.execute("SELECT remind_po_approvers(%s)",(doc,))
        c.execute("RESET ROLE")
        assert c.execute("SELECT count(*) FROM approval_reminder_events WHERE po_id=%s",(doc,)).fetchone()[0]==2
        reminders=c.execute(
          "SELECT title,body FROM notifications WHERE user_id=%s AND title LIKE 'PO reminder %%' AND link LIKE %s",
          (DIRECTOR,'%'+doc)).fetchall()
        assert len(reminders)==2,reminders
        assert all('QA site_engineer' in r[0] and 'QA A' in r[0] for r in reminders),reminders
        assert all('Requested by QA site_engineer for QA A' in r[1] for r in reminders),reminders
        actor(c,DIRECTOR)
        assert c.execute("SELECT po_transition(%s,'approved','QA')",(doc,)).fetchone()[0]=='approved'
        actor(c,PURCHASER)
        names=c.execute("SELECT actor_id,full_name FROM document_actor_names('purchase_order',ARRAY[%s]::uuid[])",(doc,)).fetchall()
        assert {str(r[0]) for r in names}=={PURCHASER,DIRECTOR},names
        assert c.execute("SELECT count(*) FROM profiles").fetchone()[0]==1
        actor(c,OTHER_DIRECTOR)
        assert c.execute("SELECT count(*) FROM document_actor_names('purchase_order',ARRAY[%s]::uuid[])",(doc,)).fetchone()[0]==0
        denied(c,lambda:c.execute("SELECT po_transition(%s,'approved','QA')",(doc,)),"not found")
        actor(c,INACTIVE)
        denied(c,lambda:c.execute("SELECT * FROM document_actor_names('purchase_order',ARRAY[%s]::uuid[])",(doc,)),"Not signed in")
        c.rollback()
    with db() as c:
        doc=seed_po(c,DIRECTOR)
        actor(c,DIRECTOR)
        assert c.execute("SELECT po_transition(%s,'submitted','QA')",(doc,)).fetchone()[0]=='pending_approval'
        assert c.execute("SELECT approved_by FROM purchase_orders WHERE id=%s",(doc,)).fetchone()[0] is None
        assert c.execute("SELECT count(*) FROM director_approval_votes WHERE entity_id=%s",(doc,)).fetchone()[0]==0
        assert c.execute("SELECT count(*) FROM purchase_order_approvals WHERE po_id=%s AND action='approved'",(doc,)).fetchone()[0]==0
        denied(c,lambda:c.execute("SELECT po_transition(%s,'approved','self')",(doc,)),"cannot approve")
        denied(c,lambda:c.execute("SELECT po_transition(%s,'submitted','self finalize')",(doc,)),"Only draft")
        c.rollback()
    print("PASS director notifications show original PR requester and project; reminders and actor-name lookup scoped")



def test_director_approved_po_alerts_original_pr_engineer_phone():
    """A real Director PO approval notifies only the original PR engineer;
    the inbox row also enqueues a push for that engineer's opted-in device.
    """
    with db() as c:
        doc=seed_po(c,requester=SITE)
        actor(c,PURCHASER)
        assert c.execute("SELECT po_transition(%s,'submitted','QA')",(doc,)).fetchone()[0]=='pending_approval'
        c.execute("RESET ROLE")
        pr_number,po_number,project_name,vendor_name=c.execute("""
            SELECT pr.pr_number,po.po_number,project.name,v.company_name
            FROM purchase_orders po
            JOIN purchase_requests pr ON pr.id=po.purchase_request_id
            JOIN projects project ON project.id=po.project_id
            JOIN vendors v ON v.id=po.vendor_id WHERE po.id=%s
        """,(doc,)).fetchone()
        link="/procurement/purchase-orders/"+doc

        # Fake an opted-in engineer device. The disposable QA database has a
        # pg_net spy; no phone traffic actually leaves the test process.
        c.execute("""INSERT INTO push_config(id,vapid_private_jwk,dispatch_secret,dispatch_url)
            VALUES(1,'{}'::jsonb,'QA secret','https://example.invalid/push-dispatch')""")
        c.execute("""INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth)
            VALUES(%s,%s,'QA P256DH','QA AUTH')""",
            (SITE,"https://fcm.googleapis.com/fcm/send/qa-po-"+str(uuid4())))

        # A second engineer assigned to the SAME project is never notified.
        same_project_engineer=str(uuid4())
        c.execute("""INSERT INTO profiles(id,company_id,full_name,email,is_active)
            VALUES(%s,%s,'QA second engineer',%s,true)""",
            (same_project_engineer,A,same_project_engineer+"@example.invalid"))
        c.execute("INSERT INTO user_roles(user_id,role) VALUES(%s,'site_engineer')",(same_project_engineer,))
        c.execute("INSERT INTO user_project_assignments(user_id,project_id) VALUES(%s,%s)",
                  (same_project_engineer,PROJECT))
        c.execute("UPDATE profiles SET full_name='Karim Sir' WHERE id=%s",(DIRECTOR,))
        assert c.execute("SELECT count(*) FROM notifications WHERE user_id=%s AND link=%s",
                         (SITE,link)).fetchone()[0]==0, "Submitting a PO must not claim it was approved"

        actor(c,DIRECTOR)
        assert c.execute("SELECT po_transition(%s,'approved','QA Director approved')",
                         (doc,)).fetchone()[0]=='approved'
        c.execute("RESET ROLE")
        rows=c.execute("""
            SELECT id,user_id,title,body,link FROM notifications
            WHERE user_id=%s AND link=%s ORDER BY created_at DESC
        """,(SITE,link)).fetchall()
        assert len(rows)==1,rows
        n=rows[0]
        assert "Karim Sir approved PO " + po_number == n[2],n
        assert pr_number in n[3] and po_number in n[3],n
        assert project_name in n[3] and vendor_name in n[3],n
        assert n[4]==link
        assert c.execute("SELECT count(*) FROM notifications WHERE user_id=%s AND link=%s",
                         (same_project_engineer,link)).fetchone()[0]==0
        assert c.execute("SELECT count(*) FROM notifications WHERE user_id=%s AND link=%s",
                         (PURCHASER,link)).fetchone()[0]==1, "PO preparer keeps existing approved alert"
        assert c.execute("SELECT count(*) FROM qa_http_requests WHERE body->>'id'=%s",
                         (str(n[0]),)).fetchone()[0]==1, "Push must be queued once for registered engineer"
        actor(c,SITE)
        assert c.execute("SELECT count(*) FROM notifications WHERE id=%s",
                         (n[0],)).fetchone()[0]==1, "Engineer can open own inbox item"
        actor(c,PURCHASER)
        assert c.execute("SELECT count(*) FROM notifications WHERE id=%s",
                         (n[0],)).fetchone()[0]==0, "PO manager cannot see engineer's inbox"
        c.execute("RESET ROLE")
        c.execute("UPDATE purchase_orders SET status=status WHERE id=%s",(doc,))
        assert c.execute("SELECT count(*) FROM notifications WHERE user_id=%s AND link=%s",
                         (SITE,link)).fetchone()[0]==1, "Unchanged PO status must not resend the push"
        c.rollback()

    with db() as c:
        # If a Site Engineer is also the PO creator, use the personalized
        # alert in place of (not in addition to) the generic creator alert.
        doc=seed_po(c,creator=SITE,requester=SITE)
        actor(c,PURCHASER)
        assert c.execute("SELECT po_transition(%s,'submitted','QA')",(doc,)).fetchone()[0]=='pending_approval'
        actor(c,DIRECTOR)
        assert c.execute("SELECT po_transition(%s,'approved','QA')",(doc,)).fetchone()[0]=='approved'
        c.execute("RESET ROLE")
        alerts=c.execute("SELECT title FROM notifications WHERE user_id=%s AND link=%s",
                         (SITE,"/procurement/purchase-orders/"+doc)).fetchall()
        assert len(alerts)==1 and "approved PO" in alerts[0][0],alerts
        c.rollback()

    with db() as c:
        doc=seed_po(c,requester=SITE)
        actor(c,PURCHASER)
        assert c.execute("SELECT po_transition(%s,'submitted','QA')",(doc,)).fetchone()[0]=='pending_approval'
        c.execute("RESET ROLE")
        c.execute("DELETE FROM user_project_assignments WHERE user_id=%s AND project_id=%s",
                  (SITE,PROJECT))
        actor(c,DIRECTOR)
        assert c.execute("SELECT po_transition(%s,'approved','QA')",(doc,)).fetchone()[0]=='approved'
        c.execute("RESET ROLE")
        assert c.execute("SELECT count(*) FROM notifications WHERE user_id=%s AND link=%s",
                         (SITE,"/procurement/purchase-orders/"+doc)).fetchone()[0]==0, \
            "Revoked engineer assignment must block access and alerts"
        c.rollback()
    print("PASS Director approval -> original PR engineer inbox + push, one alert, project revocation")


def test_director_origin_and_super_admin_purchasing():
    with db() as c:
        actor(c,DIRECTOR)
        doc=save_pr(c,submit=True)
        row=c.execute("SELECT status,requested_by,approved_by,approved_at IS NOT NULL FROM purchase_requests WHERE id=%s",(doc,)).fetchone()
        assert row[0]=='approved' and str(row[1])==DIRECTOR and row[1]==row[2] and row[3],row
        assert c.execute("SELECT count(*) FROM purchase_request_approvals WHERE purchase_request_id=%s AND action='approved'",(doc,)).fetchone()[0]==1
        denied(c,lambda:c.execute("SELECT pr_transition(%s,'submitted','again')",(doc,)),"Only draft")
        rid=c.execute("SELECT create_rfq_draft(%s,%s,%s::jsonb,%s::uuid[])",(str(uuid4()),doc,json.dumps({"response_due_date":"2026-12-01"}),[VENDOR])).fetchone()[0]
        c.execute("SELECT rfq_transition(%s,'send','QA')",(rid,))
        invitation=c.execute("SELECT id FROM rfq_vendors WHERE rfq_id=%s",(rid,)).fetchone()[0]
        item=c.execute("SELECT id FROM rfq_items WHERE rfq_id=%s",(rid,)).fetchone()[0]
        quote=c.execute("INSERT INTO vendor_quotations(rfq_id,rfq_vendor_id,vendor_id,quotation_number) VALUES(%s,%s,%s,'QA-DIRECTOR') RETURNING id",(rid,invitation,VENDOR)).fetchone()[0]
        line=c.execute("INSERT INTO vendor_quotation_items(quotation_id,rfq_item_id,quoted_quantity,rate) VALUES(%s,%s,2,100) RETURNING id",(quote,item)).fetchone()[0]
        c.execute("SELECT record_vendor_selection(%s,%s::jsonb,'QA selected supplier')",(rid,json.dumps([{"rfq_item_id":str(item),"quotation_item_id":str(line)}])))
        order=c.execute("SELECT create_po_from_selection(%s,%s)",(rid,quote)).fetchone()[0]
        c.execute("UPDATE purchase_orders SET delivery_warehouse_id=%s WHERE id=%s",(WAREHOUSE,order))
        assert c.execute("SELECT po_transition(%s,'submitted','Director submitted for independent review')",(order,)).fetchone()[0]=='pending_approval'
        source=c.execute("SELECT purchase_request_id,rfq_id,quotation_id,created_by,approved_by FROM purchase_orders WHERE id=%s",(order,)).fetchone()
        assert str(source[0])==doc and source[1]==rid and source[2]==quote and str(source[3])==DIRECTOR and source[4] is None,source
        denied(c,lambda:c.execute("SELECT po_transition(%s,'approved','self')",(order,)),"cannot approve")
        assert c.execute("SELECT count(*) FROM purchase_order_approvals WHERE po_id=%s AND action='approved'",(order,)).fetchone()[0]==0
        assert c.execute("SELECT count(*) FROM purchase_order_items WHERE po_id=%s",(order,)).fetchone()[0]==1
        actor(c,PURCHASER)
        own=save_pr(c,submit=True)
        assert c.execute("SELECT status FROM purchase_requests WHERE id=%s",(own,)).fetchone()[0]=='pending_approval'
        denied(c,lambda:c.execute("SELECT pr_transition(%s,'approved','self')",(own,)),"own request")
        # Grant a second QA actor a distinct Director role to prove a creator
        # can only receive approval from a different authenticated director.
        c.execute("RESET ROLE")
        c.execute("INSERT INTO user_roles(user_id,role) VALUES(%s,'director')",(PURCHASER,))
        actor(c,PURCHASER)
        assert c.execute("SELECT po_transition(%s,'approved','Independent director reviewed')",(order,)).fetchone()[0]=='approved'
        assert str(c.execute("SELECT approved_by FROM purchase_orders WHERE id=%s",(order,)).fetchone()[0])==PURCHASER
        assert c.execute("SELECT count(*) FROM purchase_order_approvals WHERE po_id=%s AND action='approved'",(order,)).fetchone()[0]==1
        c.rollback()
    with db() as c:
        doc=seed_po(c,ADMIN)
        actor(c,ADMIN)
        assert c.execute("SELECT po_transition(%s,'submitted','QA')",(doc,)).fetchone()[0]=='pending_approval'
        denied(c,lambda:c.execute("SELECT po_transition(%s,'approved','self')",(doc,)),"cannot approve")
        actor(c,PURCHASER)
        denied(c,lambda:c.execute("SELECT po_transition(%s,'approved','QA')",(doc,)),"Only an active director")
        actor(c,OTHER_DIRECTOR)
        denied(c,lambda:c.execute("SELECT po_transition(%s,'approved','QA')",(doc,)),"not found")
        actor(c,INACTIVE)
        denied(c,lambda:c.execute("SELECT po_transition(%s,'submitted','QA')",(doc,)),"Not signed in")
        actor(c,DIRECTOR)
        assert c.execute("SELECT po_transition(%s,'approved','QA')",(doc,)).fetchone()[0]=='approved'
        assert str(c.execute("SELECT approved_by FROM purchase_orders WHERE id=%s",(doc,)).fetchone()[0])==DIRECTOR
        c.rollback()
    with db() as c:
        doc=seed_po(c,ADMIN)
        c.execute("RESET ROLE")
        c.execute("INSERT INTO user_roles(user_id,role) VALUES(%s,'director')",(ADMIN,))
        actor(c,ADMIN)
        assert c.execute("SELECT po_transition(%s,'submitted','QA')",(doc,)).fetchone()[0]=='pending_approval'
        denied(c,lambda:c.execute("SELECT po_transition(%s,'approved','self')",(doc,)),"cannot approve")
        c.rollback()
    with db() as c:
        doc=seed_po(c,DIRECTOR)
        actor(c,ADMIN)
        assert c.execute("SELECT po_transition(%s,'submitted','QA')",(doc,)).fetchone()[0]=='pending_approval'
        actor(c,DIRECTOR)
        denied(c,lambda:c.execute("SELECT po_transition(%s,'submitted','Finalize my existing order')",(doc,)),"Only draft")
        denied(c,lambda:c.execute("SELECT po_transition(%s,'approved','self')",(doc,)),"cannot approve")
        c.rollback()
    print("PASS director-created POs need independent approval; no self-finalize shortcut; audit history retained")

def test_push_and_email_boundaries():
    with db() as c:
        actor(c,PURCHASER)
        endpoint='https://fcm.googleapis.com/fcm/send/qa-token'
        key='A'*87; auth='A'*22
        c.execute("SELECT register_my_push_subscription(%s,%s,%s)",(endpoint,key,auth))
        c.execute("SELECT register_my_push_subscription(%s,%s,%s)",(endpoint,key,auth))
        assert c.execute("SELECT count(*) FROM push_subscriptions").fetchone()[0]==1
        denied(c,lambda:c.execute("SELECT register_my_push_subscription('https://127.0.0.1/a',%s,%s)",(key,auth)),"Invalid push")
        denied(c,lambda:c.execute("INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth) VALUES(%s,'https://example.invalid','x','y')",(PURCHASER,)))
        actor(c,DIRECTOR)
        denied(c,lambda:c.execute("SELECT register_my_push_subscription(%s,%s,%s)",(endpoint,key,auth)),"another account")
        actor(c,INACTIVE)
        denied(c,lambda:c.execute("SELECT register_my_push_subscription(%s,%s,%s)",(endpoint,key,auth)),"Not signed in")
        actor(c,PURCHASER)
        for n in range(9):
            c.execute("SELECT register_my_push_subscription(%s,%s,%s)",(endpoint+str(n),key,auth))
        denied(c,lambda:c.execute("SELECT register_my_push_subscription(%s,%s,%s)",(endpoint+'over-quota',key,auth)),"10 alert devices")
        c.execute("RESET ROLE")
        c.execute("INSERT INTO push_config(id,vapid_private_jwk,dispatch_secret,dispatch_url) VALUES(1,'{}','qa-only','https://example.invalid/dispatch')")
        c.execute("INSERT INTO notifications(user_id,title) VALUES(%s,'QA phone test')",(PURCHASER,))
        assert c.execute("SELECT timeout_ms FROM qa_http_requests ORDER BY timeout_ms DESC LIMIT 1").fetchone()[0]==15000
        assert not c.execute("SELECT has_table_privilege('authenticated','push_subscriptions','UPDATE')").fetchone()[0]
        claimed=c.execute("UPDATE push_subscriptions SET last_test_at=now() WHERE user_id=%s AND endpoint=%s AND (last_test_at IS NULL OR last_test_at<now()-interval '30 seconds') RETURNING id",(PURCHASER,endpoint)).fetchall()
        repeated=c.execute("UPDATE push_subscriptions SET last_test_at=now() WHERE user_id=%s AND endpoint=%s AND (last_test_at IS NULL OR last_test_at<now()-interval '30 seconds') RETURNING id",(PURCHASER,endpoint)).fetchall()
        assert len(claimed)==1 and len(repeated)==0
        c.execute("UPDATE auth.users SET email='pending@example.invalid',email_confirmed_at=NULL WHERE id=%s",(PURCHASER,))
        assert c.execute("SELECT email FROM profiles WHERE id=%s",(PURCHASER,)).fetchone()[0]!='pending@example.invalid'
        c.execute("UPDATE auth.users SET email_confirmed_at=now() WHERE id=%s",(PURCHASER,))
        assert c.execute("SELECT email FROM profiles WHERE id=%s",(PURCHASER,)).fetchone()[0]=='pending@example.invalid'
        for function in ["public.notify_document_approvers(text,uuid,uuid,uuid,text,text,text)","public.register_director_vote(text,uuid,text,text)"]:
            assert not c.execute("SELECT has_function_privilege('authenticated',%s,'EXECUTE')",(function,)).fetchone()[0]
        c.execute("SET LOCAL ROLE anon")
        denied(c,lambda:c.execute("SELECT document_actor_names('purchase_order',ARRAY[]::uuid[])"))
        c.rollback()
    print("PASS push registration ownership, active-user and host boundaries; verified Auth email synchronization")


def test_concurrent_save_retries():
    token=str(uuid4())
    first=db(); actor(first,PURCHASER)
    doc=save_pr(first,token)
    def retry():
        with db() as second:
            second.execute("SET application_name='hardening-concurrent-retry'")
            second.execute("SET LOCAL lock_timeout='4s'")
            actor(second,PURCHASER)
            return save_pr(second,token)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future=pool.submit(retry)
        try:
            with db() as observer:
                waiting=False
                for _ in range(60):
                    if observer.execute("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='hardening-concurrent-retry' AND wait_event_type='Lock')").fetchone()[0]:
                        waiting=True;break
                    time.sleep(0.02)
                assert waiting,"Concurrent retry did not wait for the first save"
            first.commit()
        finally:
            first.rollback(); first.close()
        assert future.result(timeout=5)==doc
    with db() as c:
        assert c.execute("SELECT count(*) FROM procurement_save_receipts WHERE request_id=%s",(token,)).fetchone()[0]==1
        assert c.execute("SELECT count(*) FROM purchase_request_items WHERE purchase_request_id=%s",(doc,)).fetchone()[0]==1
    print("PASS two simultaneous save attempts produce one document and one receipt")


def test_real_payment_posting():
    with db() as c:
        c.execute("UPDATE profiles SET is_active=false WHERE id=%s",(UNASSIGNED,))
        actor(c,ACCOUNTS)
        header={"kind":"advance","vendor_id":VENDOR,"project_id":PROJECT,"amount":123.45,"payment_date":"2026-10-16","payment_mode":"neft","remarks":"QA advance"}
        doc=str(c.execute("SELECT schedule_vendor_payment(%s::jsonb,'[]'::jsonb)",(json.dumps(header),)).fetchone()[0])
        assert c.execute("SELECT count(*) FROM journal_entries WHERE source_id=%s",(doc,)).fetchone()[0]==0
        actor(c,OTHER_DIRECTOR)
        denied(c,lambda:c.execute("SELECT payment_transition(%s,'approve','','{}')",(doc,)),"not accessible")
        actor(c,DIRECTOR)
        assert c.execute("SELECT payment_transition(%s,'approve','QA approval','{}')",(doc,)).fetchone()[0]=='approved'
        assert c.execute("SELECT count(*) FROM journal_entries WHERE source_id=%s",(doc,)).fetchone()[0]==0
        actor(c,ACCOUNTS)
        names=c.execute("SELECT actor_id FROM document_actor_names('vendor_payment',ARRAY[%s]::uuid[])",(doc,)).fetchall()
        assert {str(r[0]) for r in names}=={ACCOUNTS,DIRECTOR}
        denied(c,lambda:c.execute("SELECT payment_transition(%s,'record','','{}')",(doc,)),"reference")
        assert c.execute("SELECT payment_transition(%s,'record','',%s::jsonb)",(doc,json.dumps({"reference":"QA-BANK-REF"}))).fetchone()[0]=='recorded'
        denied(c,lambda:c.execute("SELECT payment_transition(%s,'record','',%s::jsonb)",(doc,json.dumps({"reference":"QA-BANK-REF"}))),"Only approved")
        lines=c.execute("SELECT sum(l.debit),sum(l.credit),count(*) FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE e.source_id=%s",(doc,)).fetchone()
        assert str(lines[0])=='123.45' and lines[0]==lines[1] and lines[2]==2,lines
        c.rollback()
    print("PASS real scheduled → one-director approval → recorded payment posts one balanced journal; duplicate recording refused")


def test_super_admin_record_cleanup():
    # Every change below is disposable; no production records or network transport.
    with db() as c:
        unused=c.execute("INSERT INTO vendors(company_id,code,company_name) VALUES(%s,'QA-DELETE','Unused supplier') RETURNING id",(A,)).fetchone()[0]
        for uid in [PURCHASER,DIRECTOR,INACTIVE]:
            actor(c,uid)
            denied(c,lambda:c.execute("SELECT super_admin_delete_record('vendor',%s)",(unused,)),"active Super Admin")
        actor(c,ADMIN)
        denied(c,lambda:c.execute("SELECT super_admin_delete_record('vendor',%s)",(FOREIGN_VENDOR,)),"own company")
        denied(c,lambda:c.execute("SELECT super_admin_delete_record('user',%s)",(ADMIN,)),"cannot be deleted")
        denied(c,lambda:c.execute("SELECT super_admin_delete_record('journal_entries',%s)",(unused,)),"Unsupported")
        count=c.execute("SELECT count(*) FROM audit_logs WHERE action='permanently_deleted'").fetchone()[0]
        c.execute("SELECT super_admin_delete_record('vendor',%s,true)",(unused,))
        assert c.execute("SELECT count(*) FROM vendors WHERE id=%s",(unused,)).fetchone()[0]==1
        assert c.execute("SELECT count(*) FROM audit_logs WHERE action='permanently_deleted'").fetchone()[0]==count
        c.execute("SELECT super_admin_delete_record('vendor',%s)",(unused,))
        assert not c.execute("SELECT 1 FROM vendors WHERE id=%s",(unused,)).fetchone()
        audit=c.execute("SELECT user_id,old_data->>'company_name' FROM audit_logs WHERE action='permanently_deleted' AND entity_id=%s",(str(unused),)).fetchone()
        assert str(audit[0])==ADMIN and audit[1]=='Unused supplier'
        denied(c,lambda:c.execute("SELECT super_admin_delete_record('vendor',%s)",(unused,)),"already deleted")
        denied(c,lambda:c.execute("UPDATE audit_logs SET reason='tampered' WHERE entity_id=%s",(str(unused),)))
        c.rollback()
    with db() as c:
        # Building/floor company is derived through the project, never supplied by the caller.
        building=c.execute("INSERT INTO buildings(project_id,code,name,planned_floors) VALUES(%s,'DEL','Unused building',0) RETURNING id",(PROJECT,)).fetchone()[0]
        foreign=c.execute("INSERT INTO buildings(project_id,code,name) VALUES(%s,'FOR','Foreign building') RETURNING id",(OTHER_PROJECT,)).fetchone()[0]
        floor=c.execute("SELECT id FROM floors WHERE building_id=%s LIMIT 1",(building,)).fetchone()[0]
        unit=c.execute("INSERT INTO units(project_id,building_id,floor_id,unit_number,unit_type,carpet_area,built_up_area,saleable_area,base_rate) VALUES(%s,%s,%s,'QA-101','other',100,100,100,100) RETURNING id",(PROJECT,building,floor)).fetchone()[0]
        actor(c,ADMIN)
        denied(c,lambda:c.execute("SELECT super_admin_delete_record('building',%s)",(foreign,)),"own company")
        denied(c,lambda:c.execute("SELECT super_admin_delete_record('building',%s)",(building,)),"Linked floors")
        denied(c,lambda:c.execute("SELECT super_admin_delete_record('floor',%s)",(floor,)),"Linked units")
        c.execute("SELECT super_admin_delete_record('unit',%s)",(unit,))
        assert c.execute("SELECT jsonb_array_length(old_data->'deleted_draft_lines'->'unit_status_history') FROM audit_logs WHERE action='permanently_deleted' AND entity_id=%s",(str(unit),)).fetchone()[0]==1
        c.execute("SELECT super_admin_delete_record('floor',%s)",(floor,))
        c.execute("SELECT super_admin_delete_record('building',%s)",(building,))
        c.rollback()
    with db() as c:
        actor(c,PURCHASER)
        token=str(uuid4()); request=save_pr(c,token)
        line=c.execute("SELECT id FROM purchase_request_items WHERE purchase_request_id=%s",(request,)).fetchone()[0]
        actor(c,ADMIN)
        c.execute("SELECT super_admin_delete_record('purchase_request',%s,true)",(request,))
        c.execute("SELECT super_admin_delete_record('purchase_request',%s)",(request,))
        assert not c.execute("SELECT 1 FROM purchase_request_items WHERE id=%s",(line,)).fetchone()
        saved=c.execute("SELECT old_data->'deleted_draft_lines'->'purchase_request_items' FROM audit_logs WHERE action='permanently_deleted' AND entity_id=%s",(request,)).fetchone()[0]
        assert len(saved)==1 and saved[0]['material_id']==MATERIAL
        assert c.execute("SELECT jsonb_array_length(old_data->'deleted_draft_lines'->'purchase_request_approvals') FROM audit_logs WHERE action='permanently_deleted' AND entity_id=%s",(request,)).fetchone()[0]==1
        actor(c,PURCHASER)
        denied(c,lambda:save_pr(c,token),"deleted by a Super Admin")
        approved=save_pr(c,submit=True)
        actor(c,DIRECTOR); c.execute("SELECT pr_transition(%s,'approved','QA')",(approved,))
        actor(c,PURCHASER)
        rfq_token=str(uuid4()); args=(rfq_token,approved,json.dumps({"response_due_date":"2026-12-01"}),[VENDOR])
        rfq=c.execute("SELECT create_rfq_draft(%s,%s,%s::jsonb,%s::uuid[])",args).fetchone()[0]
        actor(c,ADMIN)
        denied(c,lambda:c.execute("SELECT super_admin_delete_record('material',%s)",(MATERIAL,)),"Linked")
        denied(c,lambda:c.execute("SELECT super_admin_delete_record('purchase_request',%s)",(approved,)),"unused drafts")
        c.execute("SELECT super_admin_delete_record('rfq',%s)",(rfq,))
        assert c.execute("SELECT count(*) FROM rfq_items WHERE rfq_id=%s",(rfq,)).fetchone()[0]==0
        assert c.execute("SELECT count(*) FROM rfq_vendors WHERE rfq_id=%s",(rfq,)).fetchone()[0]==0
        actor(c,PURCHASER)
        denied(c,lambda:c.execute("SELECT create_rfq_draft(%s,%s,%s::jsonb,%s::uuid[])",args),"deleted by a Super Admin")
        returned=save_pr(c,submit=True)
        actor(c,DIRECTOR); c.execute("SELECT pr_transition(%s,'returned','QA return')",(returned,))
        actor(c,ADMIN)
        denied(c,lambda:c.execute("SELECT super_admin_delete_record('purchase_request',%s)",(returned,)),"submission or decision history")
        c.rollback()
    with db() as c:
        # A reference to a draft LINE also blocks deletion, even without a reference to its header.
        actor(c,PURCHASER); draft=save_pr(c)
        line=c.execute("SELECT id FROM purchase_request_items WHERE purchase_request_id=%s",(draft,)).fetchone()[0]
        c.execute("RESET ROLE")
        c.execute("CREATE TABLE public.qa_line_dependency(id uuid PRIMARY KEY,pr_line uuid REFERENCES public.purchase_request_items(id) ON DELETE CASCADE)")
        c.execute("INSERT INTO qa_line_dependency VALUES(gen_random_uuid(),%s)",(line,))
        actor(c,ADMIN)
        denied(c,lambda:c.execute("SELECT super_admin_delete_record('purchase_request',%s,true)",(draft,)),"Draft lines are linked")
        denied(c,lambda:c.execute("SELECT super_admin_delete_record('purchase_request',%s)",(draft,)),"Draft lines are linked")
        assert c.execute("SELECT count(*) FROM purchase_request_items WHERE id=%s",(line,)).fetchone()[0]==1
        c.rollback()
    with db() as c:
        doc=seed_po(c)
        c.execute("RESET ROLE")
        # Isolate the deletion boundary: draft vs posted GRN, while real PO/source FKs remain.
        grn=c.execute("INSERT INTO goods_receipt_notes(grn_number,company_id,po_id,vendor_id,project_id,warehouse_id,received_by,status) VALUES('QA-DELETE-GRN',%s,%s,%s,%s,%s,%s,'draft') RETURNING id",(A,doc,VENDOR,PROJECT,WAREHOUSE,PURCHASER)).fetchone()[0]
        actor(c,ADMIN)
        c.execute("SELECT super_admin_delete_record('goods_receipt',%s,true)",(grn,))
        c.execute("RESET ROLE")
        c.execute("UPDATE goods_receipt_notes SET status='posted' WHERE id=%s",(grn,))
        actor(c,ADMIN)
        denied(c,lambda:c.execute("SELECT super_admin_delete_record('goods_receipt',%s)",(grn,)),"unused drafts")
        c.execute("RESET ROLE"); c.execute("UPDATE goods_receipt_notes SET status='draft' WHERE id=%s",(grn,)); actor(c,ADMIN)
        c.execute("SELECT super_admin_delete_record('goods_receipt',%s)",(grn,))
        assert not c.execute("SELECT 1 FROM goods_receipt_notes WHERE id=%s",(grn,)).fetchone()
        c.execute("RESET ROLE")
        invoice=c.execute("INSERT INTO vendor_invoices(invoice_number,company_id,vendor_id,po_id,project_id,vendor_invoice_number,vendor_invoice_date,created_by) VALUES('QA-DELETE-INVOICE',%s,%s,%s,%s,'QA-BILL',current_date,%s) RETURNING id",(A,VENDOR,doc,PROJECT,PURCHASER)).fetchone()[0]
        c.execute("INSERT INTO vendor_invoice_events(invoice_id,action,acted_by,new_status) VALUES(%s,'created',%s,'draft'),(%s,'edited',%s,'draft')",(invoice,PURCHASER,invoice,PURCHASER))
        actor(c,ADMIN)
        denied(c,lambda:c.execute("SELECT super_admin_delete_record('purchase_order',%s)",(doc,)),"Linked vendor invoices")
        c.execute("SELECT super_admin_delete_record('vendor_invoice',%s)",(invoice,))
        assert c.execute("SELECT jsonb_array_length(old_data->'deleted_draft_lines'->'vendor_invoice_events') FROM audit_logs WHERE action='permanently_deleted' AND entity_id=%s",(str(invoice),)).fetchone()[0]==2
        c.execute("RESET ROLE")
        c.execute("INSERT INTO purchase_order_approvals(po_id,action,acted_by,new_status) VALUES(%s,'created',%s,'draft')",(doc,PURCHASER))
        actor(c,ADMIN)
        c.execute("SELECT super_admin_delete_record('purchase_order',%s)",(doc,))
        assert not c.execute("SELECT 1 FROM purchase_orders WHERE id=%s",(doc,)).fetchone()
        c.rollback()
    print("PASS Super Admin-only company cleanup, read-only preflight, master scope, draft-line dependency guards, retained audit snapshots and deleted-save retry protection")


def test_staff_audit_classifier():
    with db() as c:
        cases = [('profiles','insert',ADMIN,False),('profiles','update',ADMIN,False),('auth','login',ADMIN,False),('sessions','signed_in',ADMIN,False),('purchase_orders','update',ADMIN,True),('PO','po_approved',ADMIN,True),('profiles','update',DIRECTOR,True),(None,None,None,True),('profiles','delete',ADMIN,True)]
        for entity,action,entity_id,blocked in cases:
            result=c.execute("SELECT public.staff_audit_blocks_deletion(%s,%s,%s,%s)",(entity,action,entity_id,ADMIN)).fetchone()[0]
            assert result==blocked,(entity,action,entity_id,result)
    print("PASS recovered staff classifier tested against disposable PostgreSQL; no live database calls")



def test_structured_opening_bills_and_prior_paid():
    """Historical payment documentation never becomes a new vendor payment or bank posting."""
    with db() as c:
        c.execute("""INSERT INTO accounts(company_id,code,name,account_type)
          VALUES(%s,'2100','QA Payables','liability') ON CONFLICT(company_id,code) DO NOTHING""",(A,))
        actor(c, ACCOUNTS)
        header={"project_id":PROJECT,"vendor_id":VENDOR,"vendor_invoice_number":"QA-OLD-100",
            "vendor_invoice_date":"2026-11-01","gst_type":"cgst_sgst","freight":"0","other_charges":"0",
            "tds_rate":"0","remarks":"Old supplier bill"}
        item=[{"description":"Old cement delivery","hsn_sac":"2523","unit":"Bag",
            "quantity":"2","rate":"500","discount":"0","tax_rate":"18"}]
        paid=[{"payment_date":"2026-11-02","payment_mode":"upi","reference":"QA-UTR",
            "amount":"200","remarks":"Already paid outside ERP"}]
        def save(h, ls=item, ps=paid, old=None):
            return str(c.execute("SELECT save_opening_vendor_invoice_v2(%s::jsonb,%s::jsonb,%s::jsonb,%s)",
                (json.dumps(h),json.dumps(ls),json.dumps(ps),old)).fetchone()[0])
        doc=save(header)
        initial=c.execute("SELECT net_payable,amount_paid,balance_due,status FROM vendor_invoices WHERE id=%s",(doc,)).fetchone()
        assert tuple(map(str,initial[:3]))==("1180.00","200.00","980.00"),initial
        assert initial[3]=="pending_review"
        assert c.execute("SELECT count(*) FROM opening_vendor_invoice_lines WHERE invoice_id=%s",(doc,)).fetchone()[0]==1
        assert c.execute("SELECT count(*) FROM opening_vendor_invoice_prior_payments WHERE invoice_id=%s",(doc,)).fetchone()[0]==1
        # A selected master material must retain its reference and use the master unit.
        header_linked=dict(header,vendor_invoice_number="QA-MASTER-LINK-01")
        with_material=[dict(item[0],material_id=MATERIAL,unit="NOS")]
        linked_bill=save(header_linked,ls=with_material,ps=[])
        stored=c.execute("SELECT material_id,unit,rate FROM opening_vendor_invoice_lines WHERE invoice_id=%s",(linked_bill,)).fetchone()
        assert (str(stored[0]),stored[1],str(stored[2]))==(MATERIAL,"NOS","500.00"),stored
        denied(c,lambda:save(dict(header,vendor_invoice_number="QA-WRONG-UOM"),ls=[dict(item[0],material_id=MATERIAL,unit="Bag")],ps=[]),"Selected material and unit do not match")
        denied(c,lambda:save(dict(header,vendor_invoice_number="QA-UNKNOWN-MATERIAL"),ls=[dict(item[0],material_id="33333333-3333-4333-8333-333333333333",unit="NOS")],ps=[]),"Selected material and unit do not match")
        assert c.execute("SELECT count(*) FROM vendor_payments").fetchone()[0]==0
        # Internal balance-refresh function must remain inaccessible to ordinary staff.
        denied(c,lambda:c.execute("SELECT vi_refresh_balance(%s)",(doc,)),"permission denied")
        c.execute("RESET ROLE")
        c.execute("SELECT vi_refresh_balance(%s)",(doc,))
        actor(c, ACCOUNTS)
        assert str(c.execute("SELECT amount_paid FROM vendor_invoices WHERE id=%s",(doc,)).fetchone()[0])=="200.00"
        denied(c,lambda:save(dict(header, vendor_id=FOREIGN_VENDOR)),"Vendor not found")
        denied(c,lambda:save(dict(header, vendor_invoice_number="QA-OLD-101"),ps=[
            dict(paid[0],amount="1200")]),"exceed")
        denied(c,lambda:save(dict(header, vendor_invoice_number="QA-OLD-101"),ls=[
            dict(item[0],quantity="-2")]),"Invalid quantity")
        assert c.execute("SELECT count(*) FROM vendor_payments").fetchone()[0]==0
        actor(c, OTHER_DIRECTOR)
        assert c.execute("SELECT count(*) FROM opening_vendor_invoice_lines WHERE invoice_id=%s",(doc,)).fetchone()[0]==0
        actor(c, DIRECTOR)
        assert c.execute("SELECT invoice_transition(%s,'approve','QA checked original bill')",(doc,)).fetchone()[0]=="approved"
        rows=c.execute("""SELECT a.code, jl.debit, jl.credit FROM journal_lines jl
          JOIN accounts a ON a.id=jl.account_id
          JOIN journal_entries je ON je.id=jl.entry_id
          WHERE je.source_type='vendor_invoice' AND je.source_id=%s ORDER BY a.code""",(doc,)).fetchall()
        assert [(r[0],str(r[1]),str(r[2])) for r in rows]==[
          ("2100","0.00","980.00"),("3000","980.00","0.00")],rows
        assert c.execute("SELECT count(*) FROM journal_entries WHERE source_type='vendor_payment'").fetchone()[0]==0
        # An approved historical bill can receive audited item details, never new payable/bank amounts.
        before=c.execute("SELECT updated_at,subtotal,tax_total,balance_due FROM vendor_invoices WHERE id=%s",(doc,)).fetchone()
        details=[dict(item[0], description="Corrected old cement 53 grade", hsn_sac="2523",material_id=MATERIAL,unit="NOS")]
        reason="Verified item description against original supplier invoice"
        def correct(lines=details,expected=before[0]):
            return c.execute(
                "SELECT correct_approved_opening_vendor_invoice(%s,%s::jsonb,%s,%s,%s,%s)",
                (doc,json.dumps(lines),"Accounts validated historical item breakdown","",reason,expected)
            ).fetchone()[0]
        assert str(correct())==doc
        after=c.execute("SELECT updated_at,subtotal,tax_total,balance_due FROM vendor_invoices WHERE id=%s",(doc,)).fetchone()
        assert after[1:]==before[1:]
        assert c.execute("SELECT description FROM opening_vendor_invoice_lines WHERE invoice_id=%s",(doc,)).fetchone()[0]=="Corrected old cement 53 grade"
        assert str(c.execute("SELECT material_id FROM opening_vendor_invoice_lines WHERE invoice_id=%s",(doc,)).fetchone()[0])==MATERIAL
        assert c.execute("SELECT count(*) FROM vendor_invoice_events WHERE invoice_id=%s AND action='opening_details_corrected'",(doc,)).fetchone()[0]==1
        assert c.execute("SELECT count(*) FROM journal_entries WHERE source_id=%s",(doc,)).fetchone()[0]==1
        denied(c,lambda:correct(), "changed since it was opened")
        denied(c,lambda:correct([dict(details[0],rate="550")],after[0]),"must exactly match")
        actor(c,PURCHASER)
        denied(c,lambda:correct(details,after[0]),"Accounts approval permission")
        actor(c, ACCOUNTS)
        header2=dict(header,vendor_invoice_number="QA-OLD-102")
        paid_all=[dict(paid[0],amount="1180")]
        fully_paid=save(header2,ps=paid_all)
        actor(c, DIRECTOR)
        assert c.execute("SELECT invoice_transition(%s,'approve','Paid earlier')",(fully_paid,)).fetchone()[0]=="paid"
        assert c.execute("SELECT status,balance_due FROM vendor_invoices WHERE id=%s",(fully_paid,)).fetchone()==("paid",0)
        assert c.execute("SELECT count(*) FROM journal_entries WHERE source_id=%s",(fully_paid,)).fetchone()[0]==0
        assert c.execute("SELECT count(*) FROM vendor_payments").fetchone()[0]==0
        c.rollback()
    print("PASS historical vendor invoice lines, prior-paid preservation, scope, opening clearing and zero new payment approvals")

def test_accounts_staff_material_create_edit_only():
    """Both Accounts roles can create/edit Materials; cannot delete or move stock."""
    accountant_id="10000000-0000-4000-8000-000000000019"
    with db() as c:
        category=c.execute("SELECT category_id FROM items WHERE id=%s",(MATERIAL,)).fetchone()[0]
        c.execute("INSERT INTO profiles(id,company_id,full_name,email,is_active) VALUES(%s,%s,%s,%s,true)",
                  (accountant_id,A,"QA Accountant","qa-accountant@example.invalid"))
        c.execute("INSERT INTO user_roles(user_id,role) VALUES(%s,'accountant')",(accountant_id,))
        c.execute("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(%s,%s,now())",
                  (accountant_id,"qa-accountant@example.invalid"))
        for uid,code in ((ACCOUNTS,"QA-ACCT-M"),(accountant_id,"QA-ACCT-A")):
            actor(c,uid)
            perms=c.execute("""SELECT has_permission(auth.uid(),'materials.edit'),
                has_permission(auth.uid(),'materials.view'),
                has_permission(auth.uid(),'materials.manage'),
                has_permission(auth.uid(),'inventory.adjust')""").fetchone()
            assert perms==(True,True,False,False), (uid,perms)
            inserted=c.execute("""INSERT INTO items(company_id,code,name,unit_id,category_id)
                VALUES(%s,%s,'Accountant-created material',%s,%s) RETURNING id""",
                (A,code,UNIT,category)).fetchone()
            assert inserted,uid
            changed=c.execute("UPDATE items SET name='Accounts corrected description' WHERE id=%s RETURNING name",
                (inserted[0],)).fetchone()
            assert changed==("Accounts corrected description",),changed
            assert c.execute("DELETE FROM items WHERE id=%s RETURNING id",(inserted[0],)).fetchone() is None
            assert c.execute("SELECT name FROM items WHERE id=%s",(inserted[0],)).fetchone()==("Accounts corrected description",)
            c.execute("RESET ROLE")
        c.rollback()
    print("PASS Accountant and Accounts Manager: material insert/edit permitted; delete, stock and category admin excluded")


def test_optional_invoice_roundoff_accounting():
    """Only opted-in vendor bills round gross totals, with separate balanced journals."""
    with db() as c:
        # Disposable fixture requires the same core ledger accounts production has.
        for code,name,kind in [
            ("1300","Inventory / Project Materials","asset"),
            ("1400","GST Input Credit","asset"),
            ("2100","Accounts Payable - Vendors","liability"),
            ("2200","TDS Payable","liability"),
        ]:
            c.execute("""INSERT INTO accounts(company_id,code,name,account_type)
                VALUES(%s,%s,%s,%s) ON CONFLICT(company_id,code) DO NOTHING""",
                (A,code,name,kind))
        actor(c, ACCOUNTS)
        header={"project_id":PROJECT,"vendor_id":VENDOR,
            "vendor_invoice_number":"QA-ROUND-OFF-OLD",
            "vendor_invoice_date":"2026-11-01",
            "gst_type":"cgst_sgst","freight":"0.40",
            "other_charges":"0","tds_rate":"0",
            "round_off_mode":"nearest_rupee"}
        lines=[{"description":"Historical cement", "unit":"NOS", "quantity":"2",
            "rate":"500","discount":"0","tax_rate":"18"}]
        paid=[{"payment_date":"2026-11-02","payment_mode":"upi","amount":"200"}]
        doc=str(c.execute("SELECT save_opening_vendor_invoice_v2(%s::jsonb,%s::jsonb,%s::jsonb)",
            (json.dumps(header),json.dumps(lines),json.dumps(paid))).fetchone()[0])
        values=c.execute("""SELECT round_off_mode,round_off_amount,grand_total,
            net_payable,amount_paid,balance_due FROM vendor_invoices WHERE id=%s""",(doc,)).fetchone()
        assert (values[0],*[str(x) for x in values[1:]]) == (
            "nearest_rupee","-0.40","1180.00","1180.00","200.00","980.00"),values
        no_round=dict(header,vendor_invoice_number="QA-ROUND-OFF-EXACT",round_off_mode="none")
        exact=str(c.execute("SELECT save_opening_vendor_invoice_v2(%s::jsonb,%s::jsonb,%s::jsonb)",
            (json.dumps(no_round),json.dumps(lines),json.dumps(paid))).fetchone()[0])
        values=c.execute("""SELECT round_off_amount,grand_total,balance_due
            FROM vendor_invoices WHERE id=%s""",(exact,)).fetchone()
        assert tuple(str(x) for x in values)==("0.00","1180.40","980.40"),values
        actor(c, DIRECTOR)
        c.execute("SELECT invoice_transition(%s,'approve','Verified historical invoice')",(doc,))
        old_lines=c.execute("""SELECT a.code,jl.debit,jl.credit FROM journal_lines jl
            JOIN accounts a ON a.id=jl.account_id JOIN journal_entries je ON je.id=jl.entry_id
            WHERE je.source_id=%s ORDER BY a.code""",(doc,)).fetchall()
        assert [(x[0],str(x[1]),str(x[2])) for x in old_lines]==[
            ("2100","0.00","980.00"),("3000","980.00","0.00")],old_lines
        # A regular matched invoice's adjustment must be separately posted to
        # P&L instead of silently unbalancing Accounts Payable and Input GST.
        synthetic_po=seed_po(c)
        def approve_regular(name,charges,rounding,net,delta,round_code):
            # The QA fixture inserts a pre-matched payable directly as the
            # privileged test setup role. Staff can only create via the RPC.
            c.execute("RESET ROLE")
            record=str(c.execute("""INSERT INTO vendor_invoices(
                invoice_number,company_id,vendor_id,project_id,po_id,vendor_invoice_number,
                vendor_invoice_date,subtotal,tax_total,freight,grand_total,
                tds_amount,net_payable,balance_due,status,created_by,round_off_mode,round_off_amount)
                VALUES(%s,%s,%s,%s,%s,%s,'2026-11-01',100,18,%s,%s,0,%s,%s,
                    'pending_review',%s,%s,%s) RETURNING id""",
                (name,A,VENDOR,PROJECT,synthetic_po,name,charges,net,net,net,ACCOUNTS,rounding,delta)).fetchone()[0])
            actor(c, DIRECTOR)
            assert c.execute("SELECT invoice_transition(%s,'approve','Checked supplier invoice')",
                (record,)).fetchone()[0]=="approved"
            journals=c.execute("""SELECT a.code,jl.debit,jl.credit FROM journal_lines jl
                JOIN accounts a ON a.id=jl.account_id
                JOIN journal_entries je ON je.id=jl.entry_id
                WHERE je.source_id=%s ORDER BY a.code""",(record,)).fetchall()
            amounts={x[0]:(x[1],x[2]) for x in journals}
            assert sum(v[0] for v in amounts.values())==sum(v[1] for v in amounts.values())
            assert str(amounts[round_code][0] if round_code=="5300" else amounts[round_code][1])=="0.25"
            return amounts
        gain=approve_regular("QA-ROUND-GAIN", "0.25", "nearest_rupee","118.00","-0.25","4300")
        assert gain["2100"][1]==118 and gain["4300"][1]==0.25
        loss=approve_regular("QA-ROUND-LOSS", "0.75", "nearest_rupee","119.00","0.25","5300")
        assert loss["2100"][1]==119 and loss["5300"][0]==0.25
        c.rollback()
    print("PASS opt-in round-off, exact paise default, historical payments, and balanced gain/loss journals")


def test_accounts_manager_finance_settings_permission():
    """Accounts Manager can configure TDS and matching; Director remains read-only."""
    with db() as c:
        actor(c, ACCOUNTS)
        perms=c.execute("""SELECT
          has_permission(auth.uid(),'tax.configure'),
          has_permission(auth.uid(),'company.manage')""").fetchone()
        assert perms==(True,False),perms
        settings={"qty_tolerance_pct":0,"rate_tolerance_pct":1.25,
            "value_tolerance":250.50,
            "tds_sections":[{"code":"194C","label":"QA contractor TDS","rate":1}]}
        c.execute("SELECT update_finance_settings(%s::jsonb)",(json.dumps(settings),))
        value=c.execute("SELECT finance_settings FROM companies WHERE id=%s",(A,)).fetchone()[0]
        assert str(value["rate_tolerance_pct"])=="1.25",value
        assert str(value["value_tolerance"])=="250.50" or str(value["value_tolerance"])=="250.5",value
        assert value["tds_sections"][0]["code"]=="194C",value
        denied(c,lambda:c.execute("SELECT update_finance_settings(%s::jsonb)",
            (json.dumps({**settings,"tds_sections":{"invalid":"object"}}),)),
            "TDS sections must be an array")
        actor(c,DIRECTOR)
        denied(c,lambda:c.execute("SELECT update_finance_settings(%s::jsonb)",
            (json.dumps(settings),)),"No permission")
        actor(c,ADMIN)
        c.execute("SELECT update_finance_settings(%s::jsonb)",(json.dumps(settings),))
        c.rollback()
    print("PASS Accounts Manager finance-settings save, validation and Director read-only enforcement")


def test_google_sheets_retired_archives_preserved():
    """OAuth and scheduler surfaces removed; old material cost evidence preserved."""
    with db() as c:
        retired=["erp_google_sheet_connections","erp_google_oauth_states","erp_sheet_sync_nonces"]
        for name in retired:
            assert c.execute("SELECT to_regclass(%s)",("public."+name,)).fetchone()[0] is None,name
        assert c.execute("SELECT to_regprocedure('public.erp_enqueue_google_sheets_sync()')").fetchone()[0] is None
        for name in ["erp_sheet_import_documents","erp_project_cost_entries",
                     "erp_historical_material_consumptions","erp_historical_consumption_audit"]:
            assert c.execute("SELECT to_regclass(%s)",("public."+name,)).fetchone()[0],name
        # Historical consumption still enforces scope and retains the audit log
        # even after its former Google import pathway is retired.
        row=c.execute("""INSERT INTO erp_historical_material_consumptions(
            company_id,reference,occurred_on,project_id,material_id,quantity,unit_cost)
            VALUES(%s,'QA-ARCHIVE-001','2026-10-01',%s,%s,3,120.00)
            RETURNING id""",(A,PROJECT,MATERIAL)).fetchone()
        assert row
        assert c.execute("""SELECT count(*) FROM erp_historical_consumption_audit
            WHERE reference='QA-ARCHIVE-001'""").fetchone()[0]==1
        c.rollback()
    print("PASS retired Google OAuth/sync and preserved audited historical registers")


def test_count_units_seed_is_idempotent():
    """New materials can select pieces, people or packets without altering stock."""
    migration = (ROOT / "drizzle/migrations/0068_add_count_units.sql").read_text()
    with db() as c:
        original = c.execute(
            "SELECT id FROM units_of_measure WHERE company_id=%s AND code='NOS'", (A,)
        ).fetchone()[0]

        # The migration runs before company fixtures in setup(). Simulate
        # applying it to the existing companies, including a repeated rollout.
        for _ in range(2):
            c.execute(migration)

        rows = c.execute("""
            SELECT company_id,code,name,decimal_places,status::text,is_demo
            FROM units_of_measure
            WHERE code IN ('PCS','PERSON','PKT')
            ORDER BY company_id,code
        """).fetchall()
        # Foundation migrations may create an additional bootstrap company.
        # Seed every existing company, not just the two named QA companies.
        companies = [
            str(row[0]) for row in c.execute("SELECT id FROM companies").fetchall()
        ]
        expected = {
            (company,code,name,0,"active",False)
            for company in companies
            for code,name in [
                ("PCS","Pieces"),("PERSON","Person"),("PKT","Packets")
            ]
        }
        normalized = {
            (str(company),code,name,decimals,status,is_demo)
            for company,code,name,decimals,status,is_demo in rows
        }
        assert normalized == expected, (normalized,expected)
        assert len(rows) == len(expected), "Duplicate unit codes inserted"
        assert c.execute(
            "SELECT id FROM units_of_measure WHERE company_id=%s AND code='NOS'", (A,)
        ).fetchone()[0] == original
        c.rollback()
    print("PASS PCS, PERSON and PKT units seeded per company, no duplicates or master changes")




def test_services_and_hours_master_seed():
    """JCB hire can use a Services category and fractional billable hours."""
    migration = (ROOT / "drizzle/migrations/0070_services_and_hours_unit.sql").read_text()
    with db() as c:
        existing_items = c.execute("SELECT count(*) FROM items").fetchone()[0]
        existing_stock = c.execute("SELECT count(*) FROM inventory_transactions").fetchone()[0]
        companies = [str(row[0]) for row in c.execute("SELECT id FROM companies").fetchall()]
        assert companies, "Expected foundation and fixture companies"

        # Reapplication must leave one category and one hourly unit per company.
        for _ in range(2):
            c.execute(migration)

        categories = c.execute("""
            SELECT company_id,code,name,status::text,is_demo
            FROM item_categories WHERE code='SERVICES'
        """).fetchall()
        units = c.execute("""
            SELECT company_id,code,name,decimal_places,status::text,is_demo
            FROM units_of_measure WHERE code='HRS'
        """).fetchall()
        actual_categories = {
            (str(company),code,name,status,is_demo)
            for company,code,name,status,is_demo in categories
        }
        actual_units = {
            (str(company),code,name,decimal_places,status,is_demo)
            for company,code,name,decimal_places,status,is_demo in units
        }
        expected_categories = {
            (company,"SERVICES","Services","active",False) for company in companies
        }
        expected_units = {
            (company,"HRS","Hours",2,"active",False) for company in companies
        }
        assert actual_categories == expected_categories
        assert actual_units == expected_units
        assert len(categories) == len(companies), "Duplicated service categories"
        assert len(units) == len(companies), "Duplicated hourly units"
        assert c.execute("SELECT count(*) FROM items").fetchone()[0] == existing_items
        assert c.execute("SELECT count(*) FROM inventory_transactions").fetchone()[0] == existing_stock
        c.rollback()
    print("PASS Services category + HRS hourly unit seed per company; no stock or item changes")




def test_square_metre_unit_seed_is_idempotent():
    """Area-based materials can use SQM without changing existing stock or units."""
    migration = (ROOT / "drizzle/migrations/0071_add_square_metre_unit.sql").read_text()
    with db() as c:
        companies = [str(row[0]) for row in c.execute("SELECT id FROM companies").fetchall()]
        assert companies, "Expected a fixture company"
        item_count = c.execute("SELECT count(*) FROM items").fetchone()[0]
        stock_count = c.execute("SELECT count(*) FROM inventory_transactions").fetchone()[0]
        old_units = c.execute("""
            SELECT id,company_id,code,name,decimal_places
            FROM units_of_measure WHERE code <> 'SQM'
            ORDER BY company_id,code
        """).fetchall()

        for _ in range(2):
            c.execute(migration)

        sqm_rows = c.execute("""
            SELECT company_id,code,name,decimal_places,status::text,is_demo
            FROM units_of_measure WHERE code='SQM'
        """).fetchall()
        actual = {
            (str(company),code,name,decimals,status,is_demo)
            for company,code,name,decimals,status,is_demo in sqm_rows
        }
        assert actual == {
            (company,"SQM","Square Metre",2,"active",False)
            for company in companies
        }
        assert len(sqm_rows) == len(companies), "Duplicate SQM unit inserted"
        assert c.execute("""
            SELECT id,company_id,code,name,decimal_places
            FROM units_of_measure WHERE code <> 'SQM'
            ORDER BY company_id,code
        """).fetchall() == old_units
        assert c.execute("SELECT count(*) FROM items").fetchone()[0] == item_count
        assert c.execute("SELECT count(*) FROM inventory_transactions").fetchone()[0] == stock_count
        c.rollback()
    print("PASS SQM registered per company with two decimals and no inventory changes")



def test_optional_other_expense_category_detail():
    """Optional text for Other is persisted, correction-safe and replay-immutable."""
    with db() as c:
        actor(c, ACCOUNTS)
        expense_day = c.execute(
            "SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date"
        ).fetchone()[0]
        save_sql = """SELECT public.record_site_small_expense_detailed(
            %s::uuid,%s::uuid,%s::uuid,%s::date,
            %s,%s::numeric,%s,%s,%s,%s,%s
        )"""
        key = str(uuid4())
        payload = (key, PROJECT, None, expense_day, "other", "500.25",
                   "upi", "Maintenance supplier", "Warehouse roof repairs", "REF-OTHER",
                   "  Roof sheet repair  ")
        expense = c.execute(save_sql, payload).fetchone()[0]
        assert c.execute(
            "SELECT category,other_category_detail FROM site_small_expenses WHERE id=%s",
            (expense,)
        ).fetchone() == ("other", "Roof sheet repair")
        assert c.execute(save_sql, payload).fetchone()[0] == expense
        denied(c, lambda: c.execute(save_sql, (*payload[:-1], "Other work")),
               "description differs")
        denied(c, lambda: c.execute(save_sql, (*payload[:-1], "x")),
               "2 to 120")
        denied(c, lambda: c.execute(save_sql, (*payload[:-1], "y"*121)),
               "2 to 120")
        denied(c, lambda: c.execute(save_sql, (
            str(uuid4()), PROJECT, None, expense_day, "office", "75.00",
            "cash", "Maintenance supplier", "Office supplies", None, "Wrong category"
        )), "category must be Other")

        # Other may be selected without specifying a subtype at all.
        empty = (str(uuid4()), PROJECT, None, expense_day, "other", "80.00",
                 "cash", "Maintenance supplier", "Emergency purchase", None, "")
        empty_id = c.execute(save_sql, empty).fetchone()[0]
        assert c.execute(
            "SELECT other_category_detail FROM site_small_expenses WHERE id=%s",
            (empty_id,)
        ).fetchone()[0] is None

        correct_sql = """SELECT public.correct_site_small_expense_detailed(
            %s::uuid,%s::uuid,%s::uuid,%s::uuid,%s::date,
            %s,%s::numeric,%s,%s,%s,%s,%s,%s
        )"""
        reason = "Corrected category after matching receipt"
        revised = (expense, str(uuid4()), PROJECT, None, expense_day, "other",
                   "501.25", "upi", "Maintenance supplier", "Warehouse roof repairs",
                   "REF-OTHER", reason, "Waterproofing accessories")
        actor(c, SITE)
        denied(c, lambda: c.execute(save_sql, (
            str(uuid4()), PROJECT, None, expense_day, "other", "75.00",
            "cash", "Maintenance supplier", "Unauthorized purchase", None, "Other site work"
        )))
        denied(c, lambda: c.execute(correct_sql, revised))

        actor(c, ACCOUNTS)
        replacement = c.execute(correct_sql, revised).fetchone()[0]
        assert replacement != expense
        assert c.execute(correct_sql, revised).fetchone()[0] == replacement
        assert c.execute("""
            SELECT other_category_detail,status FROM site_small_expenses WHERE id=%s
        """,(expense,)).fetchone() == ("Roof sheet repair", "voided")
        assert c.execute("""
            SELECT other_category_detail,replaces_expense_id,status
            FROM site_small_expenses WHERE id=%s
        """,(replacement,)).fetchone() == (
            "Waterproofing accessories", expense, "recorded"
        )
        denied(c, lambda: c.execute(correct_sql,
            (*revised[:-1], "Different category description")), "differs")
        c.rollback()
    print("PASS optional Other text, corrections, immutable retries and access controls")





def test_small_expenses_above_fifty_thousand():
    """Larger receipts keep permission, idempotency and correction accounting intact."""
    with db() as c:
        actor(c, ACCOUNTS)
        day = c.execute(
            "SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date"
        ).fetchone()[0]
        record_sql = """SELECT public.record_site_small_expense_detailed(
            %s::uuid,%s::uuid,%s::uuid,%s::date,%s,%s::numeric,%s,%s,%s,%s,%s
        )"""
        key = str(uuid4())
        base_args = (
            key, PROJECT, None, day, "security_guard", "75000.01",
            "bank", "Site security agency", "Monthly security bill", "SG-75K", None
        )
        expense = c.execute(record_sql, base_args).fetchone()[0]
        assert c.execute(record_sql, base_args).fetchone()[0] == expense
        large_amount,large_status = c.execute(
            "SELECT amount,status FROM site_small_expenses WHERE id=%s",
            (expense,)
        ).fetchone()
        assert (float(large_amount),large_status) == (75000.01, "recorded")
        denied(c, lambda: c.execute(record_sql,
            (*base_args[:5], "75000.02", *base_args[6:])), "cannot be overwritten")

        # Correction uses the same uncapped audited record function.
        correction_sql = """SELECT public.correct_site_small_expense_detailed(
            %s::uuid,%s::uuid,%s::uuid,%s::uuid,%s::date,
            %s,%s::numeric,%s,%s,%s,%s,%s,%s
        )"""
        reason = "Corrected high value bill according to vendor receipt"
        correction_key = str(uuid4())
        corrected = (
            expense, correction_key, PROJECT, None, day,
            "security_guard", "125000.50", "bank", "Site security agency",
            "Monthly security bill corrected", "SG-125K", reason, None
        )
        updated = c.execute(correction_sql, corrected).fetchone()[0]
        assert c.execute(correction_sql, corrected).fetchone()[0] == updated
        assert c.execute(
            "SELECT amount,replaces_expense_id,status FROM site_small_expenses WHERE id=%s",
            (updated,)
        ).fetchone() == (125000.50, expense, "recorded")
        assert c.execute(
            "SELECT status FROM site_small_expenses WHERE id=%s", (expense,)
        ).fetchone()[0] == "voided"

        # Old RPC also accepts bills above the historic cap for older clients.
        legacy = c.execute(
            """SELECT public.record_site_small_expense(
                %s::uuid,%s::uuid,%s::uuid,%s::date,%s,%s::numeric,%s,%s,%s,%s
            )""",
            (str(uuid4()), PROJECT, None, day, "other", "51000.25",
             "upi", "Supply contractor", "Equipment hire charge", "LARGE-51K")
        ).fetchone()[0]
        assert c.execute(
            "SELECT amount FROM site_small_expenses WHERE id=%s", (legacy,)
        ).fetchone()[0] == 51000.25

        actor(c, SITE)
        denied(c, lambda: c.execute(record_sql,
            (str(uuid4()), PROJECT, None, day, "other", "200000.00",
             "cash", "Supply contractor", "Not authorized entry", None, None)))
        c.rollback()
    print("PASS expense amounts over Rs 50k through audited create/correct, retries, and RLS")



def test_accounts_manager_small_expense_corrections():
    """Accounts Manager can record and correct, not void freely or bypass project scope."""
    with db() as c:
        actor(c, ACCOUNTS)
        assert c.execute(
            "SELECT has_permission(auth.uid(),'small_expense.manage')"
        ).fetchone()[0] is True
        expense_day = c.execute(
            "SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date"
        ).fetchone()[0]
        create_sql = """SELECT public.record_site_small_expense(
            %s::uuid,%s::uuid,%s::uuid,%s::date,%s,%s::numeric,%s,%s,%s,%s
        )"""
        old_key = str(uuid4())
        old_args = (old_key, PROJECT, None, expense_day, "office", "225.75",
                    "upi", "Site supplier", "Electrical fitting site delivery", "REF-41")
        old_id = c.execute(create_sql, old_args).fetchone()[0]
        assert c.execute(create_sql, old_args).fetchone()[0] == old_id

        correct_sql = """SELECT public.correct_site_small_expense(
            %s::uuid,%s::uuid,%s::uuid,%s::uuid,%s::date,
            %s,%s::numeric,%s,%s,%s,%s,%s
        )"""
        new_key = str(uuid4())
        reason = "Corrected the paid amount after verifying the receipt"
        revised = (old_id,new_key,PROJECT,None,expense_day,"office",
                   "250.50","upi","Site supplier","Electrical fitting site delivery",
                   "REF-41",reason)
        # Refuse invalid scope without changing either expense.
        denied(c, lambda: c.execute(correct_sql,
            (old_id,str(uuid4()),OTHER_PROJECT,None,expense_day,"office",
             "250.50","upi","Site supplier","Electrical fitting site delivery",
             "REF-41",reason)))
        assert c.execute(
            "SELECT status FROM site_small_expenses WHERE id=%s",(old_id,)
        ).fetchone()[0] == "recorded"

        # Site staff cannot use the privileged function even with a known document ID.
        actor(c, SITE)
        denied(c, lambda: c.execute(create_sql, (
            str(uuid4()), PROJECT, None, expense_day, "office", "50.00",
            "cash", "Site supplier", "Unauthorized expense", None)))
        denied(c, lambda: c.execute(correct_sql, revised))

        actor(c, ACCOUNTS)
        new_id = c.execute(correct_sql, revised).fetchone()[0]
        assert new_id != old_id
        assert c.execute(correct_sql, revised).fetchone()[0] == new_id
        old_status,voided_by,void_reason = c.execute("""
            SELECT status,voided_by,void_reason FROM site_small_expenses
            WHERE id=%s
        """,(old_id,)).fetchone()
        assert (old_status,str(voided_by),void_reason) == (
            "voided",ACCOUNTS,"Corrected: "+reason)
        new_status,amount,previous_id,creator = c.execute("""
            SELECT status,amount,replaces_expense_id,created_by
            FROM site_small_expenses WHERE id=%s
        """,(new_id,)).fetchone()
        assert (new_status,amount,previous_id,str(creator)) == (
            "recorded",250.50,old_id,ACCOUNTS)
        assert c.execute("""
            SELECT action,reason FROM site_small_expense_events
            WHERE expense_id=%s AND action='voided'
        """,(old_id,)).fetchone() == ("voided","Corrected: "+reason)
        assert c.execute("SELECT count(*) FROM site_small_expenses WHERE id IN (%s,%s)",
                         (old_id,new_id)).fetchone()[0] == 2
        denied(c, lambda: c.execute(correct_sql, (*revised[:-1],"Another reason that should fail")))
        denied(c, lambda: c.execute(correct_sql, (old_id,str(uuid4()),*revised[2:])))
        # Standalone voids remain restricted to Super Admin.
        denied(c, lambda: c.execute(
            "SELECT public.void_site_small_expense(%s::uuid,%s)",(new_id,"Not authorized")))
        c.rollback()
    print("PASS Accounts Manager record/correct, atomic audit, retries, scope, and restricted void")



def test_small_expense_in_place_and_bills():
    """0078: Admin and Accounts record, Accounts edit, Director only views."""
    with db() as c:
        actor(c, ADMIN)
        day=c.execute("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date").fetchone()[0]
        create="""SELECT record_site_small_expense_detailed(
            %s::uuid,%s::uuid,%s::uuid,%s::date,%s,%s::numeric,%s,%s,%s,%s,%s)"""
        args=(str(uuid4()),PROJECT,None,day,"other","75000.01","upi",
              "Supplier of goods","General office supplies","BILL-01","Office miscellaneous")
        original=c.execute(create,args).fetchone()[0]
        assert c.execute(create,args).fetchone()[0]==original
        assert c.execute("SELECT other_category_detail FROM site_small_expenses WHERE id=%s",
                         (original,)).fetchone()[0]=="Office miscellaneous"
        version=c.execute("SELECT updated_at FROM site_small_expenses WHERE id=%s",
                          (original,)).fetchone()[0]
        payload={"project_id":PROJECT,"building_id":None,"spent_on":day.isoformat(),
                 "category":"other","amount":125000.50,"payment_method":"bank",
                 "paid_to":"Supplier of goods","description":"Site materials paid",
                 "receipt_reference":"BILL-02",
                 "other_category_detail":"Emergency site supplies"}
        edit="""SELECT edit_site_small_expense(%s::uuid,%s::timestamptz,%s::jsonb,%s)"""
        actor(c, ACCOUNTS)
        assert c.execute("SELECT has_permission(auth.uid(),'small_expense.manage')").fetchone()[0]
        # Accounts Manager now creates original paid-expense entries and their
        # receipt/bill attachments (same retry-safe RPC as Super Admin).
        manager_args=(str(uuid4()),PROJECT,None,day,"transport","341.00","cash",
                      "Local transporter","Vehicle hire for site","REC-341",None)
        manager_created=c.execute(create,manager_args).fetchone()[0]
        assert manager_created != original
        assert c.execute(create,manager_args).fetchone()[0] == manager_created
        assert c.execute("SELECT created_by::text,amount,status FROM site_small_expenses WHERE id=%s",
                         (manager_created,)).fetchone() == (ACCOUNTS,341.00,"recorded")
        assert c.execute("SELECT count(*) FROM site_small_expense_events WHERE expense_id=%s AND action='recorded'",
                         (manager_created,)).fetchone()[0] == 1
        denied(c,lambda:c.execute(edit,(original,version,
               json.dumps({**payload,"project_id":OTHER_PROJECT}),"Wrong company")))
        assert c.execute(edit,(original,version,json.dumps(payload),"Verified bill details")).fetchone()[0]==original
        denied(c,lambda:c.execute(edit,(original,version,json.dumps(payload),"Stale edit")),"Reload")
        assert c.execute("SELECT status,amount,other_category_detail FROM site_small_expenses WHERE id=%s",
                         (original,)).fetchone()==("recorded",125000.50,"Emergency site supplies")
        assert c.execute("SELECT count(*) FROM site_small_expenses WHERE replaces_expense_id=%s",
                         (original,)).fetchone()[0]==0
        assert c.execute("""SELECT action,before_values->>'other_category_detail',
              after_values->>'other_category_detail' FROM site_small_expense_events
              WHERE expense_id=%s AND action='edited'""",(original,)).fetchone() == (
              "edited","Office miscellaneous","Emergency site supplies")
        denied(c,lambda:c.execute("SELECT void_site_small_expense(%s,%s)",
                                 (original,"Void forbidden")))
        denied(c,lambda:c.execute("""SELECT correct_site_small_expense_detailed(
           %s::uuid,%s::uuid,%s::uuid,%s::uuid,%s::date,%s,%s::numeric,
           %s,%s,%s,%s,%s,%s)""",(
           original,str(uuid4()),PROJECT,None,day,"other","200.00",
           "cash","Supplier of goods","Old duplicate","BILL-01",
           "Legacy correction","Waste")), "permission")
        bill_path=f"{A}/{ACCOUNTS}/{uuid4()}.jpg"
        c.execute("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('small-expense-bills',%s,%s::jsonb)",
                  (bill_path,json.dumps({"mimetype":"image/jpeg","size":2345})))
        bill=c.execute("SELECT manage_site_small_expense_bill(%s,%s,%s,%s,%s,%s)",(
            original,bill_path,"bill.jpg","image/jpeg",2345,False)).fetchone()[0]
        assert c.execute("SELECT is_active FROM site_small_expense_bills WHERE id=%s",
                         (bill,)).fetchone()[0]
        actor(c,SITE)
        own_expense = c.execute(create,(
            str(uuid4()),PROJECT,None,day,"transport","45.00","cash",
            "Local transporter","Own site expense",None,None)).fetchone()[0]
        assert own_expense != original
        assert c.execute(
            "SELECT id FROM site_small_expenses ORDER BY id"
        ).fetchall() == [(own_expense,)]
        assert not c.execute("SELECT has_permission(auth.uid(),'financial.view')").fetchone()[0]
        assert c.execute("SELECT has_permission(auth.uid(),'small_expense.create')").fetchone()[0]
        denied(c,lambda:c.execute(create,(
            str(uuid4()),None,None,day,"transport","45.00","cash",
            "Local transporter","Office expense not assigned",None,None)),"assigned project")
        denied(c,lambda:c.execute(edit,(original,version,json.dumps(payload),"No access")))
        denied(c,lambda:c.execute("SELECT manage_site_small_expense_bill(%s,%s,NULL,NULL,NULL,true)",
                                 (original,bill_path)))
        actor(c,DIRECTOR)
        denied(c,lambda:c.execute(create,(
            str(uuid4()),PROJECT,None,day,"transport","45.00","cash",
            "Local transporter","Director cannot create bills",None,None)))
        assert c.execute("SELECT has_permission(auth.uid(),'financial.view')").fetchone()[0]
        assert c.execute("SELECT count(*) FROM site_small_expenses WHERE id=%s",(original,)).fetchone()[0]==1
        assert c.execute("SELECT count(*) FROM site_small_expense_bills WHERE id=%s",(bill,)).fetchone()[0]==1
        assert c.execute("SELECT count(*) FROM storage.objects WHERE name=%s",(bill_path,)).fetchone()[0]==1
        denied(c,lambda:c.execute(edit,(original,version,json.dumps(payload),"Director edit denied")))
        actor(c,OTHER_DIRECTOR)
        assert c.execute("SELECT count(*) FROM site_small_expense_bills WHERE id=%s",(bill,)).fetchone()[0]==0
        assert c.execute("SELECT count(*) FROM storage.objects WHERE name=%s",(bill_path,)).fetchone()[0]==0
        actor(c,ACCOUNTS)
        denied(c,lambda:c.execute("SELECT super_admin_force_delete('small_expense',%s)",(manager_created,)))
        assert c.execute("SELECT manage_site_small_expense_bill(%s,%s,NULL,NULL,NULL,true)",
                         (original,bill_path)).fetchone()[0]==bill
        assert c.execute("SELECT is_active FROM site_small_expense_bills WHERE id=%s",(bill,)).fetchone()[0] is False
        actor(c,DIRECTOR)
        assert c.execute("SELECT count(*) FROM storage.objects WHERE name=%s",(bill_path,)).fetchone()[0]==0
        actor(c,ADMIN)
        c.execute("SELECT super_admin_force_delete('small_expense',%s)",(original,))
        assert c.execute("SELECT count(*) FROM site_small_expenses WHERE id=%s",(original,)).fetchone()[0]==0
        c.rollback()
    print("PASS 0078 Accounts Manager creates new expenses, same-ID edits, Director view-only, bill privacy, admin deletion")


def test_site_engineer_own_small_expense_scope():
    """0104: field staff see only their own receipts even beside a colleague on the same project."""
    with db() as c:
        c.execute("RESET ROLE")
        site_two = str(uuid4())
        c.execute("""INSERT INTO profiles(id,company_id,full_name,email,is_active)
                     VALUES(%s,%s,%s,%s,true)""",
                  (site_two,A,"QA Second Site Engineer","qa-second-site@example.invalid"))
        c.execute("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(%s,%s,now())",
                  (site_two,"qa-second-site@example.invalid"))
        c.execute("INSERT INTO user_roles(user_id,role) VALUES(%s,'site_engineer')",(site_two,))
        c.execute("INSERT INTO user_project_assignments(user_id,project_id) VALUES(%s,%s)",
                  (site_two,PROJECT))
        record="""SELECT public.record_site_small_expense_detailed(
            %s::uuid,%s::uuid,%s::uuid,%s::date,%s,%s::numeric,%s,%s,%s,%s,%s
        )"""
        day=c.execute("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date").fetchone()[0]
        def make(role,amount,category="transport"):
            actor(c,role)
            return c.execute(record,(str(uuid4()),PROJECT,None,day,category,amount,
              "cash","Site supply shop","Materials for site work","OWN-RECEIPT",None)).fetchone()[0]

        engineer_one = make(SITE,"110.00")
        engineer_two = make(site_two,"220.00","fuel")
        manager = make(ACCOUNTS,"330.00","office")

        actor(c,SITE)
        assert c.execute("SELECT id FROM site_small_expenses").fetchall()==[(engineer_one,)]
        assert c.execute("SELECT count(*) FROM site_small_expense_events").fetchone()[0]==1
        assert not c.execute("SELECT has_permission(auth.uid(),'financial.view')").fetchone()[0]
        assert not c.execute("SELECT has_permission(auth.uid(),'small_expense.manage')").fetchone()[0]
        denied(c,lambda:c.execute(record,(str(uuid4()),None,None,day,"office","20.00",
                                    "cash","Site supply shop","Unauthorized office expense",None,None)),
               "assigned project")
        denied(c,lambda:c.execute(record,(str(uuid4()),OTHER_PROJECT,None,day,"office","20.00",
                                    "cash","Site supply shop","Unauthorized other company",None,None)),
               "not accessible")
        denied(c,lambda:c.execute("UPDATE site_small_expenses SET amount=1 WHERE id=%s",(engineer_one,)))
        denied(c,lambda:c.execute("DELETE FROM site_small_expenses WHERE id=%s",(engineer_one,)))

        picture=f"{A}/{SITE}/{uuid4()}.jpg"
        c.execute("""INSERT INTO storage.objects(bucket_id,name,metadata)
                     VALUES('small-expense-bills',%s,%s::jsonb)""",
                  (picture,json.dumps({"mimetype":"image/jpeg","size":1777})))
        bill=c.execute("""SELECT manage_site_small_expense_bill(%s,%s,%s,%s,%s,false)""",
                       (engineer_one,picture,"site-receipt.jpg","image/jpeg",1777)).fetchone()[0]
        assert c.execute("SELECT id FROM site_small_expense_bills").fetchall()==[(bill,)]
        assert c.execute("SELECT count(*) FROM storage.objects WHERE name=%s",(picture,)).fetchone()[0]==1
        denied(c,lambda:c.execute("SELECT manage_site_small_expense_bill(%s,%s,%s,%s,%s,false)",
                                 (engineer_two,picture,"site-receipt.jpg","image/jpeg",1777)),
               "not accessible")

        actor(c,site_two)
        assert c.execute("SELECT id FROM site_small_expenses").fetchall()==[(engineer_two,)]
        assert c.execute("SELECT count(*) FROM site_small_expense_bills").fetchone()[0]==0
        assert c.execute("SELECT count(*) FROM storage.objects WHERE name=%s",(picture,)).fetchone()[0]==0
        assert c.execute("SELECT count(*) FROM site_small_expense_events").fetchone()[0]==1
        actor(c,ACCOUNTS)
        assert {row[0] for row in c.execute("SELECT id FROM site_small_expenses")}=={
            engineer_one,engineer_two,manager}
        assert c.execute("SELECT count(*) FROM site_small_expense_bills").fetchone()[0]==1
        actor(c,DIRECTOR)
        assert c.execute("SELECT count(*) FROM site_small_expenses").fetchone()[0]==3
        denied(c,lambda:c.execute(record,(str(uuid4()),PROJECT,None,day,"office","40.00",
                                    "cash","Site supply shop","Director cannot record",None,None)))
        actor(c,ADMIN)
        assert c.execute("SELECT count(*) FROM site_small_expenses").fetchone()[0]==3

        # Assignment revocation blocks future entry and private records immediately.
        c.execute("RESET ROLE")
        c.execute("DELETE FROM user_project_assignments WHERE user_id=%s AND project_id=%s",
                  (SITE,PROJECT))
        actor(c,SITE)
        assert c.execute("SELECT count(*) FROM site_small_expenses").fetchone()[0]==0
        assert c.execute("SELECT count(*) FROM site_small_expense_bills").fetchone()[0]==0
        assert c.execute("SELECT count(*) FROM storage.objects WHERE name=%s",(picture,)).fetchone()[0]==0
        denied(c,lambda:c.execute(record,(str(uuid4()),PROJECT,None,day,"transport","80.00",
                                    "cash","Site supply shop","Assignment revoked",None,None)),
               "not accessible")
        c.rollback()
    print("PASS Site Engineer own-only RLS, other engineer privacy, company reviewer access, bills and revocation")


def test_po_review_correction_handoff():
    """0079: Director/Admin return, manager escalation, assigned site response and guard."""
    with db() as c:
        # Real fixture: Site Engineer creates and submits source PR, Director
        # approves it, then Purchase Manager creates the downstream PO.
        po=seed_po(c,PURCHASER,SITE)
        actor(c,PURCHASER)
        assert c.execute("SELECT po_transition(%s,'submitted','Send to Director')",(po,)).fetchone()[0]=="pending_approval"
        actor(c,OTHER_DIRECTOR)
        denied(c,lambda:c.execute("SELECT return_po_for_correction(%s,%s)",(
            po,"Wrong company must not return this order")))
        actor(c,SITE)
        denied(c,lambda:c.execute("SELECT return_po_for_correction(%s,%s)",(
            po,"Site staff must not return a PO")))
        actor(c,DIRECTOR)
        denied(c,lambda:c.execute("SELECT return_po_for_correction(%s,'Too short')",(po,)))
        assert str(c.execute("SELECT return_po_for_correction(%s,%s)",(
            po,"Please verify material specification with site")).fetchone()[0])==po
        assert c.execute("SELECT status FROM purchase_orders WHERE id=%s",(po,)).fetchone()[0]=="rejected"
        # A Director cannot SELECT another user's private notifications through
        # notification RLS. Inspect test-only rows as fixture owner instead.
        c.execute("RESET ROLE")
        assert c.execute("SELECT count(*) FROM notifications WHERE user_id=%s AND title LIKE 'PO %%returned for correction'",
            (PURCHASER,)).fetchone()[0]>=1
        actor(c,DIRECTOR)
        denied(c,lambda:c.execute("SELECT escalate_rejected_po_to_site(%s,%s)",(
            po,"Only procurement may escalate to the engineer")))
        actor(c,PURCHASER)
        ticket=c.execute("SELECT escalate_rejected_po_to_site(%s,%s)",(
            po,"Site quantity and requested specification need verification")).fetchone()[0]
        assert c.execute("SELECT status,assigned_to::text FROM po_site_correction_requests WHERE id=%s",
            (ticket,)).fetchone()==("requested",SITE)
        denied(c,lambda:c.execute("SELECT escalate_rejected_po_to_site(%s,%s)",(
            po,"Duplicate outstanding site issue must be blocked")))
        denied(c,lambda:c.execute("SELECT po_transition(%s,'submitted','before engineer replied')",(po,)),
               "Resolve the Site Engineer")
        actor(c,OTHER_DIRECTOR)
        denied(c,lambda:c.execute("SELECT respond_po_site_correction(%s,%s)",(
            ticket,"Outsider cannot respond to this site request")))
        actor(c,DIRECTOR)
        denied(c,lambda:c.execute("SELECT respond_po_site_correction(%s,%s)",(
            ticket,"Director cannot reply for site engineer")))
        actor(c,SITE)
        assert c.execute("SELECT count(*) FROM po_site_correction_requests WHERE id=%s",
                         (ticket,)).fetchone()[0]==1
        assert c.execute("SELECT respond_po_site_correction(%s,%s)",(
            ticket,"Correct site requirement is 4 pieces; Purchase Manager please adjust PO")).fetchone()[0]==ticket
        denied(c,lambda:c.execute("SELECT respond_po_site_correction(%s,%s)",(
            ticket,"Repeated response must not create a duplicate")))
        actor(c,PURCHASER)
        denied(c,lambda:c.execute("SELECT po_transition(%s,'submitted','before manager resolution')",(po,)),
               "Resolve the Site Engineer")
        denied(c,lambda:c.execute("SELECT resolve_po_site_correction(%s,'no')",(ticket,)))
        assert c.execute("SELECT resolve_po_site_correction(%s,%s)",(
            ticket,"Verified site clarification; purchase order is reconciled")).fetchone()[0]==ticket
        assert c.execute("SELECT po_transition(%s,'submitted','ready after engineer response')",(po,)).fetchone()[0]=="pending_approval"
        actor(c,DIRECTOR)
        assert c.execute("SELECT po_transition(%s,'approved','reviewed correction')",(po,)).fetchone()[0]=="approved"
        assert c.execute("SELECT count(*) FROM purchase_order_approvals WHERE po_id=%s AND action='rejected'",
                         (po,)).fetchone()[0]==1
        assert c.execute("SELECT count(*) FROM po_site_correction_requests WHERE po_id=%s AND status='resolved'",
                         (po,)).fetchone()[0]==1
        c.rollback()

    with db() as c:
        po=seed_po(c,PURCHASER)
        actor(c,PURCHASER)
        c.execute("SELECT po_transition(%s,'submitted','send to reviewers')",(po,))
        actor(c,ADMIN)
        assert str(c.execute("SELECT return_po_for_correction(%s,%s)",(
            po,"Accounts checked the quotation; return to the Purchase Manager")).fetchone()[0])==po
        assert c.execute("SELECT status FROM purchase_orders WHERE id=%s",(po,)).fetchone()[0]=="rejected"
        assert c.execute("SELECT count(*) FROM director_approval_votes WHERE entity_id=%s",(po,)).fetchone()[0]==0
        assert c.execute("SELECT count(*) FROM purchase_order_approvals WHERE po_id=%s AND action='rejected'",
                         (po,)).fetchone()[0]==1
        actor(c,PURCHASER)
        denied(c,lambda:c.execute("SELECT escalate_rejected_po_to_site(%s,%s)",(
            po,"Cannot escalate a Purchase Manager-created PR to Site Engineer")),
            "active Site Engineer")
        c.rollback()
    print("PASS 0079 PO return and escalation: Director/Admin, manager, engineer, guard, audit and permissions")


if __name__ == "__main__":
    setup()
    test_count_units_seed_is_idempotent()
    test_services_and_hours_master_seed()
    test_square_metre_unit_seed_is_idempotent()
    test_private_procurement_attachment_access()
    test_site_engineer_requires_project_assignment_for_pr()
    test_engineer_assigned_project_pr_po_visibility()
    from pr_0099_access_acceptance import exercise_pr_revocation
    exercise_pr_revocation(db,actor,denied,save_pr,ADMIN,SITE,PROJECT)
    test_quote_freight_gst_matches_supplier_and_po()
    test_atomic_requests_and_rfqs()
    test_pr_manager_received_notification()
    test_director_notifications_and_names()
    test_director_approved_po_alerts_original_pr_engineer_phone()
    test_director_origin_and_super_admin_purchasing()
    test_push_and_email_boundaries()
    test_real_payment_posting()
    test_super_admin_record_cleanup()
    test_concurrent_save_retries()
    test_staff_audit_classifier()
    test_structured_opening_bills_and_prior_paid()
    test_accounts_staff_material_create_edit_only()
    test_optional_invoice_roundoff_accounting()
    test_accounts_manager_finance_settings_permission()
    test_small_expense_in_place_and_bills()
    test_site_engineer_own_small_expense_scope()
    test_po_review_correction_handoff()
    test_google_sheets_retired_archives_preserved()
    from sales_0093_acceptance import exercise_sales
    exercise_sales(db,actor,denied,PROJECT,ADMIN,SITE,OTHER_DIRECTOR)
    from sales_0096_acceptance import exercise_commercial
    exercise_commercial(db,actor,denied,PROJECT,ADMIN,SITE,OTHER_DIRECTOR,A)
