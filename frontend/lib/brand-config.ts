/**
 * Brand Configuration
 * Central source of truth for all branding elements across the application
 */

export const brandConfig = {
  // Application Name
  appName: 'Business Process Knowledge Platform',
  appEdition: 'Enterprise Azure Edition',
  appShortName: 'BPKP',

  // Brand Colors (using Tailwind color classes)
  colors: {
    primary: {
      base: 'blue-600',
      hover: 'blue-700',
      light: 'blue-50',
      border: 'blue-200',
      text: 'blue-900',
    },
    secondary: {
      base: 'indigo-600',
      hover: 'indigo-700',
      light: 'indigo-50',
      border: 'indigo-200',
      text: 'indigo-900',
    },
    success: {
      base: 'green-600',
      hover: 'green-700',
      light: 'green-50',
      border: 'green-200',
      text: 'green-900',
    },
    warning: {
      base: 'yellow-600',
      hover: 'yellow-700',
      light: 'yellow-50',
      border: 'yellow-200',
      text: 'yellow-900',
    },
    error: {
      base: 'red-600',
      hover: 'red-700',
      light: 'red-50',
      border: 'red-200',
      text: 'red-900',
    },
    neutral: {
      base: 'gray-600',
      hover: 'gray-700',
      light: 'gray-50',
      border: 'gray-200',
      text: 'gray-900',
    },
  },

  // Typography
  typography: {
    fontFamily: 'Inter, system-ui, sans-serif',
    headings: {
      h1: 'text-3xl font-bold',
      h2: 'text-2xl font-semibold',
      h3: 'text-xl font-semibold',
      h4: 'text-lg font-semibold',
    },
  },

  // Spacing and Layout
  layout: {
    maxWidth: 'max-w-7xl',
    padding: 'px-4 sm:px-6 lg:px-8',
  },

  // Component Styles
  components: {
    button: {
      primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
      secondary: 'bg-gray-600 text-white hover:bg-gray-700 focus:ring-gray-500',
      danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
      base: 'px-4 py-2 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2',
    },
    card: {
      base: 'bg-white rounded-lg shadow-md',
      hover: 'hover:shadow-lg transition-shadow',
    },
    input: {
      base: 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
    },
  },

  // Logo/Icon Configuration (placeholder for future logo implementation)
  logo: {
    text: 'BPKP',
    iconColor: 'text-blue-600',
  },
} as const;

/**
 * Helper function to get full class names for buttons
 */
export function getButtonClasses(variant: 'primary' | 'secondary' | 'danger' = 'primary'): string {
  return `${brandConfig.components.button.base} ${brandConfig.components.button[variant]}`;
}

/**
 * Helper function to get full class names for cards
 */
export function getCardClasses(hoverable: boolean = false): string {
  return hoverable
    ? `${brandConfig.components.card.base} ${brandConfig.components.card.hover}`
    : brandConfig.components.card.base;
}

/**
 * Helper function to get input classes
 */
export function getInputClasses(): string {
  return brandConfig.components.input.base;
}
