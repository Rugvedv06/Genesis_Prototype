import './globals.css';

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>KINTSUGI · Drift Control</title>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('kintsugi-theme');if(t==='dark'||t==='light'){document.documentElement.classList.toggle('dark',t==='dark')}else{document.documentElement.classList.toggle('dark',matchMedia('(prefers-color-scheme: dark)').matches)}}catch(e){}})()` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
