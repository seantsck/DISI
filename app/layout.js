import './globals.css'
import Nav from './components/Nav'
import Footer from './components/Footer'

export const metadata = {
  title: {
    default: 'DISI — Dodgers International Signings Research Database',
    template: '%s — DISI',
  },
  description: 'Public-data research database of Brooklyn and Los Angeles Dodgers international signings: signing classes, acquisition costs, player development, MLB outcomes, transactions and organizational value.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        <Nav />
        <div id="main">{children}</div>
        <Footer />
      </body>
    </html>
  )
}
