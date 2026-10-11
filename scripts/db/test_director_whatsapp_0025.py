"""0025 real SQL on the synthetic director_wa_qa database only. No Meta calls."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event
import time
from psycopg.types.json import Jsonb
from test_director_whatsapp_0024 import (
    ROOT, db, setup, as_actor, opt_in, prepare, rejected, ADMIN_A, DIRECTORS, PO_A,
)

def ingest(c, message, phone, status, timestamp=1791722017, error=None):
    return c.execute("SELECT public.wa_director_record_receipts(%s::jsonb)", (Jsonb([dict(
        message_id=message, recipient_id=phone, status=status,
        provider_timestamp=timestamp, error_code=error)]),)).fetchone()[0]

def finish(c, item, message):
    assert c.execute("SELECT public.wa_director_finish_claim("
        "%s::uuid,%s::uuid,'accepted',%s,'')", (item[0],item[1],message)).fetchone()[0]

def summary(c, item):
    return c.execute("SELECT status,delivery_status,delivery_error_code "
        "FROM public.director_wa_outbox WHERE id=%s::uuid", (item[0],)).fetchone()

def run():
    setup()
    with db() as c:
        c.execute((ROOT/"drizzle/migrations/0025_director_whatsapp_receipts.sql").read_text())
        assert c.execute("SELECT relrowsecurity FROM pg_class WHERE "
            "oid='public.director_wa_receipts'::regclass").fetchone()[0]
        for role in ("anon","authenticated"):
            for action in ("SELECT","INSERT","UPDATE","DELETE"):
                assert not c.execute("SELECT has_table_privilege(%s,"
                    "'public.director_wa_receipts',%s)",(role,action)).fetchone()[0]
            assert not c.execute("SELECT has_function_privilege(%s,"
                "'public.wa_director_record_receipts(jsonb)','EXECUTE')",(role,)).fetchone()[0]
        as_actor(c,ADMIN_A)
        for director in DIRECTORS: opt_in(c,director)
        assert prepare(c,"purchase_order",PO_A)==3
        rejected(c,lambda:ingest(c,"wamid.no_permission","919876543210","read"))
    with db() as c:
        c.execute("SET LOCAL ROLE service_role")
        items=c.execute("SELECT * FROM public.wa_director_claim_batch(3)").fetchall()
        assert len(items)==3
        first,early,concurrent=items
        finish(c,first,"wamid.first")
        assert summary(c,first)==("accepted",None,None)
        assert ingest(c,"wamid.first",first[2],"sent")==1
        assert ingest(c,"wamid.first",first[2],"sent")==0
        assert ingest(c,"wamid.first",first[2],"failed",error="131026")==1
        assert summary(c,first)==("accepted","failed","131026")
        assert ingest(c,"wamid.first",first[2],"delivered",1791722018)==1
        assert ingest(c,"wamid.first",first[2],"read",1791722019)==1
        # Late lower states, including failures, cannot erase read evidence.
        ingest(c,"wamid.first",first[2],"failed",1791722020,"131026")
        ingest(c,"wamid.first",first[2],"sent",1791722021)
        assert summary(c,first)==("accepted","read",None)
        # A valid message ID alone cannot update another recipient's record.
        ingest(c,"wamid.first",early[2],"read")
        assert summary(c,early)==("claimed",None,None)
        assert ingest(c,"wamid.early",early[2],"read")==1
        assert summary(c,early)==("claimed",None,None)
        finish(c,early,"wamid.early")
        assert summary(c,early)==("accepted","read",None)
        assert ingest(c,"wamid.unrelated","919999999999","read")==0
        rejected(c,lambda:ingest(c,"bad",first[2],"read"))
    print("PASS: ACL, deduplication, recipient correlation, early callback and monotonic evidence")

    # Exercise both commit orders using independent PostgreSQL connections.
    # Hold the receipt transaction while the worker tries to finish its claim.
    started=Event()
    def complete_worker():
        with db() as c:
            c.execute("SET LOCAL ROLE service_role")
            started.set()
            finish(c,concurrent,"wamid.concurrent")
    with ThreadPoolExecutor(max_workers=1) as pool:
        with db() as c:
            c.execute("SET LOCAL ROLE service_role")
            ingest(c,"wamid.concurrent",concurrent[2],"delivered")
            future=pool.submit(complete_worker)
            assert started.wait(5)
            time.sleep(.15)
            assert not future.done(), "Receipt lock must serialize worker completion"
        future.result(timeout=10)
    with db() as c:
        assert summary(c,concurrent)==("accepted","delivered",None)
        assert c.execute("SELECT count(*) FROM public.director_approval_votes").fetchone()[0]==0
        c.execute("UPDATE public.director_wa_receipts SET received_at=now()-interval '8 days' "
            "WHERE outbox_id IS NULL")
        c.execute("SET LOCAL ROLE service_role")
        ingest(c,"wamid.first",first[2],"read",1791722019)
        assert c.execute("SELECT count(*) FROM public.director_wa_receipts "
            "WHERE outbox_id IS NULL").fetchone()[0]==0
    with db() as c:
        as_actor(c,DIRECTORS[0])
        assert c.execute("SELECT count(*) FROM public.director_wa_outbox "
            "WHERE delivery_status IS NOT NULL").fetchone()[0]==1
        rejected(c,lambda:c.execute("SELECT * FROM public.director_wa_receipts"))
    print("PASS: concurrent receipt/worker transactions, audit isolation, no votes and private inbox expiry")

if __name__=="__main__": run()
