import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Home,
  Layers,
  LogOut,
  Menu,
  MoreHorizontal,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  UserRound,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  mobileWorkspaceNavigation,
  workspaceLocation,
  type WorkspaceNavGroup,
} from "@/lib/workspace-navigation";
import { cn } from "@/lib/utils";

const icons = {
  home: Home,
  purchasing: ShoppingCart,
  stock: Layers,
  finance: Wallet,
  approvals: ShieldCheck,
  projects: Building2,
  settings: Settings,
};

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="workspace-brand">
      <img
        src="/brand/kk-groups.png"
        onError={(event) => {
          if (!event.currentTarget.src.endsWith("/favicon.png"))
            event.currentTarget.src = "/favicon.png";
        }}
        alt="KK Groups"
        width="48"
        height="42"
      />
      <div
        className={
          compact ? "workspace-brand-text workspace-brand-compact" : "workspace-brand-text"
        }
      >
        <strong>
          <span className="hidden md:inline">KK GROUP ERP</span>
          <span className="md:hidden">KK ERP</span>
        </strong>
        <span>Real estate & construction</span>
      </div>
    </div>
  );
}

export type WorkspaceFrameProps = {
  path: string;
  groups: WorkspaceNavGroup[];
  name: string;
  role: string;
  isDirector?: boolean;
  avatar?: string | null | undefined;
  notifications?: ReactNode;
  pendingApprovals?: number | undefined;
  navigating?: boolean;
  onSignOut: () => void;
  children: ReactNode;
};

