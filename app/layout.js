import './globals.css'

export const metadata = {
  title: 'DISI — Dodgers International Signing Intelligence',
  description: 'Public-data portfolio prototype for international signing intelligence and asset conversion analysis.'
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
