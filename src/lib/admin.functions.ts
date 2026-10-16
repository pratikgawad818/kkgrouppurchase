import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { validateStaffUpdate } from "@/lib/staff-access";

const roleSchema = z.enum([
  "super_admin",
  "director",
  "purchase_manager",
  "store_manager",
  "accounts_manager",
  "accountant",
  "project_manager",
  "site_engineer",
  "auditor",
]);

const assignable = roleSchema.exclude(["super_admin"]);

export const inviteStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        email: z.string().trim().email().max(255),
        fullName: z.string().trim().min(1).max(120),
        phone: z.string().trim().max(20).optional().default(""),
        department: z.string().trim().max(80).optional().default(""),
        designation: z.string().trim().max(80).optional().default(""),
        role: assignable,
        redirectTo: z.string().url(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: allowed, error: permissionError } = await context.supabase.rpc("has_permission", {
      _user_id: context.userId,
      _code: "users.manage",
    });
    if (permissionError || !allowed) throw new Error("You do not have permission to create staff.");
    const { data: me, error: profileError } = await context.supabase
      .from("profiles")
      .select("company_id,is_active")
      .eq("id", context.userId)
      .single();
    if (profileError || !me?.is_active || !me.company_id)
      throw new Error("Your account needs an active company before inviting staff.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Never trust a caller-chosen destination: only same-origin /reset-password is allowed.
    const { getRequest } = await import("@tanstack/react-start/server");
    const origin = new URL(getRequest().url).origin;
    const safeRedirect = `${origin}/reset-password`;
    const { data: invited, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
      redirectTo: safeRedirect,
      data: { full_name: data.fullName },
    });
    if (error) throw new Error(error.message);
    const id = invited.user.id;
    const { error: pErr } = await supabaseAdmin.from("profiles").upsert({
      id,
      email: data.email,
      full_name: data.fullName,
      phone: data.phone || null,
      department: data.department || null,
      designation: data.designation || null,
      company_id: me.company_id,
      is_active: true,
    });
    if (pErr) throw new Error(pErr.message);
    const { error: rErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: id, role: data.role });
    if (rErr) throw new Error(rErr.message);
    return { ok: true };
  });

export const updateStaffAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        userId: z.string().uuid(),
        role: roleSchema.nullable(),
        active: z.boolean(),
        phone: z.string().trim().max(20).optional(),
        department: z.string().trim().max(80).optional(),
        designation: z.string().trim().max(80).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: allowed, error: permissionError } = await context.supabase.rpc("has_permission", {
      _user_id: context.userId,
      _code: "users.manage",
    });
    if (permissionError || !allowed)
      throw new Error("You do not have permission to manage staff access.");
    const [actor, target, existing, superResult] = await Promise.all([
      context.supabase
        .from("profiles")
        .select("company_id,is_active")
        .eq("id", context.userId)
        .single(),
      context.supabase.from("profiles").select("id,company_id").eq("id", data.userId).single(),
      context.supabase.from("user_roles").select("role").eq("user_id", data.userId),
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "super_admin" }),
    ]);
    if (actor.error || !actor.data?.is_active || !actor.data.company_id)
      throw new Error("Your account has no active company.");
    if (target.error || !target.data || existing.error || superResult.error) {
      throw new Error("Staff account or role assignments could not be verified.");
    }
    const decision = validateStaffUpdate({
      actorId: context.userId,
      actorCompanyId: actor.data.company_id,
      targetId: target.data.id,
      targetCompanyId: target.data.company_id,
      actorIsSuperAdmin: !!superResult.data,
      existingRoles: existing.data.map((item) => item.role),
      requestedRole: data.role,
      requestedActive: data.active,
    });
    const { data: changed, error: profileError } = await context.supabase
      .from("profiles")
      .update({
        is_active: data.active,
        ...(data.phone !== undefined && { phone: data.phone || null }),
        ...(data.department !== undefined && { department: data.department || null }),
        ...(data.designation !== undefined && { designation: data.designation || null }),
      })
      .eq("id", data.userId)
      .eq("company_id", actor.data.company_id)
      .select("id")
      .single();
    if (profileError || !changed)
      throw new Error("Staff details could not be updated in your company.");
    if (decision.changeRoles && !decision.preserveSuperAdmin) {
      const { error: deleteError } = await context.supabase
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId);
      if (deleteError) throw deleteError;
      if (data.role) {
        const { error: insertError } = await context.supabase
          .from("user_roles")
          .insert({ user_id: data.userId, role: data.role });
        if (insertError) throw insertError;
      }
    }
    return { ok: true };
  });
