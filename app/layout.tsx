import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MyTidyfy — Your AI-Powered Document Organizer",
  description: "Automatically classify, sort, and rename your PDF documents using AI. Drop a folder of random files — MyTidyfy organizes everything.",
  icons: {
    icon: "/favicon.png"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('ai-doc-theme') || 'light';
                  if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                    document.documentElement.classList.add('dark');
                  }
                } catch(e) {}
              })();
            `
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
