export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>api-client · Core Dashboard</title>
      </head>
      <body>{children}</body>
    </html>
  );
}
