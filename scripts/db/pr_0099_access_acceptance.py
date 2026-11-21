"""0099 regression: project assignment revocation blocks reads AND draft writes.

Uses only the disposable hardening_qa database and rolls back every fixture.
No production request or assignment is changed by these checks.
"""
def exercise_pr_revocation(db, actor, denied, save_pr, admin, site, project):
    with db() as c:
        actor(c, site)
        pr_id=save_pr(c,submit=False,purpose="Verify project assignment revocation")
        items=c.execute(
            "SELECT id FROM purchase_request_items WHERE purchase_request_id=%s",
            (pr_id,)).fetchall()
        assert len(items)==1, items
        item_id=items[0][0]
        assert c.execute("SELECT count(*) FROM purchase_requests WHERE id=%s",
            (pr_id,)).fetchone()[0]==1

        actor(c, admin)
        revoked=c.execute(
            "DELETE FROM user_project_assignments WHERE user_id=%s AND project_id=%s RETURNING project_id",
            (site,project)).fetchone()
        assert revoked is not None,"Site user had no project assignment to revoke"
        actor(c, site)
        assert not c.execute("SELECT can_access_project(auth.uid(),%s)",(project,)).fetchone()[0]
        assert c.execute("SELECT count(*) FROM purchase_requests WHERE id=%s",
            (pr_id,)).fetchone()[0]==0,"RLS still allows the author to read a revoked project PR"
        assert c.execute("SELECT count(*) FROM purchase_request_items WHERE id=%s",
            (item_id,)).fetchone()[0]==0,"RLS still reveals revoked PR items"
        assert c.execute("SELECT count(*) FROM purchase_request_approvals WHERE purchase_request_id=%s",
            (pr_id,)).fetchone()[0]==0,"RLS still reveals revoked PR history"

        # Direct SQL is intentionally tested alongside the SECURITY DEFINER
        # application RPC: revocation must block both paths.
        result=c.execute("UPDATE purchase_requests SET purpose='unauthorized edit' WHERE id=%s",
            (pr_id,))
        assert result.rowcount==0,"Former requester updated a revoked PR"
        result=c.execute("DELETE FROM purchase_requests WHERE id=%s",(pr_id,))
        assert result.rowcount==0,"Former requester deleted a revoked PR"
        result=c.execute("UPDATE purchase_request_items SET description='unauthorized' WHERE id=%s",
            (item_id,))
        assert result.rowcount==0,"Former requester updated revoked PR items"
        result=c.execute("DELETE FROM purchase_request_items WHERE id=%s",(item_id,))
        assert result.rowcount==0,"Former requester deleted revoked PR items"
        denied(c,lambda:c.execute(
            "SELECT pr_transition(%s,'submitted',NULL)",(pr_id,)),"access to this project")

        actor(c,admin)
        c.execute("INSERT INTO user_project_assignments(user_id,project_id) VALUES(%s,%s)",
            (site,project))
        actor(c,site)
        assert c.execute("SELECT count(*) FROM purchase_requests WHERE id=%s",
            (pr_id,)).fetchone()[0]==1,"Restored project assignment did not restore access"
        assert c.execute("SELECT count(*) FROM purchase_request_items WHERE id=%s",
            (item_id,)).fetchone()[0]==1,"Restored project assignment did not restore item access"

        # No real data survives the disposable test.
        c.rollback()
    print("PASS 0099: PR creator loses read/modify/delete/transition access on project revocation")
