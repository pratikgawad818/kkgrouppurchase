"""Real PostgreSQL acceptance test for the Director notification allowlist.
Uses disposable CI PostgreSQL only; never connects to production.
"""
from __future__ import annotations
import os
from pathlib import Path
import psycopg

dsn = os.environ["DIRECTOR_NOTIFY_QA_DSN"]
migration = Path("drizzle/migrations/0115_director_approval_notifications_only.sql").read_text()
setup = """
DO $
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    CREATE ROLE anon;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
END $;
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, company_id uuid NOT NULL, is_active boolean NOT NULL
);
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role text NOT NULL);
CREATE TABLE public.permissions (user_id uuid NOT NULL, perm text NOT NULL);
CREATE TABLE public.project_access (user_id uuid NOT NULL, project_id uuid NOT NULL);
CREATE TABLE public.purchase_orders (
  id uuid PRIMARY KEY, company_id uuid NOT NULL,
  project_id uuid NOT NULL, created_by uuid NOT NULL, status text NOT NULL
);
CREATE TABLE public.vendor_payments (
  id uuid PRIMARY KEY, company_id uuid NOT NULL, project_id uuid,
  created_by uuid NOT NULL, status text NOT NULL, kind text NOT NULL
);
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, title text NOT NULL, body text, link text
);
CREATE TABLE public.push_spy (id uuid);
CREATE FUNCTION public.push_spy_notification()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO public.push_spy(id) VALUES (NEW.id); RETURN NEW; END $$;
CREATE TRIGGER push_spy_notification AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.push_spy_notification();

CREATE FUNCTION public.has_permission(_uid uuid,_perm text)
RETURNS boolean LANGUAGE sql STABLE AS $$
SELECT EXISTS(SELECT 1 FROM public.permissions WHERE user_id=_uid AND perm=_perm);
$$;
CREATE FUNCTION public.can_access_project(_uid uuid,_project uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
SELECT EXISTS(SELECT 1 FROM public.project_access
WHERE user_id=_uid AND project_id=_project);
$$;
"""
def u(n: int) -> str:
    return "00000000-0000-4000-8000-" + str(n).zfill(12)

director = u(1)
po_creator = u(2)
ordinary_staff = u(3)
another_director = u(4)
company = u(11)
other_company = u(12)
project = u(21)
other_project = u(22)
po_pending = u(31)
po_approved = u(32)
po_other = u(33)
invoice_scheduled = u(41)
invoice_recorded = u(42)
vendor_advance = u(43)
invoice_other_project = u(44)
invoice_self = u(45)

with psycopg.connect(dsn) as conn:
    with conn.cursor() as cur:
        cur.execute(setup)
        cur.execute(migration)
        cur.executemany(
            "INSERT INTO public.profiles VALUES (%s,%s,%s)",
            [(director,company,True),(po_creator,company,True),
             (ordinary_staff,company,True),(another_director,other_company,True)],
        )
        cur.executemany(
            "INSERT INTO public.user_roles VALUES (%s,%s)",
            [(director,"director"),(po_creator,"director"),(ordinary_staff,"purchase_manager"),
             (another_director,"director")],
        )
        cur.executemany(
            "INSERT INTO public.permissions VALUES (%s,%s)",
            [(director,"purchase_order.approve"),(director,"payment.approve"),
             (po_creator,"purchase_order.approve"),(po_creator,"payment.approve"),
             (another_director,"purchase_order.approve"),(another_director,"payment.approve")],
        )
        cur.executemany(
            "INSERT INTO public.project_access VALUES (%s,%s)",
            [(director,project),(po_creator,project),(another_director,other_project)],
        )
        cur.executemany(
            "INSERT INTO public.purchase_orders VALUES (%s,%s,%s,%s,%s)",
            [(po_pending,company,project,po_creator,"pending_approval"),
             (po_approved,company,project,po_creator,"approved"),
             (po_other,other_company,other_project,ordinary_staff,"pending_approval")],
        )
        cur.executemany(
            "INSERT INTO public.vendor_payments VALUES (%s,%s,%s,%s,%s,%s)",
            [(invoice_scheduled,company,project,po_creator,"scheduled","invoice"),
             (invoice_recorded,company,project,po_creator,"recorded","invoice"),
             (vendor_advance,company,project,po_creator,"scheduled","advance"),
             (invoice_other_project,company,other_project,po_creator,"scheduled","invoice"),
             (invoice_self,company,project,director,"scheduled","invoice")],
        )

        def alert(user: str, label: str, link: str) -> bool:
            cur.execute(
                "INSERT INTO public.notifications(user_id,title,link) "
                "VALUES (%s,%s,%s) RETURNING id", (user,label,link),
            )
            return cur.fetchone() is not None

        po_link = lambda item: f"/approvals?kind=purchase_order&id={item}"
        payment_link = lambda item: f"/approvals?kind=vendor_payment&id={item}"

        cases = [
            ("active PO approval",director,po_link(po_pending),True),
            ("active invoice payment",director,payment_link(invoice_scheduled),True),
            ("PR review",director,f"/procurement/purchase-requests/{u(100)}",False),
            ("invoice review",director,f"/finance/vendor-invoices/{u(101)}",False),
            ("challan",director,f"/inventory/delivery-challans/{u(102)}",False),
            ("ordinary PO update",director,f"/procurement/purchase-orders/{po_pending}",False),
            ("completed PO",director,po_link(po_approved),False),
            ("other-company PO",director,po_link(po_other),False),
            ("recorded payment",director,payment_link(invoice_recorded),False),
            ("vendor advance",director,payment_link(vendor_advance),False),
            ("inaccessible project payment",director,payment_link(invoice_other_project),False),
            ("self-created payment",director,payment_link(invoice_self),False),
            ("self-created PO",po_creator,po_link(po_pending),False),
            ("malformed link",director,"/approvals?kind=purchase_order&id=not-a-uuid",False),
            ("non-Director PR",ordinary_staff,f"/procurement/purchase-requests/{u(100)}",True),
            ("non-Director invoice",ordinary_staff,f"/finance/vendor-invoices/{u(101)}",True),
        ]
        for label,user,link,expected in cases:
            actual = alert(user,label,link)
            assert actual == expected, f"{label}: expected {expected}, got {actual}"

        cur.execute("SELECT count(*) FROM public.notifications")
        rows = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM public.push_spy")
        pushes = cur.fetchone()[0]
        assert rows == 4, f"Expected exactly 4 retained alerts, got {rows}"
        assert pushes == 4, f"Suppressed Director alerts must not dispatch push: {pushes}"
        cur.execute("SELECT count(*) FROM public.purchase_orders")
        assert cur.fetchone()[0] == 3
        cur.execute("SELECT count(*) FROM public.vendor_payments")
        assert cur.fetchone()[0] == 5
    # Disposable DB is thrown away after CI; nothing reaches production.
print("PASS Director notifications: 2 actionable Director alerts, 2 staff alerts; all others blocked before push")
