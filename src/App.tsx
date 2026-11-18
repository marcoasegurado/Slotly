import { useEffect } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AppLayout } from './components/Layout'
import { LandingPage } from './pages/Landing'
import { SelectServicePage } from './pages/SelectService'
import { DateTimePage } from './pages/DateTime'
import { DetailsPage } from './pages/Details'
import { RequestReceivedPage } from './pages/RequestReceived'
import { SignInPage } from './pages/SignIn'
import { ChangePasswordPage } from './pages/ChangePassword'
import { MyAppointmentsPage } from './pages/MyAppointments'
import { BookingDetailPage } from './pages/BookingDetail'
import { GuestCancelPage } from './pages/GuestCancel'
import { NotFoundPage } from './pages/NotFound'
import { RequireStaff } from './components/RequireStaff'
import { RequireAdmin } from './components/RequireAdmin'
import { AdminLayout } from './components/AdminLayout'
import { WorkspaceLayout } from './components/WorkspaceLayout'
import { StaffDashboardPage } from './pages/staff/StaffDashboard'
import { StaffAvailabilityPage } from './pages/staff/StaffAvailability'
import { AppointmentsPage } from './pages/manage/Appointments'
import { AppointmentDetailPage } from './pages/manage/AppointmentDetail'
import { AdminDashboardPage } from './pages/admin/AdminDashboard'
import { AdminServicesPage } from './pages/admin/AdminServices'
import { usePublicData, useSessionLoading } from './lib/hooks'
import { Card } from './components/Card'
import { StateBlock } from './components/StateBlock'
import { Button } from './components/Button'

function ScrollToTop() {
  const { pathname, search } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname, search])
  return null
}

/** The startup probes resolve in a moment; avoid flashing signed-out chrome. */
function BootScreen() {
  return (
    <div className="container main--narrow" style={{ paddingBlock: 'var(--space-12)' }}>
      <p className="meta">Loading Slotly…</p>
    </div>
  )
}

/**
 * The business settings drive every page (timezone, booking window, name). There
 * is no sample fallback, so a failed load is reported instead of hidden.
 */
function PublicDataError({ message }: { message: string }) {
  return (
    <div className="container main--narrow" style={{ paddingBlock: 'var(--space-12)' }}>
      <Card>
        <StateBlock
          icon="!"
          headingLevel={1}
          title="Slotly could not load the business settings"
          actions={
            <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
              Try again
            </Button>
          }
        >
          {message}
        </StateBlock>
      </Card>
    </div>
  )
}

export function App() {
  const sessionLoading = useSessionLoading()
  const publicData = usePublicData()

  if (sessionLoading || publicData.status === 'loading') return <BootScreen />
  if (publicData.status === 'error' || !publicData.business) {
    return (
      <PublicDataError
        message={
          publicData.error ??
          'The business settings have not been configured yet.'
        }
      />
    )
  }

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
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route path="/appointments" element={<MyAppointmentsPage />} />
          <Route path="/appointments/:id" element={<BookingDetailPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>

        <Route
          path="/staff"
          element={
            <RequireStaff>
              <WorkspaceLayout />
            </RequireStaff>
          }
        >
          <Route index element={<StaffDashboardPage />} />
          <Route
            path="appointments"
            element={<AppointmentsPage area="staff" />}
          />
          <Route
            path="appointments/:reference"
            element={<AppointmentDetailPage area="staff" />}
          />
          <Route path="availability" element={<StaffAvailabilityPage />} />
        </Route>

        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminLayout />
            </RequireAdmin>
          }
        >
          <Route index element={<AdminDashboardPage />} />
          <Route
            path="appointments"
            element={<AppointmentsPage area="admin" />}
          />
          <Route
            path="appointments/:reference"
            element={<AppointmentDetailPage area="admin" />}
          />
          <Route path="services" element={<AdminServicesPage />} />
        </Route>

        <Route path="/cancel/:token" element={<GuestCancelPage />} />
      </Routes>
    </BrowserRouter>
  )
}