/** Presentation only. Authorization stays in the authenticated shell and database. */
export function WorkspaceFrame({
  path,
  groups,
  name,
  role,
  isDirector = false,
  avatar,
  notifications,
  pendingApprovals = 0,
  navigating = false,
  onSignOut,
  children,
}: WorkspaceFrameProps) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [phone, setPhone] = useState(false);
  const [mobileGroup, setMobileGroup] = useState<string | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setPhone(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const [searchOpen, setSearchOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const location = workspaceLocation(path, groups);
  const home = groups.find((group) => group.key === "home")?.items[0]?.to ?? "/profile";
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase() || "U";
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const person = (
    <span className="workspace-avatar">{avatar ? <img src={avatar} alt="" /> : initials}</span>
  );
  const go = (to: string) => {
    setMenuOpen(false);
    setSearchOpen(false);
    void navigate({ to });
  };
  const renderNav = (drawer = false) => (
    <nav
      aria-label={drawer ? "All modules" : "Main navigation"}
      className={cn("workspace-sidebar-inner", drawer && "workspace-drawer-nav")}
    >
      <Link
        to={home}
        className="workspace-brand-link"
        aria-label="KK ERP home"
        onClick={() => setMenuOpen(false)}
      >
        <Brand compact={!drawer} />
      </Link>
      <div className="workspace-nav-groups">
        {groups.map((group) => {
          const Icon = icons[group.key as keyof typeof icons] ?? Layers;
          const active = location?.group.key === group.key;
          const open = expanded[group.key] ?? active;
          const single = group.items.length === 1;
          const badge =
            group.key === "approvals" && pendingApprovals > 0 ? (
              <span className="workspace-nav-count">
                {pendingApprovals > 99 ? "99+" : pendingApprovals}
              </span>
            ) : null;
          return (
            <div
              key={group.key}
              className={cn(
                "workspace-nav-group",
                group.key === "settings" && "workspace-settings",
              )}
            >
              {single ? (
                <Link
                  to={group.items[0]!.to}
                  onClick={() => setMenuOpen(false)}
                  className={cn("workspace-nav-heading", active && "is-active")}
                  title={group.label}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon aria-hidden />
                  <span>{group.label}</span>
                  {badge}
                </Link>
              ) : (
                <>
                  <button
                    type="button"
                    className={cn("workspace-nav-heading", active && "is-active")}
                    aria-expanded={open}
                    aria-controls={`${drawer ? "drawer" : "rail"}-${group.key}`}
                    title={group.label}
                    onClick={() => {
                      const compact =
                        !drawer &&
                        window.matchMedia("(min-width: 768px) and (max-width: 1199px)").matches;
                      setExpanded((value) => ({ ...value, [group.key]: compact ? true : !open }));
                      if (compact) setMenuOpen(true);
                    }}
                  >
                    <Icon aria-hidden />
                    <span>{group.label}</span>
                    {badge}
                    <ChevronDown
                      aria-hidden
                      className={cn("workspace-nav-chevron", open && "rotate-180")}
                    />
                  </button>
                  <div
                    id={`${drawer ? "drawer" : "rail"}-${group.key}`}
                    className="workspace-subnav"
                    hidden={!open}
                  >
                    {group.items.map((item) => (
                      <Link
                        key={item.to}
                        to={item.to}
                        onClick={() => setMenuOpen(false)}
                        aria-current={location?.item.to === item.to ? "page" : undefined}
                        className={cn(
                          "workspace-nav-child",
                          location?.item.to === item.to && "is-active",
                        )}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="workspace-sidebar-profile">
        <Link
          to="/profile"
          onClick={() => setMenuOpen(false)}
          className="workspace-profile-link"
          aria-label="My profile"
        >
          {person}
          <span>
            <strong>{name}</strong>
            <small>{role}</small>
          </span>
        </Link>
        <Button variant="ghost" size="icon" aria-label="Sign out" onClick={onSignOut}>
          <LogOut />
        </Button>
      </div>
    </nav>
  );
  const bottom = mobileWorkspaceNavigation(groups, isDirector);
  return (
    <div className="workspace-frame">
      <a href="#workspace-main" className="workspace-skip-link">
        Skip to content
      </a>
      <aside className="workspace-sidebar print:hidden">{renderNav()}</aside>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          side={phone ? "bottom" : "left"}
          className={cn("p-0", phone ? "workspace-more-sheet" : "workspace-menu-sheet")}
        >
          <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Choose a module or manage your account.
          </SheetDescription>
          {phone ? (
            <div className="workspace-more-content">
              <div className="workspace-more-heading">
                <h2>More</h2>
                <p>Everything else in your workspace</p>
              </div>
              <div className="workspace-more-grid" aria-label="Workspace modules">
                {groups
                  .filter((group) => group.key !== "home")
                  .map((group) => {
                    const Icon = icons[group.key as keyof typeof icons] ?? Layers;
                    return (
                      <button
                        type="button"
                        key={group.key}
                        aria-pressed={mobileGroup === group.key}
                        onClick={() =>
                          setMobileGroup((current) => (current === group.key ? null : group.key))
                        }
                      >
                        <Icon aria-hidden />
                        <span>{group.label}</span>
                      </button>
                    );
                  })}
              </div>
              {groups
                .filter((group) => group.key === mobileGroup)
                .map((group) => (
                  <nav className="workspace-more-links" key={group.key} aria-label={group.label}>
                    <h3>{group.label}</h3>
                    {group.items.map((item) => (
                      <Link
                        to={item.to}
                        key={item.to}
                        onClick={() => setMenuOpen(false)}
                        aria-current={location?.item.to === item.to ? "page" : undefined}
                      >
                        {item.label}
                        <ChevronRight aria-hidden />
                      </Link>
                    ))}
                  </nav>
                ))}
              <div className="workspace-more-account">
                <Link to="/profile" onClick={() => setMenuOpen(false)}>
                  {person}
                  <span>
                    <strong>{name}</strong>
                    <small>{role}</small>
                  </span>
                </Link>
                <Button variant="ghost" size="icon" onClick={onSignOut} aria-label="Sign out">
                  <LogOut />
                </Button>
              </div>
            </div>
          ) : (
            renderNav(true)
          )}
        </SheetContent>
      </Sheet>
      <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
        <CommandInput placeholder="Find a page…" />
        <CommandList>
          <CommandEmpty>No matching page.</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group.key} heading={group.label}>
              {group.items.map((item) => (
                <CommandItem
                  key={item.to}
                  value={`${group.label} ${item.label}`}
                  onSelect={() => go(item.to)}
                >
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
      <div className="workspace-body">
        <header className="workspace-topbar print:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="workspace-menu-trigger"
            onClick={() => setMenuOpen(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </Button>
          <Link to={home} className="workspace-mobile-brand">
            <Brand />
          </Link>
          <div className="workspace-breadcrumb">
            <span>Workspace</span>
            <ChevronRight aria-hidden />
            <strong>{location?.item.label ?? "Overview"}</strong>
          </div>
          <button
            type="button"
            className="workspace-search"
            onClick={() => setSearchOpen(true)}
            aria-label="Search pages"
          >
            <Search aria-hidden />
            <span>Search pages…</span>
            <kbd>⌘ K</kbd>
          </button>
          <div className="workspace-topbar-tools">
            {notifications}
            <DropdownMenu>
              <DropdownMenuTrigger aria-label="Account menu" className="workspace-account">
                {person}
                <span className="workspace-account-name">{name}</span>
                <ChevronDown aria-hidden className="size-4 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel>
                  <div className="truncate">{name}</div>
                  <div className="text-xs font-normal text-muted-foreground">{role}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => go("/profile")}>
                  <UserRound />
                  My profile
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onSignOut}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {navigating && (
            <div
              role="progressbar"
              aria-label="Loading page"
              className="workspace-navigation-progress"
            />
          )}
        </header>
        <main id="workspace-main" tabIndex={-1} className="workspace-main">
          {children}
        </main>
      </div>
      <nav
        aria-label="Mobile navigation"
        className="workspace-bottom-nav print:hidden"
        style={{ gridTemplateColumns: `repeat(${bottom.length + 1}, minmax(0,1fr))` }}
      >
        {bottom.map((group) => {
          const Icon = icons[group.key as keyof typeof icons] ?? Home;
          const active = location?.group.key === group.key;
          return (
            <Link
              key={group.key}
              to={group.to}
              aria-label={
                group.key === "approvals" && pendingApprovals > 0
                  ? `Approvals, ${pendingApprovals} pending`
                  : undefined
              }
              aria-current={active ? "page" : undefined}
              className={cn(active && "is-active")}
            >
              <Icon aria-hidden />
              {group.key === "approvals" && pendingApprovals > 0 && (
                <span className="workspace-bottom-badge" aria-hidden="true">
                  {pendingApprovals > 99 ? "99+" : pendingApprovals}
                </span>
              )}
              <span>{group.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="More modules"
          aria-expanded={menuOpen}
          className={cn(!bottom.some((group) => group.key === location?.group.key) && "is-active")}
        >
          <MoreHorizontal aria-hidden />
          <span>More</span>
        </button>
      </nav>
    </div>
  );
}
