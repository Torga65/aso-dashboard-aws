import { SpectrumProvider } from '@/components/validator/SpectrumProvider';

export default function ValidatorLayout({ children }: { children: React.ReactNode }) {
  return <SpectrumProvider>{children}</SpectrumProvider>;
}
