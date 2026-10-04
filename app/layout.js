import './globals.css'
import Nav from './components/Nav'
import Footer from './components/Footer'

export const metadata = {
  title: 'DISI — Dodgers International Signing Intelligence',
  description: 'Public-data decision support for international signing capital, talent identification, development, and asset conversion.'
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
        <Footer />
      </body>
    </html>
  )
}
