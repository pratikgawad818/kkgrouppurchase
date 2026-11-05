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
          CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
          ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
          GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon,service_role;
          GRANT ALL ON storage.objects TO authenticated,service_role;
          CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
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


def seed_po(c, creator=PURCHASER):
    actor(c,PURCHASER)
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



def test_director_notifications_and_names():
    with db() as c:
        doc=seed_po(c)
        actor(c,PURCHASER)
        c.execute("SELECT po_transition(%s,'submitted','QA')",(doc,))
        c.execute("RESET ROLE")
        recipients=c.execute("SELECT user_id,link FROM notifications WHERE link LIKE %s",('%'+doc,)).fetchall()
        assert {str(r[0]) for r in recipients}=={DIRECTOR},recipients
        assert all('kind=purchase_order&id=' in r[1] for r in recipients)
        actor(c,PURCHASER)
        c.execute("SELECT remind_po_approvers(%s)",(doc,))
        c.execute("SELECT remind_po_approvers(%s)",(doc,))
        c.execute("RESET ROLE")
        assert c.execute("SELECT count(*) FROM approval_reminder_events WHERE po_id=%s",(doc,)).fetchone()[0]==2
        assert c.execute("SELECT count(*) FROM notifications WHERE user_id=%s AND title LIKE 'Reminder:%%' AND link LIKE %s",(DIRECTOR,'%'+doc)).fetchone()[0]==2
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
        assert c.execute("SELECT po_transition(%s,'submitted','QA')",(doc,)).fetchone()[0]=='approved'
        assert str(c.execute("SELECT approved_by FROM purchase_orders WHERE id=%s",(doc,)).fetchone()[0])==DIRECTOR
        assert c.execute("SELECT count(*) FROM director_approval_votes WHERE entity_id=%s",(doc,)).fetchone()[0]==0
        assert c.execute("SELECT count(*) FROM purchase_order_approvals WHERE po_id=%s AND action='approved'",(doc,)).fetchone()[0]==1
        c.rollback()
    print("PASS one independent director, scoped notification recipients, reminder throttle and safe actor-name lookup")



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
        assert c.execute("SELECT po_transition(%s,'submitted','Director finalized')",(order,)).fetchone()[0]=='approved'
        source=c.execute("SELECT purchase_request_id,rfq_id,quotation_id,created_by,approved_by FROM purchase_orders WHERE id=%s",(order,)).fetchone()
        assert str(source[0])==doc and source[1]==rid and source[2]==quote and str(source[3])==DIRECTOR and source[3]==source[4],source
        assert c.execute("SELECT count(*) FROM purchase_order_items WHERE po_id=%s",(order,)).fetchone()[0]==1
        actor(c,PURCHASER)
        own=save_pr(c,submit=True)
        assert c.execute("SELECT status FROM purchase_requests WHERE id=%s",(own,)).fetchone()[0]=='pending_approval'
        denied(c,lambda:c.execute("SELECT pr_transition(%s,'approved','self')",(own,)),"own request")
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
        assert c.execute("SELECT po_transition(%s,'submitted','Finalize my existing order')",(doc,)).fetchone()[0]=='approved'
        c.rollback()
    print("PASS Director-owned PR/PO finalize with audit history; Super Admin and dual-role POs require one independent company Director")

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
        def approve_regular(name,charges,rounding,net,delta,round_code):
            # The QA fixture inserts a pre-matched payable directly as the
            # privileged test setup role. Staff can only create via the RPC.
            c.execute("RESET ROLE")
            record=str(c.execute("""INSERT INTO vendor_invoices(
                invoice_number,company_id,vendor_id,project_id,vendor_invoice_number,
                vendor_invoice_date,subtotal,tax_total,freight,grand_total,
                tds_amount,net_payable,balance_due,status,created_by,round_off_mode,round_off_amount)
                VALUES(%s,%s,%s,%s,%s,'2026-11-01',100,18,%s,%s,0,%s,%s,
                    'pending_review',%s,%s,%s) RETURNING id""",
                (name,A,VENDOR,PROJECT,name,charges,net,net,net,ACCOUNTS,rounding,delta)).fetchone()[0])
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


if __name__ == "__main__":
    setup()
    test_atomic_requests_and_rfqs()
    test_director_notifications_and_names()
    test_director_origin_and_super_admin_purchasing()
    test_push_and_email_boundaries()
    test_real_payment_posting()
    test_super_admin_record_cleanup()
    test_concurrent_save_retries()
    test_staff_audit_classifier()
    test_structured_opening_bills_and_prior_paid()
    test_accounts_staff_material_create_edit_only()
    test_optional_invoice_roundoff_accounting()
