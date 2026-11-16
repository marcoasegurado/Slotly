import { useEffect } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AppLayout } from './components/Layout'
import { LandingPage } from './pages/Landing'
import { SelectServicePage } from './pages/SelectService'
import { DateTimePage } from './pages/DateTime'
import { DetailsPage } from './pages/Details'
import { RequestReceivedPage } from './pages/RequestReceived'
import { SignInPage } from './pages/SignIn'
import { MyAppointmentsPage } from './pages/MyAppointments'
import { BookingDetailPage } from './pages/BookingDetail'
import { GuestCancelPage } from './pages/GuestCancel'
import { NotFoundPage } from './pages/NotFound'

function ScrollToTop() {
  const { pathname, search } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname, search])
  return null
}

export function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/book" element={<SelectServicePage />} />
          <Route path="/book/:serviceId" element={<DateTimePage />} />
          <Route path="/book/:serviceId/details" element={<DetailsPage />} />
          <Route path="/request-received/:reference" element={<RequestReceivedPage />} />
          <Route path="/signin" element={<SignInPage />} />
          <Route path="/appointments" element={<MyAppointmentsPage />} />
          <Route path="/appointments/:id" element={<BookingDetailPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="/cancel/:token" element={<GuestCancelPage />} />
      </Routes>
    </BrowserRouter>
  )
}
