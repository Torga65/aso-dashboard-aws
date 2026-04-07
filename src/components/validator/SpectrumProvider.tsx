'use client';

import { Provider, defaultTheme, darkTheme } from '@adobe/react-spectrum';
import { useTheme } from '@/contexts/ThemeContext';

export function SpectrumProvider({ children }: { children: React.ReactNode }) {
  const { colorScheme } = useTheme();
  return (
    <Provider
      theme={colorScheme === 'dark' ? darkTheme : defaultTheme}
      colorScheme={colorScheme}
      locale="en-US"
    >
      {children}
    </Provider>
  );
}
