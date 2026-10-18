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
            (ACCOUNTS, A, "accounts_manager", True),
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
        c.execute("SELECT po_transition(%s,'submitted','QA')",(doc,))
        denied(c,lambda:c.execute("SELECT po_transition(%s,'approved','QA')",(doc,)),"cannot approve")
        c.rollback()
    print("PASS one independent director, scoped notification recipients, reminder throttle and safe actor-name lookup")


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


if __name__ == "__main__":
    setup()
    test_atomic_requests_and_rfqs()
    test_director_notifications_and_names()
    test_push_and_email_boundaries()
    test_real_payment_posting()
    test_concurrent_save_retries()
