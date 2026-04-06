'use client';

import { Provider, darkTheme } from '@adobe/react-spectrum';

export function SpectrumProvider({ children }: { children: React.ReactNode }) {
  return (
    <Provider theme={darkTheme} colorScheme="dark" locale="en-US">
      {children}
    </Provider>
  );
}
