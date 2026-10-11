"""Real migration 0024 in disposable PostgreSQL: director consent, queue, leases.

No Meta API calls, no real data, NO live database. Uses synthetic 0012/0013
director fixture and the actual source phone normalizer from 0022.
"""
from __future__ import annotations
import os
from pathlib import Path
import psycopg

ROOT=Path(__file__).resolve().parents[2]
DSN=os.getenv("DIRECTOR_WA_QA_DSN")
ADMIN_A="10000000-0000-4000-8000-000000000006"
ADMIN_B="10000000-0000-4000-8000-000000000014"
DIRECTORS=[f"10000000-0000-4000-8000-{i:012d}" for i in (1,2,3)]
PO_A="30000000-0000-4000-8000-000000000001"
PO_B="30000000-0000-4000-8000-000000000005"
PAY_A="40000000-0000-4000-8000-000000000001"
A="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
B="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"

def db():
    if os.getenv("CI")!="true" or not DSN: raise RuntimeError("CI-only disposable director WhatsApp QA")
    c=psycopg.connect(DSN,application_name="director-wa-0024-disposable")
    if c.execute("SELECT current_database()").fetchone()[0]!="director_wa_qa":
        c.close();raise RuntimeError("Refusing any real database")
    c.commit()
    return c

def setup():
    with db() as c:
        c.autocommit=True
        c.execute((ROOT/"scripts/db/fixtures/director_approvals_disposable.sql").read_text())
        # Mirror Supabase service_role, which bypasses RLS in the real API.
        c.execute("ALTER ROLE service_role BYPASSRLS")
        c.execute("CREATE TABLE public.companies(id uuid PRIMARY KEY)")
        c.execute("INSERT INTO public.companies(id) VALUES(%s::uuid),(%s::uuid)",(A,B))
        c.execute("ALTER TABLE public.profiles ADD COLUMN phone text")
        for i,director in enumerate(DIRECTORS):
            c.execute("UPDATE public.profiles SET phone=%s WHERE id=%s::uuid",
                      ("98765432"+str(i+10),director))
        c.execute("INSERT INTO public.user_roles(user_id,role) VALUES(%s::uuid,'super_admin')",(ADMIN_A,))
        c.execute("""CREATE FUNCTION public.has_role(_uid uuid,_role text) RETURNS boolean
          LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public AS $$
          SELECT EXISTS(SELECT 1 FROM public.user_roles
          WHERE user_id=_uid AND role=_role)
        $$""")
        c.execute("""CREATE FUNCTION public.actor_in_company(_company uuid) RETURNS boolean
          LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public AS $$
          SELECT EXISTS(SELECT 1 FROM public.profiles
          WHERE id=auth.uid() AND is_active AND company_id=_company)
        $$""")
        for file in ("0012_three_director_approvals.sql","0013_company_scoped_director_votes.sql"):
            c.execute((ROOT/"drizzle/migrations"/file).read_text())
        # Load the actual normalization source from the earlier queued migration.
        src=(ROOT/"drizzle/migrations/0022_whatsapp_consent_outbox.sql").read_text()
        head="CREATE OR REPLACE FUNCTION public.wa_normalize_mobile("
        tail=src[src.index(head):]
        sql=tail[:tail.index("\n$$;")+4]
        c.execute(sql)
        c.execute((ROOT/"drizzle/migrations/0024_director_whatsapp_outbox.sql").read_text())
        for table in ("director_wa_consents","director_wa_consent_events","director_wa_outbox","director_wa_outbox_events"):
            assert c.execute("SELECT relrowsecurity FROM pg_class WHERE oid=%s::regclass",
                 ("public."+table,)).fetchone()[0] is True
            for action in ("INSERT","UPDATE","DELETE"):
                assert not c.execute("SELECT has_table_privilege('authenticated',%s,%s)",
                    ("public."+table,action)).fetchone()[0]
        assert not c.execute("SELECT has_function_privilege('authenticated',"
          "'public.wa_director_claim_batch(integer)','EXECUTE')").fetchone()[0]
        assert c.execute("SELECT has_function_privilege('service_role',"
          "'public.wa_director_claim_batch(integer)','EXECUTE')").fetchone()[0]

def as_actor(c,actor):
    c.execute("SET LOCAL ROLE authenticated")
    c.execute("SELECT set_config('qa.actor',%s,true)",(actor,))

def rejected(c,call):
    c.execute("SAVEPOINT expected_error")
    try:call()
    except psycopg.Error:
        c.execute("ROLLBACK TO SAVEPOINT expected_error")
        c.execute("RELEASE SAVEPOINT expected_error")
        return
    c.execute("ROLLBACK TO SAVEPOINT expected_error")
    c.execute("RELEASE SAVEPOINT expected_error")
    raise AssertionError("Server failed to reject an unauthorized action")

