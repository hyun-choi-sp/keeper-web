import Link from "next/link";
import { useRouter } from "next/router";

const NAV_ITEMS = [
  { href: "/", label: "Keeper Manager" },
  { href: "/har", label: "HAR Inspector" },
];

export default function Nav() {
  const router = useRouter();

  return (
    <nav className="nav">
      <div className="container nav-inner">
        <div className="nav-brand">
          <svg
            className="nav-logo"
            viewBox="0 0 64 64"
            aria-hidden="true"
            focusable="false"
          >
            <polygon points="8,48 32,8 56,48" />
            <polygon points="8,48 32,56 56,48" />
          </svg>
          <span className="nav-brand-text">SailPoint</span>
        </div>
        <div className="nav-links">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={router.pathname === item.href ? "nav-link active" : "nav-link"}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
