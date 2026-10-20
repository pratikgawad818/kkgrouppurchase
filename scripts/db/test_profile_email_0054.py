"""Real PostgreSQL OTP security tests. Disposable local/CI fixture; never sends email."""
import os
from pathlib import Path
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
import psycopg

DSN = os.environ.get("EMAIL_OTP_QA_DSN")
assert os.getenv("CI") == "true" and DSN, "Requires a disposable CI database"

def db():
    c=psycopg.connect(DSN)
    assert c.execute("select current_database()").fetchone()[0]=="email_otp_qa", "Refusing non-test database"
    c.commit()
    return c

with db() as c:
    c.execute("""
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth;
      GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
      CREATE TABLE auth.users(id uuid PRIMARY KEY,email text UNIQUE,email_confirmed_at timestamptz,updated_at timestamptz,
        email_change text,email_change_token_current text,email_change_token_new text,email_change_confirm_status integer,email_change_sent_at timestamptz);
      CREATE TABLE auth.identities(user_id uuid REFERENCES auth.users(id),provider text,identity_data jsonb,updated_at timestamptz);
      CREATE TABLE public.profiles(id uuid PRIMARY KEY,email text,is_active boolean,company_id uuid);
      CREATE TABLE public.audit_logs(user_id uuid,action text,entity text,entity_id text,old_data jsonb,new_data jsonb);
    """)
    c.execute((Path(__file__).resolve().parents[2]/"drizzle/migrations/0054_profile_email_otp.sql").read_text())

def user(email,active=True):
    uid=uuid4()
    with db() as c:
        c.execute("insert into auth.users(id,email) values(%s,%s)",(uid,email))
        c.execute("insert into auth.identities values(%s,'email',%s::jsonb,now())",(uid,'{"email":"'+email+'","sub":"preserved"}'))
        c.execute("insert into profiles values(%s,%s,%s,%s)",(uid,email,active,uuid4()))
    return uid

def begin(uid,email):
    rid=uuid4()
    with db() as c:
        c.execute("set local role service_role")
        data=c.execute("select begin_profile_email_otp(%s,%s,%s,%s,%s)",(uid,rid,email,'a'*64,'b'*64)).fetchone()[0]
    return data

def verify(uid,rid,side,code):
    with db() as c:
        c.execute("set local role service_role")
        return c.execute("select verify_profile_email_otp(%s,%s,%s,%s)",(uid,rid,side,code)).fetchone()[0]

def fails(action,text):
    try: action()
    except psycopg.Error as e: assert text.lower() in str(e).lower(),str(e)
    else: raise AssertionError("Unexpectedly allowed unsafe action")

def email(uid):
    with db() as c:return c.execute("select email from auth.users where id=%s",(uid,)).fetchone()[0]

u=user('existing@example.test');p=begin(u,'new@example.test');rid=p['id']
assert p['oldEmail']=='existing@example.test' and not p['oldVerified']
assert verify(u,rid,'new','b'*64)['complete'] is False
assert email(u)=='existing@example.test', 'One inbox must never change a real email'
assert verify(u,rid,'old','a'*64)['complete'] is True
assert email(u)=='new@example.test'
assert not verify(u,rid,'old','a'*64)['ok'], 'OTP replay must fail'
with db() as c:
    identity=c.execute("select identity_data from auth.identities where user_id=%s",(u,)).fetchone()[0]
    assert identity['email']=='new@example.test' and identity['email_verified'] and identity['sub']=='preserved'
    assert c.execute("select email from profiles where id=%s",(u,)).fetchone()[0]=='new@example.test'
    assert c.execute("select count(*) from audit_logs where user_id=%s and action='email_verified'",(u,)).fetchone()[0]==1
print('PASS both-inbox requirement, new-first ordering, identity/profile sync, audit and replay rejection')
u=user('staff.name@staff.kkgroup.local');p=begin(u,'first@example.test')
assert p['oldEmail'] is None and p['oldVerified']
assert email(u).endswith('@staff.kkgroup.local')
assert verify(u,p['id'],'new','b'*64)['complete']
assert email(u)=='first@example.test'
print('PASS first real email requires exactly one new-inbox proof')
u=user('attempts@example.test');p=begin(u,'attempt-new@example.test')
for _ in range(5):assert not verify(u,p['id'],'new','c'*64)['ok']
assert not verify(u,p['id'],'new','b'*64)['ok']
fails(lambda:begin(u,'another@example.test'),'60 seconds')
assert email(u)=='attempts@example.test'
print('PASS incorrect attempts commit, five-attempt lockout and resend throttle')
u=user('expired@example.test');p=begin(u,'expired-new@example.test')
with db() as c:c.execute("update profile_email_challenges set expires_at=now()-interval '1 second' where user_id=%s",(u,))
assert not verify(u,p['id'],'new','b'*64)['ok']
u2=user('other@example.test')
assert not verify(u2,p['id'],'new','b'*64)['ok']
fails(lambda:begin(u2,'new@example.test'),'already in use')
fails(lambda:begin(user('inactive@example.test',False),'inactive-new@example.test'),'active staff')
print('PASS expiry, wrong account, duplicate destination and inactive account')
u=user('resend@example.test');p=begin(u,'resend-new@example.test');assert verify(u,p['id'],'old','a'*64)['ok']
with db() as c:c.execute("update profile_email_challenges set sent_at=now()-interval '61 seconds' where user_id=%s",(u,))
p2=begin(u,'replacement@example.test');assert not p2['oldVerified']
assert not verify(u,p['id'],'new','b'*64)['ok']
with db() as c:c.execute("update profile_email_challenges set sent_at=now()-interval '61 seconds',sends=5 where user_id=%s",(u,))
fails(lambda:begin(u,'excess@example.test'),'too many requests')
print('PASS replacement invalidates old codes and approval; hourly sending cap')
u=user('race@example.test');p=begin(u,'race-new@example.test')
with ThreadPoolExecutor(2) as pool:
    a=pool.submit(verify,u,p['id'],'old','a'*64);b=pool.submit(verify,u,p['id'],'new','b'*64)
    assert a.result()['ok'] and b.result()['ok']
assert email(u)=='race-new@example.test'
u=user('changed@example.test');p=begin(u,'changed-new@example.test')
with db() as c:c.execute("update auth.users set email='external-change@example.test' where id=%s",(u,))
assert not verify(u,p['id'],'new','b'*64)['ok']
print('PASS concurrent inbox verification serializes; externally changed identity invalidates proof')
for role in ['anon','authenticated']:
    with db() as c:
        for operation in ["select * from profile_email_challenges", "select begin_profile_email_otp(null,null,null,null,null)", "select verify_profile_email_otp(null,null,null,null)"]:
            c.execute('savepoint denied');c.execute('set local role '+role)
            try:c.execute(operation)
            except psycopg.Error: c.execute('rollback to savepoint denied')
            else: raise AssertionError(role+' could access private OTP material or privileged finalizer')
print('PASS anonymous and authenticated callers cannot access OTP hashes or privileged verification RPCs')