def opt_in(c,director,granted=True):
    return c.execute("SELECT public.wa_set_director_consent(%s::uuid,%s,%s)",
      (director,granted,"Director explicitly confirmed via office call 11 October")).fetchone()[0]

def prepare(c,kind,id):
    return c.execute("SELECT public.wa_prepare_director_notification(%s,%s::uuid)",(kind,id)).fetchone()[0]

def test_admin_consent_and_idempotent_notification():
    with db() as c:
        as_actor(c,ADMIN_A)
        assert prepare(c,"purchase_order",PO_A)==0
        for idx,d in enumerate(DIRECTORS):
            opt_in(c,d)
            assert prepare(c,"purchase_order",PO_A)==1
        assert prepare(c,"purchase_order",PO_A)==0
        assert c.execute("SELECT count(*) FROM public.director_wa_outbox "
             "WHERE entity_type='purchase_order' AND entity_id=%s::uuid",(PO_A,)).fetchone()[0]==3
        assert prepare(c,"vendor_payment",PAY_A)==3
        assert prepare(c,"vendor_payment",PAY_A)==0
        rejected(c,lambda:prepare(c,"purchase_order",PO_B))
        rejected(c,lambda:c.execute("INSERT INTO public.director_wa_outbox("
          "company_id,director_id,entity_type,entity_id,stage,phone_e164) "
          "VALUES(%s::uuid,%s::uuid,'purchase_order',%s::uuid,'initial','919876543210')",
          (A,DIRECTORS[0],PO_A)))
        assert c.execute("SELECT count(*) FROM public.director_wa_consent_events").fetchone()[0]==3
    with db() as c:
        as_actor(c,DIRECTORS[0])
        assert c.execute("SELECT count(*) FROM public.director_wa_outbox").fetchone()[0]==2
        rejected(c,lambda:opt_in(c,DIRECTORS[1]))
        rejected(c,lambda:prepare(c,"purchase_order",PO_A))
    with db() as c:
        as_actor(c,ADMIN_B)
        assert c.execute("SELECT count(*) FROM public.director_wa_outbox").fetchone()[0]==0
        rejected(c,lambda:prepare(c,"purchase_order",PO_A))
    print("PASS: explicit consent, one alert per director/document, RLS and company scope")

def test_claim_lease_and_revocation():
    with db() as c:
        c.execute("SET LOCAL ROLE service_role")
        items=c.execute("SELECT * FROM public.wa_director_claim_batch(3)").fetchall()
        assert len(items)==3
        for x in items:
            assert x[3] in ("purchase_order","vendor_payment")
            assert c.execute("SELECT public.wa_director_claim_valid(%s::uuid,%s::uuid)",
               (x[0],x[1])).fetchone()[0]
        assert c.execute("SELECT public.wa_director_finish_claim("
          "%s::uuid,%s::uuid,'accepted','wamid.test.001','')",
          (items[0][0],items[0][1])).fetchone()[0]
        assert c.execute("SELECT public.wa_director_finish_claim("
          "%s::uuid,%s::uuid,'accepted','wamid.test.001','')",
          (items[0][0],items[0][1])).fetchone()[0] is False
        assert c.execute("SELECT public.wa_director_finish_claim("
          "%s::uuid,%s::uuid,'unknown',NULL,'network_uncertain')",
          (items[1][0],items[1][1])).fetchone()[0]
        assert c.execute("SELECT public.wa_director_finish_claim("
          "%s::uuid,%s::uuid,'rejected',NULL,'meta_http_400')",
          (items[2][0],items[2][1])).fetchone()[0]
        assert c.execute("SELECT count(*) FROM public.director_wa_outbox WHERE status='accepted'").fetchone()[0]==1
    with db() as c:
        as_actor(c,ADMIN_A)
        # Create a guaranteed pending reminder target. Earlier queue claims
        # are intentionally ordered by UUID within a shared timestamp.
        assert prepare(c,"purchase_order","30000000-0000-4000-8000-000000000002")==3
        opt_in(c,DIRECTORS[0],False)
        assert c.execute("SELECT count(*) FROM public.director_wa_outbox "
          "WHERE director_id=%s::uuid AND status='queued'",(DIRECTORS[0],)).fetchone()[0]==0
        assert prepare(c,"purchase_order",PO_A)==0
    with db() as c:
        c.execute("SET LOCAL ROLE service_role")
        assert c.execute("SELECT count(*) FROM public.director_wa_outbox WHERE status='skipped'").fetchone()[0]>=1
    print("PASS: unique claims, no duplicate completion, explicit Meta status and opt-out")

if __name__=="__main__":
    setup()
    test_admin_consent_and_idempotent_notification()
    test_claim_lease_and_revocation()
    print("PASS: 0024 real schema and functions in disposable PostgreSQL")
