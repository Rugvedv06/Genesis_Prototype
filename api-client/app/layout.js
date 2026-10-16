import './globals.css';
import Shell from '../components/Shell';
import { ThemeProvider } from 'next-themes';

export const metadata = { title: 'healr', description: 'Self-healing tool registry for AI agents' };

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <Shell>{children}</Shell>
        </ThemeProvider>
      </body>
    </html>
  );
}
