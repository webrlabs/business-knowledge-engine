'use client';

import { usePathname, useRouter } from 'next/navigation';

export default function Breadcrumb() {
  const pathname = usePathname();
  const router = useRouter();

  // Generate breadcrumb items from pathname
  const generateBreadcrumbs = () => {
    const paths = pathname.split('/').filter(Boolean);
    const breadcrumbs = [
      { name: 'Home', href: '/dashboard' }
    ];

    let currentPath = '';
    paths.forEach((path, index) => {
      currentPath += `/${path}`;

      // Skip 'dashboard' as it's already included as Home
      if (path === 'dashboard') return;

      // Capitalize and format the path name
      const name = path
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

      breadcrumbs.push({
        name,
        href: currentPath
      });
    });

    return breadcrumbs;
  };

  const breadcrumbs = generateBreadcrumbs();

  // Don't show breadcrumb on home page
  if (breadcrumbs.length <= 1) {
    return null;
  }

  return (
    <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-3">
      <ol className="flex items-center space-x-2 text-sm">
        {breadcrumbs.map((crumb, index) => (
          <li key={crumb.href} className="flex items-center">
            {index > 0 && (
              <svg
                className="w-4 h-4 text-gray-400 dark:text-gray-500 mx-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            )}
            {index === breadcrumbs.length - 1 ? (
              <span className="font-medium text-gray-900 dark:text-white">{crumb.name}</span>
            ) : (
              <a
                href={crumb.href}
                onClick={(e) => {
                  e.preventDefault();
                  router.push(crumb.href);
                }}
                className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline"
              >
                {crumb.name}
              </a>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