export const createStaffAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        username: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9._-]{3,32}$/, "Username: 3–32 letters, numbers, dot, dash or underscore"),
        password: z.string().min(8, "Password must be at least 8 characters").max(72),
        fullName: z.string().trim().min(1).max(120),
        phone: z.string().trim().max(20).optional().default(""),
        department: z.string().trim().max(80).optional().default(""),
        designation: z.string().trim().max(80).optional().default(""),
        role: assignable,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: isSuper, error: roleError } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "super_admin",
    });
    if (roleError || !isSuper)
      throw new Error("Only a Super Admin can create accounts with a username and password.");
    const { data: me, error: profileError } = await context.supabase
      .from("profiles")
      .select("company_id,is_active")
      .eq("id", context.userId)
      .single();
    if (profileError || !me?.is_active || !me.company_id)
      throw new Error("Your account needs an active company.");
    const { usernameToEmail } = await import("@/lib/staff-login");
    const email = usernameToEmail(data.username);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName, username: data.username },
    });
    if (error)
      throw new Error(
        /already/i.test(error.message) ? "That username is already taken." : error.message,
      );
    const id = created.user.id;
    const { error: pErr } = await supabaseAdmin.from("profiles").upsert({
      id,
      email,
      username: data.username,
      full_name: data.fullName,
      phone: data.phone || null,
      department: data.department || null,
      designation: data.designation || null,
      company_id: me.company_id,
      is_active: true,
    });
    if (pErr) throw new Error(pErr.message);
    const { error: rErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: id, role: data.role });
    if (rErr) throw new Error(rErr.message);
    return { ok: true };
  });

/** Username-only accounts have a non-deliverable sign-in email; let them attach their real one so password reset links can reach them. */
export const setMyRealEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ email: z.string().trim().toLowerCase().email().max(255) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { isSyntheticEmail } = await import("@/lib/staff-login");
    if (isSyntheticEmail(data.email)) throw new Error("Please enter a real email address.");
    const { data: profile, error: profileError } = await context.supabase
      .from("profiles")
      .select("email,is_active")
      .eq("id", context.userId)
      .single();
    if (profileError || !profile?.is_active) throw new Error("Your staff account is inactive.");
    if (!isSyntheticEmail(profile.email))
      throw new Error("Your account already has an email address.");
    const { getRequest } = await import("@tanstack/react-start/server");
    const request = getRequest();
    // Use the ordinary user-authenticated endpoint, which sends confirmation mail.
    // The profile email is synchronized only after Auth confirms the change.
    const response = await fetch(`${process.env["SUPABASE_URL"]}/auth/v1/user`, {
      method: "PUT",
      signal: AbortSignal.timeout(10000),
      headers: {
        apikey: process.env["SUPABASE_PUBLISHABLE_KEY"]!,
        Authorization: request.headers.get("authorization")!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: data.email }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        "Could not request email verification. Please try again or contact your administrator.",
      );
    }
    await response.body?.cancel();
    return { verificationRequired: true };
  });

/** Any staff member can set or change their sign-in username. */
export const changeMyUsername = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        username: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9._-]{3,32}$/, "Username: 3–32 letters, numbers, dot, dash or underscore"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: active, error: activeError } = await context.supabase
      .from("profiles")
      .select("is_active")
      .eq("id", context.userId)
      .single();
    if (activeError || !active?.is_active) throw new Error("Your staff account is inactive.");
    const { isSyntheticEmail, usernameToEmail } = await import("@/lib/staff-login");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: taken, error: lookupError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("username", data.username)
      .neq("id", context.userId)
      .maybeSingle();
    if (lookupError) throw new Error("Username availability could not be checked. Please retry.");
    if (taken) throw new Error("That username is already taken.");
    const { data: u, error: uErr } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    if (uErr || !u.user) throw new Error("Account not found.");
    const patch: { username: string; email?: string } = { username: data.username };
    if (isSyntheticEmail(u.user.email)) {
      const email = usernameToEmail(data.username);
      if (email !== u.user.email) {
        const { error } = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
          email,
          email_confirm: true,
        });
        if (error)
          throw new Error(
            /already/i.test(error.message) ? "That username is already taken." : error.message,
          );
      }
      patch.email = email;
    }
    const { error: pErr } = await supabaseAdmin
      .from("profiles")
      .update(patch)
      .eq("id", context.userId);
    if (pErr)
      throw new Error(
        /duplicate|unique/i.test(pErr.message) ? "That username is already taken." : pErr.message,
      );
    return { ok: true };
  });

/** Public: sign in with username + password. Resolves the account server-side so emails are never exposed. */
export const signInWithUsername = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        username: z.string().trim().toLowerCase().min(1).max(32),
        password: z.string().min(1).max(72),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const fail = "Incorrect username or password.";
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("username", data.username)
      .maybeSingle();
    let email: string | undefined;
    if (prof) {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(prof.id);
      email = u.user?.email ?? undefined;
    }
    if (!email) {
      const { usernameToEmail } = await import("@/lib/staff-login");
      email = usernameToEmail(data.username);
    }
    const { createClient } = await import("@supabase/supabase-js");
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
    const client = createClient(process.env["SUPABASE_URL"]!, key, {
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
      global: {
        fetch: (input, init) => {
          const h = new Headers(init?.headers);
          if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`)
            h.delete("Authorization");
          h.set("apikey", key);
          return fetch(input, { ...init, headers: h });
        },
      },
    });
    const { data: res, error } = await client.auth.signInWithPassword({
      email,
      password: data.password,
    });
    if (error || !res.session) throw new Error(fail);
    return { access_token: res.session.access_token, refresh_token: res.session.refresh_token };
  });
