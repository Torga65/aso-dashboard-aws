import type { Metadata } from "next";
import { Roboto, Roboto_Condensed } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { IMSAuthProvider } from "@/contexts/IMSAuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-roboto",
  display: "swap",
});

const robotoCondensed = Roboto_Condensed({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-roboto-condensed",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    template: "%s | AEM Sites Optimizer",
    default: "AEM Sites Optimizer — Customer Dashboard",
  },
  description:
    "AEM Sites Optimizer customer engagement dashboard showing key metrics and health scores.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${roboto.variable} ${robotoCondensed.variable}`}>
      <body>
        <ThemeProvider>
          <IMSAuthProvider>
            <div>
              <Header />
              <main>{children}</main>
              <Footer />
            </div>
          </IMSAuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
