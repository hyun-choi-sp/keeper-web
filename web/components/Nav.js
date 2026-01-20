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
        <span className="nav-brand">Keeper Web</span>
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
